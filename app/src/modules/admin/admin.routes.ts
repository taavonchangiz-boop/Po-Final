/**
 * Admin routes: platform stats, user/plan/settings management, audit logs,
 * payments and tickets. EVERY route is restricted to SUPER_ADMIN/ADMIN and
 * every mutation is audited (admin.service + AnalyticsService.trackAudit).
 */
import type { FastifyInstance } from 'fastify';
import { asc, count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { sendCreated, sendOk } from '../../core/envelope.js';
import { notFound, validationError } from '../../core/errors.js';
import { AnalyticsService } from '../../core/events.js';
import { enqueueOutbox } from '../../core/outbox.js';
import { requireRole } from '../../security/tenant.js';
import { requireAuth } from '../../security/session.js';
import { PaymentService } from '../billing/payment.service.js';
import { createNotification } from '../notifications/notifications.service.js';
import { SupportService } from '../support/support.service.js';
import { db } from '../../db/client.js';
import { supportTickets, ticketMessages } from '../../db/schema.js';
import { AdminService } from './admin.service.js';

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const adminPreHandler = [requireAuth, requireRole('SUPER_ADMIN', 'ADMIN')];

export function registerAdminRoutes(app: FastifyInstance): void {
  /* ---------------------------------- Stats ---------------------------------- */
  app.get('/api/v1/admin/stats', { preHandler: adminPreHandler }, async (_request, reply) => {
    const stats = await AdminService.platformStats();
    return sendOk(reply, stats);
  });

  /* ---------------------------------- Users ---------------------------------- */
  app.get('/api/v1/admin/users', { preHandler: adminPreHandler }, async (request, reply) => {
    const parsed = PaginationSchema.extend({ q: z.string().max(100).optional() }).safeParse(request.query);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const { items, total } = await AdminService.listUsers(parsed.data.page, parsed.data.limit, parsed.data.q);
    return sendOk(reply, { items, total, page: parsed.data.page, limit: parsed.data.limit });
  });

  app.patch('/api/v1/admin/users/:id', { preHandler: adminPreHandler }, async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().min(1) }).safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    const parsed = z
      .object({
        role: z.enum(['SUPER_ADMIN', 'ADMIN', 'USER']).optional(),
        status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());

    const user = await AdminService.updateUserRoleStatus(request.currentUser!.id, request.currentUser!.role, params.data.id, parsed.data);
    return sendOk(reply, { user });
  });

  /* -------------------------------- Audit logs ------------------------------- */
  app.get('/api/v1/admin/audit-logs', { preHandler: adminPreHandler }, async (request, reply) => {
    const parsed = PaginationSchema.extend({ action: z.string().max(60).optional() }).safeParse(request.query);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const { items, total } = await AdminService.listAuditLogs(parsed.data.page, parsed.data.limit, parsed.data.action);
    return sendOk(reply, { items, total, page: parsed.data.page, limit: parsed.data.limit });
  });

  /* -------------------------------- Payments --------------------------------- */
  app.get('/api/v1/admin/payments', { preHandler: adminPreHandler }, async (request, reply) => {
    const parsed = PaginationSchema.extend({ status: z.enum(['CREATED', 'REDIRECTED', 'VERIFIED', 'FAILED', 'REFUNDED']).optional() }).safeParse(
      request.query,
    );
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const { items, total } = await PaymentService.listAll(parsed.data.page, parsed.data.limit, parsed.data.status);
    return sendOk(reply, {
      items: items.map((p) => ({
        id: p.id,
        userId: p.userId,
        userEmail: p.userEmail,
        purpose: p.purpose,
        amount: p.amount,
        gateway: p.gateway,
        status: p.status,
        gatewayRef: p.gatewayRef,
        verifiedAt: p.verifiedAt,
        createdAt: p.createdAt,
      })),
      total,
      page: parsed.data.page,
      limit: parsed.data.limit,
    });
  });

  /* --------------------------------- Tickets --------------------------------- */
  app.get('/api/v1/admin/tickets', { preHandler: adminPreHandler }, async (request, reply) => {
    const parsed = PaginationSchema.extend({ status: z.enum(['OPEN', 'ANSWERED', 'PENDING_USER', 'CLOSED']).optional() }).safeParse(
      request.query,
    );
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const where = parsed.data.status ? eq(supportTickets.status, parsed.data.status) : undefined;
    const [items, totalRows] = await Promise.all([
      db
        .select()
        .from(supportTickets)
        .where(where)
        .orderBy(desc(supportTickets.id))
        .limit(parsed.data.limit)
        .offset((parsed.data.page - 1) * parsed.data.limit),
      db.select({ value: count() }).from(supportTickets).where(where),
    ]);
    return sendOk(reply, { items, total: Number(totalRows[0]?.value ?? 0), page: parsed.data.page, limit: parsed.data.limit });
  });

  app.get('/api/v1/admin/tickets/:id', { preHandler: adminPreHandler }, async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().min(1) }).safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    const ticketRows = await db.select().from(supportTickets).where(eq(supportTickets.id, params.data.id)).limit(1);
    const ticket = ticketRows[0];
    if (!ticket) throw notFound('تیکت یافت نشد.');
    const messages = await db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, ticket.id))
      .orderBy(asc(ticketMessages.id));
    return sendOk(reply, { ticket, messages });
  });

  app.patch('/api/v1/admin/tickets/:id', { preHandler: adminPreHandler }, async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().min(1) }).safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    const parsed = z.object({ status: z.enum(['OPEN', 'ANSWERED', 'PENDING_USER', 'CLOSED']) }).safeParse(request.body);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const updated = await db
      .update(supportTickets)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(eq(supportTickets.id, params.data.id));
    if (updated[0]?.affectedRows === 0) throw notFound('تیکت یافت نشد.');
    AnalyticsService.trackAudit({
      actorUserId: request.currentUser!.id,
      action: 'admin.ticket.status_changed',
      subjectType: 'ticket',
      subjectId: params.data.id,
      data: { status: parsed.data.status },
    });
    const ticketRows = await db.select().from(supportTickets).where(eq(supportTickets.id, params.data.id)).limit(1);
    return sendOk(reply, { ticket: ticketRows[0] ?? null });
  });

  app.post('/api/v1/admin/tickets/:id/reply', { preHandler: adminPreHandler }, async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().min(1) }).safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    const parsed = z.object({ body: z.string().min(1).max(5000) }).safeParse(request.body);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());

    const result = await SupportService.addMessage({
      ticketId: params.data.id,
      senderUserId: request.currentUser!.id,
      isStaff: true,
      body: parsed.data.body,
    });

    // Notify the ticket owner (in-app + channel fan-out via outbox).
    const title = 'پاسخ پشتیبانی به تیکت شما';
    const body = `تیکت «${result.ticket.subject.slice(0, 80)}» پاسخ داده شد.`;
    const notificationId = await createNotification(db, {
      userId: result.ticket.userId,
      category: 'SYSTEM',
      title,
      body,
    });
    await enqueueOutbox(db, {
      aggregateType: 'notification',
      aggregateId: notificationId,
      eventType: 'notification.fanout',
      payload: { notificationId, userId: result.ticket.userId, text: `${title} — ${body}` },
    });

    AnalyticsService.trackAudit({
      actorUserId: request.currentUser!.id,
      action: 'admin.ticket.replied',
      subjectType: 'ticket',
      subjectId: result.ticket.id,
    });

    return sendCreated(reply, { ticket: result.ticket, message: result.message });
  });

  /* ---------------------------------- Plans ---------------------------------- */
  app.get('/api/v1/admin/plans', { preHandler: adminPreHandler }, async (_request, reply) => {
    const plans = await AdminService.listPlans();
    return sendOk(reply, { items: plans });
  });

  app.patch('/api/v1/admin/plans/:id', { preHandler: adminPreHandler }, async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().min(1) }).safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    const parsed = z
      .object({
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(2000).nullable().optional(),
        priceMonthly: z.number().int().min(0).optional(),
        isActive: z.boolean().optional(),
        sortOrder: z.number().int().min(0).optional(),
        limits: z
          .object({
            channels: z.number().int().min(0),
            postsPerMonth: z.number().int().min(0),
            aiCredits: z.number().int().min(0),
            bots: z.number().int().min(0),
            schedules: z.number().int().min(0),
            storageMb: z.number().int().min(0),
          })
          .optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());

    const plan = await AdminService.updatePlan(request.currentUser!.id, params.data.id, parsed.data);
    return sendOk(reply, { plan });
  });

  /* --------------------------------- Settings -------------------------------- */
  app.get('/api/v1/admin/settings', { preHandler: adminPreHandler }, async (_request, reply) => {
    const settings = await AdminService.getSettings();
    return sendOk(reply, { settings });
  });

  app.patch('/api/v1/admin/settings', { preHandler: adminPreHandler }, async (request, reply) => {
    const parsed = z.record(z.unknown()).safeParse(request.body);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const settings = await AdminService.updateSettings(request.currentUser!.id, parsed.data);
    return sendOk(reply, { settings });
  });
}

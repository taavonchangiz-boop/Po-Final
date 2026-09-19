import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import { parseWith } from '../../core/validation.js';
import { Permission } from '../../security/permissions.js';
import { audit } from '../../core/audit.js';
import {
  getOverview,
  listUsers,
  setUserSuspended,
  grantSubscription,
  listAdminPayments,
  approvePayment,
  listAuditLogs,
  listPlans,
  updatePlan,
  getSettings,
  putSettings,
  broadcast,
  releaseChannel,
} from './admin.service.js';

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

function auth(req: FastifyRequest): { id: string; role: 'SUPER_ADMIN' | 'SUPPORT' | 'USER' } {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { id: req.user.id, role: req.user.role };
}

function paramId(req: FastifyRequest): string {
  const { id } = req.params as { id: string };
  return id;
}

function paging(query: Record<string, string | undefined>): { page: number; pageSize: number } {
  const page = Number.parseInt(query.page ?? '1', 10) || 1;
  const pageSize = Number.parseInt(query.pageSize ?? '20', 10) || 20;
  return { page, pageSize };
}

const grantSchema = z.object({
  planCode: z.string().min(1).max(40),
  months: z.coerce.number().int().min(1).max(12),
});
const planPatchSchema = z.object({
  nameFa: z.string().min(1).max(80).optional(),
  priceRial: z.coerce.number().int().min(0).optional(),
  limitsJson: z.record(z.unknown()).optional(),
  featuresJson: z.record(z.unknown()).optional(),
});
const settingsSchema = z
  .record(z.unknown())
  .refine((r) => Object.keys(r).length > 0, { message: 'بدنهٔ تنظیمات خالی است.' });
const broadcastSchema = z.object({
  titleFa: z.string().min(2).max(190),
  bodyFa: z.string().min(2).max(5000),
});
const releaseSchema = z.object({
  platform: z.enum(['telegram', 'bale', 'rubika']),
  channelRef: z.string().min(1).max(190),
});

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  // Every admin route requires admin.access; sensitive groups declare a finer permission.
  const access = { preHandler: [app.requirePermission('admin.access')] };
  const usersManage = { preHandler: [app.requirePermission('admin.users.manage')] };
  const paymentsReview = { preHandler: [app.requirePermission('admin.payments.review')] };
  const plansManage = { preHandler: [app.requirePermission('admin.plans.manage')] };
  const settingsManage = { preHandler: [app.requirePermission('admin.settings.manage')] };

  app.get('/admin/overview', access, async () => {
    const data = await getOverview();
    return { success: true, data };
  });

  // ---- users ----
  app.get('/admin/users', access, async (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const { page, pageSize } = paging(q);
    const data = await listUsers(q.search, page, pageSize);
    return { success: true, data };
  });

  app.post('/admin/users/:id/suspend', usersManage, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    await setUserSuspended(me.id, id, true);
    await audit({ action: 'admin.user_suspended', actorId: me.id, actorRole: me.role, subjectType: 'user', subjectId: id, ip: req.ip });
    return { success: true, data: { ok: true } };
  });

  app.post('/admin/users/:id/activate', usersManage, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    await setUserSuspended(me.id, id, false);
    await audit({ action: 'admin.user_activated', actorId: me.id, actorRole: me.role, subjectType: 'user', subjectId: id, ip: req.ip });
    return { success: true, data: { ok: true } };
  });

  app.post('/admin/users/:id/grant-subscription', usersManage, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    const input = parse(grantSchema, req.body);
    const data = await grantSubscription(id, input.planCode, input.months);
    await audit({
      action: 'admin.grant_subscription',
      actorId: me.id,
      actorRole: me.role,
      subjectType: 'user',
      subjectId: id,
      ip: req.ip,
      meta: { planCode: input.planCode, months: input.months, subscriptionId: data.subscriptionId },
    });
    return { success: true, data };
  });

  // ---- payments ----
  app.get('/admin/payments', access, async (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const { page, pageSize } = paging(q);
    const data = await listAdminPayments(q.state, page, pageSize);
    return { success: true, data };
  });

  app.post('/admin/payments/:id/approve', paymentsReview, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    const data = await approvePayment(me.id, id);
    await audit({ action: 'admin.payment_approved', actorId: me.id, actorRole: me.role, subjectType: 'payment', subjectId: id, ip: req.ip });
    return { success: true, data };
  });

  // ---- audit logs (admin.access) ----
  app.get('/admin/audit-logs', access, async (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const { page, pageSize } = paging(q);
    const data = await listAuditLogs(q.action, page, pageSize);
    return { success: true, data };
  });

  // ---- plans ----
  app.get('/admin/plans', access, async () => {
    const data = await listPlans();
    return { success: true, data: { plans: data } };
  });

  app.put('/admin/plans/:id', plansManage, async (req) => {
    const me = auth(req);
    const id = paramId(req);
    const input = parse(planPatchSchema, req.body);
    await updatePlan(id, input);
    await audit({
      action: 'admin.plan_updated',
      actorId: me.id,
      actorRole: me.role,
      subjectType: 'plan',
      subjectId: id,
      ip: req.ip,
      meta: { fields: Object.keys(input) },
    });
    return { success: true, data: { ok: true } };
  });

  // ---- system settings ----
  app.get('/admin/settings', settingsManage, async () => {
    const data = await getSettings();
    return { success: true, data };
  });

  app.put('/admin/settings', settingsManage, async (req) => {
    const me = auth(req);
    const input = parse(settingsSchema, req.body);
    const updated = await putSettings(input as Record<string, unknown>);
    await audit({
      action: 'admin.settings_updated',
      actorId: me.id,
      actorRole: me.role,
      ip: req.ip,
      meta: { keys: updated },
    });
    return { success: true, data: { updated } };
  });

  // ---- broadcast ----
  app.post('/admin/broadcast', { preHandler: [app.requirePermission('admin.broadcast')] }, async (req) => {
    const me = auth(req);
    const input = parse(broadcastSchema, req.body);
    const notified = await broadcast(me.id, input.titleFa, input.bodyFa);
    await audit({ action: 'admin.broadcast', actorId: me.id, actorRole: me.role, ip: req.ip, meta: { recipients: notified } });
    return { success: true, data: { notified } };
  });

  // ---- channel registry ----
  app.post('/admin/channel-registry/release', usersManage, async (req) => {
    const me = auth(req);
    const input = parse(releaseSchema, req.body);
    await releaseChannel(me.id, input.platform, input.channelRef);
    await audit({
      action: 'admin.channel_released',
      actorId: me.id,
      actorRole: me.role,
      ip: req.ip,
      meta: { platform: input.platform, channelRef: input.channelRef },
    });
    return { success: true, data: { ok: true } };
  });
}

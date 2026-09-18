/**
 * Support routes: user-facing tickets (list/create/thread/reply).
 * Staff-side management lives in the admin module.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendCreated, sendOk } from '../../core/envelope.js';
import { validationError } from '../../core/errors.js';
import { publishLimiter } from '../../security/rate-limit.js';
import { requireAuth } from '../../security/session.js';
import { SUPPORT_CATEGORIES, SupportService } from './support.service.js';

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function registerSupportRoutes(app: FastifyInstance): void {
  app.get('/api/v1/support/tickets', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = PaginationSchema.safeParse(request.query);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const { items, total } = await SupportService.listTickets(request.currentUser!.id, parsed.data.page, parsed.data.limit);
    return sendOk(reply, { items, total, page: parsed.data.page, limit: parsed.data.limit });
  });

  app.post(
    '/api/v1/support/tickets',
    { preHandler: requireAuth, ...publishLimiter.config },
    async (request, reply) => {
      const parsed = z
        .object({
          subject: z.string().min(3).max(190),
          category: z.string().min(2).max(40).default('GENERAL'),
          body: z.string().min(10).max(5000),
        })
        .safeParse(request.body);
      if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());

      const category = (SUPPORT_CATEGORIES as readonly string[]).includes(parsed.data.category.toUpperCase())
        ? parsed.data.category.toUpperCase()
        : 'GENERAL';

      const ticket = await SupportService.createTicket(request.currentUser!.id, {
        subject: parsed.data.subject,
        category,
        body: parsed.data.body,
      });
      return sendCreated(reply, { ticket });
    },
  );

  app.get('/api/v1/support/tickets/:id', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z.object({ id: z.coerce.number().int().min(1) }).safeParse(request.params);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const thread = await SupportService.getThread(request.currentUser!.id, parsed.data.id);
    return sendOk(reply, thread);
  });

  app.post(
    '/api/v1/support/tickets/:id/messages',
    { preHandler: requireAuth, ...publishLimiter.config },
    async (request, reply) => {
      const params = z.object({ id: z.coerce.number().int().min(1) }).safeParse(request.params);
      if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
      const parsed = z
        .object({ body: z.string().min(1).max(5000) })
        .safeParse(request.body);
      if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());

      const result = await SupportService.addMessage(
        {
          ticketId: params.data.id,
          senderUserId: request.currentUser!.id,
          isStaff: false,
          body: parsed.data.body,
        },
        request.currentUser!.id,
      );
      return sendCreated(reply, { ticket: result.ticket, message: result.message });
    },
  );
}

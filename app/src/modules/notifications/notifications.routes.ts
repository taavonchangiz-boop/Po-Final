/**
 * Notification routes: list (paginated, unread filter), mark read, read-all.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendOk } from '../../core/envelope.js';
import { validationError } from '../../core/errors.js';
import { requireAuth } from '../../security/session.js';
import { NotificationService } from './notifications.service.js';

export function registerNotificationRoutes(app: FastifyInstance): void {
  app.get('/api/v1/notifications', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        unread: z
          .enum(['true', 'false'])
          .default('false')
          .transform((v) => v === 'true'),
      })
      .safeParse(request.query);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());

    const result = await NotificationService.list(request.currentUser!.id, {
      page: parsed.data.page,
      limit: parsed.data.limit,
      unreadOnly: parsed.data.unread,
    });

    return sendOk(reply, {
      items: result.items,
      total: result.total,
      page: result.page,
      limit: result.limit,
      unreadCount: await NotificationService.unreadCount(request.currentUser!.id),
    });
  });

  app.post('/api/v1/notifications/:id/read', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z.object({ id: z.coerce.number().int().min(1) }).safeParse(request.params);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    await NotificationService.markRead(request.currentUser!.id, parsed.data.id);
    return sendOk(reply, { ok: true });
  });

  app.post('/api/v1/notifications/read-all', { preHandler: requireAuth }, async (request, reply) => {
    const updated = await NotificationService.markAllRead(request.currentUser!.id);
    return sendOk(reply, { ok: true, updated });
  });
}

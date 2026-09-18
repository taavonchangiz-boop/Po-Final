/**
 * Channel routes — list/create/detail/patch/verify/disable/delete per contract.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendOk } from '../../core/envelope.js';
import { requireUser } from '../../security/current-user.js';
import { requireAuth } from '../../security/session.js';
import { publishLimiter } from '../../security/rate-limit.js';
import {
  createChannel,
  disconnectChannel,
  disableChannel,
  getChannel,
  listChannels,
  updateChannel,
  verifyChannel,
} from './channels.service.js';

const providerSchema = z.enum(['TELEGRAM', 'BALE', 'RUBIKA']);
const channelStatusSchema = z.enum(['PENDING', 'ACTIVE', 'ERROR', 'DISCONNECTED']);

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  provider: providerSchema.optional(),
  status: channelStatusSchema.optional(),
});

const createSchema = z
  .object({
    provider: providerSchema,
    chatId: z.string().trim().min(1, 'شناسه کانال الزامی است.').max(64),
    title: z.string().trim().min(1, 'عنوان کانال الزامی است.').max(190),
    token: z.string().trim().min(10, 'توکن ربات معتبر نیست.').max(255),
  })
  .strict();

const updateSchema = z
  .object({
    title: z.string().trim().min(1, 'عنوان کانال الزامی است.').max(190).optional(),
    token: z.string().trim().min(10, 'توکن ربات معتبر نیست.').max(255).optional(),
  })
  .strict()
  .refine((d) => d.title !== undefined || d.token !== undefined, { message: 'داده‌ای برای بروزرسانی ارسال نشده است.' });

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export async function registerChannelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/channels', { preHandler: requireAuth, ...publishLimiter }, async (request, reply) => {
    const user = requireUser(request);
    const query = listQuerySchema.parse(request.query);
    const result = await listChannels(user.id, {
      page: query.page,
      limit: query.limit,
      provider: query.provider,
      status: query.status,
    });
    return sendOk(reply, result);
  });

  app.post('/api/v1/channels', { preHandler: requireAuth, ...publishLimiter }, async (request, reply) => {
    const user = requireUser(request);
    const input = createSchema.parse(request.body);
    const row = await createChannel(user.id, { provider: input.provider, chatId: input.chatId, title: input.title, token: input.token });
    return sendOk(reply, {
      id: row.id,
      provider: row.provider,
      chatId: row.chatId,
      title: row.title,
      status: row.status,
      hasToken: true,
      message: 'کانال ثبت شد. برای فعال‌سازی، احراز کانال را انجام دهید.',
    });
  });

  app.get('/api/v1/channels/:id', { preHandler: requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const params = idParamSchema.parse(request.params);
    const channel = await getChannel(user.id, params.id);
    return sendOk(reply, { channel });
  });

  app.patch('/api/v1/channels/:id', { preHandler: requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const params = idParamSchema.parse(request.params);
    const input = updateSchema.parse(request.body);
    const row = await updateChannel(user.id, params.id, { title: input.title, token: input.token });
    return sendOk(reply, {
      id: row.id,
      title: row.title,
      status: row.status,
      hasToken: true,
      message: input.token !== undefined ? 'توکن بروزرسانی شد؛ وضعیت کانال تا احراز مجدد «در انتظار» است.' : 'کانال بروزرسانی شد.',
    });
  });

  app.delete('/api/v1/channels/:id', { preHandler: requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const params = idParamSchema.parse(request.params);
    await disconnectChannel(user.id, params.id);
    return sendOk(reply, { ok: true, message: 'کانال قطع شد.' });
  });

  app.post('/api/v1/channels/:id/verify', { preHandler: requireAuth, ...publishLimiter }, async (request, reply) => {
    const user = requireUser(request);
    const params = idParamSchema.parse(request.params);
    const result = await verifyChannel(user.id, params.id);
    if (result.status === 'ACTIVE') {
      return sendOk(reply, { status: result.status, username: result.username ?? null, title: result.title ?? null });
    }
    return sendOk(reply, { status: result.status, error: result.error ?? null });
  });

  app.post('/api/v1/channels/:id/disable', { preHandler: requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const params = idParamSchema.parse(request.params);
    await disableChannel(user.id, params.id);
    return sendOk(reply, { ok: true, message: 'کانال غیرفعال شد.' });
  });
}

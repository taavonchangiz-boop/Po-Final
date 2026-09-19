/**
 * Publishing routes: posts, deliveries, schedules (contract §Posts & deliveries
 * and §Schedules). All authenticated; publishLimiter on mutations.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendOk } from '../../core/envelope.js';
import { requireUser } from '../../security/current-user.js';
import { requireAuth } from '../../security/session.js';
import { publishLimiter } from '../../security/rate-limit.js';
import {
  cancelPost,
  cancelSchedule,
  createPost,
  getPostDetail,
  listDeliveries,
  listPosts,
  listSchedules,
  publishNow,
  retryDelivery,
  updatePost,
  updateSchedule,
} from './publishing.service.js';

const postStatusSchema = z.enum(['DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIAL', 'FAILED', 'CANCELLED']);
const recurrenceSchema = z.enum(['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY']);

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

const createPostSchema = z
  .object({
    title: z.string().trim().max(190).optional(),
    body: z.string().trim().min(1, 'متن پست الزامی است.').max(4_000, 'متن پست نمی‌تواند بیش از ۴۰۰۰ کاراکتر باشد (محدودیت سرویس‌دهنده‌ها).'),
    mediaId: z.coerce.number().int().positive().optional(),
    channelIds: z.array(z.coerce.number().int().positive()).max(200).default([]),
    scheduleAt: z.string().datetime({ offset: true }).optional(),
    recurrence: recurrenceSchema.optional(),
  })
  .strict();

const updatePostSchema = z
  .object({
    title: z.string().trim().max(190).nullable().optional(),
    body: z.string().trim().min(1, 'متن پست الزامی است.').max(4_000, 'متن پست نمی‌تواند بیش از ۴۰۰۰ کاراکتر باشد (محدودیت سرویس‌دهنده‌ها).').optional(),
    mediaId: z.coerce.number().int().positive().nullable().optional(),
    scheduleAt: z.string().datetime({ offset: true }).nullable().optional(),
    recurrence: recurrenceSchema.optional(),
  })
  .strict()
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'داده‌ای برای بروزرسانی ارسال نشده است.' });

const publishNowSchema = z
  .object({
    channelIds: z.array(z.coerce.number().int().positive()).max(200).optional(),
  })
  .strict();

const deliveriesQuerySchema = paginationSchema.extend({
  postId: z.coerce.number().int().positive().optional(),
});

const updateScheduleSchema = z
  .object({
    runAt: z.string().datetime({ offset: true }).optional(),
    recurrence: recurrenceSchema.optional(),
    status: z.enum(['ACTIVE', 'PAUSED']).optional(),
  })
  .strict()
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'داده‌ای برای بروزرسانی ارسال نشده است.' });

export async function registerPublishingRoutes(app: FastifyInstance): Promise<void> {
  /* --------------------------------- posts -------------------------------- */

  app.post('/api/v1/posts', { preHandler: requireAuth, ...publishLimiter }, async (request, reply) => {
    const user = requireUser(request);
    const input = createPostSchema.parse(request.body);
    const result = await createPost(user.id, {
      title: input.title,
      body: input.body,
      mediaId: input.mediaId,
      channelIds: input.channelIds,
      scheduleAt: input.scheduleAt !== undefined ? new Date(input.scheduleAt) : undefined,
      recurrence: input.recurrence,
    });
    return sendOk(
      reply,
      {
        postId: result.postId,
        status: result.status,
        deliveries: result.deliveryIds.length,
        scheduled: result.scheduled,
      },
      201,
    );
  });

  app.get('/api/v1/posts', { preHandler: requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const query = paginationSchema.extend({ q: z.string().max(190).optional(), status: postStatusSchema.optional() }).parse(request.query);
    const result = await listPosts(user.id, { page: query.page, limit: query.limit, q: query.q, status: query.status });
    return sendOk(reply, result);
  });

  app.get('/api/v1/posts/:id', { preHandler: requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const params = idParamSchema.parse(request.params);
    const detail = await getPostDetail(user.id, params.id);
    return sendOk(reply, detail);
  });

  app.patch('/api/v1/posts/:id', { preHandler: requireAuth, ...publishLimiter }, async (request, reply) => {
    const user = requireUser(request);
    const params = idParamSchema.parse(request.params);
    const input = updatePostSchema.parse(request.body);
    const post = await updatePost(user.id, params.id, {
      title: input.title,
      body: input.body,
      mediaId: input.mediaId,
      scheduleAt: input.scheduleAt === undefined ? undefined : input.scheduleAt === null ? null : new Date(input.scheduleAt),
      recurrence: input.recurrence,
    });
    return sendOk(reply, {
      id: post.id,
      status: post.status,
      message: post.status === 'SCHEDULED' ? 'پست بروزرسانی و زمان‌بندی شد.' : 'پست بروزرسانی شد.',
    });
  });

  app.delete('/api/v1/posts/:id', { preHandler: requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const params = idParamSchema.parse(request.params);
    await cancelPost(user.id, params.id);
    return sendOk(reply, { ok: true, message: 'پست لغو شد.' });
  });

  app.post('/api/v1/posts/:id/publish-now', { preHandler: requireAuth, ...publishLimiter }, async (request, reply) => {
    const user = requireUser(request);
    const params = idParamSchema.parse(request.params);
    const body = publishNowSchema.safeParse(request.body ?? {});
    const channelIds = body.success ? body.data.channelIds : undefined;
    const result = await publishNow(user.id, params.id, channelIds);
    return sendOk(reply, result);
  });

  /* ------------------------------- deliveries ------------------------------ */

  app.get('/api/v1/deliveries', { preHandler: requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const query = deliveriesQuerySchema.parse(request.query);
    const result = await listDeliveries(user.id, { postId: query.postId, page: query.page, limit: query.limit });
    return sendOk(reply, result);
  });

  app.post('/api/v1/deliveries/:id/retry', { preHandler: requireAuth, ...publishLimiter }, async (request, reply) => {
    const user = requireUser(request);
    const params = idParamSchema.parse(request.params);
    const result = await retryDelivery(user.id, params.id);
    return sendOk(reply, result);
  });

  /* -------------------------------- schedules ------------------------------ */

  app.get('/api/v1/schedules', { preHandler: requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const query = paginationSchema.parse(request.query);
    const result = await listSchedules(user.id, { page: query.page, limit: query.limit });
    return sendOk(reply, result);
  });

  app.patch('/api/v1/schedules/:id', { preHandler: requireAuth, ...publishLimiter }, async (request, reply) => {
    const user = requireUser(request);
    const params = idParamSchema.parse(request.params);
    const input = updateScheduleSchema.parse(request.body);
    const result = await updateSchedule(user.id, params.id, {
      runAt: input.runAt !== undefined ? new Date(input.runAt) : undefined,
      recurrence: input.recurrence,
      status: input.status,
    });
    return sendOk(reply, result);
  });

  app.delete('/api/v1/schedules/:id', { preHandler: requireAuth }, async (request, reply) => {
    const user = requireUser(request);
    const params = idParamSchema.parse(request.params);
    await cancelSchedule(user.id, params.id);
    return sendOk(reply, { ok: true, message: 'زمان‌بندی لغو شد.' });
  });
}

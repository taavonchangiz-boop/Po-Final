import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import { parseWith } from '../../core/validation.js';
import {
  createPost, publishNow, schedulePost, listPosts, getPost, cancelPost, retryTarget,
  ActorMeta, PostState,
} from './post.service.js';

function actor(req: { user?: { id: string; role: string }; ip?: string }): ActorMeta & { tenantId: string } {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { tenantId: req.user.id, actorId: req.user.id, actorRole: req.user.role, ip: req.ip };
}

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

const buttonsSchema = z.object({
  inline: z
    .array(
      z.object({
        label: z.string().min(1).max(64),
        url: z.string().url().max(255).optional(),
        callback: z.string().max(64).optional(),
      })
    )
    .max(8)
    .optional(),
  links: z
    .array(z.object({ label: z.string().min(1).max(64), url: z.string().url().max(255) }))
    .max(8)
    .optional(),
});

const createPostSchema = z.object({
  title: z.string().max(190).optional(),
  body: z.string().min(1).max(4000),
  parseMode: z.enum(['NONE', 'HTML', 'MARKDOWN']).optional(),
  mediaId: z.string().min(10).max(26).optional(),
  buttons: buttonsSchema.optional(),
});

const publishSchema = z.object({ channelIds: z.array(z.string().min(10).max(26)).min(1).max(20) });

const scheduleSchema = publishSchema.extend({
  scheduledAt: z.coerce.date(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  state: z
    .enum(['DRAFT', 'SCHEDULED', 'QUEUED', 'PUBLISHING', 'PUBLISHED', 'PARTIAL', 'FAILED', 'CANCELLED'])
    .optional(),
  search: z.string().max(100).optional(),
});

export async function registerPostRoutes(app: FastifyInstance): Promise<void> {
  app.post('/posts', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const input = parse(createPostSchema, req.body);
    const post = await createPost(tenantId, input, meta);
    return { success: true, data: { post } };
  });

  app.post('/posts/:id/publish', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const { id } = req.params as { id: string };
    const input = parse(publishSchema, req.body);
    const post = await publishNow(tenantId, id, input.channelIds, meta);
    return { success: true, data: { post } };
  });

  app.post('/posts/:id/schedule', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const { id } = req.params as { id: string };
    const input = parse(scheduleSchema, req.body);
    const post = await schedulePost(tenantId, id, input.channelIds, input.scheduledAt, meta);
    return { success: true, data: { post } };
  });

  app.get('/posts', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId } = actor(req);
    const query = parse(listQuerySchema, req.query);
    const result = await listPosts(tenantId, {
      page: query.page,
      pageSize: query.pageSize,
      state: query.state as PostState | undefined,
      search: query.search,
    });
    return { success: true, data: result };
  });

  app.get('/posts/:id', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId } = actor(req);
    const { id } = req.params as { id: string };
    const result = await getPost(tenantId, id);
    return { success: true, data: result };
  });

  app.post('/posts/:id/cancel', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const { id } = req.params as { id: string };
    const post = await cancelPost(tenantId, id, meta);
    return { success: true, data: { post } };
  });

  app.post('/posts/targets/:targetId/retry', { preHandler: [app.requireAuth] }, async (req) => {
    const { tenantId, ...meta } = actor(req);
    const { targetId } = req.params as { targetId: string };
    const result = await retryTarget(tenantId, targetId, meta);
    return { success: true, data: result };
  });
}

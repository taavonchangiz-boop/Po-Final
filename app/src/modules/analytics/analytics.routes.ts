/**
 * Analytics routes: overview KPIs, publishing series, per-domain reports and
 * the raw activity timeline (cursor-paginated; the frontend translates event
 * types to Persian).
 */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { sendOk } from '../../core/envelope.js';
import { validationError } from '../../core/errors.js';
import { db } from '../../db/client.js';
import { events } from '../../db/schema.js';
import { requireAuth } from '../../security/session.js';
import { AnalyticsReadService } from './analytics.service.js';

const DaysSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
});

export function registerAnalyticsRoutes(app: FastifyInstance): void {
  app.get('/api/v1/analytics/overview', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = DaysSchema.safeParse(request.query);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const overview = await AnalyticsReadService.overview(request.currentUser!.id, parsed.data.days);
    return sendOk(reply, overview);
  });

  app.get('/api/v1/analytics/publishing', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = DaysSchema.extend({ days: z.coerce.number().int().min(1).max(90).default(30) }).safeParse(request.query);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const series = await AnalyticsReadService.publishingSeries(request.currentUser!.id, parsed.data.days);
    return sendOk(reply, { series });
  });

  app.get('/api/v1/analytics/channels', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = DaysSchema.safeParse(request.query);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const since = new Date(Date.now() - (parsed.data.days - 1) * 86_400_000).toISOString().slice(0, 10);
    const channels = await AnalyticsReadService.channelReport(request.currentUser!.id, since);
    return sendOk(reply, { items: channels });
  });

  app.get('/api/v1/analytics/bots', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = DaysSchema.safeParse(request.query);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const since = new Date(Date.now() - (parsed.data.days - 1) * 86_400_000).toISOString().slice(0, 10);
    const botsReport = await AnalyticsReadService.botReport(request.currentUser!.id, since);
    return sendOk(reply, { items: botsReport });
  });

  app.get('/api/v1/analytics/ai', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = DaysSchema.extend({ days: z.coerce.number().int().min(1).max(90).default(30) }).safeParse(request.query);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const series = await AnalyticsReadService.aiSeries(request.currentUser!.id, parsed.data.days);
    return sendOk(reply, { series });
  });

  /** Raw activity timeline: cursor pagination (id < cursor), newest first. */
  app.get('/api/v1/analytics/timeline', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z
      .object({
        cursor: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .safeParse(request.query);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());

    const where =
      parsed.data.cursor !== undefined
        ? and(eq(events.userId, request.currentUser!.id), lt(events.id, parsed.data.cursor))
        : eq(events.userId, request.currentUser!.id);

    const rows = await db
      .select({
        id: events.id,
        type: events.type,
        subjectType: events.subjectType,
        subjectId: events.subjectId,
        data: events.data,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(where)
      .orderBy(desc(events.id))
      .limit(parsed.data.limit + 1);

    const hasMore = rows.length > parsed.data.limit;
    const items = hasMore ? rows.slice(0, parsed.data.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    return sendOk(reply, { items, nextCursor });
  });
}

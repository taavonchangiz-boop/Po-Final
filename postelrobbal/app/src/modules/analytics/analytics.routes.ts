import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import {
  aiUsageMonthly, bots, channels, events, eventDaily, posts, postTargets, walletAccounts,
} from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';

/**
 * Tenant analytics (§99): counts + read models. Everything is tenant-scoped;
 * the events timeline is cursor-paginated on the ULID id (lexicographic order
 * equals chronological order, so `id < cursor` pages stably).
 */

function requireTenant(req: { user?: { id: string } }): string {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return req.user.id;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const eventsQuerySchema = z.object({
  cursor: z.string().min(10).max(26).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const dailyQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(60).default(14),
});

export async function registerAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/analytics/overview', { preHandler: [app.requireAuth] }, async (req) => {
    const tenantId = requireTenant(req);
    const db = getDb();
    const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const periodYm = new Date().toISOString().slice(0, 7);

    const [channelRows, botRows, postRows, sentRows, failedRows, walletRows, aiRows] = await Promise.all([
      db.select({ status: channels.status, count: sql<number>`count(*)` }).from(channels).where(eq(channels.tenantId, tenantId)).groupBy(channels.status),
      db.select({ status: bots.status, count: sql<number>`count(*)` }).from(bots).where(eq(bots.tenantId, tenantId)).groupBy(bots.status),
      db.select({ state: posts.state, count: sql<number>`count(*)` }).from(posts).where(eq(posts.tenantId, tenantId)).groupBy(posts.state),
      db.select({ count: sql<number>`count(*)` }).from(postTargets).where(and(eq(postTargets.tenantId, tenantId), eq(postTargets.state, 'SENT'), gte(postTargets.sentAt, since30d))),
      db.select({ count: sql<number>`count(*)` }).from(postTargets).where(and(eq(postTargets.tenantId, tenantId), eq(postTargets.state, 'FAILED'), gte(postTargets.updatedAt, since30d))),
      db.select({ balanceRial: walletAccounts.balanceRial }).from(walletAccounts).where(eq(walletAccounts.tenantId, tenantId)).limit(1),
      db.select({ requestCount: aiUsageMonthly.requestCount, tokenCount: aiUsageMonthly.tokenCount }).from(aiUsageMonthly).where(and(eq(aiUsageMonthly.tenantId, tenantId), eq(aiUsageMonthly.periodYm, periodYm))).limit(1),
    ]);

    const countBy = (rows: Array<{ status?: string; state?: string; count: unknown }>, key: string, value: string): number =>
      rows.filter((r) => (r.status ?? r.state) === value).reduce((acc, r) => acc + num(r.count), 0);

    return {
      success: true,
      data: {
        channels: {
          total: channelRows.reduce((acc, r) => acc + num(r.count), 0),
          active: countBy(channelRows, 'status', 'ACTIVE'),
        },
        bots: {
          total: botRows.reduce((acc, r) => acc + num(r.count), 0),
          active: countBy(botRows, 'status', 'ACTIVE'),
        },
        posts: {
          total: postRows.reduce((acc, r) => acc + num(r.count), 0),
          published: countBy(postRows, 'state', 'PUBLISHED') + countBy(postRows, 'state', 'PARTIAL'),
        },
        deliveries: {
          sent30d: num(sentRows[0]?.count),
          failed30d: num(failedRows[0]?.count),
        },
        wallet: {
          balanceRial: num(walletRows[0]?.balanceRial ?? 0),
        },
        ai: {
          periodYm,
          requestCount: num(aiRows[0]?.requestCount ?? 0),
          tokenCount: num(aiRows[0]?.tokenCount ?? 0),
        },
      },
    };
  });

  app.get('/analytics/events', { preHandler: [app.requireAuth] }, async (req) => {
    const tenantId = requireTenant(req);
    const query = (req.query ?? {}) as Record<string, unknown>;
    const parsed = eventsQuerySchema.safeParse(query);
    if (!parsed.success) throw new AppError(ERR.VALIDATION('پارامترهای صفحه‌بندی معتبر نیست.'));

    const db = getDb();
    const conditions = [eq(events.tenantId, tenantId)];
    if (parsed.data.cursor) conditions.push(lt(events.id, parsed.data.cursor));
    const rows = await db
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(sql`${events.id} DESC`)
      .limit(parsed.data.limit);

    return {
      success: true,
      data: {
        events: rows.map((e) => ({
          id: e.id,
          name: e.name,
          subjectType: e.subjectType,
          subjectId: e.subjectId,
          props: e.propsJson,
          createdAt: e.createdAt,
        })),
        nextCursor: rows.length === parsed.data.limit ? (rows[rows.length - 1]?.id ?? null) : null,
      },
    };
  });

  app.get('/analytics/daily', { preHandler: [app.requireAuth] }, async (req) => {
    const tenantId = requireTenant(req);
    const query = (req.query ?? {}) as Record<string, unknown>;
    const parsed = dailyQuerySchema.safeParse(query);
    if (!parsed.success) throw new AppError(ERR.VALIDATION('پارامتر بازهٔ زمانی معتبر نیست.'));

    const db = getDb();
    const sinceMs = Date.now() - (parsed.data.days - 1) * 24 * 3600 * 1000;
    const sinceDay = new Date(sinceMs); // event_daily.day is a DATE column → Date in drizzle
    const rows = await db
      .select()
      .from(eventDaily)
      .where(and(eq(eventDaily.tenantId, tenantId), gte(eventDaily.day, sinceDay)))
      .orderBy(asc(eventDaily.day));

    return {
      success: true,
      data: {
        days: parsed.data.days,
        series: rows.map((r) => ({
          day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
          eventName: r.eventName,
          count: num(r.eventCount),
        })),
      },
    };
  });
}

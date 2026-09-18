/**
 * Analytics read service: KPIs and series from the daily_stats read model
 * (ADR-011 — dashboards never scan raw events) + bounded COUNT queries with
 * indexes for point-in-time card values.
 */
import { and, count, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { botEvents, bots, channels, dailyStats, deliveries, notifications } from '../../db/schema.js';
import { AiService } from '../ai/ai.service.js';

export type DailyStatRow = typeof dailyStats.$inferSelect;

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `daily_stats.statDate` is a MySQL DATE (drizzle mode 'date' → JS Date);
 * comparisons take UTC-midnight Date values built from ISO day strings. */
function dayStartUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** Inclusive date strings for the last `days` days (UTC, oldest first). */
function dayRange(days: number, now = new Date()): string[] {
  const today = utcDayStart(now);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(isoDay(new Date(today.getTime() - i * 86_400_000)));
  }
  return out;
}

export const AnalyticsReadService = {
  /**
   * KPI overview. `days` bounds the event-derived numbers (1..90).
   * AI credits are month-to-date (quota semantics).
   */
  async overview(userId: number, days: number): Promise<{
    postsSent: number;
    deliveryFailed: number;
    successRate: number | null;
    botMessages: number;
    aiCredits: { used: number; quota: number; month: string };
    activeChannels: number;
    unreadNotifications: number;
  }> {
    const since = isoDay(new Date(Date.now() - (days - 1) * 86_400_000));

    const [statRows, channelRows, unreadRows, aiUsage] = await Promise.all([
      db
        .select({ metric: dailyStats.metric, value: dailyStats.value })
        .from(dailyStats)
        .where(
          and(
            eq(dailyStats.userId, userId),
            gte(dailyStats.statDate, dayStartUtc(since)),
            sql`${dailyStats.metric} in ('delivery.sent', 'delivery.failed', 'bot.message.received', 'bot.message.sent')`,
          ),
        ),
      db
        .select({ value: count() })
        .from(channels)
        .where(and(eq(channels.userId, userId), eq(channels.status, 'ACTIVE'))),
      db
        .select({ value: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
      AiService.getUsage(userId),
    ]);

    let postsSent = 0;
    let deliveryFailed = 0;
    let botMessages = 0;
    for (const row of statRows) {
      const value = Number(row.value);
      if (row.metric === 'delivery.sent') postsSent += value;
      else if (row.metric === 'delivery.failed') deliveryFailed += value;
      else botMessages += value;
    }

    return {
      postsSent,
      deliveryFailed,
      successRate: postsSent + deliveryFailed > 0 ? postsSent / (postsSent + deliveryFailed) : null,
      botMessages,
      aiCredits: { used: aiUsage.used, quota: aiUsage.quota, month: aiUsage.month },
      activeChannels: Number(channelRows[0]?.value ?? 0),
      unreadNotifications: Number(unreadRows[0]?.value ?? 0),
    };
  },

  /** Daily series [{date, sent, failed}] for the publishing chart. */
  async publishingSeries(userId: number, days: number): Promise<Array<{ date: string; sent: number; failed: number }>> {
    const dates = dayRange(days);
    const rows = await db
      .select({ date: dailyStats.statDate, metric: dailyStats.metric, value: dailyStats.value })
      .from(dailyStats)
      .where(
        and(
          eq(dailyStats.userId, userId),
          gte(dailyStats.statDate, dayStartUtc(dates[0] ?? isoDay(new Date()))),
          lt(dailyStats.statDate, dayStartUtc(isoDay(new Date(Date.now() + 86_400_000)))),
          sql`${dailyStats.metric} in ('delivery.sent', 'delivery.failed')`,
        ),
      );

    const byDate = new Map<string, { sent: number; failed: number }>();
    for (const date of dates) byDate.set(date, { sent: 0, failed: 0 });
    for (const row of rows) {
      const bucket = byDate.get(isoDay(new Date(row.date)));
      if (bucket === undefined) continue;
      if (row.metric === 'delivery.sent') bucket.sent += Number(row.value);
      else if (row.metric === 'delivery.failed') bucket.failed += Number(row.value);
    }
    return dates.map((date) => ({ date, ...(byDate.get(date) ?? { sent: 0, failed: 0 }) }));
  },

  /** Per-channel delivery aggregates since `since` (YYYY-MM-DD). */
  async channelReport(userId: number, since: string): Promise<Array<{ channelId: number; title: string; sent: number; failed: number }>> {
    const rows = await db
      .select({
        channelId: dailyStats.subjectId,
        title: channels.title,
        metric: dailyStats.metric,
        value: dailyStats.value,
      })
      .from(dailyStats)
      .innerJoin(channels, eq(dailyStats.subjectId, channels.id))
      .where(
        and(
          eq(dailyStats.userId, userId),
          eq(dailyStats.subjectType, 'channel'),
          gte(dailyStats.statDate, dayStartUtc(since)),
          sql`${dailyStats.metric} in ('delivery.sent', 'delivery.failed')`,
        ),
      );

    const byChannel = new Map<number, { title: string; sent: number; failed: number }>();
    for (const row of rows) {
      if (row.channelId === null) continue;
      const bucket = byChannel.get(row.channelId) ?? { title: row.title ?? '', sent: 0, failed: 0 };
      if (row.metric === 'delivery.sent') bucket.sent += Number(row.value);
      else if (row.metric === 'delivery.failed') bucket.failed += Number(row.value);
      byChannel.set(row.channelId, bucket);
    }
    return Array.from(byChannel.entries()).map(([channelId, bucket]) => ({ channelId, ...bucket }));
  },

  /** Per-bot message aggregates since `since`. */
  async botReport(userId: number, since: string): Promise<Array<{ botId: number; received: number; sent: number }>> {
    const rows = await db
      .select({ botId: dailyStats.subjectId, metric: dailyStats.metric, value: dailyStats.value })
      .from(dailyStats)
      .where(
        and(
          eq(dailyStats.userId, userId),
          eq(dailyStats.subjectType, 'bot'),
          gte(dailyStats.statDate, dayStartUtc(since)),
          sql`${dailyStats.metric} in ('bot.message.received', 'bot.message.sent')`,
        ),
      );

    const byBot = new Map<number, { received: number; sent: number }>();
    for (const row of rows) {
      if (row.botId === null) continue;
      const bucket = byBot.get(row.botId) ?? { received: 0, sent: 0 };
      if (row.metric === 'bot.message.received') bucket.received += Number(row.value);
      else if (row.metric === 'bot.message.sent') bucket.sent += Number(row.value);
      byBot.set(row.botId, bucket);
    }
    return Array.from(byBot.entries()).map(([botId, bucket]) => ({ botId, ...bucket }));
  },

  /** AI credits per day (user-level rows written by stats.jobs). */
  async aiSeries(userId: number, days: number): Promise<Array<{ date: string; credits: number }>> {
    const dates = dayRange(days);
    const rows = await db
      .select({ date: dailyStats.statDate, value: dailyStats.value })
      .from(dailyStats)
      .where(
        and(
          eq(dailyStats.userId, userId),
          eq(dailyStats.metric, 'ai.credits'),
          eq(dailyStats.subjectType, 'user'),
          gte(dailyStats.statDate, dayStartUtc(dates[0] ?? isoDay(new Date()))),
        ),
      );
    const byDate = new Map<string, number>();
    for (const row of rows) byDate.set(isoDay(new Date(row.date)), Number(row.value));
    return dates.map((date) => ({ date, credits: byDate.get(date) ?? 0 }));
  },

  /** Fallback counters when daily_stats has not been refreshed yet. */
  async liveDeliveryCounts(userId: number, days: number): Promise<{ sent: number; failed: number }> {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await db
      .select({ state: deliveries.state, value: count() })
      .from(deliveries)
      .where(and(eq(deliveries.userId, userId), gte(deliveries.createdAt, since)))
      .groupBy(deliveries.state);
    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      if (row.state === 'SENT') sent = Number(row.value);
      if (row.state === 'FAILED') failed = Number(row.value);
    }
    return { sent, failed };
  },

  /** Raw bot event volume for the last `days` days (bounded COUNT, tenant-filtered). */
  async botEventCount(userId: number, days: number): Promise<number> {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await db
      .select({ value: count() })
      .from(botEvents)
      .innerJoin(bots, eq(botEvents.botId, bots.id))
      .where(and(eq(bots.userId, userId), gte(botEvents.createdAt, since)));
    return Number(rows[0]?.value ?? 0);
  },
};

/**
 * Daily-stats refresh job (scheduler-facing): aggregates yesterday + today
 * into daily_stats with ON DUPLICATE KEY UPDATE. Bounded — only the last two
 * UTC days, only indexed GROUP BY queries.
 *
 * Metrics (subject granularity): delivery.sent|failed (channel),
 * bot.message.received|sent (bot), link.clicked (user), ai.credits (user),
 * payment.completed (user).
 */
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { logger } from '../../core/logger.js';
import { db } from '../../db/client.js';
import { aiJobs, botEvents, bots, dailyStats, deliveries, events, linkTargets, payments } from '../../db/schema.js';

type MetricRow = {
  userId: number;
  /** statDate is a MySQL DATE column (drizzle mode 'date' → JS Date). */
  statDate: Date;
  metric: string;
  subjectType: string;
  subjectId: number | null;
  value: number;
};

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Two aggregation windows: yesterday (closed) and today (open-ended). */
function windows(now: Date): Array<{ start: Date; end: Date; statDate: Date }> {
  const todayStart = utcDayStart(now);
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  return [
    { start: yesterdayStart, end: todayStart, statDate: yesterdayStart },
    { start: todayStart, end: now, statDate: todayStart },
  ];
}

/**
 * `daily_stats` has a 5-column unique key (userId, statDate, metric,
 * subjectType, subjectId). MySQL cannot enforce uniqueness across NULL
 * columns, so all rows are written with a NON-NULL subjectType + subjectId:
 * user-level metrics use subjectType='user', subjectId=userId.
 */
async function upsertRows(rows: MetricRow[]): Promise<number> {
  const normalized = rows.map((row) => ({
    userId: row.userId,
    statDate: row.statDate,
    metric: row.metric.slice(0, 60),
    subjectType: (row.subjectId === null ? 'user' : row.subjectType).slice(0, 40),
    subjectId: row.subjectId === null ? row.userId : row.subjectId,
    value: row.value,
  }));
  if (normalized.length === 0) return 0;
  await db
    .insert(dailyStats)
    .values(normalized)
    .onDuplicateKeyUpdate({
      set: {
        value: sql`values(${dailyStats.value})`,
        updatedAt: new Date(),
      },
    });
  return normalized.length;
}

export const StatsJobs = {
  /** Aggregate the last two days into daily_stats. Returns rows written. */
  async refreshDailyStats(): Promise<number> {
    const now = new Date();
    let written = 0;

    try {
      /* ------------------------------ deliveries ------------------------------ */
      for (const window of windows(now)) {
        const sentRows = await db
          .select({ userId: deliveries.userId, channelId: deliveries.channelId, value: sql<string>`count(*)` })
          .from(deliveries)
          .where(and(eq(deliveries.state, 'SENT'), gte(deliveries.sentAt, window.start), lt(deliveries.sentAt, window.end)))
          .groupBy(deliveries.userId, deliveries.channelId);

        const failedRows = await db
          .select({ userId: deliveries.userId, channelId: deliveries.channelId, value: sql<string>`count(*)` })
          .from(deliveries)
          .where(and(eq(deliveries.state, 'FAILED'), gte(deliveries.updatedAt, window.start), lt(deliveries.updatedAt, window.end)))
          .groupBy(deliveries.userId, deliveries.channelId);

        written += await upsertRows([
          ...sentRows.map((row) => ({
            userId: row.userId,
            statDate: window.statDate,
            metric: 'delivery.sent',
            subjectType: 'channel',
            subjectId: row.channelId,
            value: Number(row.value),
          })),
          ...failedRows.map((row) => ({
            userId: row.userId,
            statDate: window.statDate,
            metric: 'delivery.failed',
            subjectType: 'channel',
            subjectId: row.channelId,
            value: Number(row.value),
          })),
        ]);
      }

      /* --------------------------- bot.message.received --------------------------- */
      for (const window of windows(now)) {
        const receivedRows = await db
          .select({ userId: bots.userId, botId: botEvents.botId, value: sql<string>`count(*)` })
          .from(botEvents)
          .innerJoin(bots, eq(botEvents.botId, bots.id))
          .where(and(gte(botEvents.createdAt, window.start), lt(botEvents.createdAt, window.end)))
          .groupBy(bots.userId, botEvents.botId);

        written += await upsertRows(
          receivedRows.map((row) => ({
            userId: row.userId,
            statDate: window.statDate,
            metric: 'bot.message.received',
            subjectType: 'bot',
            subjectId: row.botId,
            value: Number(row.value),
          })),
        );
      }

      /* ---------------------------- bot.message.sent ---------------------------- */
      for (const window of windows(now)) {
        const sentRows = await db
          .select({ userId: events.userId, botId: events.subjectId, value: sql<string>`count(*)` })
          .from(events)
          .where(and(eq(events.type, 'bot.message.sent'), gte(events.createdAt, window.start), lt(events.createdAt, window.end)))
          .groupBy(events.userId, events.subjectId);

        written += await upsertRows(
          sentRows
            .filter((row): row is { userId: number; botId: number; value: string } => row.userId !== null && row.botId !== null)
            .map((row) => ({
              userId: row.userId,
              statDate: window.statDate,
              metric: 'bot.message.sent',
              subjectType: 'bot',
              subjectId: row.botId,
              value: Number(row.value),
            })),
        );
      }

      /* ------------------------------ link.clicked ------------------------------ */
      for (const window of windows(now)) {
        const clickRows = await db
          .select({ userId: linkTargets.userId, value: sql<string>`coalesce(sum(${linkTargets.clickCount}), 0)` })
          .from(linkTargets)
          .where(and(gte(linkTargets.createdAt, window.start), lt(linkTargets.createdAt, window.end)))
          .groupBy(linkTargets.userId);

        written += await upsertRows(
          clickRows.map((row) => ({
            userId: row.userId,
            statDate: window.statDate,
            metric: 'link.clicked',
            subjectType: 'user',
            subjectId: row.userId,
            value: Number(row.value),
          })),
        );
      }

      /* -------------------------------- ai.credits -------------------------------- */
      for (const window of windows(now)) {
        const aiRows = await db
          .select({ userId: aiJobs.userId, value: sql<string>`coalesce(sum(${aiJobs.creditsUsed}), 0)` })
          .from(aiJobs)
          .where(and(eq(aiJobs.status, 'COMPLETED'), gte(aiJobs.createdAt, window.start), lt(aiJobs.createdAt, window.end)))
          .groupBy(aiJobs.userId);

        written += await upsertRows(
          aiRows.map((row) => ({
            userId: row.userId,
            statDate: window.statDate,
            metric: 'ai.credits',
            subjectType: 'user',
            subjectId: row.userId,
            value: Number(row.value),
          })),
        );
      }

      /* --------------------------- payment.completed --------------------------- */
      for (const window of windows(now)) {
        const paymentRows = await db
          .select({ userId: payments.userId, value: sql<string>`count(*)` })
          .from(payments)
          .where(and(eq(payments.status, 'VERIFIED'), gte(payments.verifiedAt, window.start), lt(payments.verifiedAt, window.end)))
          .groupBy(payments.userId);

        written += await upsertRows(
          paymentRows.map((row) => ({
            userId: row.userId,
            statDate: window.statDate,
            metric: 'payment.completed',
            subjectType: 'user',
            subjectId: row.userId,
            value: Number(row.value),
          })),
        );
      }
    } catch (err) {
      logger.error('daily_stats_refresh_failed', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }

    logger.info('daily_stats_refreshed', { rows: written });
    return written;
  },
};

/** Direct export for scheduler import symmetry. */
export const refreshDailyStats = StatsJobs.refreshDailyStats;

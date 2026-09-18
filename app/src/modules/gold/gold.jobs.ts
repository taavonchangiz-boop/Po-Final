/**
 * Gold scheduler tick (scheduler-facing): publishes due gold-price updates to
 * ENABLED, non-MANUAL configs whose channel is ACTIVE.
 *
 * DUE RULES (frequency + timeOfDay + lastSentAt):
 *  - HOURLY: never sent, or lastSentAt < now - 1h.
 *  - WEEKLY: never sent, or lastSentAt < now - 7d.
 *  - DAILY:  today's timeOfDay occurrence (in the config timezone) has passed
 *            AND lastSentAt is older than that occurrence. timeOfDay defaults
 *            to '09:00' when the config does not set one.
 *
 * IDEMPOTENCY: each publish claims `gold-auto:{configId}:{periodKey}` (scope
 * 'gold') where periodKey is `yyyy-mm-dd` — or `yyyy-mm-ddTHH` for HOURLY —
 * computed in the config timezone, so retries/replays within the period send
 * at most once (durable idempotency_keys row, 24h TTL).
 *
 * CHANGE DETECTION POLICY: the scheduled tick SKIPS configs whose latest
 * snapshot is identical to config.lastPriceSnapshot (no duplicated "nothing
 * changed" messages). Manual publish (gold.service.publishGoldNow) ignores
 * change detection — a user pressing "publish now" always gets a message.
 * If Redis enqueue fails, the snapshot/lastSentAt are NOT advanced, so the
 * next tick retries within the same period key.
 */
import { and, eq, ne } from 'drizzle-orm';
import { AnalyticsService } from '../../core/events.js';
import { withIdempotency } from '../../core/idempotency.js';
import { logger } from '../../core/logger.js';
import { db } from '../../db/client.js';
import { channels, goldConfigs } from '../../db/schema.js';
import { enqueue } from '../../queue/queues.js';
import {
  buildGoldText,
  listLatestPrices,
  pricesChangedSince,
  snapshotForConfig,
  zonedDayKey,
  zonedHour,
  zonedTimeToUtc,
  type GoldConfigRow,
} from './gold.service.js';

const MAX_CONFIGS_PER_TICK = 20;
/** Bounded scan window for due filtering (configs are tiny per deployment). */
const SCAN_LIMIT = 500;
const HOURLY_MS = 3_600_000;
const WEEKLY_MS = 7 * 24 * HOURLY_MS;
const DEFAULT_TIME_OF_DAY = '09:00';

function isDue(config: GoldConfigRow, now: Date): boolean {
  switch (config.frequency) {
    case 'HOURLY': {
      if (config.lastSentAt === null) return true;
      return config.lastSentAt.getTime() < now.getTime() - HOURLY_MS;
    }
    case 'WEEKLY': {
      if (config.lastSentAt === null) return true;
      return config.lastSentAt.getTime() < now.getTime() - WEEKLY_MS;
    }
    case 'DAILY': {
      const occurrence = zonedTimeToUtc(zonedDayKey(now, config.timezone), config.timeOfDay ?? DEFAULT_TIME_OF_DAY, config.timezone);
      const dueAt = occurrence.getTime();
      if (Number.isNaN(dueAt) || now.getTime() < dueAt) return false;
      if (config.lastSentAt === null) return true;
      return config.lastSentAt.getTime() < dueAt;
    }
    default:
      return false; // MANUAL configs are never scheduled
  }
}

function periodKeyFor(config: GoldConfigRow, now: Date): string {
  const day = zonedDayKey(now, config.timezone);
  if (config.frequency === 'HOURLY') {
    return `${day}T${String(zonedHour(now, config.timezone)).padStart(2, '0')}`;
  }
  return day;
}

/** Publish one due config; returns true when a send was actually enqueued. */
async function publishDueConfig(config: GoldConfigRow, now: Date): Promise<boolean> {
  const prices = await listLatestPrices(config.userId);
  const snapshot = snapshotForConfig(config, prices);
  if (Object.keys(snapshot).length === 0) return false; // nothing recorded yet
  if (!pricesChangedSince(config, snapshot)) return false; // unchanged → documented skip

  const text = buildGoldText(config, prices, now);
  const periodKey = periodKeyFor(config, now);

  const result = await withIdempotency<{ sent: boolean }>(
    `gold-auto:${config.id}:${periodKey}`,
    'gold',
    async () => {
      const enqueued = await enqueue('notifications', 'channel-send', { channelId: config.channelId, text });
      if (enqueued) {
        await db
          .update(goldConfigs)
          .set({ lastSentAt: now, lastPriceSnapshot: snapshot, updatedAt: new Date() })
          .where(eq(goldConfigs.id, config.id));
      }
      return { sent: enqueued };
    },
    86_400,
    config.userId,
  );

  if (result.value.sent && !result.replayed) {
    AnalyticsService.trackEvent({
      userId: config.userId,
      type: 'gold.publish.scheduled',
      subjectType: 'gold_config',
      subjectId: config.id,
      data: { channelId: config.channelId, frequency: config.frequency, periodKey },
    });
  }
  return result.value.sent;
}

/**
 * One scheduler pass. Returns the number of configs a message was enqueued for
 * (never throws to the caller — per-config failures are logged and skipped).
 */
export async function runGoldSchedulerTick(): Promise<number> {
  const now = new Date();
  const rows = await db
    .select({ config: goldConfigs, channelStatus: channels.status })
    .from(goldConfigs)
    .innerJoin(channels, eq(goldConfigs.channelId, channels.id))
    .where(and(eq(goldConfigs.isEnabled, true), ne(goldConfigs.frequency, 'MANUAL')))
    .orderBy(goldConfigs.id)
    .limit(SCAN_LIMIT);

  const due = rows
    .filter((row) => row.channelStatus === 'ACTIVE' && isDue(row.config, now))
    .slice(0, MAX_CONFIGS_PER_TICK);

  let published = 0;
  for (const { config } of due) {
    try {
      if (await publishDueConfig(config, now)) published += 1;
    } catch (err) {
      logger.warn('gold_scheduler_config_failed', {
        configId: config.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return published;
}

/**
 * Retention / housekeeping tick (GDPR-friendly bounded deletes):
 *  - events older than settings.retention_days.events
 *  - terminal deliveries (SENT/FAILED/CANCELLED) older than retention_days.deliveries
 *  - expired idempotency_keys + password_resets
 *  - DONE outbox events older than 7 days
 *  - bot_events older than 30 days
 *  - wp_events older than retention_days.logs
 * Every table is deleted in bounded batches (LIMIT 1000, max 10 rounds).
 */
import { and, eq, inArray, lt } from 'drizzle-orm';
import { logger } from './logger.js';
import { db } from '../db/client.js';
import { botEvents, deliveries, events, idempotencyKeys, outboxEvents, passwordResets, settings, wpEvents } from '../db/schema.js';

const BATCH_SIZE = 1000;
const MAX_ROUNDS = 10;
const OUTBOX_DONE_TTL_DAYS = 7;
const BOT_EVENTS_TTL_DAYS = 30;

interface RetentionDays {
  events: number;
  deliveries: number;
  logs: number;
}

const DEFAULT_RETENTION: RetentionDays = { events: 365, deliveries: 180, logs: 90 };

async function loadRetentionDays(): Promise<RetentionDays> {
  try {
    const rows = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, 'retention_days')).limit(1);
    const raw = rows[0]?.value as Partial<RetentionDays> | null | undefined;
    if (raw === null || raw === undefined || typeof raw !== 'object') return DEFAULT_RETENTION;
    return {
      events: typeof raw.events === 'number' && raw.events > 0 ? raw.events : DEFAULT_RETENTION.events,
      deliveries: typeof raw.deliveries === 'number' && raw.deliveries > 0 ? raw.deliveries : DEFAULT_RETENTION.deliveries,
      logs: typeof raw.logs === 'number' && raw.logs > 0 ? raw.logs : DEFAULT_RETENTION.logs,
    };
  } catch {
    return DEFAULT_RETENTION;
  }
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Bounded batched delete; returns the total number of removed rows. */
async function deleteBatched(run: () => Promise<number>): Promise<number> {
  let total = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let removed = 0;
    try {
      removed = await run();
    } catch (err) {
      logger.warn('retention_delete_failed', { round, error: err instanceof Error ? err.message : String(err) });
      break;
    }
    total += removed;
    if (removed < BATCH_SIZE) break;
  }
  return total;
}

async function rowsDeleted(result: unknown): Promise<number> {
  const header = Array.isArray(result) ? (result[0] as { affectedRows?: number } | undefined) : (result as { affectedRows?: number } | undefined);
  return header?.affectedRows ?? 0;
}

/** Process one retention pass; returns the total number of deleted rows. */
export async function runRetentionTick(): Promise<number> {
  const retention = await loadRetentionDays();
  let total = 0;

  // 1) analytics events
  total += await deleteBatched(async () =>
    rowsDeleted(await db.delete(events).where(lt(events.createdAt, daysAgo(retention.events))).limit(BATCH_SIZE)),
  );

  // 2) terminal deliveries only (active history is business data)
  total += await deleteBatched(async () =>
    rowsDeleted(
      await db
        .delete(deliveries)
        .where(and(lt(deliveries.createdAt, daysAgo(retention.deliveries)), inArray(deliveries.state, ['SENT', 'FAILED', 'CANCELLED'])))
        .limit(BATCH_SIZE),
    ),
  );

  // 3) expired idempotency keys
  total += await deleteBatched(async () =>
    rowsDeleted(await db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date())).limit(BATCH_SIZE)),
  );

  // 4) expired password resets
  total += await deleteBatched(async () =>
    rowsDeleted(await db.delete(passwordResets).where(lt(passwordResets.expiresAt, new Date())).limit(BATCH_SIZE)),
  );

  // 5) DONE outbox events older than 7 days
  total += await deleteBatched(async () =>
    rowsDeleted(
      await db
        .delete(outboxEvents)
        .where(and(eq(outboxEvents.status, 'DONE'), lt(outboxEvents.createdAt, daysAgo(OUTBOX_DONE_TTL_DAYS))))
        .limit(BATCH_SIZE),
    ),
  );

  // 6) bot events older than 30 days
  total += await deleteBatched(async () =>
    rowsDeleted(await db.delete(botEvents).where(lt(botEvents.createdAt, daysAgo(BOT_EVENTS_TTL_DAYS))).limit(BATCH_SIZE)),
  );

  // 7) wordpress events older than retention_days.logs
  total += await deleteBatched(async () =>
    rowsDeleted(await db.delete(wpEvents).where(lt(wpEvents.createdAt, daysAgo(retention.logs))).limit(BATCH_SIZE)),
  );

  logger.info('retention_tick_done', { deletedRows: total, retention });
  return total;
}

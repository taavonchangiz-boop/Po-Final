import { Job } from 'bullmq';
import { and, eq, lt, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { events, linkClicks, botEvents, mediaAccessTokens, idempotencyKeys, postTargets } from '../db/schema.js';
import { createWorker } from '../queue/connection.js';
import { createLogger } from '../core/logger.js';
import { sweepExpiredSessions } from '../security/sessions.js';

/**
 * Maintenance worker (§106-108): bounded retention sweeps. Every delete runs
 * in batches (LIMIT 1000) with a hard iteration cap so a large backlog can
 * never stall the worker or hold long table locks.
 */

const log = createLogger('maintenance-worker');

const BATCH = 1000;
const MAX_ITERATIONS = 20;
const RETENTION_DAYS_EVENTS = 180;
const RETENTION_DAYS_CLICKS = 180;
const RETENTION_DAYS_BOT_EVENTS = 90;

function affectedRowsOf(result: unknown): number {
  if (Array.isArray(result)) {
    const head = result[0] as { affectedRows?: number } | undefined;
    return typeof head?.affectedRows === 'number' ? head.affectedRows : 0;
  }
  const head = result as { affectedRows?: number } | undefined;
  return typeof head?.affectedRows === 'number' ? head.affectedRows : 0;
}

async function batchedDelete(table: typeof events | typeof linkClicks | typeof botEvents, where: SQL): Promise<number> {
  const db = getDb();
  let deleted = 0;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await db.delete(table).where(where).limit(BATCH);
    const affected = affectedRowsOf(res);
    deleted += affected;
    if (affected < BATCH) break;
  }
  return deleted;
}

export async function runRetentionSweep(): Promise<Record<string, number>> {
  const now = Date.now();
  const db = getDb();

  const eventsDeleted = await batchedDelete(events, lt(events.createdAt, new Date(now - RETENTION_DAYS_EVENTS * 86400_000)));
  const clicksDeleted = await batchedDelete(linkClicks, lt(linkClicks.createdAt, new Date(now - RETENTION_DAYS_CLICKS * 86400_000)));
  const botEventsDeleted = await batchedDelete(
    botEvents,
    sql`${botEvents.state} = 'PROCESSED' AND ${botEvents.createdAt} < ${new Date(now - RETENTION_DAYS_BOT_EVENTS * 86400_000)}`
  );

  // Expired transient rows: single bounded pass per sweep.
  await db.delete(mediaAccessTokens).where(lt(mediaAccessTokens.expiresAt, new Date()));
  await db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date()));
  await sweepExpiredSessions();

  // Reaper: delivery targets stuck in PROCESSING (crashed worker) return to
  // RETRYING with backoff so the scheduler re-claims them (§21, no lost sends).
  const stuckCutoff = new Date(now - 30 * 60_000);
  const reaped = await db
    .update(postTargets)
    .set({ state: 'RETRYING', nextRetryAt: new Date(now + 60_000) })
    .where(and(eq(postTargets.state, 'PROCESSING'), lt(postTargets.updatedAt, stuckCutoff)))
    .limit(100);

  return {
    events: eventsDeleted,
    linkClicks: clicksDeleted,
    botEvents: botEventsDeleted,
    stuckDeliveriesReaped: affectedRowsOf(reaped),
  };
}

export function startMaintenanceWorker() {
  // createWorker's processor parameter resolves to `never` due to a broken
  // conditional type in queue/connection.ts — bridge it without losing typing.
  const processor = async (job: Job): Promise<void> => {
    if (job.name !== 'sweep') {
      log.warn({ jobName: job.name }, 'unknown_maintenance_job');
      return;
    }
    const startedAt = Date.now();
    try {
      const result = await runRetentionSweep();
      log.info({ ...result, durationMs: Date.now() - startedAt }, 'maintenance_sweep_complete');
    } catch (err) {
      log.error({ err }, 'maintenance_sweep_failed');
      throw err; // BullMQ retry policy applies
    }
  };
  return createWorker('maintenance', processor as unknown as never, { concurrency: 1 });
}

/** Scheduler convenience: enqueue one sweep pass. */
export async function enqueueSweep(): Promise<void> {
  const { enqueue } = await import('../queue/queues.js');
  await enqueue('maintenance', 'sweep', {});
}

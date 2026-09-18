/**
 * Transactional outbox helpers (ADR-008): enqueue events atomically with
 * business state and claim due rows for the queue bridge (outbox pump).
 */
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '../db/client.js';
import { outboxEvents } from '../db/schema.js';
import { logger } from './logger.js';

export type OutboxEvent = typeof outboxEvents.$inferSelect;

export interface EnqueueOutboxInput {
  aggregateType: string;
  aggregateId: number;
  eventType: string;
  payload: Record<string, unknown>;
  availableAt?: Date;
}

/** Insert an outbox event within the caller's current transaction (or db). */
export async function enqueueOutbox(executor: DbExecutor, input: EnqueueOutboxInput): Promise<void> {
  await executor.insert(outboxEvents).values({
    aggregateType: input.aggregateType.slice(0, 40),
    aggregateId: input.aggregateId,
    eventType: input.eventType.slice(0, 60),
    payload: input.payload,
    availableAt: input.availableAt ?? new Date(),
  });
}

const UNSUPPORTED_SQL_CODES = new Set(['ER_PARSE_ERROR', 'ER_NOT_SUPPORTED_YET', 'ER_SP_DOES_NOT_EXIST', 'ER_UNKNOWN_ERROR']);

function isUnsupportedSkipLocked(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; message?: unknown };
  if (typeof e.code === 'string' && UNSUPPORTED_SQL_CODES.has(e.code)) return true;
  if (typeof e.message === 'string' && /SKIP LOCKED|syntax|not supported/i.test(e.message)) return true;
  return false;
}

async function claimWithSkipLocked(limit: number, now: Date): Promise<OutboxEvent[]> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.status, 'PENDING'), lte(outboxEvents.availableAt, now)))
      .orderBy(asc(outboxEvents.id))
      .limit(limit)
      .for('update', { skipLocked: true });
    if (rows.length === 0) return [];
    await tx
      .update(outboxEvents)
      .set({ status: 'PROCESSING', attempts: sql`${outboxEvents.attempts} + 1` })
      .where(
        inArray(
          outboxEvents.id,
          rows.map((r) => r.id),
        ),
      );
    return rows;
  });
}

/** Fallback for MariaDB < 10.6 (no SKIP LOCKED): atomic UPDATE ... LIMIT claim,
 * then read the claimed rows. Best-effort under concurrent claimers — with a
 * single outbox pump (the deployed topology) it is exact. */
async function claimFallback(limit: number, now: Date): Promise<OutboxEvent[]> {
  const due = await db
    .select({ id: outboxEvents.id })
    .from(outboxEvents)
    .where(and(eq(outboxEvents.status, 'PENDING'), lte(outboxEvents.availableAt, now)))
    .orderBy(asc(outboxEvents.id))
    .limit(limit);
  if (due.length === 0) return [];
  const ids = due.map((r) => r.id);
  // CAS-style claim: only rows still PENDING flip to PROCESSING.
  const claimed = await db
    .update(outboxEvents)
    .set({ status: 'PROCESSING', attempts: sql`${outboxEvents.attempts} + 1` })
    .where(and(inArray(outboxEvents.id, ids), eq(outboxEvents.status, 'PENDING')));
  if (claimed[0] === undefined || claimed[0].affectedRows === 0) return [];
  return db.select().from(outboxEvents).where(inArray(outboxEvents.id, ids));
}

/**
 * Claim up to `limit` due PENDING outbox rows and mark them PROCESSING.
 * Uses SELECT ... FOR UPDATE SKIP LOCKED where available, else a CAS fallback.
 */
export async function claimOutbox(limit: number): Promise<OutboxEvent[]> {
  const now = new Date();
  try {
    return await claimWithSkipLocked(limit, now);
  } catch (err) {
    if (isUnsupportedSkipLocked(err)) {
      logger.warn('outbox_skip_locked_unsupported', { hint: 'falling back to CAS claim (MariaDB < 10.6?)' });
      return claimFallback(limit, now);
    }
    throw err;
  }
}

/** Alias kept for scheduler/pump call sites. */
export const pollOutbox = claimOutbox;

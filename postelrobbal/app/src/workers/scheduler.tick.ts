import { and, eq, gt, lt, lte } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { goldConfigs, outboxEvents, postTargets, posts, subscriptions } from '../db/schema.js';
import { outboxRow } from '../core/outbox.js';
import { enqueue } from '../queue/queues.js';
import { emitEvent } from '../core/events.js';
import { createLogger } from '../core/logger.js';
import { createExpiryWarning } from '../modules/notifications/delivery.js';
import { runGoldCheck } from '../modules/gold/gold.service.js';

/**
 * Scheduler tick (§126-127): claim due work into queues, then exit. Every
 * section is bounded (LIMIT 100) and idempotent — state flips are guarded by
 * a WHERE clause so a re-run tick can never double-claim.
 */

const log = createLogger('scheduler-tick');
const SECTION_LIMIT = 100;

function affectedRowsOf(result: unknown): number {
  if (Array.isArray(result)) {
    const head = result[0] as { affectedRows?: number } | undefined;
    return typeof head?.affectedRows === 'number' ? head.affectedRows : 0;
  }
  const head = result as { affectedRows?: number } | undefined;
  return typeof head?.affectedRows === 'number' ? head.affectedRows : 0;
}

export interface SchedulerTickResult {
  scheduledPosts: number;
  retries: number;
  goldRuns: number;
  expiryChecks: number;
}

export async function runSchedulerTick(): Promise<SchedulerTickResult> {
  const db = getDb();
  const now = new Date();
  let scheduledPosts = 0;
  let retries = 0;
  let goldRuns = 0;
  let expiryChecks = 0;

  // 1) Due scheduled posts → QUEUED + outbox row (relayed to per-target jobs).
  const duePosts = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.state, 'SCHEDULED'), lte(posts.scheduledAt, now)))
    .limit(SECTION_LIMIT);
  for (const due of duePosts) {
    await db.transaction(async (tx) => {
      const flipped = await tx
        .update(posts)
        .set({ state: 'QUEUED' })
        .where(and(eq(posts.id, due.id), eq(posts.state, 'SCHEDULED')));
      if (affectedRowsOf(flipped) === 0) return false;
      await tx.insert(outboxEvents).values(
        outboxRow({ aggregateType: 'post', aggregateId: due.id, eventType: 'post.publish', payload: {} })
      );
      return true;
    }).then((claimed) => {
      if (claimed) scheduledPosts++;
    });
  }

  // 2) Due retries → PENDING + immediate delivery job.
  const dueRetries = await db
    .select({ id: postTargets.id })
    .from(postTargets)
    .where(and(eq(postTargets.state, 'RETRYING'), lte(postTargets.nextRetryAt, now)))
    .limit(SECTION_LIMIT);
  for (const target of dueRetries) {
    const claimed = await db
      .update(postTargets)
      .set({ state: 'PENDING' })
      .where(and(eq(postTargets.id, target.id), eq(postTargets.state, 'RETRYING')));
    if (affectedRowsOf(claimed) > 0) {
      await enqueue('delivery', 'deliver', { targetId: target.id });
      retries++;
    }
  }

  // 3) Gold ticker: enabled configs past their frequency window.
  const goldRows = await db.select().from(goldConfigs).where(eq(goldConfigs.isEnabled, 1)).limit(SECTION_LIMIT);
  for (const config of goldRows) {
    const due = !config.lastRunAt || now.getTime() - config.lastRunAt.getTime() >= config.frequencyMinutes * 60_000;
    if (!due) continue;
    try {
      const result = await runGoldCheck(config.id);
      if (result.ok) goldRuns++;
    } catch (err) {
      // Per-config isolation: one broken source must not starve other sections.
      log.warn({ err, configId: config.id }, 'gold_tick_failed');
    }
  }

  // 4a) Expiring subscriptions: T-7d warning, exactly-once via unique key.
  const warningHorizon = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const expiring = await db
    .select({ id: subscriptions.id, tenantId: subscriptions.tenantId, expiresAt: subscriptions.expiresAt })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.state, 'ACTIVE'),
        lte(subscriptions.expiresAt, warningHorizon),
        gt(subscriptions.expiresAt, now)
      )
    )
    .limit(SECTION_LIMIT);
  for (const subscription of expiring) {
    await createExpiryWarning({ id: subscription.id, tenantId: subscription.tenantId, expiresAt: subscription.expiresAt }).catch(
      () => undefined
    );
    expiryChecks++;
  }

  // 4b) Lapsed subscriptions → EXPIRED + event.
  const lapsed = await db
    .select({ id: subscriptions.id, tenantId: subscriptions.tenantId })
    .from(subscriptions)
    .where(and(eq(subscriptions.state, 'ACTIVE'), lt(subscriptions.expiresAt, now)))
    .limit(SECTION_LIMIT);
  for (const subscription of lapsed) {
    const expired = await db
      .update(subscriptions)
      .set({ state: 'EXPIRED' })
      .where(and(eq(subscriptions.id, subscription.id), eq(subscriptions.state, 'ACTIVE')));
    if (affectedRowsOf(expired) > 0) {
      await emitEvent({
        name: 'subscription.expired',
        tenantId: subscription.tenantId,
        subjectType: 'subscription',
        subjectId: subscription.id,
      });
      expiryChecks++;
    }
  }

  return { scheduledPosts, retries, goldRuns, expiryChecks };
}

/**
 * Schedule tick: claims due schedules (runAt <= now, ACTIVE) and dispatches
 * their post deliveries. Idempotent via the posts CAS transition
 * SCHEDULED -> PUBLISHING (affectedRows == 0 ⇒ already fired or not schedulable).
 * Recurrence: ONCE -> DONE; DAILY/WEEKLY/MONTHLY -> advance runAt/nextRunAt.
 */
import { and, asc, eq, inArray, lte, ne } from 'drizzle-orm';
import { AnalyticsService } from '../../core/events.js';
import { logger } from '../../core/logger.js';
import { db } from '../../db/client.js';
import { deliveries, posts, schedules } from '../../db/schema.js';
import { enqueue } from '../../queue/queues.js';
import { recalcPostStatus } from './publishing.service.js';

const BATCH_LIMIT = 50;

function advance(recurrence: 'DAILY' | 'WEEKLY' | 'MONTHLY', from: Date): Date {
  const next = new Date(from.getTime());
  if (recurrence === 'DAILY') next.setUTCDate(next.getUTCDate() + 1);
  if (recurrence === 'WEEKLY') next.setUTCDate(next.getUTCDate() + 7);
  if (recurrence === 'MONTHLY') next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

/** Process due schedules; returns the number of schedules fired. */
export async function runScheduleTick(): Promise<number> {
  const now = new Date();
  const due = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.status, 'ACTIVE'), lte(schedules.runAt, now)))
    .orderBy(asc(schedules.runAt))
    .limit(BATCH_LIMIT);

  let processed = 0;

  for (const schedule of due) {
    // Skip if the post is gone; cancel the schedule so it does not hot-loop.
    const postRows = await db.select({ id: posts.id, status: posts.status }).from(posts).where(eq(posts.id, schedule.postId)).limit(1);
    const post = postRows[0];
    if (post === undefined) {
      await db.update(schedules).set({ status: 'CANCELLED', updatedAt: now }).where(eq(schedules.id, schedule.id));
      continue;
    }
    if (post.status === 'CANCELLED') {
      await db.update(schedules).set({ status: 'CANCELLED', updatedAt: now }).where(eq(schedules.id, schedule.id));
      continue;
    }

    // Recurring: wait until the previous occurrence is quiescent (no in-flight
    // sends) before resetting deliveries for the next one — otherwise a
    // worker could double-send an update that is mid-flight.
    if (schedule.recurrence !== 'ONCE') {
      const inflight = await db
        .select({ id: deliveries.id })
        .from(deliveries)
        .where(and(eq(deliveries.postId, schedule.postId), eq(deliveries.state, 'PROCESSING')))
        .limit(1);
      if (inflight.length > 0) continue; // retry next tick
    }

    // Fire guard (idempotent, per-occurrence): optimistic CAS on the schedule
    // row itself — the exact runAt value acts as the occurrence token. Two
    // concurrent firings cannot both match the original runAt.
    const isOnce = schedule.recurrence === 'ONCE';
    const next = isOnce ? null : advance(schedule.recurrence as 'DAILY' | 'WEEKLY' | 'MONTHLY', schedule.runAt);
    const fired = await db
      .update(schedules)
      .set({
        status: isOnce ? 'DONE' : 'ACTIVE',
        lastRunAt: now,
        runAt: next ?? schedule.runAt,
        nextRunAt: next,
        updatedAt: now,
      })
      .where(and(eq(schedules.id, schedule.id), eq(schedules.status, 'ACTIVE'), eq(schedules.runAt, schedule.runAt)));
    if ((fired[0]?.affectedRows ?? 0) === 0) {
      continue; // already fired by another process
    }

    if (isOnce) {
      // Terminal flow: post CAS SCHEDULED -> PUBLISHING (historical guard).
      await db
        .update(posts)
        .set({ status: 'PUBLISHING', updatedAt: now })
        .where(and(eq(posts.id, schedule.postId), eq(posts.status, 'SCHEDULED')));
    } else {
      // Recurring (MAJOR-8 fix): give every non-cancelled delivery a fresh
      // occurrence — reset state/attempts/result fields, then enqueue.
      await db
        .update(deliveries)
        .set({
          state: 'PENDING',
          attempts: 0,
          nextAttemptAt: null,
          lastError: null,
          errorClass: null,
          providerMessageId: null,
          sentAt: null,
          updatedAt: now,
        })
        .where(and(eq(deliveries.postId, schedule.postId), ne(deliveries.state, 'CANCELLED')));
    }

    // Enqueue due PENDING deliveries for this post.
    const pending = await db
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(and(eq(deliveries.postId, schedule.postId), inArray(deliveries.state, ['PENDING', 'RETRYING'])));
    let enqueued = 0;
    for (const d of pending) {
      const ok = await enqueue('deliveries', 'send', { deliveryId: d.id });
      if (ok) enqueued++;
    }

    if (pending.length === 0) {
      // Nothing to send — settle the post status immediately.
      await recalcPostStatus(schedule.postId);
    }

    processed++;
    AnalyticsService.trackEvent({
      userId: schedule.userId,
      type: 'post.schedule_fired',
      subjectType: 'post',
      subjectId: schedule.postId,
      data: { scheduleId: schedule.id, recurrence: schedule.recurrence, enqueued },
    });
  }

  if (processed > 0) {
    logger.info('schedule_tick_processed', { processed });
  }
  return processed;
}

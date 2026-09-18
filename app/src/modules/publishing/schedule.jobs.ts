/**
 * Schedule tick: claims due schedules (runAt <= now, ACTIVE) and dispatches
 * their post deliveries. Idempotent via the posts CAS transition
 * SCHEDULED -> PUBLISHING (affectedRows == 0 ⇒ already fired or not schedulable).
 * Recurrence: ONCE -> DONE; DAILY/WEEKLY/MONTHLY -> advance runAt/nextRunAt.
 */
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
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
    // Skip if the post is not awaiting dispatch (already firing/cancelled/...).
    const postRows = await db.select({ id: posts.id, status: posts.status }).from(posts).where(eq(posts.id, schedule.postId)).limit(1);
    const post = postRows[0];
    if (post === undefined) {
      await db.update(schedules).set({ status: 'CANCELLED', updatedAt: now }).where(eq(schedules.id, schedule.id));
      continue;
    }

    // Idempotency guard: exactly-once firing via the post status transition.
    const claimed = await db
      .update(posts)
      .set({ status: 'PUBLISHING', updatedAt: now })
      .where(and(eq(posts.id, schedule.postId), eq(posts.status, 'SCHEDULED')));
    if ((claimed[0]?.affectedRows ?? 0) === 0) {
      // Post already moved on (previous tick claimed it, or was cancelled).
      // Finalize the schedule row so it does not hot-loop every minute.
      if (schedule.recurrence === 'ONCE') {
        await db.update(schedules).set({ status: 'DONE', lastRunAt: now, nextRunAt: null, updatedAt: now }).where(eq(schedules.id, schedule.id));
      } else {
        const next = advance(schedule.recurrence, schedule.runAt);
        await db.update(schedules).set({ lastRunAt: now, runAt: next, nextRunAt: next, updatedAt: now }).where(eq(schedules.id, schedule.id));
      }
      continue;
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

    // Advance/finalize the schedule row.
    if (schedule.recurrence === 'ONCE') {
      await db.update(schedules).set({ status: 'DONE', lastRunAt: now, nextRunAt: null, updatedAt: now }).where(eq(schedules.id, schedule.id));
    } else {
      const next = advance(schedule.recurrence, schedule.runAt);
      await db.update(schedules).set({ lastRunAt: now, runAt: next, nextRunAt: next, updatedAt: now }).where(eq(schedules.id, schedule.id));
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

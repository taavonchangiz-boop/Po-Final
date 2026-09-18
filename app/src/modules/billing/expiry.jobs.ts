/**
 * Expiry jobs (scheduler-facing):
 *  - flip past-due ACTIVE subscriptions to EXPIRED (+ event),
 *  - send the exactly-once 7-day expiry notice (durable idempotency key
 *    `expiry-7d:{subscriptionId}`) as an in-app notification + channel fan-out
 *    via the outbox (`notification.fanout`).
 * Bounded: processes at most 200 rows per tick.
 */
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { AnalyticsService } from '../../core/events.js';
import { withIdempotency } from '../../core/idempotency.js';
import { enqueueOutbox } from '../../core/outbox.js';
import { faJalaliDateLong } from '../../core/jalali.js';
import { logger } from '../../core/logger.js';
import { db } from '../../db/client.js';
import { plans, subscriptions } from '../../db/schema.js';
import { createNotification } from '../notifications/notifications.service.js';

const MAX_ROWS_PER_TICK = 200;
const TICKET_IDEMPOTENCY_SCOPE = 'expiry-notice';

export const ExpiryJobs = {
  /** Flip ACTIVE subs with expiresAt < now → EXPIRED. Returns count expired. */
  async expireDueSubscriptions(): Promise<number> {
    const now = new Date();
    const due = await db
      .select({ id: subscriptions.id, userId: subscriptions.userId })
      .from(subscriptions)
      .where(and(eq(subscriptions.status, 'ACTIVE'), lte(subscriptions.expiresAt, now)))
      .limit(MAX_ROWS_PER_TICK);
    if (due.length === 0) return 0;

    await db
      .update(subscriptions)
      .set({ status: 'EXPIRED', updatedAt: now })
      .where(
        inArray(
          subscriptions.id,
          due.map((row) => row.id),
        ),
      );

    for (const row of due) {
      AnalyticsService.trackEvent({
        userId: row.userId,
        type: 'subscription.expired',
        subjectType: 'subscription',
        subjectId: row.id,
        data: {},
      });
    }
    return due.length;
  },

  /** 7-day-before-expiry notices (exactly once per subscription). Returns count notified. */
  async runExpiryNoticeTick(): Promise<number> {
    const expiredCount = await ExpiryJobs.expireDueSubscriptions().catch((err: unknown) => {
      logger.error('expiry_expire_step_failed', { error: err instanceof Error ? err.message : String(err) });
      return 0;
    });

    const now = Date.now();
    const windowStart = new Date(now + 6 * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(now + 7 * 24 * 60 * 60 * 1000);

    const candidates = await db
      .select({
        id: subscriptions.id,
        userId: subscriptions.userId,
        expiresAt: subscriptions.expiresAt,
        planName: plans.name,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(and(eq(subscriptions.status, 'ACTIVE'), sql`${subscriptions.expiresAt} >= ${windowStart}`, sql`${subscriptions.expiresAt} <= ${windowEnd}`))
      .limit(MAX_ROWS_PER_TICK);

    let notified = 0;
    for (const sub of candidates) {
      try {
        const { replayed } = await withIdempotency(
          `expiry-7d:${sub.id}`,
          TICKET_IDEMPOTENCY_SCOPE,
          async () => {
            const title = 'اشتراک شما به‌زودی منقضی می‌شود';
            const body = `اشتراک «${sub.planName}» در تاریخ ${faJalaliDateLong(sub.expiresAt)} منقضی می‌شود. برای جلوگیری از اختلال در انتشار، به‌موقع تمدید کنید.`;
            const notificationId = await createNotification(db, {
              userId: sub.userId,
              category: 'SUBSCRIPTION',
              title,
              body,
              data: { subscriptionId: sub.id },
            });
            await enqueueOutbox(db, {
              aggregateType: 'notification',
              aggregateId: notificationId,
              eventType: 'notification.fanout',
              payload: { notificationId, userId: sub.userId, text: `${title} — ${body}` },
            });
            return { notificationId };
          },
          86_400 * 30,
          sub.userId,
        );
        if (!replayed) {
          notified += 1;
          AnalyticsService.trackEvent({
            userId: sub.userId,
            type: 'subscription.expiring',
            subjectType: 'subscription',
            subjectId: sub.id,
            data: { window: '7d' },
          });
        }
      } catch (err) {
        logger.warn('expiry_notice_failed', {
          subscriptionId: sub.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (expiredCount > 0 || notified > 0) {
      logger.info('expiry_tick_done', { expiredCount, notified });
    }
    return notified;
  },
};

/** Direct export for scheduler import symmetry with other jobs. */
export const runExpiryNoticeTick = ExpiryJobs.runExpiryNoticeTick;

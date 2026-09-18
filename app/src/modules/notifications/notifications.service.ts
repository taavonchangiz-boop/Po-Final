/**
 * Notification service: in-app notification rows + listing/read operations.
 * Channel fan-out happens via the outbox (`notification.fanout`) so the
 * worker delivers to the user's ACTIVE channels asynchronously.
 */
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.js';
import { db } from '../../db/client.js';
import { notifications } from '../../db/schema.js';
import { AnalyticsService } from '../../core/events.js';
import { notFound } from '../../core/errors.js';

export type NotificationRow = typeof notifications.$inferSelect;

export type NotificationCategory = 'SYSTEM' | 'BILLING' | 'PUBLISHING' | 'SECURITY' | 'SUBSCRIPTION';

export interface CreateNotificationInput {
  userId: number;
  category: NotificationCategory;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Insert a notification (works inside the caller's transaction) and track the event. */
export async function createNotification(executor: DbExecutor, input: CreateNotificationInput): Promise<number> {
  const inserted = await executor
    .insert(notifications)
    .values({
      userId: input.userId,
      category: input.category,
      title: input.title.slice(0, 190),
      body: input.body.slice(0, 5000),
      data: input.data ?? {},
    })
    .$returningId();
  const id = inserted[0]?.id;
  if (id === undefined) throw new Error('notification_insert_failed');
  AnalyticsService.trackEvent({
    userId: input.userId,
    type: 'notification.created',
    subjectType: 'notification',
    subjectId: Number(id),
    data: { category: input.category },
  });
  return Number(id);
}

export const NotificationService = {
  createNotification,

  async list(
    userId: number,
    opts: { page: number; limit: number; unreadOnly: boolean },
  ): Promise<{ items: NotificationRow[]; total: number; page: number; limit: number }> {
    const where = opts.unreadOnly
      ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
      : eq(notifications.userId, userId);

    const [items, totalRows] = await Promise.all([
      db
        .select()
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.id))
        .limit(opts.limit)
        .offset((opts.page - 1) * opts.limit),
      db.select({ value: count() }).from(notifications).where(where),
    ]);

    return { items, total: Number(totalRows[0]?.value ?? 0), page: opts.page, limit: opts.limit };
  },

  async unreadCount(userId: number): Promise<number> {
    const rows = await db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return Number(rows[0]?.value ?? 0);
  },

  /** Mark one notification read; ownership enforced (NOT_FOUND otherwise). */
  async markRead(userId: number, notificationId: number): Promise<void> {
    const now = new Date();
    const updated = await db
      .update(notifications)
      .set({ readAt: now })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId), isNull(notifications.readAt)));
    if ((updated[0]?.affectedRows ?? 0) === 0) {
      const exists = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
        .limit(1);
      if (exists.length === 0) throw notFound('اعلان یافت نشد.');
    }
  },

  async markAllRead(userId: number): Promise<number> {
    const updated = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return updated[0]?.affectedRows ?? 0;
  },

  /** Ascending page for thread-style consumers (kept for completeness). */
  async listAsc(userId: number, limit: number): Promise<NotificationRow[]> {
    return db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(asc(notifications.id))
      .limit(limit);
  },

  /** Newest-first raw query used by analytics/timeline joins if needed. */
  async latestForUser(userId: number, limit: number): Promise<NotificationRow[]> {
    return db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(sql`${notifications.id} desc`)
      .limit(limit);
  },
};

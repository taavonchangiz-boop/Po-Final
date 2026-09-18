/**
 * Publishing service: posts + deliveries + schedules (ADR-008).
 *
 * MEDIA VISIBILITY DECISION (v1): a post referencing PRIVATE media publishes
 * as TEXT-ONLY; PUBLIC media is delivered via sendPhoto using the permalink
 * `${APP_URL}/api/v1/media/{id}/content` (the media module's content route must
 * serve PUBLIC-visibility media without auth, PRIVATE requires the owner).
 * This is enforced in delivery.worker.ts, NOT at creation time — creation
 * stays permissive so users can fix visibility later without recreating posts.
 */
import { and, asc, count, desc, eq, gte, inArray, like, or, sql } from 'drizzle-orm';
import { enqueueOutbox } from '../../core/outbox.js';
import { withIdempotency } from '../../core/idempotency.js';
import { AnalyticsService } from '../../core/events.js';
import { conflict, internal, notFound, planLimit, validationError } from '../../core/errors.js';
import { db, withTransaction } from '../../db/client.js';
import { channels, deliveries, media, posts, schedules } from '../../db/schema.js';
import { enqueue } from '../../queue/queues.js';
import { assertOwnership } from '../../security/tenant.js';
import { getPlanLimitsForUser, listUsableChannels } from '../channels/channels.service.js';

export type PostRow = typeof posts.$inferSelect;
export type DeliveryRow = typeof deliveries.$inferSelect;
export type ScheduleRow = typeof schedules.$inferSelect;

export type PostStatus = PostRow['status'];
export type Recurrence = ScheduleRow['recurrence'];

/* ------------------------------- plan limits ------------------------------ */

async function countPostsThisMonth(userId: number): Promise<number> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const rows = await db.select({ value: count() }).from(posts).where(and(eq(posts.userId, userId), gte(posts.createdAt, monthStart)));
  return Number(rows[0]?.value ?? 0);
}

async function countActiveSchedules(userId: number): Promise<number> {
  const rows = await db.select({ value: count() }).from(schedules).where(and(eq(schedules.userId, userId), eq(schedules.status, 'ACTIVE')));
  return Number(rows[0]?.value ?? 0);
}

/* --------------------------------- create --------------------------------- */

export interface CreatePostInput {
  title?: string;
  body: string;
  mediaId?: number;
  channelIds: number[];
  scheduleAt?: Date;
  recurrence?: Recurrence;
}

export interface CreatePostResult {
  postId: number;
  status: PostStatus;
  deliveryIds: number[];
  scheduled: boolean;
}

/**
 * Create post + deliveries + outbox event in ONE transaction, then enqueue
 * per-delivery queue jobs AFTER the transaction commits (outbox pump is the
 * durable bridge when Redis is unavailable at that moment).
 */
export async function createPost(userId: number, input: CreatePostInput): Promise<CreatePostResult> {
  // --- plan limit: posts per calendar month --------------------------------
  const { limits } = await getPlanLimitsForUser(userId);
  const usedPosts = await countPostsThisMonth(userId);
  if (usedPosts >= limits.postsPerMonth) {
    throw planLimit('سقف ارسال ماهانه پلن شما پر شده است. پلن خود را ارتقا دهید.');
  }

  // --- channels: must exist, be owned and not disconnected -----------------
  const uniqueChannelIds = [...new Set(input.channelIds)];
  const channelRows = await listUsableChannels(userId, uniqueChannelIds);
  if (channelRows.length !== uniqueChannelIds.length) {
    throw validationError('یک یا چند کانال انتخاب‌شده معتبر نیست.');
  }
  for (const ch of channelRows) {
    if (ch.status === 'DISCONNECTED') {
      throw validationError('این کانال در دسترس نیست.');
    }
  }

  // --- media (optional): must exist and be owned ---------------------------
  if (input.mediaId !== undefined) {
    const mediaRows = await db.select({ id: media.id, userId: media.userId }).from(media).where(eq(media.id, input.mediaId)).limit(1);
    assertOwnership(mediaRows[0], userId);
  }

  const scheduled = input.scheduleAt !== undefined && input.scheduleAt.getTime() > Date.now();

  // --- plan limit: schedules ----------------------------------------------
  if (scheduled) {
    const activeSchedules = await countActiveSchedules(userId);
    if (activeSchedules >= limits.schedules) {
      throw planLimit('سقف زمان‌بندی‌های پلن شما پر شده است. پلن خود را ارتقا دهید.');
    }
  }

  const recurrence: Recurrence = input.recurrence ?? 'ONCE';
  const runAt = scheduled ? (input.scheduleAt as Date) : null;

  const deliveryIds: number[] = [];
  let postId = 0;

  await withTransaction(async (tx) => {
    const postRes = await tx
      .insert(posts)
      .values({
        userId,
        title: input.title?.trim() || null,
        body: input.body,
        mediaId: input.mediaId ?? null,
        status: scheduled ? 'SCHEDULED' : 'PUBLISHING',
      });
    postId = Number(postRes[0]?.insertId ?? 0);
    if (postId === 0) throw internal(new Error('post_insert_missing_id'));

    for (const ch of channelRows) {
      const dRes = await tx
        .insert(deliveries)
        .values({ postId, channelId: ch.id, userId, state: 'PENDING', maxAttempts: 5 });
      deliveryIds.push(Number(dRes[0]?.insertId ?? 0));
    }

    if (!scheduled) {
      // Outbox event drives the durable enqueue bridge (worker maintenance tick).
      await enqueueOutbox(tx, {
        aggregateType: 'post',
        aggregateId: postId,
        eventType: 'post.created',
        payload: { postId },
      });
    } else {
      await tx.insert(schedules).values({
        userId,
        postId,
        runAt: runAt as Date,
        recurrence,
        status: 'ACTIVE',
        nextRunAt: runAt,
      });
    }
  });

  AnalyticsService.trackEvent({
    userId,
    type: 'post.created',
    subjectType: 'post',
    subjectId: postId,
    data: { scheduled, channels: channelRows.length, hasMedia: input.mediaId !== undefined },
  });

  // AFTER the transaction: best-effort direct enqueue (outbox covers failures).
  if (!scheduled) {
    for (const deliveryId of deliveryIds) {
      if (deliveryId === 0) continue;
      await enqueue('deliveries', 'send', { deliveryId });
    }
  }

  return { postId, status: scheduled ? 'SCHEDULED' : 'PUBLISHING', deliveryIds, scheduled };
}

/* ---------------------------------- list ---------------------------------- */

export interface ListPostsParams {
  page: number;
  limit: number;
  q?: string;
  status?: PostStatus;
}

export async function listPosts(userId: number, params: ListPostsParams): Promise<{ items: PostRow[]; total: number; page: number; limit: number }> {
  const conditions = [eq(posts.userId, userId)];
  if (params.status !== undefined) conditions.push(eq(posts.status, params.status));
  if (params.q !== undefined && params.q.trim().length > 0) {
    const needle = `%${params.q.trim()}%`;
    const search = or(like(posts.title, needle), like(posts.body, needle));
    if (search !== undefined) conditions.push(search);
  }
  const where = and(...conditions);

  const offset = (params.page - 1) * params.limit;
  const items = await db.select().from(posts).where(where).orderBy(desc(posts.id)).limit(params.limit).offset(offset);
  const totalRows = await db.select({ value: count() }).from(posts).where(where);
  return { items, total: Number(totalRows[0]?.value ?? 0), page: params.page, limit: params.limit };
}

export async function getPostDetail(userId: number, postId: number): Promise<Record<string, unknown>> {
  const postRows = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  const post = assertOwnership(postRows[0], userId);

  const deliveryRows = await db
    .select({
      id: deliveries.id,
      state: deliveries.state,
      attempts: deliveries.attempts,
      maxAttempts: deliveries.maxAttempts,
      nextAttemptAt: deliveries.nextAttemptAt,
      lastError: deliveries.lastError,
      errorClass: deliveries.errorClass,
      providerMessageId: deliveries.providerMessageId,
      sentAt: deliveries.sentAt,
      channelId: channels.id,
      channelProvider: channels.provider,
      channelTitle: channels.title,
      channelChatId: channels.chatId,
    })
    .from(deliveries)
    .innerJoin(channels, eq(deliveries.channelId, channels.id))
    .where(eq(deliveries.postId, postId))
    .orderBy(asc(deliveries.id));

  return {
    post,
    deliveries: deliveryRows.map((d) => ({
      id: d.id,
      state: d.state,
      attempts: d.attempts,
      maxAttempts: d.maxAttempts,
      nextAttemptAt: d.nextAttemptAt,
      lastError: d.lastError,
      errorClass: d.errorClass,
      providerMessageId: d.providerMessageId,
      sentAt: d.sentAt,
      channel: { id: d.channelId, provider: d.channelProvider, title: d.channelTitle, chatId: d.channelChatId },
    })),
  };
}

/* --------------------------------- update --------------------------------- */

export interface UpdatePostInput {
  title?: string | null;
  body?: string;
  mediaId?: number | null;
  scheduleAt?: Date | null;
  recurrence?: Recurrence;
}

/** Edit while DRAFT/SCHEDULED only. */
export async function updatePost(userId: number, postId: number, input: UpdatePostInput): Promise<PostRow> {
  const postRows = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  const post = assertOwnership(postRows[0], userId);
  if (post.status !== 'DRAFT' && post.status !== 'SCHEDULED') {
    throw conflict('فقط پست‌های پیش‌نویس یا زمان‌بندی‌شده قابل ویرایش هستند.');
  }

  if (input.mediaId !== undefined && input.mediaId !== null) {
    const mediaRows = await db.select({ id: media.id, userId: media.userId }).from(media).where(eq(media.id, input.mediaId)).limit(1);
    assertOwnership(mediaRows[0], userId);
  }

  const nextScheduledAt = input.scheduleAt === undefined
    ? (post.status === 'SCHEDULED' ? (await getScheduleForPost(postId))?.runAt ?? null : null)
    : input.scheduleAt;

  await db
    .update(posts)
    .set({
      ...(input.title !== undefined ? { title: input.title === null ? null : input.title.trim() } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.mediaId !== undefined ? { mediaId: input.mediaId } : {}),
      ...(nextScheduledAt !== null ? { status: 'SCHEDULED' as const } : { status: 'DRAFT' as const }),
      updatedAt: new Date(),
    })
    .where(eq(posts.id, postId));

  // Keep the schedule row in sync (create / reschedule / cancel).
  const existingSchedule = await getScheduleForPost(postId);
  if (nextScheduledAt !== null) {
    const { limits } = await getPlanLimitsForUser(userId);
    if (existingSchedule === undefined) {
      const activeSchedules = await countActiveSchedules(userId);
      if (activeSchedules >= limits.schedules) {
        throw planLimit('سقف زمان‌بندی‌های پلن شما پر شده است. پلن خود را ارتقا دهید.');
      }
      await db.insert(schedules).values({
        userId,
        postId,
        runAt: nextScheduledAt,
        recurrence: input.recurrence ?? 'ONCE',
        status: 'ACTIVE',
        nextRunAt: nextScheduledAt,
      });
    } else {
      await db
        .update(schedules)
        .set({
          runAt: nextScheduledAt,
          nextRunAt: nextScheduledAt,
          ...(input.recurrence !== undefined ? { recurrence: input.recurrence } : {}),
          status: 'ACTIVE',
          updatedAt: new Date(),
        })
        .where(eq(schedules.id, existingSchedule.id));
    }
  } else if (existingSchedule !== undefined && existingSchedule.status === 'ACTIVE') {
    await db.update(schedules).set({ status: 'CANCELLED', updatedAt: new Date() }).where(eq(schedules.id, existingSchedule.id));
  }

  const fresh = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  const row = fresh[0];
  if (row === undefined) throw notFound();
  return row;
}

async function getScheduleForPost(postId: number): Promise<ScheduleRow | undefined> {
  const rows = await db.select().from(schedules).where(eq(schedules.postId, postId)).orderBy(desc(schedules.id)).limit(1);
  return rows[0];
}

/* --------------------------------- cancel --------------------------------- */

/** DELETE post: status CANCELLED; dangling deliveries -> CANCELLED. */
export async function cancelPost(userId: number, postId: number): Promise<void> {
  const postRows = await db.select({ id: posts.id, userId: posts.userId, status: posts.status }).from(posts).where(eq(posts.id, postId)).limit(1);
  const post = assertOwnership(postRows[0], userId);
  if (post.status === 'CANCELLED') return;

  await db.transaction(async (tx) => {
    await tx.update(posts).set({ status: 'CANCELLED', updatedAt: new Date() }).where(eq(posts.id, postId));
    await tx
      .update(deliveries)
      .set({ state: 'CANCELLED', updatedAt: new Date() })
      .where(and(eq(deliveries.postId, postId), inArray(deliveries.state, ['PENDING', 'PROCESSING', 'RETRYING'])));
    await tx.update(schedules).set({ status: 'CANCELLED', updatedAt: new Date() }).where(and(eq(schedules.postId, postId), eq(schedules.status, 'ACTIVE')));
  });

  AnalyticsService.trackEvent({ userId, type: 'post.cancelled', subjectType: 'post', subjectId: postId });
}

/* ------------------------------- publish now ------------------------------ */

/**
 * Idempotent publish-now: key `publish:{postId}`. Only PENDING (non-sent)
 * targets are (re-)enqueued; FAILED/CANCELLED/SENT deliveries are untouched;
 * missing deliveries for explicitly-provided channelIds are created.
 */
export async function publishNow(userId: number, postId: number, channelIds?: number[]): Promise<{ postId: number; enqueued: number }> {
  const postRows = await db.select({ id: posts.id, userId: posts.userId, status: posts.status }).from(posts).where(eq(posts.id, postId)).limit(1);
  const post = assertOwnership(postRows[0], userId);
  if (post.status === 'CANCELLED') {
    throw validationError('این پست لغو شده و قابل انتشار نیست.');
  }

  const result = await withIdempotency<{ postId: number; enqueued: number }>(
    `publish:${postId}`,
    'publishing',
    async () => {
      // Optionally create missing deliveries for explicitly listed channels.
      if (channelIds !== undefined && channelIds.length > 0) {
        const uniqueIds = [...new Set(channelIds)];
        const usable = await listUsableChannels(userId, uniqueIds);
        if (usable.length !== uniqueIds.length) {
          throw validationError('یک یا چند کانال انتخاب‌شده معتبر نیست.');
        }
        const existing = await db
          .select({ channelId: deliveries.channelId })
          .from(deliveries)
          .where(and(eq(deliveries.postId, postId), inArray(deliveries.channelId, uniqueIds)));
        const existingSet = new Set(existing.map((e) => e.channelId));
        for (const ch of usable) {
          if (ch.status === 'DISCONNECTED') continue;
          if (existingSet.has(ch.id)) continue;
          await db.insert(deliveries).values({ postId, channelId: ch.id, userId, state: 'PENDING', maxAttempts: 5 });
        }
      }

      // Move the post into the in-flight state (never resurrect CANCELLED).
      await db
        .update(posts)
        .set({ status: 'PUBLISHING', updatedAt: new Date() })
        .where(and(eq(posts.id, postId), sql`${posts.status} <> 'CANCELLED'`));

      const pending = await db
        .select({ id: deliveries.id })
        .from(deliveries)
        .where(and(eq(deliveries.postId, postId), eq(deliveries.state, 'PENDING')));

      let enqueued = 0;
      for (const d of pending) {
        const ok = await enqueue('deliveries', 'send', { deliveryId: d.id });
        if (ok) enqueued++;
      }
      return { postId, enqueued };
    },
    86_400,
    userId,
  );

  AnalyticsService.trackEvent({
    userId,
    type: 'post.publish_now',
    subjectType: 'post',
    subjectId: postId,
    data: { enqueued: result.value.enqueued, replayed: result.replayed },
  });
  return result.value;
}

/* ------------------------------ delivery retry ---------------------------- */

/** Retry a FAILED/RETRYING delivery (bounded by maxAttempts). */
export async function retryDelivery(userId: number, deliveryId: number): Promise<{ deliveryId: number; state: string }> {
  const rows = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId)).limit(1);
  const delivery = assertOwnership(rows[0], userId);

  if (delivery.state !== 'FAILED' && delivery.state !== 'RETRYING') {
    throw validationError('فقط ارسال‌های ناموفق قابل تلاش مجدد هستند.');
  }
  if (delivery.attempts >= delivery.maxAttempts) {
    throw validationError('سقف تلاش برای این ارسال پر شده است.');
  }

  const updated = await db
    .update(deliveries)
    .set({ state: 'PENDING', nextAttemptAt: null, lastError: null, errorClass: null, updatedAt: new Date() })
    .where(and(eq(deliveries.id, deliveryId), inArray(deliveries.state, ['FAILED', 'RETRYING'])));
  if ((updated[0]?.affectedRows ?? 0) === 0) {
    throw conflict('وضعیت ارسال هم‌اکنون تغییر کرده است. صفحه را بازخوانی کنید.');
  }

  // Keep the post visible as in-flight while the retry runs.
  await db
    .update(posts)
    .set({ status: 'PUBLISHING', updatedAt: new Date() })
    .where(and(eq(posts.id, delivery.postId), sql`${posts.status} <> 'CANCELLED'`));

  await enqueue('deliveries', 'send', { deliveryId });
  AnalyticsService.trackEvent({ userId, type: 'delivery.retried', subjectType: 'delivery', subjectId: deliveryId });
  return { deliveryId, state: 'PENDING' };
}

export async function listDeliveries(userId: number, params: { postId?: number; page: number; limit: number }): Promise<{ items: Array<Record<string, unknown>>; total: number; page: number; limit: number }> {
  const conditions = [eq(deliveries.userId, userId)];
  if (params.postId !== undefined) conditions.push(eq(deliveries.postId, params.postId));
  const where = and(...conditions);

  const offset = (params.page - 1) * params.limit;
  const items = await db
    .select({
      id: deliveries.id,
      postId: deliveries.postId,
      channelId: deliveries.channelId,
      state: deliveries.state,
      attempts: deliveries.attempts,
      maxAttempts: deliveries.maxAttempts,
      nextAttemptAt: deliveries.nextAttemptAt,
      lastError: deliveries.lastError,
      errorClass: deliveries.errorClass,
      providerMessageId: deliveries.providerMessageId,
      sentAt: deliveries.sentAt,
      createdAt: deliveries.createdAt,
    })
    .from(deliveries)
    .where(where)
    .orderBy(desc(deliveries.id))
    .limit(params.limit)
    .offset(offset);
  const totalRows = await db.select({ value: count() }).from(deliveries).where(where);
  return { items, total: Number(totalRows[0]?.value ?? 0), page: params.page, limit: params.limit };
}

/* ---------------------------- post status recalc -------------------------- */

/**
 * Shared post-status aggregator, called after every delivery completion:
 *  - all SENT            -> PUBLISHED
 *  - none sent + FAILED  -> FAILED
 *  - mix SENT/FAILED     -> PARTIAL
 *  - any active left     -> keep PUBLISHING
 * Never overrides CANCELLED/PUBLISHED terminal states.
 */
export async function recalcPostStatus(postId: number): Promise<void> {
  const postRows = await db.select({ id: posts.id, status: posts.status }).from(posts).where(eq(posts.id, postId)).limit(1);
  const post = postRows[0];
  if (post === undefined) return;

  const stateRows = await db
    .select({ state: deliveries.state, value: count() })
    .from(deliveries)
    .where(eq(deliveries.postId, postId))
    .groupBy(deliveries.state);

  let sent = 0;
  let failed = 0;
  let active = 0;
  for (const row of stateRows) {
    const n = Number(row.value ?? 0);
    if (row.state === 'SENT') sent += n;
    else if (row.state === 'FAILED') failed += n;
    else if (row.state === 'CANCELLED') continue;
    else active += n; // PENDING / PROCESSING / RETRYING
  }

  let target: PostStatus | null = null;
  if (active > 0) {
    target = 'PUBLISHING';
  } else if (sent > 0 && failed > 0) {
    target = 'PARTIAL';
  } else if (sent > 0 && failed === 0) {
    target = 'PUBLISHED';
  } else if (sent === 0 && failed > 0) {
    target = 'FAILED';
  } else {
    target = null; // nothing actionable (e.g. all cancelled)
  }
  if (target === null) return;

  const allowedSource: PostStatus[] = ['PUBLISHING', 'SCHEDULED', 'DRAFT', 'FAILED', 'PARTIAL'];
  if (!allowedSource.includes(post.status)) return;
  if (post.status === target) return;

  await db
    .update(posts)
    .set({
      status: target,
      ...(target === 'PUBLISHED' ? { publishedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(posts.id, postId), eq(posts.status, post.status)));
}

/* -------------------------------- schedules ------------------------------- */

export async function listSchedules(userId: number, params: { page: number; limit: number }): Promise<{ items: Array<Record<string, unknown>>; total: number; page: number; limit: number }> {
  const where = eq(schedules.userId, userId);
  const offset = (params.page - 1) * params.limit;
  const items = await db
    .select({
      id: schedules.id,
      postId: schedules.postId,
      postTitle: posts.title,
      runAt: schedules.runAt,
      recurrence: schedules.recurrence,
      timezone: schedules.timezone,
      status: schedules.status,
      lastRunAt: schedules.lastRunAt,
      nextRunAt: schedules.nextRunAt,
      createdAt: schedules.createdAt,
    })
    .from(schedules)
    .innerJoin(posts, eq(schedules.postId, posts.id))
    .where(where)
    .orderBy(asc(schedules.runAt))
    .limit(params.limit)
    .offset(offset);
  const totalRows = await db.select({ value: count() }).from(schedules).where(where);
  return { items, total: Number(totalRows[0]?.value ?? 0), page: params.page, limit: params.limit };
}

export interface UpdateScheduleInput {
  runAt?: Date;
  recurrence?: Recurrence;
  status?: 'ACTIVE' | 'PAUSED';
}

/** Reschedule / pause / resume (API takes ISO UTC; Jalali conversion is UI-side). */
export async function updateSchedule(userId: number, scheduleId: number, input: UpdateScheduleInput): Promise<Record<string, unknown>> {
  const rows = await db.select().from(schedules).where(eq(schedules.id, scheduleId)).limit(1);
  const schedule = assertOwnership(rows[0], userId);
  if (schedule.status === 'CANCELLED' || schedule.status === 'DONE') {
    throw conflict('این زمان‌بندی پایان یافته و قابل تغییر نیست.');
  }

  const resuming = input.status === 'ACTIVE' && schedule.status === 'PAUSED';
  if (resuming) {
    const { limits } = await getPlanLimitsForUser(userId);
    const active = await countActiveSchedules(userId);
    if (active >= limits.schedules) {
      throw planLimit('سقف زمان‌بندی‌های پلن شما پر شده است. پلن خود را ارتقا دهید.');
    }
  }

  const nextRunAt = input.runAt ?? schedule.runAt;
  await db
    .update(schedules)
    .set({
      ...(input.runAt !== undefined ? { runAt: input.runAt } : {}),
      ...(input.recurrence !== undefined ? { recurrence: input.recurrence } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      nextRunAt,
      updatedAt: new Date(),
    })
    .where(eq(schedules.id, scheduleId));

  // If the post is still SCHEDULED, rescheduling the row keeps it queued.
  if (input.runAt !== undefined) {
    await db
      .update(posts)
      .set({ updatedAt: new Date() })
      .where(and(eq(posts.id, schedule.postId), eq(posts.status, 'SCHEDULED')));
  }

  const fresh = await db.select().from(schedules).where(eq(schedules.id, scheduleId)).limit(1);
  const row = fresh[0];
  if (row === undefined) throw notFound();
  return {
    id: row.id,
    postId: row.postId,
    runAt: row.runAt,
    recurrence: row.recurrence,
    status: row.status,
    nextRunAt: row.nextRunAt,
  };
}

export async function cancelSchedule(userId: number, scheduleId: number): Promise<void> {
  const rows = await db.select({ id: schedules.id, userId: schedules.userId }).from(schedules).where(eq(schedules.id, scheduleId)).limit(1);
  assertOwnership(rows[0], userId);
  await db.update(schedules).set({ status: 'CANCELLED', updatedAt: new Date() }).where(eq(schedules.id, scheduleId));
}

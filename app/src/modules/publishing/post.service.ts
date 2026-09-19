import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { channels, media, outboxEvents, postTargets, posts } from '../../db/schema.js';
import type { PostButtons } from '../../db/schema.js';
import { newId } from '../../core/ids.js';
import { AppError, ERR } from '../../core/errors.js';
import { outboxRow } from '../../core/outbox.js';
import { emitEvent } from '../../core/events.js';
import { audit } from '../../core/audit.js';
import { enqueue } from '../../queue/queues.js';
import { assertWithinLimit } from '../subscriptions/plan.service.js';

/**
 * Publishing domain (§22, §25): DRAFT → (SCHEDULED →) QUEUED → PUBLISHING →
 * PUBLISHED/PARTIAL/FAILED, CANCELLED from SCHEDULED/QUEUED. Per-target state
 * machine lives in core/delivery-state. The outbox row is written in the SAME
 * transaction as the state flip (§125) — the dispatcher fans out targets.
 */

export type PostState = 'DRAFT' | 'SCHEDULED' | 'QUEUED' | 'PUBLISHING' | 'PUBLISHED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
export type ParseMode = 'NONE' | 'HTML' | 'MARKDOWN';

export interface ActorMeta {
  actorId?: string | null;
  actorRole?: string | null;
  ip?: string;
}

export interface CreatePostInput {
  title?: string;
  body: string;
  parseMode?: ParseMode;
  mediaId?: string;
  buttons?: PostButtons;
}

export interface PostListQuery {
  page?: number;
  pageSize?: number;
  state?: PostState;
  search?: string;
}

export interface TargetView {
  id: string;
  channelId: string;
  state: string;
  attempts: number;
  providerMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  sentAt: Date | null;
  nextRetryAt: Date | null;
  platform: 'telegram' | 'bale' | 'rubika';
  channelTitle: string;
  channelRef: string;
}

function cleanSearch(term: string): string {
  return term.replace(/[%_]/g, ' ').trim();
}

async function requireOwnedPost(tenantId: string, postId: string) {
  const db = getDb();
  const [post] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.tenantId, tenantId)))
    .limit(1);
  if (!post) throw new AppError(ERR.NOT_FOUND('پست'));
  return post;
}

async function resolveActiveChannels(tenantId: string, channelIds: string[]): Promise<string[]> {
  const unique = [...new Set(channelIds)];
  if (unique.length === 0) {
    throw new AppError(ERR.VALIDATION('حداقل یک کانال انتخاب کنید.'));
  }
  const rows = await getDb()
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.tenantId, tenantId), eq(channels.status, 'ACTIVE'), inArray(channels.id, unique)));
  if (rows.length !== unique.length) {
    throw new AppError(ERR.VALIDATION('یکی از کانال‌های انتخاب‌شده معتبر یا فعال نیست.'));
  }
  return unique;
}

function ensurePublishableState(state: string): void {
  if (state === 'QUEUED' || state === 'PUBLISHING') {
    throw new AppError(ERR.VALIDATION('این پست در حال انتشار است و امکان تغییر آن نیست.'));
  }
}

export async function createPost(tenantId: string, input: CreatePostInput, meta: ActorMeta = {}): Promise<typeof posts.$inferSelect> {
  const db = getDb();
  const body = input.body.trim();
  if (!body) throw new AppError(ERR.VALIDATION('متن پست الزامی است.'));

  let mediaId: string | null = null;
  if (input.mediaId) {
    const [m] = await db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.id, input.mediaId), eq(media.tenantId, tenantId)))
      .limit(1);
    if (!m) throw new AppError(ERR.VALIDATION('رسانهٔ انتخاب‌شده معتبر نیست.'));
    mediaId = m.id;
  }

  const id = newId();
  await db.insert(posts).values({
    id,
    tenantId,
    title: input.title?.trim() || null,
    body,
    parseMode: input.parseMode ?? 'NONE',
    mediaId,
    buttonsJson: input.buttons ?? null,
    source: 'MANUAL',
    state: 'DRAFT',
  });
  const post = await requireOwnedPost(tenantId, id);
  await emitEvent({ name: 'post.created', tenantId, subjectType: 'post', subjectId: id, props: { hasMedia: mediaId !== null } });
  await audit({
    action: 'post.create',
    actorId: meta.actorId ?? null,
    actorRole: meta.actorRole ?? null,
    subjectType: 'post',
    subjectId: id,
    ip: meta.ip ?? undefined,
  });
  return post;
}

export async function publishNow(
  tenantId: string,
  postId: string,
  channelIds: string[],
  meta: ActorMeta = {}
): Promise<typeof posts.$inferSelect> {
  const post = await requireOwnedPost(tenantId, postId);
  ensurePublishableState(post.state);
  const uniqueChannels = await resolveActiveChannels(tenantId, channelIds);

  // Posts quota is counted inside the plan service over the subscription period.
  await assertWithinLimit(tenantId, 'posts');

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(posts)
      .set({ state: 'QUEUED', scheduledAt: null })
      .where(and(eq(posts.id, postId), eq(posts.tenantId, tenantId)));
    for (const channelId of uniqueChannels) {
      await tx
        .insert(postTargets)
        .values({ id: newId(), postId, tenantId, channelId, state: 'PENDING' })
        .onDuplicateKeyUpdate({
          // Never resurrect already-delivered targets on re-publish (§23):
          // SENT stays SENT; only non-terminal states return to PENDING.
          set: {
            state: sql`IF(${postTargets.state} = 'SENT', 'SENT', 'PENDING')`,
            errorCode: sql`IF(${postTargets.state} = 'SENT', ${postTargets.errorCode}, NULL)`,
            errorMessage: sql`IF(${postTargets.state} = 'SENT', ${postTargets.errorMessage}, NULL)`,
            nextRetryAt: sql`IF(${postTargets.state} = 'SENT', ${postTargets.nextRetryAt}, NULL)`,
            sentAt: sql`IF(${postTargets.state} = 'SENT', ${postTargets.sentAt}, NULL)`,
            providerMessageId: sql`IF(${postTargets.state} = 'SENT', ${postTargets.providerMessageId}, NULL)`,
          },
        });
    }
    await tx.insert(outboxEvents).values(
      outboxRow({ aggregateType: 'post', aggregateId: postId, eventType: 'post.publish', payload: {} })
    );
  });

  await audit({
    action: 'post.publish',
    actorId: meta.actorId ?? null,
    actorRole: meta.actorRole ?? null,
    subjectType: 'post',
    subjectId: postId,
    ip: meta.ip ?? undefined,
    meta: { channels: uniqueChannels.length },
  });
  return requireOwnedPost(tenantId, postId);
}

export async function schedulePost(
  tenantId: string,
  postId: string,
  channelIds: string[],
  scheduledAt: Date,
  meta: ActorMeta = {}
): Promise<typeof posts.$inferSelect> {
  const post = await requireOwnedPost(tenantId, postId);
  ensurePublishableState(post.state);
  if (!(scheduledAt.getTime() > Date.now())) {
    throw new AppError(ERR.VALIDATION('زمان انتشار باید در آینده باشد.'));
  }
  const uniqueChannels = await resolveActiveChannels(tenantId, channelIds);
  await assertWithinLimit(tenantId, 'schedules');

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(posts)
      .set({ state: 'SCHEDULED', scheduledAt })
      .where(and(eq(posts.id, postId), eq(posts.tenantId, tenantId)));
    for (const channelId of uniqueChannels) {
      await tx
        .insert(postTargets)
        .values({ id: newId(), postId, tenantId, channelId, state: 'PENDING' })
        .onDuplicateKeyUpdate({
          // Never resurrect already-delivered targets on re-publish (§23):
          // SENT stays SENT; only non-terminal states return to PENDING.
          set: {
            state: sql`IF(${postTargets.state} = 'SENT', 'SENT', 'PENDING')`,
            errorCode: sql`IF(${postTargets.state} = 'SENT', ${postTargets.errorCode}, NULL)`,
            errorMessage: sql`IF(${postTargets.state} = 'SENT', ${postTargets.errorMessage}, NULL)`,
            nextRetryAt: sql`IF(${postTargets.state} = 'SENT', ${postTargets.nextRetryAt}, NULL)`,
            sentAt: sql`IF(${postTargets.state} = 'SENT', ${postTargets.sentAt}, NULL)`,
            providerMessageId: sql`IF(${postTargets.state} = 'SENT', ${postTargets.providerMessageId}, NULL)`,
          },
        });
    }
  });

  await emitEvent({ name: 'post.scheduled', tenantId, subjectType: 'post', subjectId: postId });
  await audit({
    action: 'post.schedule',
    actorId: meta.actorId ?? null,
    actorRole: meta.actorRole ?? null,
    subjectType: 'post',
    subjectId: postId,
    ip: meta.ip ?? undefined,
    meta: { channels: uniqueChannels.length, scheduledAt: scheduledAt.toISOString() },
  });
  return requireOwnedPost(tenantId, postId);
}

export interface PostListResult {
  items: Array<typeof posts.$inferSelect & { targetSummary: Array<{ state: string; count: number }> }>;
  total: number;
  page: number;
  pageSize: number;
}

export async function listPosts(tenantId: string, query: PostListQuery): Promise<PostListResult> {
  const db = getDb();
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

  const conditions = [eq(posts.tenantId, tenantId)];
  if (query.state) conditions.push(eq(posts.state, query.state));
  const search = query.search ? cleanSearch(query.search) : '';
  if (search) {
    const pattern = `%${search}%`;
    const cond = or(like(posts.title, pattern), like(posts.body, pattern));
    if (cond) conditions.push(cond);
  }
  const where = and(...conditions);

  const [countRow] = await db.select({ total: sql<number>`count(*)` }).from(posts).where(where);
  const total = Number(countRow?.total ?? 0);

  const rows = await db
    .select()
    .from(posts)
    .where(where)
    .orderBy(desc(posts.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const ids = rows.map((r) => r.id);
  const summaryRows = ids.length
    ? await db
        .select({ postId: postTargets.postId, state: postTargets.state, count: sql<number>`count(*)` })
        .from(postTargets)
        .where(inArray(postTargets.postId, ids))
        .groupBy(postTargets.postId, postTargets.state)
    : [];

  const items = rows.map((row) => ({
    ...row,
    targetSummary: summaryRows
      .filter((s) => s.postId === row.id)
      .map((s) => ({ state: s.state, count: Number(s.count) })),
  }));

  return { items, total, page, pageSize };
}

export async function getPost(
  tenantId: string,
  postId: string
): Promise<{ post: typeof posts.$inferSelect; targets: TargetView[] }> {
  const db = getDb();
  const post = await requireOwnedPost(tenantId, postId);
  const targets = await db
    .select({
      id: postTargets.id,
      channelId: postTargets.channelId,
      state: postTargets.state,
      attempts: postTargets.attempts,
      providerMessageId: postTargets.providerMessageId,
      errorCode: postTargets.errorCode,
      errorMessage: postTargets.errorMessage,
      sentAt: postTargets.sentAt,
      nextRetryAt: postTargets.nextRetryAt,
      platform: channels.platform,
      channelTitle: channels.title,
      channelRef: channels.channelRef,
    })
    .from(postTargets)
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(eq(postTargets.postId, post.id))
    .orderBy(postTargets.createdAt);
  return { post, targets };
}

export async function cancelPost(tenantId: string, postId: string, meta: ActorMeta = {}): Promise<typeof posts.$inferSelect> {
  const db = getDb();
  const post = await requireOwnedPost(tenantId, postId);
  if (post.state !== 'SCHEDULED' && post.state !== 'QUEUED') {
    throw new AppError(ERR.VALIDATION('فقط پست‌های زمان‌بندی‌شده یا در صف انتشار قابل لغو هستند.'));
  }
  await db.transaction(async (tx) => {
    await tx
      .update(posts)
      .set({ state: 'CANCELLED' })
      .where(and(eq(posts.id, postId), inArray(posts.state, ['SCHEDULED', 'QUEUED'])));
    // PENDING targets are cancelled; SENT ones are kept (already delivered).
    await tx
      .update(postTargets)
      .set({ state: 'CANCELLED' })
      .where(and(eq(postTargets.postId, postId), eq(postTargets.state, 'PENDING')));
  });
  await audit({
    action: 'post.cancel',
    actorId: meta.actorId ?? null,
    actorRole: meta.actorRole ?? null,
    subjectType: 'post',
    subjectId: postId,
    ip: meta.ip ?? undefined,
  });
  return requireOwnedPost(tenantId, postId);
}

export async function retryTarget(tenantId: string, targetId: string, meta: ActorMeta = {}): Promise<{ ok: true }> {
  const db = getDb();
  const [row] = await db
    .select({ targetId: postTargets.id, state: postTargets.state })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .where(and(eq(postTargets.id, targetId), eq(posts.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('مقصدهای ارسال'));
  if (row.state !== 'FAILED') {
    throw new AppError(ERR.VALIDATION('فقط ارسال‌های ناموفق قابل تلاش مجدد هستند.'));
  }
  // Atomic claim: FAILED → PENDING (only one retry request wins).
  const claimed = await db
    .update(postTargets)
    .set({ state: 'PENDING', nextRetryAt: null })
    .where(and(eq(postTargets.id, targetId), eq(postTargets.state, 'FAILED')));
  if (affectedRowsOf(claimed) === 0) {
    throw new AppError(ERR.CONFLICT('این مقصد هم‌اکنون در حال پردازش است.'));
  }
  await enqueue('delivery', 'deliver', { targetId });
  await audit({
    action: 'post.target.retry',
    actorId: meta.actorId ?? null,
    actorRole: meta.actorRole ?? null,
    subjectType: 'post_target',
    subjectId: targetId,
    ip: meta.ip ?? undefined,
  });
  return { ok: true };
}

/** mysql2/drizzle update result → affected rows (shape-safe, no `any`). */
export function affectedRowsOf(result: unknown): number {
  if (Array.isArray(result)) {
    const head = result[0] as { affectedRows?: number } | undefined;
    return typeof head?.affectedRows === 'number' ? head.affectedRows : 0;
  }
  const head = result as { affectedRows?: number } | undefined;
  return typeof head?.affectedRows === 'number' ? head.affectedRows : 0;
}

import { Job } from 'bullmq';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import {
  bots, channels, media, mediaAccessTokens, postTargets, posts, wordpressProducts,
} from '../db/schema.js';
import { newId, newToken, sha256Hex } from '../core/ids.js';
import { AppError } from '../core/errors.js';
import { nextRetryDelaySeconds } from '../core/delivery-state.js';
import { emitEvent } from '../core/events.js';
import { createLogger } from '../core/logger.js';
import { createWorker } from '../queue/connection.js';
import { loadEnv } from '../config/env.js';
import { getProvider } from '../providers/index.js';
import { decryptSecret } from '../security/encryption.js';
import type { Platform, ProviderError } from '../providers/types.js';

/**
 * Delivery worker (§22, §84-88). One queue 'delivery', two job kinds:
 *   - deliver          {targetId}       → send a post_target to its channel
 *   - deliver-product  {payloadJson}    → transient wordpress product send
 * Duplicate-send protection: the PROCESSING claim is an atomic
 * UPDATE ... WHERE state IN ('PENDING','RETRYING') — losing updater exits.
 */

const log = createLogger('delivery-worker');

const RETRY_CLASSES = new Set<string>(['TRANSIENT', 'RATE_LIMITED']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function affectedRowsOf(result: unknown): number {
  if (Array.isArray(result)) {
    const head = result[0] as { affectedRows?: number } | undefined;
    return typeof head?.affectedRows === 'number' ? head.affectedRows : 0;
  }
  const head = result as { affectedRows?: number } | undefined;
  return typeof head?.affectedRows === 'number' ? head.affectedRows : 0;
}

function asProviderError(err: unknown): ProviderError | null {
  if (err instanceof Error) {
    const candidate = err as ProviderError;
    if (typeof candidate.providerClass === 'string' && typeof candidate.userMessageFa === 'string') return candidate;
  }
  return null;
}

function errorClassOf(err: unknown): string {
  const provider = asProviderError(err);
  if (provider) return provider.providerClass;
  if (err instanceof AppError) return err.errorClass.toUpperCase();
  return 'UNKNOWN';
}

function errorMessageOf(err: unknown): string {
  const provider = asProviderError(err);
  if (provider) return provider.userMessageFa;
  if (err instanceof AppError) return err.userMessage;
  return 'ارسال پیام ناموفق بود.';
}

/** Platforms without parse-mode support receive plain text (§15: no emulation). */
function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripMarkdown(input: string): string {
  return input
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .trim();
}

async function claimTarget(targetId: string): Promise<boolean> {
  // Atomic claim — prevents duplicate sends when a job is retried/duplicated.
  const res = await getDb()
    .update(postTargets)
    .set({ state: 'PROCESSING' })
    .where(and(eq(postTargets.id, targetId), inArray(postTargets.state, ['PENDING', 'RETRYING'])));
  return affectedRowsOf(res) > 0;
}

/** Recompute the post aggregate state from its targets (§22). */
async function refreshPostAggregate(postId: string): Promise<void> {
  const db = getDb();
  const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post) return;
  const rows = await db.select({ state: postTargets.state }).from(postTargets).where(eq(postTargets.postId, postId));
  if (rows.length === 0) return;
  const sent = rows.filter((r) => r.state === 'SENT').length;
  const closed = rows.filter((r) => r.state === 'FAILED' || r.state === 'CANCELLED').length;
  const open = rows.length - sent - closed;
  let next: typeof post.state;
  if (sent === rows.length) next = 'PUBLISHED';
  else if (sent > 0) next = 'PARTIAL';
  else if (open === 0) next = 'FAILED';
  else next = 'PUBLISHING';

  const setPublishedAt = post.publishedAt === null && (next === 'PUBLISHED' || next === 'PARTIAL');
  if (next !== post.state || setPublishedAt) {
    await db
      .update(posts)
      .set({ state: next, ...(setPublishedAt ? { publishedAt: new Date() } : {}) })
      .where(
        and(
          eq(posts.id, postId),
          inArray(posts.state, ['QUEUED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIAL', 'FAILED'])
        )
      );
  }
}

async function loadActiveBotToken(tenantId: string, platform: Platform): Promise<{ token: string } | null> {
  const db = getDb();
  const [bot] = await db
    .select({ tokenEncrypted: bots.tokenEncrypted })
    .from(bots)
    .where(and(eq(bots.tenantId, tenantId), eq(bots.platform, platform), eq(bots.status, 'ACTIVE')))
    .orderBy(desc(bots.createdAt))
    .limit(1);
  if (!bot) return null;
  return { token: decryptSecret(bot.tokenEncrypted) };
}

async function resolveMediaUrl(tenantId: string, mediaId: string): Promise<{ url: string; kind: 'photo' | 'video' } | null> {
  const db = getDb();
  const [m] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.tenantId, tenantId)))
    .limit(1);
  if (!m) return null;
  // Private local storage is exposed through a short-lived signed token (15 min)
  // so providers can fetch the file over HTTPS without public media directories.
  const rawToken = newToken(16);
  await db.insert(mediaAccessTokens).values({
    id: newId(),
    mediaId: m.id,
    tokenHash: await sha256Hex(rawToken),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });
  const base = loadEnv().APP_URL.replace(/\/$/, '');
  return {
    url: `${base}/api/v1/media/raw/${m.id}?token=${rawToken}`,
    kind: m.mime.startsWith('video/') ? 'video' : 'photo',
  };
}

async function deliverPost(targetId: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ target: postTargets, post: posts, channel: channels })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(eq(postTargets.id, targetId))
    .limit(1);
  if (!row) {
    log.warn({ targetId }, 'deliver_target_not_found');
    return;
  }
  const { target, post, channel } = row;

  if (!(await claimTargetSafe(targetId))) return;
  await db
    .update(posts)
    .set({ state: 'PUBLISHING' })
    .where(and(eq(posts.id, post.id), inArray(posts.state, ['QUEUED', 'SCHEDULED'])));

  try {
    // Ownership guard: a DISABLED channel must never receive sends.
    if (channel.status === 'DISABLED') {
      await finalizeFailure(target, post, channel, 'CHANNEL_DISABLED', 'کانال غیرفعال است. آن را دوباره متصل کنید.', false);
      return;
    }

    const platform: Platform = channel.platform;
    let token: string;
    try {
      const bot = await loadActiveBotToken(post.tenantId, platform);
      if (!bot) {
        await finalizeFailure(target, post, channel, 'NO_BOT', 'ربات فعالی برای این پلتفرم یافت نشد. ابتدا ربات را متصل کنید.', false);
        return;
      }
      token = bot.token;
    } catch {
      await finalizeFailure(target, post, channel, 'UNAUTHORIZED', 'اعتبارنامهٔ ربات نامعتبر است. ربات را دوباره متصل کنید.', false);
      return;
    }

    const provider = getProvider(platform);
    const caps = provider.capabilities();

    // Parse mode: strip markup for platforms without parse support.
    let text = post.body;
    let parseMode: 'NONE' | 'HTML' | 'MARKDOWN' = post.parseMode;
    if (!caps.htmlParseMode) {
      if (parseMode === 'HTML') {
        text = stripHtml(text);
        parseMode = 'NONE';
      } else if (parseMode === 'MARKDOWN') {
        text = stripMarkdown(text);
        parseMode = 'NONE';
      }
    }

    // Buttons: merged inline + link buttons; silently omitted when unsupported.
    const buttons = post.buttonsJson ?? {};
    let inline = [...(buttons.inline ?? []), ...(buttons.links ?? []).map((l) => ({ label: l.label, url: l.url }))];
    if (!caps.inlineButtons) inline = [];
    const inlineButtons = inline.length > 0 ? inline : undefined;

    // Media: text-only fallback when media cannot be resolved publicly.
    let mediaUrl: string | undefined;
    let kind: 'photo' | 'video' = 'photo';
    if (post.mediaId) {
      const resolved = await resolveMediaUrl(post.tenantId, post.mediaId);
      if (resolved && caps.sendMedia) {
        mediaUrl = resolved.url;
        kind = resolved.kind;
      }
    }

    const result =
      mediaUrl !== undefined
        ? await provider.sendMedia(token, {
            chatRef: channel.channelRef,
            text,
            parseMode,
            inlineButtons,
            mediaUrl,
            kind,
          })
        : await provider.sendText(token, { chatRef: channel.channelRef, text, parseMode, inlineButtons });

    await db
      .update(postTargets)
      .set({
        state: 'SENT',
        providerMessageId: result.messageId.slice(0, 190),
        sentAt: new Date(),
        attempts: target.attempts + 1,
        errorCode: null,
        errorMessage: null,
        nextRetryAt: null,
      })
      .where(eq(postTargets.id, target.id));

    // First successful delivery is a channel health signal: PENDING_VERIFY → ACTIVE.
    await db
      .update(channels)
      .set({ status: 'ACTIVE', lastVerifiedAt: new Date(), healthJson: { ok: true, verifiedVia: 'first_send' } })
      .where(and(eq(channels.id, channel.id), eq(channels.status, 'PENDING_VERIFY')));

    await refreshPostAggregate(post.id);
    await emitEvent({
      name: 'post.sent',
      tenantId: post.tenantId,
      subjectType: 'post',
      subjectId: post.id,
      props: { channelId: channel.id, platform },
    });
  } catch (err) {
    const errorClass = errorClassOf(err);
    const message = errorMessageOf(err);
    const retryable = RETRY_CLASSES.has(errorClass);
    await finalizeFailure(target, post, channel, errorClass, message, retryable);
  }
}

async function claimTargetSafe(targetId: string): Promise<boolean> {
  const claimed = await claimTarget(targetId);
  if (!claimed) log.debug({ targetId }, 'deliver_target_already_claimed');
  return claimed;
}

async function finalizeFailure(
  target: typeof postTargets.$inferSelect,
  post: typeof posts.$inferSelect,
  channel: typeof channels.$inferSelect,
  errorCode: string,
  messageFa: string,
  retryable: boolean
): Promise<void> {
  const attempts = target.attempts + 1;
  let nextRetryAt: Date | null = null;
  let state: 'RETRYING' | 'FAILED' = 'FAILED';
  if (retryable) {
    const delaySeconds = nextRetryDelaySeconds(attempts);
    if (delaySeconds !== null) {
      state = 'RETRYING';
      nextRetryAt = new Date(Date.now() + delaySeconds * 1000);
    }
  }
  await getDb()
    .update(postTargets)
    .set({ state, attempts, nextRetryAt, errorCode: errorCode.slice(0, 80), errorMessage: messageFa.slice(0, 250) })
    .where(eq(postTargets.id, target.id));

  // Failed chat lookups are recorded as channel health, without auto-disabling.
  if (errorCode === 'NOT_FOUND' || errorCode === 'BLOCKED') {
    await getDb()
      .update(channels)
      .set({ healthJson: { ok: false, errorCode, checkedAt: new Date().toISOString() } })
      .where(eq(channels.id, channel.id));
  }

  await refreshPostAggregate(post.id);
  await emitEvent({
    name: 'post.failed',
    tenantId: post.tenantId,
    subjectType: 'post',
    subjectId: post.id,
    props: { channelId: channel.id, errorCode, retrying: state === 'RETRYING', attempts },
  });
}

interface ProductPayload {
  tenantId: string;
  siteId: string;
  productId: number;
  channelId: string;
  title: string;
  body: string;
  imageUrl: string | null;
}

function parseProductPayload(payload: Record<string, unknown>): ProductPayload | null {
  const tenantId = asString(payload.tenantId);
  const siteId = asString(payload.siteId);
  const channelId = asString(payload.channelId);
  const rawProductId = payload.productId;
  const productId = typeof rawProductId === 'number' ? rawProductId : typeof rawProductId === 'string' ? Number(rawProductId) : NaN;
  const body = asString(payload.body);
  if (!tenantId || !siteId || !channelId || !Number.isFinite(productId) || !body) return null;
  return {
    tenantId,
    siteId,
    productId,
    channelId,
    title: asString(payload.title) ?? '',
    body,
    imageUrl: asString(payload.imageUrl),
  };
}

async function deliverProduct(payload: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const input = parseProductPayload(payload);
  if (!input) {
    log.warn({ payloadKeys: Object.keys(payload) }, 'deliver_product_invalid_payload');
    return;
  }

  const [channel] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.id, input.channelId), eq(channels.tenantId, input.tenantId)))
    .limit(1);
  if (!channel || channel.status !== 'ACTIVE') {
    log.warn({ channelId: input.channelId }, 'deliver_product_channel_inactive');
    return;
  }

  const platform: Platform = channel.platform;
  let token: string | null = null;
  try {
    const bot = await loadActiveBotToken(input.tenantId, platform);
    token = bot?.token ?? null;
  } catch {
    token = null;
  }
  if (!token) {
    log.warn({ channelId: channel.id }, 'deliver_product_no_bot');
    return;
  }

  const provider = getProvider(platform);
  const caps = provider.capabilities();
  let text = input.title ? `${input.title}\n\n${input.body}` : input.body;
  if (!caps.htmlParseMode) text = stripHtml(text);

  const mediaUrl = input.imageUrl && caps.sendMedia ? input.imageUrl : undefined;
  if (mediaUrl !== undefined) {
    await provider.sendMedia(token, { chatRef: channel.channelRef, text, parseMode: 'NONE', mediaUrl, kind: 'photo' });
  } else {
    await provider.sendText(token, { chatRef: channel.channelRef, text, parseMode: 'NONE' });
  }

  await db
    .update(wordpressProducts)
    .set({ lastPublishedAt: new Date() })
    .where(and(eq(wordpressProducts.siteId, input.siteId), eq(wordpressProducts.wcProductId, input.productId)));

  const [product] = await db
    .select({ id: wordpressProducts.id })
    .from(wordpressProducts)
    .where(and(eq(wordpressProducts.siteId, input.siteId), eq(wordpressProducts.wcProductId, input.productId)))
    .limit(1);
  if (product) {
    await emitEvent({
      name: 'wordpress.product.published',
      tenantId: input.tenantId,
      subjectType: 'wordpress_product',
      subjectId: product.id,
      props: { channelId: channel.id, platform },
    });
  }
}

async function processJob(job: Job): Promise<void> {
  const data = asRecord(job.data);
  if (job.name === 'deliver') {
    const targetId = data ? asString(data.targetId) : null;
    if (!targetId) {
      log.warn({ jobId: job.id }, 'deliver_job_missing_target');
      return;
    }
    await deliverPost(targetId);
    return;
  }
  if (job.name === 'deliver-product') {
    const payload = data ? asRecord(data.payloadJson) : null;
    if (!payload) {
      log.warn({ jobId: job.id }, 'deliver_product_job_missing_payload');
      return;
    }
    await deliverProduct(payload);
    return;
  }
  log.warn({ jobName: job.name }, 'unknown_delivery_job');
}

export function startDeliveryWorker() {
  const env = loadEnv();
  log.info({ concurrency: env.WORKER_CONCURRENCY }, 'delivery_worker_starting');
  // createWorker's processor parameter resolves to `never` due to a broken
  // conditional type in queue/connection.ts — bridge it without losing typing.
  const processor = async (job: Job): Promise<void> => {
    try {
      await processJob(job);
    } catch (err) {
      // BullMQ retries (attempts=3); classified failures above never throw.
      log.error({ err, jobId: job.id, jobName: job.name }, 'delivery_job_failed');
      throw err;
    }
  };
  return createWorker('delivery', processor as unknown as never, {
    concurrency: env.WORKER_CONCURRENCY,
  });
}

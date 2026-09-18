/**
 * Delivery worker job (ADR-008 state machine):
 *   claim (CAS PENDING/RETRYING -> PROCESSING)
 *     -> provider sendText / sendPhoto
 *     -> SENT  |  RETRYING (transient backoff)  |  FAILED (permanent)
 *
 * MEDIA RULE (v1): PUBLIC media -> sendPhoto with the permalink
 * `${APP_URL}/api/v1/media/{id}/content` (the media module's content route
 * must serve PUBLIC-visibility media WITHOUT auth; PRIVATE media requires the
 * owner session). PRIVATE media -> text-only publish (secure by default: the
 * provider cannot authenticate, so a private permalink is never exposed).
 *
 * Retryable classes: Transient / RateLimited / Network.
 * Permanent / Validation / Authentication / Authorization / Provider / Internal
 * fail immediately (never retried), per the delivery contract.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { decryptSecret } from '../../core/crypto.js';
import { AnalyticsService } from '../../core/events.js';
import { classifyProviderError, type ErrorClass } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { db } from '../../db/client.js';
import { channels, deliveries, media, posts } from '../../db/schema.js';
import { env } from '../../config/env.js';
import { getChannelProvider } from '../../providers/registry.js';
import type { SendOutcome } from '../../providers/types.js';
import { recalcPostStatus } from './publishing.service.js';

/** Exponential backoff in seconds: 60s, 5m, 30m, 2h, 6h. */
const BACKOFF_SECONDS = [60, 300, 1800, 7200, 21_600] as const;

const RETRYABLE_CLASSES: ReadonlySet<ErrorClass> = new Set<ErrorClass>(['Transient', 'RateLimited', 'Network']);

export interface DeliveryJobData {
  deliveryId: number;
}

export interface DeliveryJobResult {
  status: 'SENT' | 'RETRY' | 'FAILED';
  retryAfterSeconds?: number;
}

export async function runDeliveryJob(data: DeliveryJobData): Promise<DeliveryJobResult> {
  const deliveryId = Number(data.deliveryId);

  // --- CAS claim: only PENDING/RETRYING deliveries may be processed --------
  const claimed = await db
    .update(deliveries)
    .set({
      state: 'PROCESSING',
      attempts: sql`${deliveries.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(deliveries.id, deliveryId), inArray(deliveries.state, ['PENDING', 'RETRYING'])));
  if ((claimed[0]?.affectedRows ?? 0) === 0) {
    // Claim lost: already processed/cancelled by another worker or a retry
    // landed after a manual transition. Silent no-op — job resolves as FAILED
    // WITHOUT any state change (idempotent consumer).
    return { status: 'FAILED' };
  }

  const rows = await db
    .select({
      delivery: deliveries,
      post: posts,
      channel: channels,
    })
    .from(deliveries)
    .innerJoin(posts, eq(deliveries.postId, posts.id))
    .innerJoin(channels, eq(deliveries.channelId, channels.id))
    .where(eq(deliveries.id, deliveryId))
    .limit(1);
  const joined = rows[0];
  if (joined === undefined) {
    await markFailed(deliveryId, 'Permanent', 'رکورد ارسال یافت نشد.', true);
    return { status: 'FAILED' };
  }
  const { delivery, post, channel } = joined;

  const failFast = async (errorClass: ErrorClass, safeMessage: string, detail?: string): Promise<DeliveryJobResult> => {
    await markFailed(deliveryId, errorClass, safeMessage);
    if (detail !== undefined) {
      logger.warn('delivery_failed_permanent', { deliveryId, postId: post.id, channelProvider: channel.provider, detail });
    }
    AnalyticsService.trackEvent({
      userId: delivery.userId,
      type: 'post.failed',
      subjectType: 'delivery',
      subjectId: deliveryId,
      data: { postId: post.id, channelId: channel.id, provider: channel.provider, errorClass },
    });
    await recalcPostStatus(post.id);
    return { status: 'FAILED' };
  };

  // --- decrypt channel token ------------------------------------------------
  let token: string;
  try {
    token = decryptSecret(channel.credentialsEncrypted);
  } catch (err) {
    return failFast('Permanent', 'ارسال به کانال ناموفق بود: توکن ذخیره‌شده معتبر نیست.', err instanceof Error ? err.message : String(err));
  }

  const provider = getChannelProvider(channel.provider, { token });

  // --- build the send operation ---------------------------------------------
  let operation: Promise<SendOutcome>;
  if (post.mediaId !== null) {
    const mediaRows = await db.select().from(media).where(eq(media.id, post.mediaId)).limit(1);
    const mediaRow = mediaRows[0];
    if (mediaRow !== undefined && mediaRow.visibility === 'PUBLIC') {
      // Public media: provider fetches the permalink directly (no auth needed
      // for PUBLIC visibility — enforced by the media content route, 4-b-2).
      const permalink = `${env.APP_URL}/api/v1/media/${mediaRow.id}/content`;
      operation = provider.sendPhoto(channel.chatId, permalink, post.body);
    } else {
      // Private media: v1 publishes text-only (never leak an authorized URL).
      logger.info('delivery_private_media_text_only', { deliveryId, postId: post.id, mediaId: post.mediaId });
      operation = provider.sendText(channel.chatId, post.body);
    }
  } else {
    operation = provider.sendText(channel.chatId, post.body);
  }

  // --- send -------------------------------------------------------------------
  let outcome: SendOutcome;
  try {
    outcome = await operation;
  } catch (err) {
    // Providers promise never to throw; this is a defensive net for bugs.
    const errorClass = classifyProviderError(err);
    const detail = err instanceof Error ? err.message : String(err);
    logger.error('delivery_provider_threw', { deliveryId, errorClass, detail });
    if (RETRYABLE_CLASSES.has(errorClass) && delivery.attempts < delivery.maxAttempts) {
      return scheduleRetry(deliveryId, delivery.attempts, errorClass, 'ارسال ناموفق بود؛ تلاش مجدد انجام خواهد شد.');
    }
    return failFast(errorClass === 'Validation' || errorClass === 'Authentication' || errorClass === 'Authorization' ? errorClass : 'Permanent', 'ارسال به کانال ناموفق بود.', detail);
  }

  if (outcome.ok) {
    await db
      .update(deliveries)
      .set({
        state: 'SENT',
        providerMessageId: outcome.messageId || null,
        sentAt: new Date(),
        lastError: null,
        errorClass: null,
        nextAttemptAt: null,
        updatedAt: new Date(),
      })
      .where(eq(deliveries.id, deliveryId));
    AnalyticsService.trackEvent({
      userId: delivery.userId,
      type: 'post.sent',
      subjectType: 'delivery',
      subjectId: deliveryId,
      data: { postId: post.id, channelId: channel.id, provider: channel.provider },
    });
    await recalcPostStatus(post.id);
    return { status: 'SENT' };
  }

  // --- failure classification ----------------------------------------------
  if (RETRYABLE_CLASSES.has(outcome.errorClass) && delivery.attempts < delivery.maxAttempts) {
    logger.info('delivery_retry_scheduled', {
      deliveryId,
      attempts: delivery.attempts,
      maxAttempts: delivery.maxAttempts,
      errorClass: outcome.errorClass,
      detail: outcome.detail,
    });
    return scheduleRetry(deliveryId, delivery.attempts, outcome.errorClass, outcome.safeMessage);
  }

  return failFast(outcome.errorClass, outcome.safeMessage, outcome.detail);
}

/** RETRYING + nextAttemptAt = now + backoff[attempts-1] (clamped to table). */
async function scheduleRetry(deliveryId: number, attempts: number, errorClass: ErrorClass, safeMessage: string): Promise<DeliveryJobResult> {
  const idx = Math.min(Math.max(attempts - 1, 0), BACKOFF_SECONDS.length - 1);
  const retryAfterSeconds = BACKOFF_SECONDS[idx] ?? 60;
  await db
    .update(deliveries)
    .set({
      state: 'RETRYING',
      errorClass,
      lastError: safeMessage,
      nextAttemptAt: new Date(Date.now() + retryAfterSeconds * 1000),
      updatedAt: new Date(),
    })
    .where(eq(deliveries.id, deliveryId));
  return { status: 'RETRY', retryAfterSeconds };
}

/** Terminal failure row update (attempts already incremented by the claim). */
async function markFailed(deliveryId: number, errorClass: ErrorClass, safeMessage: string, silent = false): Promise<void> {
  await db
    .update(deliveries)
    .set({ state: 'FAILED', errorClass, lastError: safeMessage, nextAttemptAt: null, updatedAt: new Date() })
    .where(eq(deliveries.id, deliveryId));
  if (silent) logger.warn('delivery_missing_row', { deliveryId });
}

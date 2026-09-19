/**
 * WordPress routes: site pairing CRUD, products, pull-sync trigger and the
 * PUBLIC HMAC-verified plugin webhook.
 *
 * The webhook route reads the RAW request body (encapsulated content-type
 * parser scoped to this module only — buildApp.ts is untouched) with a 256KB
 * body limit, verifies X-Postyar-Signature (HMAC-SHA256 over the raw body with
 * the site secret) + timestamp (300s replay window), dedupes by
 * X-Postyar-Event-Id and processes: product.published → DRAFT post +
 * notification; product.updated → upsert + price notification; ping → CONNECTED.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { sendOk } from '../../core/envelope.js';
import { enqueueOutbox } from '../../core/outbox.js';
import { enqueue } from '../../queue/queues.js';
import { notFound, providerError, validationError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { AnalyticsService } from '../../core/events.js';
import { webhookLimiter } from '../../security/rate-limit.js';
import { requireAuth } from '../../security/session.js';
import { createNotification } from '../notifications/notifications.service.js';
import { db } from '../../db/client.js';
import { posts, wpEvents } from '../../db/schema.js';
import {
  WordpressService,
  buildProductPostBody,
  serializeSite,
  PRODUCT_PAYLOAD_SCHEMA,
  type ProductPayload,
  type WpSiteRow,
} from './wordpress.service.js';

const IdParams = z.object({ id: z.coerce.number().int().min(1) });
const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

/** Encapsulated raw-body scope for the WordPress webhook only. */
const rawBodyPlugin: FastifyPluginAsync = async (scope) => {
  scope.addContentTypeParser(
    ['application/json', 'text/plain'],
    { parseAs: 'buffer' },
    (_request, body, done: (err: Error | null, result?: unknown) => void) => {
      done(null, body);
    },
  );
};

function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; errno?: unknown };
  return e.code === 'ER_DUP_ENTRY' || e.errno === 1062;
}

function readHeader(request: { headers: Record<string, unknown> }, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

async function processWpEvent(site: WpSiteRow, type: string, payload: Record<string, unknown>): Promise<void> {
  if (type === 'ping') {
    await WordpressService.touchSite(site.id, 'CONNECTED');
    return;
  }

  if (type === 'product.published' || type === 'product.updated') {
    const parsed = z.object({ product: z.unknown() }).safeParse(payload);
    const productPayload = parsed.success ? parsed.data.product : payload;
    const product = parseProduct(productPayload);
    if (product === null) {
      logger.warn('wp_event_invalid_product', { siteId: site.id, type });
      return;
    }

    const productId = await WordpressService.upsertProduct(site, product);

    if (type === 'product.published') {
      // v1 decision: DRAFT post + notification (user publishes manually).
      const body = buildProductPostBody(product);
      const inserted = await db
        .insert(posts)
        .values({
          userId: site.userId,
          title: product.title.slice(0, 190),
          body,
          status: 'DRAFT',
        })
        .$returningId();
      const postId = inserted[0]?.id !== undefined ? Number(inserted[0].id) : null;

      const title = 'محصول جدید برای انتشار آماده است';
      const notificationBody = `محصول «${product.title.slice(0, 80)}» از سایت شما دریافت شد و به‌صورت پیش‌نویس آماده انتشار است.`;
      const notificationId = await createProductNotification(site.userId, title, notificationBody);
      await enqueueOutbox(db, {
        aggregateType: 'notification',
        aggregateId: notificationId,
        eventType: 'notification.fanout',
        payload: { notificationId, userId: site.userId, text: `${title} — ${notificationBody}` },
      });

      AnalyticsService.trackEvent({
        userId: site.userId,
        type: 'wordpress.product.published',
        subjectType: 'wordpress_site',
        subjectId: site.id,
        data: { productId, postId: postId ?? undefined },
      });
    } else {
      const title = 'به‌روزرسانی قیمت محصول';
      const notificationBody = `اطلاعات محصول «${product.title.slice(0, 80)}» به‌روزرسانی شد.`;
      await createProductNotification(site.userId, title, notificationBody);
      AnalyticsService.trackEvent({
        userId: site.userId,
        type: 'wordpress.product.updated',
        subjectType: 'wordpress_site',
        subjectId: site.id,
        data: { productId },
      });
    }
  }
}

function parseProduct(raw: unknown): ProductPayload | null {
  const parsed = PRODUCT_PAYLOAD_SCHEMA.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function createProductNotification(userId: number, title: string, body: string): Promise<number> {
  return createNotification(db, { userId, category: 'PUBLISHING', title, body });
}

export function registerWordpressRoutes(app: FastifyInstance): void {
  /* ------------------------------- Sites CRUD ------------------------------- */
  app.get('/api/v1/wordpress/sites', { preHandler: requireAuth }, async (request, reply) => {
    const sites = await WordpressService.listSites(request.currentUser!.id);
    return sendOk(reply, { items: sites });
  });

  app.post('/api/v1/wordpress/sites', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z
      .object({ siteUrl: z.string().url().max(255), siteName: z.string().max(190).optional() })
      .safeParse(request.body);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const { site, secret } = await WordpressService.createSite(request.currentUser!.id, parsed.data);
    return sendOk(
      reply,
      {
        site: serializeSite(site),
        secret, // shown ONCE
        instructions: WordpressService.pairingInstructions(site, secret),
      },
      201,
    );
  });

  app.post('/api/v1/wordpress/sites/:id/rotate-secret', { preHandler: requireAuth }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    const { secret } = await WordpressService.rotateSecret(request.currentUser!.id, params.data.id);
    return sendOk(reply, { secret, instructions: 'کلید جدید فقط همین یک بار نمایش داده می‌شود؛ آن را در افزونه به‌روزرسانی کنید.' });
  });

  app.delete('/api/v1/wordpress/sites/:id', { preHandler: requireAuth }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    await WordpressService.revokeSite(request.currentUser!.id, params.data.id);
    return sendOk(reply, { ok: true });
  });

  app.get('/api/v1/wordpress/sites/:id/products', { preHandler: requireAuth }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    const parsed = PaginationSchema.safeParse(request.query);
    if (!parsed.success) throw validationError('داده‌های ورودی معتبر نیستند.', parsed.error.flatten());
    const { items, total } = await WordpressService.listProducts(
      request.currentUser!.id,
      params.data.id,
      parsed.data.page,
      parsed.data.limit,
    );
    return sendOk(reply, { items, total, page: parsed.data.page, limit: parsed.data.limit });
  });

  app.post('/api/v1/wordpress/sites/:id/sync', { preHandler: requireAuth }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) throw validationError('داده‌های ورودی معتبر نیستند.', params.error.flatten());
    const site = await WordpressService.getSite(request.currentUser!.id, params.data.id);
    const queued = await enqueue('wp-sync', 'pull', { siteId: site.id });
    if (!queued) {
      throw providerError('صف پردازش در دسترس نیست. لطفاً چند لحظه بعد تلاش کنید.');
    }
    return sendOk(reply, { queued: true, siteId: site.id }, 202);
  });

  /* --------------------------- Plugin webhook (public) --------------------------- */
  app.register(async (scope) => {
    await scope.register(rawBodyPlugin);

    scope.post(
      '/api/v1/webhooks/wordpress/:publicId',
      { config: { csrf: false }, ...webhookLimiter.config, bodyLimit: MAX_WEBHOOK_BODY_BYTES },
      async (request, reply) => {
        const publicId = (request.params as Record<string, string | undefined>)['publicId'] ?? '';
        const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.from(String(request.body ?? ''));

        const site = await WordpressService.findSiteByPublicId(publicId);
        const signature = readHeader(request, 'x-postyar-signature');
        const timestamp = readHeader(request, 'x-postyar-timestamp');
        const valid =
          site !== null &&
          site.status !== 'REVOKED' &&
          WordpressService.verifyWebhookSignature(site, rawBody, signature, timestamp);

        if (!valid) {
          // Never reveal WHY (unknown site / revoked / bad signature / bad timestamp).
          logger.warn('wp_webhook_rejected', { publicId: publicId.slice(0, 16) });
          return reply.status(401).send({
            success: false,
            error: { code: 'UNAUTHENTICATED', message: 'امضای وب‌هوک معتبر نیست.', requestId: request.id },
          });
        }

        const eventId =
          readHeader(request, 'x-postyar-event-id') ??
          // Missing header: derive a stable-per-request id from body+timestamp
          // so a NULL dedupe key cannot collapse unrelated events.
          createHash('sha256').update(rawBody).update(readHeader(request, 'x-postyar-timestamp') ?? '').digest('hex');
        let eventType = 'unknown';
        let payload: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
          if (typeof parsed['type'] === 'string') eventType = parsed['type'];
          if (typeof parsed['payload'] === 'object' && parsed['payload'] !== null) {
            payload = parsed['payload'] as Record<string, unknown>;
          } else {
            payload = parsed;
          }
        } catch {
          return sendOk(reply, { ok: false, error: 'invalid_json' });
        }

        // Dedupe by event id (uq_wp_events_dedupe).
        let insertedId: number | null = null;
        try {
          const inserted = await db
            .insert(wpEvents)
            .values({
              siteId: site.id,
              type: eventType.slice(0, 60),
              externalEventId: eventId !== null ? eventId.slice(0, 128) : null,
              signatureValid: true,
              payload,
            })
            .$returningId();
          insertedId = inserted[0]?.id !== undefined ? Number(inserted[0].id) : null;
        } catch (err) {
          if (isDuplicateKeyError(err)) {
            return sendOk(reply, { ok: true, duplicate: true });
          }
          throw err;
        }

        try {
          await processWpEvent(site, eventType, payload);
        } catch (err) {
          logger.warn('wp_event_processing_failed', {
            siteId: site.id,
            type: eventType,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        if (insertedId !== null) {
          await db.update(wpEvents).set({ processedAt: new Date() }).where(eq(wpEvents.id, insertedId));
        }

        return sendOk(reply, { ok: true });
      },
    );
  });
}

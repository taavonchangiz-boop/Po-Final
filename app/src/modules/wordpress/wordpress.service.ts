/**
 * WordPress connector service: site pairing (publicId + HMAC secret shown
 * once), rotation, revocation and synced-product reads.
 *
 * v1 auto-publish behavior (documented decision): on `product.published`
 * webhooks we create a DRAFT post from the product template and notify the
 * user — the user publishes manually. The plugin can still push events; no
 * message is ever sent to a channel without explicit user action.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { encryptSecret, decryptSecret, randomToken } from '../../core/crypto.js';
import { AnalyticsService } from '../../core/events.js';
import { notFound } from '../../core/errors.js';
import { assertSafePublicUrl } from '../../core/http.js';
import { faMoney } from '../../core/jalali.js';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { wpEvents, wpProducts, wordpressSites } from '../../db/schema.js';

export type WpSiteRow = typeof wordpressSites.$inferSelect;
export type WpProductRow = typeof wpProducts.$inferSelect;

export const PRODUCT_PAYLOAD_SCHEMA = z.object({
  id: z.union([z.string().max(64), z.number()]),
  title: z.string().min(1).max(255),
  price: z.number().min(0).nullable().optional(),
  stock: z.number().int().nullable().optional(),
  permalink: z.string().max(500).nullable().optional(),
  categories: z.array(z.string().max(100)).max(20).optional(),
});

export type ProductPayload = z.infer<typeof PRODUCT_PAYLOAD_SCHEMA>;

/** Human-readable Rial price for post bodies (server-side Persian formatting). */
export function formatRial(price: number | null | undefined): string {
  if (price === null || price === undefined || !Number.isFinite(price)) return '';
  return faMoney(Math.round(price));
}

export function buildProductPostBody(product: ProductPayload): string {
  const lines: string[] = [product.title];
  const price = formatRial(product.price ?? null);
  if (price.length > 0) lines.push('', `قیمت: ${price}`);
  if (product.permalink) lines.push('', product.permalink);
  return lines.join('\n').slice(0, 3000);
}

/** Serialized site for clients — secretEncrypted never leaves the service. */
export function serializeSite(site: WpSiteRow): Omit<WpSiteRow, 'secretEncrypted'> {
  const { secretEncrypted: _secretEncrypted, ...rest } = site;
  return rest;
}

export const WordpressService = {
  async listSites(userId: number): Promise<Array<Omit<WpSiteRow, 'secretEncrypted'>>> {
    const rows = await db
      .select({
        id: wordpressSites.id,
        userId: wordpressSites.userId,
        siteUrl: wordpressSites.siteUrl,
        siteName: wordpressSites.siteName,
        publicId: wordpressSites.publicId,
        status: wordpressSites.status,
        lastSeenAt: wordpressSites.lastSeenAt,
        lastError: wordpressSites.lastError,
        createdAt: wordpressSites.createdAt,
        updatedAt: wordpressSites.updatedAt,
      })
      .from(wordpressSites)
      .where(eq(wordpressSites.userId, userId))
      .orderBy(desc(wordpressSites.id));
    return rows;
  },

  async getSite(userId: number, siteId: number): Promise<WpSiteRow> {
    const rows = await db
      .select()
      .from(wordpressSites)
      .where(and(eq(wordpressSites.id, siteId), eq(wordpressSites.userId, userId)))
      .limit(1);
    const site = rows[0];
    if (!site) throw notFound('سایت وردپرسی یافت نشد.');
    return site;
  },

  /** Create a site; the plaintext secret is returned ONCE (pairing). */
  async createSite(userId: number, input: { siteUrl: string; siteName?: string }): Promise<{ site: WpSiteRow; secret: string }> {
    // SSRF guard at creation time — the worker re-checks every pull.
    const url = await assertSafePublicUrl(input.siteUrl);
    const normalizedUrl = `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;

    const secret = randomToken(32); // 64 hex chars
    const inserted = await db
      .insert(wordpressSites)
      .values({
        userId,
        siteUrl: normalizedUrl,
        siteName: input.siteName?.slice(0, 190) ?? url.hostname,
        publicId: randomToken(8), // 16 hex chars (not secret)
        secretEncrypted: encryptSecret(secret),
        status: 'PENDING',
      })
      .$returningId();
    const id = inserted[0]?.id;
    if (id === undefined) throw new Error('wp_site_insert_failed');

    AnalyticsService.trackEvent({
      userId,
      type: 'wordpress.site.created',
      subjectType: 'wordpress_site',
      subjectId: Number(id),
      data: { host: url.hostname },
    });

    const rows = await db.select().from(wordpressSites).where(eq(wordpressSites.id, Number(id))).limit(1);
    const site = rows[0];
    if (!site) throw new Error('wp_site_missing');
    return { site, secret };
  },

  /** Rotate the HMAC secret; new plaintext returned once. */
  async rotateSecret(userId: number, siteId: number): Promise<{ secret: string }> {
    const site = await WordpressService.getSite(userId, siteId);
    const secret = randomToken(32);
    await db
      .update(wordpressSites)
      .set({ secretEncrypted: encryptSecret(secret), updatedAt: new Date() })
      .where(eq(wordpressSites.id, site.id));
    AnalyticsService.trackEvent({
      userId,
      type: 'wordpress.site.secret_rotated',
      subjectType: 'wordpress_site',
      subjectId: site.id,
      data: {},
    });
    return { secret };
  },

  async revokeSite(userId: number, siteId: number): Promise<void> {
    const site = await WordpressService.getSite(userId, siteId);
    await db
      .update(wordpressSites)
      .set({ status: 'REVOKED', updatedAt: new Date() })
      .where(eq(wordpressSites.id, site.id));
    AnalyticsService.trackEvent({
      userId,
      type: 'wordpress.site.revoked',
      subjectType: 'wordpress_site',
      subjectId: site.id,
      data: {},
    });
  },

  async listProducts(userId: number, siteId: number, page: number, limit: number): Promise<{ items: WpProductRow[]; total: number }> {
    const site = await WordpressService.getSite(userId, siteId);
    const [items, totalRows] = await Promise.all([
      db
        .select()
        .from(wpProducts)
        .where(eq(wpProducts.siteId, site.id))
        .orderBy(desc(wpProducts.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ value: count() }).from(wpProducts).where(eq(wpProducts.siteId, site.id)),
    ]);
    return { items, total: Number(totalRows[0]?.value ?? 0) };
  },

  /* ------------------------------ webhook side ------------------------------ */

  /** HMAC-SHA256 hex of the raw body (plugin → Postyar direction). */
  computeSignature(rawBody: Buffer, secret: string): string {
    return createHmac('sha256', secret).update(rawBody).digest('hex');
  },

  /** Constant-time signature + replay-window check (5 minutes). */
  verifyWebhookSignature(site: WpSiteRow, rawBody: Buffer, signature: string | undefined, timestamp: string | undefined): boolean {
    if (signature === undefined || timestamp === undefined) return false;
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
    const expected = WordpressService.computeSignature(rawBody, decryptSecret(site.secretEncrypted));
    const presented = signature.startsWith('sha256=') ? signature.slice(7) : signature;
    if (presented.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(presented, 'utf8'));
  },

  async findSiteByPublicId(publicId: string): Promise<WpSiteRow | null> {
    const rows = await db
      .select()
      .from(wordpressSites)
      .where(eq(wordpressSites.publicId, publicId))
      .limit(1);
    return rows[0] ?? null;
  },

  /** Upsert a product from a webhook/pull payload. Returns the row id. */
  async upsertProduct(site: WpSiteRow, product: ProductPayload): Promise<number> {
    const externalId = String(product.id).slice(0, 64);
    const values = {
      siteId: site.id,
      userId: site.userId,
      externalProductId: externalId,
      title: product.title.slice(0, 255),
      price: product.price !== null && product.price !== undefined ? Math.round(product.price) : null,
      stock: product.stock ?? null,
      permalink: product.permalink ?? null,
      categories: product.categories ?? [],
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    };
    const inserted = await db
      .insert(wpProducts)
      .values(values)
      .onDuplicateKeyUpdate({
        set: {
          title: values.title,
          price: values.price,
          stock: values.stock,
          permalink: values.permalink,
          categories: values.categories,
          lastSyncedAt: values.lastSyncedAt,
          updatedAt: values.updatedAt,
        },
      })
      .$returningId();
    const id = inserted[0]?.id;
    if (id === undefined) throw new Error('wp_product_upsert_failed');
    return Number(id);
  },

  async touchSite(siteId: number, status: 'CONNECTED' | 'ERROR', lastError?: string): Promise<void> {
    await db
      .update(wordpressSites)
      .set({
        status,
        lastSeenAt: new Date(),
        lastError: lastError?.slice(0, 500) ?? null,
        updatedAt: new Date(),
      })
      .where(eq(wordpressSites.id, siteId));
  },

  pairingInstructions(site: WpSiteRow, secret: string): string {
    return [
      'اتصال افزونه پستیار:',
      `۱. افزونه «Postyar Connector» را در وردپرس نصب و فعال کنید.`,
      `۲. نشانی سایت: ${site.siteUrl}`,
      `۳. شناسه عمومی (Site Public ID): ${site.publicId}`,
      `۴. کلید امضا (Secret): ${secret}`,
      'این کلید فقط همین یک بار نمایش داده می‌شود؛ آن را در تنظیمات افزونه وارد کنید.',
    ].join('\n');
  },
};

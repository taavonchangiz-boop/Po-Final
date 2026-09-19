import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, count, desc, eq, ne } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { wordpressSites, wordpressProducts, channels, posts, postTargets, outboxEvents } from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { newId, sha256Hex } from '../../core/ids.js';
import { emitEvent } from '../../core/events.js';
import { outboxRow } from '../../core/outbox.js';
import { audit } from '../../core/audit.js';
import { getPlanContext, assertWithinLimit } from '../subscriptions/plan.service.js';

const MAX_PRODUCTS_PER_SYNC = 200;
const MAX_PUBLISH_CHANNELS = 5;

export interface WpProductInput {
  wc_id: number;
  title: string;
  price_rial?: number | null;
  permalink?: string | null;
  image_url?: string | null;
}

function normalizeSiteUrl(raw: string): string {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(ERR.VALIDATION('آدرس سایت معتبر نیست.'));
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AppError(ERR.VALIDATION('فقط آدرس‌های http و https مجاز هستند.'));
  }
  const normalized = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
  return normalized.slice(0, 255);
}

function generateHex32(): string {
  return randomBytes(16).toString('hex'); // 32 hex chars
}

export interface ConnectedSite {
  id: string;
  siteUrl: string;
  siteKey: string;
  secret: string; // returned ONCE, never stored in plaintext
}

/** Connect a WooCommerce site (plan feature `woocommerce` required, §150). */
export async function connectSite(tenantId: string, rawSiteUrl: string): Promise<ConnectedSite> {
  const ctx = await getPlanContext(tenantId);
  if (!ctx.features.woocommerce) {
    throw new AppError(ERR.FORBIDDEN());
  }
  const siteUrl = normalizeSiteUrl(rawSiteUrl);
  const db = getDb();

  const siteKey = generateHex32();
  const secret = generateHex32();
  const secretHash = await sha256Hex(secret);
  const id = newId();

  // One site per (tenant, url): reconnecting rotates the secret atomically.
  await db
    .insert(wordpressSites)
    .values({ id, tenantId, siteUrl, siteKey, secretHash, status: 'ACTIVE' })
    .onDuplicateKeyUpdate({ set: { siteKey, secretHash, status: 'ACTIVE', lastError: null } });

  const [row] = await db
    .select({ id: wordpressSites.id, siteUrl: wordpressSites.siteUrl, siteKey: wordpressSites.siteKey })
    .from(wordpressSites)
    .where(and(eq(wordpressSites.tenantId, tenantId), eq(wordpressSites.siteUrl, siteUrl)))
    .limit(1);
  if (!row) throw new AppError(ERR.INTERNAL());

  await audit({ action: 'wordpress.connected', actorId: tenantId, subjectType: 'wordpress_site', subjectId: row.id, meta: { siteUrl } });
  await emitEvent({ name: 'wordpress.connected', tenantId, subjectType: 'wordpress_site', subjectId: row.id, props: { siteUrl } });
  return { id: row.id, siteUrl: row.siteUrl, siteKey: row.siteKey, secret };
}

export async function listSites(tenantId: string): Promise<Array<{ id: string; siteUrl: string; siteKey: string; status: string; autoPublish: number; lastSyncAt: Date | null; createdAt: Date }>> {
  const db = getDb();
  const rows = await db
    .select({
      id: wordpressSites.id,
      siteUrl: wordpressSites.siteUrl,
      siteKey: wordpressSites.siteKey,
      status: wordpressSites.status,
      autoPublish: wordpressSites.autoPublish,
      lastSyncAt: wordpressSites.lastSyncAt,
      createdAt: wordpressSites.createdAt,
    })
    .from(wordpressSites)
    .where(eq(wordpressSites.tenantId, tenantId))
    .orderBy(desc(wordpressSites.createdAt));
  return rows;
}

export async function updateSiteSettings(tenantId: string, siteId: string, autoPublish: boolean) {
  const db = getDb();
  await db
    .update(wordpressSites)
    .set({ autoPublish: autoPublish ? 1 : 0 })
    .where(and(eq(wordpressSites.tenantId, tenantId), eq(wordpressSites.id, siteId)));
  const [site] = await db
    .select({ id: wordpressSites.id, autoPublish: wordpressSites.autoPublish })
    .from(wordpressSites)
    .where(and(eq(wordpressSites.tenantId, tenantId), eq(wordpressSites.id, siteId)))
    .limit(1);
  if (!site) throw new AppError(ERR.NOT_FOUND('سایت'));
  return site;
}

async function ownedSite(tenantId: string, siteId: string) {
  const db = getDb();
  const [site] = await db
    .select()
    .from(wordpressSites)
    .where(and(eq(wordpressSites.id, siteId), eq(wordpressSites.tenantId, tenantId)))
    .limit(1);
  if (!site) throw new AppError(ERR.NOT_FOUND('سایت'));
  return site;
}

export async function deleteSite(tenantId: string, siteId: string): Promise<void> {
  const site = await ownedSite(tenantId, siteId);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(wordpressProducts).where(eq(wordpressProducts.siteId, site.id));
    await tx.delete(wordpressSites).where(eq(wordpressSites.id, site.id));
  });
  await audit({ action: 'wordpress.disconnected', actorId: tenantId, subjectType: 'wordpress_site', subjectId: site.id, meta: { siteUrl: site.siteUrl } });
}

/** Secret rotation: new plaintext returned ONCE; only its hash is stored. */
export async function rotateSecret(tenantId: string, siteId: string): Promise<{ secret: string }> {
  const site = await ownedSite(tenantId, siteId);
  const db = getDb();
  const secret = generateHex32();
  const secretHash = await sha256Hex(secret);
  await db.update(wordpressSites).set({ secretHash }).where(eq(wordpressSites.id, site.id));
  await audit({ action: 'wordpress.secret_rotated', actorId: tenantId, subjectType: 'wordpress_site', subjectId: site.id });
  return { secret };
}

export interface VerifiedSite {
  id: string;
  tenantId: string;
  siteUrl: string;
  status: string;
}

/**
 * Webhook authentication (§153, WORDPRESS.md): the WordPress plugin sends the
 * plaintext secret in `x-postyar-secret`; we hash it (SHA-256) and compare
 * timing-safe against the stored hash. TLS transport + per-site secret +
 * timing-safe compare = secure without storing the plaintext server-side.
 */
export async function verifySiteRequest(siteKey: string, secret: string): Promise<VerifiedSite | null> {
  if (!siteKey || !secret) return null;
  const db = getDb();
  const [site] = await db
    .select()
    .from(wordpressSites)
    .where(and(eq(wordpressSites.siteKey, siteKey), ne(wordpressSites.status, 'DISABLED')))
    .limit(1);
  if (!site) return null;
  const incomingHash = createHash('sha256').update(secret).digest('hex');
  const a = Buffer.from(incomingHash);
  const b = Buffer.from(site.secretHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { id: site.id, tenantId: site.tenantId, siteUrl: site.siteUrl, status: site.status };
}

function productContentHash(p: WpProductInput): string {
  const canonical = JSON.stringify([p.wc_id, p.title, p.price_rial ?? null, p.permalink ?? null, p.image_url ?? null]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** Idempotent product sync (§23): unchanged products (same content hash) are skipped. */
export async function syncProducts(site: VerifiedSite, products: WpProductInput[]): Promise<{ synced: number; skipped: number }> {
  if (products.length > MAX_PRODUCTS_PER_SYNC) {
    throw new AppError(ERR.VALIDATION('تعداد محصولات هر همگام‌سازی حداکثر ۲۰۰ مورد است.'));
  }
  const db = getDb();
  let synced = 0;
  let skipped = 0;

  for (const p of products) {
    if (!Number.isInteger(p.wc_id) || !p.title) {
      skipped++;
      continue;
    }
    const contentHash = productContentHash(p);
    const [existing] = await db
      .select({ id: wordpressProducts.id, contentHash: wordpressProducts.contentHash })
      .from(wordpressProducts)
      .where(and(eq(wordpressProducts.siteId, site.id), eq(wordpressProducts.wcProductId, p.wc_id)))
      .limit(1);

    if (existing && existing.contentHash === contentHash) {
      skipped++;
      continue;
    }

    const values = {
      title: p.title.slice(0, 255),
      priceRial: typeof p.price_rial === 'number' ? Math.max(0, Math.floor(p.price_rial)) : null,
      permalink: p.permalink?.slice(0, 255) ?? null,
      imageUrl: p.image_url?.slice(0, 512) ?? null,
      contentHash,
      lastSyncedAt: new Date(),
    };

    if (existing) {
      await db.update(wordpressProducts).set(values).where(eq(wordpressProducts.id, existing.id));
    } else {
      await db
        .insert(wordpressProducts)
        .values({ id: newId(), siteId: site.id, tenantId: site.tenantId, wcProductId: p.wc_id, ...values })
        .onDuplicateKeyUpdate({ set: values });
    }
    synced++;
  }

  await db.update(wordpressSites).set({ lastSyncAt: new Date() }).where(eq(wordpressSites.id, site.id));
  if (synced > 0) {
    await emitEvent({
      name: 'wordpress.product.synced',
      tenantId: site.tenantId,
      subjectType: 'wordpress_site',
      subjectId: site.id,
      props: { synced, skipped },
    });
  }
  return { synced, skipped };
}

/**
 * publish_product → one WORDPRESS post + targets for the tenant's first 5
 * ACTIVE channels + one outbox row per channel ('wordpress.publish') which the
 * dispatcher forwards to the delivery worker (§125).
 */
export async function publishProduct(site: VerifiedSite, product: WpProductInput): Promise<{ postId: string; channels: number }> {
  if (!Number.isInteger(product.wc_id) || !product.title) {
    throw new AppError(ERR.VALIDATION('اطلاعات محصول معتبر نیست.'));
  }
  await assertWithinLimit(site.tenantId, 'posts');

  const db = getDb();
  const priceFa = typeof product.price_rial === 'number' ? product.price_rial.toLocaleString('fa-IR') : null;
  const bodyParts = [`🛍 ${product.title}`];
  if (priceFa) bodyParts.push(`قیمت: ${priceFa} ریال`);
  if (product.permalink) bodyParts.push(product.permalink);
  const body = bodyParts.join('\n\n');

  const activeChannels = await db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.tenantId, site.tenantId), eq(channels.status, 'ACTIVE')))
    .orderBy(channels.createdAt)
    .limit(MAX_PUBLISH_CHANNELS);
  if (activeChannels.length === 0) {
    throw new AppError(ERR.VALIDATION('کانال فعالی برای انتشار محصول یافت نشد.'));
  }

  const postId = newId();
  await db.transaction(async (tx) => {
    await tx.insert(posts).values({
      id: postId,
      tenantId: site.tenantId,
      title: product.title.slice(0, 190),
      body,
      source: 'WORDPRESS',
      state: 'QUEUED',
    });

    for (const ch of activeChannels) {
      const targetId = newId();
      await tx.insert(postTargets).values({
        id: targetId,
        postId,
        tenantId: site.tenantId,
        channelId: ch.id,
        state: 'PENDING',
      });
      await tx.insert(outboxEvents).values(
        outboxRow({
          aggregateType: 'wordpress',
          aggregateId: site.id,
          eventType: 'wordpress.publish',
          payload: {
            tenantId: site.tenantId,
            siteId: site.id,
            productId: product.wc_id,
            channelId: ch.id,
            targetId,
            postId,
            title: product.title,
            body,
            imageUrl: product.image_url ?? null,
          },
        })
      );
    }

    // upsert product + stamp publish time
    const values = {
      title: product.title.slice(0, 255),
      priceRial: typeof product.price_rial === 'number' ? Math.max(0, Math.floor(product.price_rial)) : null,
      permalink: product.permalink?.slice(0, 255) ?? null,
      imageUrl: product.image_url?.slice(0, 512) ?? null,
      contentHash: productContentHash(product),
      lastSyncedAt: new Date(),
      lastPublishedAt: new Date(),
    };
    await tx
      .insert(wordpressProducts)
      .values({ id: newId(), siteId: site.id, tenantId: site.tenantId, wcProductId: product.wc_id, ...values })
      .onDuplicateKeyUpdate({ set: values });
  });

  await emitEvent({
    name: 'wordpress.product.published',
    tenantId: site.tenantId,
    subjectType: 'wordpress_site',
    subjectId: site.id,
    props: { productId: product.wc_id, channels: activeChannels.length },
  });
  await audit({ action: 'wordpress.product_published', actorId: site.tenantId, subjectType: 'wordpress_site', subjectId: site.id, meta: { productId: product.wc_id, channels: activeChannels.length } });

  return { postId, channels: activeChannels.length };
}

export async function listProducts(
  tenantId: string,
  page: number,
  pageSize: number
): Promise<{ items: Array<{ id: string; siteId: string; wcProductId: number; title: string; priceRial: number | null; permalink: string | null; imageUrl: string | null; lastSyncedAt: Date | null; lastPublishedAt: Date | null }>; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const p = Math.max(1, page);
  const size = Math.min(100, Math.max(1, pageSize));
  const [totalRow] = await db.select({ value: count() }).from(wordpressProducts).where(eq(wordpressProducts.tenantId, tenantId));
  const rows = await db
    .select({
      id: wordpressProducts.id,
      siteId: wordpressProducts.siteId,
      wcProductId: wordpressProducts.wcProductId,
      title: wordpressProducts.title,
      priceRial: wordpressProducts.priceRial,
      permalink: wordpressProducts.permalink,
      imageUrl: wordpressProducts.imageUrl,
      lastSyncedAt: wordpressProducts.lastSyncedAt,
      lastPublishedAt: wordpressProducts.lastPublishedAt,
    })
    .from(wordpressProducts)
    .where(eq(wordpressProducts.tenantId, tenantId))
    .orderBy(desc(wordpressProducts.lastSyncedAt))
    .limit(size)
    .offset((p - 1) * size);

  return {
    items: rows.map((r) => ({ ...r, wcProductId: Number(r.wcProductId), priceRial: r.priceRial === null ? null : Number(r.priceRial) })),
    total: Number(totalRow?.value ?? 0),
    page: p,
    pageSize: size,
  };
}

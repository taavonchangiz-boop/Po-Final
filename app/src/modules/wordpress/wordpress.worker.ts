/**
 * WordPress pull-sync worker: fetches products from the site's Postyar
 * Connector endpoint with SSRF-guarded, signed requests and upserts them.
 *
 * Signature contract (pull direction): we send
 *   X-Postyar-Signature: sha256=HMAC_SHA256(secret, timestamp + "\n" + body) (hex)
 *   X-Postyar-Timestamp: unix seconds
 *   X-Postyar-Site: publicId
 * For GET the body is empty, so the preimage is `timestamp + "\n"`.
 * The plugin verifies these; the response itself is trusted only over TLS
 * from the SSRF-validated origin (pull responses are not signed in v1).
 */
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { decryptSecret } from '../../core/crypto.js';
import { logger } from '../../core/logger.js';
import { assertSafePublicUrl, fetchWithTimeout } from '../../core/http.js';
import { db } from '../../db/client.js';
import { wordpressSites } from '../../db/schema.js';
import {
  WordpressService,
  PRODUCT_PAYLOAD_SCHEMA,
  type ProductPayload,
  type WpSiteRow,
} from './wordpress.service.js';

const PULL_TIMEOUT_MS = 30_000;
const MAX_PRODUCTS = 50;

export interface WpSyncData {
  siteId: number;
}

/** Canonical signature preimage: timestamp + "\n" + body (empty for GET). */
function signPullRequest(secret: string, timestamp: string): string {
  return createHmac('sha256', secret).update(`${timestamp}\n`).digest('hex');
}

function parseProducts(json: unknown): ProductPayload[] {
  const list = Array.isArray(json)
    ? json
    : Array.isArray((json as { products?: unknown })?.products)
      ? ((json as { products: unknown[] }).products as unknown[])
      : [];
  const out: ProductPayload[] = [];
  for (const item of list.slice(0, MAX_PRODUCTS)) {
    const parsed = PRODUCT_PAYLOAD_SCHEMA.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Pull-sync one site. Never throws at the top level (queue consumer logs). */
export async function runWpSync(data: WpSyncData): Promise<{ ok: boolean; synced?: number; error?: string }> {
  if (!data || typeof data.siteId !== 'number') return { ok: false, error: 'invalid_payload' };

  const rows = await db.select().from(wordpressSites).where(eq(wordpressSites.id, data.siteId)).limit(1);
  const site: WpSiteRow | null = rows[0] ?? null;
  if (!site) return { ok: false, error: 'site_not_found' };
  if (site.status === 'REVOKED') return { ok: false, error: 'site_revoked' };

  let secret: string;
  try {
    secret = decryptSecret(site.secretEncrypted);
  } catch {
    await WordpressService.touchSite(site.id, 'ERROR', 'کلید امضا قابل خواندن نیست.');
    return { ok: false, error: 'secret_decrypt_failed' };
  }

  let url: URL;
  try {
    url = await assertSafePublicUrl(`${site.siteUrl.replace(/\/+$/, '')}/wp-json/postyar-connector/v1/products?per_page=${MAX_PRODUCTS}`);
  } catch (err) {
    await WordpressService.touchSite(site.id, 'ERROR', `SSRF_BLOCKED: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500));
    return { ok: false, error: 'ssrf_blocked' };
  }

  try {
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await fetchWithTimeout(
      url.toString(),
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'X-Postyar-Signature': `sha256=${signPullRequest(secret, ts)}`,
          'X-Postyar-Timestamp': ts,
          'X-Postyar-Site': site.publicId,
        },
      },
      PULL_TIMEOUT_MS,
    );

    if (!res.ok) {
      await WordpressService.touchSite(site.id, 'ERROR', `پاسخ ${res.status} از سایت دریافت شد.`);
      return { ok: false, error: `http_${res.status}` };
    }

    const json: unknown = await res.json().catch(() => null);
    const products = parseProducts(json);
    for (const product of products) {
      await WordpressService.upsertProduct(site, product);
    }

    await WordpressService.touchSite(site.id, 'CONNECTED');

    return { ok: true, synced: products.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('wp_sync_failed', { siteId: site.id, error: message });
    await WordpressService.touchSite(site.id, 'ERROR', 'همگام‌سازی با سایت ناموفق بود.');
    return { ok: false, error: message.slice(0, 200) };
  }
}

/** Product payload schema re-export for the webhook route. */
export { PRODUCT_PAYLOAD_SCHEMA, type ProductPayload };

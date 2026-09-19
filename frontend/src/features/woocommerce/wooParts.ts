import { faMoney } from '../../lib/format';

/**
 * WooCommerce feature shared bits (task 4-d-2): site status labels and the
 * client mirror of buildProductPostBody (wordpress.service.ts) used to prefill
 * a DRAFT post from a synced product.
 */

/** wordpress_sites.status enum: PENDING | CONNECTED | ERROR | REVOKED. */
export const siteStatusLabels: Record<string, string> = {
  PENDING: 'در انتظار اتصال',
  CONNECTED: 'متصل',
  ERROR: 'خطا',
  REVOKED: 'باطل‌شده',
};

export const siteStatusTones: Record<string, 'info' | 'success' | 'danger' | 'neutral'> = {
  PENDING: 'info',
  CONNECTED: 'success',
  ERROR: 'danger',
  REVOKED: 'neutral',
};

export interface WpProductRecord {
  id: number | string;
  siteId?: number;
  externalProductId?: string;
  title?: string;
  price?: number | null;
  stock?: number | null;
  permalink?: string | null;
  categories?: string[] | null;
  lastSyncedAt?: string | null;
  updatedAt?: string | null;
}

/**
 * Mirror of the server-side buildProductPostBody(): title + Rial price +
 * permalink, capped at 3000 chars — the same template the backend uses when a
 * product.published webhook creates the DRAFT post.
 */
export function buildProductBody(product: WpProductRecord): string {
  const lines: string[] = [product.title ?? ''];
  if (typeof product.price === 'number' && Number.isFinite(product.price)) {
    lines.push('', `قیمت: ${faMoney(Math.round(product.price))}`);
  }
  if (product.permalink) lines.push('', product.permalink);
  return lines.join('\n').slice(0, 3000);
}

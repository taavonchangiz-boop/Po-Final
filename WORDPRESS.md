# Postyar × WordPress — Connector (engineering doc)

Companion docs: `docs/WORDPRESS.md` (Persian, wire-protocol v1 — normative) · [API.md](API.md) → WordPress section.

## 1. Status

- **SaaS side: fully implemented** — `app/src/modules/wordpress/{wordpress.routes.ts,wordpress.service.ts}`, tables `wordpress_sites` / `wordpress_products`, webhook ingestion with product change detection and channel fan-out through the transactional outbox (`wordpress.publish` → `deliver-product`).
- **Plugin side: implemented** — `wordpress-plugin/postyar-connector/` v1.0.0 (~1,500 lines: `class-pyc-{sync,ajax,admin,settings,db}.php`, `uninstall.php`, admin CSS/JS). Product save hooks enqueue a bounded queue; a debounced single cron event (`pyc_sync_cron`, +10 min, retry hook `pyc_retry` max 3 tries) drains it in batches of 50 products per HTTP call (≤200 accepted server-side) to `{saas_url}/api/v1/webhooks/wordpress` with the secret **in headers only** (never in a query string). Admin screen: settings save via `admin_post`, AJAX handlers (`pyc_test_connection`, `pyc_sync_batch`, `pyc_get_status`) all guarded by nonce `pyc_admin` + `manage_options`; connection test + status panel expose next-cron time. Deactivation clears the plugin's scheduled events; upgrade re-runs idempotent `dbDelta` on DB-version change; uninstall performs a full local wipe (options, tables, cron events).

## 2. Security model (implemented server-side)

1. Connect (`POST /api/v1/wordpress/sites`) generates `site_key` (32-hex) + `secret` (32-hex). Server stores **only** `secret_hash = SHA-256(secret)`; the plaintext secret is returned **exactly once** (same on rotate).
2. Every plugin request carries headers `x-postyar-site-key` and `x-postyar-secret`; server compares `sha256(header secret)` with the stored hash via `crypto.timingSafeEqual`.
3. Transport must be HTTPS; secrets never appear in URLs (header-only → never in access logs); webhook rate limit 60 req/min; plan feature gate `woocommerce` (403 `FORBIDDEN` without it).
4. Why header-secret instead of HMAC: the server keeps no plaintext, so it cannot recompute body HMACs; timing-safe hash comparison + HTTPS + per-site secret + rate limiting is the equivalent-security trade-off documented in `docs/WORDPRESS.md`.

## 3. Connect flow (tenant perspective)

1. Dashboard → WooCommerce → «اتصال سایت» → enter site URL → server returns `site_key` + one-time `secret` (copyable box, «این کلید فقط یک‌بار نمایش داده می‌شود»).
2. On the WordPress site, install the **Postyar Connector** plugin (Plugins → Add New → upload `wordpress-plugin/postyar-connector` as a zip) and paste the SaaS URL + `site_key` + `secret` in its settings screen.
3. The plugin enqueues the catalog and drains it via its debounced cron (`pyc_sync_cron`, first run +10 min, batches of 50); «اتصال آزمایشی» (test connection) verifies the credentials against the server; `wordpress_sites.status` becomes `ACTIVE` on successful traffic; «rotate secret» invalidates the old secret atomically.

## 4. Sync & publish behavior (implemented)

- **`sync_products`** (≤200 products/call): for each `{wc_id,title,price_rial?,permalink?,image_url?}` the server computes `content_hash = SHA-256(fields)`; unchanged products are skipped → sync is **idempotent**. Response: `{synced,skipped}`.
- **`publish_product`**: enforces the plan post quota (`QUOTA_EXCEEDED`), creates a `posts` row with `source=WORDPRESS`, state `QUEUED`, one `post_target` per ACTIVE channel (≤5), and one outbox row per target (`event_type='wordpress.publish'`) → dispatcher → `delivery` queue → provider adapters (capability soft-strip applies: e.g. no HTML where `htmlParseMode=false`).
- `auto_publish` toggle per site; products table exposes `last_synced_at` / `last_published_at`.

## 5. Diagnostics

- **Server side (today)**: `GET /api/v1/wordpress/sites` (status, `last_sync_at`, `last_error`), products page (`lastSyncedAt/lastPublishedAt`), failed webhook responses return structured codes (`UNAUTHORIZED`, `VALIDATION_ERROR`, `QUOTA_EXCEEDED`) with `requestId`.
- **Plugin side**: the admin screen ships a **test connection** action (`pyc_test_connection` → server-verified key/secret round-trip), a batched manual **sync** (`pyc_sync_batch`, BATCH_SIZE=50 per request with progress), and a status panel (`pyc_get_status`) showing queue size, last result, and next scheduled cron run. Failures are surfaced in Persian in the WP admin.
- Ops: `SELECT site_key, status, last_error, last_sync_at FROM wordpress_sites;` and `bull:delivery` queue inspection (OPERATIONS.md §4).

## 6. Update & uninstall (implemented)

- **Update**: on DB-version change the plugin re-runs **idempotent `dbDelta`**; settings and site binding survive upgrades (rotate secret instead of reconnect).
- **Deactivate**: clears all plugin cron events (`pyc_sync_cron`, `pyc_retry`); the local queue option is preserved — the next product change or manual sync re-schedules.
- **Uninstall** (`uninstall.php`): full local wipe — plugin options, custom tables, and both scheduled events; the SaaS keeps `wordpress_sites` rows until the tenant disconnects (`DELETE /api/v1/wordpress/sites/:id`), which cascades the site's products.

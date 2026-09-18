# AUDIT — woo-hooman-channel-manager (Hooman Web Channels Manager, WooCommerce edition)

- Auditor: Team B (Task 2-b), forensic audit for the Postyar rebuild
- Reference: `/home/z/my-project/reference/po.source/woo-hooman-channel-manager/` (READ-ONLY, 18 files, ~269 KB text + 2 woff2 fonts)
- Version audited: **9.7.1** (`WHCM_VERSION`, bootstrap line 16)
- Method: every PHP file read end-to-end (all 1,618 lines of the admin class included), both JS files read fully, CSS/README/CHANGELOG reviewed. All claims below carry `file:line` evidence against the reference tree.

---

## 1. File inventory (all 18 files)

| # | Path | Type | Purpose | Key hooks / endpoints | DB tables touched | External calls | Disposition in Postyar Connector |
|---|------|------|---------|----------------------|-------------------|----------------|----------------------------------|
| 1 | `woo-hooman-channel-manager.php` | PHP bootstrap | Version consts, requires, lifecycle, click tracker, webhook router, live price sync | `register_activation_hook` L36, `register_deactivation_hook` L37, `plugins_loaded` @99 L39, `whcm_gold_tick` L49, `init` click tracker L55, `init` @1 webhook L77, `woocommerce_update_product` @20 L110 | all 7 via `WHCM_DB::track_click`, `find_sent_channel_messages_for_product` | Telegram/Bale `editMessageCaption` (indirect) | **REBUILD** (split into Connector bootstrap + webhook controller) |
| 2 | `includes/class-whcm-db.php` | PHP class (527 L) | Schema install/upgrade, channels CRUD, link/button config, message & stats records, click tracking | — | creates: `whcm_posts`, `whcm_clicks`, `whcm_inbox`, `whcm_autoresponders`, `whcm_channels`, `whcm_channel_messages`, `whcm_post_channel_stats` | none | **REBUILD** (schema + repository layer) |
| 3 | `includes/class-whcm-cron.php` | PHP class (332 L) | WP-Cron schedules, queue worker, getUpdates polling, Woo auto-publish | `transition_post_status` L9, `cron_schedules` L10, `whcm_process_queue_event` L13, `whcm_process_scheduled_post` L15, `whcm_poll_updates` L17, `init` @20 self-heal L41 | `whcm_posts` (insert/update), `whcm_channels` (webhook state) | Telegram/Bale `getUpdates`, `deleteWebhook` | **REBUILD** (replace with real queue + schedulers) |
| 4 | `includes/class-whcm-ai.php` | PHP class (124 L) | AI sales-copy generation, OpenAI-compatible | — | none | `wp_remote_post` to configurable Chat Completions URL L66 | **REBUILD** (SaaS-side AI proxy; never ship admin-supplied URL) |
| 5 | `includes/class-whcm-inbox.php` | PHP class (108 L) | Webhook/getUpdates ingest → inbox rows + keyword autoresponder | called from webhook router & cron | `whcm_inbox`, `whcm_autoresponders` | `sendMessage` reply L101 | **REBUILD** |
| 6 | `includes/class-whcm-roi.php` | PHP class (58 L) | Order-source attribution from cookie; channel coupon factory (dead code) | `woocommerce_checkout_order_processed` L9 | `wp_postmeta` (`_whcm_order_source`), WC coupons | none | **REJECT** coupon factory (dead code, L33–56 never called); attribution **REBUILD** with proper order-meta API |
| 7 | `includes/class-whcm-sender.php` | PHP class (287 L) | Caption builder, inline keyboards, send pipeline (Telegram/Bale), webhook mgmt | — | `whcm_channel_messages`, `whcm_post_channel_stats` (via DB) | `sendPhoto`/`sendVideo`/`sendMessage`/`editMessageCaption`/`getMe`/`setWebhook`/`deleteWebhook` | **REBUILD** (core delivery service) |
| 8 | `includes/class-whcm-gold.php` | PHP class (358 L) | Gold-rate fetch/parse, Persian formatting, Jalali date, template message, scheduled publish | scheduled via `whcm_gold_tick` | options `whcm_last_gold` | `wp_remote_get` to admin-supplied JSON API L159 | **REBUILD** (server-side price service) |
| 9 | `includes/class-whcm-image-editor.php` | PHP class (80 L) | GD watermark bar overlay + disk cache | — | writes `uploads/whcm-branded/` | none | **CONCEPT_ONLY** (move to SaaS image worker; plugin-side GD is a perf/liability risk) |
| 10 | `includes/class-whcm-admin.php` | PHP class (1,618 L) | Whole admin UI: 6 tabs, 20 AJAX endpoints, settings save | `admin_menu` L9, `admin_enqueue_scripts` L10, `wp_dashboard_setup` L11, 20× `wp_ajax_*` L13–36 | all 7 tables + options | via Sender/Gold/AI classes | **REJECT as code / REBUILD as spec** (React/REST UI in Postyar; the behaviors below are the contract) |
| 11 | `assets/js/admin.js` | JS (495 L) | Live preview, Woo product prefill, AI UI, gold UI, channel CRUD, Jalali→Gregorian conversion, feedback modal | jQuery AJAX → `admin-ajax.php` (20 actions) | — | — | **REJECT** (superseded by Postyar front-end; logic spec kept) |
| 12 | `assets/js/jalali-picker.js` | JS (172 L) | jalaali-js port (jalCal/g2d/d2g/j2d/d2j) + custom datepicker | exposes `window.whcmJalali` L69 | — | none | **REBUILD** (reuse algorithm; clean-room JS module) |
| 13 | `assets/css/admin.css` | CSS (249 L) | RTL dashboard styling, Vazirmatn @font-face, glassmorphism, datepicker styles | — | — | none | **REJECT** (visual rework; keep font choice) |
| 14 | `assets/fonts/Vazirmatn-Bold.woff2` | font | Persian UI font | — | — | — | **REJECT/REPLACE** with Postyar asset pipeline (same family acceptable) |
| 15 | `assets/fonts/Vazirmatn-Regular.woff2` | font | Persian UI font | — | — | — | **REJECT/REPLACE** (same) |
| 16 | `uninstall.php` | PHP (34 L) | Uninstall cleanup | — | `DROP TABLE` ×6 (missing `whcm_post_channel_stats`!), options | none | **REBUILD** (see §10.3) |
| 17 | `CHANGELOG.md` | docs (165 L) | History 8.0.0 → 9.7.1 | — | — | — | **KEEP as reference** for behavioral parity checklist |
| 18 | `README_FA.txt` | docs (94 L) | Persian feature/marketing doc | — | — | — | **KEEP as reference** |

Class inventory actually found (8 runtime classes, not 11 — the "admin/ai/cron/db/gold/image-editor/inbox/roi/sender" list is correct but the class names are): `WHCM_DB`, `WHCM_Image_Editor`, `WHCM_AI_Copywriter`, `WHCM_Inbox`, `WHCM_ROI_Tracker`, `WHCM_Sender`, `WHCM_Cron`, `WHCM_Gold`, `WHCM_Admin` (9 classes total incl. admin). No traits/interfaces. No namespaces. No third-party PHP libs (JS jalaali algorithm is an inline port).

---

## 2. Bootstrap & lifecycle

`woo-hooman-channel-manager.php`:

- L16–18: `WHCM_VERSION` '9.7.1', `WHCM_PLUGIN_DIR`, `WHCM_PLUGIN_URL`.
- L20–27: always-loads: DB, Image_Editor, AI, Inbox, ROI, Sender, Cron, Gold. L29–31: Admin only when `is_admin()`.
- L36: activation → `WHCM_DB::install()` (creates/repairs schema, seeds defaults).
- L37: deactivation → `WHCM_Cron::deactivate()` (unschedules `whcm_process_queue_event`, `whcm_poll_updates`, `whcm_gold_tick` — cron.php L124–131; **does not** clear per-post single events `whcm_process_scheduled_post`).
- L39–46: `plugins_loaded` @99 → `WHCM_DB::init()` (option seeding + version-triggered reinstall), `WHCM_Cron::init()`, `WHCM_Gold::schedule()`, admin init if admin.
- L49: cron action `whcm_gold_tick` → `WHCM_Gold::tick`.
- Upgrade path: `WHCM_DB::init()` L235–237 re-runs `install()` (dbDelta + `add_column_if_missing` ALTERs) whenever `whcm_db_version` ≠ `WHCM_VERSION`. No downgrade/rollback handling; `dbDelta` on every changed version.

## 3. Hook map (WordPress + WooCommerce)

**WP actions/filters registered**

| Hook | Where | Callback | Priority/args |
|---|---|---|---|
| `plugins_loaded` | bootstrap L39 | closure (DB/Cron/Gold/Admin init) | 99 |
| `init` | bootstrap L55 | click-tracker router | default 10 |
| `init` | bootstrap L77 | webhook router | 1 |
| `init` | cron L41 | `maybe_process_due` (self-heal) | 20 |
| `whcm_gold_tick` | bootstrap L49 | `WHCM_Gold::tick` | — |
| `whcm_process_queue_event` | cron L13 | `process_scheduled_queue` | — |
| `whcm_process_scheduled_post` | cron L15 | `process_scheduled_post` (1 arg) | 10/1 |
| `whcm_poll_updates` | cron L17 | `poll_updates` | — |
| `transition_post_status` | cron L9 | `on_woo_product_publish` | 10/3 |
| `cron_schedules` (filter) | cron L10 | `add_cron_intervals` (10 recurrences) | — |
| `admin_menu` | admin L9 | `add_menu` | — |
| `admin_enqueue_scripts` | admin L10 | `enqueue_assets` | — |
| `wp_dashboard_setup` | admin L11 | `register_dashboard_widget` | — |
| `wp_ajax_*` ×20 | admin L13–36 | see §8 | — |

**WooCommerce hooks**: `transition_post_status` (product publish, cron L137–192), `woocommerce_update_product` @20 (bootstrap L110–132, live price sync), `woocommerce_checkout_order_processed` (roi L9). Reads `wc_get_product`, `wc_get_products`, `WC_Coupon`.

**Cron recurrences added** (cron L71–113): `every_30_seconds`(30), `every_1_minute`(60), `every_2_minutes`(120), `every_5_minutes`(300), `every_15_minutes`(900), `every_30_minutes`(1800), `every_1_hour`(3600), `every_2_hours`(7200), `every_3_hours`(10800), `every_6_hours`(21600). Gold intervals (gold L269–279) reuse the 5m…6h subset + `daily_11_30` special case.

---

## 4. DB schema (extracted verbatim-ish from `class-whcm-db.php` L22–131, dbDelta SQL)

All tables use `$wpdb->get_charset_collate()` and prefix `{prefix}`.

```sql
CREATE TABLE {prefix}whcm_posts (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  wp_product_id bigint(20) DEFAULT 0,
  title text NOT NULL,
  content_text longtext NOT NULL,
  image_url text DEFAULT '',
  target_platform varchar(20) DEFAULT 'both',
  channel_ids text DEFAULT '',              -- comma-separated channel ids
  send_type varchar(20) DEFAULT 'instant',
  scheduled_time datetime DEFAULT CURRENT_TIMESTAMP,
  sent_time datetime DEFAULT NULL,
  status varchar(20) DEFAULT 'pending',     -- pending|sending|sent|failed
  tg_message_id varchar(50) DEFAULT '',
  bale_message_id varchar(50) DEFAULT '',
  views_count int(11) DEFAULT 0,
  likes_count int(11) DEFAULT 0,
  reactions_data text DEFAULT '',
  watermark_enabled tinyint(1) DEFAULT 1,
  PRIMARY KEY (id))

CREATE TABLE {prefix}whcm_clicks (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  post_id bigint(20) NOT NULL,              -- FK → whcm_posts.id (not WP posts)
  channel_id bigint(20) DEFAULT 0,
  platform varchar(20) NOT NULL,
  click_time datetime DEFAULT CURRENT_TIMESTAMP,
  user_ip varchar(100) DEFAULT '',
  PRIMARY KEY (id))

CREATE TABLE {prefix}whcm_inbox (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  platform varchar(20) NOT NULL,
  channel_id bigint(20) DEFAULT 0,
  sender_id varchar(50) NOT NULL,
  sender_name varchar(100) DEFAULT '',
  message_text text NOT NULL,
  reply_text text DEFAULT '',
  received_time datetime DEFAULT CURRENT_TIMESTAMP,
  status varchar(20) DEFAULT 'unread',      -- unread|auto_replied
  PRIMARY KEY (id))

CREATE TABLE {prefix}whcm_autoresponders (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  keyword varchar(100) NOT NULL,
  response_text text NOT NULL,
  is_active tinyint(1) DEFAULT 1,
  PRIMARY KEY (id))

CREATE TABLE {prefix}whcm_channels (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  platform varchar(20) NOT NULL,            -- telegram|bale
  name varchar(100) NOT NULL,
  token varchar(255) DEFAULT '',            -- bot token, PLAINTEXT
  channel_id varchar(100) DEFAULT '',       -- @handle or numeric chat id
  channel_link varchar(255) DEFAULT '',
  enabled tinyint(1) DEFAULT 1,
  sort_order int(11) DEFAULT 0,
  webhook_secret varchar(64) DEFAULT '',
  link_config text DEFAULT '',              -- JSON [{name,url}×3]
  button_config text DEFAULT '',            -- JSON {active,buttons:[{text,url}×3]}
  created_at datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id))

CREATE TABLE {prefix}whcm_channel_messages (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  post_id bigint(20) NOT NULL,
  channel_id bigint(20) NOT NULL,
  message_id varchar(50) DEFAULT '',
  status varchar(20) DEFAULT '',            -- sent|failed
  sent_time datetime DEFAULT NULL,
  PRIMARY KEY (id), KEY post_id (post_id))

CREATE TABLE {prefix}whcm_post_channel_stats (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  post_id bigint(20) NOT NULL,
  channel_id bigint(20) NOT NULL,
  views_count int(11) DEFAULT 0,
  likes_count int(11) DEFAULT 0,
  reactions_data text DEFAULT '',           -- JSON {"👍":n,"❤️":n,"🔥":n}
  PRIMARY KEY (id), UNIQUE KEY post_channel (post_id, channel_id))
```

Upgrade ALTERs (db L134–139): `whcm_posts.channel_ids`, `whcm_clicks.channel_id`, `whcm_inbox.channel_id`, `whcm_channels.link_config/button_config/webhook_active`.
Seeding: legacy single-channel settings → `whcm_channels` rows (db L166–204, only when table empty); two default autoresponder rules «اقساط», «آدرس» (db L206–217).
Options: `whcm_settings` (array, defaults db L219–233), `whcm_db_version`, `whcm_poll_interval_used` (cron L23/30), `whcm_upd_offset_{channel_id}` per channel (cron L294/330), `whcm_last_gold` (gold L328/353), transient `whcm_selfheal` (cron L60/66). Post meta: `_whcm_auto_sent` (cron L146/191), `_whcm_order_source` (roi L27).

**Note:** `whcm_posts.tg_message_id` / `bale_message_id` columns are written by nobody — the actual per-channel message ids live in `whcm_channel_messages` (schema drift / dead columns).

---

## 5. Function-by-function notes

### 5.1 WHCM_DB (`class-whcm-db.php`)
- `install()` L15–145: dbDelta ×7 + column adds + legacy migration + autoresponder seed + `update_option('whcm_db_version', WHCM_VERSION)`.
- `add_column_if_missing()` L147–164: `SHOW COLUMNS` check, wrapped in try/catch (note: `$wpdb->query` doesn't throw by default — dead catch; harmless).
- `migrate_legacy_channels()` L166–204: creates telegram/bale rows from legacy `whcm_settings` keys (`telegram_token`, `telegram_channel`, `telegram_link`, `telegram_enabled`, bale equivalents).
- `seed_default_autoresponders()` L206–217.
- `init()` L219–238: seeds `whcm_settings` defaults (`website_link`, `auto_publish_woo=yes`, `watermark_active=yes`, `gold_api_url`, `gold_template`, `gold_schedule=manual`, `ai_api_key`, `ai_model`, `ai_api_url` openai, `poll_interval=every_1_minute`); reinstall when version changed.
- `get_channels()/get_channel()` L244–255; `add_channel()` L257–271 (generates `webhook_secret` via `wp_generate_password(32,false)`, fallback `md5(uniqid())` L427–432); `update_channel()` L273–290; `delete_channel()` L292–295 (**does not** cascade-delete channel_messages/stats/clicks rows or scheduled posts targeting the channel).
- `save_channel_ui()/clear_channel_ui()` L300–344: per-channel 3 links + 3 buttons JSON.
- `get_channel_links()` L349–376: per-channel JSON, else global settings (`link_1_name/url`…), else hard-coded defaults (`t.me/MyGoldShop`, `ble.ir/MyGoldShop`, site).
- `get_channel_buttons()` L381–413: per-channel JSON, else global (`inline_buttons_active`, `btn_1_text`…), else defaults (`🛒 خرید آنلاین از سایت` → site, `💎 پشتیبانی VIP` → t.me/Support, `📢 هومن وب` → hoomanweb.ir).
- `set_channel_webhook_state()` L418–425.
- `save_channel_message()` L438–448; `get_post_channel_messages()` L450–453; `find_sent_channel_messages_for_product()` L455–466 (JOIN messages×posts where `wp_product_id=%d AND status='sent'` — used by live price sync).
- Stats: `upsert_post_channel_stats()` L470–479 (SELECT-then-INSERT, no `ON DUPLICATE KEY` — race-prone vs the UNIQUE KEY), `increment_post_channel_views()` L481–486, `get_post_channel_stats()` L488–492, `update_post_channel_stats()` L494–502.
- `track_click()` L504–526: inserts click row (platform from channel, `REMOTE_ADDR` string), `UPDATE whcm_posts SET views_count = views_count + 1`, `increment_post_channel_stats`, then `setcookie('whcm_source_channel', channel_id, 30 days)` (no `secure`/`httponly` flags).

### 5.2 WHCM_Sender (`class-whcm-sender.php`)
- `api_base()` L8–13: bale → `https://tapi.bale.ai/bot`, else `https://api.telegram.org/bot` (token appended without URL-encoding).
- `format_caption()` L25–57: builds `🌟 {title} 🌟\n\n{content}\n—————————————\n` + link names; plain mode lists links as `◾️ name` (URLs deliberately invisible, links delivered as buttons); html mode wraps in `<b>`/`<a href>` with **no escaping**; 3rd link URL replaced by `home_url("/?whcm_click={post_id}&channel={id}")` when post_id>0.
- `get_inline_keyboards()` L63–103: `inline_keyboard` row A = 3 channel links (site link → tracker URL), row B = 3 buttons; returns `json_encode` (not `wp_json_encode`) or null when disabled/empty.
- `send_post_to_channel()` L108–164: extension check on media path (`mp4|mov|webm` → video); watermark applied when `watermark_active=yes` and not video (L124–126); picks `/sendVideo` (body `chat_id, video, caption`), `/sendPhoto` (`chat_id, photo, caption`), or `/sendMessage` (`chat_id, text, disable_web_page_preview=false`); attaches `reply_markup` JSON; `wp_remote_post` timeout 30; success = 2xx **and** `data.ok`; returns `message_id` string. **No parse_mode is ever sent** (caption is plain text by design; html mode therefore renders literally — see §11 finding F5).
- `send_post_to_channels()` L169–200: loops channels, sends, records `whcm_channel_messages` row (`sent|failed`) and upserts stats when post_id>0, aggregates `success` (all-or-any=false: any failure flips aggregate).
- `live_update_caption()` L202–220: `/editMessageCaption` with `parse_mode=HTML` (inconsistent with send pipeline) and re-sends `format_caption` HTML output.
- `test_connection()` L222–239: `/getMe`, reports bot name/@username.
- `set_webhook()` L244–275: requires `is_ssl()`; URL = `home_url('/index.php?whcm_webhook={id}')`; adds `secret_token` **only for telegram** when channel secret non-empty; on success sets `webhook_active=1`.
- `delete_webhook()` L277–286: `/deleteWebhook`, `webhook_active=0`.

### 5.3 WHCM_Cron (`class-whcm-cron.php`)
- `init()` L8–42: registers Woo publish hook, cron filter, 3 cron actions; re-schedules `whcm_poll_updates` when stored interval (`whcm_poll_interval_used`) ≠ configured; schedules `whcm_process_queue_event` every 1 min; schedules `whcm_poll_updates`; adds init self-heal.
- `maybe_process_due()` L59–69: if transient `whcm_selfheal` missing → set for max(30, interval) seconds and run `process_scheduled_queue()` + `poll_updates()` inline on any page view (visitor-latency workaround for disabled WP-Cron).
- `on_woo_product_publish()` L137–192: only `product` + `publish` + status change; requires `auto_publish_woo='yes'`; skips when meta `_whcm_auto_sent='yes'`; content = short desc (fallback `wp_trim_words(description, 25)`), price via `number_format` + «تومان» or «تماس بگیرید», SKU line; main image URL; inserts `whcm_posts` row with `channel_ids` = all enabled channel ids, `status='sending'`; sends immediately; updates status to sent/failed; sets `_whcm_auto_sent`. **No AI copy here** — plain template only.
- `process_scheduled_queue()` L201–214: `WHERE status='pending' AND scheduled_time <= now ORDER BY scheduled_time ASC LIMIT 10` → `send_scheduled_post_row()`.
- `process_scheduled_post()` L219–227 + `send_scheduled_post_row()` L232–259: only sends if still `pending`; empty channel list after resolution → `failed`; sets `sent_time`.
- `poll_updates()` L268–277: skips channels where `webhook_active` (409 conflict avoidance); `poll_channel_updates()` L279–331: if settings `inbound_method='polling'` but webhook registered → `deleteWebhook` first; `getUpdates` body `offset = last+1, limit=50, timeout=2`, HTTP timeout 12; on API 409 flips `webhook_active` (and deletes webhook if polling mode); processes each update via `WHCM_Inbox::handle_update_array`; persists max `update_id` in option `whcm_upd_offset_{id}`.

### 5.4 WHCM_Gold (`class-whcm-gold.php`)
- `fa_num()` L25–28: `number_format(...,0,',',',')` + Persian digits (thousands separator shown as Latin `,` inside Persian digits).
- `en_num()` L43–55: maps Persian/Arabic-Indic digits → ASCII, strips `,٬، ` and anything non `[0-9.]` — the 9.7.1 fix for "price with unit can't be re-parsed" (CHANGELOG 9.7.1).
- `g2j()` L61–83: jalaali conversion (JS-identical algorithm). `now_jalali()` L88–97: site-timezone compensated, `jy/mm/dd - HH:MM` in Persian digits.
- `format_price()` L120–140: oz → `fa_num + ' دلار'`; g18/coin → rial `/10` when `gold_currency='rial'`; else toman.
- `fetch_values()` L150–185: `wp_remote_get(admin URL, timeout 12)`, JSON-decode; recursive `find_value()` L190–222 matches keys against needle lists (g18: `18,g18,gold,tala,geram,geram18,shab,طلا,طلای…`; coin: `coin,seke,…,سکه`; oz: `ounce,ons,global,…,انس`) incl. generic keys (`value,price,val,current,now,rate,current_price,amount`) matched against sibling `name` field; failure message embeds first 300 chars of the API body.
- `build_message()` L242–260: template with `{g18k},{coin},{oz},{time}`.
- `schedule()` L284–310: unschedules `whcm_gold_tick`, then schedules per `gold_schedule` (`manual` = none; interval map; `daily_11_30` = single event **plus** a `daily` recurring event — double-scheduling quirk).
- `tick()` L315–357: no-op when manual; fetch; change-detection key `round(g18,2)|round(coin,2)|round(oz,2)` stored in `whcm_last_gold`; publish only when changed; channels = `gold_auto_channels[]` or all enabled; title `اعلام نرخ لحظه‌ای بازار طلا و سکه`; optional `gold_image_url`; no `whcm_posts` row written (gold broadcasts are not tracked in the posts table).

### 5.5 WHCM_Inbox (`class-whcm-inbox.php`)
- `handle_webhook()` L19–25: `file_get_contents('php://input')` → JSON → `handle_update_array`.
- `handle_update_array()` L30–52: accepts `message|edited_message|channel_post|edited_channel_post`; requires `text`; `sender_id` = `from.id` || `sender_chat.id` || `chat.id`; `sender_name` = `from.first_name` || `sender_chat.title` || `chat.title` (sanitized).
- `receive_message()` L57–88: loads ALL active autoresponder rules (no per-channel scoping), first rule whose `keyword` is contained in the text (`mb_stripos`) → reply sent immediately (`send_reply_to_user` → `sendMessage` with body `chat_id, text`, no parse_mode L100–104), inbox row stored with `status = auto_replied|unread`.
- No loop protection, no per-user rate limit, no de-dup (same update can be double-processed if both webhook and polling are active before state flips).

### 5.6 WHCM_AI_Copywriter (`class-whcm-ai.php`)
- `generate_copy()` L19–34: settings `ai_api_key`, `ai_model`, `ai_api_url` (default `https://api.openai.com/v1/chat/completions`); only calls API when key AND url non-empty; otherwise/failed → template fallback.
- `call_ai_api()` L39–87: OpenAI Chat Completions POST; model fallback `gpt-4o-mini`; `temperature 0.8`; system prompt (L43): "تو یک کپی‌رایتر حرفه‌ای فروش طلا و جواهر هستی… حداکثر ۳ جمله فارسی با ایموجی… بدون تگ HTML"; user message = name/features/price; strips tags from the model output (`strip_html` L118–123: regex remove `<...>` + `html_entity_decode`); returns same text for `telegram_text` and `bale_text`.
- `template_copy()` L92–113: two fixed Persian ad templates (flashy TG / trust-oriented Bale) with random emoji.

### 5.7 WHCM_Image_Editor (`class-whcm-image-editor.php`)
- `apply_watermark_overlay()` L11–79: requires GD; **only local files** (URL must be under uploads baseurl, else returns original L18–22); `getimagesize` mime gate (jpeg/png/webp if `imagecreatefromwebp`); draws 65px dark (15,23,42, α20) bar merged at bottom (`imagecopymerge` 85), 3px gold (245,158,11) strip on top edge of bar; cache `uploads/whcm-branded/branded_{md5(path|title|price)}.jpg` q90; returns new URL. Cache never pruned; webp input re-encoded as jpg (animated webp first frame only); EXIF/transparency nuances ignored.

### 5.8 WHCM_ROI_Tracker (`class-whcm-roi.php`)
- `init()` auto-invoked at file bottom (L58) → `woocommerce_checkout_order_processed` → reads cookie `whcm_source_channel` → writes `update_post_meta(order_id, '_whcm_order_source', "name (#id)")` (L15–28). Works for classic post-backed orders; under HPOS the meta write target is the orders table (postmeta write is lost) — compatibility caveat.
- `create_channel_coupons()` L33–56: creates fixed_cart coupons `TELEGRAM-GOLD` / `BALE-GOLD` (100,000 تومان). **Dead code — no caller anywhere in the plugin** (grep verified). The live coupon path is the AJAX `whcm_create_custom_coupon` (admin L1579–1591).

### 5.9 WHCM_Admin (`class-whcm-admin.php`)
- `init()` L8–37: menu, assets, dashboard widget, 20 AJAX routes.
- `add_menu()` L39–49: top-level menu «تلگرام و بله», slug `whcm-dashboard`, cap `manage_options`.
- `enqueue_assets()` L59–101: on `whcm-dashboard` pages + `index.php` (widget); `wp_enqueue_media()`; localizes `whcm_vars` = `ajax_url`, `nonce` (`wp_create_nonce('whcm_ajax_nonce')`), `channels` (id/name/platform/enabled/links/buttons — **token excluded**), global link/button defaults.
- `render_dashboard()` L142–207: GET `tab` switcher; settings POST handler L146–178 guarded by `check_admin_referer('whcm_settings_save')` — whitelists & sanitizes ~24 keys into `whcm_settings` (incl. `ai_api_key`, `ai_api_url`, `gold_api_url`, `caption_format`, `inbound_method`, `poll_interval`, `gold_auto_channels[]`).
- Tabs: publish (L213–318; Woo product dropdown with data-* prefill; channel checkboxes; instant vs scheduled with `.jalali-datepicker`; live preview panel; last 15 posts), channels (L324–420; add form; per-row edit inputs — token echoed back `esc_attr($ch->token)` L356; per-channel link/button editor), ticker (L426–534; manual gold form + API settings + template + schedule + auto channels), inbox (L540–623; last 25 messages; rule CRUD; poll-now and set-all-webhooks buttons; guidance copy), analytics (L710–969; totals, per-channel sent/failed/pending/clicks/views/auto, CSS bar charts, top-30 clicks per post×channel, per-post×channel feedback with editable modal, `get_smart_suggestions()` rule engine L641–708), settings (L1018–1178; global links/buttons, AI provider list `ai_providers()` L978–1016 with 7 providers & model lists, caption format, inbound method, poll interval, system-cron instructions).
- `guard()` L1184–1189: `check_ajax_referer('whcm_ajax_nonce','nonce')` + `current_user_can('manage_options')` → used by **all 20** AJAX handlers.
- AJAX handlers (all verified): `whcm_test_bot` L1191 (getMe), `whcm_add_channel` L1200, `whcm_update_channel` L1213, `whcm_delete_channel` L1227, `whcm_set_webhook` L1233, `whcm_poll_now` L1245 (manual getUpdates, reports new/total), `whcm_save_channel_ui` L1283, `whcm_delete_channel_ui` L1308, `whcm_save_post` L1314 (instant send / scheduled queue + `schedule_single_post()` L1402–1424 with `wp_timezone` conversion, past-due → immediate), `whcm_update_stats` L1426 (manual overwrite of posts views/likes/reactions), `whcm_save_post_stats` L1438 (per post×channel), `whcm_ai_generate` L1448, `whcm_test_ai` L1459 (**persists** the submitted url/key/model into options before testing, L1471–1475), `whcm_broadcast_gold` L1484 (manual gold broadcast, `manual_price()` L1520 formats to Persian digits), `whcm_fetch_gold_api` L1528 (fetch → `apply_currency()` rial/10 → raw Persian numbers), `whcm_add_autoresponder` L1565, `whcm_del_autoresponder` L1572, `whcm_create_custom_coupon` L1579 (WC_Coupon: code/type/amount/min/desc), `whcm_save_quick_links` L1593, `whcm_save_quick_buttons` L1606.

### 5.10 admin.js / jalali-picker.js
- admin.js: live preview renderer (plain-text footer, no HTML), Woo product prefill L54–62, AI provider/model dropdown wiring L79–108, `whcm_save_post` submit L146–191 — converts Jalali `YYYY/MM/DD` + 24h time to `Y-m-d H:i:00` Gregorian via `whcmJalali.toGregorian` L167–169, gold fetch/broadcast L194–274, autoresponder CRUD L277–290, coupon form binding L293–305 (**references `#whcm-custom-coupon-form` which does not exist in any PHP template — dead JS**), channel CRUD L308–365, poll-now/set-all-webhooks L368–402, per-channel UI editor L405–455, feedback modal L458–480, legacy test-compat L483–493. All responses rendered via `.text()`/`.val()` except preview `.html()` of the user's own input (self-XSS only) and `.html('✅ ' + res.data.note + ...)` L123 (server-controlled note).
- jalali-picker.js: full jalaali-js port (breaks table L13), `window.whcmJalali = {toGregorian,toJalaali}` L69, standalone datepicker widget with month/year nav L116–170.

---

## 6. Delivery pipelines — exact request formats

### 6.1 Telegram
- Base: `https://api.telegram.org/bot{token}` (sender L12).
- **sendPhoto**: `POST {base}/sendPhoto` body (form params): `chat_id={channel_id}`, `photo={public image URL}`, `caption={plain caption}`, optional `reply_markup={"inline_keyboard":[[{text,url}…],[…]]}`. URL-based media only — never multipart upload; bot must be admin of the channel.
- **sendVideo** (mp4/mov/webm): same with `video=` instead of `photo=`.
- **sendMessage**: `chat_id`, `text={caption}`, `disable_web_page_preview=false`.
- **editMessageCaption** (live price): `chat_id`, `message_id`, `caption`, `parse_mode=HTML`.
- **getMe** (test), **setWebhook** (`url=home_url('/index.php?whcm_webhook={id}')`, `secret_token={channel.webhook_secret}` telegram-only), **deleteWebhook**, **getUpdates** (`offset`, `limit=50`, `timeout=2`).
- Inbound webhook auth: header `X-Telegram-Bot-Api-Secret-Token` must `hash_equals` channel secret (bootstrap L90–98).
- Success criteria: HTTP 2xx **and** JSON `ok=true`; `result.message_id` stored per channel.

### 6.2 Bale
- Base: `https://tapi.bale.ai/bot` (sender L10) — Bot API-compatible clone; identical method names/bodies (`sendPhoto`, `sendVideo`, `sendMessage`, `getMe`, `getUpdates`, `deleteWebhook`, `editMessageCaption`).
- Differences vs Telegram in this codebase:
  1. **No `secret_token` on setWebhook and no auth check on the inbound webhook** (bootstrap L90 gates on `'telegram' === $channel->platform`) → Bale webhooks are unauthenticated.
  2. HTML captions are deliberately avoided for Bale (Bale renders raw tags); default `caption_format=plain` exists precisely for this (sender L18–22, CHANGELOG 9.2.0) — yet `live_update_caption` still sends `parse_mode=HTML` to both platforms.
  3. `@BaleBotFather` documented as the token source (README/settings guidance admin L1153).

### 6.3 Caption & button model (both platforms)
- Caption = `🌟 {title} 🌟\n\n{content}\n—————————————\n◾️ {link1}\n◾️ {link2}\n◾️ {link3}` (plain mode; names only, URLs hidden).
- Link 3 (site/buy) is swapped to the click tracker `home_url("/?whcm_click={post_id}&channel={channel_id}")` when the post row exists.
- `reply_markup` inline keyboard: row 1 = the 3 channel links (same swap), row 2 = the 3 buttons; per-channel overrides take precedence over global defaults; disabled → `reply_markup` omitted.

## 7. HTTP endpoints (front-of-house, no login)

| Endpoint | Trigger | Auth | Behavior |
|---|---|---|---|
| `/?whcm_click={post_id}&channel={channel_id}` | `init` L55 | none (public) | `track_click` + redirect `get_permalink(post_id)` → fallback `settings['website_link']` → `home_url()`; sets 30-day cookie |
| `/?whcm_webhook={channel_id}` | `init` @1 L77 | telegram: secret header; **bale: none** | JSON body → inbox + autoresponder; responds `200 "ok"`; 400 unknown channel; 403 secret mismatch (TG only) |

No REST routes, no `admin-post.php` handlers, no custom rewrite endpoints.

## 8. AJAX surface (admin-ajax.php, 20 actions)

All actions are `wp_ajax_*` only (no `nopriv`), all funnel through `guard()` = nonce `whcm_ajax_nonce` + `manage_options`. Actions: `whcm_test_bot`, `whcm_save_post`, `whcm_update_stats`, `whcm_ai_generate`, `whcm_broadcast_gold`, `whcm_fetch_gold_api`, `whcm_add_autoresponder`, `whcm_del_autoresponder`, `whcm_create_custom_coupon`, `whcm_save_quick_links`, `whcm_save_quick_buttons`, `whcm_add_channel`, `whcm_update_channel`, `whcm_delete_channel`, `whcm_set_webhook`, `whcm_save_channel_ui`, `whcm_delete_channel_ui`, `whcm_save_post_stats`, `whcm_poll_now`, `whcm_test_ai`.

## 9. Cron model

1. `whcm_process_queue_event` — every 1 min — sends up to 10 `pending` posts whose `scheduled_time` passed.
2. `whcm_process_scheduled_post` — single event per scheduled post at its exact local-time timestamp (fallback: immediate send if timestamp passed).
3. `whcm_poll_updates` — user-configurable 30s/1/2/5 min — getUpdates polling for autoresponder (skips webhook-active channels; auto-deletes webhook when in polling mode).
4. `whcm_gold_tick` — per `gold_schedule` (5m…6h or daily 11:30) — fetch + change-detection + broadcast.
5. Self-heal: on every `init` (priority 20), gated by a transient, run queue + poll inline if WP-Cron hasn't fired (cron L59–69).

Deactivation unschedules only the 3 recurring hooks; per-post single events and gold single events are left to rot (WP-Cron eventually fires them post-deactivation).

## 10. Uninstall behavior (`uninstall.php`)

**Deleted**: 6 tables (`whcm_posts`, `whcm_clicks`, `whcm_inbox`, `whcm_autoresponders`, `whcm_channels`, `whcm_channel_messages`), options `whcm_settings` + `whcm_db_version`, postmeta rows for `_whcm_auto_sent` / `_whcm_order_source`.

**Kept (residue)**:
- `whcm_post_channel_stats` table is **never dropped** (created by dbDelta L112–122 but absent from the uninstall list) → orphaned table after reinstall.
- Per-channel polling offsets `whcm_upd_offset_{id}`, `whcm_poll_interval_used`, `whcm_last_gold` options, `whcm_selfheal` transient.
- `uploads/whcm-branded/*` watermark cache files.
- Multi-site: no blog-loop; only current site cleaned.

## 11. Security findings (severity-ordered)

**F1 — HIGH — Unauthenticated Bale webhook → spoofed messages / auto-responder abuse.** Webhook auth exists only for telegram (`platform === 'telegram'`, bootstrap L90). Anyone can `POST /?whcm_webhook={bale_channel_id}` with a crafted update JSON and (a) inject arbitrary inbox rows, (b) trigger bot `sendMessage` replies to any `chat_id` (phishing relay), (c) flood the DB. Fix in Postyar: per-provider signature/HMAC verification + provider IP allowlist + reject if polling mode enabled.

**F2 — HIGH — Bot tokens & secrets stored/echoed in plaintext.** `whcm_channels.token`, `webhook_secret`, `whcm_settings.ai_api_key` are plain DB values; tokens rendered back into editable text inputs (admin L356) — exposed to screen shares, browser extensions, admin-loggers, DB dumps. AI key likewise re-echoed (admin L1065). Postyar: encrypt-at-rest (app key), display masked with explicit reveal action, audit access.

**F3 — HIGH — Public click tracker is an unauthenticated, unthrottled write endpoint.** One GET = 1 INSERT (`whcm_clicks`) + 2 UPDATEs (`whcm_posts.views_count`, `whcm_post_channel_stats.views_count`) + cookie (bootstrap L55–69, db L504–526). No nonce (by design), no rate limit, no IP de-dup, no verification that `post_id` is a real row (the UPDATE on a missing id is a no-op but the click row still inserts with arbitrary post_id/channel_id/platform='' data). Trivially inflates analytics / bloats table.

**F4 — MEDIUM — Click redirect target can be wrong/unvalidated.** `get_permalink($post_id)` is called with the **whcm_posts row id**, not a WP post ID (bootstrap L61) — for a Woo product the ids diverge, so clicks can land on an unrelated WP post (or the fallback site link when that id has no WP post). Not an open redirect (only permalinks/home), but a correctness + phishing-confusion defect.

**F5 — MEDIUM — HTML injection into outbound messages (html mode & live updates).** `format_caption()` html branch interpolates `$title`, `$content`, link names into `<b>`/`<a href>` with zero escaping (sender L34–44), and `live_update_caption()` sends `parse_mode=HTML` (L211–217). Admin-controlled inputs, but any stored XSS in product fields, or a compromised admin session, becomes message-level markup injection in Telegram. Also inconsistent: `sendPhoto/sendMessage` never send `parse_mode`, so html-mode tags render literally anyway — the html branch is effectively broken + unsafe.

**F6 — MEDIUM — Admin-side SSRF surface via user-set URLs.** `gold_api_url` (gold L159, `wp_remote_get`) and `ai_api_url` (ai L66, `wp_remote_post`) are fetched server-side with only `esc_url_raw`; scheme/host unvalidated; the shipped Ollama preset even points at `http://localhost:11434` (admin L1012). `whcm_test_ai` persists any submitted URL+key into options (admin L1471–1475). In a single-tenant shop this is acceptable; in Postyar SaaS these become connector-owned secrets that must never be tenant-controlled URLs.

**F7 — MEDIUM — Webhook ingest has no size/type cap.** `file_get_contents('php://input')` unbounded, JSON structure trusted shallowly (inbox L20–24); combined with F1 → cheap DoS (huge bodies, garbage updates) and inbox-table bloat (one row per accepted message, no dedupe against `update_id`).

**F8 — LOW — Nonce coverage is actually good; public endpoints are the gap.** All 20 AJAX handlers + settings POST are nonce-checked and capability-checked (guard L1184–1189; check_admin_referer admin L146; nonce field admin L481/1021). No missing-nonce handler found. Residual risk is only F1/F3 public surfaces.

**F9 — LOW — Cookie `whcm_source_channel` lacks Secure/HttpOnly/SameSite.** setcookie call db L524 omits flag args; value is attacker-influenceable (any GET to tracker sets it), so `_whcm_order_source` attribution is trivially spoofable → ROI reports can be poisoned.

**F10 — LOW — Analytics dashboard widget data exposure.** `render_dashboard_widget()` (admin L103–140) is added for every dashboard-capable user (`wp_dashboard_setup`), not gated by `manage_options`; shop managers see aggregate store/channel stats. Minor info disclosure, plus N queries on every dashboard load.

**F11 — LOW — Uninstall residue & no multi-site handling** (see §10): leftover table/options/transients/files; `DROP TABLE` string built from `$wpdb->prefix` (safe), but no `is_multisite()` loop.

**F12 — LOW — Misc correctness defects with security-adjacent impact.** (a) `set_webhook` uses `home_url('/index.php?...')` — permalink-front bugs aside, no cache-bypass note; (b) `json_encode` instead of `wp_json_encode` (sender L102) — no UTF-8 handling guarantee; (c) `add_column_if_missing` try/catch is dead code (wpdb doesn't throw); (d) gold `daily_11_30` double-schedules a single + recurring event (gold L306–308); (e) polling offset stored via `update_option` (autoload=yes by default → autoloaded junk accumulates per channel).

**Not found (explicitly):** no SQL injection (every dynamic query is `$wpdb->prepare`/`insert`/`update`/`delete` with `intval`; table names are constants built from prefix), no stored XSS in admin markup (consistent `esc_html/esc_attr/esc_url`), no `eval`/`system`/file inclusion, no nopriv AJAX, no .po/.mo i18n (hard-coded Persian), no composer/vendored deps.

## 12. Performance characteristics

- Analytics tab: per-channel loop of 6 aggregate queries + several unindexed `FIND_IN_SET(%d, channel_ids)` scans over `whcm_posts` (admin L729–734) — degrades linearly with channels × posts; no indexes beyond PKs + `post_id` KEY + UNIQUE(post,channel).
- `track_click`: 3 writes per click; `whcm_clicks` unbounded (no pruning).
- Self-heal runs outbound HTTP (getUpdates per channel, 12s timeout each, serial) on ordinary page views when WP-Cron is dead — visitor-facing latency and timeout stacking.
- Watermark: GD decode/encode per unique (path,title,price) — cached on disk but never invalidated by image change and never pruned (disk growth).
- `send_post_to_channels` is serial: N channels × 30s worst-case timeout, run inside admin-ajax request (instant publish) — long-running requests, double-send risk on retry.
- Options autoload: per-channel offsets + settings array in autoloaded options.
- No object caching, no batching on `getUpdates` (limit 50 ok), no exponential backoff on API errors (failures simply mark rows failed; no retry).

## 13. Behavioral specs the Postyar Connector + SaaS API must reproduce (15 core features)

1. **Multi-channel registry** — unlimited telegram/bale channels; fields platform/name/token/channel_id/channel_link/enabled/sort_order/webhook_secret/link_config/button_config; per-channel test (`getMe`) with bot identity feedback; legacy single-channel migration on first run.
2. **Product sync & publication pipeline** — manual publisher (title/content/image/channel multi-select/instant-or-scheduled/watermark checkbox + live preview) and automatic publisher on `product` `publish` transition honoring a per-product once-only flag (`_whcm_auto_sent`), building caption from short description (fallback 25-word excerpt), formatted price («X تومان» / «تماس بگیرید»), SKU line, main image. Post row lifecycle `pending → sending → sent|failed` with per-channel message rows (`whcm_channel_messages`) and per-channel stat seeds.
3. **Caption contract** — `🌟 title 🌟` header, body, `—` divider, footer with 3 link names; link-3 URL swapped for the tracked site link; strict plain-text default (no parse_mode) with optional HTML mode; tags stripped from any AI output.
4. **Inline keyboard contract** — row 1 = 3 channel links, row 2 = 3 buttons, per-channel overrides, global defaults, master on/off; JSON `reply_markup` on sendPhoto/sendVideo/sendMessage only.
5. **Telegram delivery** — `api.telegram.org/bot{token}`; sendPhoto (public media URL) / sendVideo (mp4|mov|webm) / sendMessage; success = 2xx + `ok`; message_id persisted per channel; 30s timeout.
6. **Bale delivery** — `tapi.bale.ai/bot{token}`; identical method set; no secret_token; plain captions mandatory; token from @BaleBotFather.
7. **Scheduled publishing** — Jalali date + 24h time → Gregorian `Y-m-d H:i:00`; stored `pending`; exact single cron event (site-timezone-aware) + 1-minute queue sweep (LIMIT 10) + on-request self-heal fallback; past-due → immediate attempt; failure → `failed` with error surfaced per channel in UI.
8. **Live price update** — on `woocommerce_update_product`, find all `sent` message rows for the product, rebuild caption with «قیمت زنده» + current time, `editMessageCaption` per channel; silently skip missing channels/messages.
9. **Click tracking & attribution** — tracked link format `/?whcm_click={post_row_id}&channel={channel_id}`; insert click row (platform from channel, IP, time); increment per-post and per-post×channel view counters; 30-day first-touch cookie; on checkout write `_whcm_order_source` style meta (channel name + id) to the order; per-channel/per-post click analytics + manual feedback editing (likes, 👍/❤️/🔥).
10. **Gold-rate service** — admin JSON URL; recursive smart parser for g18/coin/ounce keys incl. nested objects and generic `price/value/name` pairs, Persian/Arabic digit tolerant; rial→toman ÷10 switch; ounce always USD; Persian-digit thousands formatting; Jalali «به‌روزشده در» timestamp; user template `{g18k}{coin}{oz}{time}`; manual broadcast (selected channels or all, optional image) and scheduled publish with **change-detection** (publish only when rounded values changed); post not recorded in posts table.
11. **Inbox + autoresponder** — dual ingest (webhook + getUpdates polling; mutually exclusive per channel via `webhook_active`, 409 self-correction, offset persistence per channel); accept message/edited_message/channel_post/edited_channel_post with text; sender id/name resolution; keyword `mb_stripos` match against active rules (global rule pool, first match wins), reply via bot `sendMessage` to sender, row status `auto_replied|unread`; inbox browse + rule CRUD; manual poll-now with new/total counters.
12. **AI copywriting** — OpenAI-compatible Chat Completions (configurable endpoint/model/key, default gpt-4o-mini, temp 0.8), Persian jewelry-copywriter system prompt (≤3 sentences, emojis, NO HTML), output stripped of tags, identical text for both platforms, fixed template fallback per platform when key empty or API fails; provider presets (OpenAI/Gemini/Groq/DeepSeek/Mistral/Together/Ollama) + custom model entry; connection test. **Postyar change:** move key/endpoint server-side (SaaS proxy) — do not accept tenant-supplied URLs.
13. **Image branding** — optional watermark toggle per send + global default; 65px dark bottom bar + gold strip + brand text concept; cache-hash output file in uploads subdir; local-file only, jpeg/png/webp in → jpg out; applied automatically on non-video media in auto-publish and manual send (unless unchecked).
14. **Analytics & suggestions** — totals (posts/views/clicks/pending), per-channel sent/failed/pending (percentage bars), views/clicks per channel, top-30 post×channel clicks, post×channel feedback table with edit modal, auto-replies per channel, heuristic suggestion engine (zero feedback / views-no-clicks / send failures / low CTR <2% / top channel ≥100 views).
15. **Settings, lifecycle & hygiene** — `whcm_settings` option keys as in db L219–233 + admin save whitelist (admin L147–175): `website_link, link_1..3_name/url, btn_1..3_text(+btn_2/3_url), inline_buttons_active, auto_publish_woo, watermark_active, gold_api_url, gold_template, gold_schedule, gold_currency, gold_image_url, gold_auto_channels, ai_api_key, ai_model, ai_api_url, caption_format, inbound_method, poll_interval`; version-gated schema migration; deactivate = unschedule recurring cron; uninstall = drop tables (must include `whcm_post_channel_stats`), delete settings/version/offsets/last-gold/transients, purge watermark cache, remove postmeta. Postyar must fix the residue gaps in §10.

## 14. Recommendations (priority order)

1. **Postyar Connector must authenticate every inbound webhook**: Bale/Mailgun-style HMAC secret header for all providers + Telegram `secret_token`, optional provider IP allowlist, `update_id` de-dup table, size cap (e.g. 256 KB), strict JSON schema.
2. **Move secrets out of WP options/tables in plaintext** — encrypt bot tokens & AI keys with an app key; mask in UI; the SaaS API should hold keys tenant-side and the plugin should call the SaaS, not providers directly (this also collapses F1/F6).
3. **Replace public click tracking with signed tokens** (`?whcm_click=HMAC(post,channel)`), rate-limit per IP, and redirect to the *product permalink*, not `get_permalink(row_id)` (fixes F3/F4).
4. **Queue-ify delivery**: background job per channel (Action Scheduler or custom), retries with backoff, per-message error text surfaced in UI; never run N×30s HTTP calls inside an AJAX request.
5. **Kill the HTML caption mode** or escape everything and send `parse_mode` consistently (Telegram only); Bale stays plain.
6. **Schema**: add FK-ish indexes (`channel_messages(channel_id,status)`, `clicks(channel_id,click_time)`, `posts(status,scheduled_time)`), replace `channel_ids` CSV with the junction table only (drop `FIND_IN_SET` scans), `ON DUPLICATE KEY UPDATE` for stats upsert.
7. **Cron hygiene**: unschedule single events on deactivation; ship a real scheduler (system cron ping endpoint with a signed token) instead of the init self-heal.
8. **Gold service**: move fetch+parse server-side (SaaS) with response schema validation and cached last-value; keep change-detection; drop the double-scheduling `daily_11_30` quirk; never echo raw API bodies to the UI.
9. **Uninstall completeness** + multisite loop; add `whcm_post_channel_stats` to the drop list.
10. **Delete dead code** on port: ROI coupon factory, `#whcm-custom-coupon-form` JS binding, `tg_message_id`/`bale_message_id` columns (or start writing them), legacy `telegram_token`-style settings keys (retain only in the migration shim).

---

*End of audit. All 18 reference files were read in full; nothing was fabricated — items noted "not found" above were verified absent by full read + targeted grep (`create_channel_coupons`, `nopriv`, `wp_insert_post`, `REST`, `eval`, `prepare` coverage).*

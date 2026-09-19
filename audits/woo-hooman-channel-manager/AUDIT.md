# Forensic Audit — woo-hooman-channel-manager (v9.7.1)

Audit Team B, Task ID 03. Reference tree frozen at po.source `67a83e2e9` (READ-ONLY).
Every file in the plugin was read in full: bootstrap, uninstall.php, CHANGELOG.md, README_FA.txt,
8 include classes, 2 JS assets, 1 CSS asset (4,406 lines total source). Line references below are exact.

---

## 1) Executive Summary

`woo-hooman-channel-manager` (brand: «پلتفرم هوشمند مدیریت کانال‌ها | هومن وب», Text Domain `woo-hooman-channels`) is a
single-purpose WooCommerce/WordPress plugin for a Persian gold-shop niche: it broadcasts product and live gold-price content
to **Telegram and Bale channels** (both via Bot API-shaped HTTPS endpoints), runs a **keyword auto-responder inbox**
(webhook + getUpdates polling), schedules posts with a **Jalali calendar**, tracks **clicks and per-channel ROI**,
generates **AI captions** through any OpenAI-compatible Chat Completions endpoint, stamps **GD watermarks**, and builds
WooCommerce **coupons**.

Architecture: procedural static-class plugin (no namespace, no interfaces), one 1,618-line god-class for all admin UI/AJAX
(`WHCM_Admin`, 120KB), one DB layer (`WHCM_DB`) with 7 custom tables, one sender (`WHCM_Sender`), and cron/gold/ai/inbox/roi
helpers. No REST endpoints; all mutations are admin-ajax + two unauthenticated `init`-hook routes (click tracker, webhook).

Overall quality: **functional and battle-tested by usage, but architecturally fragile and security-light**.
The strongest parts are Bale-compatibility discipline (plain-text captions, real inline buttons), the polling fallback with
409-conflict handling, and the gold-price recursive parser. The weakest parts are: unauthenticated webhook for the Bale
platform, unauthenticated click-flood surface, partial-form settings save that wipes unrelated settings, plaintext bot
tokens / AI keys, N+1 analytics queries, a double-offset bug in Jalali "now", a double-scheduled gold daily event, and an
uninstall that misses one table and several options.

**Headline numbers:** 7 DB tables (6 cleaned on uninstall, 1 missed), 20 AJAX endpoints (all nonce+cap guarded, 3 orphaned),
2 unauthenticated routes, 4 cron hooks + 10 custom schedules, 2 bot-API hosts, 7 AI providers, ~30 persisted option keys.

---

## 2) Plugin Lifecycle & Hooks Map

Bootstrap `woo-hooman-channel-manager.php`:

| Hook | Priority | Callback | Evidence |
|---|---|---|---|
| `register_activation_hook` | — | `WHCM_DB::install` (creates tables, seeds) | woo-hooman-channel-manager.php:36 |
| `register_deactivation_hook` | — | `WHCM_Cron::deactivate` (unschedules 3 hooks) | :37 |
| `plugins_loaded` | 99 | `WHCM_DB::init`, `WHCM_Cron::init`, `WHCM_Gold::schedule`, `WHCM_Admin::init` (admin only) | :39-46 |
| `init` | default | Click tracker `/?whcm_click={post}&channel={id}` → redirect | :55-69 |
| `init` | 1 | Webhook `/?whcm_webhook={channel_id}` → `WHCM_Inbox::handle_webhook` | :77-104 |
| `whcm_gold_tick` | — | `WHCM_Gold::tick` (scheduled gold broadcast) | :49 |
| `woocommerce_update_product` | 20 | Live price sync: re-format caption + `editMessageCaption` on every sent message of that product | :110-132 |

`WHCM_Cron::init` (class-whcm-cron.php:8-42):
`transition_post_status` @10 → auto-publish Woo product (:9); `cron_schedules` filter → 10 custom intervals (:10, 71-113);
cron actions `whcm_process_queue_event` (:13), `whcm_process_scheduled_post` (:15), `whcm_poll_updates` (:17);
`init` @20 → `maybe_process_due` self-heal (:41).

`WHCM_ROI_Tracker::init()` is invoked **at file include time** (class-whcm-roi.php:58): `woocommerce_checkout_order_processed`
@10 → `log_order_source` (:9).

`WHCM_Admin::init` (class-whcm-admin.php:8-37): `admin_menu`, `admin_enqueue_scripts`, `wp_dashboard_setup`, and **20
`wp_ajax_*` registrations** (no `wp_ajax_nopriv_*` anywhere — verified by grep).

No REST routes, no custom rewrites, no shortcodes, no widgets beyond one dashboard widget.

---

## 3) File-by-file / Class-by-class Findings

### 3.1 woo-hooman-channel-manager.php (bootstrap, 133 lines)
- Constants `WHCM_VERSION '9.7.1'`, `WHCM_PLUGIN_DIR/URL` (:16-18). All 8 includes loaded on every request; admin class only
  when `is_admin()` (:29-31).
- Click tracker (:55-69): unauthenticated; `intval` on GET params; `WHCM_DB::track_click` then `wp_redirect(get_permalink)`
  falling back to `whcm_settings['website_link']`/`home_url`. No rate limit, no post existence check (any id inserts a click row).
- Webhook (:77-104): 404s unknown channels; **Telegram** channels validated with `X-Telegram-Bot-Api-Secret-Token` header via
  `hash_equals` against `webhook_secret` (:90-98) — good; **Bale channels have no authentication at all** — anyone can POST a
  forged update JSON. Responds `200 "ok"`.
- Live price sync (:110-132): builds «قیمت زنده» content and calls `WHCM_Sender::live_update_caption` per sent channel-message
  row synchronously inside the product-save request (N HTTP calls in admin request; see §11 perf).

### 3.2 uninstall.php (35 lines)
- Drops 6 tables (:14-25) — **misses `whcm_post_channel_stats`** (created in DB class, left orphaned).
- Deletes `whcm_settings`, `whcm_db_version` (:27-28) — **misses** `whcm_poll_interval_used`, `whcm_upd_offset_{id}` (one per
  channel), `whcm_last_gold`, transient `whcm_selfheal`.
- Cleans postmeta `_whcm_auto_sent` and `_whcm_order_source` by meta_id (:31-34).
- Uses raw `$wpdb->query("DROP TABLE IF EXISTS {$table}")` with identifier built from `$wpdb->prefix` — safe in practice, but
  the identifier-interpolation pattern is worth replacing in the rebuild.

### 3.3 includes/class-whcm-db.php (527 lines) — full schema in §4
- `install()` runs 7 `dbDelta` tables + `add_column_if_missing` upgrades + legacy migration + auto-responder seeding; sets
  `whcm_db_version = WHCM_VERSION` (:144).
- `add_column_if_missing` (:147-164): `SHOW COLUMNS` + raw `ALTER TABLE`; **try/catch is decorative** — `wpdb` does not throw
  exceptions by default, so failed ALTERs are only silently ignored via the column check.
- `migrate_legacy_channels` (:166-204): when the channels table is empty, seeds a Telegram + a Bale channel from old
  flat settings (`telegram_token/channel/link/enabled`, `bale_*`).
- `seed_default_autoresponders` (:206-217): seeds two gold-shop rules — keyword «اقساط» (installments) and «آدرس» (address).
- `init()` (:219-238): seeds `whcm_settings` defaults if missing (includes `gold_template` with `{g18k}/{coin}/{oz}/{time}`
  placeholders and `ai_api_url` default OpenAI) and **re-runs full `install()` whenever `whcm_db_version !== WHCM_VERSION`**.
- Channel CRUD (:244-295): all prepared/`wpdb->insert|update|delete`; `add_channel` generates `webhook_secret`
  (`wp_generate_password(32,false)`, fallback `md5(uniqid())` :427-432). Tokens stored as `sanitize_text_field` plaintext.
- Per-channel UI config (:300-344): 3 links + 3 buttons stored as JSON in `link_config` / `button_config`
  (`button_config` = `{active, buttons[3]}`); `clear_channel_ui` resets to global defaults.
- `get_channel_links` / `get_channel_buttons` (:349-413): channel config wins, else global settings, else hardcoded defaults
  (`t.me/MyGoldShop`, `ble.ir/MyGoldShop`, `t.me/Support`, `hoomanweb.ir`) — vendor-branded defaults baked into data layer.
- Post/message/stats helpers (:438-502): `save_channel_message`, `get_post_channel_messages`,
  `find_sent_channel_messages_for_product` (JOIN posts on `wp_product_id`, status='sent' :455-466),
  `upsert_post_channel_stats` (SELECT-then-INSERT race; unique key saves it but insert errors are ignored),
  `increment_post_channel_views`, `update_post_channel_stats`.
- `track_click` (:504-527): inserts click row (with raw `REMOTE_ADDR`), increments `whcm_posts.views_count`, increments
  per-channel views, sets 30-day cookie `whcm_source_channel`. **No throttle, no row-existence check.**

### 3.4 includes/class-whcm-sender.php (287 lines)
- `api_base` (:8-13): `https://tapi.bale.ai/bot` for bale, else `https://api.telegram.org/bot`.
- `format_caption` (:25-57): builds `🌟 {title} 🌟\n\n{content}\n—————————————\n◾️ {link name}` in plain mode; HTML mode wraps
  `<b>`/`<a>` but — **critical detail — `send_post_to_channel` never sets `parse_mode`** (:133-146), so the "html" caption
  format renders as literal tags in Telegram/Bale. Only `live_update_caption` sends `parse_mode=HTML` (:211-217).
- `get_inline_keyboards` (:63-103): 2-row `inline_keyboard` — row A = 3 channel links, row B = 3 buttons; **only
  `links[2]` (third link / site link) is rewritten to the click-tracker URL** when `post_id>0` (:70-72) — the CHANGELOG
  claim that button 1 is tracker-connected is not implemented (buttons keep their configured URLs).
- `send_post_to_channel` (:108-164): token/channel validation; video detection by extension (mp4/mov/webm) → `sendVideo`,
  else `sendPhoto`, else `sendMessage` (`disable_web_page_preview=false`); optional watermark via `WHCM_Image_Editor`
  only for non-video when `watermark_active='yes'`; `wp_remote_post` timeout 30; success = 2xx + `data.ok`; extracts
  `result.message_id`; errors surface API `description`.
- `send_post_to_channels` (:169-200): loops channels, records per-channel message row (`sent|failed`), upserts stats,
  aggregates results.
- `test_connection` (:222-239): `getMe`, returns bot name/username.
- `set_webhook` (:244-275): refuses without `is_ssl()`; URL = `home_url('/index.php?whcm_webhook={id}')`; passes
  `secret_token` **only for Telegram** (:259-261); flips `webhook_active` state on result.
- `delete_webhook` (:277-286): fire-and-forget, marks state 0.

### 3.5 includes/class-whcm-cron.php (332 lines)
- Cron scheduling at `init` (:19-38): reschedules `whcm_poll_updates` when the stored interval option differs; schedules
  queue processor every 1 minute.
- `maybe_process_due` (:59-69): **self-heal** — transient `whcm_selfheal` (≥30s) gates running `process_scheduled_queue()`
  **and** `poll_updates()` synchronously inside every page view (`init` @20). Blocking outbound HTTP during visitor requests
  (up to per-channel 12s timeouts).
- Custom schedules (:71-113): 30s/1m/2m/5m/15m/30m/1h/2h/3h/6h with Persian display names.
- `deactivate` (:124-131): `wp_next_scheduled` + `wp_unschedule_event` for 3 hooks — single-occurrence removal; if multiple
  events exist (e.g. per-post singles) leftovers remain (no `wp_clear_scheduled_hook`).
- `on_woo_product_publish` (:137-192): only `product` CPT on transition to publish, gated by `auto_publish_woo='yes'` and
  `_whcm_auto_sent` meta guard; builds «قیمت: … تومان / تماس بگیرید», SKU line, main image URL; inserts a `whcm_posts` row
  (status `sending`) then sends to all enabled channels and flips to `sent|failed`; sets `_whcm_auto_sent`.
- Queue (:201-259): `process_scheduled_queue` takes 10 pending posts due now (`status='pending' AND scheduled_time <= now`),
  `process_scheduled_post` handles a single id; `send_scheduled_post_row` re-checks status, falls back to all enabled channels
  when `channel_ids` empty, marks `failed` when no channels.
- `poll_channel_updates` (:279-331): skips channels with active webhook (409 conflict avoidance); if inbound method is
  polling and webhook is stuck active, deletes the webhook first; `getUpdates` with `offset=last+1, limit=50, timeout=2`
  (HTTP timeout 12); on API 409 it re-syncs `webhook_active` state; processes every update through
  `WHCM_Inbox::handle_update_array`; stores offset in `whcm_upd_offset_{channel_id}`.

### 3.6 includes/class-whcm-gold.php (358 lines)
- Persian numerics: `fa_num` (thousands-separated + Persian digits, prices only) :25-28; `fa_digits` :33-37; `en_num`
  (Persian/Arabic digits → Latin, strips separators/units, keeps digits+dot) :43-55.
- `g2j` (:61-83): Gregorian→Jalali (jalaali algorithm). `now_jalali` (:88-97): **double-offset bug** —
  `current_time('timestamp')` already includes the site GMT offset, then `$ts + get_option('gmt_offset')*3600` is applied
  again, so «به‌روزشده در» time is wrong for any non-UTC site (e.g. +3:30 shows +7h). CHANGELOG 9.7.1 claims a date/time fix;
  the double-offset remains.
- `format_price` (:120-140): ounce always «دلار»; gold/coin `rial`→`/10` then «تومان».
- `fetch_values` (:150-185): `wp_remote_get` (12s) of the admin-configured JSON URL; recursive `find_value` (:190-222) over
  needle lists — g18: `18,g18,gold,tala,geram,geram18,shab,طلا,طلای…`; coin: `coin,seke,sagh,bahar,emis,emami,rob,nim,سکه…`;
  oz: `ounce,ons,global,gold_usd,world,جهانی,انس…`; generic keys (`value,price,val,current,now,rate,current_price,amount`)
  matched against sibling `name` (UTF-8 lowercased). If nothing found, **returns first 300 chars of the API body in the error
  message** (:172-175) — helpful but leaks response content into the admin UI.
- `build_message` (:242-260): template `{g18k}/{coin}/{oz}/{time}` substitution; **calls `fetch_values()` again** (tick() already
  fetched → 2 HTTP calls per auto-publication, and the change-detection check and the published message can disagree).
- `intervals` (:269-279) + `schedule` (:284-310): unschedules prior `whcm_gold_tick`; `manual` = none; interval modes via
  `wp_schedule_event`; **`daily_11_30` schedules BOTH a single event at 11:30 and a recurring `daily` event at 11:30**
  (:306-308) — duplicated first-day publication and redundant recurrence (self-healing recurrence is the recurring one).
- `tick` (:315-357): skips `manual`; fetches; change key `round(g18,2)|round(coin,2)|round(oz,2)` vs option `whcm_last_gold`;
  targets `gold_auto_channels` or all enabled; title «اعلام نرخ لحظه‌ای بازار طلا و سکه»; content from `build_message`;
  optional `gold_image_url`; sends with watermark default true; stores last key + timestamp.

### 3.7 includes/class-whcm-ai.php (124 lines) — class `WHCM_AI_Copywriter`
- `generate_copy` (:19-34): if `ai_api_key` + `ai_api_url` set → `call_ai_api`; **any API failure silently falls back to the
  canned template**.
- `call_ai_api` (:39-87): OpenAI-compatible Chat Completions POST (`wp_json_encode` body, Bearer key, timeout 30);
  default model `gpt-4o-mini`; `temperature 0.8`; **system prompt (Persian)**: «تو یک کپی‌رایتر حرفه‌ای فروش طلا و جواهر
  هستی. فقط یک متن تبلیغاتی کوتاه (حداکثر ۳ جمله) به زبان فارسی همراه با چند ایموجی مناسب بنویس… به هیچ وجه از تگ‌های HTML…
  استفاده نکن.»; user message = product name / features / price. Strips tags from output (`strip_html` :118-123 regex
  `/<[^>]*>/` + entity decode). Returns identical `telegram_text`/`bale_text`.
- `template_copy` (:92-113): two hand-written Persian sales templates (Telegram tone vs Bale/gallery tone), random emoji from
  `✨👑💎🌟💥🔥`.

### 3.8 includes/class-whcm-inbox.php (108 lines)
- `handle_webhook` (:19-25): raw `php://input` JSON → `handle_update_array`.
- `handle_update_array` (:30-52): accepts `message|edited_message|channel_post|edited_channel_post`; text-only; sender id from
  `from.id` → `sender_chat.id` → `chat.id`; name from `from.first_name` → `sender_chat.title` → `chat.title`;
  `sanitize_text_field` on name/text.
- `receive_message` (:57-88): loads ALL active autoresponder rules; **first keyword that substring-matches
  (`mb_stripos`) wins**; immediately sends the reply (`sendMessage`, no parse_mode — Bale-safe); inserts inbox row with
  status `auto_replied|unread`. No per-channel rules, no dedup, no rate limit (a forged webhook floods both inbox and bot replies).
- `send_reply_to_user` (:93-107): posts to the **sender-supplied chat id** — combined with the unauthenticated Bale webhook,
  the bot can be abused as a message relay to arbitrary chat ids.

### 3.9 includes/class-whcm-roi.php (58 lines) — class `WHCM_ROI_Tracker`
- `log_order_source` (:15-28): on `woocommerce_checkout_order_processed`, reads cookie `whcm_source_channel` (30-day, set by
  the click tracker) and writes `_whcm_order_source` = `"{channel name} (#{id})"` onto the order.
- `create_channel_coupons` (:33-56): creates `TELEGRAM-GOLD` / `BALE-GOLD` fixed-cart 100,000-toman coupons — **dead code,
  never called anywhere** (verified by grep).
- Note: attribution is cookie-only (last click wins), 30 days, no UTM support.

### 3.10 includes/class-whcm-image-editor.php (80 lines) — class `WHCM_Image_Editor`
- `apply_watermark_overlay` (:11-79): local files only (map baseurl→basedir, bail if missing); GD required; supports
  jpeg/png/**webp (if `imagecreatefromwebp` exists)**; draws a 65px dark-gold bar at bottom (`rgba(15,23,42,alpha)` merge 85%,
  gold 3px top line, brand text color allocated but text never drawn — `$title`/`$price` params unused in rendering);
  writes `uploads/whcm-branded/branded_{md5(path|title|price)}.jpg` (quality 90); **output always JPEG** (WebP input is
  re-encoded; WebP output never produced). Remote image URLs bypass watermarking silently.

### 3.11 includes/class-whcm-admin.php (1,618 lines) — class `WHCM_Admin`
Functional regions (every region visited):
1. **init + AJAX registry** (:8-37): 20 `wp_ajax_*` handles (list in §6).
2. **Menu** (:39-49): single top-level page «تلگرام و بله», slug `whcm-dashboard`, cap `manage_options`, position 56, `dashicons-share`.
3. **Dashboard widget** (:51-57, 103-140): aggregate posts/views/clicks/active-channels + 3 recent posts + quick links;
   rendered for **every dashboard-capable user** (no capability filter).
4. **Asset enqueue** (:59-101): on `whcm-dashboard` pages and `index.php` (whole dashboard); `wp_enqueue_media`; admin.css +
   jalali-picker.js + admin.js; `wp_localize_script('whcm_vars')` with ajax_url, nonce `whcm_ajax_nonce`, channel list with
   per-channel links/buttons, and global link/button defaults. **Tokens are NOT localized** (good).
5. **Dashboard render + settings save** (:142-207): tab router (publish/channels/ticker/inbox/analytics/settings);
   settings POST handler (:146-178) gated by `check_admin_referer('whcm_settings_save')` — **rebuilt wholesale from POST with
   per-field defaults; the ticker-tab form submits the same `whcm_save_settings` with only gold fields, so saving the ticker
   tab resets AI key/URL, caption_format, inbound_method, poll_interval, website_link, links/buttons defaults, and turns
   `auto_publish_woo`/`watermark_active` OFF** (checkboxes absent → `'no'`). Real data-loss bug; also save-logic-inside-render
   anti-pattern.
6. **Publish tab** (:213-318): Woo product quick-pick (30 latest published products with title/price/SKU/desc/image as data attrs),
   title/content, media upload, watermark checkbox, channel checkboxes, instant vs scheduled with Jalali date + 24h time,
   live chat-bubble preview, last 15 sends table. All dynamic output escaped (`esc_html/esc_attr`).
7. **Channels tab** (:324-420): add form (platform/name/token/channel id/link), editable rows with inline token inputs
   (plaintext echo of stored tokens :356), per-row save/test/webhook/delete buttons, per-channel link/button editor
   (3+3 fields + enable checkbox, save/clear).
8. **Gold (ticker) tab** (:426-534): manual publish form (g18/coin/oz + image + channel selection incl. "all"), and the
   gold settings form (API URL, currency, template, schedule incl. `daily_11_30`, auto channels) which posts the partial
   `whcm_save_settings` payload (see region 5 bug).
9. **Inbox tab** (:540-623): guide boxes (broadcast channels are one-way; use a discussion group or bot PM), poll-now button,
   set-all-webhooks button, last 25 inbox messages, autoresponder rule add/delete.
10. **Analytics tab** (:629-969): totals; per-channel loops issuing **7 COUNT/SUM queries per channel** (:729-734) including
    an unindexable `FIND_IN_SET(%d, channel_ids)`; channel-comparison bar graph; send success/fail/pending table with % bars;
    per-channel views/clicks; auto-reply counts per channel; clicks-per-post-per-channel (top 30); feedback rows
    (`whcm_post_channel_stats` JOIN posts) with an edit modal (likes + 👍/❤️/🔥 reactions); rule-based «پیشنهادهای هوشمند»
    (smart suggestions) engine (:641-708) — zero-feedback, views-without-clicks, send failures, low CTR (<2%), top channel,
    and no-data fallback.
11. **Settings tab** (:978-1178): AI provider catalog `ai_providers()` (:978-1016) — OpenAI, Gemini
    (`generativelanguage.googleapis.com/v1beta/openai/...`), Groq, DeepSeek, Mistral, Together, Ollama (localhost:11434) with
    model lists; global 3 links + 3 buttons defaults; `inline_buttons_active`, `auto_publish_woo`, `watermark_active`;
    `ai_api_key` echoed back into the form (:1065) — plaintext round-trip; `caption_format` plain|html; `inbound_method`
    polling|webhook; `poll_interval` 30s–5min; long Persian setup guides for Telegram (@BotFather) and Bale
    (@BaleBotFather / tapi.bale.ai) plus a system-cron hint (`curl site/wp-cron.php` every minute).
12. **AJAX layer** (:1184-1616): `guard()` = `check_ajax_referer('whcm_ajax_nonce','nonce')` + `current_user_can('manage_options')`
    (:1184-1189) — applied to **all 20 handlers** (good). Details per endpoint in §6.
13. **Scheduling helper** `schedule_single_post` (:1402-1424): DateTime with `wp_timezone()`; past times send immediately;
    future → `wp_schedule_single_event('whcm_process_scheduled_post', [(string) post_id])`.
14. **Gold helpers** `manual_price` (:1520-1526) — `en_num`+`fa_num`; `apply_currency` (:1554-1563) rial→toman for the fetch-to-box flow.

### 3.12 assets/js/admin.js (495 lines)
- 24h hour/minute fill; live preview (`updateLivePreview` :25-48) — uses `.html()` with **unescaped** title/content
  (:35-36) → admin-side self-XSS, and product names (enterable by lower-privileged content editors) flow into the preview
  as HTML via the option `data-*` attributes.
- Woo product picker fills title/content/image (:54-62); media uploader (wp.media) (:65-76, 228-246).
- AI provider→URL/model mapping from `data-*` attrs; custom-model injection into select (:79-108); test-AI call (:111-131);
  caption-generate call (:134-143).
- Post submit: builds Jalali→Gregorian datetime client-side via `whcmJalali.toGregorian` (:167-169), posts
  `whcm_save_post` with channels[] and watermark flag (:175-190).
- Gold: fetch-to-boxes (:194-208), all/selected channel checkbox logic (:211-225), gold image preview (:228-246), gold
  broadcast submit (empty selection = server defaults to all) (:248-274).
- Autoresponder add/delete with confirm (:277-290); (legacy) coupon form handler (:293-305) targeting a form that no longer
  exists in PHP views (dead binding); channel add/save/test/webhook/delete (:308-365); poll-now and set-all-webhooks loops
  (:368-402); per-channel UI editor load/save/delete (:405-455); feedback modal save (:458-480); legacy compat test button (:483-493).

### 3.13 assets/js/jalali-picker.js (172 lines)
- Self-contained jalaali-js port (`jalCal/g2d/d2g/j2d/d2j` :12-66), exposes `window.whcmJalali` (:69); renders a popover
  calendar (Persian month names :71, weekday initials ش..ج :72) on `.jalali-datepicker` focus/click (:167-170);
  outputs `YYYY/MM/DD` Jalali into the input. Clean, dependency-free, no global leakage beyond `whcmJalali`.

### 3.14 assets/css/admin.css (249 lines)
- Pure presentation: Vazirmatn @font-face (woff2/woff/ttf) with emoji font fallback stack (:3-27 — CHANGELOG 9.3.0 item);
  RTL everywhere; glassmorphism/neon designer badge (:39-92); cards/grids/badges/pills; dashboard-widget styles;
  stats grid; Jalali picker styles (:203-249). No security-relevant behavior.

---

## 4) DB Schema Documentation (all tables / columns / versions)

Source: class-whcm-db.php:15-145. All tables use `$wpdb->get_charset_collate()`. Schema version = `whcm_db_version`
option, set to `WHCM_VERSION` ('9.7.1'); `WHCM_DB::init()` re-runs `install()` whenever the option ≠ current version
(no incremental migration steps beyond `add_column_if_missing`).

**1. `{prefix}whcm_posts`** — broadcast records (class-whcm-db.php:22-41)
`id` BIGINT PK AI · `wp_product_id` BIGINT def 0 · `title` TEXT NOT NULL · `content_text` LONGTEXT NOT NULL ·
`image_url` TEXT · `target_platform` VARCHAR(20) def 'both' · `channel_ids` TEXT def '' (upgraded :134) ·
`send_type` VARCHAR(20) def 'instant' · `scheduled_time` DATETIME def CURRENT_TIMESTAMP · `sent_time` DATETIME NULL ·
`status` VARCHAR(20) def 'pending' (observed values: sending/sent/failed/pending) · `tg_message_id` VARCHAR(50) ·
`bale_message_id` VARCHAR(50) · `views_count` INT · `likes_count` INT · `reactions_data` TEXT · `watermark_enabled` TINYINT(1) def 1.
Indexes: PK only. *Queue query `WHERE status='pending' AND scheduled_time<=…` is unindexed (perf).*

**2. `{prefix}whcm_clicks`** (:45-53) — `id` PK · `post_id` BIGINT NOT NULL · `channel_id` BIGINT def 0 (upgraded :135) ·
`platform` VARCHAR(20) NOT NULL · `click_time` DATETIME def CURRENT_TIMESTAMP · `user_ip` VARCHAR(100).
Indexes: PK only. *Analytics GROUP BY post_id+channel_id unindexed.*

**3. `{prefix}whcm_inbox`** (:57-68) — `id` PK · `platform` VARCHAR(20) NOT NULL · `channel_id` BIGINT def 0 (upgraded :136) ·
`sender_id` VARCHAR(50) NOT NULL · `sender_name` VARCHAR(100) · `message_text` TEXT NOT NULL · `reply_text` TEXT ·
`received_time` DATETIME def CURRENT_TIMESTAMP · `status` VARCHAR(20) def 'unread' (`unread|auto_replied`).
Indexes: PK only (channel_id/status filters unindexed).

**4. `{prefix}whcm_autoresponders`** (:72-78) — `id` PK · `keyword` VARCHAR(100) NOT NULL · `response_text` TEXT NOT NULL ·
`is_active` TINYINT(1) def 1. (Matching is done in PHP, not SQL.)

**5. `{prefix}whcm_channels`** (:82-96) — `id` PK · `platform` VARCHAR(20) NOT NULL (`telegram|bale`) · `name` VARCHAR(100) NOT NULL ·
`token` VARCHAR(255) (plaintext bot token) · `channel_id` VARCHAR(100) (@handle or numeric chat id) · `channel_link` VARCHAR(255) ·
`enabled` TINYINT(1) def 1 · `sort_order` INT def 0 · `webhook_secret` VARCHAR(64) · `link_config` TEXT (JSON, upgraded :137) ·
`button_config` TEXT (JSON, upgraded :138) · `created_at` DATETIME def CURRENT_TIMESTAMP · `webhook_active` TINYINT(1) def 0 (upgraded :139).

**6. `{prefix}whcm_channel_messages`** (:100-109) — `id` PK · `post_id` BIGINT NOT NULL · `channel_id` BIGINT NOT NULL ·
`message_id` VARCHAR(50) · `status` VARCHAR(20) (`sent|failed`) · `sent_time` DATETIME NULL. **KEY post_id** only;
no `channel_id` key despite per-channel analytics and live-price sync filtering on it.

**7. `{prefix}whcm_post_channel_stats`** (:113-122) — `id` PK · `post_id` BIGINT NOT NULL · `channel_id` BIGINT NOT NULL ·
`views_count` INT · `likes_count` INT · `reactions_data` TEXT (JSON {👍,❤️,🔥}) · **UNIQUE KEY post_channel (post_id, channel_id)**.
⚠️ *Not dropped by uninstall.php (:14-21) — orphaned after plugin removal.*

Upgrade path specifics: `add_column_if_missing` (:134-139) backfills `channel_ids`, clicks/inbox `channel_id`,
channels `link_config/button_config/webhook_active`. Legacy single-channel settings are migrated into
`whcm_channels` when empty (`migrate_legacy_channels` :166-204); default auto-responder rules seeded (:206-217).

---

## 5) Options Catalog

| Key | Type | Purpose | Evidence |
|---|---|---|---|
| `whcm_settings` | array (autoload) | Single flat settings bag, ~24 live keys: `website_link, link_1/2/3_name+url, btn_1/2/3_text (+btn_2/3_url), inline_buttons_active, auto_publish_woo, watermark_active, gold_api_url, gold_template, gold_schedule, gold_currency, gold_image_url, gold_auto_channels[], ai_api_key, ai_model, ai_api_url, caption_format, inbound_method, poll_interval` | db:221-232; admin:146-178 |
| `whcm_settings` (legacy keys, read-only) | — | `telegram_token/channel/link/enabled`, `bale_*` used only by `migrate_legacy_channels` | db:175-199 |
| `whcm_db_version` | string | Schema gate = WHCM_VERSION | db:144, 235 |
| `whcm_poll_interval_used` | string | Reschedule detector for `whcm_poll_updates` | cron:23-31 |
| `whcm_upd_offset_{channel_id}` | int (autoload) | getUpdates offset per channel; **never cleaned on channel delete/uninstall** | cron:294, 330 |
| `whcm_last_gold` | array `{key, at}` | Gold change-detection memo | gold:328, 353 |
| transient `whcm_selfheal` | 30s+ | Self-heal throttle on `init` | cron:60-66 |
| postmeta `_whcm_auto_sent` | 'yes' | Auto-publish dedupe per product | cron:146, 191 |
| postmeta `_whcm_order_source` | string | Channel attribution on orders | roi:27 |
| cookie `whcm_source_channel` | 30 days | Click→order attribution | db:524; roi:16 |

Performance notes: everything is autoloaded (small, acceptable). `ai_api_key` sits in plaintext inside the autoloaded bag.

---

## 6) AJAX / Action Endpoint Catalog + Security Assessment

Guard for all: nonce `whcm_ajax_nonce` + `manage_options` (admin.php:1184-1189). All registered privileged-only.
Evidence = handler line in class-whcm-admin.php.

| # | Handle | Function | Behavior | Notes / risks |
|---|---|---|---|---|
| 1 | `whcm_test_bot` | :1191 | `getMe` on channel | ok |
| 2 | `whcm_save_post` | :1314 | Insert whcm_posts row; instant→send now; scheduled→single cron event | content via `wp_kses_post`; scheduled time regex-validated (:1376) |
| 3 | `whcm_update_stats` | :1426 | Overwrites views/likes/reactions on a post row | **Orphan** — no caller in JS; trusts client numbers |
| 4 | `whcm_ai_generate` | :1448 | AI copy for title/price | falls back to template |
| 5 | `whcm_broadcast_gold` | :1484 | Manual gold broadcast, selected or all channels | values normalized `en_num` |
| 6 | `whcm_fetch_gold_api` | :1528 | Server-side fetch of configured gold URL → fills boxes | SSRF surface is the stored setting, not the call |
| 7 | `whcm_add_autoresponder` | :1565 | Insert rule | keyword/text sanitized |
| 8 | `whcm_del_autoresponder` | :1572 | Delete rule by id | ok |
| 9 | `whcm_create_custom_coupon` | :1579 | Creates WC coupon (code/type/amount/min/desc) | admin-only; type string unvalidated against WC types |
| 10 | `whcm_save_quick_links` | :1593 | Persist global link defaults | **Orphan** — no JS caller |
| 11 | `whcm_save_quick_buttons` | :1606 | Persist global button defaults | **Orphan** — no JS caller |
| 12 | `whcm_add_channel` | :1200 | Insert channel (+generated webhook_secret) | token plaintext |
| 13 | `whcm_update_channel` | :1213 | Update channel fields | ok |
| 14 | `whcm_delete_channel` | :1227 | Delete channel | **leaves `whcm_upd_offset_{id}` orphan** |
| 15 | `whcm_set_webhook` | :1233 | `setWebhook` (Telegram only sends secret_token) | requires SSL |
| 16 | `whcm_save_channel_ui` | :1283 | 3+3 per-channel links/buttons JSON | ok |
| 17 | `whcm_delete_channel_ui` | :1308 | Reset channel UI | ok |
| 18 | `whcm_save_post_stats` | :1438 | Set likes + 👍/❤️/🔥 per post×channel | manual curation, by design |
| 19 | `whcm_poll_now` | :1245 | Manual `poll_channel_updates` for one/all channels | sync HTTP in admin request |
| 20 | `whcm_test_ai` | :1459 | Test AI creds; **persists posted ai_url/key/model into settings BEFORE testing** (:1471-1475) | state mutation on test endpoint |

No SQL injection found: every dynamic query uses `$wpdb->prepare` or `insert/update/delete`; the only raw statements are
uninstall DROPs and `SHOW COLUMNS`/`ALTER` with internal identifiers (db:152-159, uninstall:24).
Admin views consistently escape output; no stored-XSS sink found server-side (client-side preview XSS noted in §11).

**Non-AJAX unauthenticated routes** (both `init`-hook):
- `/?whcm_click={post_id}&channel={channel_id}` — click tracker (bootstrap:55-69): **unauthenticated, unthrottled**.
- `/?whcm_webhook={channel_id}` — inbound updates (bootstrap:77-104): Telegram auth via secret header; **Bale: none**.

---

## 7) External Delivery Behavior (Telegram / Bale)

- **Hosts**: `https://api.telegram.org/bot{token}` and `https://tapi.bale.ai/bot{token}` (sender:8-13). Bale is treated as a
  Bot-API clone — same methods, no `parse_mode` by default (Bale renders raw HTML as text; the reason captions ship plain).
- **Methods used**: `getMe` (test), `sendMessage` (posts + auto-replies + scheduled), `sendPhoto`, `sendVideo`
  (mp4/mov/webm by URL), `editMessageCaption` (live price sync, `parse_mode=HTML` here only), `setWebhook`
  (with `secret_token` for Telegram only), `deleteWebhook`, `getUpdates` (`offset/limit=50/timeout=2`).
- **Payload construction**: `chat_id` (string @handle or numeric), `caption` = title line + content + `—————————————` +
  `◾️ {link name}` ×3 (plain mode) or `<a>` list (html mode); `reply_markup` JSON with up to two rows:
  row 1 = 3 channel links (third link = `/?whcm_click={post}&channel={id}` when post-bound), row 2 = 3 buttons
  (`{text,url}` URLs only). `disable_web_page_preview=false` on text messages.
- **Media pipeline**: local-only GD watermark (dark bar + gold rule, JPEG 90 into `uploads/whcm-branded/`); remote URLs
  passed straight to the platform; video never watermarked.
- **Error handling**: per-channel result objects `{success, message, message_id}`; failed sends recorded per channel row;
  admin UI joins channel errors with ` | `; webhook registration surfaces the platform's `description` and the HTTP code;
  poll path detects API 409 to reconcile `webhook_active`. No retry/backoff anywhere; failures are terminal.

---

## 8) Gold Module Behavior

Fetch (`WHCM_Gold::fetch_values`, gold:150-185) → recursive needle parser (§3.6) → `format_price` (rial/10→toman; ounce→dollar)
→ template `{g18k}/{coin}/{oz}/{time}` → Persian digits + thousands separators → Jalali timestamp (double-offset bug) →
send. Auto mode: cron `whcm_gold_tick` at 5m–6h or daily 11:30 (double-schedule bug), publishes **only when the rounded
triple changes** (`whcm_last_gold` memo), targets `gold_auto_channels` or all enabled channels, optional image, watermark on.
Manual mode: admin boxes (accept Persian/Arabic digits, separators, and units — `en_num` strips everything non-numeric),
«دریافت از API» fills boxes with raw numbers (9.7.1 fix), broadcast builds its own caption with `now_jalali()`.

---

## 9) AI Module Behavior

Provider-agnostic OpenAI-compatible `POST {ai_api_url}` with `Authorization: Bearer {key}`, model default `gpt-4o-mini`,
`temperature 0.8`, Persian system prompt (gold/jewelry copywriter, ≤3 sentences, emojis, no HTML), user payload =
product name/features/price. Output sanitized to tag-free text and returned as both `telegram_text` and `bale_text`.
Failure (missing key, HTTP error, malformed response) → deterministic Persian template with random emoji. Seven preset
provider profiles with endpoint URLs + model lists are surfaced in the settings tab (admin.php:978-1016).
Trigger points: «کپشن هوشمند» button on publish tab, «تست کپشن هوشمند» in settings (persists creds — see §6 #20).

---

## 10) Cron Behavior

| Hook | Schedule | Work |
|---|---|---|
| `whcm_process_queue_event` | every_1_minute | Sends up to 10 due pending posts |
| `whcm_poll_updates` | 30s/1m/2m/5m (config) | getUpdates per enabled channel (skips webhook-active), auto-reply, offset advance |
| `whcm_gold_tick` | 5m/15m/30m/1h/2h/3h/6h or daily 11:30 | Change-detected gold broadcast |
| `whcm_process_scheduled_post` | single event per post | Exact-time send for scheduled posts (site-TZ aware, admin.php:1402-1424) |
| `init` @20 self-heal | every page view, transient-gated ≥30s | Queue + poll inline (blocks page render) |

Deactivation unschedules the three recurring hooks (single next occurrence each). **Reliance on WP-Cron traffic remains** —
the plugin itself documents a system-cron workaround (admin.php:1164-1172).

---

## 11) Security & Performance Findings (severity + evidence)

### Security
- **HIGH — Unauthenticated Bale webhook (spoofing + bot relay)**: bootstrap:77-104 authenticates Telegram only;
  for `platform='bale'` anyone can POST forged updates → fake inbox entries, and `WHCM_Inbox::send_reply_to_user`
  (inbox:93-107) will sendMessage to **attacker-chosen chat ids** using the store's bot token (spam relay / reputational abuse).
- **HIGH — Click/view forgery + DB flood**: bootstrap:55-69 + db:504-527 insert a click row and increment counters for any
  GET, no validation, no throttle, no nonce (by nature public) → trivially farmable stats and unbounded `whcm_clicks` growth.
- **MEDIUM — Secrets in plaintext + UI echo**: bot tokens stored plaintext (db:263) and rendered into editable inputs
  (admin:356); AI API key stored in `whcm_settings` and echoed into the settings form (admin:1065). Exposure limited to
  `manage_options` users, but leaks via backups/screen-shares; no masking/encryption/last-4 display.
- **MEDIUM — Partial-form settings wipe**: admin:146-178 rebuilds the whole settings array; the ticker-tab form (:480-531)
  submits without AI/caption/inbound/auto-publish fields → those reset (AI key lost, `watermark_active`/`auto_publish_woo`
  flipped to 'no'). Data-loss + silently disables security-relevant automation.
- **MEDIUM — Admin-defined outbound fetch targets (SSRF-lite)**: `gold_api_url` (gold:159) and `ai_api_url` (ai:66; also
  `ajax_test_ai` admin:1461-1475 which **persists before validating**) accept arbitrary URLs incl. private ranges; multi-admin
  sites can be probed internally. No scheme/host allow-listing.
- **LOW — API response leakage**: gold:172-175 embeds 300 chars of the fetched body in error text shown in admin.
- **LOW — Client-side XSS in preview**: admin.js:35-36 `.html()` on unescaped title/content; product names (from lower-priv
  editors) flow through `data-*` into the preview. Contained to admin session.
- **LOW — Dashboard widget info exposure**: admin:51-57 registers the stats widget for all dashboard users (no cap filter);
  aggregate stats visible to editors/authors.
- **LOW — Privacy**: raw `REMOTE_ADDR` persisted per click (db:517), no retention/trim job on `whcm_clicks`/`whcm_inbox`.
- **LOW — Ineffective error handling**: try/catch around `wpdb` (db:151-163) never triggers (no exceptions); failures silent.
- **LOW — Uninstall residue**: misses `whcm_post_channel_stats` table (uninstall:14-21) and `whcm_upd_offset_*`,
  `whcm_poll_interval_used`, `whcm_last_gold` options.
- **LOW — Deactivation gaps**: `wp_next_scheduled`-based cleanup (cron:124-131) can leave multiple scheduled singles.
- **Positive**: all 20 AJAX endpoints nonce+capability guarded; no nopriv endpoints; consistent `esc_html/esc_attr` in views;
  Telegram webhook secret compared with `hash_equals`; SQL layer fully prepared; `ABSPATH` guards everywhere.

### Performance
- **N+1 analytics**: 7 COUNT/SUM queries per channel per analytics page load (admin:729-734), plus `FIND_IN_SET` on a TEXT
  column (:731) which cannot use an index; unindexed `whcm_posts(status,scheduled_time)`, `whcm_channel_messages(channel_id)`,
  `whcm_clicks(post_id,channel_id)`, `whcm_inbox(channel_id,status)`.
- **Blocking HTTP in visitor requests**: self-heal runs queue + getUpdates inline on `init` (cron:59-69); worst case several
  12-30s outbound calls per page view on slow hosts.
- **Sync loop on product save**: `woocommerce_update_product` → per-sent-message `editMessageCaption` (bootstrap:110-132);
  bulk price edits trigger N sequential API calls in the admin request.
- **Double fetch per gold tick**: `tick()` fetches, then `build_message()` fetches again (gold:322 + gold:246).
- **Autoloaded per-channel offsets** (`whcm_upd_offset_*`) and orphan-on-delete accumulation.
- **No cleanup jobs**: `whcm_clicks`, `whcm_inbox`, `whcm_channel_messages`, branded-image cache (`uploads/whcm-branded/`)
  grow unbounded.

---

## 12) CHANGELOG Feature Timeline (evolution = product priorities)

- **8.0.0** — Multi-channel rework: `whcm_channels` table, channels tab, multi-select publishing, real webhook inbox,
  real OpenAI-compatible AI (template fallback), honest gold rates, `uninstall.php`.
- **9.0.0** — Per-channel 3 links + 3 buttons; clickable link-on-text; **Jalali calendar + 24h clock**; professional
  analytics tab (per-channel sends/feeds, clicks per post×channel, editable feedback); new `whcm_post_channel_stats` table;
  webhook error surfacing + HTTPS check; no-HTML replies for Bale.
- **9.1.0** — Scheduling reliability: exact per-post single cron events, 1-minute queue, **self-heal on init**;
  auto-responder via **getUpdates polling** (no HTTPS needed), `webhook_active` column, 409 conflict handling.
- **9.2.0** — Bale compatibility push: captions stripped of all HTML, links become real inline buttons; poll-now button;
  inbound method setting; platform labels everywhere + comparison graph + smart suggestions.
- **9.3.0** — Critical fix (private `poll_channel_updates` → fatal, made public); AI output always tag-free; **AI provider
  catalog + connection test**; autoresponder setup guides; emoji font stack.
- **9.4.0** — Poll interval configurable 30s–5min (latency focus); full Bale (@BaleBotFather) setup guide.
- **9.6.0** — Gold API robustness: recursive smart key parser (nested/`name-value`/Persian digits), error body sample.
- **9.7.0** — Gold UX redesign: Persian digits + thousands separators, Jalali "updated at", rial→toman auto conversion,
  ounce in dollars, image attachment, **change-detection scheduling** (5m–6h + daily 11:30), selective publishing.
- **9.7.1** — Gold parse/units fix (boxes get raw numbers only) + date/time formatting fix.

**Reading**: early releases = platform/infrastructure (channels, scheduling, inbox); mid = Bale compatibility + AI UX;
late = obsessive iteration on the gold-rate ticker (3 consecutive releases 9.6→9.7.1) — the gold broadcast is the product's
emotional core. Commerce features (auto-publish, live price sync, ROI cookie, coupons) were built early and never revisited.
README_FA.txt (self-labeled «نسخه ۹.۷.۰», one patch behind the 9.7.1 header) documents: multi-channel, inbox/auto-responder,
Woo auto-publish, live price updates on product edit, gold API rates, smart discount builder, AI captions, watermark, ROI
tracking, per-channel links/buttons, Jalali scheduling, pro analytics.

---

## 13) Persian Terminology Glossary (for Postyar UX reuse)

| Persian | English (plugin usage) |
|---|---|
| کانال / کانال‌ها | Channel(s) (Telegram/Bale destination) |
| انتشار محتوا | Content publishing |
| ارسال فوری / زمان‌بندی‌شده | Instant / scheduled send |
| تقویم شمسی | Jalali (Persian) calendar |
| دکمه شیشه‌ای | Inline (glass) keyboard button |
| صندوق پیام | Inbox |
| پاسخگوی خودکار | Auto-responder |
| کلمه کلیدی | Auto-responder trigger keyword |
| گروه گفتگو | Linked discussion group |
| پیام خصوصی | Bot private message |
| نرخ لحظه‌ای طلا | Live gold rate ticker |
| طلا ۱۸ عیار | 18-karat gold (per gram) |
| سکه بهار آزادی | Bahar Azadi coin |
| انس جهانی | Global (troy) ounce |
| تومان / ریال / دلار | Toman / Rial / Dollar units (rial÷10=toman) |
| به‌روزشده در | "Updated at" timestamp |
| انتشار در کانال‌های انتخاب‌شده | Publish to selected channels |
| بازدید / کلیک / لایک / واکنش | View / click / like / reaction |
| بازخورد | Feedback (per post×channel stats) |
| پیشنهادهای هوشمند | Smart suggestions (rule-based advice) |
| کپشن هوشمند | AI smart caption |
| سازنده کد تخفیف | Discount coupon builder |
| واترمرک | Watermark |
| دریافت فوری پیام‌ها (poll) | Fetch messages now (manual poll) |
| ارسال موفق / ناموفق / در انتظار | Sent / failed / pending |
| اقساط / آدرس | Installments / Address (seeded keywords) |
| عیار / اجرت / کارمزد | Karat / making charge / fee (product vocab) |

---

## 14) Disposition Recommendations for the New Postyar Connector

**Keep (proven concepts — port with care):**
1. Platform-adapter idea: Telegram + Bale behind one Bot-API-shaped client (`api_base` switch) — formalize as adapters.
2. Dual inbound: webhook (with per-channel secret) **and** getUpdates polling fallback with 409 reconciliation (cron:279-331) —
   this is the single most resilient design decision in the plugin; keep the mutual-exclusion rule.
3. Click tracker → 30-day attribution cookie → order source meta (bootstrap:55, db:504, roi:15) — keep, but add signing/throttle.
4. Per-channel link/button override with global defaults (db:349-413).
5. Plain-text captions + real inline keyboards as the Bale-safe default (sender:25-57) — keep as default; implement
   `parse_mode` properly if HTML mode is ever offered.
6. Gold change-detection broadcast with memo (gold:315-357) and the recursive JSON price parser (gold:190-222).
7. Exact per-post single cron events + 1-minute queue + self-heal (cron:59-69, admin:1402-1424).
8. jalali-picker.js — clean, dependency-free, reusable as-is.
9. Change-detection memo pattern and honest error surfacing from platform API `description` fields.

**Redesign (architectural):**
1. **Settings model** — replace the single flat option + per-tab partial POST forms with the Settings API
   (`register_setting` + per-tab sanitize callbacks) to eliminate the ticker-tab wipe (admin:146-178 vs 480-531).
2. **AJAX → REST** — move the 20 admin-ajax handlers to REST routes with `permission_callback` + `register_rest_route`
   arg schemas; delete the 3 orphaned endpoints (or wire them).
3. **Webhook auth for all platforms** — require a per-channel shared secret (header) for Bale too, plus optional
   `allowed_updater_ids`; never reply to attacker-supplied chat ids without validation (inbox:93-107).
4. **Async delivery** — decouple sends from admin/init requests: queue table + Action-Scheduler (or at minimum
   wp_remote_post async) so page views and product saves never block on platform HTTP (cron:59-69, bootstrap:110-132).
5. **Schema** — add indexes (`whcm_posts(status,scheduled_time)`, `channel_messages(channel_id)`, `clicks(post_id,channel_id)`,
   `inbox(channel_id,status)`); pre-aggregate channel stats to kill the N+1 analytics loop; store `channel_ids` as a
   junction table, not `FIND_IN_SET` TEXT.
6. **Secrets** — encrypt tokens/keys at rest (or at least mask in UI + `show_last4`), never echo the key back into forms.
7. **Cron cleanup** — `wp_clear_scheduled_hook` on deactivation and on channel delete (incl. `whcm_upd_offset_{id}`).
8. **Time handling** — fix the double-offset in `now_jalali` (gold:88-97) and the double-schedule at `daily_11_30`
   (gold:306-308); use a vetted Jalali library server-side.

**Drop:**
1. Orphaned endpoints `whcm_update_stats`, `whcm_save_quick_links`, `whcm_save_quick_buttons` (admin:15, 22-23).
2. Dead code `create_channel_coupons` (roi:33-56) — or promote coupons to a real feature with per-channel codes.
3. Legacy migration path from `telegram_token`/`bale_token` flat settings (db:166-204) — no continuity needed for Postyar.
4. Hardcoded vendor branding: hoomanweb.ir badges, defaults `t.me/MyGoldShop`, `t.me/Support`, seeded gold-shop
   autoresponder texts (db:206-217), designer badge CSS — replace with neutral onboarding defaults.
5. HTML caption mode as currently implemented (sends tags without `parse_mode` — broken at origin, sender:133-146).
6. Raw-IP click logging without retention policy (privacy).
7. The "send in render" settings handler pattern entirely.

**Bottom line for the rebuild:** the domain knowledge (Bale quirks, polling/webhook coexistence, gold parsing, attribution
flow) is worth carrying forward; the implementation (god-class admin, flat settings, sync loops, plaintext secrets) is not.

# ASOVIN / پُست‌یار (WHCM SaaS) — File Inventory (Forensic Audit, Team A)

Source: `/home/z/my-project/reference/po.source/asovin/asovin/` (READ-ONLY)
Audited: every PHP file read in full or via targeted line-range reads; all SQL, htaccess, config, JS entry files, manifest, service worker, SQLite DB, and error logs inspected on disk.

Totals: **145 catalogued files** (74 PHP) + 11 hidden files on disk (6 `.htaccess`, 4 `.gitkeep`, + `.htaccess` variants) — 156 physical files. Front controller: `public/index.php` (root `index.php` is a shim). Cron: `cron.php` (CLI-only).

Disposition legend:
- **REBUILD_AS_SERVICE** — behavior must be re-implemented in the new Postyar services (spec in AUDIT.md §20).
- **REJECT** — do not port; unsafe/broken/dead.
- **CONCEPT_ONLY** — idea is retained in the product spec; code itself is throwaway.
- **ASSET** — reusable binary/static asset (icons, fonts, images, minified lib).

---

## 1. Root, config, migrations, storage

| # | Path | Type | Purpose (1 line) | Consumers | DB | External API | Side effects | Disposition |
|---|------|------|------------------|-----------|----|--------------|--------------|-------------|
| 1 | `index.php` | PHP | Root redirector that `require`s `public/index.php` (cPanel/subfolder compat) | Web host docroot | N | N | none | REJECT (in new system use proper web root) |
| 2 | `cron.php` | PHP | CLI cron driver: GoldTicker::tickAll, Inbox::pollAllActive, ScheduledPost::processAll, SubscriptionManager::processExpiries + code cleanup, Bootstrap::cleanupOldUploads(30) | crontab `* * * * * php cron.php` | Y (many) | Telegram/Bale (polling), gold API, SMS, SMTP | sends messages, deletes expired rows/files | REBUILD_AS_SERVICE (worker/scheduler) |
| 3 | `.htaccess` | conf | Rewrites everything into `/public/`, denies `cron.php`, `config.php`, composer files | Apache/LiteSpeed | N | N | none | CONCEPT_ONLY |
| 4 | `config/config.php` | PHP | Live production config: app url `https://asovin.ir`, tz Asia/Tehran, **driver sqlite**, MySQL creds present, SMTP `localhost:25` noreply@asovin.ir, SMS.ir api key + line `30002108029721` | Bootstrap | N | N | none | REJECT (contains real credentials; rotate) |
| 5 | `config/config.example.php` | PHP | Template config incl. `vapid` block (subject/public_key/private_key_pem) | operators | N | N | none | CONCEPT_ONLY |
| 6 | `config/.htaccess` | conf | `Deny from all` for config dir | Apache | N | N | none | CONCEPT_ONLY |
| 7 | `migrations/install.sql` | SQL | Full SQLite schema: 31 tables + 29 indexes (canonical fresh-install schema) | Bootstrap::checkAndRunMigrations | Y | N | creates schema | REBUILD_AS_SERVICE (new migrations) |
| 8 | `migrations/install_mysql.sql` | SQL | MySQL mirror of install.sql (ENGINE=InnoDB, utf8mb4, INT AUTO_INCREMENT) | Bootstrap (mysql driver) | Y | N | creates schema | REBUILD_AS_SERVICE |
| 9 | `migrations/mobile_api.sql` | SQL | SQLite `api_tokens` table + 3 indexes | *nobody at runtime* (never invoked by Bootstrap) | Y | N | none | REBUILD_AS_SERVICE (fold into base schema) |
| 10 | `migrations/mobile_api_mysql.sql` | SQL | MySQL `api_tokens` mirror | *nobody at runtime* | Y | N | none | REBUILD_AS_SERVICE |
| 11 | `migrations/.htaccess` | conf | Deny web access to migrations | Apache | N | N | none | CONCEPT_ONLY |
| 12 | `storage/db/whcm_saas.sqlite` | sqlite | **Live production DB** (364 KB): 34 tables incl. schema_migrations v1→v12; 3 users, 2 channels, 4 plans, 79 settings; **tenant-0 settings contain live SMTP password, DeepSeek API key, admin card number**; `api_tokens` table missing | app at runtime | Y | N | none | ASSET/REJECT — data-only; **credentials must be rotated** |
| 13 | `storage/logs/last_error.txt` | log | Last router exception (proves prod fatal: `Auth::requireLogin()` undefined at MainController:2635) | debugging | N | N | none | ASSET (evidence) |
| 14 | `storage/logs/.gitkeep`, `storage/db/.gitkeep` | - | dir placeholders | git | N | N | none | ASSET |
| 15 | `storage/.htaccess` | conf | Deny web access to storage | Apache | N | N | none | CONCEPT_ONLY |
| 16 | `agent-ctx/15-22-api-controllers.md` | md | Dev-agent notes listing the 7 mobile API controllers + mobile_api.sql | documentation | N | N | none | ASSET (reference) |

## 2. Public entry points & PWA

| # | Path | Type | Purpose | Consumers | DB | External API | Side effects | Disposition |
|---|------|------|---------|-----------|----|--------------|--------------|-------------|
| 17 | `public/index.php` | PHP | **Front controller**: Bootstrap::run; if URI starts `/api/v1/` loads entire mobile-API stack and dispatches; else registers ~87 web routes and `Router::dispatch()`; gz output; global try/catch 500 | all web+API traffic | Y | via handlers | none | REBUILD_AS_SERVICE (router/kernel) |
| 18 | `public/manifest.php` | PHP | Dynamic PWA manifest with runtime asset base URL, RTL fa-IR, 10 icons, dashboard shortcut | browsers | N | N | none | ASSET (pattern) |
| 19 | `public/manifest.json` | JSON | Static fallback manifest (start_url `./`) | browsers | N | N | none | ASSET |
| 20 | `public/service-worker.js` | JS | PWA SW v5: precache of css/js/fonts/icons, dynamic base path | PWA | N | N | caches assets | ASSET |
| 21 | `public/.htaccess` | conf | Front-controller rewrite (non-file → index.php); denies dotfiles, config/cron/error_log | Apache | N | N | none | CONCEPT_ONLY |
| 22 | `public/error_log` | log | PHP warnings from prod host (undefined `subject` in admin-email-settings.php:149, repeated) | debugging | N | N | none | ASSET (evidence) |
| 23–46 | `public/assets/css/*.css` (components, dashboard, home, admin, tailwind-home, jalalidatepicker.min) | CSS | UI styles (6 files) | views | N | N | none | ASSET |
| 47–53 | `public/assets/js/*.js` (utils, dashboard, home, admin, push, pwa-install) | JS | utils (fa digits, SafeStorage, price fmt), dashboard.js (682 ln: posts queue via `/api/process-post-queue`, heartbeat `/api/heartbeat`, notification/announcement read), admin.js (452 ln), home.js, push.js (172 ln: VAPID subscribe flow), pwa-install.js | views | N | N | none | ASSET (behavior spec for FE) |
| 54 | `public/assets/js/jalalidatepicker.min.js` (13.5 KB) | JS | Third-party Jalali date picker lib (vendored) | dashboard form | N | N | none | ASSET |
| 55 | `public/assets/css/jalalidatepicker.min.css` | CSS | ditto | dashboard | N | N | none | ASSET |
| 56–63 | `public/assets/fonts/Vazirmatn-{Thin..Black}.woff2` (8) | font | Persian typeface weights | all pages | N | N | none | ASSET |
| 64–78 | `public/assets/icons/*.png` (15) | image | PWA/favicon icons incl. maskable | PWA | N | N | none | ASSET |
| 79–83 | `public/assets/images/*.webp` (5: logo, logo-full, logo-white-bg, logo-full-white-bg, asovin) | image | brand logos | pages | N | N | none | ASSET |
| 84–90 | `public/assets/uploads/*.webp` (1) | image | user-uploaded media sample | posts | N | N | none | ASSET |
| 91–97 | `public/assets/receipts/*.webp` (6) | image | payment receipt uploads (real user data) | admin panel | N | N | **PII on disk** | ASSET (pattern); purge data |
| 98–101 | `public/assets/plans/*.webp` (4) | image | plan cover images | landing/admin | N | N | none | ASSET |

## 3. `app/Core` (10 PHP)

| # | Path | Purpose | DB tables | External | Notes / Disposition |
|---|------|---------|-----------|----------|---------------------|
| 102 | `app/Core/Bootstrap.php` (1109 ln) | Kernel: error reporting, PSR-4 autoloader (WHCM\ + PHPMailer), config load, Session::start, dir creation, PDO sqlite/mysql singleton, runs `install.sql` when `users` table missing + versioned migrations `v2…v12` tracked in `schema_migrations`, security headers, `getAssetsUrl/getRouteUrl`, smart SQL splitter, `cleanupOldUploads(30)` | schema_migrations + all | none | REBUILD_AS_SERVICE (proper migration runner; never auto-DDL in request path) |
| 103 | `app/Core/Session.php` | Secure cookie params (httponly, SameSite=Lax, secure on HTTPS), set/get/remove/destroy/regenerate | N | N | REBUILD_AS_SERVICE |
| 104 | `app/Core/Auth.php` | register (first user ⇒ `superadmin`; auto-creates free plan + subscription w/ end 2099), login (bcrypt verify, session regenerate, status gate), logout, user() (cached, suspended ⇒ force logout), role checks, `tenantId()` = **user id** | users, plans, subscriptions | N | REBUILD_AS_SERVICE |
| 105 | `app/Core/Csrf.php` | Per-session token (`bin2hex(random_bytes(32))`), `hash_equals` validation, `field()` helper. Enforced on ~80 POST routes; **not enforced** on `/api/process-post-queue`, `/api/heartbeat` (auth-only) | N | N | REBUILD_AS_SERVICE |
| 106 | `app/Core/RateLimit.php` | DB-backed per-IP+action counters (`rate_limits`), trusted-proxy XFF handling, `check/hit/clear` | rate_limits | N | REBUILD_AS_SERVICE (Redis-backed) |
| 107 | `app/Core/HttpClient.php` | cURL with stream fallback; SSL verify on; returns {success,code,body,error}; form or JSON body | N | all | REBUILD_AS_SERVICE |
| 108 | `app/Core/Mail.php` | PHPMailer SMTP or native `mail()` fallback; UTF-8 base64 subject; password-reset HTML builder | N | SMTP | REBUILD_AS_SERVICE |
| 109 | `app/Core/EmailTemplate.php` | Event-driven email: templates in `email_templates` (event_key unique), `{{var}}` replace, SMTP config from settings(tenant 0) w/ config fallback, logs to `email_log`, stats, bulk | email_templates, email_log, settings, users | SMTP | REBUILD_AS_SERVICE |
| 110 | `app/Core/Sms.php` | SMS.ir ultrafast send (single+bulk), phone normalize (09xx), per-phone 3/hour rate limit via sms_log, API key from settings(tenant 0) → config fallback, logs to `sms_log` | sms_log, sms_templates, settings | sms.ir | REBUILD_AS_SERVICE |
| 111 | `app/Core/WebPush.php` | Zero-dependency Web Push: VAPID ES256 JWT (RFC 8292), aes128gcm payload encryption (RFC 8291) via openssl | N | push services | REBUILD_AS_SERVICE |

## 4. `app/Domain` (13 PHP)

| # | Path | Purpose | DB | External | Disposition |
|---|------|---------|----|----------|-------------|
| 112 | `Domain/ChannelManager.php` | addChannel (quota check → bot `getMe` test w/ Iran-filtering tolerance → **global anti-cheat registry lock** `channel_registry` → transactional insert; default 3 link_config + 2 button_config), testBotConnection, getTenantChannels, getChannel (tenant-scoped), deleteChannel (keeps registry lock), setWebhook (`/api/webhook?channel_id=N`, secret_token), tryActivateWebhook, deleteWebhook | channels, channel_registry, settings | Telegram/Bale Bot API | REBUILD_AS_SERVICE |
| 113 | `Domain/Sender.php` | formatCaption (plain/HTML per-tenant `caption_format`; 3rd link replaced by `/click?p=..&c=..` tracker), inline keyboards (2 rows), sendPostToChannel (sendPhoto/sendVideo/sendMessage by extension), sendPostToChannels (per-channel rows in `channel_messages`, seeds `post_channel_stats`), liveUpdateCaption (editMessageCaption) | settings, channels, channel_messages, post_channel_stats | Bot API | REBUILD_AS_SERVICE |
| 114 | `Domain/Quota.php` | getTenantQuota (active subscription join plan; used_channels=count channels; used_posts=count posts sent since sub start; max_posts 0 = ∞; features JSON), consumePostQuota | subscriptions, plans, channels, posts | N | REBUILD_AS_SERVICE |
| 115 | `Domain/GoldTicker.php` | fetchValues (admin `gold_custom_api_url` → tenant url → default tgju.org; recursive keyword parser incl. Persian keys; en_num conversion), buildMessage (tenant template {g18k}/{coin}/{oz}/{time}, rial→toman ÷10), tick (feature-gated; schedule ≠ manual; change-detection vs `last_gold_prices`; posts to selected/all channels; records system post), tickAll | settings, posts, subscriptions, channels | gold APIs | REBUILD_AS_SERVICE |
| 116 | `Domain/ScheduledPost.php` | processAll: due `scheduled` posts (≤50/run), fallback to all channels, quota-gated (stays scheduled if exhausted), send → sent/failed | posts, channels | Bot API | REBUILD_AS_SERVICE |
| 117 | `Domain/Wallet.php` | balance on `users.wallet_balance`; credit/debit in transaction w/ `wallet_transactions.balance_after` ledger; cashbackOnPurchase (round(amount×pct/100,2)); convertPointsToWallet (points→balance×rate, type `points_convert`); admin stats | users, wallet_transactions | N | REBUILD_AS_SERVICE |
| 118 | `Domain/Referral.php` | code `POST-XXXXXX` (Crockford-like alphabet), link `/?ref=CODE`, processRegistration (enabled flag, self-ref block, max cap, `referrals` row pending, register reward points/days), processFirstPurchase (percent/fixed → wallet credit, status rewarded), stats/history, settings KV in `referral_settings`; awardReward 'days' extends subscription end | referrals, users, subscriptions, referral_settings, wallet_transactions | N | REBUILD_AS_SERVICE |
| 119 | `Domain/Inbox.php` | webhook handler (message/edited/channel_post variants), receiveMessage: per-channel responder toggle (`responder_enabled_{id}`), mb_stripos keyword match → live reply, log to `responder_logs`, append to `inbox`; pollChannelUpdates (getUpdates offset stored in settings `upd_offset_{id}`, 409⇒webhook_active=1), pollAllActive (feature-gated) | settings, auto_replies, responder_logs, inbox, channels | Bot API | REBUILD_AS_SERVICE |
| 120 | `Domain/LinkTracker.php` | rewrites every URL in content to `/go/{code}` rows in `link_tracking` (post/channel/tenant scoped), handleClick (ip-unique click → `link_clicks`, counters), stats + daily series (driver-split SQL) | link_tracking, link_clicks | N | REBUILD_AS_SERVICE |
| 121 | `Domain/SubscriptionManager.php` | processExpiries (expire actives past end_date; reminder ≤3 days via `expiry_reminder_sent` flag; email+SMS by event), cleanupVerificationCodes; sendSmsByEvent maps event_key→template_id | subscriptions, users, sms_templates | SMS/SMTP | REBUILD_AS_SERVICE |
| 122 | `Domain/VerificationCode.php` | 6-digit code, 5-min expiry, single-use, hash_equals verify, cleanup | verification_codes | SMS | REBUILD_AS_SERVICE |
| 123 | `Domain/Notification.php` | create/broadcast (all non-superadmin), list/unread count/recent, mark read (ownership check), markAll, cleanupOld (SQLite-only SQL) | notifications | N | REBUILD_AS_SERVICE |
| 124 | `Domain/TextFormat.php` | fa_num/fa_digits/en_num (Persian+Arabic digits), jalaali g2j algorithm, now_jalali, month names, format_price (rial ÷10; oz in USD), mysql_to_jalali (UTC vs Tehran-aware), timeAgo | N | N | REBUILD_AS_SERVICE (Jalali util) |

## 5. `app/Controllers` + `app/Modules` (17 PHP)

| # | Path | Purpose | DB | Disposition |
|---|------|---------|----|-------------|
| 125 | `Controllers/BaseController.php` | checkAuth/checkSuperAdmin(+IP whitelist)/checkAdminOrSupport, redirect via `?route=`, flash messages, render (extract+include+exit), `uploadAndConvertToWebp` (size/ext/finfo MIME/php-tag scan/GD→WebP q80/re-verify), jalaliToGregorian (reverse algorithm), saveSetting(sBatch) | settings | REBUILD_AS_SERVICE |
| 126 | `Controllers/MainController.php` (2796 ln) | **God controller**: 90+ actions — landing (math captcha), login/register (privacy consent, referral hook, welcome email), dashboard aggregation, profile/password, channel CRUD, card-to-card payment w/ receipt upload, admin panel aggregation (paginated), click tracker, **webhook receiver (X-Telegram-Bot-Api-Secret-Token validated)**, gold settings/publish, auto-reply CRUD, post create (Jalali→Gregorian schedule), cancel, queue processor (AJAX), heartbeat (ScheduledPost::processAll), password reset (email token stored in `settings`, **buggy lookup LIMIT 1**), SMS reset (session-bound), referral/wallet sections, points→wallet (rate 10), admin SMS/email settings, bulk send, push endpoints (**call non-existent `Auth::requireLogin()`/`Auth::id()` → fatal**), sendPushToUser/sendPushBroadcast, ticket categories | all tables | REBUILD_AS_SERVICE (split into bounded services) |
| 127 | `Modules/ModuleLoader.php` | Scans `Modules/*/module.json`, includes `Routes.php` when `enabled` truthy | N | REJECT as-is: **all 9 module.json files are empty ⇒ loader is a no-op** |
| 128–136 | `Modules/{Users,Core,AI,GoldTicker,Support,Channels,Billing,WooCommerce,AutoResponder}/module.json` (9) | Module manifests — **all 0 bytes** | N | REJECT |
| 137–144 | `Modules/*/Routes.php` (8 files, 7 empty) | Only `Support/Routes.php` has content (10 ticket/announcement routes incl. user reply/close + assign) — **never loaded** ⇒ `/dashboard/reply-ticket`, `/dashboard/close-ticket`, `/hnnh/assign-ticket` unreachable | N | REJECT (fold real routes into kernel) |
| 145 | `Modules/Users/Controllers/UserController.php` | addManual (create user/support_agent), grantSubscription (expire old, insert new), suspend/activate/delete (role-guard `!= superadmin`), wipeTestData (hardcoded delete by email/name — junk) | users, subscriptions, notifications | REBUILD_AS_SERVICE |
| 146 | `Modules/Billing/Controllers/PaymentController.php` | approve: payment pending → approved, expire old subs, insert new sub (+2099 for duration 0), push+in-app notify | payments, subscriptions, plans, notifications | REBUILD_AS_SERVICE |
| 147 | `Modules/Billing/Controllers/PlanController.php` | plan create/edit/delete incl. features JSON {gold_ticker, auto_responder, woocommerce, ai_caption, stats}, discounts, image upload | plans | REBUILD_AS_SERVICE |
| 148 | `Modules/Support/Controllers/TicketController.php` | create (attachment→public/assets/tickets), userReply (concat-threaded message, not ticket_replies), reply (admin), adminCreate (creates on behalf, status replied), close/reopen/delete (admin), closeUser; push broadcasts | tickets, users | REBUILD_AS_SERVICE |
| 149 | `Modules/Support/Controllers/BroadcastController.php` | global announcement → settings(tenant0)+Notification::broadcast+push fan-out | settings, notifications | REBUILD_AS_SERVICE |

## 6. `app/Api` (17 PHP) — Mobile `/api/v1/*`

| # | Path | Purpose | Disposition |
|---|------|---------|-------------|
| 150 | `Api/MobileApiResponse.php` | Uniform JSON envelope {success,message,data} + status helpers (one string contains mojibake "稍后") | REBUILD_AS_SERVICE |
| 151 | `Api/MobileApiAuth.php` | Bearer token auth: 32-byte token, **SHA-256 stored hash**, 30-day expiry, keep-last-5 GC, validate() joins users + updates last_used_at, revoke current/all, sanitizeUser (no password), session injection for reuse of web helpers | REBUILD_AS_SERVICE |
| 152 | `Api/MobileApiRouter.php` | Pattern router `{param}`, global+named middleware (auth/admin/superadmin/rate_limit 120/min), handler resolution `Class@method` under `\WHCM\Api\Controllers\`, jsonInput() | REBUILD_AS_SERVICE |
| 153 | `Api/MobileApiController.php` | Base: input, db, user/userId, requireAdmin/requireSuperAdmin, mini validator (required/email/min/max), uploadImage (GD→WebP; **uses client-supplied MIME only**, weaker than web path) | REBUILD_AS_SERVICE |
| 154 | `Api/Routes/api.php` | **61 route registrations** (see AUDIT.md §4) | REBUILD_AS_SERVICE |
| 155 | `Api/Controllers/AuthApiController.php` (576) | login/register/logout/me/profile/changePassword; email reset (token JSON in settings key `password_reset_token_{uid}`, 60 min, revoke all tokens after); SMS reset (VerificationCode `password_reset` type, RateLimit 3/5min) | REBUILD_AS_SERVICE |
| 156 | `Api/Controllers/ChannelApiController.php` | channel CRUD mirroring web incl. registry anti-cheat on update | REBUILD_AS_SERVICE |
| 157 | `Api/Controllers/PostApiController.php` | list w/ click counts; store (quota; Jalali schedule validated 1300–1500; instant sends synchronously; scheduled stored); show; cancel (status gate); retry (failed→queued, resend now) | REBUILD_AS_SERVICE |
| 158 | `Api/Controllers/DashboardApiController.php` | bootstrap (whole dashboard payload in one call), sync(since) | REBUILD_AS_SERVICE |
| 159 | `Api/Controllers/SettingsApiController.php` | settings KV, gold save/trigger, advanced (18 keys incl. ai_provider/ai_api_key/watermark/poll_interval), auto-responder CRUD/toggle | REBUILD_AS_SERVICE |
| 160 | `Api/Controllers/BillingApiController.php` | public plans, submit card-to-card payment, payment history, coupon validate | REBUILD_AS_SERVICE |
| 161 | `Api/Controllers/SupportApiController.php` | tickets list/store/show/reply — **uses `ticket_replies` table** (web path threads into tickets.message; two divergent reply models) | REBUILD_AS_SERVICE |
| 162 | `Api/Controllers/NotificationApiController.php` | list/markRead/markAll | REBUILD_AS_SERVICE |
| 163 | `Api/Controllers/WalletReferralApiController.php` | wallet + convert (**default rate 1.0 vs web 10; `points_wallet_rate` setting never seeded**) + referral | REBUILD_AS_SERVICE |
| 164 | `Api/Controllers/AnalyticsApiController.php` | link stats + detail w/ daily breakdown | REBUILD_AS_SERVICE |
| 165 | `Api/Controllers/AdminApiController.php` (659) | 15 superadmin endpoints: dashboard stats, users (returns **`SELECT *` incl. password hash**), suspend/activate, payments/approve, tickets/reply, plans CRUD, broadcast, discounts | REBUILD_AS_SERVICE |

## 7. `app/Views` (12 PHP)

| # | Path | Purpose | Disposition |
|---|------|---------|-------------|
| 166 | `Views/home.php` (879) | RTL landing + login/register forms + plans + captcha + reset forms + SMS verify | CONCEPT_ONLY (new FE) |
| 167 | `Views/dashboard.php` (1700) | Tenant SPA-ish panel: channels, composer w/ jalalidatepicker, queue, gold, inbox, tickets, wallet/referral partials, notifications | CONCEPT_ONLY |
| 168 | `Views/admin.php` (1582) | Superadmin panel: users/payments/plans/tickets, SMS/email settings partials, discounts, ticket categories | CONCEPT_ONLY |
| 169 | `Views/errors.php` | Persian error page (JSON for AJAX) | CONCEPT_ONLY |
| 170 | `Views/help.php`, `Views/privacy.php` | Static help & privacy (privacy is consent target for registration) | ASSET (copy) |
| 171–175 | `Views/partials/{wallet-section,referral-section,admin-sms-settings,admin-email-settings,admin-referral-settings}.php` | Reusable sections rendered via include+exit | CONCEPT_ONLY |

---
### Hidden files on disk (not in 145 catalogue): `.htaccess` ×6 (root, app, config, migrations, public, storage) — deny-all protections; `.gitkeep` ×4. All CONCEPT_ONLY.

**Coverage statement:** 74/74 PHP files read; 4/4 SQL files parsed; sqlite DB, 6 .htaccess, manifest.json/php, service-worker.js, 7 first-party JS, error logs, agent-ctx notes inspected. Remaining binaries (fonts/icons/images/css/minified lib) dispositioned by type — no behavior inferred from filenames alone for code files.

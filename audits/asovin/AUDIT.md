# ASOVIN / پُست‌یار (WHCM SaaS) — Forensic Audit (Team A)

Codebase: `/home/z/my-project/reference/po.source/asovin/asovin/` — 74 PHP files + SQL migrations + SQLite production DB + PWA assets. A single-file-bootstrapped, session-based, multi-tenant SaaS for publishing/scheduling posts to Telegram & Bale bots, with gold-price auto-posting, keyword auto-responder, wallet/referral, manual (card-to-card) subscription billing, tickets, SMS.ir + SMTP notifications, Web Push, and a token-based mobile API.

Evidence style: `file:line`. Line numbers refer to files in the reference tree as read during this audit.

---

## 1. Module map & request flow

```
                      ┌── cron.php (CLI only) ──► GoldTicker::tickAll → Inbox::pollAllActive →
                      │                            ScheduledPost::processAll → SubscriptionManager::processExpiries
                      │                            → VerificationCode cleanup → Bootstrap::cleanupOldUploads(30)
Browser/Host ─ Apache ─┤
                      └── .htaccess → public/index.php
                                        ├─ Bootstrap::run()  (config → session → PDO → auto-migrations → security headers)
                                        ├─ URI starts /api/v1/ ? → MobileApiRouter (61 routes, Bearer token auth) → exit
                                        └─ else Router::dispatch() over ~87 statically-registered web routes
                                                 └─ MainController (god controller, 2796 lines) + 5 module controllers
```

- `public/index.php:21-50` — API fork; `:63-68` ModuleLoader (no-op: all `module.json` are 0 bytes so `ModuleLoader::load()` skips every module, `ModuleLoader.php:20`); `:72-186` route table; `:189` dispatch; `:191-196` catch-all 500.
- `Router` (`app/Core/Router.php`): exact-match then `{param}` numeric, then alphanumeric (`:49-70`); `?route=` override (`:44-46`) used because the app is often deployed without rewrite support (`getRouteUrl`, Bootstrap.php:996-1002 emits `/index.php?route=/...`).
- All state flows through static classes (`Bootstrap::getDB()`, `Auth::`, `Csrf::`); there is no DI, no ORM, no service container.

## 2. Auth / session / CSRF — exact mechanisms

**Session** (`app/Core/Session.php:13-41`): PHP native session; `cookie_httponly=1`, `use_only_cookies=1`, `secure` only when request is HTTPS, `SameSite=Lax`, lifetime 0 (browser session — despite `security.session_lifetime=86400` in config being **never referenced anywhere**). `regenerate()` on login (`Auth.php:132`).

**Login** (`MainController::handleLogin`, `:78-113` + `Auth::login`, `:108-147`): CSRF → math captcha (`$_SESSION['captcha_answer']`, index:52-55) → `RateLimit::check('login_web',5,60s)` → `password_verify` against bcrypt cost 12 (`Auth.php:36,130`). `status !== 'active'` blocks login (`Auth.php:122`). First registered user becomes `superadmin` (`Auth.php:41-47`) — no install token.

**CSRF** (`app/Core/Csrf.php`): one token per session (`random_bytes(32)`), `hash_equals` compare, embedded by `Csrf::field()` in forms and `window.__csrfToken` in JS (`dashboard.php:1604`, `admin.php:1465`). Validated in ~80 POST handlers. **Weaknesses**: token never rotates per request (session-long), no `Origin/Referer` check, and two authenticated AJAX endpoints skip CSRF entirely: `/api/process-post-queue` (MainController:1257) and `/api/heartbeat` (:1323) — only `checkAuth()`.

**Password reset — email** (`MainController:1367-1509`): token `bin2hex(random_bytes(32))` stored as `token|expiry` in `settings` row `password_reset_token` for that user; link via `?route=/reset-password&token=`. **Bug (confirmed)**: confirm handler reads `SELECT ... FROM settings WHERE key_name='password_reset_token' LIMIT 1` (`:1476`) — no user binding and only the first row platform-wide; multiple concurrent resets collide. The mobile API path does it correctly (`AuthApiController.php:341-427`, key `password_reset_token_{uid}`).

**Password reset — SMS** (`MainController:2497-2539`): 6-digit code via `VerificationCode` (type `sms_reset`, 5 min), user bound through `$_SESSION['sms_reset_user_id']` (no login required to hold this — session fixation into reset flow is possible but low risk).

**Web-session vs API-token**: mobile API is fully separate: `Authorization: Bearer <token>`, stored SHA-256 hash in `api_tokens` (30-day expiry, revoked_at, last-5 GC) (`MobileApiAuth.php:38-206`). Middleware injects `user_id` into `$_SESSION` (`injectSession`, `:400-403`) so API handlers can reuse web Domain classes — a smell, but scoped per-request.

## 3. Authorization & multi-tenancy reality

- **Tenant = user row**. `Auth::tenantId()` returns the logged-in user's own id (`Auth.php:218-221`). There are no organizations/teams/roles per tenant. Roles: `superadmin`, `support_agent`, `user` (agents supported in `Auth::isAdminOrSupport`, admin panel switches to tickets-only view, `MainController:636-641`).
- **Row-level isolation is enforced by hand** in every query: `channels.tenant_id`, `posts.tenant_id`, `inbox.tenant_id`, `auto_replies.tenant_id`, `link_tracking.tenant_id`, `responder_logs.tenant_id`, `settings.tenant_id` (0 = platform-global). Spot checks: `ChannelManager::getChannel` (`:197`), `Sender::sendPostToChannels` (`:208`), `PostApiController::show` (`:266`). Misses found: `AdminApiController::users()` returns `SELECT * FROM users` **including password hash** (`:101`); `LinkTracker::handleClick` has no tenant check (fine — public redirect); `SettingsApiController::getSettings` correctly tenant-scoped.
- **Anti-cheat channel registry**: `channel_registry UNIQUE(platform, channel_id)` globally locks a channel handle to its first owner forever, even after delete (`ChannelManager:73-99,204-225`). Consequence: legitimate re-use after account deletion is blocked (FK CASCADE removes the registry row on user delete — `install.sql:60-68` — so deletion *does* free it).
- Secrets in tenant-0 `settings`: sms_api_key, smtp_password, ai_global_key, admin card number — all stored **plaintext** in DB (verified in shipped sqlite).

## 4. API contracts — actual endpoints

### 4.1 Web (Router, `public/index.php`) — 22 GET + 65 POST = **87 endpoints**
Public: `GET /` (landing+captcha), `POST /login`, `POST /register` (privacy_consent=1 mandatory, `:125`), `GET /logout`, `GET/POST /reset-password`, `POST /reset-password/confirm`, `POST /reset-password-sms`, `GET /sms-verify`, `POST /verify-sms-code`, `GET /click?p&c` (click tracker), `GET /go/{code}` (link redirect), `GET /help`, `GET /privacy`, `POST /api/webhook` (bot webhook, secret-validated).
Tenant (auth): `GET /dashboard`; POST `add-post, cancel-post, add-channel, edit-channel, delete-channel, submit-payment, update-profile, change-password, save-gold-settings, save-advanced-settings, trigger-gold-publish, add-auto-reply, delete-auto-reply, toggle-responder, mark-announcement-read, mark-notification-read, mark-all-notifications-read, add-ticket, convert-points`; `GET /dashboard/referral, /dashboard/wallet, /dashboard/link-stats`; `POST /api/process-post-queue`, `POST /api/heartbeat`.
Superadmin (route prefix `/hnnh` — security-by-obscurity): `GET /hnnh` + tickets/plans/payments/users/suspend/activate/delete (+ GET variants of the same), `approve-payment`, `create-plan, edit-plan, delete-plan`, `add-user-manual`, `grant-subscription-manual`, `wipe-test-data`, `broadcast-announcement`, `save-bank-settings`, referral/wallet/SMS/email/gold/AI/responder/woo settings, discounts, ticket categories, `close-ticket/reopen-ticket/delete-ticket/create-ticket/reply-ticket`.
Push: `GET /api/push/vapid-key`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, `GET /api/push/status` — **broken in production** (call undefined `Auth::requireLogin()`, `MainController:2588,2619,2635`; shipped `storage/logs/last_error.txt` proves the 500).

### 4.2 Mobile (`/api/v1/`, `app/Api/Routes/api.php`) — **61 endpoints**
Auth (no token): `POST auth/login, auth/register, auth/reset-password, auth/reset-password/confirm, auth/reset-password-sms, auth/verify-sms-code`. Token: `POST auth/logout`, `GET auth/me`, `PUT auth/profile`, `POST auth/change-password`. Public `GET plans`. Tenant: `GET bootstrap, GET sync`, channels CRUD (5), posts (index/store/show/cancel/retry), notifications (3), payments (`POST payments`, `GET payments`, `POST coupons/validate`), tickets (4), settings (4), auto-responder (4), wallet/referral (3), analytics links (2). Superadmin: 15 (`admin/dashboard|users|users/{id}/suspend|activate|payments|payments/{id}/approve|tickets|tickets/{id}/reply|plans CRUD×4|broadcast|discounts×2`).
**Total HTTP surface: 148 endpoints.**

## 5. DB schema (as found)

Two driver mirrors (`migrations/install.sql` SQLite 445 ln / `install_mysql.sql` MySQL 365 ln) executed by Bootstrap on first run (`Bootstrap.php:233-266`), then versioned migrations `v2→v12` (`Bootstrap.php:271-924`) tracked in `schema_migrations`. **33 tables exist in the shipped SQLite** (verified: 31 from install.sql + `ticket_categories` + `schema_migrations`); `api_tokens` (mobile_api.sql) is **absent** because nothing at runtime loads that file — a fresh install breaks every `/api/v1/auth/login` call.

| Table | Key columns (SQLite) | Notes |
|---|---|---|
| `users` | id, name, email UNIQUE, password, role, status, business_name/type, phone, referral_code (partial unique idx), referred_by, referral_points DEC(15,2), wallet_balance DEC(15,2), birthday, created_at | install.sql:7-24 |
| `plans` | id, title, price DEC(12,2), duration_days, max_channels, max_posts (0=∞), features JSON, payment_url, image_url, description, early_renewal_discount, general_discount, discount_badge_text, is_featured | :27-43 |
| `subscriptions` | id, user_id FK→users CASCADE, plan_id FK, start_date, end_date, status, expiry_reminder_sent | :46-57 |
| `channel_registry` | id, channel_id, platform, owner_user_id, **UNIQUE(platform,channel_id)** | :60-68 |
| `channels` | id, tenant_id FK, name, platform('telegram'/'bale'), channel_id, **token TEXT (bot token plaintext)**, link_config JSON, button_config JSON, webhook_active, webhook_secret | :71-84 |
| `posts` | id, tenant_id, title, content, media_url, status('draft','queued','sending','scheduled','sent','failed'), scheduled_at, **target_channels JSON**, created_at | :87-98 |
| `channel_messages` | post_id, channel_id, message_id, status | :101-110 |
| `post_channel_stats` | post_id, channel_id, clicks, views | :113-121 |
| `clicks_log` | post_id, channel_id, ip, user_agent, clicked_at | :124-133 |
| `inbox` | tenant_id, channel_id, sender_id, sender_name, message_text, received_at | :136-146 |
| `auto_replies` | tenant_id, channel_id, keyword, reply_text, active | :149-158 |
| `discount_codes` | code UNIQUE, type percent/fixed, amount, max_uses, used, expires_at, active | :161-171 |
| `discount_offers` | user_id, plan_id, type, amount, expires_at, used | :174-185 |
| `payments` | user_id, plan_id, amount, discount_code_id, payment_method('card_to_card'), receipt_photo, reference_num, status('pending','approved'), admin_notes, verified_at | :188-204 |
| `push_subscriptions` | user_id, endpoint UNIQUE, keys_p256dh, keys_auth | :207-215 |
| `settings` | tenant_id (0=platform), key_name, key_value, UNIQUE(tenant_id,key_name) — universal KV incl. bot offsets, gold settings, SMTP creds, reset tokens | :218-224 |
| `rate_limits` | ip, action, attempts, last_attempt (unix int) | :227-233 |
| `tickets` | user_id, subject, category, message (thread concatenated inline), status('open','replied','closed'), attachment, assigned_to, priority, created_by_admin | :236-247 + v2 columns |
| `referrals` | referrer_id, referred_id UNIQUE, referral_code, reward_type, reward_value, status('pending','rewarded'), rewarded_at | :252-264 |
| `wallet_transactions` | user_id, type('credit','debit','cashback','points_convert','referral_purchase'), amount, **balance_after** (ledger), description, reference_type, reference_id | :267-278 |
| `referral_settings` | setting_key UNIQUE, setting_value (defaults seeded v3: register 100 pts, first purchase 10%, cap 500k) | :281-285, Bootstrap:412-431 |
| `sms_templates` | event_key UNIQUE, template_id (SMS.ir), parameters, is_active | :290-298 |
| `sms_log` | template_id, phone, user_id, status('success','failed','rate_limited'), response_code, error_message | :301-310 |
| `email_templates` / `email_log` | event_key UNIQUE + subject/body_html/variables; log rows w/ status | :315-337 |
| `link_tracking` / `link_clicks` | code UNIQUE, original_url, post_id, channel_id, tenant_id, total/unique_clicks; clicks w/ ip, is_unique | :342-366 |
| `verification_codes` | user_id, type, code, expires_at, used | :369-378 |
| `ticket_replies` | ticket_id, user_id, message — **used only by the mobile API** | :381-388 |
| `responder_logs` | tenant_id, channel_id, sender_id/name, message_text, matched_keyword, reply_sent | :391-401 |
| `notifications` | user_id, type, title, message, target_section, is_read | :404-414 |
| `ticket_categories` | slug, title, icon, assigned_agent_id, sort_order (v10, Bootstrap:858-884) | |
| `schema_migrations` | version PK, executed_at | Bootstrap:956 |
| `api_tokens` | user_id, token_hash, device_name, created/last_used/expires/revoked — **migration never wired** | mobile_api.sql:6-20 |

Indexes: 29 named in install.sql:416-445. Live data verified: 4 plans (free 0-ir/7d, 399k, 699k, 1.499M), 79 tenant-0 settings, 2 channels.

## 6. SQLite vs MySQL differences (real, coded)

Driver split everywhere via `Bootstrap::getConfig('database.driver')`:
- Time math: `datetime('now','-1 hour')` vs `DATE_SUB(NOW(),INTERVAL 1 HOUR)` (Sms.php:280-292, LinkTracker:91-95, SubscriptionManager:40-55,165-180, Referral:313-334).
- Upsert: `INSERT OR IGNORE` tried then `INSERT IGNORE` fallback (Bootstrap:421-431,496-506; setMigrationVersion:959-967).
- Sub day-extension: `datetime(end_date,'+X days')` vs `DATE_ADD(...INTERVAL ? DAY)` (Referral:313-334).
- Reminder query uses `julianday()` on SQLite vs `DATEDIFF` on MySQL (SubscriptionManager:90-113).
- Quota consumer checks: SQLite `INFORMATION_SCHEMA` probe replaced by `sqlite_master` (Bootstrap:237-245).
- **VARCHAR/DECIMAL are no-ops in SQLite** — money is float there; the shipped DB is SQLite (`config.php:24`), so production money math is IEEE-float, not DECIMAL.
- Production proof: `schema_migrations` contains exactly v_initial…v12 (2026-08-10/11 dates).

## 7. Channel management (behavioral spec)

`addChannel` (ChannelManager:24-140): validate platform ∈ {telegram, bale} → quota check → live `getMe` test (10 s timeout; on timeout/connect errors the channel is saved **unverified** with a "network filtered" warning — Iran-host workaround, `:58-70`) → registry lock check → transaction insert into `channel_registry` + `channels` with default 3 link buttons + 2 inline buttons (inactive) → attempt `setWebhook` (Bale gets no secret; Telegram gets random `webhook_secret` — column exists, but **the secret is never generated anywhere in code** (only read), so webhook secret validation is currently a no-op: `channels.webhook_secret` verified NULL in shipped DB; `setWebhook` sends `secret_token` only if non-empty `:242-244`).
Editing re-checks registry when channel_id/platform changes (MainController:493-506; ChannelApiController:147-161). Deleting keeps the registry lock (`deleteChannel:206-225`).

## 8. Publishing & scheduling

- **Instant (web)**: post inserted `draft` → content URLs rewritten to `/go/{code}` via `LinkTracker::processContent` **before** first channel known (uses first selected channel as owner, MainController:1183-1196) → status `queued` → browser JS (`dashboard.js:421`) drives `/api/process-post-queue`, one post per AJAX call: `queued→sending→sent/failed` (MainController:1257-1317). Quota is checked at creation (`:1127-1131`) but `consumePostQuota` only flips status; used-count derives from `posts.status='sent' AND created_at >= sub.start_date` (Quota:56-58).
- **Scheduled**: Jalali `YYYY/MM/DD hh:mm` from picker → `jalaliToGregorian` (BaseController:229-277) → `scheduled_at` Gregorian in Asia/Tehran. Processed by **two independent triggers**: user-dashboard heartbeat `/api/heartbeat` → `ScheduledPost::processAll()` (MainController:1323-1341) and cron `cron.php:56-63`. Both can race (no row locking / `SELECT … LIMIT 50` then send). Quota-exhausted scheduled posts remain scheduled (ScheduledPost:68-73).
- **Mobile instant** posts are sent synchronously in the request (PostApiController:229-244) — up to 30 s × N channels; timeout risk.
- **Failure semantics**: post marked `failed` if any channel fails (Sender:243-245); per-channel outcomes in `channel_messages`; retry only from mobile (`PostApiController::retry`) or heartbeat/cron reprocessing (status `scheduled` only; `failed` queued posts never retried on web).
- Media: URL passed through to `sendPhoto`/`sendVideo` (URL-based, no multipart upload to Telegram — media must be publicly reachable), extension decides endpoint (Sender:148-170).

## 9. Gold-rate functionality

- Source resolution: tenant `gold_api_url` → admin `gold_custom_api_url` → config default `https://api.tgju.org/v1/data/sana/home` (GoldTicker:19-35; production uses `Api.BrsApi.ir` per shipped settings).
- **Heuristic parser**: recursive walk; keys matched against keyword lists incl. Persian ('طلا','سکه','انس'); generic keys (`value`,`price`…) matched via sibling `name` field; Persian/Arabic digits normalized (GoldTicker:71-134, TextFormat::en_num).
- Message: tenant template with `{g18k}/{coin}/{oz}/{time}`; prices formatted with thousands separators + Persian digits; rial→toman ÷10 toggle; oz fixed to دلار (TextFormat::format_price:98-118).
- Automation: `tick(tenant)` runs only if plan feature `gold_ticker` AND `gold_schedule != 'manual'`; change-detection via `settings.last_gold_prices` (`g18|coin|oz` rounded) suppresses duplicates (GoldTicker:210-216); creates a real `posts` row (draft→sent/failed) so history/analytics stay coherent (`:241-253`); targets chosen channels or all.
- Manual trigger: web `handleTriggerGoldPublish` (:923-974) and mobile `settings/gold/trigger` — no feature-gating on manual trigger (web), unlike cron.

## 10. Wallet & referral — exact math/ledger

- Ledger: `users.wallet_balance` mutated inside transaction; every mutation writes `wallet_transactions` row with **`balance_after` snapshot** (Wallet.php:46-132). Types seen: `credit`, `debit`, `cashback`, `points_convert`, `referral_purchase`.
- `credit` requires amount > 0; `debit` fails on insufficient balance (`:101-108`). No negative balance possible via these paths; no idempotency key — double-invocation double-credits.
- Cashback: `round(purchaseAmount × percent / 100, 2)` (`:163-178`) — implemented but **no caller found** in web or API (dormant feature).
- Points conversion: web UI/handler hardcodes **rate 10** (1 pt = 10 toman) (`MainController:1871`); mobile reads `referral_settings['points_wallet_rate']` which is **never seeded, defaulting to 1.0** (WalletReferralApiController:63-80). Same user action yields 10× on web vs mobile — live inconsistency.
- Referral: code `POST-` + 6 chars from 32-char alphabet, uniqueness loop ≤50 (`Referral:21-43`); register reward = points→`users.referral_points` or days→extend latest active subscription end_date (`awardReward:301-337`); first-purchase reward = percent of approved payment or fixed → **wallet credit** to referrer and `referrals.status='rewarded'` (`:155-193`); caps: max_referrals_per_user (default 100), monthly_reward_cap setting exists (500k) but **no monthly enforcement found** (`processRegistration` only checks total count). Self-referral blocked (`:113-115`).

## 11. Subscription & billing concepts

- Billing is **manual card-to-card**: user picks plan → submits amount + reference number + receipt photo (`handlePaymentSubmit:574-624`) → admin approves (`PaymentController::approve`) → old actives expired, new subscription `now → +duration_days` (or 2099 if duration 0). Discounts on plans (`early_renewal_discount`, `general_discount`, badge) are display/marketing fields — **no code applies them to any amount**. `discount_codes` validated in mobile only (`BillingApiController::validateCoupon`); web payment form has no coupon field; `discount_offers` (per-user offers) shown in dashboard but never redeemable.
- Free plan auto-provisioned on first register (price 0, duration 0 ⇒ end 2099, 2 channels, 10 posts lifetime-ish) (`Auth:53-83`).
- Quota gating: channels = count rows; posts = sent count in current subscription period (Quota:51-69).
- Revenue reporting: sum of `payments.amount where status='approved'` (MainController:748).

## 12. Notifications

- In-app `notifications` (bell): created on subscription grant/approval, broadcast announcements; unread badge; mark-read endpoints (Notification.php).
- Global announcement: settings key `global_announcement` + row per user + `last_read_announcement_id` reset trick (BroadcastController:29-54).
- Web Push: VAPID config from config file; `push_subscriptions` (1 per user, replaced on re-subscribe); aes128gcm+ES256 implemented from scratch (`WebPush.php`); 404/410 cleans dead endpoints (MainController:2686-2688, 2738-2751). **Subscribe endpoints are dead in prod** (see §4.1); `sendPushBroadcast` still works when called server-side.
- Email: event templates (7 seeded: welcome, payment_confirm, subscription_expiry, subscription_expired, …) with `{{var}}` interpolation (Bootstrap:599-~890); logged to email_log.
- SMS: SMS.ir ultrafast templates keyed by event; per-phone 3/hour cap (Sms:30); bulk send to all active users (admin).

## 13. Support / inbox

- Tickets: single-table with concatenated message thread (web) — replies appended with Persian header lines (`TicketController:100,141`); attachments stored under `public/assets/tickets/` (images+pdf, no MIME check, `:16-39`); categories table with per-category agent assignment; assignment (`/hnnh/assign-ticket`) **unreachable** (route only in never-loaded module Routes). User reply/close web routes also unreachable (module not loaded) — **users can create tickets but cannot reply/close from web**; mobile API uses `ticket_replies` properly (SupportApiController:151-164) so the two surfaces disagree on data model.
- Channel inbox: bot updates (webhook or polling) stored per message; auto-responder: per-channel enable key `responder_enabled_{id}`; first matching keyword (mb_stripos) replies once; every message logged to `responder_logs` and `inbox` with appended "[پاسخ خودکار ارسال شد…]" (Inbox:58-116).

## 14. WooCommerce integration concepts (in this codebase)

Absent as functioning code. Remnants: plan feature flag `woocommerce` (PlanController:33-43), admin settings keys `woo_help_text`, `woo_max_stores`(1), `woo_require_ssl`(1) (shipped DB + `handleSaveWooSettingsAdmin`, MainController:1664), route stub `save-woo-settings-admin` (index.php:160), empty `Modules/WooCommerce/`. The real Woo integration lives in the separate `woo-hooman-channel-manager` WordPress plugin (audited by Team B); this SaaS talks to it only conceptually (bot token shared out-of-band).

## 15. Mobile API behavior

- Envelope: `{success, message, data}` (MobileApiResponse). Errors: 401 unauthorized, 403 forbidden, 404, 422 validation, 429 (message contains stray CJK "稍后", `:76`).
- Token: 64-hex, stored as SHA-256 (no salt — acceptable for high-entropy random tokens), 30-day sliding `last_used_at` (no actual sliding expiry), keep-last-5 tokens per user.
- Rate limits: login 10/5min; general 120/min (`rate_limit` middleware declared but **not attached to any route** — only login/SMS-reset enforce limits, `api.php` passes `['auth']` only).
- `bootstrap` returns the full dashboard (user, quota, channels, 50 posts, notifications, auto-replies, 15 inbox rows, 50 tickets, plans, offers, histories, settings, referral, wallet) — one-shot heavy endpoint (DashboardApiController:30-207). `sync(since)` is a light delta.
- Admin API duplicates web admin logic (approve payment etc.) with `superadmin` middleware; no CSRF (token-based, correct), but `users()` leaks password hashes (§3).

## 16. Persian UX & Jalali handling

- No Jalali library dependency: hand-rolled `jalaali`-algorithm converters — `TextFormat::g2j` (TextFormat:50-72), `BaseController::jalaliToGregorian` (:229-277, reverse algorithm), plus a **third private copy** in PostApiController:413-449 (drift risk). Persian/Arabic digit normalization `en_num` and display `fa_digits/fa_num` (:14-44). `now_jalali`, month names, `timeAgo` ("۲ دقیقه پیش"), `mysql_to_jalali` with explicit UTC-vs-Tehran branch because SQLite `CURRENT_TIMESTAMP` is UTC (TextFormat:129-159).
- Client side: vendored `jalalidatepicker.min.js` for schedule fields; server re-validates ranges (1300–1500 years) in mobile (PostApiController:184-193) but **web path does no range validation** (MainController:1140-1157 — accepts any `explode('/')` output, falls back to 1405/01/01 on empty).
- Timezone: `Asia/Tehran` set in Bootstrap; DB timestamps UTC (CURRENT_TIMESTAMP) — mixed semantics documented per-field (TextFormat docblock:120-128).

## 17. Deployment assumptions

- Shared cPanel/LiteSpeed PHP host: root `.htaccess` rewrites into `public/`, `?route=` fallback for hosts without path rewrite; `set_time_limit` used freely; cron documented as `* * * * * php /home/asovinir/public_html/cron.php` (cron.php:16-19, but file actually lives outside docroot — comment path is wrong).
- Iran-network realities: Telegram blocked on Iranian hosts → getMe failure tolerated as "register unverified" (ChannelManager:58-70); 409-conflict detection flips `webhook_active` back on (Inbox:168-171).
- `config.php` committed with real secrets (driver sqlite; prod MySQL creds, SMTP user/pass, SMS key). Storage dirs auto-created 0755 on boot (Bootstrap:166-182). PHPMailer expected under `vendor/` (autoloader Bootstrap:150-160) — vendor dir absent from repo (graceful mail() fallback).

## 18. Storage/upload behavior

- Single helper `uploadAndConvertToWebp` (BaseController:144-224): 5 MB cap, extension whitelist from config, **finfo real-MIME check against extension map**, first-1KB `<?php` scan, random 8-byte hex filename, GD convert to WebP q80, re-verify final MIME. Subfolders: `uploads/` (post/gold media), `receipts/`, `plans/`.
- Mobile `uploadImage` (MobileApiController:117-155) is weaker: trusts `$_FILES['type']` client MIME, no finfo, no PHP-tag scan, `uniqid` filename.
- Ticket attachments (TicketController:16-39, SupportApiController:19-50): extension-only check (pdf allowed), no MIME validation, saved as-is under `assets/tickets/` — **softest upload path**.
- Cleanup: cron deletes `public/assets/uploads/*` older than 30 days regardless of post references (Bootstrap:1088-1107) — media can vanish from published history. Receipts/plans/tickets are never cleaned.
- All uploads land inside the web-exposed `public/assets/...` tree (direct URL access by design).

## 19. Cron / background work (`cron.php`, CLI-gated :25-28)

Per minute: ① gold tick for every active subscriber (serial; one slow gold API delays all tenants — no per-tenant error isolation except try/catch around tickAll as a whole); ② polling for all channels with `webhook_active=0` where plan has `auto_responder` (getUpdates timeout=2 s each, serial); ③ scheduled posts ≤50; ④ subscription expiries + 3-day reminders (email+SMS); ⑤ verification-code cleanup; ⑥ 30-day upload cleanup. Heartbeat endpoint duplicates ③ in request context. No queue system, no locks (cron + heartbeat can double-send the same scheduled post), no per-task timing/health metrics beyond error_log lines.

## 20. Logging & error handling

- Global: `error_log()` lines prefixed `[Postyar …]`; production hides errors (Bootstrap:48-59); Router writes last exception to `storage/logs/last_error.txt` (single file, overwritten, Router:108-119) and shows an md5-derived "error id" to users (:126). AJAX detection yields JSON errors (Router:138-147). Mobile API catches handler throwables → generic 500 (`MobileApiRouter:297-307`).
- Observed prod artifacts: `public/error_log` full of repeated warnings (`admin-email-settings.php:149` undefined key "subject"); `last_error.txt` = the `Auth::requireLogin()` fatal. No structured logging, no rotation, no request IDs, no audit trail for admin money actions (approvals logged only as flash messages).

## 21. Top-15 security weaknesses (ranked)

1. **Live secrets committed** in repo: SMTP password, SMS.ir key, DeepSeek API key, admin card number inside `storage/db/whcm_saas.sqlite` settings + `config/config.php` (verified values; must rotate).
2. **Admin API password-hash leak**: `AdminApiController::users()` returns `SELECT * FROM users` including `password` (line 101) to any superadmin token — and tokens are long-lived.
3. **Broken push endpoints / phantom methods**: `Auth::requireLogin()`, `Auth::id()` don't exist → 500s; prod log proves it (last_error.txt). Also indicates no integration tests.
4. **Webhook secret never generated**: `channels.webhook_secret` is never written by code, so Telegram webhook secret validation (`handleApiWebhook:856-863`) is dead — anyone can POST forged updates to `/api/webhook?channel_id=N` and inject inbox rows / trigger auto-replies (no other auth on that endpoint).
5. **Plaintext bot tokens at rest** in `channels.token` (DB) and shown back to users in edit forms/dashboard JSON.
6. **Mobile `api_tokens` never installed on fresh DBs** (migration file not wired into Bootstrap) — mobile login fatals on clean installs; also token hash unsalted SHA-256, 30-day static expiry, no sliding revocation on password change (email path does revoke, SMS path does too, but web password change does not).
7. **CSRF gaps**: `/api/process-post-queue` + `/api/heartbeat` lack CSRF (session-cookie authenticated, SameSite=Lax mitigates but top-level POSTs still allowed); single non-rotating token; no Origin check.
8. **Ticket attachment upload path**: extension-only check incl. `pdf`, no MIME sniff, files served from public assets (TicketController:16-39).
9. **Email reset token collision bug** (`LIMIT 1` global lookup, MainController:1476) — cross-user reset collisions possible; reset tokens stored in plaintext in `settings`.
10. **`/hnnh` security-by-obscurity** + GET-based admin actions (`/hnnh/suspend-user` etc., index:167-171) — state-changing GETs are linkable/prefetchable (CSRF via GET; `checkSuperAdmin` only gates role).
11. **No rate limit on most API routes** (`rate_limit` middleware defined but unused; only login/SMS reset).
12. **Referral/wallet money flows lack idempotency & caps enforcement**: first-purchase reward fires per approved payment without dedupe key; monthly_reward_cap never enforced; double-approval prevented only by status check inside non-atomic read→act in web path (`PaymentController::approve` uses transaction — OK — but mobile duplicate has same design; risk is read-before-transaction window).
13. **Weak crypto-adjacent choices**: math captcha trivially scripted; password min length 6; no 2FA; session lifetime config ignored (browser-session).
14. **SQL adapter duality risk**: driver-branched SQL (e.g., Referral:313-334 interpolates `$days` into SQLite string) — the SQLite branch `'+' || ? || ' days'` inside prepare is fine, but the first `$stmt` assignment with `{$days}` interpolation (line 314) is overwritten — dead-but-dangerous pattern class.
15. **Information disclosure in errors**: dev mode dumps exception detail (Router:124); production error page leaks md5 of message; `admin.php`/`dashboard.php` embed CSRF token in JS globals; `UsersController::wipeTestData` hardcodes personal emails in source.

## 22. Top-10 architecture weaknesses

1. **God controller**: `MainController` (2,796 ln, 90+ actions) mixes auth, billing, bots, gold, SMS, email, push, tickets — single change surface, unmaintainable.
2. **Phony module system**: `module.json` all empty ⇒ ModuleLoader no-op; module routes (incl. user ticket reply/close) silently unreachable — code exists but is dead in prod.
3. **Runtime auto-migrations in request path**: Bootstrap runs DDL on first request; schema drift between code versions and DBs (proven: `api_tokens` missing in shipped DB).
4. **Tenant isolation by convention**: every query hand-writes `tenant_id = ?`; no repository layer/policy object → one omitted clause is a data leak (mobile `users()` already leaks hashes).
5. **Background work without a queue/locks**: dashboard heartbeat + cron race on the same scheduled posts; per-channel sends serial; no retry/backoff.
6. **Settings table as kitchen sink**: SMTP creds, reset tokens, bot offsets, gold cache in one KV (`settings`, tenant 0 vs tenant N) — no typing, no encryption, no cache invalidation.
7. **Dual data models for tickets** (thread-in-column vs `ticket_replies`) between web and mobile.
8. **Money math inconsistent**: rate 10 (web) vs 1 (mobile) for identical action; SQLite float money; discounts never applied.
9. **Triplicated Jalali converters** and driver-branched SQL duplicated in ≥8 classes — divergence bugs (one already: points rate).
10. **No tests, no CI, no dependency management** (vendor/ referenced but absent; no composer.json in tree) — regression class exemplified by the phantom `Auth::requireLogin()`.

## 23. The 20 REBUILD_AS_SERVICE behaviors (feeding the new Postyar spec)

1. **Tenant quota engine** — inputs: subscription(plan features/max_channels/max_posts, 0=∞) + period start; outputs can_add_channel/can_send_post/used counters; gates channel creation and post send; scheduled post with exhausted quota stays pending, not failed. (Quota.php)
2. **Channel registry anti-fraud lock** — globally unique (platform, channel_id) → owner; enforce on add/edit; delete of channel does not release; user deletion releases (FK cascade). (channel_registry)
3. **Bot credential onboarding** — live `getMe` verification with timeout→"saved unverified" tolerance for filtered networks; store token encrypted; per-platform base URLs (`api.telegram.org/bot`, `tapi.bale.ai/bot`). (ChannelManager:24-169)
4. **Webhook + polling dual ingest** — webhook receiver validates per-channel secret (generate one!); polling fallback with stored update offsets, 409→flag webhook active; both funnel into one message-processing pipeline. (Inbox.php)
5. **Keyword auto-responder** — per-channel enable flag, ordered first-match mb_stripos, live reply via sendMessage, full audit log (responder_logs) + inbox copy with reply annotation. (Inbox:58-133)
6. **Publishing pipeline with states** — draft→queued→sending→sent/failed (+scheduled); per-channel outcome rows (channel_messages); click stats seeded per (post,channel); URL rewriting to short links at creation time bound to first channel then backfilled post_id. (MainController:1175-1210, Sender, LinkTracker)
7. **Jalali scheduling contract** — accept `jYYYY/MM/DD HH:mm`, server converts to Gregorian (Asia/Tehran), range-validated; DB always Gregorian; UI always Jalali with Persian digits; single shared converter library (no third copy). (BaseController:229-277, PostApiController:153-203)
8. **Click tracking** — `/go/{code}` short links per URL per (post,channel,tenant); click rows with ip/UA/referer; unique-by-IP flag; aggregated counters + daily series; separate post-level `/click?p&c` counter endpoint redirecting to the channel's first link. (LinkTracker, MainController:800-831)
9. **Gold ticker** — configurable API URL hierarchy (tenant→platform admin→default), tolerant multi-key parser (EN+FA keywords, digit normalization), per-tenant message template ({g18k},{coin},{oz},{time}), rial/toman toggle, change-detection cache, feature-gated schedule (cron) + manual trigger creating a real post record. (GoldTicker, TextFormat::format_price)
10. **Wallet double-entry-lite ledger** — users.balance + append-only transactions with balance_after, types credit/debit/cashback/points_convert/referral_purchase; transactional; idempotency keys mandatory in rebuild. (Wallet.php)
11. **Referral program** — POST-XXXXXX codes, register reward (points or subscription days) with enable flag, self-ref and cap checks, first-purchase reward (% or fixed of approved payment) paid to wallet, single-use referred_id, monthly cap actually enforced. (Referral.php)
12. **Manual payment approval workflow** — receipt upload→pending→admin approve→(transactional) expire old subs + create new (duration 0 = no-expiry sentinel 2099) + in-app + push notification; reject path with notes (admin_notes column exists, unused in code). (PaymentController)
13. **Subscription expiry daemon** — expire past end_date; 3-day reminder once (flag column); email+SMS by event template; free-plan sentinel date handled. (SubscriptionManager)
14. **Event-templated notifications** — email_templates + sms_templates keyed by event (welcome, payment_confirm, subscription_expiry, subscription_expired, password_reset, bulk), `{{var}}` interpolation, per-send logs (email_log/sms_log), admin CRUD + test + bulk send. (EmailTemplate, Sms, admin settings)
15. **Web Push service** — VAPID ES256 + aes128gcm payload (RFC 8291/8292), one subscription per user (replace on re-subscribe), prune on 404/410, fan-out broadcast + targeted sends. (WebPush.php)
16. **Inbox (channel DMs) as product surface** — per-tenant inbox rows joined to channels, latest-15 window, sender metadata, responder annotation; rebuild as streamable list. (Inbox, dashboard query MainController:290-292)
17. **Ticketing** — proper replies table for BOTH surfaces, categories w/ agent routing + assignment, statuses open/replied/closed, user close-with-reply, admin create-on-behalf, attachments (validated: MIME-sniffed, size-capped, private storage). (TicketController + SupportApiController)
18. **Mobile API v1 contract** — Bearer tokens (hashed, expiring, revocable, revoked-on-password-change), `bootstrap` one-shot + `sync?since` delta, same 61-route surface (channels/posts/notifications/payments/tickets/settings/auto-responder/wallet/referral/analytics + 15 admin), uniform {success,message,data} envelope. (app/Api/*)
19. **PWA shell** — dynamic manifest (RTL fa-IR, maskable icons), service worker with versioned precache, push client flow (`/api/push/vapid-key|subscribe|unsubscribe|status` — fix the phantom-auth bug). (public/*)
20. **Rate limiting & login hardening** — per-IP+action counters (login 5/min web, 10/5min API, SMS 3/hour per phone + 3/5min per action), trusted-proxy XFF parsing, applied to ALL state-changing API routes; replace math captcha with real challenge or honeypot+throttle. (RateLimit, Sms::checkRateLimit)

---

### Absent-by-design (do not assume exist)
- No OAuth/payment gateway integration (no Zarinpal/IDPay — card-to-card only). No 2FA. No teams/roles per tenant. No media upload to Telegram (URL-only). No email verification. No watermarking (stub comment Sender:154). No AI captioning execution (keys stored, `ai_caption` flag, no calling code). No WooCommerce API code here. No `composer.json`/lock in tree. No tests. No audit log. No monthly reward-cap enforcement. No CSRF on queue/heartbeat. No webhook secret generation.

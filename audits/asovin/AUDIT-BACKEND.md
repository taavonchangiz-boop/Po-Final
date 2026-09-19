# AUDIT-BACKEND — asovin PHP SaaS (WHCM_SaaS / "Postyar" legacy)

- **Scope**: full file-by-file forensic audit of `/home/z/postyar-build/po.source/asovin/asovin` (READ-ONLY, repo frozen at 67a83e2e9034bcabbf87e17daa9336e1f3aac62f)
- **Auditor**: Task 02-a (Audit Team A — backend)
- **Coverage**: `index.php`, `cron.php`, `config/`, `app/Core/*` (11 files), `app/Domain/*` (13 files), `app/Api/*` (4 infra + 11 controllers + routes), `app/Modules/*` (loader + 3 module controllers), `app/Controllers/*` (2), `migrations/*.sql` (4), plus committed SQLite DB inspection.
- **Line counts**: ~15,200 lines of PHP/SQL audited. Two giants: `app/Controllers/MainController.php` (2,796 lines) and `app/Core/Bootstrap.php` (1,108 lines) — both read fully in chunks.
- **Rubika**: absent everywhere (`rg -i rubika` → 0 hits). Channels are **Telegram + Bale only**.

---

## 1) Executive summary

The asovin backend is a **single-tenant-deployed multi-tenant SaaS** ("tenant = user row"): one shared DB, every tenant-owned row keyed by `tenant_id = users.id`. It is a hand-rolled PHP 7+/8 MVC without framework: custom PSR-4-ish autoloader, custom Router, PDO singleton (SQLite primary, MySQL secondary), session-based auth for web, SHA-256-hashed Bearer tokens for a mobile API mounted at `/api/v1/`.

**Overall verdict**: functional but fragile. Business logic is real and mostly sane (plans/quotas/wallet/referral/gold ticker/scheduler all exist and are wired to cron + dashboard AJAX). However:

1. **The committed production SQLite DB leaks live secrets**: SMTP password, DeepSeek API key, bank card number + holder, real user PII, bot tokens, payment records (`storage/db/whcm_saas.sqlite`).
2. **Mobile API is broken on fresh installs**: `api_tokens` migration (`migrations/mobile_api.sql`) is never executed by `Bootstrap::runVersionedMigrations()` (only v2–v12 are wired; Bootstrap.php:272-916) and the committed DB has **no `api_tokens` table** → `/api/v1/auth/login` dies with a PDO error.
3. **Webhook endpoint is spoofable** for Bale channels and any channel without a stored secret (`MainController::handleApiWebhook`, lines 836–868).
4. **First registrant becomes superadmin** with no bootstrap protection (Auth.php:40–47) — combined with admin "wipe test data" (UserController.php:141–152) this is a takeover vector on a reset DB.
5. **Referral first-purchase reward is dead code** (`Referral::processFirstPurchase` has zero callers) and discount codes never increment `used` (unlimited reuse).
6. **No locking anywhere**: cron (`cron.php`) + dashboard heartbeat + AJAX queue can all drive the same send pipeline concurrently → duplicate channel posts.
7. **MySQL support is illusory** in several paths: SQLite-only `ON CONFLICT` upserts in 5 admin handlers; `Auth::register` free-plan creation works on both, but admin settings break on MySQL.
8. Several **push-notification endpoints are fatal dead code** (`Auth::requireLogin()` / `Auth::id()` do not exist).

**Recommended disposition for Postyar**: **reimplement** the domain layer (Sender/Quota/GoldTicker/Wallet/Referral/SubscriptionManager semantics are worth porting as a spec), **drop** the web MVC (Router/MainController/Views — rebuild API-first), **adapt** the DB schema (good bones; fix the SQLite/MySQL drift, add real constraints/indexes, move secrets out of DB), and **never** ship the committed DB.

---

## 2) Architecture map

```
                        ┌── index.php (root) ──► public/index.php (front controller)
HTTP request ───────────┤
                        └── public/index.php:
                            ├─ Bootstrap::run()  (error cfg, autoload, config, tz, Session, dirs, PDO + migrations, security headers)
                            ├─ if path starts /api/v1/  → MobileApiResponse/Auth/Router + Controllers + Routes/api.php → exit
                            ├─ ModuleLoader::load()  (globs Modules/*/module.json → include Routes.php; 8 of 9 module.json are 0 bytes)
                            └─ Router::get/post(...) ~94 web routes → MainController@method (extends BaseController)
                               ├─ Auth (session) + Csrf (session token) + RateLimit (DB table, per IP+action)
                               └─ render() → app/Views/*.php (extract-based templates)

CLI ──► cron.php (php_sapi_name()!=='cli' guard) ──► Bootstrap::run()
   ├─ GoldTicker::tickAll()                  (gold price → channels)
   ├─ Inbox::pollAllActive()                 (getUpdates polling for webhook-less channels + auto-responder)
   ├─ ScheduledPost::processAll()            (status='scheduled' AND scheduled_at<=now, LIMIT 50)
   ├─ SubscriptionManager::processExpiries() (expire + T-3d reminder via EmailTemplate + Sms)
   ├─ SubscriptionManager::cleanupVerificationCodes()
   └─ Bootstrap::cleanupOldUploads(30)       (unlink public/assets/uploads/* older than 30d)

Telegram / Bale Bot API ◄── Sender (sendMessage/sendPhoto/sendVideo/editMessageCaption, inline keyboards)
SMS.ir ultrafast API  ◄── Sms (template-based, X-API-KEY)
SMTP/PHP mail()       ◄── Mail / EmailTemplate (7 seeded HTML templates)
tgju.org / custom API ◄── GoldTicker (recursive keyword price parser)
Web Push (VAPID, RFC 8291/8292, hand-rolled crypto) ◄── WebPush  [senders are dead code, see §6]
```

- **Tenancy**: `tenant_id` column on channels/posts/inbox/auto_replies/settings/posts/link_tracking/responder_logs. `Auth::tenantId()` = current user id (Auth.php:218-221). Admin cross-tenant access via dedicated admin controllers.
- **Settings**: single global KV table `settings(tenant_id, key_name, key_value)` shared by tenants (tenant_id>0) and platform config (tenant_id=0). Also abused as storage for password-reset tokens and polling offsets.
- **Two auth stacks**: web sessions (`Auth`+`Session`+`Csrf`) and mobile bearer tokens (`MobileApiAuth`, 30-day tokens, SHA-256 at rest, max 5 per user). **No CSRF on mobile API (by design, header-token auth).**
- **Roles**: `users.role` ∈ {`superadmin`, `support_agent`, `user`}. Support agents get ticket-only access in admin panel (MainController::admin, lines 635–641); API `admin` middleware treats support_agent as admin (MobileApiRouter.php:155-176).

---

## 3) File-by-file findings

Legend — Disposition: **R**=reimplement, **A**=adapt, **D**=drop.

### Entry points & config

| File | LOC | Purpose / key functions | DB tables | External APIs | Security notes | Side effects / errors | Disp. |
|---|---|---|---|---|---|---|---|
| `index.php` | 8 | Root shim for cPanel subfolder hosting; `require public/index.php` | — | — | none | — | D |
| `public/index.php` | 196 | Front controller. Loads Bootstrap; branches `/api/v1/*` to mobile stack; registers ~94 web routes; `Router::dispatch()`; catch-all 500 page | — | — | Security headers via Bootstrap; no rate limit at edge | Fatal → generic Persian 500, logged to error_log | A (route map is the product spec) |
| `cron.php` | 93 | CLI-only cron: gold tick, inbox poll, scheduled posts, subscription expiries, code cleanup, disk cleanup | all domain tables | TG/Bale, SMS.ir, SMTP, gold API | `php_sapi_name()!=='cli'` guard (line 25). **No lock/mutex** — overlapping runs double-send | Each job wrapped in try/catch → error_log | A (add locking + queue) |
| `config/config.php` | 77 | Live config: sqlite driver, prod URL asovin.ir, Tehran tz, mail/sms keys (masked in repo copy), gold default API | — | — | Secrets masked with `*` in this copy; real ones live in the DB (see §6-1) | — | A |
| `config/config.example.php` | 93 | Template incl. `vapid` block (enabled/subject/public_key/private_key_pem) and `security.salt` | — | — | salt/session_lifetime defined but **never used by code** | — | A |

### app/Core (11 files)

| File | LOC | Purpose / key functions | DB | Ext | Security | Errors | Disp. |
|---|---|---|---|---|---|---|---|
| `Bootstrap.php` | 1108 | `run()` boot sequence; `getConfig()` dot-path + auto-URL; `getDB()` PDO singleton (SQLite w/ `PRAGMA foreign_keys=ON`, MySQL); `checkAndRunMigrations()` runs install SQL when `users` absent; `runVersionedMigrations()` v2→v12 inline closures (plan/user/ticket columns, referrals+wallet, SMS, email templates w/ 7 full HTML defaults, link tracking, birthday, target_channels, plans fallback, ticket categories, responder_logs, notifications); `splitSqlQueries()` comment/string-aware splitter; `cleanupOldUploads(days)`; `getAssetsUrl/getRouteUrl/getPlanImageUrl` | creates ~20 tables + seeds | — | Migration seeds are idempotent (`INSERT OR IGNORE`) | All DDL wrapped in `try{}catch{}` → **silent schema drift possible**; env-aware error display | A (port migration list; externalize SQL) |
| `Auth.php` | 222 | `register()` (bcrypt cost 12; **first user ⇒ superadmin**; auto-creates free plan 2ch/10posts/duration0 + subscription end 2099-12-30); `login()` (status check, `Session::regenerate()`); `logout()`, `user()` (cached, auto-logout suspended), `check/isSuperAdmin/isSupportAgent/isAdminOrSupport`, `tenantId()` | users, plans, subscriptions | — | bcrypt cost 12 good; enumeration safe (same msg) | returns ['success','message'] arrays | A (fix first-admin + add role bootstrap) |
| `Session.php` | 96 | Secure cookie params (httponly, use_only_cookies, secure on HTTPS, SameSite=Lax since 7.3), `set/get/remove/destroy/regenerate` | — | — | lifetime 0 (browser session); no idle/absolute timeout; `session_lifetime` config unused | — | R (server-side session store) |
| `Csrf.php` | 44 | Per-session token (`random_bytes(32)`), `hash_equals` compare, `field()` hidden input | — | — | Token **never rotated** per request; no expiry — acceptable but weak; GET actions bypass it entirely | — | A |
| `RateLimit.php` | 99 | DB-backed counters per (ip, action): `check/hit/clear`; `getIp()` honors trusted_proxies + XFF validation | rate_limits | — | Cleanup DELETE executed on every check; no unique index on (ip,action) (install.sql has only a non-unique index) → insert race can create dup rows | — | A |
| `Router.php` | 153 | Static route registry; dispatch with subfolder support + `?route=` override; numeric then alnum `{param}` matching; `execute()` Controller@method; errors → `storage/logs/last_error.txt` + id-hashed 500 page | — | — | `?route=` override can bypass pretty URLs (no security impact, but two URL forms for every page) | logs full trace to file | D (rebuild) |
| `HttpClient.php` | 170 | cURL with stream-context fallback; JSON/form auto-encoding; SSL verify peer+host (MITM-safe); returns {success, code, body, error} | — | all | Good: `CURLOPT_SSL_VERIFYPEER=true` | 15–30s timeouts, no retries | A |
| `Sms.php` | 374 | SMS.ir ultrafast send (single/bulk), phone normalization (09xxxxxxxxx), **per-phone rate limit 3/hour** from sms_log, DB-first config (`settings` tenant 0) w/ config fallback, full sms_log writes, `testConnection()` | sms_log, sms_templates, settings | SMS.ir | API key from DB settings — plaintext; bulk logs one row per phone | never throws | A |
| `Mail.php` | 106 | SMTP via PHPMailer (autoloaded from vendor/, **which is absent from repo**) else native `mail()`; UTF-8 base64 subject; `buildPasswordResetTemplate()` | — | SMTP | Header injection possible via unsanitized `$from_name` into headers (minor) | logs SMTP errors | A |
| `EmailTemplate.php` | 330 | Event-keyed templates from `email_templates` (+ `{{var}}` str_replace render); SMTP config from settings tenant 0 w/ config fallback; `sendByEvent/sendBulk`; email_log writes; admin stats | email_templates, email_log, settings, users | SMTP | Template HTML rendered as-is (admin-authored) | silent log failures | A |
| `WebPush.php` | 211 | Hand-rolled VAPID ES256 JWT + aes128gcm payload encryption (RFC 8291/8292) using openssl; `send/sendBatch`; prunes 404/410 endpoints (pruning lives in MainController) | — | Push services | Crypto implemented from scratch — risky; **all callers are dead** (undefined `Auth::requireLogin`, §6-7) | throws on key errors | D (use a lib if push needed) |

### app/Domain (13 files)

| File | LOC | Purpose / key functions | DB | Ext | Notes | Disp. |
|---|---|---|---|---|---|---|
| `Sender.php` | 279 | **Channel delivery engine.** `apiBase()`: `https://api.telegram.org/bot` / `https://tapi.bale.ai/bot`. `formatCaption()` (plain default / HTML mode, tenant `caption_format` setting, injects click-tracker as 3rd link `/click?p={post}&c={ch}`); `getInlineKeyboards()` (2 rows: link row + button row from `button_config` JSON); `sendPostToChannel()` (sendVideo/sendPhoto/sendMessage by extension mp4|mov|webm; 30s timeout; **no retries, no 429 handling, no parse_mode on sendMessage**); `sendPostToChannels()` (per-channel ownership-scoped fetch, writes `channel_messages` + seeds `post_channel_stats`); `liveUpdateCaption()` | channels, settings, channel_messages, post_channel_stats | TG/Bale | Token+chat from channel row; token plaintext | A |
| `ChannelManager.php` | 299 | `addChannel()`: platform whitelist **telegram|bale** (line 38); quota check via `Quota::getTenantQuota`; live `getMe` token test with **Iran-host network-block fallback** (timeout/resolve/connect ⇒ register anyway w/ warning); **anti-cheat `channel_registry` global lock** — a (platform,channel_id) pair registers once forever to first owner (lines 73–91); transactional insert + webhook attempt; `getTenantChannels/getChannel` (tenant-scoped); `deleteChannel` (removes from tenant, **registry lock persists**); `setWebhook/deleteWebhook/tryActivateWebhook` (secret_token only for telegram and only if `webhook_secret` non-empty) | channels, channel_registry, settings | TG/Bale getMe, setWebhook | ownership always `tenant_id`-scoped — good | A |
| `GoldTicker.php` | 285 | `fetchValues()` (admin `gold_custom_api_url` → tenant `gold_api_url` → config default `https://api.tgju.org/v1/data/sana/home`; recursive keyword parser `findValue()` over g18/coin/ounce keys incl. Persian names; Persian digit normalization); `buildMessage()` (tenant template `{g18k}{coin}{oz}{time}`, rial→toman ÷10, jalali time); `tick(tenant)`: requires active sub + feature `gold_ticker`, **skips if `gold_schedule`==='manual'**, dedups via `last_gold_prices` snapshot ("g18|coin|oz"), target channels from `gold_auto_channels` or all tenant channels, creates posts row (draft→sent/failed), sends; `tickAll()` iterates active subscribers | settings, posts, subscriptions, channels | gold API, TG/Bale | **schedule values other than 'manual' are never time-checked** — admin `gold_interval` (e.g. 180) stored but unused; every cron minute where price changed ⇒ post. Message dedup is the only throttle | A |
| `Wallet.php` | 279 | `getBalance` (users.wallet_balance); `credit()` (transaction: UPDATE balance, re-read, insert ledger w/ balance_after); `debit()` (check-then-subtract, **no SELECT FOR UPDATE / no atomic conditional UPDATE → race**); `getTransactions`; `cashbackOnPurchase(percent)` — **no callers (dead)**; `convertPointsToWallet()` (points→wallet at rate; ledger type 'points_convert'); `getAdminWalletStats()` | users, wallet_transactions | — | Idempotency: none (no unique key on reference_type+reference_id); balance_after computed in PHP (Wallet.php:115) can desync under concurrency; `debit()` **unused** | A (ledger redesign) |
| `Referral.php` | 338 | `generateCode()` POST-XXXXXX (32-char alphabet, random_int, 50 attempts); `getReferralLink()` `/?ref=CODE`; `processRegistration()` (settings gate `enabled`, self-ref block, max_referrals cap, users.referred_by, referrals row 'pending', immediate register award); `processFirstPurchase()` — **zero callers ⇒ first-purchase reward never executes**; stats/history; `getAdminSettings/saveAdminSettings` (referral_settings KV); `awardReward()` points→users.referral_points, days→extend active subscription end_date | users, referrals, referral_settings, subscriptions, wallet_transactions | — | monthly_reward_cap setting stored but **never enforced**; register award not idempotent (protected only by referrals.referred_id UNIQUE) | A |
| `SubscriptionManager.php` | 221 | `processExpiries()`: mark expired (status 'expired') + email `subscription_expired` + SMS; **T-3d reminder** (`REMINDER_DAYS_BEFORE=3`) guarded by `expiry_reminder_sent` flag (one-shot); `cleanupVerificationCodes()` (used or expired); `sendSmsByEvent()` maps event_key→sms_templates.template_id→Sms.send | subscriptions, plans, sms_templates, users, verification_codes | SMS.ir, SMTP | Reminder SQLite query binds (now, threshold, now) — correct; per-sub loop no batching | A |
| `Quota.php` | 103 | `getTenantQuota()`: latest active sub join plan; used_channels = COUNT(channels); used_posts = COUNT(posts WHERE status='sent' AND created_at >= sub.start_date); `can_add_channel`, `can_send_post` (max_posts 0 = unlimited); features JSON; `consumePostQuota()` (sets post sent) — used only implicitly | subscriptions, plans, channels, posts | — | Quota is count-at-request-time; no reservation → burst can overshoot | A |
| `ScheduledPost.php` | 106 | `processAll()`: SELECT status='scheduled' AND scheduled_at<=now LIMIT 50; target_channels JSON else all tenant channels; quota gate (else stays scheduled); send; set sent/failed. **No row lock / no atomic claim** (two workers ⇒ double send); 'sending' status only used by web queue path | posts, channels | TG/Bale | Same cron call also reachable via authenticated web heartbeat (§6-9) | A (claim-based queue) |
| `Inbox.php` | 217 | `handleWebhook()` (raw php://input JSON); `handleUpdateArray()` (message/edited_message/channel_post/edited_channel_post; sender_id from from.id/sender_chat.id/chat.id; sender_name htmlspecialchars'd); `receiveMessage()`: per-channel `responder_enabled_{ch}` gate, case-insensitive keyword match (mb_stripos), live reply via bot sendMessage, responder_logs row, inbox row (auto-reply appended to text); `pollChannelUpdates()` (getUpdates offset stored in settings `upd_offset_{ch}`, 409⇒webhook_active=1 resync); `pollAllActive()` for webhook_active=0 channels gated by plan feature `auto_responder` | inbox, auto_replies, settings, responder_logs, channels | TG/Bale | Polling from cron **and** from any tenant plan feature; message_text stored raw (XSS risk downstream); no dedup of same update (offset race) | A |
| `Notification.php` | 91 | create (per user), **broadcast** (INSERT..SELECT for role != superadmin), list/unread count/recent unread, mark read (ownership-checked), markAllRead, cleanupOld (SQLite-only datetime('now') — MySQL incompatible; no callers) | notifications | — | — | A |
| `VerificationCode.php` | 51 | `generate(userId,type,expiry 5min)` 6-digit random_int; deletes previous unused of same type; `verify()` hash_equals + expiry + mark used; `cleanup()` (>24h) | verification_codes | — | No attempt counter on verify → brute-forceable in 5-min window without rate limit (mitigated only on API by none; web by session binding) | A (add attempts+TTL) |
| `LinkTracker.php` | 110 | `processContent()`: regex-replaces every http(s) URL in post content with `/go/{code}` (8-hex unique code) stored in link_tracking(post 0 initially); `handleClick()` logs link_clicks (ip/ua/referer, is_unique by first ip), increments counters; `getPostLinks`, `getUserLinkStats`, `getDailyClicks` (driver-aware) | link_tracking, link_clicks | — | Unauthenticated redirect to `original_url` (open-redirect-ish but URL authored by tenant); per-link growth unbounded | A |
| `TextFormat.php` | 191 | Persian digits ⇄ latin, thousand separators, **jalaali algorithm g2j** + now_jalali + mysql_to_jalali (UTC→Tehran for CURRENT_TIMESTAMP cols), timeAgo, `format_price` (rial/toman, oz in dollars), jalali month names | — | — | Utility only | A |

### app/Api (mobile API stack)

| File | LOC | Purpose | Security | Notes | Disp. |
|---|---|---|---|---|---|
| `MobileApiAuth.php` | 413 | Bearer token auth: `Authorization: Bearer`; 32-byte hex token; **SHA-256 hash stored**; 30-day expiry; rate limit api_login 10/300s; keep-last-5-tokens cleanup; `validate()` joins users + revoked/expiry checks + last_used_at touch; `revokeCurrent/revokeAll`; `sanitizeUser()` (no password leak); `injectSession()` bridges token→$_SESSION so domain layer (Auth::tenantId) works | Good: hashed-at-rest, revocation, scoped rate limit. Bad: no token rotation on use, no per-device limit beyond 5, no IP binding | `api_tokens` table **missing from Bootstrap migrations & committed DB** ⇒ broken on fresh installs | A |
| `MobileApiRouter.php` | 357 | Route registry w/ `{param}` named captures; middleware: `auth` / `admin` (superadmin OR support_agent) / `superadmin` / `rate_limit` (api_general 120/min); JSON input helper; handler resolution `Class@method` → `\WHCM\Api\Controllers\Class` | auth middleware injects user into session for the request | — | A |
| `MobileApiResponse.php` | 86 | Uniform JSON envelope {success, message, data?, errors?}; helpers 200/400/401/403/404/422/429/500. Contains one mojibake string (`稍后`) in 429 message | — | — | A |
| `MobileApiController.php` | 156 | Base: input/get/db/user/userId/requireAdmin/requireSuperAdmin; `validate()` mini rules (required/email/min/max); `uploadImage()` **converts to webp via imagecreatefromstring but skips MIME sniff + PHP-tag scan that BaseController has** (weaker upload path) | weaker upload validation than web | — | A |
| `Routes/api.php` | 126 | **61 endpoints** (see §5) | middleware per route | — | A |

**API controllers** (all extend MobileApiController):

| File | LOC | Endpoints | Key logic / findings |
|---|---|---|---|
| `AuthApiController.php` | 576 | login, register, logout, me, updateProfile, changePassword, requestResetEmail, confirmResetEmail, requestResetSms, verifySmsCode | Register reuses `Auth::register` (first-user-superadmin risk), referral attach, welcome email, auto-login. Email reset token (64 hex) stored **plaintext in `settings`** under `password_reset_token_{uid}`; confirm scans `LIKE 'password_reset_token_%'` rows and hash_equals; revokes all API tokens after reset. **`verifySmsCode` finds user by code alone (lines 543–551) — no rate limit on verification attempts** → 6-digit brute force in 5-min TTL. |
| `PostApiController.php` | 450 | index (click_count join), store (instant→send now / scheduled with **jalali→gregorian converter duplicate #2**), show, cancel (DELETE row), retry | Ownership always tenant-scoped; quota gate at creation & retry; caption_format prefix; media via weaker uploadImage('posts') |
| `ChannelApiController.php` | 209 | index, store, show, update, delete | update re-checks registry lock; link/button JSON build duplicates web handler (dup logic) |
| `BillingApiController.php` | 357 | getPlans (public), submitPayment (card-to-card + receipt upload), getPayments, validateCoupon | **Coupon `used` never incremented anywhere** ⇒ unlimited reuse; amount is client-declared |
| `DashboardApiController.php` | 259 | bootstrap (entire dashboard payload in one call: user, quota, channels, posts+clicks, notifications, auto-replies, inbox 15, tickets, plans, offers, subscription/payment history, settings, categories, announcement, referral, wallet), sync (delta by `since`) | Efficient aggregate; no pagination escape; good endpoint to keep for mobile |
| `SettingsApiController.php` | 337 | getSettings, saveGoldSettings, triggerGoldPublish, saveAdvancedSettings (incl. **ai_api_key stored in settings**), getAutoReplies, addAutoReply, deleteAutoReply, toggleResponder | Upsert loops per key; ownership checks on channels before replies |
| `WalletReferralApiController.php` | 132 | getWallet, convertPoints (**rate from `points_wallet_rate`, default 1.0**), getReferral | Rate mismatch with web (10) — §6-11 |
| `NotificationApiController.php` | 81 | index, {id}/read, read-all | — |
| `SupportApiController.php` | 238 | index, store, show, {id}/reply | Attachment upload allows **PDF** (ext-only check, no MIME sniff, saved as-is under public/assets/tickets) |
| `AnalyticsApiController.php` | 90 | links, links/{id} (per-link daily breakdown) | N+1 click counting; tenant-scoped |
| `AdminApiController.php` | 659 | 15 superadmin endpoints (dashboard stats, users list/suspend/activate, payments list/approve, tickets list/reply, plans CRUD, broadcast, discounts add/delete) | approvePayment = transaction (expire old subs, insert new), push+notification; users() N+1 per-user counts |

### app/Modules

| File | LOC | Findings | Disp. |
|---|---|---|---|
| `ModuleLoader.php` | 41 | Globs `Modules/*/module.json`, requires `Routes.php` of "enabled" ones. All 9 module.json are **0 bytes** (confirmed) ⇒ `json_decode('')` null ⇒ nothing loads. All `Routes.php` are 0 bytes **except Support** (846 B, registers 10 ticket/broadcast routes). Net effect: skeleton only. | D |
| `Modules/Support/Routes.php` | 14 lines | Registers ticket routes; **6 of 10 are later overwritten** by identical paths in public/index.php (ModuleLoader runs first, main registration second). Only `/dashboard/reply-ticket`, `/dashboard/close-ticket`, `/hnnh/assign-ticket` survive. | D |
| `Modules/Billing/Controllers/PaymentController.php` | 71 | `approve()` = CSRF + superadmin + transaction (expire all user's active subs incl. non-expired [no status filter], insert new sub), push + notification. Duplicates `MainController::handleApprovePaymentGet` logic (dup #1). | A (merge) |
| `Modules/Billing/Controllers/PlanController.php` | 108 | create/edit/delete plans incl. features JSON {gold_ticker, auto_responder, woocommerce, ai_caption, stats:true}, discounts columns, image upload. Edit = duplicate of create (dup). | A |
| `Modules/Support/Controllers/TicketController.php` | 305 | create/userReply/reply/closeAdmin/adminCreate/reopenAdmin/deleteAdmin/closeUser. Tickets store replies **appended into tickets.message** (mangling) while `ticket_replies` table exists and is used by mobile API — two divergent reply models. Attachments: ext whitelist incl. PDF, saved as-is (no MIME sniff) into public/assets/tickets. userReply checks ownership; admin replies don't need it. | A |
| `Modules/Support/Controllers/BroadcastController.php` | 70 | announce(): settings.global_announcement JSON + `DELETE FROM settings WHERE key_name='last_read_announcement_id'` (global, re-arms bell for everyone) + Notification::broadcast + push broadcast. | A |
| `Modules/Users/Controllers/UserController.php` | 153 | addManual (role whitelist user|support_agent), grantSubscription, suspend/activate/delete (POST+CSRF), **wipeTestData: hard-coded emails/names `stranger@belitia.ir`, `hooman@belitia.ir`, `'هومن راد'`** (line 149) — test artifact in production code. | D (drop wipe) |

### app/Controllers

| File | LOC | Functional regions (documented) | Key findings |
|---|---|---|---|
| `BaseController.php` | 336 | auth gates (`checkAuth`, `checkSuperAdmin` + optional **admin IP whitelist**, `checkAdminOrSupport`), redirect/flash, `isAjax`, `render()` (extract+include), `uploadAndConvertToWebp()` (**strong upload path**: ext whitelist → finfo MIME sniff → PHP-tag scan → random name → GD re-encode to webp q80 → re-verify MIME), static `jalaliToGregorian` (dup #2 of PostApiController's), `saveSetting/saveSettingsBatch` | render/extract pattern; whitelist empty by default |
| `MainController.php` | 2796 | Regions: (1) landing + math captcha (lines 37–73); (2) login/register/logout w/ CSRF + captcha + rate limit (78–199); (3) dashboard aggregate (204–360); (4) profile/password (365–440); (5) channel add/edit/delete w/ registry anti-cheat (445–569); (6) payment submit + webp receipt (574–624); (7) admin panel aggregate w/ pagination (629–793); (8) click tracker `/click` (800–831); (9) **bot webhook receiver** w/ telegram-only secret check (836–868); (10) gold settings + manual publish (873–974); (11) auto-replies + responder toggle + announcement/notification read (979–1112); (12) post create (jalali schedule, link-tracking rewrite, queued status) / cancel / **AJAX queue worker** (1117–1317); (13) heartbeat → `ScheduledPost::processAll` (1323–1341); (14) module delegations (1343–1364); (15) email + SMS password reset web flows (1367–1508, 2497–2539); (16) **GET admin quick actions** (1517–1590); (17) admin global settings: gold/AI/responder/woo/discounts (1593–1676, SQLite-only `ON CONFLICT`); (18) tickets admin inline (1677–1725); (19) bank card settings (1730–1763); (20) tenant advanced settings incl. AI keys (1770–1814); (21) referral/wallet sections + convert (rate **10**) (1823–1936); (22) SMS admin (config/templates/test/bulk) (1945–2201); (23) email admin (2238–2476); (24) link redirect + stats (2478–2495); (25) help/privacy (2544–2562); (26) **push endpoints using non-existent `Auth::requireLogin()/Auth::id()`** + static push senders (2569–2754); (27) ticket categories editor (2759–2795) | see security table §6 for line-precise issues |

---

## 4) Database schema documentation

### 4.1 Sources of truth
- `migrations/install.sql` (SQLite, 445 lines) — the "fresh install" schema; includes v2–v12 features baked in.
- `migrations/install_mysql.sql` (365 lines) — MySQL twin, **older/lagging** (see 4.4).
- `migrations/mobile_api.sql` / `mobile_api_mysql.sql` (20 lines each) — `api_tokens`; **not wired into Bootstrap**; absent from the committed DB.
- `app/Core/Bootstrap.php:272-916` — versioned migrations `schema_initial`, v2_add_plan_columns, v2_add_user_columns, v2_add_ticket_columns, v2_create_tickets_table, v3_referral_wallet, v4_sms_system, v5_email_templates, v6_link_tracking, v7_birthday_column, v8_scheduled_posts_target_channels, v9_create_plans_table, v10_ticket_categories_and_agents, v11_responder_logs_table, v12_notifications_table.
- **Committed DB `storage/db/whcm_saas.sqlite`**: 33 app tables (+ sqlite_sequence), all 15 migrations recorded. Row counts: users 3, channels 2, posts 4, payments 3, plans 4, subscriptions 7, tickets 1, ticket_categories 3, inbox 7, responder_logs 7, settings 79, email_log 13, email_templates 7, sms_templates 5, referral_settings 7, auto_replies 5, channel_messages 4, post_channel_stats 4, notifications 1, clicks_log 0, link_tracking 0, **api_tokens ABSENT**.

### 4.2 Table-by-table (SQLite definitive version)

1. **users** — id PK AI; name 150; email 150 UNIQUE; password 255 (bcrypt); role 20 def 'user' (superadmin|support_agent|user); status 20 def 'active' (active|suspended); business_name/type 150; phone 15; referral_code 20 (partial UNIQUE index `idx_users_referral_code ... WHERE referral_code IS NOT NULL`); referred_by INT; referral_points DECIMAL(15,2); wallet_balance DECIMAL(15,2); birthday VARCHAR(10) [v7]; created_at.
2. **plans** — id; title 100; price DECIMAL(12,2); duration_days INT def 30 (**0 = never-expire, end_date 2099-12-30**); max_channels INT def 1; max_posts INT def 10 (**0 = unlimited**); features TEXT JSON {gold_ticker, auto_responder, woocommerce, ai_caption, stats}; payment_url; image_url; description; early_renewal_discount INT; general_discount INT; discount_badge_text 150; is_featured INT; created_at.
3. **subscriptions** — id; user_id FK→users CASCADE; plan_id FK→plans CASCADE; start_date; end_date; status 20 'active' (active|expired); expiry_reminder_sent INT def 0 [v8]; created_at. Idx: (user_id,status), (end_date).
4. **channel_registry** — anti-cheat global lock: id; channel_id 150; platform 20; owner_user_id FK; created_at; **UNIQUE(platform,channel_id)**.
5. **channels** — id; tenant_id FK; name 150; platform 20; channel_id 150; **token TEXT (plaintext bot token)**; link_config TEXT JSON [3 links]; button_config TEXT JSON {active, buttons[2]}; webhook_active INT 0/1; webhook_secret 100 (nullable); created_at. Idx: tenant_id, (platform,channel_id).
6. **posts** — id; tenant_id FK; title 255; content TEXT; media_url; status 20 def 'draft' (draft|queued|sending|scheduled|sent|failed); scheduled_at; target_channels TEXT JSON [v8]; created_at. Idx: tenant_id, status, scheduled_at.
7. **channel_messages** — id; post_id FK; channel_id FK; message_id 100; status; sent_at.
8. **post_channel_stats** — id; post_id FK; channel_id FK; clicks; views. *(MySQL adds UNIQUE(post_id,channel_id); SQLite does not — Sender guards with check-then-insert.)*
9. **clicks_log** — id; post_id; channel_id; ip 50; user_agent; clicked_at.
10. **inbox** — id; tenant_id FK; channel_id FK; sender_id 100; sender_name 150; message_text TEXT; received_at. Idx (tenant_id,channel_id).
11. **auto_replies** — id; tenant_id FK; channel_id FK; keyword 255; reply_text TEXT; active INT. Idx (tenant,channel,active).
12. **discount_codes** — id; code 50 UNIQUE; type 'percent'; amount DECIMAL(12,2); max_uses (0=∞); used (never incremented in code!); expires_at; active; created_at.
13. **discount_offers** — per-user plan offers: user_id FK; plan_id FK; type; amount; expires_at; used; created_at.
14. **payments** — id; user_id FK; plan_id FK; amount (client-declared); discount_code_id FK SET NULL; payment_method 'card_to_card'; receipt_photo (path); reference_num 100; status pending→approved; admin_notes; created_at; verified_at. Idx status, user.
15. **push_subscriptions** — id; user_id FK; endpoint UNIQUE (TEXT SQLite / VARCHAR(500) MySQL); keys_p256dh; keys_auth; created_at.
16. **settings** — id; tenant_id def 0; key_name 100; key_value TEXT; **UNIQUE(tenant_id,key_name)**. Idx same. Used for: tenant config (gold_*, caption_format, inbound_method, poll_interval, ai_*, link_*/btn_*), platform config (sms_*, smtp_*, gold_custom_api_url, global_announcement, woo_*, responder_*), runtime state (upd_offset_{ch}, responder_enabled_{ch}, last_gold_prices, last_read_announcement_id, password_reset_token[s]).
17. **rate_limits** — id; ip 50; action 100; attempts; last_attempt INT (unix). Idx (ip,action) non-unique.
18. **tickets** — id; user_id FK; subject 255; category 100; message TEXT (replies appended inline by web flow); status 50 (open|replied|closed); attachment; assigned_to INT; priority 20 def 'normal' [v10]; created_by_admin INT [v10]; created_at.
19. **ticket_replies** — id; ticket_id FK CASCADE; user_id; message; created_at. *(Used only by mobile API; web appends to tickets.message — split-brain.)*
20. **ticket_categories** [v10] — id; slug UNIQUE; title 150; icon '🌐'; assigned_agent_id; sort_order; created_at. Seeded: technical/billing/general.
21. **referrals** — id; referrer_id FK; referred_id FK **UNIQUE** (one referral record per referred user ⇒ first-purchase one-shot); referral_code 20; reward_type 'points'; reward_value DECIMAL(10,2); status pending|rewarded; created_at; rewarded_at.
22. **wallet_transactions** — id; user_id FK; type 30 (cashback|referral_purchase|points_convert|debit|credit...); amount DECIMAL(15,2); balance_after DECIMAL(15,2); description; reference_type 50; reference_id; created_at.
23. **referral_settings** — setting_key UNIQUE; setting_value. Seeded defaults: enabled=1, register_reward_type=points, register_reward_value=100, first_purchase_reward_type=percent, first_purchase_reward_value=10, max_referrals_per_user=100, monthly_reward_cap=500000. *(points_wallet_rate absent — only read.)*
24. **sms_templates** — id; event_key UNIQUE; template_name; template_id (**INT in Bootstrap v4 vs VARCHAR(50) in install.sql**); parameters '[]'; is_active; created_at. Seeded: registration, payment_confirm, subscription_expiry, password_reset, bulk_notification (template_id=0 placeholders).
25. **sms_log** — id; template_id; phone 15; user_id; status (success|failed|rate_limited|pending); response_code; error_message; created_at. Idx phone.
26. **email_templates** — id; event_key UNIQUE; template_name; subject 255; body_html TEXT; variables '[]'; is_active; created/updated_at. 7 seeded: welcome, payment_confirm, subscription_expiry, subscription_expired, password_reset, ticket_reply, custom_notification.
27. **email_log** — id; template_id; to_address; user_id; subject; status; error_message; created_at.
28. **link_tracking** — id; code 20 UNIQUE; original_url; post_id FK; channel_id FK; **tenant_id**; total_clicks; unique_clicks; created_at.
29. **link_clicks** — id; link_id FK; ip_address 45; user_agent; referer; is_unique; created_at.
30. **verification_codes** — id; user_id FK; type 20 ('password_reset'|'sms_reset'); code 10; expires_at; used; created_at.
31. **responder_logs** [v11] — id; tenant_id; channel_id; sender_id; sender_name 200; message_text; matched_keyword 255; reply_sent 0/1; created_at.
32. **notifications** [v12] — id; user_id FK CASCADE; type 50; title; message; target_section 100; is_read; created_at. Idx (user,is_read), (user,created_at DESC).
33. **schema_migrations** — version PK; executed_at.
34. **api_tokens** (mobile_api.sql only, NOT in committed DB) — id; user_id FK CASCADE; token_hash; device_name 100 'android'; created_at; last_used_at; expires_at; revoked_at. Idx token_hash, user_id, expires_at.

### 4.3 Index inventory (SQLite install.sql:417-445)
channels(tenant_id), channels(platform,channel_id), posts(tenant_id|status|scheduled_at), subscriptions(user_id,status)+(end_date), inbox(tenant_id,channel_id), auto_replies(tenant_id,channel_id,active), settings(tenant_id,key_name), rate_limits(ip,action), clicks_log(post_id,channel_id), channel_messages(post_id,channel_id), payments(status)+(user_id), tickets(status)+(user_id), referrals(referrer_id)+(referred_id), wallet_transactions(user_id), sms_log(phone), email_log(user_id), link_tracking(code), link_clicks(link_id), verification_codes(user_id,type), ticket_replies(ticket_id), responder_logs(tenant_id,created_at), notifications(user_id,is_read)+(user_id,created_at DESC), users referral_code partial unique.

### 4.4 SQLite vs MySQL differences (all with file:line)
| Area | SQLite (install.sql) | MySQL (install_mysql.sql) | Impact |
|---|---|---|---|
| users.birthday | present (L21) | absent (added later by v7 ALTER, Bootstrap.php:801) | OK if v-migrations run |
| subscriptions.expiry_reminder_sent / posts.target_channels | present (L53, L95) | absent (v8 ALTER) | same |
| referral_code uniqueness | partial index WHERE NOT NULL (L24) | plain UNIQUE (L15) | MySQL OK (multiple NULLs allowed) |
| post_channel_stats | no UNIQUE (L113-121) | UNIQUE(post_id,channel_id) (L106) | SQLite can duplicate rows if guard races |
| push_subscriptions.endpoint | TEXT | VARCHAR(500) | long FCM endpoints may truncate on MySQL |
| sms_templates.template_id | **VARCHAR(50)** (L294) | **VARCHAR(50)** (L264) but Bootstrap v4 creates **INT** (Bootstrap.php:443/453) | type drift between fresh-install path and legacy migration path |
| tickets.priority/created_by_admin, ticket_replies, responder_logs, notifications, ticket_categories | all present | absent from install_mysql.sql (rely on v2/v10/v11/v12) | fresh MySQL install without v-migrations misses them |
| `ON CONFLICT` upserts | supported | **not** — MainController.php:1600,1605,1618,1659,1672 breaks on MySQL | admin gold/AI/responder/woo settings unusable on MySQL |
| Notification::cleanupOld | datetime('now') only (Notification.php:87) | n/a | MySQL incompatible; no callers |

### 4.5 Committed DB = data-privacy incident
`storage/db/whcm_saas.sqlite` (364 KB) contains: superadmin account (name/email), 2 tenant accounts with personal emails, 2 **live bot tokens** (channels.token), admin bank card number/holder/bank, SMTP credentials (plaintext), DeepSeek API key (`sk-…`), gold API URL with implied key, payment rows, and ticket/inbox content. `public/error_log` and `storage/logs/last_error.txt` are also committed. ⇒ Rotate every credential, purge from git history.

---

## 5) API endpoint catalog

### 5.1 Mobile API — `/api/v1/*` (61 endpoints; all JSON envelope)

**Public (no token) — 7**
| # | Method/Path | Handler | Notes |
|---|---|---|---|
|1|POST /auth/login|AuthApiController@login|rate limit api_login 10/300s; returns token+user|
|2|POST /auth/register|…@register|email+password≥6+confirm; auto-login; referral; welcome email|
|3|POST /auth/reset-password|…@requestResetEmail|always-200 anti-enumeration|
|4|POST /auth/reset-password/confirm|…@confirmResetEmail|token+new password; revokes all tokens|
|5|POST /auth/reset-password-sms|…@requestResetSms|3 req/300s rate limit; anti-enumeration|
|6|POST /auth/verify-sms-code|…@verifySmsCode|**no rate limit on code attempts**|
|7|GET /plans|BillingApiController@getPlans|public plan list|

**Auth (Bearer) — 39**
| Method/Path | Handler |
|---|---|
|POST /auth/logout|revoke current token|
|GET /auth/me|user + active subscription|
|PUT /auth/profile|name/email/birthday (email uniqueness check)|
|POST /auth/change-password|current+new+confirm; bcrypt 12|
|GET /bootstrap|full dashboard aggregate (19 keys)|
|GET /sync?since=|delta sync (notifications/channels/posts/quota/wallet)|
|GET/POST /channels; GET/PUT/DELETE /channels/{id}|ChannelManager-backed; registry anti-cheat|
|GET/POST /posts; GET /posts/{id}; POST /posts/{id}/cancel; POST /posts/{id}/retry|quota-gated; jalali scheduling|
|GET /notifications; POST /notifications/{id}/read; POST /notifications/read-all|ownership-checked|
|POST /payments; GET /payments|card-to-card receipt flow|
|POST /coupons/validate|active/expiry/max_uses only|
|GET/POST /tickets; GET /tickets/{id}; POST /tickets/{id}/reply|PDF/image attachment|
|GET /settings; POST /settings/gold; POST /settings/gold/trigger; PUT /settings/advanced|incl. AI key storage|
|GET/POST /auto-responder; DELETE /auto-responder/{id}; POST /auto-responder/toggle|channel-ownership-checked|
|GET /wallet; POST /wallet/convert-points; GET /referral|rate from points_wallet_rate (default 1)|
|GET /analytics/links; GET /analytics/links/{id}|tenant-scoped|

**Superadmin — 15**: GET /admin/dashboard; GET /admin/users; POST /admin/users/{id}/suspend; POST /admin/users/{id}/activate; GET /admin/payments; POST /admin/payments/{id}/approve; GET /admin/tickets; POST /admin/tickets/{id}/reply; GET/POST /admin/plans; PUT/DELETE /admin/plans/{id}; POST /admin/broadcast; POST /admin/discounts; DELETE /admin/discounts/{id}.

*(Note: API `admin` middleware exists and accepts support_agent, but no route uses `['admin']` — all admin routes require superadmin.)*

### 5.2 Web routes (public/index.php — 94 registrations + 3 surviving module routes)
- **Public**: GET / (landing+captcha), POST /login, POST /register, GET /logout (state change via GET!), GET/POST /reset-password, POST /reset-password/confirm, POST /reset-password-sms (AJAX), GET /sms-verify, POST /verify-sms-code, GET /go/{code} (link redirect), GET /click?p&c, POST /api/webhook (bot updates), GET /help, GET /privacy.
- **Tenant (session)**: GET /dashboard; POST /dashboard/{add-post, cancel-post, add-channel, edit-channel, delete-channel, submit-payment, update-profile, change-password, save-gold-settings, save-advanced-settings, trigger-gold-publish, add-auto-reply, delete-auto-reply, toggle-responder, mark-announcement-read, mark-notification-read, mark-all-notifications-read, add-ticket, reply-ticket*, close-ticket*}; GET /dashboard/referral, /dashboard/wallet, /dashboard/link-stats; POST /dashboard/convert-points.
- **Admin `/hnnh` (session superadmin)**: GET /hnnh; POST reply-ticket, delete-plan, edit-plan, approve-payment, create-plan, delete-user, suspend-user, activate-user, wipe-test-data, broadcast-announcement, save-bank-settings, add-user-manual, grant-subscription-manual, save-gold-settings-admin, save-ai-settings-admin, delete/add-discount, save-responder-settings-admin, save-woo-settings-admin, reopen/delete/close/create-ticket, save-ticket-categories, save-sms-config, save-sms-template, delete-sms-template, test-sms, send-bulk-sms, save-email-config, save-email-template, delete-email-template, test-email, send-bulk-email, preview-email-template, save-referral-settings; GET referral-settings, wallet-stats, sms-settings, email-settings; **GET quick-actions**: suspend-user, activate-user, delete-user, approve-payment, delete-plan (state changes via GET, no CSRF).
- **System/AJAX**: GET /api/push/vapid-key; POST /api/push/subscribe|unsubscribe (dead); GET /api/push/status (dead); POST /api/process-post-queue (no CSRF); POST /api/heartbeat (no CSRF, global scheduler trigger).

\* = registered in both public/index.php and Support/Routes.php (last registration wins ⇒ main inline handlers).

---

## 6) Security findings (severity + evidence)

### CRITICAL
1. **Live secrets + PII committed to git** — `storage/db/whcm_saas.sqlite` rows: `settings(0,'smtp_password')='Hoomans@8702'`, `settings(0,'ai_global_key')='sk-…'`, `settings(0,'admin_card_number')='6219…'` + holder name; `channels.token` live bot tokens; users table real names/emails; payments. Also committed `public/error_log`, `storage/logs/last_error.txt`. **Action: rotate all credentials; strip DB/logs from repo and history.**
2. **First-user-becomes-superadmin** — `Auth.php:40-47` (`SELECT COUNT(*) FROM users` ⇒ role superadmin). On any wiped/reset DB the next visitor who registers owns the platform. Compounded by admin `wipeTestData` (UserController.php:141-152) and cascading user deletes. **Fix: explicit installer/admin-bootstrap with setup token.**
3. **Mobile API cannot authenticate on fresh installs** — `api_tokens` never created: not in install.sql, not in `runVersionedMigrations()` (Bootstrap.php:272-916), absent from committed DB. Every `/api/v1/auth/login` throws SQLSTATE. **Fix: add v13 migration.**

### HIGH
4. **Webhook spoofing** — `MainController::handleApiWebhook` (836–868): secret checked **only** when platform==='telegram' AND `webhook_secret` non-empty. Bale channels and legacy channels (webhook_secret NULL in committed DB) accept arbitrary unauthenticated JSON → fake inbox messages, spam auto-responder replies to arbitrary chat_ids (Sender::sendReplyToUser). **Fix: mandatory per-channel secret for both platforms + IP pinning.**
5. **Verification-code brute force (API)** — `AuthApiController::verifySmsCode:543-551` resolves user purely by code; no RateLimit check, no per-code attempt counter; 10^6 space, 5-min TTL. (Web variant `/verify-sms-code` binds to session via `$_SESSION['sms_reset_user_id']`, better but still no attempt cap, MainController.php:2524-2539.)
6. **CSRF gaps** — no CSRF on `POST /api/process-post-queue` (MainController.php:1257), `POST /api/heartbeat` (1323), notification-read AJAX (1028–1083), `/dashboard/link-stats` (2488). **State-changing GET endpoints** with no CSRF: `/hnnh/{suspend-user, activate-user, delete-user, approve-payment, delete-plan}` (1517–1590) and `GET /logout` (195). SameSite=Lax mitigates cross-site POST but not top-level GET navigations.
7. **No concurrency control on sends** — `cron.php` unguarded; `ScheduledPost::processAll` (SELECT→send→UPDATE, ScheduledPost.php:36-101), `processPostQueue` (queued→sending→send) and `handleHeartbeat` all race → **duplicate posts to channels**; post stuck in 'sending' if AJAX dies. Same race in GoldTicker dedup (read-modify-write on `last_gold_prices`).
8. **Wallet ledger not atomic** — `Wallet::debit` reads balance then subtracts without `SELECT ... FOR UPDATE` or conditional `UPDATE ... WHERE balance >= ?` (Wallet.php:90-132); `balance_after` computed in PHP (L115) can diverge from DB. `convertPointsToWallet` same pattern (L188-244). No idempotency keys on reference_type+reference_id.

### MEDIUM
9. **Dead push endpoints** — `Auth::requireLogin()` / `Auth::id()` undefined (MainController.php:2588-2589, 2619-2620, 2635-2636) → fatal on call; `WebPush` + `push_subscriptions` effectively orphaned from the web UI (only reachable via AdminApiController notification path... which also targets sendPushToUser → works only if VAPID configured and a subscription exists).
10. **Web password reset scans one row** — `handleResetPasswordConfirm` (MainController.php:1476-1478) `SELECT ... WHERE key_name='password_reset_token' LIMIT 1`: if 2+ users have pending tokens, only the first row is ever checked → reset silently fails for others. Tokens stored plaintext in `settings`; API variant scans all rows `LIKE 'password_reset_token_%'` (AuthApiController.php:394-399).
11. **Points→wallet rate divergence** — web hard-codes rate 10 (MainController.php:1871); API reads `points_wallet_rate` default 1.0 (WalletReferralApiController.php:69-78); key never seeded (Bootstrap.php:412-420). 10× value discrepancy between interfaces.
12. **Referral first-purchase reward never fires** — `Referral::processFirstPurchase` has **zero callers** (grep). PaymentController::approve / handleApprovePaymentGet / AdminApiController::approvePayment do not call it. Referral ads promise 10% but referrers only get register points.
13. **Discount codes infinitely reusable** — `discount_codes.used` never incremented (grep `SET used` → only verification_codes). `BillingApiController::validateCoupon` checks `used < max_uses` but nothing consumes. Also plan-level `early_renewal_discount`/`general_discount` stored (PlanController) but **never applied** in any subscription-approval math.
14. **MySQL incompatible SQL in shared paths** — `ON CONFLICT` upserts (MainController.php:1600,1605,1618,1659,1672); `Notification::cleanupOld` (Notification.php:87); `Referral::awardReward` days-branch has both dialects but wrapped in try/catch masking failures (Referral.php:313-334).
15. **Weak upload validation on two paths** — `MobileApiController::uploadImage` (L117-155) and `TicketController::handleAttachment` / `SupportApiController::handleAttachment` (ext-only, PDFs saved as-is into web-served `public/assets/tickets/`) lack the finfo-MIME + PHP-tag + re-encode defenses that `BaseController::uploadAndConvertToWebp` has (BaseController.php:144-224).
16. **Schedule semantics broken** — `gold_schedule` accepts values like 'every_30m' but `GoldTicker::tick` only tests `=== 'manual'` (GoldTicker.php:198-201); admin `gold_interval` (settings `gold_interval=180`) unused. Result: every cron minute with changed prices posts. Combined with no locking (finding 7) → burst duplicates.
17. **Auto-schedule fallback** — empty `sched_date` in web post creation silently schedules 1405/01/01 (MainController.php:1146-1150) → past date → immediate send via heartbeat; no validation mirror of the API's stricter ranges (PostApiController.php:184-193).
18. **Quota check timing** — quota verified at post creation/retry but `processPostQueue`/`ScheduledPost` re-check only scheduled path (ScheduledPost.php:68); instant-queue posts skip re-check at send; `consumePostQuota` (Quota.php:93-102) is never called.

### LOW
19. **Session hardening gaps** — lifetime 0 only, no absolute/idle timeout, no UA binding; `security.session_lifetime` config unused; CSRF token not rotated after privilege change (only session ID rotates on login, Session.php:91-95).
20. **Referral cap enforcement race** — max_referrals checked by COUNT then insert (Referral.php:118-125); concurrent registrations can exceed cap; `monthly_reward_cap` stored, never enforced.
21. **channel_registry permanent lock** — deleting a channel never releases the (platform,channel_id) pair (ChannelManager.php:204-225); a deleted/abandoned tenant locks channels forever (documented anti-cheat, but no admin release tool — grep: no DELETE FROM channel_registry anywhere).
22. **Hard-coded secrets routes** — admin panel path `/hnnh` hard-coded in 30+ places (security by obscurity); `wipeTestData` contains test emails; `Postyar` error pages leak md5 id only (fine).
23. **Duplicate jalali→gregorian implementations** — BaseController.php:229-277 vs PostApiController.php:413-449 (drift risk); `TextFormat::g2j` is a third (inverse only).
24. **open redirect (bounded)** — `/go/{code}` redirects to tenant-authored `original_url` (MainController.php:2478-2486); `/click` redirects to `link_config[0].url` (826). Tenant-controlled only.
25. **info disclosure** — `handlePreviewEmailTemplate` echoes arbitrary admin-supplied HTML (2454-2475, superadmin only); Router 500 page leaks exception md5 id (fine); `last_error.txt` full trace on disk.

**Positive controls worth keeping in the rebuild**: prepared statements everywhere (no SQLi found — every query parameterized), bcrypt cost 12, `hash_equals` on all secret comparisons, session ID rotation on login, tenant_id scoping consistently applied on all user-facing queries (no IDOR found in tenant paths), SSRF-safe HttpClient (SSL verify on), anti-cheat channel registry, finfo+re-encode upload pipeline on the web path, uniform JSON envelope, per-phone SMS rate limiting.

---

## 7) Business rules extracted (feed the Postyar product spec)

**Plans & quotas**
- Plan fields: price, duration_days (0 = perpetual → end_date '2099-12-30 00:00:00'), max_channels, max_posts (**0 = unlimited posts**), features JSON: `gold_ticker`, `auto_responder`, `woocommerce`, `ai_caption`, `stats` (always true).
- Auto-provisioned free plan on first registration: title "پلن آزمایشی رایگان", price 0, duration 0, **2 channels (1 Telegram + 1 Bale), 10 posts total**, stats on (Auth.php:58-74).
- Channel quota = COUNT(channels) (hard cap, adding blocked at limit — ChannelManager.php:45-51). Post quota = COUNT(posts WHERE status='sent' AND created_at >= subscription.start_date) — counted **per subscription period** (Quota.php:56-58).
- Without active subscription: cannot add channels, cannot send, gold ticker off, auto-responder polling off (Quota.php:35-47; GoldTicker.php:184; Inbox.php:211-214).
- Payments: manual card-to-card with receipt image; status pending→approved by superadmin; approval in one transaction expires all previous active subs and creates a new one (PaymentController.php:40-52). Discounts/coupons exist in schema but are **not enforced** (see §6-13).

**Referral & wallet**
- Referral link `https://host/?ref=POST-XXXXXX`; register reward default **100 points** to referrer (settings-driven); first-purchase reward **10%** configured but never executed; max 100 referrals/user; monthly cap 500,000 stored but unenforced.
- Points→wallet conversion: web 1 pt = **10 Toman**; API 1 pt = **1 Toman** (unset setting). Ledger types: cashback (unused), referral_purchase (unreachable), points_convert, debit (unused).
- No user-facing withdrawal flow exists.

**Gold ticker**
- Data source chain: tenant `gold_api_url` → admin `gold_custom_api_url` → config default `https://api.tgju.org/v1/data/sana/home`; response parsed by recursive keyword match (g18/coin/ounce, incl. Persian key names, 'value/price/amount' generic keys + `name` match).
- Message template per tenant with `{g18k} {coin} {oz} {time}` placeholders; currency setting toman|rial (÷10); ounce rendered in dollars; jalali timestamp.
- Schedule options in UI: manual (+ intervals); **only 'manual' is honored** — anything else posts every cron minute when prices change; dedup via `g18|coin|oz` snapshot; auto target channels = `gold_auto_channels` else all tenant channels; optional gold image; system post row recorded (draft→sent/failed).

**Channels & delivery**
- Platforms: **telegram, bale only** (no Rubika). Bot token per channel; live `getMe` validation with network-block bypass for Iranian hosts.
- Global (platform, channel_id) ownership lock via `channel_registry` (first come, permanent).
- Post delivery: text → sendMessage; media by extension mp4|mov|webm → sendVideo, else sendPhoto; caption format plain|html (html escapes title/links; content passed raw → parse_mode never set on sendMessage, so HTML mode only affects Bale rendering guard); inline keyboards: row1 = 3 configured links (3rd replaced by `/click?p={post}&c={ch}` tracker), row2 = 2 custom buttons; post statuses draft→queued→sending→sent|failed (web) or draft/scheduled→sent|failed (cron/API); per-channel results recorded in channel_messages + post_channel_stats.
- Inbound: webhook preferred (secret token telegram-only), getUpdates polling fallback (offset per channel in settings, 409 → webhook_active resync), gated by plan `auto_responder` feature and per-channel `responder_enabled_{id}` toggle; keyword match case-insensitive; reply sent live via bot; everything logged to responder_logs + inbox.

**Subscriptions lifecycle**
- Cron every minute: expire subs past end_date (status→expired + email + SMS), reminder at **T-3 days** once per sub (`expiry_reminder_sent`), verification-code cleanup, uploads cleanup after 30 days.
- SMS: SMS.ir ultrafast templates; max **3 SMS/hour per phone**; events seeded: registration, payment_confirm, subscription_expiry, password_reset, bulk_notification.
- Email: SMTP settings from DB (fallback config.php); 7 seeded responsive fa templates with {{vars}}; full email_log.

**Mobile API tokens**: 30-day expiry, SHA-256 hashed at rest, max 5 devices (FIFO cleanup), revocation on logout/password reset, last_used_at tracking, api_login rate limit 10/5min, api_general 120/min.

**Admin operations**: user suspend/activate/delete (never superadmin), manual user creation (role user|support_agent), manual subscription grant, plan CRUD (with feature checkboxes + discounts + image), payment approval, ticket lifecycle with categories + assignment to support agents, global announcement (settings + notifications + push), bulk SMS/email to all/active/subscribers, bank card + support contact settings, discount codes, ticket categories editor, wipe-test-data.

---

## 8) Disposition recommendations for Postyar

| Area | Disposition | Rationale / carry-over |
|---|---|---|
| Web MVC (Router, MainController, Views, flash/captcha) | **Drop** | Monolithic god-controller (2.8k lines), duplicated logic, GET state changes. Rebuild API-first; keep the URL map + business flows as spec (§5.2). |
| Core auth (Auth/Session) | **R** | Keep bcrypt-12 + regenerate-on-login semantics; add installer bootstrap instead of first-user-admin, absolute session timeout, CSRF rotation, server-side sessions. |
| CSRF/RateLimit | **A** | Port `hash_equals` pattern; rate-limit to Redis/DB with unique (ip,action); enforce CSRF on every mutating route incl. AJAX; kill GET mutations. |
| Mobile API stack (Router/Auth/Response/Controller/Routes) | **A → R** | Cleanest layer in the codebase. Keep the 61-endpoint surface + JSON envelope + hashed 30-day tokens; wire `api_tokens` migration; add token rotation + per-code attempt limiting. |
| Domain: Sender, ChannelManager (registry anti-cheat), Quota, ScheduledPost, Inbox, GoldTicker, TextFormat | **R (spec) / A (code)** | Semantics documented in §7 are the product spec. Rebuild with: queue with atomic claim (`UPDATE ... WHERE status='scheduled' RETURNING`), retries w/ backoff + 429 handling, both-platform webhook secrets, enforced schedules, quota reservation. |
| Wallet/Referral | **R** | Proper double-entry ledger, atomic conditional updates, idempotency keys, unify conversion rate, actually wire first-purchase reward + caps. |
| SubscriptionManager | **A** | T-3d reminder + expiry flags are correct; add batching + timezone-safe date math. |
| Migrations | **A** | Reconcile SQLite/MySQL drift (single source), add missing FKs/uniques (post_channel_stats, api_tokens), externalize seeds. |
| Modules skeleton (ModuleLoader, 0-byte json/routes) | **D** | Dead scaffolding; Support/Routes.php overwritten. |
| SMS/Email/HttpClient | **A** | HttpClient is solid (keep); abstract provider behind interface (SMS.ir hardcoded); drop hand-rolled WebPush or adopt library. |
| Committed DB/logs | **Drop + rotate** | Purge from repo history; rotate SMTP/DeepSeek/bot/card exposure; never ship storage/. |
| Woo-related backend | **Drop here** | SaaS side has only admin setting keys (`woo_help_text/max_stores/require_ssl`) + plan flag; actual WooCommerce integration lives in the separate WP plugin (Task 02-b scope). New spec should define a proper Woo webhook/REST bridge. |

**Top spec inputs for Postyar** (from this audit): tenant=user model confirmed; plan-driven feature flags; anti-cheat channel registry; click-tracking links embedded into outbound captions; scheduled+queued post pipeline; gold ticker with per-tenant templates and price-change dedup; auto-responder with per-channel toggles; referral (register reward) + wallet (points conversion) + manual card-to-card billing; subscription expiry automation with T-3d reminders; 61-endpoint mobile API surface; and a hard requirement list of the 18 security fixes in §6.

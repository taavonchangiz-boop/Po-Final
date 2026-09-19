# Release Notes — Postyar v1.0.0

Date: 2025 · Status: initial production release of the rebuilt SaaS (independent implementation, built from frozen read-only reference audits — no code inherited).

## Delivered capabilities

**Platform**
- Fastify 5 + TypeScript API (`/api/v1`), Node ≥22; unified error contract (stable codes + Persian user-safe messages + `requestId`); zod-validated boundaries; pino logging with request IDs.
- Single worker process (BullMQ: delivery, bot-events, ai-jobs, notifications, maintenance) + cron-tick scheduler with Redis lock and transactional outbox → exactly-once publishing intent, atomic delivery claims, idempotency keys.
- Vite + React 18 + TypeScript SPA, **100 % Persian RTL UI**, Vazirmatn typography, PWA manifest/icons; static hosting under `public_html` (zero Node in the web tier).
- MySQL 8/MariaDB schema: **41 tables** with anti-cheat channel registry, plan limits, ledgers with exactly-once posting constraints; deterministic forward-only migration runner with drift detection; seed plans + system settings.
- Shared-host deployment story: cPanel/CloudLinux/Passenger layout (`postelrobbal/` private + `public_html/` public), idempotent `deploy.sh` (preflight → migrations → guarded rsync → Passenger restart → health), release packaging (`make-release.sh` → zip + `SHA256SUMS`) and a release gate (`release-check.sh`); CI (GitHub Actions) for typecheck/build/tests/security/PHP lint.

**Product modules**
- **Auth & account**: register/login (Argon2id), DB-backed sessions with rotation, CSRF double-submit, password reset, change password, account deletion (anonymization), notification preferences (6 Persian categories).
- **Channels**: connect/verify/update/disconnect for **Telegram, Bale, Rubika**; platform-wide claim registry preventing two tenants from using the same channel; live capability reporting (UI never emulates unsupported features).
- **Publishing**: draft → publish now / schedule; per-target delivery states with retries (3 attempts, exponential backoff), per-target retry, cancel; inline buttons + parse modes with capability soft-strip; media library (magic-byte-checked uploads ≤8 MB, private storage, 15-min signed URLs).
- **Bots & no-code automation**: bot connect (tokens AES-256-GCM encrypted, masked in UI), webhook + polling modes with secret'd webhooks and replay dedup; commands, keywords (EXACT/CONTAINS), and a workflow interpreter (MESSAGE/BUTTONS/AI/WAIT/CONDITION; ≤20 steps, 60 s, nesting ≤2) with per-run logging; spam guard (20 replies/chat/hour).
- **AI**: caption writer (queued job + polling), synchronous test generation, monthly quota accounting; providers OpenAI, Gemini, DeepSeek, Claude (Anthropic), Mistral, OpenRouter — all behind a fixed Persian safety prefix; quota enforced per plan.
- **Gold ticker** (plan-gated): configurable source URL (SSRF-guarded), Persian price parser (دلار/یورو/سکه امامی/طلای ۱۸ عیار/…), change-only publishing, per-tenant frequency (≥15 min), immediate run.
- **WooCommerce**: site connect with one-time secret (sha256-stored, timing-safe), idempotent product sync (content-hash), publish-to-channels through the same delivery pipeline, secret rotation. (Connector plugin status: see WORDPRESS.md §1.)
- **Monetization**: 5 seeded plans with limits/features; ZarinPal checkout for subscriptions (1–12 months) and wallet top-up with server-side verification and idempotent callback; wallet ledger + points ledger; referrals (100 pts on registration, first-purchase reward) with self-healing backfill; points→wallet conversion (min 100).
- **Analytics**: overview KPIs, append-only event timeline with ULID cursor pagination, per-day aggregates (60-day window); 180/180/90-day retention sweeps (events/clicks/bot events).
- **Admin & support**: overview KPIs, user suspend/activate, subscription gifting, payment review/approve, audit log viewer, plan editor, system settings editor, in-app broadcast, channel-registry release; ticketing with roles (USER/SUPPORT/SUPER_ADMIN/SYSTEM).

## Known limitations (v1.0.0 — honest list)

1. **Payment gateway needs a real credential**: without `PAYMENT_MERCHANT_ID` (ZarinPal) checkout/top-up cannot complete — subscriptions can still be granted by admins.
2. **SMS & email need provider credentials**: `SMS_API_KEY` (SMS.ir) and SMTP vars are required for password-reset email/SMS notifications; without SMTP, reset requests return the generic message but no email is sent (worker reports honestly, no fake success).
3. **Messaging platforms need bot tokens**: Telegram/Bale/Rubika delivery requires per-tenant bot tokens (encrypted at rest) and a public HTTPS `API_URL` for webhooks; Rubika adapter supports a reduced capability set (no inline buttons) and the UI reflects that.
4. **AI keys are deployment-level**: at least one AI provider key must be configured for AI features; per-provider cost controls are quota-based only (no spend caps).
5. **Load testing not executed**: performance numbers are unmeasured; the single-process/shared-host budget (API 1, Worker 1, Scheduler tick, `DB_POOL_MAX=5`) is a design constraint, not a benchmark result.
6. **Redis is external and single-instance**: queue visibility/rate-limit counters depend on it; no Redis persistence requirement, but its loss pauses delivery until restored (data survives in MySQL).
7. **Rate limiting is in-memory**: limits reset on API restart and are per-process (single-API-process contract).
8. **WordPress connector**: both sides shipped — SaaS protocol + `postyar-connector` plugin v1.0.0 (debounced batched sync of 50 products/request, ≤200 accepted per call; `publish_product` is protocol-ready but only `sync_products` + auto-publish flow are exercised end-to-end without live WordPress/WooCommerce instances).
9. **Migrations are forward-only**: no automatic down-migrations; rollback is code-level with expand/contract discipline (DEPLOYMENT.md §7).
10. **Persian-language product only**: UI strings are Persian by design; the admin surface shares the Persian SPA (engineering/API docs are English).

## v1.2.0 — feedback round 15 (2026-07-28 / ۲۸ شهریور ۱۴۰۵)

1. **Repo layout**: only `postelrobbal/` + `public_html/` are host-facing; every report/audit moved to `docs/` so host uploads stay clean.
2. **Official platform logos**: Rubika from rubika.ir/logo, Bale from the official blog.bale.ai download page, Telegram from telegram.org — no self-drawn icons anywhere.
3. **Brand logo**: the app now uses ONLY the reference-file logo (mark + full lockup); the self-made SVG was removed. PWA/favicon icons already derive from it.
4. **Admin → user dashboard button** in the admin panel header.
5. **Hero**: real logo on the product mock, the two floating chips moved ONTO the image, and a REAL dashboard screenshot inside the frame.
6. **Jalali-only date entry**: scheduling (and any filter/search date) uses a Persian-calendar date+time picker; no Gregorian inputs remain.
7. **Fresh preview**: database reset; the first (and only) account is the owner SUPER_ADMIN created from the setup script.
8. **Header clock**: Jalali date + 24-hour time chip next to the notification bell («شنبه ۲۸ شهریور ۱۴۰۵ - ۱۹:۱۱» format); 24h enforced app-wide.
9. **Mobile notification popover**: fixed the CSS-order bug that pushed the bell panel off the left edge of phone screens.
10. **Graphical feature icons** in «هر آنچه برای انتشار حرفه‌ای نیاز دارید» (multi-part SVG scenes on gradient tiles).
11. **Terms & conditions page** at `/terms` — full transparent Persian contract, linked from the mandatory registration checkbox and the footer.
12. **Tutorial page** at `/dashboard/help` — 10-step guide built from real application screenshots, visible only inside the user dashboard.
13. **Anti-bot captcha**: server-side SVG captcha (svg-captcha + Redis, one-time codes, 5-min TTL) enforced on login & registration with a graphical glass widget matching the forms.
14. **SPA base fix (root cause)**: Vite `base` switched from `./` to `/` — nested routes (e.g. `/dashboard/posts/new`) previously resolved bundle URLs document-relative and could render a blank page; absolute paths now work at every depth (preview rewrites + `.htaccess` updated accordingly).

## v1.3.0 — admin panel completion (2026-09-19 / ۲۸ شهریور ۱۴۰۵)

The admin area was a single page with 5 tabs; it is now a full multi-section management panel.

**Admin panel (nested routes under `/dashboard/admin`, own sidebar + role guard, «بازگشت به پیشخوان» toggle both ways)**
1. **داشبورد مدیریت** — full stats: users (total/active/suspended/new-30d), channels & bots per platform (Telegram/Bale/Rubika + active), Gold-bot (configs/enabled/snapshots-24h), posts (scheduled/published-30d/failed-24h), payments (verified-30d/total/pending-review), active subscriptions per plan, usage (AI jobs, media+storage, open tickets, deliveries-24h).
2. **کاربران** — search, suspend/activate, gift subscription.
3. **اشتراک‌ها (پلن‌ها)** — full plan CRUD: create, edit (limits/features/price/period), activate/deactivate, delete (refused while subscriptions reference the plan, with a clear Persian error).
4. **درگاه پرداخت** — online + card-to-card toggles; default gateway selector with **زیبال as the default** (زرین‌پال، آیدی‌پی also available); selecting a gateway reveals ITS settings (merchant ID / API key + sandbox); card-to-card cards editor (≤5).
5. **پیامک** — provider selector: **sms.ir default** + ملی پیامک، کاوه‌نگار، قاصدک; per-provider credentials revealed on selection.
6. **ایمیل** — SMTP settings (host/port/secure/user/pass/from) + live test-send endpoint (nodemailer).
7. **کانال‌ها / ربات‌ها** — global lists with owner join, platform filters, registry release.
8. **پرداخت‌ها / اطلاع‌رسانی / گزارش رویداد / تنظیمات عمومی** — review queue, broadcast, audit log, generic settings editor (payment/sms/email keys excluded — they live in their own sections).

**Backend**
- `GET /admin/overview` rewritten (nested shape); `GET /admin/channels`, `GET /admin/bots`; `POST/DELETE /admin/plans` (PUT extended); dedicated `GET/PUT /admin/settings/payments|sms|email` + `POST /admin/settings/email/test`; new gateway adapters `zibal.ts` / `idpay.ts`; `paymentProvider` default switched to `zibal`; new `paymentGateways` settings key with per-provider config merge.
- **Root-cause fixes**: (a) admin overview fired 27 concurrent queries against a pool with `queueLimit: 20` → mysql2 "Queue limit reached"; queries now run with bounded concurrency (5). (b) `gold_snapshots.capturedAt` was mapped to the wrong column by the shared `ts()` helper (`created_at`) — the Gold feature's snapshot lookup would crash at runtime; schema mapping corrected to `captured_at`.
- `.htaccess` restored (it had been wiped from `public_html/` by an earlier `--emptyOutDir` build) and now ships inside the Vite `public/` dir so every build re-emits it (SPA fallback + api/health passthrough + hidden-file deny + asset caching).

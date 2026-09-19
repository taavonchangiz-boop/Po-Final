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

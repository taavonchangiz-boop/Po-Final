# Postyar — Architecture

Version 1.0.0 | Status: FROZEN (Phase 07 of the execution contract)

## 1. System Shape

```
postyar-production-final/
├── app/        Fastify 5 + TypeScript (Node >=22)  — API + worker + scheduler
├── frontend/   Vite + React 18 + TypeScript SPA    — static output only (no Node server)
├── wordpress-plugin/postyar-connector/             — official WP adapter
├── database/migrations/                            — ordered SQL migrations (MySQL/MariaDB)
├── scripts/    deploy.sh, release-check.sh
├── tests/      vitest unit tests (DB-free) + integration specs
├── docs/adr/   architecture decision records
└── audits/     forensic audits of the reference systems
```

## 2. Runtime Topology (production, cPanel + CloudLinux + Passenger)

```
/home/account/
├── postelrobbal/                  PRIVATE application root (never web-served)
│   ├── app/                       backend build output
│   ├── api/                       Passenger entry (app.js)
│   ├── config/                    .env (chmod 600)
│   ├── workers/                   worker.js, scheduler.js entry points
│   ├── private/ storage/ logs/    private media, runtime storage, logs
│   └── scripts/                   deploy.sh
└── public_html/                   PUBLIC web root
    ├── index.html assets/         built SPA
    ├── images/ fonts/ icons/      brand assets
    └── api/                       .htaccess rewrite → Passenger (AppBase mapping)
```

Process budget: **Frontend 0 Node processes, API 1, Worker 1, Scheduler 1, Redis 0 (external)**.

- API: `api/app.js` → Fastify listening on Passenger-provided port.
- Worker: single BullMQ `Worker` set, concurrency bounded by env.
- Scheduler: tick model — wakes on cron (`* * * * *`), acquires Redis lock (`SET NX EX`), claims due work, exits. Cron never spawns unbounded Node processes.
- Graceful shutdown: SIGTERM/SIGINT → stop intake, drain jobs, close Redis/MySQL, exit 0.

## 3. Backend Layers

```
server.ts ──► app/ (fastify instance, plugins, hooks)
              ├── security/  headers, CORS allowlist, rate limit, CSRF, encryption, SSRF guard
              ├── core/      errors, logger (pino), ids, outbox, idempotency
              ├── db/        drizzle client (mysql2), schema, migrate
              ├── modules/   auth users channels publishing bots workflows ai subscriptions
              │              payments wallet referrals gold analytics media wordpress
              │              notifications support admin
              ├── providers/ telegram bale rubika sms email payments (each = adapter + capabilities)
              └── queue/     bullmq queues + producers
worker.ts ──► workers/  delivery, bot-events, ai-jobs, notifications, gold, wordpress-sync
scheduler.ts ─► due schedules, expiry warnings, gold ticks, retention sweeps
```

Rules:
- Every business request: schema-validated (`zod`) → authenticated → authorized (permission matrix) → tenant ownership check → service → serialized DTO.
- Errors: `{ success:false, error:{ code, message(fa), requestId } }` — no stack traces/secrets/SQL to clients.
- All external calls: explicit timeout (undici `AbortSignal.timeout`), classified errors (Transient/Permanent/Validation/Authentication/Authorization/RateLimited/Provider/Network/Internal).
- Outbox: business state + outbox row committed atomically in one transaction; worker relays to BullMQ.
- Idempotency: `idempotency_keys` table (scope + key unique) for payments, callbacks, deliveries, scheduler actions, webhook events.

## 4. Data Platform

- MySQL 8 / MariaDB 10.6+, utf8mb4, InnoDB.
- Drizzle ORM + drizzle-kit; canonical migrations committed under `database/migrations/NNNN_*.sql`.
- Money: BIGINT minor units (Rial). Never float.
- Tenant isolation: every tenant-owned table carries `tenant_id`; every query filtered by `tenant_id` derived from the session — never from client-supplied IDs. Cross-tenant IDs are opaque ULIDs.
- Sessions: server-side `sessions` table; opaque random token (32B) in HttpOnly+SameSite=Lax+Secure cookie; rotation on login; revocation list = delete row; no JWT, nothing sensitive in localStorage.
- First-admin rule: single transaction `INSERT INTO users ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM users)` pattern + unique constraint on the single-superadmin bootstrap, immune to concurrent registration.

## 5. Frontend

- Vite + React 18 + TypeScript strict; `react-router`; `@tanstack/react-query` for server state; no Redux.
- RTL-first (`dir="rtl"` on `<html>`), Vazirmatn local woff2, brand palette from reference identity (primary `#6366f1`), dark/light aware surfaces.
- `src/lib/format.ts`: single source for Persian digits, Jalali conversion (Intl `fa-IR-u-ca-persian` + manual fallback), money, percent, relative time. **No ad-hoc formatting in components.**
- Route-level code splitting (`React.lazy`), WebP assets, hashed filenames, no source maps in production.
- API client: typed fetch wrapper, credentials: 'include', CSRF token header injection, Persian error toasts.

## 6. Provider Abstraction

```ts
interface ChannelProvider {
  platform: 'telegram'|'bale'|'rubika';
  capabilities(): ProviderCapabilities;   // explicit booleans per capability
  verifyCredential(token): Promise<BotIdentity>;
  sendText/sendMedia/editMessage/deleteMessage?/setWebhook?/fetchUpdates?
}
```

Each adapter maps provider errors → internal `DeliveryErrorCode` + safe Persian message. Capability map drives both backend guards and UI affordances. Rubika is first-class: its own adapter, capability map, error mapping.

## 7. Queue Model (BullMQ)

| Queue | Producer | Consumer | Concurrency |
|---|---|---|---|
| `delivery` | outbox relay / scheduler | delivery worker | env-bounded (default 3) |
| `bot-events` | webhook/update ingestion | bot worker | 2 |
| `ai-jobs` | API (never blocking HTTP) | ai worker | 1 |
| `notifications` | expiry engine, events | notification worker | 2 |
| `maintenance` | scheduler | maintenance worker | 1 |

Retention: completed 24h, failed 7d (bounded Redis). All jobs carry `jobId` = idempotency key where duplicates are harmful.

## 8. Analytics

Append-only `events` table (name, tenant_id, subject refs, numeric props, no credentials/PII payloads) + `event_daily` aggregate (tenant, day, event, count). Dashboards read aggregates; raw events support the activity timeline with cursor pagination.

## 9. Security Architecture

- Argon2id passwords; generic auth-failure responses; timing-safe comparisons.
- CSRF: double-submit cookie + `x-csrf-token` header on mutating requests; SameSite=Lax baseline.
- Rate limits (per-IP and per-account): login 10/15m, register 5/h, reset 5/h, AI quota per plan, webhook ingestion 600/min per bot, WordPress webhook 60/min (fastify rate-limiter global 300/min per IP baseline).
- Secrets at rest: AES-256-GCM (key from `ENCRYPTION_KEY`), encrypted only server-side, masked in API responses (`****abcd`).
- SSRF guard for any user-supplied URL: scheme allowlist, DNS resolution check, private/loopback/link-local/metadata ranges blocked, redirects re-validated.
- Uploads: size/MIME/magic-byte checks, private storage, signed short-lived access tokens.
- Webhooks: provider secret_token (Telegram), HMAC (WordPress), replay protection via event dedup table, bounded payloads.
- Headers: CSP, HSTS (prod), X-Content-Type-Options, Referrer-Policy, frame-ancestors 'none'.

## 10. Deployment Contract

- `scripts/deploy.sh`: preflight (node version, dirs, env presence, DB/Redis reachability) → build if needed → `migrate status` → apply existing migrations only (never invents) → Passenger restart → health verification. No Redis install, no test suite, no worker duplication.
- Health: `/health/live` (cheap), `/health/ready` (MySQL + Redis real checks), `/health` (summary).

## 11. ADR Index

See `docs/adr/` — ADR-0001 … ADR-0012 covering every contract-required decision with rejected alternatives.

# Postyar — Architecture (v1.0.0)

## 1. System overview
```
┌─────────────────────────────  Browser (public_html, static SPA)  ─────────────────────────────┐
│  Vite + React + TypeScript SPA (RTL, Vazirmatn, Persian digits, Jalali)                        │
└──────────────────────────────────────┬────────────────────────────────────────────────────────┘
                                       │ HTTPS /api/v1 (session cookie + CSRF)
┌──────────────────────────────────────▼────────────────────────────────────────────────────────┐
│  Fastify API (1 process, Passenger)  — postelrobbal/app                                       │
│  app/{config,core,db,modules,providers,security}   auth→service→drizzle→MySQL                  │
│  health: /health/live (cheap), /health/ready (MySQL+Redis real checks), /health                │
└───────┬───────────────────────────────┬───────────────────────────────────────────────────────┘
        │ outbox→BullMQ enqueue         │ module services write outbox atomically with business state
┌───────▼──────────────┐   ┌────────────▼─────────────┐
│  Worker (1 process)  │   │  Scheduler (1 process)   │
│  BullMQ consumer:    │   │  tick-loop + Redis lock: │
│  deliveries, ai-jobs,│   │  schedules due, gold,    │
│  wp-sync, notifications│ │  expiry-7d, retention,   │
└───────┬──────────────┘   │  daily-stats, bot polling│
        │                  └──────────────────────────┘
        ▼
  Providers (Telegram api.telegram.org / Bale tapi.bale.ai / Rubika botapi.rubika.ir,
  payment gateways, AI providers, SMS/Email) — always timeout-bounded fetch.
```

## 2. Architecture Decision Records (condensed, binding)

### ADR-001 Frontend: Vite + React + TypeScript SPA (no Next.js)
Why: deployment contract forbids persistent Node process for UI; static assets served from `public_html` by Apache/Nginx. Rejected: Next.js/SSR (requires Node server; violates deployment model).

### ADR-002 Backend: Node.js 22 + Fastify + TypeScript strict
Why: process budget (1 API process), schema-validated routes, pino logging, low overhead. Rejected: Express (weaker schema story), Nest (heavier boot on shared hosting).

### ADR-003 Database: MySQL/MariaDB + Drizzle ORM
Why: cPanel shared hosting standard; typed SQL without runtime magic; migration SQL files are versioned/deterministic (`database/migrations`). Rejected: Prisma (extra engine binary on constrained hosting; contract prefers Drizzle), raw Kysely (less ergonomic schema-first flow).

### ADR-004 Queues: BullMQ on external Redis
Why: durable retries/rate-limit-aware backoff without installing infrastructure; Redis is a host-provided service. Application never installs/bootstraps Redis.

### ADR-005 Deployment layout: private `postelrobbal` + public `public_html`
Private root holds app/, api dist, workers, storage, logs, config. `public_html` holds only the built SPA + public assets. Passenger serves the API via `app.js` (Passenger overrides startup file) with `NODE_ENV=production`. Worker + scheduler run via cron-protected tick/daemon scripts with Redis SETNX locks (no duplication).

### ADR-006 Sessions: opaque server-side sessions (HttpOnly cookie), CSRF double-submit
Random 32B token; SHA-256 hash stored in `sessions`; revocation + rotation supported; never in localStorage. CSRF token in `py_csrf` cookie (readable) + `X-CSRF-Token` header check on mutating routes. Rejected: JWT (revocation pain).

### ADR-007 First-admin rule: `system_bootstrap` single-row insert mutex
Registration runs in a transaction; `INSERT INTO system_bootstrap (id) VALUES (1)` — duplicate-key error ⇒ other registration won the race ⇒ role USER. Survives concurrent registrations at the DB level; client-supplied role ignored.

### ADR-008 Publishing: transactional outbox + delivery work items
Post + deliveries + outbox event persist in ONE transaction; worker consumes queue jobs; delivery state machine PENDING→PROCESSING→SENT/RETRYING/FAILED/CANCELLED with exponential backoff and error classification (transient/permanent/validation/auth/ratelimited/provider/network).

### ADR-009 Provider abstraction: capability registry
`ChannelProvider` interface: sendText, sendMedia, editMessage, deleteMessage?, buttons?, webhook registration, getMe, getChat. Each provider declares supported capabilities; UI disables unsupported ops from the registry map. Telegram+Bale are Bot-API compatible (api.telegram.org / tapi.bale.ai); Rubika uses its own bot API + polling ingestion (documented capability deltas).

### ADR-010 Secrets at rest: AES-256-GCM envelope `base64(nonce|tag|ciphertext)`
Key from `ENCRYPTION_KEY` (32 bytes, server-side only). Bot/channel/WP secrets never logged, never returned after initial save (rotate flow instead).

### ADR-011 Analytics: append-only events + daily read model
Events cursor-paginated by id; scheduler aggregates into `daily_stats`; dashboards read aggregates (no raw scans). No credentials/message bodies in events.

### ADR-012 Bot provisioning: honest external step
Providers require external bot creation (BotFather/Bale/Rubika). Dashboard guides the step, then connects + verifies token. No fabricated "create bot via API" claims.

### ADR-013 Money: BIGINT Rial integers everywhere; wallet = balance row + ledger; `SELECT … FOR UPDATE` serialization; ledger rows carry `balance_after` + unique idempotency key.

### ADR-014 Frontend state: TanStack Query (server) + Zustand (UI) — no global hand-rolled stores.

## 3. Module boundaries (backend)
- `app/config` — zod-validated env; fails fast in production when mandatory secrets missing.
- `app/core` — errors (AppError + classification), logger (pino w/ requestId + secret redaction), crypto (AES-GCM, hashing), ids, http client (timeout-bounded), formatting kernel (server-side Persian helpers).
- `app/db` — drizzle client (pool ≤ 5), schema.ts (canonical), migrate runner.
- `app/security` — session lifecycle, CSRF, rate-limit presets, tenant guard helpers, SSRF guard, webhook signature utils.
- `app/modules/*` — auth, users, channels, publishing, bots, workflows, ai, subscriptions, payments, wallet, referrals, gold, analytics, media, wordpress, notifications, support, admin. Each module: `*.routes.ts` (zod validation) + `*.service.ts` (business logic + transactions) + optional `*.repo.ts`. Modules never reach into another module's tables directly — via service imports only.
- `app/providers/*` — telegram/, bale/, rubika/ (ChannelProvider + BotProvider), payments/ (gateway abstraction), sms/, email/ (adapters; no-op-with-config-error when unconfigured — never fake success).
- `app/queue` — BullMQ queues (deliveries, ai-jobs, wp-sync, notifications, maintenance) + enqueuers.
- `app/workers` — worker.js (queue consumers), scheduler.js (locked tick loop).

## 4. Frontend architecture
- `frontend/src/app` — router + shell (sidebar/topbar, RTL).
- `frontend/src/lib` — api client (fetch wrapper w/ CSRF + envelope), formatters (faDigits, faMoney, jalali date/time via jalaali-js), capability/labels maps (Persian labels for enums/states).
- `frontend/src/components/ui` — design system (Button, Card, Input, Select, Dialog, Toast, Badge, Table, Tabs, EmptyState, Spinner, charts).
- `frontend/src/features/*` — landing, auth, dashboard, channels, publishing, bots, bot-builder, ai, woocommerce, gold, analytics, billing (subscription/wallet/referrals), notifications, settings, admin, support.
- Landing route `/`; authenticated routes under `/app/*` with session guard.

## 5. Data flows (critical paths)
- **Publish now**: POST /posts → tx{post, deliveries, outbox} → enqueue → worker claims delivery (CAS to PROCESSING) → provider send → SENT + event → daily-stats refresh.
- **Schedule**: SCHEDULED + schedule row → scheduler tick claims due (status transition guard) → same enqueue path → ONCE→DONE / recurrence→nextRunAt.
- **Payment**: POST /payments → CREATED → gateway redirect → callback → server-to-server verify → tx{payment VERIFIED, subscription/wallet, referral reward w/ idempotency, notification, outbox} → event.
- **Expiry-7d**: scheduler scans ACTIVE subs expiring in 7d → idempotency key `expiry-7d:{id}` insert guard → notification + channel fan-out via queue.
- **Bot webhook**: POST /webhooks/telegram/:botId → secret header compare → dedupe insert bot_events → enqueue processing → workflows/commands/AI → outbound via provider.

## 6. Process & shutdown
API/worker/scheduler all handle SIGTERM/SIGINT: stop intake, drain in-flight, close BullMQ + Redis + MySQL, exit 0. Scheduler + worker single-instance via Redis SETNX lock heartbeat (auto-expires on crash).

## 7. Health semantics
`/health/live`: process alive (no dependencies). `/health/ready`: MySQL `SELECT 1` + Redis `PING` with 2s timeouts, truthful 503 on failure. `/health`: summary incl. versions.

---

## 8. Deployment addendum (appended by task 4-f — 4.07 deployment engineering; section 8 onward is new, §1-7 above unchanged)

Binding refinements of ADR-005, detailed operationally in `DEPLOYMENT.md`:

- **Two supported topologies.** (A) single domain: SPA at `public_html`, Passenger mounted at `/api` (Application URL) + `/health` proxied to the Passenger internal port via Apache `[P]` rewrite. (B) `api.domain` + `app.domain`: one Passenger process still; `app.domain` proxies `/api` + `/health` to `127.0.0.1:PORT` so the SPA stays same-origin and CORS never triggers (`buildApp.ts` accepts only `env.APP_URL` in production).
- **Passenger contract:** app root `postelrobbal/app`, startup file `dist/server.js` (never `src/`), `Passengerfile.js` pins `passenger_app_type node`, `environment production`, `min_instances 1`, `max_processes 1`, `max_requests 1000` (process budget: exactly one API process). Soft restart = `touch app/tmp/restart.txt`.
- **Scheduler supervision without systemd:** cron line `* * * * * /usr/bin/flock -n /tmp/postyar-scheduler.lock node .../app/dist/workers/scheduler.js` — flock is the lock-and-exit guard (contract §126-127): the loop process holds the lock for life; cron restarts it within 60s if it dies; additional invocations exit immediately; the internal Redis lock (`lock:scheduler`, SET NX EX 120) is the second defense layer.
- **Deploy automation:** `scripts/deploy.sh` is the only sanctioned deploy path (preflight → deps-if-stale → build-if-needed → forward-only migration via `dist/db/migrate.js` → restart.txt → `/health/ready` poll ≤30s). It never installs Redis, never recreates the DB, never runs the test suite, never spawns workers.
- **Data safety:** migrations forward-only; migration runner refuses on drift; rollback = redeploy previous tag + `scripts/restore-db.sh` for data (documented in `DEPLOYMENT.md §14`).

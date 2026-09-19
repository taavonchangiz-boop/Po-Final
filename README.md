# Postyar (پُستیار)

**Postyar** is a Persian-language, multi-channel post publishing SaaS ("پُستیار" — literally *post assistant*). Tenants connect Telegram / Bale / Rubika channels and bots, then author, schedule, and automatically deliver posts; a no-code bot builder handles commands, keywords, and workflow auto-replies; optional modules add an AI caption writer, a gold/coin price ticker, and WooCommerce product publishing through the official WordPress connector. Subscriptions, a wallet, points, and referrals are built in; the entire product UI is Persian (RTL) — this repo's engineering docs are in English.

Independent SaaS rebuild from frozen read-only reference audits (`audits/`). Version **1.0.0**.

---

## Architecture summary

```
                       ┌────────────────────────────── cPanel host (shared) ─────────────────────────────┐
 Browser ──HTTPS──► public_html/  (Vite SPA build: index.html + assets — 0 Node processes)             │
     │                    │ .htaccess maps /api ──► Passenger ──► postelrobbal/api/app.js             │
     │                    │                                   └──► app/dist/server.js  (API ×1)       │
     └──Bot webhooks──────┘► /api/v1/webhooks/*            postelrobbal/workers/worker.js (Worker ×1)   │
                                                           postelrobbal/workers/scheduler.js (cron tick)│
                                                           postelrobbal/config/.env (chmod 600)         │
                                                           postelrobbal/private|storage|logs            │
                       └──────────────────────────────────────────────────────────────────────────────┘
                                        │                    │
                              MySQL 8 / MariaDB 10.6+   Redis 6+ (EXTERNAL — never installed on host)
                                        │
                        BullMQ queues: delivery · bot-events · ai-jobs · notifications · maintenance
```

- **API** — Fastify 5 + TypeScript (Node ≥22), modules under `app/src/modules/*`, all routes under `/api/v1`, cookie sessions + CSRF, unified Persian-safe error contract.
- **Worker** — single BullMQ worker set (delivery, bot events, AI jobs, notifications, maintenance), bounded concurrency.
- **Scheduler** — tick model: cron fires every minute, it acquires a Redis lock (`SET NX EX 55`), claims due work into queues, relays the transactional outbox, exits.
- **Frontend** — Vite + React 18 + TS SPA, Persian-only UI, static output served by the web server (no Node).
- **Transactional outbox + idempotency keys** for exactly-once publishing; provider adapters declare capabilities (never emulate unsupported features).

Details: [ARCHITECTURE.md](ARCHITECTURE.md) · decisions: [docs/adr/](docs/adr/) (ADR-0001…0012).

## Monorepo layout

| Path | What it is |
|---|---|
| `app/` | Fastify API + worker + scheduler (`src/` TS, `dist/` built JS). Entries: `server.ts`, `worker.ts`, `scheduler.ts` |
| `frontend/` | Vite React SPA (`src/`, built to `dist/`, Persian RTL) |
| `wordpress-plugin/postyar-connector/` | Official WP/WooCommerce connector plugin (see [WORDPRESS.md](WORDPRESS.md) for current status) |
| `database/migrations/` | Ordered MySQL migrations (`0001_init.sql`, `0002_seed.sql`), applied by the deterministic runner |
| `scripts/` | `deploy.sh` (idempotent prod deploy), `release-check.sh` (release gate), `make-release.sh` (zip + SHA256SUMS) |
| `docs/adr/` | 12 architecture decision records |
| `audits/` | Forensic audits of the reference systems (read-only research corpus) |
| `assets/brand/` | Vazirmatn fonts, PWA icons, logos (canonical brand kit) |

## Prerequisites

- **Node.js ≥ 22** (API/worker/scheduler) and **Bun** for installs/builds.
- **MySQL 8** or **MariaDB ≥ 10.6** (utf8mb4).
- **Redis 6+** — external service; never provisioned on the shared host.
- Production host: **cPanel + CloudLinux + Passenger** (Phusion Passenger maps `/api` to the Node entry).
- Provider/payment credentials: bot tokens per tenant, ZarinPal merchant, optional AI/SMS/SMTP keys.

## Local development quickstart

```bash
# 1. Environment
cd app && cp ../.env.example .env     # fill DATABASE_URL, REDIS_URL, secrets (32+/64-hex)
#    Local defaults: APP_URL=http://localhost:5173, API_URL=http://localhost:3000

# 2. Install + migrate
bun install
bun run migrate                      # applies database/migrations/*.sql exactly once

# 3. Run the four processes (separate terminals)
bun run dev                          # API          → http://localhost:3000
bun run worker                       # BullMQ workers
node dist/scheduler.js               # one scheduler tick (run via cron every minute)
cd ../frontend && bun install && bun run dev   # SPA → http://localhost:5173
```

Ports: API `3000` (`PORT`), frontend dev `5173`. The scheduler is a **tick** binary, not a daemon — in dev, loop it manually or via `watch`.

## Build & test

```bash
cd app        && bun run typecheck && bun run build   # tsc --noEmit, then dist/
cd frontend   && bun run build                        # tsc --noEmit && vite build → dist/
cd app        && bun test                             # vitest run (DB-free unit tests)
```

CI (`.github/workflows/ci.yml`) runs typechecks, frontend build, unit tests, a security scan, and `php -l` over the WP plugin. Deployment is **manual**, never from CI.

## Deployment

Production deploys use `scripts/deploy.sh` on the cPanel host (preflight → artifacts → migrations → Passenger restart → health). Packaging (`scripts/make-release.sh`) produces `postyar-production-final.zip` + `SHA256SUMS`. Full runbook: **[DEPLOYMENT.md](DEPLOYMENT.md)**; day-2 ops: **[OPERATIONS.md](OPERATIONS.md)**; diagnostics: **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**.

## Security notes

Argon2id passwords, DB-backed sessions (ADR-0006), CSRF double-submit, AES-256-GCM secret encryption, SSRF-guarded outbound fetch, per-route rate limits, tenant isolation on every table. See **[SECURITY.md](SECURITY.md)** — including the secrets policy (never commit `.env`; rotate via the runbook) and the incident/contact section.

## API & WordPress

- **[API.md](API.md)** — every implemented route (paths, methods, auth, payloads, errors, pagination).
- **[WORDPRESS.md](WORDPRESS.md)** — connector protocol, security model, and plugin status.
- **[DATABASE.md](DATABASE.md)** — full table catalog (41 tables) and migration workflow.

## License

Proprietary — all rights reserved. Not open source; distribution outside the operating company is not permitted.

# Postyar — Deployment (cPanel / CloudLinux / Passenger)

Production target is a **shared cPanel host** with CloudLinux and Phusion Passenger. The layout (ADR-0010) keeps all code, config, and private data **outside** the web root.

## 1. Directory layout (§55)

```
/home/account/
├── postelrobbal/                  PRIVATE application root (never web-served)
│   ├── app/                       backend build output (dist/) + node_modules + package.json
│   ├── api/                       Passenger entry (app.js) + tmp/restart.txt
│   ├── config/                    .env (chmod 600) + api.port
│   ├── workers/                   worker.js, scheduler.js shims (cron-launched)
│   ├── database/migrations/       shipped migration SQL (applied by deploy)
│   ├── private/                   private uploads root
│   ├── storage/                   runtime media storage (STORAGE_DIR)
│   └── logs/                      worker.log, scheduler.log, cron output
└── public_html/                   PUBLIC web root
    ├── index.html assets/         built SPA (rsync from frontend/dist)
    ├── images/ fonts/ icons/      brand assets
    ├── .postyar-deployed          deploy marker (guards rsync --delete)
    └── api/                       .htaccess rewrite → Passenger (AppBase mapping)
```

Rule: **nothing sensitive under `public_html/`** — no `.env`, no app code, no logs, no DB files, no uploads.

## 2. Passenger entry setup

1. cPanel → *Setup Node.js App*: Application root `postelrobbal/api`, Application URL `api` (or mapped via `.htaccess` rewrite from `/api`), startup file `app.js`.
2. `scripts/deploy.sh` (re)writes `postelrobbal/api/app.js` — a tiny CommonJS shim that requires `../app/dist/server.js`; the Fastify server binds `0.0.0.0:$PORT` where **Passenger provides `PORT`**.
3. Restart = touch `postelrobbal/api/tmp/restart.txt` (deploy.sh does this; `passenger restart-app` when the CLI exists). There is **no** `systemctl`/PM2 on shared hosts.
4. Node version: select **22+** in the cPanel Node.js App UI; `deploy.sh` enforces ≥22 as preflight.

## 3. Cron lines (worker + scheduler)

Workers are **not** started by deploy.sh (no duplication, §68). Install these in cPanel → *Cron Jobs*:

```cron
# Scheduler — tick model every minute; flock prevents overlap; Redis lock (SET NX EX 55) prevents double-tick across machines
* * * * * flock -n /tmp/postyar-scheduler.lock /usr/bin/node /home/account/postelrobbal/workers/scheduler.js >> /home/account/postelrobbal/logs/scheduler.log 2>&1

# Worker — single long-running instance; @reboot + flock guard against duplicates
@reboot flock -n /tmp/postyar-worker.lock /usr/bin/node /home/account/postelrobbal/workers/worker.js >> /home/account/postelrobbal/logs/worker.log 2>&1
```

- The scheduler **exits after each tick** (cron re-invokes it) and silently skips if another instance holds `SCHEDULER_LOCK_KEY` (`postyar:scheduler:lock`).
- Before adding the worker cron, verify none is already running: `pgrep -f "postyar-worker"` (deploy.sh performs this check and warns).
- CloudLinux: if `flock` is unavailable in the cage, use the Redis-lock property of the scheduler tick and a single `@reboot` worker line only.

## 4. Environment configuration

1. `cp .env.example postelrobbal/config/.env` then fill values (see the annotated template): `DATABASE_URL`, external `REDIS_URL`, `APP_URL` (SPA origin), `API_URL` (public API base — bot webhooks are registered as `${API_URL}/api/v1/webhooks/bots/:id?s=…`), `SESSION_SECRET` (≥32), `CSRF_SECRET` (≥32), `ENCRYPTION_KEY` (64 hex), `ALLOWED_ORIGINS` (comma list, credentials enabled).
2. `chmod 600 postelrobbal/config/.env`.
3. `DB_POOL_MAX=5` default; `WORKER_CONCURRENCY=3`, `AI_WORKER_CONCURRENCY=1` per the shared-host process budget (API 1 / Worker 1 / Scheduler 1 / Redis 0).
4. The app fails fast on invalid/missing config (`app/src/config/env.ts`, zod) — an incomplete `.env` means the API will not boot.

## 5. Migration policy

- `scripts/deploy.sh` prints **applied vs present** migrations, aborts on drift, then applies **existing** migration files exactly once via the deterministic runner (`app/src/db/migrate.js` → `runMigrations`). It never invents or reorders migrations (§66/§201).
- First deployment applies `0001_init.sql` + `0002_seed.sql` (schema + 5 plans + system settings) in order.
- Rollback of a migration is **not automated** — migrations are forward-only (§202). See §7.

## 6. Deploy procedure (idempotent)

```bash
# on the build box (CI or local):
scripts/release-check.sh          # gate: must pass (0 blockers)
scripts/make-release.sh           # → postyar-production-final.zip + SHA256SUMS
# upload + unzip on the host, then on the host:
scripts/deploy.sh                 # add --build only on a build machine, never on prod
```

`deploy.sh` steps (safe to re-run): preflight (node ≥22, dirs, env presence incl. 64-hex `ENCRYPTION_KEY`, MySQL/Redis pings via the app's node_modules) → artifacts (`app/dist`, `frontend/dist` must exist; missing = hard error instructing CI build) → prod deps install (`bun install --frozen-lockfile --production`, skipped when present) → migration status + apply → `rsync` SPA into `public_html` (**--delete guarded** by the `.postyar-deployed` marker) → backend dist into `postelrobbal/app` → write Passenger/worker shims → Passenger restart → health verification (5 tries × 3 s) → worker/scheduler duplication check. No Redis install, no test suite on prod.

## 7. Rollback

- **Code rollback**: keep the previous `postyar-production-final.zip`; unzip to a staging dir and re-run `scripts/deploy.sh` from that tree (or keep `postelrobbal/app/dist.<prev>` and swap). Passenger restart returns the old build instantly.
- **Migrations are never auto-reversed** (§202): a rollback re-deploys older *code* against the newer schema — releases are therefore required to be **expand/contract-compatible one release back** (additive columns/tables only, or tolerate-unknown-columns reads). If a migration must be undone, author a **new forward migration** `000N_revert_<topic>.sql`; manual `DROP`/`UPDATE` surgery on prod is prohibited.
- Data written by the new version (events, ledger rows) is preserved by this policy.

## 8. Health checks

| Endpoint | Meaning |
|---|---|
| `GET /health/live` | Process is up; no dependencies touched (liveness — Passenger/monitor target) |
| `GET /health/ready` | **Real checks**: MySQL `SELECT 1` + Redis `PING` → `{status:"ready",checks:{mysql,redis}}`; any failure → `degraded` with per-check detail |
| `GET /health/` | Service summary `{status:"ok",service:"postyar-api"}` |

`deploy.sh` curls both (5 retries × 3 s). Wire uptime monitoring to `/health/live` and alerting to `/health/ready`.

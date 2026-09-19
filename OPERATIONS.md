# Postyar — Operations runbook

Audience: the on-call operator of a Postyar production deployment (cPanel/Passenger). Persian product UI stays Persian; ops commands are shell.

## 1. Start / stop / status

| Component | Start | Stop | Status |
|---|---|---|---|
| API (Passenger) | touch `postelrobbal/api/tmp/restart.txt` (starts if configured) | cPanel Node.js App → *Stop App* | `curl -fsS $API_URL/health/live` |
| Worker | cron `@reboot flock -n /tmp/postyar-worker.lock node postelrobbal/workers/worker.js` | `pkill -f "postyar-worker"` (worker drains gracefully on SIGTERM) | `pgrep -af "postyar-worker"` |
| Scheduler | cron `* * * * * flock -n /tmp/postyar-scheduler.lock node postelrobbal/scheduler/scheduler.js` | remove the cron line | `tail postelrobbal/logs/scheduler.log` |
| MySQL / Redis | managed externally | — | `deploy.sh` preflight pings / `/health/ready` |

A full restart = Passenger `restart.txt` + worker `pkill` (cron `@reboot` brings it back, or start it manually with the exact cron command).

## 2. Health semantics

- `/health/live` — liveness only, no dependency calls. Use for uptime checks.
- `/health/ready` — **real** MySQL `SELECT 1` + Redis `PING`; returns `{status:"ready"|"degraded", checks:{mysql:{ok,detail},redis:{ok,detail}}}`. Alert on `degraded`; the `detail` field names the failing dependency (truncated to 120 chars).
- `GET /health/` — service banner (`postyar-api`).

## 3. Worker & scheduler ops

- **Worker** runs five BullMQ consumer sets in one process: delivery, bot-events, ai-jobs, notifications, maintenance — bounded by `WORKER_CONCURRENCY` (delivery) / `AI_WORKER_CONCURRENCY` (ai-jobs); bot-events=2, notifications/maintenance=2/1 internally. Shutdown is graceful (SIGTERM → drain → close Redis/MySQL → exit 0).
- **Scheduler** is a tick: acquire `SCHEDULER_LOCK_KEY` (`SET NX EX 55`) → relay outbox → claim due SCHEDULED posts/RETRYING targets (≤100 each) → run enabled gold configs past frequency → 7-day subscription expiry warnings → lapsed subscriptions → exit. If the lock is held it exits quietly (0). Duplicate ticks are therefore safe **and** duplicate workers are safe-by-lock — but keep one worker anyway (concurrency budget).
- Verify the tick is alive: `scheduler.log` should show `scheduler_tick_complete` each minute with `{relayed, scheduledPosts, retries, goldRuns, expiryChecks}`.

## 4. Queue inspection (BullMQ)

`redis-cli -u "$REDIS_URL"`:

```
QUEUES            # delivery, bot-events, ai-jobs, notifications, maintenance
LLEN  bull:delivery:wait            # pending jobs
LLEN  bull:delivery:active          # in-flight
ZCARD bull:delivery:delayed         # scheduled retries / delayed publishes
ZCARD bull:delivery:failed          # dead-lettered (retained 7 days)
HGETALL bull:delivery:<jobId>       # inspect one job (data, attempts, stacktrace)
```

Or from the app dir: `node -e 'import("file://"+process.cwd()+"/dist/queue/queues.js").then(async q=>{const qd=await q.getQueue("delivery").getJobCounts();console.log(qd);process.exit(0)})'` (add `"type":"module"`-safe wrapper as needed). Retention: completed 24 h, failed 7 days (bounded 5000 each) — stale failures auto-expire.

## 5. Migration ops

- Status: `postelrobbal/scripts/deploy.sh` prints applied vs present (read-only) before applying. Manual: `SELECT name, applied_at FROM schema_migrations ORDER BY name;`
- Apply pending: re-run `postelrobbal/scripts/deploy.sh` (or `cd postelrobbal/app && bun run migrate` in dev).
- **Drift** (DB knows a migration the release doesn't): the runner aborts. Resolution: ship the missing file in the release — never delete rows from `schema_migrations`.
- Migrations are forward-only; fixes are new migrations (DATABASE.md → workflow).

## 6. Logs & retention (§107)

| What | Where | Retention |
|---|---|---|
| API requests (pino JSON: method,url,status,durationMs,requestId) | Passenger/cPanel app stderr → cPanel logs | cPanel default rotation |
| Worker | `postelrobbal/logs/worker.log` | rotate weekly, keep 4 (`logrotate`/cron mv) |
| Scheduler ticks | `postelrobbal/logs/scheduler.log` | same; it's chatty (1 line/min) |
| cron stderr | appended on the cron lines (`2>&1`) | same |
| Audit trail (business/security) | `audit_logs` table — do not delete on a schedule | keep ≥ 1 year |
| Analytics events | `events` table — maintenance worker sweeps: events 180 d, link clicks 180 d, processed bot_events 90 d; expired media access tokens / idempotency keys / sessions swept per pass (batched 1000, capped iterations) |

Log level via `LOG_LEVEL` (`fatal|error|warn|info|debug`); production default `info`. pino redacts secret-bearing fields; never log raw provider responses.

## 7. Common incidents

| Symptom | First response |
|---|---|
| `/health/ready` degraded (mysql) | Check MySQL up + `DATABASE_URL`; pool exhaustion → raise `DB_POOL_MAX` only with host plan |
| `/health/ready` degraded (redis) | Redis external service down; publishing retries (delivery worker backoff, 3 attempts) — restore Redis, restart worker |
| Queue `failed` growing | `HGETALL` the job; usually provider 401 (bot token revoked) → tenant re-verifies bot |
| Nothing publishes, no failures | Scheduler dead (check cron/flock + `scheduler.log`) or outbox stuck → check `outbox_events WHERE state='PENDING'` |
| 429 spikes | Rate limits working; check source IP, consider bot webhook flood |
| Passenger 503 after deploy | Node version mismatch or `app.js` shim path wrong → cPanel app logs |

## 8. Escalation

1. On-call operator: run §7 first responses; capture `requestId` from error responses + `/health/ready` body.
2. Unresolvable in 30 min or data-affecting (payments/wallet/ledger): escalate to the platform engineer; freeze deploys (`deploy.sh` is safe to re-run but do not roll forward blind).
3. Security events (leaked key, webhook abuse): follow SECURITY.md §8/§9 — rotate secrets, then audit.
4. Vendor outages (Telegram/Bale/Rubika/ZarinPal/Redis host): these degrade gracefully — delivery retries with backoff; communicate status, don't restart components mid-outage.

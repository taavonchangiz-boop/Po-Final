# Postyar — Troubleshooting

Symptom → cause → fix. Commands assume the deployment layout in DEPLOYMENT.md (`postelrobbal/` private root, `API_URL` public base). Health first: `curl -fsS $API_URL/health/ready | jq` — the `checks` object names the failing dependency.

## 1. API startup failures

- **Symptom**: Passenger 502/503 immediately after deploy; cPanel app stderr shows `Invalid environment configuration: …`.
- **Cause**: `env.ts` (zod) fails fast — missing `DATABASE_URL`/`REDIS_URL`, `SESSION_SECRET`/`CSRF_SECRET` shorter than 32 chars, or `ENCRYPTION_KEY` not 64 hex.
- **Fix**: complete `postelrobbal/config/.env` from `postelrobbal/config/.env.example`, `chmod 600`, then `touch postelrobbal/api/tmp/restart.txt`. Re-run `postelrobbal/scripts/deploy.sh` — its preflight reproduces the same checks before touching Passenger.
- **Variant**: `Cannot find module '…/postelrobbal/app/dist/server.js'` → dist missing (deploy refuses this case; you deployed a source-only tree). Build in CI, re-deploy.

## 2. Database connection problems

- **Symptom**: `/health/ready` → `checks.mysql.ok=false`; API 500s on every route.
- **Cause**: MySQL down, wrong DSN, user lacks grants, or `max_connections` exhausted (pool × processes).
- **Fix**: `deploy.sh` preflight ping isolates DSN vs server. Check `mysql -e 'SHOW PROCESSLIST'` for saturation; keep `DB_POOL_MAX=5` (default) — only raise with the host plan. Wrong password after a host migration → update `.env`, restart Passenger.

## 3. Redis down

- **Symptom**: `/health/ready` → `checks.redis.ok=false`; publishing appears accepted but nothing moves; scheduler tick exits early.
- **Cause**: external Redis unreachable (`REDIS_URL`), eviction of BullMQ keys, or maxmemory pressure.
- **Fix**: restore the Redis service (it is external — never install on the shared host). In-flight posts are safe: state lives in MySQL (`post_targets RETRYING`) and the outbox re-queues on the next tick. Restart the worker after Redis returns.

## 4. Passenger issues

- **Symptom**: app runs via `node dist/server.js` but 502 through the web server; or old code keeps serving.
- **Cause**: Node.js App not registered (startup file must be `app.js` under `postelrobbal/api`), wrong Node version, or restart signal not applied.
- **Fix**: cPanel → Setup Node.js App → Application root `postelrobbal/api`, startup `app.js`, Node ≥22; `touch postelrobbal/api/tmp/restart.txt`; confirm `api/app.js` exists (deploy.sh writes it). Check cPanel stderr log for the actual boot error.

## 5. Worker / scheduler duplication

- **Symptom**: double messages, duplicate AI replies, or double gold posts.
- **Cause**: more than one worker process (cron `@reboot` added twice, or manual start + cron), or overlapping scheduler ticks.
- **Fix**: `pgrep -af "postyar-worker"` — kill extras (`pkill -f "postyar-worker"`, cron `@reboot` re-spawns the single guarded one). Scheduler is protected twice: `flock -n /tmp/postyar-scheduler.lock` + Redis lock `postyar:scheduler:lock` (`SET NX EX 55`); verify the cron line uses `flock`. Delivery itself is double-send-safe (atomic claim `UPDATE … WHERE state IN ('PENDING','RETRYING')` + `jobId` idempotency), but duplicates waste quota.

## 6. Migration problems

- **Symptom**: deploy fails with `Schema drift detected: applied migration(s) not present in release: …`.
- **Cause**: DB was migrated ahead of the release tree (hotfixed file, deleted migration).
- **Fix**: ship the missing SQL file in `postelrobbal/database/migrations/` — never delete rows from `schema_migrations`. 
- **Variant**: `Migration 000X failed: …` → the transaction rolled back; fix the SQL, re-deploy (runner resumes cleanly). A partially applied file cannot exist by construction.

## 7. CORS / auth-cookie issues

- **Symptom**: browser logs CORS errors, or requests return `AUTH_REQUIRED` despite being logged in.
- **Cause**: `APP_URL`/`ALLOWED_ORIGINS` mismatch (origin not in the allowlist, trailing slash, http vs https), or the SPA and API on different registrable domains so the `py_session` cookie (SameSite=Lax) isn't sent.
- **Fix**: set `ALLOWED_ORIGINS` to the exact SPA origin(s), keep `APP_URL` consistent; serve SPA and API from the same site (the cPanel layout does this by design). Mutating calls must also send `x-csrf-token` (from `GET /auth/me`) — `CSRF_INVALID` means the client skipped it.

## 8. Webhook issues (bots not receiving updates)

- **Symptom**: bot silent; `bots.webhook_registered_at` null/old; provider `getWebhookInfo` shows a conflict.
- **Cause**: `API_URL` wrong/not HTTPS, webhook secret mismatch (`?s=`), another polling instance holding `getUpdates` conflict, or bot disabled.
- **Fix**: re-enable the bot (`POST /bots/:id/enable` re-registers the webhook at `${API_URL}/api/v1/webhooks/bots/:id?s=…`); verify `API_URL` is the public HTTPS base; ensure only the worker polls (mode POLLING) or only the webhook (mode WEBHOOK). Events are deduped by `bot_events.dedup_hash` — replays are ignored, not lost.

## 9. Upload problems

- **Symptom**: `POST /api/v1/media` → `VALIDATION_ERROR` «حجم فایل بیش از حد مجاز است» or 413.
- **Cause**: >8 MB (service cap; 10 MB stream cap), or MIME not in the allowlist (jpeg/png/gif/webp) even with a matching extension — magic bytes are sniffed.
- **Fix**: compress/convert the file; re-upload. If previews 404, the 15-min signed token expired — request `GET /media/:id/token` again; raw delivery requires the token (`/media/raw/:id?token=`).

## 10. Stuck queue jobs

- **Symptom**: post `PUBLISHING`/target `PROCESSING` for minutes; `bull:delivery` active count stuck.
- **Cause**: worker killed mid-job (claim row stays PROCESSING until retry logic picks it up), provider hang, or Redis lost the job.
- **Fix**: inspect `SELECT * FROM post_targets WHERE state='PROCESSING'` and BullMQ failed set (`ZCARD bull:delivery:failed`). Restart the worker (graceful drain). Failed targets move to `RETRYING` with `next_retry_at` (3 attempts, exponential 5 s backoff); beyond that they are `FAILED` and per-target retry is available via `POST /posts/targets/:targetId/retry` or the UI. Never hand-edit `state` — use the retry endpoint.

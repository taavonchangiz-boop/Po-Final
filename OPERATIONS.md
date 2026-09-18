# Postyar — Operations Runbook — v1.0.0

راهنمای عملیات روزمره روی هاست cPanel/CloudLinux (توپولوژی و چیدمان: `DEPLOYMENT.md`). مسیرهای نمونه با `PY=/home/account/postelrobbal` نوشته شده‌اند.

## 1. Start / Stop / Status

### API (Passenger)
```bash
# Start/restart نرم (روش استاندارد):
touch $PY/app/tmp/restart.txt
# جایگزین best-effort:
passenger-config restart-app $PY/app 2>/dev/null || true
# وضعیت:
curl -s http://127.0.0.1:${PORT:-3001}/health          # خلاصه + نسخه‌ها
cPanel → Setup Node.js App → ستون Status (Running/Stopped)
```
- Stop واقعی فقط از پنل (Stop App) — روی Passenger ممنوع به kill دستی.
- فرآیند فقط یکی است (Passengerfile: max_processes 1) — اگر بیش از یکی دیدید: TROUBLESHOOTING §4.

### Worker (BullMQ consumer — یک نمونه)
```bash
pgrep -af "node dist/workers/worker.js"          # status
cd $PY/app && set -a; . .env; set +a
nohup node dist/workers/worker.js >> $PY/logs/worker.log 2>&1 & disown   # start
kill <PID>                                        # stop (SIGTERM → drain تمیز، exit 0)
```
- worker روی SIGTERM درflightها را تمام می‌کند، صف‌ها/Redis/MySQL را می‌بندد (worker.ts shutdown).
- **بعد از هر deploy** دستی restart شود؛ `deploy.sh` عمداً spawn نمی‌کند (§69).

### Scheduler
```bash
pgrep -af "node dist/workers/scheduler.js"        # status
kill <PID>                                        # stop
# start = خودکار توسط cron+flock تا ۶۰ ثانیه بعد؛ یا دستی:
cd $PY/app && set -a; . .env; set +a
flock -n /tmp/postyar-scheduler.lock node dist/workers/scheduler.js >> $PY/logs/scheduler.log 2>&1 &
```
- Cron ثبت‌شده: `* * * * * /usr/bin/flock -n /tmp/postyar-scheduler.lock node $PY/app/dist/workers/scheduler.js` (DEPLOYMENT.md §11) — lock-and-exit + قفل Redis داخلی `lock:scheduler` (SET NX EX 120).

## 2. Health checks / بررسی سلامت

| Endpoint | معنا | انتظار |
|---|---|---|
| `/health/live` | فرآیند زنده (بدون وابستگی) | `200 {"ok":true}` |
| `/health/ready` | MySQL `SELECT 1` + Redis `PING` با timeout 2s | `200` یا **503 صادقانه** |
| `/health` | خلاصه + نسخه‌ها | 200 |

```bash
curl -s https://example.com/health/ready ; echo
```
503 ⇒ TROUBLESHOOTING §2/§3. health در deploy.sh تا ۳۰ ثانیه poll می‌شود.

## 3. Queue inspection (BullMQ/Redis) / بررسی صف

```bash
redis-cli -u "$REDIS_URL" ping                      # PONG?
redis-cli -u "$REDIS_URL" llen  bull:deliveries:wait        # صف منتظر
redis-cli -u "$REDIS_URL" llen  bull:deliveries:active      # در حال اجرا
redis-cli -u "$REDIS_URL" llen  bull:deliveries:delayed     # retry scheduled (backoff 60s/5m/30m/2h/6h)
redis-cli -u "$REDIS_URL" zcard bull:deliveries:failed      # fail نهایی
redis-cli -u "$REDIS_URL" lrange bull:deliveries:failed 0 4 # نمونه jobهای failed
redis-cli -u "$REDIS_URL" keys  'bull:*:wait' | wc -l       # صف‌های موجود
```
نکات:
- صف‌ها: `deliveries` (cc3), `ai-jobs` (2), `wp-sync` (1), `notifications` (2), `maintenance` (1).
- اگر `wait` بالا ماند و worker نیست ⇒ worker مرده — بخش 1.
- jobهای retryable در `delayed` هستند (طبیعی)؛ `failed` یعنی سقف تلاش پر شد → از UI دکمه retry (`POST /deliveries/:id/retry`).
- جدول `outbox_events` (PENDING) مکمل صف است: worker آن را pump می‌کند؛ اگر Redis قطع بوده، ردیف‌ها +60s دوباره تلاش می‌شوند — هیچ رویدادی گم نمی‌شود.

## 4. Migration operations

```bash
cd $PY/app && set -a; . .env; set +a
node dist/db/migrate.js          # وضعیت + اعمال pending (idempotent؛ drift ⇒ stop)
```
- خروجی «up to date (N migration(s) applied)» = سالم.
- خطای drift ⇒ دست نزنید؛ DATABASE.md §4 (سیاست). rollback migration وجود ندارد (forward-only).

## 5. Logs & rotation / لاگ‌ها و چرخش

| چه | کجا |
|---|---|
| API (Passenger stdout/stderr) | cPanel → Errors، یا `~/logs/` (pino JSON با requestId) |
| worker | `$PY/logs/worker.log` |
| scheduler | `$PY/logs/scheduler.log` |
| backup | `$PY/logs/backup.log` |
| Apache/PHP | cPanel → Metrics → Errors |

چرخش: `logrotate` در دسترس نیست معمولاً ⇒ خط cron هفتگی:
```
0 3 * * 0 for f in /home/account/postelrobbal/logs/*.log; do [ -f "$f" ] && gzip -f "$f.$(date +\%F)" 2>/dev/null; find /home/account/postelrobbal/logs -name '*.log.*' -mtime +28 -delete; done
# ساده‌تر: truncate ماهانه  find $PY/logs -name '*.log' -size +50M -exec truncate -s 0 {} \;
```
(اگر worker/scheduler طولانی‌مدت به فایل لاگ append می‌کنند، بعد از هر rotate آن‌ها را restart کنید.)

## 6. Common incidents / رخدادهای رایج

| رخداد | اقدام فوری |
|---|---|
| `/health/ready` = 503 (DB) | MySQL/کاربر/سقف اتصال → TROUBLESHOOTING §2 |
| `/health/ready` = 503 (Redis) | addon Redis → TROUBLESHOOTING §3؛ نگران از دست رفتن event نباشید (outbox requeue) |
| «پست منتشر نشد» | UI → delivery state؛ `bull:deliveries:*`؛ کلاس خطا (auth/permanent → مشکل توکن، transient → retry خودکار) |
| worker دوبل | همه PIDs را kill، یکی nohup؛ پیشگیری: pgrep قبل از start |
| scheduler دوبل | cron/flock بررسی؛ `flock -n` نبودن خط؟ اصلاح؛ قفل Redis خودکار بعد از 120s آزاد می‌شود |
| پرداخت verify نشد | callback idempotent است؛ لاگ `payments`؛ gateway status؛ هرگز دستی VERIFIED نکنید |
| بات پاسخ نمی‌دهد | بات webhook یا polling؛ `bot_events` آخرین update؛ verify توکن |
| دیسک پر | `$PY/storage` (رسانه) و `$PY/logs`؛ سپس backup retention |

## 7. Deploy & rollback / استقرار و بازگشت

- استقرار همیشه با `scripts/deploy.sh` (idempotent: preflight → deps → build-if-needed → migrate → restart → health). جزئیات و rollback (تگ قبلی + سیاست forward-only migration + restore دیتا): `DEPLOYMENT.md §14`.

## 8. Daily/weekly checklist / چک‌لیست

- روزانه: `/health/ready` 200؛ `bull:deliveries:failed` رشد نکرده؛ backup جدید در `$PY/backups` (14d retention).
- هفتگی: حجم `$PY/logs` و `$PY/storage`؛ audit-logs پنل ادمین؛ نسخه پلن‌ها/سقف‌ها.

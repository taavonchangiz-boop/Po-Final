# Postyar — Troubleshooting — v1.0.0

فهرست عیب‌یابی الزامی master prompt §204. قالب هر مورد: **نشانه / علت / رفع**. لاگ‌ها: `OPERATIONS.md §5`. مسیر نمونه: `PY=/home/account/postelrobbal`.

## 1. API startup failure / شکست راه‌اندازی API

- **نشانه:** Passenger صفحه 500؛ لاگ: `Invalid environment configuration` یا `Missing mandatory environment variables for production` یا `server_listen_failed`.
- **علت:** `env.ts` در production سخت‌گیر است: `REDIS_URL`, `SESSION_SECRET` (≥32), `CSRF_SECRET` (≥32), `ENCRYPTION_KEY` (32 یا 64hex) اجباری‌اند؛ `DATABASE_URL` نامعتبر؛ PORT اشتباه/اشغال.
- **رفع:** متغیرها را هم در `$PY/app/.env` و هم در cPanel → Setup Node.js App → Environment variables ست کنید (Passenger فقط process env را می‌بیند)؛ restart.txt؛ اگر «address in use» → یک اپ Node دوم روی همان پورت است.

## 2. Database connection problems / خطای اتصال دیتابیس

- **نشانه:** `/health/ready` = 503؛ لاگ: `ER_ACCESS_DENIED_ERROR`, `ECONNREFUSED`, `ER_BAD_DB_ERROR`؛ migration fail.
- **علت:** `DATABASE_URL` غلط (user/pass/db/host)؛ کاربر cPanel به DB وصل نشده (Add User To Database)؛ سقف max_connections پر (اتصال لوکی)؛ MySQL service down.
- **رفع:** `mysql -u user -p -h 127.0.0.1 db -e 'SELECT 1'` از SSH؛ بازسازی URL به شکل `mysql://user:pass@127.0.0.1:3306/db`؛ در cPanel «MySQL Databases» نقش کاربر را بازبین کنید؛ پکیج اپ حداکثر 5 اتصال (pool) دارد — worker و API جدا هستند ولی رشد غیرعادی = نشتی اتصال → restart API.

## 3. Redis unavailable / Redis در دسترس نیست

- **نشانه:** boot در production fail (`REDIS_URL` الزامی)؛ یا API بالا آمده ولی `/health/ready` 503؛ worker در wait-loop 30s؛ scheduler tick را skip می‌کند (بدون crash).
- **علت:** addon Redis هاست خاموش/پورت اشتباه؛ `REDIS_URL` غلط؛ سقف حافظه Redis (eviction)؛ نیاز به AUTH/ACL.
- **رفع:** `redis-cli -u "$REDIS_URL" ping`؛ از پنل Redis را enable کنید؛ برای AUTH فرمت `redis://:password@host:6379`؛ data-loss نیست: outbox ردیف‌های PENDING را +60s دوباره pump می‌کند و صف‌ها durable هستند.

## 4. Passenger issues / مشکلات Passenger

- **نشانه:** صفحه 503/«application could not be started»؛ تغییر کد اعمال نمی‌شود؛ چند فرآیند node دیده می‌شود.
- **علت:** startup file غلط (باید `dist/server.js` باشد نه `src/server.ts`)؛ `NODE_ENV` production ست نشده؛ app root اشتباه؛ بعد از `npm ci` که node_modules جابه‌جا شده restart نشده؛ PassengerBasePath ناهماهنگ با Application URL.
- **رفع:** cPanel → Setup Node.js App → مقدارها را با DEPLOYMENT.md §4 تطبیق دهید؛ `touch $PY/app/tmp/restart.txt`؛ لاگ `~/logs/`؛ سپس `curl 127.0.0.1:PORT/health/live` از SSH. بیش از یک فرآیند = تنظیم min/max_instances در Passengerfile + restart؛ اگر ادامه داشت، پنل را Stop/Start کنید.

## 5. Worker duplication / تکرار worker

- **نشانه:** هر delivery دوبار ارسال/لاگ می‌شود؛ `pgrep -af worker.js` چند PID.
- **علت:** start دستی چندباره (nohup بدون pgrep)؛ worker داخل container/terminal دیگری زنده مانده.
- **رفع:** همه را `kill` (SIGTERM) کنید، تا خروج تمیز صبر کنید، فقط یک نمونه nohup کنید؛ پیشگیری: همیشه `pgrep -f "node dist/workers/worker.js"` قبل از start (DEPLOYMENT.md §11). خود BullMQ با CAS delivery (`UPDATE ... WHERE state IN (PENDING,RETRYING)`) دوباره‌ارسال را مهار می‌کند ولی نرخ مصرف دوبل می‌شود.

## 6. Scheduler duplication / تکرار scheduler

- **نشانه:** tickها دوبار در لاگ (دو PID)، یا هیچ tickی اجرا نمی‌شود.
- **علت:** دو خط cron؛ `flock` نصب نیست/مسیر `/usr/bin/flock` متفاوت؛ قفل Redis `lock:scheduler` از crash قبلی مانده (تا ۱۲۰ ثانیه آزاد نمی‌شود).
- **رفع:** فقط یک خط cron با مسیر کامل (DEPLOYMENT.md §11)؛ `which flock`؛ لاگ را ببینید — اگر «lock held» زیاد است و هیچ tickی هم نیست، قفل را بررسی کنید: `redis-cli -u "$REDIS_URL" ttl lock:scheduler` (طبیعی ≤120s) و یک PID اضافه را kill کنید.

## 7. Migration problems / مشکلات migration

- **نشانه:** `deploy.sh` با rc=3؛ پیام `Migration drift detected: applied migration(s) missing from disk`؛ یا خطای SQL در میانه migration (rollback خودکار).
- **علت:** فایل SQL حذف/تغییرنام‌شده بعد از apply؛ `database/` کنار `app/` نیست (مسیر `../../../database/migrations` حل نمی‌شود)؛ SQL دستی روی DB زده شده؛ نسخه DB جلوتر از کد.
- **رفع:** drift ⇒ فایل‌های غایب را از همان تگ بازگردانید — runner می‌ایستد، حدس نمی‌زند؛ هرگز `__postyar_migrations` را دستی ویرایش نکنید (فقط با بازبینی انسانی)؛ چیدمان پوشه را با DEPLOYMENT.md §1 تطبیق دهید؛ سیاست forward-only: اصلاح = migration جدید (DATABASE.md §3-4).

## 8. CORS / auth-cookie problems / کوکی و CORS

- **نشانه:** فرانت 401 می‌گیرد در حالی که کوکی هست؛ یا «blocked by CORS policy»؛ یا بعد از login صفحه رفرش می‌شود و لاگین می‌پرد.
- **علت:** `APP_URL` با آدرس واقعی مرورگر فرق دارد (CORS سفیدلیست دقیق است: `origin: [env.APP_URL]`)؛ `Secure` کوکی روی HTTP (نه HTTPS) ⇒ کوکی ست نمی‌شود؛ cross-site بدون SameSite=Lax سازگاری؛ `/api` پروکسی نشده (توپولوژی B بدون htaccess).
- **رفع:** همیشه HTTPS؛ `APP_URL` دقیقاً `https://example.com` (بدون slash انتهایی)؛ در htaccess پراکسی `/api` و `/health` را کامل کنید (DEPLOYMENT.md §12)؛ کوکی‌ها `py_session` (HttpOnly) و `py_csrf` هستند — در DevTools بررسی کنید که روی همان دامنه ست شده‌اند.

## 9. Webhook issues / مشکلات وب‌هوک

- **نشانه:** بات به پیام‌ها واکنش نمی‌دهد؛ لاگ API، درخواست webhook را نشان نمی‌دهد؛ یا 401/403 برمی‌گردد.
- **علت:** secret هدر ناجور (`X-Telegram-Bot-Api-Secret-Token`)؛ Bale که secret_token را verify نمی‌کند و هدر `X-Postyar-Secret` لازم دارد؛ `setWebhook` به URL اشتباه (باید `https://…/api/v1/webhooks/telegram/:botId`)؛ HTTPS سلف‌ساین؛ بدنه >256KB (وردپرس)؛ امضای HMAC منقضی (>5min) یا secret روتیت شده.
- **رفع:** توکن/بوت را از UI verify کنید (`POST /bots/:id/verify`)؛ webhook URL و secret را دوباره ست کنید؛ برای وردپرس، rotate-secret پس از تغییر باید در پلاگین هم به‌روز شود؛ dedupe طبیعی است — update تکراری پردازش نمی‌شود.

## 10. Upload problems / مشکلات آپلود

- **نشانه:** آپلود خطای فارسی «فایل مجاز نیست/حجم زیاد»؛ یا آپلود می‌شود ولی نمایش نمی‌خورد.
- **علت:** فقط `image/*` و ≤10MB پذیرفته می‌شود (magic-byte واقعی چک می‌شود — فایل تغییرنام‌داده رد می‌شود)؛ `STORAGE_DIR` ننوشته/غیرقابل نوشتن (`$PY/storage`)؛ سقف storage پلن پر؛ استریم خصوصی فقط برای مالک/ادمین است (401 طبیعی است).
- **رفع:** `$PY/storage` را chmod 755/مالک درست؛ در `.env` مقدار `STORAGE_DIR=../storage` نسبت به app؛ برای انتشار، رسانه PUBLIC باشد (PRIVATE فقط متن ارسال می‌شود — قاعده v1).

## 11. Stuck queue jobs / کارهای گیر کرده در صف

- **نشانه:** post در PUBLISHING می‌ماند؛ `bull:deliveries:active` همیشه پر؛ یا `wait` رشد می‌کند و هیچ مصرفی نیست.
- **علت:** worker مرده/دوبل؛ Redis قطع بوده؛ delivery در PROCESSING مانده از crash (claim CAS رها نشده تا restart بعدی)؛ error کلاس permanent تلاش‌ها را تمام کرده (FAILED واقعی، نه stuck).
- **رفع:** OPERATIONS.md §3 (inspect)؛ worker را healthy کنید؛ برای deliveryهای FAILED از UI retry (`POST /deliveries/:id/retry`)؛ اگر PROCESSING یتیم دیدید و worker restart شد، تلاش بعدی CAS آن را بازمی‌گیرد؛ outbox را ببینید: `SELECT state,count(*) FROM outbox_events GROUP BY state` (PENDING زیاد = pump کار نمی‌کند ⇒ worker).

# Postyar — Deployment Guide (cPanel / CloudLinux / Passenger) — v1.0.0

راهنمای استقرار پُست‌یار روی هاست اشتراکی cPanel/CloudLinux. این سند عملیاتی و گام‌به‌گام است؛ تصمیم‌های معماری در `docs/ARCHITECTURE.md` (ADR-001…ADR-014) و مرز قرارداد API در `docs/contracts/api-contract.md` ثبت شده‌اند.

> **قواعد طلایی (از master prompt):** Redis هرگز توسط اپلیکیشن نصب/راه‌اندازی نمی‌شود (سرویس ارائه‌شده هاست). دیتابیس هرگز recreate نمی‌شود — فقط migration رو به جلو. لاود-تست روی هاست اشتراکی ممنوع است. در deployment هرگز test suite کامل اجرا نمی‌شود و worker/scheduler تکراری spawn نمی‌شود.

---

## 0. Two supported topologies / دو توپولوژی پشتیبانی‌شده

| | A — دامنه واحد (توصیه‌شده) | B — زیردامنه جدا |
|---|---|---|
| SPA (Vite static) | `example.com` → `public_html` | `app.example.com` → `public_html` |
| API (Passenger) | همان دامنه، مسیر `/api` مونتاژ Passenger + پراکسی `/health` | `api.example.com` → Passenger ریشه |
| Cookie / CORS | Same-origin؛ بدون CORS؛ کوکی ساده | Same-origin با پراکسی؛ `APP_URL=https://app.example.com` |
| کدام را انتخاب کنیم؟ | ساده‌ترین حالت؛ کوکی `py_session` بدون دردسر | جدا کردن ترافیک API/استاتیک، وقتی پنل اجازه مونتاژ sub-URI نمی‌دهد |

در هر دو توپولوژی فقط **یک** فرآیند Passenger برای API داریم (ADR-005). توپولوژی B با پراکسی `/api` و `/health` از vhost اپ به `127.0.0.1:PORT` پیاده می‌شود تا کوکی همان‌مبدأ بماند و CORS لازم نشود (`app/src/app/buildApp.ts` در production فقط `env.APP_URL` را به‌عنوان origin می‌پذیرد — مقدار `APP_URL` باید دقیقاً آدرس عمومی SPA باشد).

---

## 1. Final on-disk layout / چیدمان نهایی دیسک

```
/home/account/
├── postelrobbal/                      ← ریشه خصوصی (خارج از web root؛ از وب مستقیم سرو نمی‌شود)
│   ├── app/                           ← repo backend (app/) + Passenger app root
│   │   ├── .env                       ← فقط اینجا؛ chmod 600 (بند 5)
│   │   ├── Passengerfile.js           ← startup_file dist/server.js، environment production
│   │   ├── dist/                      ← خروجی tsc: server.js، workers/، db/، ...
│   │   ├── node_modules/
│   │   ├── tmp/restart.txt            ← restart نرم Passenger (بند 9)
│   │   └── package.json
│   ├── api/                           ← (اختیاری) نکات/اسکریپت‌های خاص vhost API
│   ├── config/                        ← (اختیاری) تنظیمات جانبی هاست؛ اپ env را از process.env می‌خواند
│   ├── database/
│   │   └── migrations/*.sql           ← فایل‌های SQL درizzle-kit — باید همین‌جا باشد (migrate.js با ../../../ حل می‌شود)
│   ├── workers/                       ← یادداشت‌های عملیاتی worker (خود کد در app/dist/workers)
│   ├── scheduler/                     ← یادداشت‌های عملیاتی scheduler (خود کد در app/dist/workers)
│   ├── private/                       ← فایل‌های خصوصی (key اضافه، backup دستی موقت)
│   ├── storage/                       ← رسانه‌های کاربران (STORAGE_DIR پیش‌فرض ../storage نسبت به app)
│   ├── logs/                          ← لاگ worker/scheduler (stdout/nohup) — بند 11
│   ├── backups/                       ← خروجی scripts/backup-db.sh (نگهداری ۱۴ روز)
│   └── scripts/                       ← deploy.sh، backup-db.sh، restore-db.sh، release-check.sh
└── public_html/                       ← document root عمومی (فایل استاتیک SPA)
    ├── index.html                     ← خروجی frontend/dist
    ├── assets/                        ← chunks JS/CSS (هش‌دار)
    ├── fonts/  icons/  images/        ← Vazirmatn، آیکون‌ها، لوگوها (از frontend/dist کپی می‌شوند)
    ├── manifest.webmanifest
    └── .htaccess                      ← SPA fallback + پراکسی (بند 8)
```

نکته‌ی مسیر migration: `app/dist/db/migrate.js` مسیر `../../../database/migrations/` را نسبت به خودش حل می‌کند → از `postelrobbal/database/migrations` می‌خواند. بنابراین پوشه `database/` **باید** کنار `app/` بماند.

---

## 2. Prerequisites / پیش‌نیازها

- cPanel با CloudLinux + **Setup Node.js App** (Node selector) + Passenger فعال.
- Node.js **22.x** (پروژه `engines: node >=22` دارد — نسخه‌های پایین‌تر بوت نمی‌شود).
- MySQL/MariaDB با charset `utf8mb4`.
- **Redis addon** هاست (CloudLinux/cPanel Redis یا سرویس مدیریت‌شده) — نصب Redis روی میزبان توسط ما ممنوع است (ADR-004).
- دسترسی SSH (برای npm/migration/worker/cron).
- فضای کافی برای `node_modules` هر دو پروژه (~400MB).

## 3. Get the code / دریافت کد

```bash
mkdir -p /home/account/postelrobbal && cd /home/account/postelrobbal
# روش ۱ — git (توصیه‌شده؛ تگ نسخه را checkout کنید نه شاخه):
git clone <REPO_URL> repo && cd repo && git checkout v1.0.0
# سپس پوشه‌های موردنیاز را به چیدمان بالا می‌بریم (symlink یا کپی):
ln -s /home/account/postelrobbal/repo/app      /home/account/postelrobbal/app
ln -s /home/account/postelrobbal/repo/database /home/account/postelrobbal/database
ln -s /home/account/postelrobbal/repo/scripts  /home/account/postelrobbal/scripts
# روش ۲ — آپلود zip: آپلود postyar-production-final.zip در file manager، اکسترکت در postelrobbal/
```

اگر symlink در هاست شما کار نمی‌کند، محتوای `repo/app` و `repo/database` و `repo/scripts` را مستقیم داخل `postelrobbal/{app,database,scripts}` کپی کنید (rsync بدون `--delete` برای حفظ `.env`):

```bash
rsync -a repo/app/  /home/account/postelrobbal/app/
rsync -a repo/database/ /home/account/postelrobbal/database/
rsync -a repo/scripts/  /home/account/postelrobbal/scripts/
```

## 4. Node 22 via CloudLinux selector / ساخت اپ Node در cPanel

1. cPanel → **Setup Node.js App** → **Create Application**.
2. مقادیر (توپولوژی A):
   - Node.js version: **22.x**
   - Application mode: **Production**
   - Application root: `/home/account/postelrobbal/app`
   - Application URL: همان دامنه + **`/api`** (مونتاژ sub-URI — روت‌های API خودشان زیر `/api/v1` ثبت شده‌اند پس مسیر کامل به Fastify می‌رسد)
   - Application startup file: **`dist/server.js`**
3. دکمه **Run NPM Install** را اجرا نکنید (بند 6)؛ ابتدا `.env` را بسازید.
4. Environment variables: همان کلیدهای `app/.env` را در UI هم ثبت کنید (Passenger متغیرها را به فرآیند تزریق می‌کند؛ `env.ts` فقط `process.env` می‌خواند). حداقل: `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `CSRF_SECRET`, `ENCRYPTION_KEY`, `APP_URL`.
5. پس از Create، بلوک تولیدشده در `.htaccess`/vhost شامل پورت داخلی است؛ آن پورت را برای پراکسی `/health` (بند 8) یادداشت کنید. راه‌های یافتن پورت: بخش «Enter into the virtual environment» در UI، فایل‌های `~/nodevenv/...`، یا `ss -tlnp | grep node`.

(توپولوژی B: همین اپ را روی زیردامنه `api.example.com` با Application URL = `/` بسازید؛ startup file همان `dist/server.js`.)

## 5. `.env` placement / قرار دادن فایل محیطی

```bash
cd /home/account/postelrobbal/app
cp ../repo/.env.example .env        # اگر symlink است؛ وگرنه از repo کپی کنید
# مقادیر را ویرایش کنید (بخش پایین) سپس:
chmod 600 .env                      # فقط خواندنی برای مالک — اجباری
```

مقادیر production که حتماً باید set باشند (`env.ts` در production بدون آن‌ها crash می‌کند):

```bash
# تولید اسرار (روی همان سرور):
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # CSRF_SECRET (متفاوت)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # ENCRYPTION_KEY
```

- `DATABASE_URL=mysql://postyar_user:STRONGPASS@127.0.0.1:3306/postyar_db`
- `REDIS_URL=redis://127.0.0.1:6379` (یا unix socket اگر هاست می‌دهد)
- `APP_URL=https://example.com` — دقیقاً آدرس عمومی SPA (CORS + لینک رسانه)
- `ENCRYPTION_KEY` دقیقاً ۳۲ کاراکتر یا ۶۴ hex؛ **پس از اولین ذخیره‌ی توکن بات/کانال هرگز تغییرش ندهید** (داده با AES-256-GCM با همین کلید رمز شده — ADR-010).
- توضیح تک‌تک متغیرها: `.env.example` ریشه (کامنت فارسی دارد).

## 6. Install dependencies & build / نصب و ساخت

```bash
cd /home/account/postelrobbal/app
npm ci                       # از package-lock.json (نسخه‌ها قفل‌شده)
npm run build                # tsc → dist/ (شامل dist/server.js, dist/workers/*, dist/db/migrate.js)

cd /home/account/postelrobbal/repo/frontend   # (در کپی: /home/account/postelrobbal/frontend)
npm ci
npm run build                # tsc --noEmit && vite build → dist/
```

انتشار SPA به public_html:

```bash
rm -rf /home/account/public_html/assets      # خروجی قبلی (هش‌دار) را پاک کنید
cp -r /home/account/postelrobbal/repo/frontend/dist/* /home/account/public_html/
# نتیجه: public_html/{index.html,assets,fonts,icons,images,manifest.webmanifest}
```

## 7. MySQL database & user / ساخت دیتابیس و کاربر

1. cPanel → **MySQL® Databases** → Create New Database: `account_postyar` (نام کامل با پیشوند اکانت).
2. Create New User: `account_postyar` + رمز قوی → **Add User To Database** با **ALL PRIVILEGES**.
3. Charset: جداول از migration با `utf8mb4` ساخته می‌شوند؛ connection هم `charset=utf8mb4` (`db/client.ts`, `migrate.ts`).
4. `DATABASE_URL` را در `.env` (و UI متغیرهای محیطی) با همین کاربر/دیتابیس پر کنید. Host همیشه `127.0.0.1` یا `localhost` (Socket داخلی).

## 8. Migrations / اجرای migration

فایل‌های SQL درizzle در `database/migrations/*.sql` هستند و runner آن‌ها را مرتب‌سازی‌شده و در transaction اعمال می‌کند و در جدول `__postyar_migrations` ثبت می‌کند (drift → توقف؛ بند rollback).

```bash
cd /home/account/postelrobbal/app
set -a; source .env; set +a          # DATABASE_URL را به محیط بدهد
node dist/db/migrate.js              # همان npm run db:migrate ولی روی build
npm run db:seed                      # فقط بار اول: پلن‌ها + تنظیمات (idempotent — هیچ‌چیز را overwrite نمی‌کند)
```

## 9. Passenger startup & restart / راه‌اندازی و ری‌استارت

- Startup file = **`app/dist/server.js`** (در Passengerfile.js ثبت است؛ در UI سلکتور هم همین). `app.js` شیم لازم نیست — توضیح در کامنت Passengerfile.
- Passengerfile.js (کنار `app/package.json`): `passenger_app_type node`, `startup_file dist/server.js`, `environment production`, `min_instances 1`, `max_processes 1`, `max_requests 1000`.

```js
// نمونه کامل — app/Passengerfile.js (موجود در repo؛ این فقط نمایش)
module.exports = {
  passenger_app_type: 'node',
  startup_file: 'dist/server.js',
  environment: 'production',
  min_instances: 1,
  max_processes: 1,
  max_requests: 1000,
};
```

Restart نرم (بدون قطع سرویس):

```bash
mkdir -p /home/account/postelrobbal/app/tmp
touch /home/account/postelrobbal/app/tmp/restart.txt    # روش استاندارد Passenger
# best-effort جایگزین روی سرورهایی که passenger-config دارند:
passenger-config restart-app /home/account/postelrobbal/app 2>/dev/null || true
```

`scripts/deploy.sh` همین کار را خودکار انجام می‌دهد.

## 10. Redis addon / تنظیم Redis

- Redis از پنل هاست (cPanel Redis/CloudLinux addon) فعال می‌شود — **نصب دستی ممنوع**.
- `REDIS_URL=redis://127.0.0.1:6379` (یا پورت/سوکت داده‌شده توسط هاست).
- تست: `redis-cli -u "$REDIS_URL" ping` → `PONG`.
- در production نبود Redis ⇒ بوت API fail می‌شود (`env.ts` الزامی می‌کند) و scheduler هم tick را skip می‌کند (رفتار محافظه‌کارانه — بدون دوباره‌کاری). worker در wait-loop ۳۰ ثانیه‌ای می‌ماند (بدون crash-loop).

## 11. Worker & scheduler (بدون systemd) / فرآیندهای پس‌زمینه

**Worker** (مصرف‌کننده BullMQ؛ یک نمونه — هرگز دوبل نشود):

```bash
cd /home/account/postelrobbal/app
set -a; source .env; set +a
pgrep -f "node dist/workers/worker.js" >/dev/null && echo "worker already running" || \
  nohup node dist/workers/worker.js >> /home/account/postelrobbal/logs/worker.log 2>&1 &
disown
```

- بعد از هر deploy باید worker را دستی restart کنید (kill PID قدیمی → nohup بالا). `deploy.sh` عمداً worker را spawn نمی‌کند (قاعده master prompt §69).
- Worker رفتار fail-safe دارد: Redis قطع ⇒ wait-loop ۳۰ ثانیه؛ outbox هم صف را requeue می‌کند (+60s) پس هیچ رویدادی گم نمی‌شود.

**Scheduler** (lock-and-exit tick — قرارداد §126-127): هر دقیقه یک cron؛ `flock -n` تضمین می‌کند بیش از یک نمونه وجود نداشته باشد. نمونه‌ی فعلی حلقه‌ی ۶۰ ثانیه‌ای با قفل Redis است؛ cron+flock نقش سرپرست (supervisor) را دارد: اگر فرآیند مرد، دقیقه‌ی بعد دوباره بالا می‌آید؛ تا وقتی زنده است، cronهای بعدی به‌خاطر نبودِ قفل بلافاصله خارج می‌شوند. قفل داخلی Redis (`lock:scheduler`, SET NX EX 120) لایه‌ی دوم دفاع است.

خط cron (cPanel → Cron Jobs → Add New Cron Job، زمان‌بندی `* * * * *`):

```
* * * * * /usr/bin/flock -n /tmp/postyar-scheduler.lock node /home/account/postelrobbal/app/dist/workers/scheduler.js >> /home/account/postelrobbal/logs/scheduler.log 2>&1
```

> اگر env در cron ارث نمی‌رسد، قبل از node سورس کنید:
> `* * * * * /usr/bin/flock -n /tmp/postyar-scheduler.lock bash -c 'set -a; . /home/account/postelrobbal/app/.env; set +a; exec node /home/account/postelrobbal/app/dist/workers/scheduler.js' >> /home/account/postelrobbal/logs/scheduler.log 2>&1`

**Backup روزانه** (اختیاری ولی توصیه‌شده):

```
30 2 * * * /bin/bash /home/account/postelrobbal/scripts/backup-db.sh >> /home/account/postelrobbal/logs/backup.log 2>&1
```

## 12. Apache `.htaccess` — SPA fallback + proxy / توپولوژی A

`/home/account/public_html/.htaccess`:

```apache
# --- Postyar SPA + API proxy (Topology A) -------------------------------
RewriteEngine On

# 1) /health و زیرمسیرها → Passenger (پورت داخلی Node selector؛ بند 4)
#    <PORT> را با پورت واقعی اپ جایگزین کنید.
RewriteRule ^health(/.*)?$ http://127.0.0.1:<PORT>/health$1 [P,L]
RewriteRule ^health$ http://127.0.0.1:<PORT>/health [P,L]

# 2) /api به‌صورت خودکار توسط بلوک Setup Node.js App مونتاژ می‌شود
#    (PassengerBasePath "/api" + PassengerAppRoot ".../postelrobbal/app").
#    اگر پنل بلوک را ننوشته، معادل دستی:
#    RewriteRule ^api(/.*)?$ http://127.0.0.1:<PORT>/api$1 [P,L]

# 3) SPA fallback — هر مسیر که فایل/پوشه واقعی نیست → index.html
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]
RewriteRule ^ index.html [L]

# 4) کش استاتیک هش‌دار + بدون کش index
<IfModule mod_headers.c>
  <FilesMatch "\.(js|css|woff2|png|webp|svg)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  <Files "index.html">
    Header set Cache-Control "no-cache"
  </Files>
</IfModule>

# 5) ایمن‌سازی: فایل‌های حساس هرگز سرو نشوند
<FilesMatch "^\.env|^Passengerfile\.js$">
  Require all denied
</FilesMatch>
Options -Indexes
```

**توپولوژی B** — `api.example.com`: سلکتور کل زیردامنه را به Passenger می‌دهد (Application URL = `/`)، نیازی به htaccess نیست. `app.example.com` (document root همان `public_html`): بلاک ۱ و ۲ بالا را با پورت همان اپ API اضافه کنید + بلاک ۳ (SPA fallback) + این خط در `.env` حتماً: `APP_URL=https://app.example.com`.

> اگر پرچم `[P]` در .htaccess مجاز نباشد (mod_proxy در .htaccess بسته است)، توپولوژی A را با «Application URL = /api» در سلکتور پیش ببرید (پنل خودش پراکسی را می‌سازد) و فقط `/health` را از پشتیبانی هاست بخواهید یا health را از مسیر داخلی سرور چک کنید (`curl 127.0.0.1:PORT/health/ready`).

## 13. First boot & verification / اولین راه‌اندازی و صحت‌سنجی

```bash
curl -s https://example.com/health/live          # {"ok":true}
curl -s https://example.com/health/ready         # MySQL+Redis واقعی چک می‌شود
curl -s https://example.com/api/v1/plans         # لیست پلن‌ها (بعد از seed)
# ثبت اولین کاربر → نقش SUPER_ADMIN (mutex دیتابیسی ADR-007):
curl -s -X POST https://example.com/api/v1/auth/register -H 'Content-Type: application/json' -d '{...}'
```

اسکریپت `scripts/deploy.sh` همه‌ی این‌ها را یک‌جا و idempotent انجام می‌دهد (preflight → deps → build-if-needed → migrate → restart → health loop تا ۳۰ ثانیه).

## 14. Rollback / بازگشت به نسخه قبل

1. **کد:** تگ قبلی را checkout کنید و `deploy.sh` را دوباره اجرا کنید:
   ```bash
   cd /home/account/postelrobbal/repo && git fetch --tags && git checkout v0.9.0
   rsync -a repo/app/ /home/account/postelrobbal/app/   # بدون --delete
   bash /home/account/postelrobbal/scripts/deploy.sh
   ```
2. **Config:** `.env` قبلی را از `postelrobbal/private/` بازگردانید (نسخه‌ی قبلی را قبل از هر تغییر آنجا کپی کنید)؛ ری‌استارت Passenger.
3. **Migration — سیاست forward-only:** فایل migration اعمال‌شده هرگز ویرایش/حذف نمی‌شود؛ اصلاح همیشه migration جدید رو به جلو است. `migrate.js` اگر migration ثبت‌شده در DB از دیسک غایب باشد **متوقف** می‌شود (drift → stop، نه حدس).
4. **بازگشت دیتا (آخرین چاره):** فقط `scripts/restore-db.sh` با dump مربوطه — این «data rollback» است نه migration rollback؛ جدول `__postyar_migrations` داخل dump است پس سازگاری نسخه حفظ می‌شود.destructive migration خودکار برگردانده نمی‌شود (master prompt §202) — استراتژی امن آن: restore هماهنگ با checkout کدِ همان دوره.
5. **SPA:** قبل از deploy جدید، از `public_html` بکاپ بگیرید (`cp -r public_html private/public_html.$(date +%F)`).

---

**جمع‌بندی ترتیب کامل:** clone/rsync → Node 22 app در پنل → `.env` (chmod 600) → MySQL db+user → `npm ci` (app+frontend) → build هر دو → کپی dist به public_html → htaccess → `node dist/db/migrate.js` + seed → Redis addon فعال → restart.txt → worker nohup → scheduler cron → health 200.

# Release Notes — Postyar v1.0.0

**تاریخ/Date:** release packaging of the v1.0.0 tree · **VERSION:** 1.0.0

پُستیار v1.0.0 — اولین انتشار کامل پلتفرم. این یادداشت فقط قابلیت‌های واقعاً تحویل‌شده و محدودیت‌های واقعی را ثبت می‌کند (master prompt §208-210 — هیچ موفقیت ساختگی گزارش نمی‌شود).

## Delivered capabilities / قابلیت‌های تحویل‌شده

### Platform & backend
- هسته‌ی Fastify 5 (TypeScript strict، Node 22): env اعتبارسنجی‌شده با zod و fail-fast در production، لاگ pino با requestId و redaction، envelope و error codes پایدار، graceful shutdown کامل (API/worker/scheduler) — `app/src/{config,core,app}`.
- دیتابیس: Drizzle + MySQL، اسکیمای متعارف **۳۷ جدول**، migration runner تراکنشی با ledger (`__postyar_migrations`) و **refuse-on-drift**، seed idempotent پلن‌ها/تنظیمات — `app/src/db`, `database/migrations`.
- امنیت: Argon2id، session اپاک HttpOnly (هش SHA-256 در DB، چرخش/ابطال)، CSRF double-submit، rate limit per-route، گارد SSRF خروجی (`isPrivateIp`+DNS)، AES-256-GCM برای اسرار، mutex دیتابیسی first-admin، idempotency keys — `app/src/security`, `app/src/core`؛ تست‌های واحد 9/9.
- صف و زمان‌بندی: BullMQ روی Redis (deliveries/ai-jobs/wp-sync/notifications/maintenance) + outbox تراکنشی با requeue در قطعی Redis؛ scheduler ۶۰ثانیه‌ای با قفل Redis SETNX و tickهای مجزا (schedules، gold، expiry-7d، daily-stats، bot polling، retention).

### Domain modules
- Providers: Telegram/Bale (Bot-API مشترک) و Rubika (capability deltas + polling) با error classification و backoff نمایی 60s/5m/30m/2h/6h.
- Auth/Users/Channels/Publishing/Schedules/Bots/Workflows/AI/Gold/WooCommerce/Billing/Payments/Wallet/Referrals/Notifications/Analytics/Media/Support/Admin — مطابق قرارداد `docs/contracts/api-contract.md` (سقف پلن‌ها، IDOR-safe، verify زنده، retry/CAS، درگاه پرداخت با verify idempotent، لینک کوتاه `/r/:code` امن).
- Retention محدودشده (events/deliveries/logs) با gate ساعتی.

### Frontend
- SPA کامل (۴۷ فایل): RTL، Vazirmatn رسمی، اعداد فارسی و تاریخ Jalali با یک کرنل واحد (`frontend/src/lib/format.ts` — ۱۷/۱۷ تست مستقل)، دیزاین‌سیستم ۱۷ کامپوننتی، ۲۳ صفحه/ویژگی، auth واقعی متصل به API، PWA manifest، کد-اسپلیت با manualChunks (build موفق: ۲۸KB CSS، vendor 144KB).

### WordPress connector (design + API side)
- سمت SaaS کامل: جفت‌سازی سایت (publicId+secret یک‌بارنمایش، rotate، revoke)، sync صف‌شده، وب‌هوک امضادار HMAC با tolerance و سقف بدنه، `wp_products`/`wp_events`. بسته‌ی پلاگین PHP: `wordpress-plugin/postyar-connector/` + سند `WORDPRESS.md`.

### Assets, docs, ops
- ۲۸ asset رسمی (فونت/آیکون/لوگو) بایت‌به‌بایت از منبع، در دو مقصد با checksum یکسان — `audits/assets/ASSET-AUDIT.md`.
- فرانشکافی مرجع: `audits/asovin` (۱۴۵ فایل) و `audits/woo-hooman-channel-manager` (۱۸ فایل) — مبنای تصمیم‌های بازسازی.
- مستندات: README، ARCHITECTURE (۱۴ ADR)، PRODUCT-SPEC، قرارداد API، DATABASE، SECURITY (۲۱ تهدید §38)، DEPLOYMENT (cPanel/CloudLinux/Passenger، دو توپولوژی)، OPERATIONS، TROUBLESHOOTING (§204)، WORDPRESS، RELEASE-NOTES، CHANGELOG، `.env.example` bilingual.
- عملیات: `deploy.sh` (idempotent، بدون نصب Redis/بدون تست/بدون spawn)، `release-check.sh` (§136)، `backup-db.sh`/`restore-db.sh` (نگهداری ۱۴روز)، `Passengerfile.js`، cron scheduler با flock، CI گیت‌هاب اکشنز (backend/frontend/plugin/release-check).

## Known limitations / محدودیت‌های شناخته‌شده

1. **اعتبارنامه ارائه‌دهنده‌ها لازم است:** ارسال زنده به تلگرام/بله/روبیکا، ارسال ایمیل/پیامک و درگاه پرداخت واقعی، به کلید/توکن واقعی نیاز دارد؛ مرزها و پیکربندی کامل مستندند و بدون credential موفقیت انتها-به-انتها **ادعا نمی‌شود** (§210).
2. **کلیدهای درگاه پرداخت:** verify سمت-به-سمت پیاده شده ولی تست زنده فقط با درگاه Mock انجام شده است.
3. **Load testing انجام نشد** — روی هاست اشتراکی طبق قرارداد ممنوع است؛ عملکرد با pagination/سقف همزمانی/فهرست‌های indexدار مهار می‌شود.
4. **Rubika edit/delete:** ارائه‌دهنده پشتیبانی API ویرایش/حذف پیام را نمی‌دهد — در capability registry صادقانه غیرفعال و در UI از کار افتاده است.
5. Bale هم secret_token وب‌هوک را verify نمی‌کند ⇒ پُستیار روی مسیر bale هدر `X-Postyar-Secret` را اجباری می‌کند (سند در WORDPRESS/README پرووایدرها).
6. تغییر ایمیل/موبایل در v1 عمداً غیرفعال است (فیلدهای پروفایل محدود — تصمیم محصول).

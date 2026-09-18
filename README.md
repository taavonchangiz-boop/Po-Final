# پُستیار (Postyar) — SaaS انتشار چند-کاناله

<div dir="rtl">

## معرفی

پُستیار یک پلتفرم SaaS فارسی‌اول برای مدیریت انتشار محتوا روی **تلگرام، بله و روبیکا** است: یک بار بساز → مقصدها را انتخاب کن → الان یا زمان‌بندی‌شده منتشر کن → همه‌چیز را رصد کن. به‌همراه ربات‌های گفتگویی، اتوماسیون (workflow)، دستیار هوش مصنوعی، انتشار خودکار قیمت طلا، اتصال ووکامرس، اشتراک/کیف‌پول/معرفی، اعلان‌ها و گزارش‌ها.

**معماری در یک خط:** SPA ایستا (Vite+React+TS) روی `public_html` → API تک‌فرآیندی Fastify روی Passenger → MySQL (Drizzle) + Redis (BullMQ) → Worker + Scheduler جدا، همه با session-cookie امن، رمزنگاری AES-256-GCM اسرار، و outbox تراکنشی.

## ویژگی‌ها (خلاصه v1.0.0)

- کانال‌ها و ربات‌ها با توکن رمزشده + verify زنده + سقف پلن
- انتشار: پیش‌نویس/رسانه/مقصرا → outbox → صف → وضعیت per-channel با retry نمایی
- زمان‌بندی Jalali با تکرار و مکث/لغو؛ اجرای idempotent با قفل Redis
- ربات: فرمان، پاسخ‌گوی کلیدواژه، workflow (trigger+steps)، رویدادها، پولینگ روبیکا
- AI چند-ارائه‌دهنده (OpenAI/Gemini/DeepSeek/Claude/OpenRouter/Mistral/Custom) با صف و سهمیه
- طلا: قیمت → تشخیص تغییر → انتشار قالب‌بندی‌شده فارسی
- ووکامرس: جفت‌سازی HMAC، sync محصول، انتشار خودکار، رهگیری کلیک
- صورت‌حساب: ۵ پلن، درگاه (Zarinpal/IDPay/Zibal/Mock)، verify تراکنشی idempotent
- کیف‌پول دفترکل‌دار (BIGINT ریال، `balance_after`)، پاداش معرفی، اعلان انقضای ۷روزه (دقیقاً یک‌بار)
- تحلیل‌ها: رویداد append-only + read model روزانه؛ پشتیبانی (تیکت)؛ مدیریت کامل ادمین

## معماری (خلاصه)

```
Browser (public_html, SPA) ──HTTPS /api/v1 (session+CSRF)──▶ Fastify API (Passenger, 1 proc)
                                                              │ outbox → BullMQ
                                    ┌─────────────────────────┴───────────────┐
                              Worker (queues)                          Scheduler (tick + Redis lock)
                                                              │
                       Providers: Telegram / Bale / Rubika / Payments / AI / SMS/Email
```
جزئیات و ADRها: `docs/ARCHITECTURE.md` · قرارداد API: `docs/contracts/api-contract.md`

## پیش‌نیازها

- Node.js **22+**، npm 10 (یا bun 1.3+)، MySQL/MariaDB (utf8mb4)، Redis
- فرانت: هیچ سرویس Node‌ای در production لازم نیست (خروجی Vite استاتیک است)

## اجرای محلی

```bash
# ۱) بک‌اند (app/)
cd app
npm install            # یا bun install (bun.lock موجود است)
cp ../.env.example .env && chmod 600 .env    # در dev اسرار اجباری نیستند (ephemeral + هشدار)
npm run db:migrate     # اعمال database/migrations/*.sql
npm run db:seed        # پلن‌ها + تنظیمات (idempotent)
npm run dev            # tsx watch → http://localhost:3001

# ۲) فرانت‌اند (frontend/)
cd ../frontend
npm install
npm run dev            # vite → http://localhost:5173 (پروکسی /api و /health → :3001)
```
اولین ثبت‌نام = SUPER_ADMIN. متغیرهای محیطی: `.env.example` (کامنت فارسی دارد).

## تست

```bash
cd app && npm test          # vitest — تست‌های واحد هسته (بدون DB/Redis)
npm run typecheck           # هر دو پروژه: tsc --noEmit
bash tests/api-smoke.sh     # دود انتها-به-انتها (اگر سرور dev روشن نباشد gracefully skip)
```
چک‌لیست دستی قرارداد: `tests/smoke-contract.md` · قاعده: production هرگز test suite کامل را اجرا نمی‌کند.

## دیپلوی (خلاصه)

`scripts/deploy.sh` = preflight → npm ci (در صورت stale) → build در صورت نیاز → migrate → restart Passenger → سلامت تا ۳۰ثانیه. راهنمای کامل cPanel/CloudLinux/Passenger، دو توپولوژی دامنه، cron scheduler و rollback: **`DEPLOYMENT.md`**. عملیات روزانه: `OPERATIONS.md`.

## ساختار پوشه‌ها

```
app/                 بک‌اند Fastify (config, core, db, security, modules/*, providers/*, queue, workers)
frontend/            SPA (React 18 + Vite 6 + TS + Tailwind 4، RTL/Vazirmatn/Jalali)
wordpress-plugin/    پلاگین Postyar Connector (وردپرس/ووکامرس)
database/migrations/ migrationهای SQL (drizzle-kit)
docs/                ARCHITECTURE، PRODUCT-SPEC، RELEASE-NOTES، CHANGELOG، contracts/api-contract
audits/              فرانشکافی کد مرجع (asovin، woo-hooman-channel-manager، assets)
scripts/             deploy.sh، release-check.sh، backup-db.sh، restore-db.sh
tests/               دود API + چک‌لیست دستی
.github/workflows/   CI (typecheck/test/build/release-check)
```

## امنیت

مدل کامل تهدید/mitigation/محل پیاده‌سازی: **`SECURITY.md`** — Argon2id، session اپاک HttpOnly، CSRF double-submit، rate limit، گارد SSRF، رمزنگاری اسرار AES-256-GCM، وب‌هوک امضادار، جداسازی tenant. اسرار فقط در `app/.env` (chmod 600، خارج از git).

## مستندات دیگر

`DATABASE.md` (اسکیمای ۳۷ جدول + migration) · `API.md` (رندر قرارداد) · `WORDPRESS.md` · `TROUBLESHOOTING.md` · `docs/RELEASE-NOTES.md` · `docs/CHANGELOG.md`

</div>

---

## English summary

**Postyar** is a Persian-first SaaS for multi-channel publishing (Telegram / Bale / Rubika) plus bots, workflows, AI assistance, gold-rate publishing, WooCommerce integration, subscriptions/wallet/referrals, notifications and analytics.

- **Stack:** Vite+React18+TS SPA (static, served from `public_html`) · Fastify 5 + TypeScript strict API (single Passenger process, Node 22) · MySQL + Drizzle (37 tables, forward-only SQL migrations) · Redis + BullMQ (outbox pattern) · separate Worker and lock-guarded Scheduler.
- **Local run:** `app/` → `npm install && cp ../.env.example .env && npm run db:migrate && npm run db:seed && npm run dev` (:3001) · `frontend/` → `npm install && npm run dev` (:5173, proxies /api + /health).
- **Deployment:** idempotent `scripts/deploy.sh`; full cPanel/CloudLinux/Passenger guide (both domain topologies, cron scheduler, rollback) in `DEPLOYMENT.md`.
- **Docs:** ARCHITECTURE (ADRs), PRODUCT-SPEC, API contract, DATABASE, SECURITY (threat model), OPERATIONS, TROUBLESHOOTING, WORDPRESS, RELEASE-NOTES.
- **Secrets:** only in `app/.env` (chmod 600, git-ignored); `ENCRYPTION_KEY` protects bot/channel/WordPress tokens at rest (AES-256-GCM).

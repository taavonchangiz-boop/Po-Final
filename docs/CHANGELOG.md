# Changelog

All notable changes to Postyar are documented here. Format: Keep a Changelog; versioning: SemVer.

## [1.0.0] — Initial release

### Added
- **Backend:** Fastify 5 API (Node 22, TS strict) — zod env fail-fast، pino logging با redaction، envelope/codes پایدار، health سه‌سطحی (`/health/live`, `/health/ready`, `/health`)، graceful shutdown.
- **Database:** MySQL + Drizzle — ۳۷ جدول متعارف، migration runner تراکنشی با `__postyar_migrations` و drift-stop، seed idempotent.
- **Security:** Argon2id، session اپاک HttpOnly + چرخش/ابطال، CSRF double-submit، rate limiting، SSRF guard خروجی، AES-256-GCM اسرار در rest، first-admin mutex، idempotency keys، وب‌هوک‌های امضادار (Telegram/Bale/X-Postyar-Secret/WordPress HMAC).
- **Queues:** BullMQ (۵ صف) + transactional outbox با requeue؛ Worker و Scheduler (tick 60s، قفل Redis SETNX، retention ساعتی).
- **Modules:** auth، users، channels، publishing (outbox/deliveries/retry/schedules)، bots (+polling روبیکا)، workflows، AI چند-ارائه‌دهنده با سهمیه، gold، wordpress، subscriptions/payments/wallet/referrals، notifications (+expiry-7d یکتا)، analytics (events + daily read model)، media (magic-byte، استریم مجوزدار)، support، admin (audit).
- **Providers:** telegram/bale (Bot-API)، rubika (polling، capability deltas)، payments (Zarinpal/IDPay/Zibal/Mock)، sms/email adapters (بدون جعل موفقیت).
- **Frontend:** SPA فارسی/RTL (React 18 + Vite 6 + Tailwind 4) — کرنل یکپارچه ارقام/تاریخ/پول/برچسب‌ها، دیزاین‌سیستم، ۲۳ صفحه، auth واقعی، PWA، کد-اسپلیت.
- **WordPress:** طراحی Connector (HMAC pairing، sync، auto-publish، diagnostics) + سمت SaaS کامل.
- **Ops & docs:** deploy.sh idempotent، release-check.sh، backup/restore-db.sh (۱۴روز)، Passengerfile.js، htaccess/Passenger راهنما، cron scheduler+flock، CI (backend/frontend/plugin/release-check)، ۱۰ سند الزامی §138 + RELEASE-NOTES + CHANGELOG + .env.example.
- **Assets:** ۲۸ فایل برند رسمی (بایت‌به‌بایت) + ASSET-AUDIT؛ audits کامل asovin و woo-hooman-channel-manager.

### Known limitations
- ارسال زنده به ارائه‌دهنده‌ها/درگاه واقعی نیازمند credentials است (بدون credential موفقیت ادعا نمی‌شود)؛ load test انجام نشد (ممنوعیت هاست اشتراکی)؛ Rubika edit/delete پشتیبانی نمی‌شود (محدودیت ارائه‌دهنده)؛ تغییر ایمیل/موبایل در v1 غیرفعال.

## [Unreleased]
- (هیچ — نگهداری از اینجا)

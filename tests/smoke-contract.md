# چک‌لیست دود قرارداد API — Postyar v1.0.0 (tests/smoke-contract.md)

بررسی دستی انتها-به-انتها روی یک نمونه‌ی در حال اجرا (dev یا staging). خودکار معادل: `tests/api-smoke.sh` (فقط سلامت + ثبت‌نام→ورود→me). این چک‌لیست مکمل انسانی همان قرارداد است: `docs/contracts/api-contract.md`. علامت‌گذاری: ☐ باز / ☑ سالم / ☒ خراب (با توضیح).

> محیط: `BASE_URL` (مثلاً http://localhost:3001 یا https://example.com). ابزار: curl/Postman + مرورگر با DevTools (کوکی‌ها). قبل از شروع: `npm run db:migrate && npm run db:seed` انجام شده باشد.

## ۰) سلامت و پوشش عمومی
- ☐ `GET /health/live` → 200 `{"ok":true}` (بدون وابستگی)
- ☐ `GET /health/ready` → 200 (MySQL+Redis واقعاً چک شده‌اند)؛ با خاموش‌کردن Redis تستی → 503 صادقانه
- ☐ `GET /health` → 200 با نسخه‌ها
- ☐ بدنه‌ی خطا همیشه envelope است: `{"success":false,"error":{code,message(فارسی),requestId}}`
- ☐ پاسخ خطا هیچ stack/پیام داخلی/secret ندارد

## ۱) احراز هویت (public)
- ☐ `POST /auth/register` با همه‌ی فیلدهای قرارداد → 201؛ اگر اولین کاربر است نقش SUPER_ADMIN، در غیر این صورت USER (تست race: دو ثبت‌نام همزمان → دقیقاً یکی ادمین)
- ☐ اعتبارسنجی: موبایل بد (`123`) رد می‌شود؛ رمز <8 رد؛ تکرار رمز ناهمسان رد؛ acceptedTerms غیر از true رد (schema strict است — فیلد اضافه هم رد می‌شود)؛ کد دعوت نامعتبر → خطای امن فارسی
- ☐ `POST /auth/login` → کوکی `py_session` HttpOnly + `py_csrf` ست می‌شود؛ رمز غلط → پیام generic «اطلاعات ورود نادرست است.»
- ☐ بدون نشست: `GET /me` → 401 UNAUTHENTICATED
- ☐ `GET /me` با نشست → کاربر + پلن + تعداد اعلان خوانده‌نشده
- ☐ `POST /auth/password-reset` → پاسخ generic حتی برای ایمیل ناموجود؛ توکن ۳۰ دقیقه تک‌مصرف؛ confirm → همه‌ی نشست‌ها باطل
- ☐ `POST /auth/change-password` → نشست‌های دیگر باطل می‌شوند
- ☐ `POST /auth/logout` → ابطال سروری؛ کوکی دیگر کار نمی‌کند

## ۲) CSRF و rate limit
- ☐ هر non-GET بدون هدر `X-CSRF-Token` (با کوکی نشست معتبر) → رد (403)؛ با مقدار غلط → رد؛ با مقدار `py_csrf` → قبول
- ☐ ۶ ورود غلط پیاپی → 429 RATE_LIMITED

## ۳) کانال‌ها
- ☐ `POST /channels` توکن رمزشده ذخیره می‌شود؛ پاسخ توکن ندارد (فقط `hasToken:true`)
- ☐ توکن تکراری همان chatId → 409 CONFLICT با پیام فارسی
- ☐ `POST /channels/:id/verify` با توکن واقعی → ACTIVE؛ با توکن باطل → ERROR (بدون لو دادن خطای خام provider)
- ☐ سقف پلن: ساخت کانال بیش از حد پلن → PLAN_LIMIT
- ☐ دسترسی کانال کاربر دیگر با id → 404/403 (IDOR-safe)

## ۴) انتشار و تحویل
- ☐ `POST /posts` بدون schedule → deliveries ساخته‌شده در همان تراکنش + صف؛ وضعیت PENDING→PROCESSING→SENT در UI
- ☐ `POST /posts` با scheduleAt آینده → SCHEDULED + ردیف schedule
- ☐ `GET /posts/:id` وضعیت per-channel؛ `GET /deliveries?postId=` حالت/تلاش/خطای امن
- ☐ retry خطای Transient → backoff 60s→5m→30m→2h→6h؛ کلاس auth/permanent → بدون retry
- ☐ `POST /posts/:id/publish-now` دوبار پشت‌سرهم → enqueue دوم اثر ندارد (idempotent `publish:{postId}`)
- ☐ `DELETE /posts/:id` → CANCELLED و deliveries آویزان CANCELLED
- ☐ انتشار به کانال کاربر دیگر → رد (ملکیت)

## ۵) زمان‌بندی
- ☐ `GET /schedules` فقط مال خودم؛ `PATCH /schedules/:id` (مکث/ادامه/زمان جدید — ورودی ISO UTC)؛ `DELETE`
- ☐ با ورود موعد (صبر تا tick بعدی) → اجرای دقیقاً یک‌باره (چند tick پشت‌سرهم → بدون دوباره‌انتشار)

## ۶) ربات‌ها و workflow
- ☐ `POST /bots` → getMe واقعی؛ توکن باطل → خطای امن؛ سقف پلن
- ☐ `POST /webhooks/telegram/:botId` بدون secret → رد؛ با secret درست → dedupe (ارسال update تکراری → یک پردازش)
- ☐ پاسخ‌گوی کلیدواژه/فرمان از وب‌هوک واقعی؛ رویدادها در `GET /bots/:id/events`
- ☐ workflow با step غیرمجاز capability → رد اعتبارسنجی سمت سرور؛ اجرا در `runs`
- ☐ بات روبیکا: polling فعال، edit/delete در UI از کار افتاده (capability registry)

## ۷) AI
- ☐ `POST /ai/jobs` → 202 QUEUED؛ بدون کلید (tenant و سرور) → خطای امن (نه جعل موفقیت)
- ☐ سهمیه‌ی ماهانه پلن → PLAN_LIMIT پس از سقف
- ☐ `GET /ai/jobs/:id` poll تا COMPLETED/FAILED؛ `GET /ai/usage` صحیح

## ۸) طلا
- ☐ `POST /gold/prices` → ثبت؛ `POST /gold/publish` دوبار در یک روز بدون تغییر → بار دوم idempotent رد می‌شود
- ☐ قالب انتشار: اعداد فارسی، جداکننده، تاریخ Jalali

## ۹) ووکامرس
- ☐ `POST /wordpress/sites` → secret فقط یک‌بار در پاسخ؛ در پاسخ‌های بعدی نیست
- ☐ وب‌هوک با `X-Postyar-Signature` غلط → رد؛ امضای درست ولی timestamp >5min → رد؛ بدنه >256KB → رد
- ☐ `POST .../sync` → صف؛ محصولات در `GET .../products`؛ rotate-secret → درخواست‌های امضای قدیمی رد

## ۱۰) صورت‌حساب/کیف‌پول/معرفی
- ☐ `GET /plans` پنج پلن فارسی با قیمت ریال
- ☐ `POST /payments` (provider=MOCK در dev) → redirectUrl؛ callback → VERIFIED تراکنشی؛ callback تکراری → idempotent (بدون دوبار شارژ)
- ☐ کیف‌پول: تراکنش‌های همزمان → ledger بدون ناسازگاری، `balance_after` پیوسته (BIGINT ریال)
- ☐ پاداش معرفی فقط روی اولین پرداخت verify شده‌ی معرفی‌شده (دوبار → یک بار)
- ☐ اعلان انقضای ۷روزه: فقط یک‌بار برای اشتراک (کلید `expiry-7d:{id}`)

## ۱۱) اعلان/تحلیل/رسانه/پشتیبانی/ادمین
- ☐ `GET /notifications` + read/read-all؛ unread count در /me کم می‌شود
- ☐ `GET /analytics/overview|publishing` اعداد معقول؛ timeline با cursor
- ☐ `POST /media` فایل <10MB تصویر → OK؛ mime جعلی (txt با پسوند png) → رد magic-byte؛ استریم خصوصی برای دیگران → 401/403
- ☐ تیکت: create→reply دوطرفه؛ ادمین پاسخ staff
- ☐ ادمین: `GET /admin/users` هرگز هش رمز برنمی‌گرداند؛ تغییر نقش audit می‌شود؛ کاربر معمولی → FORBIDDEN

## ۱۲) جمع‌بندی
- نتیجه: … / اجراکننده: … / تاریخ: …
- هر ☒ = بلاکر انتشار؛ قاعده هدفمند §71: علت ریشه‌ای → اصلاح → کوچک‌ترین تست اثبات‌کننده.

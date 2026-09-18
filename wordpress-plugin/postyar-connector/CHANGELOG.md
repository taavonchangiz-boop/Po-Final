# Changelog — Postyar Connector | پُستیار کانکتور

## 1.0.0 — انتشار نخست

### Added
- جفت‌سازی با سکوی پُستیار: نشانی پُستیار + شناسهٔ عمومی سایت + کلید مخفی (نمایش‌داده‌شده یک‌بار در پنل پُستیار).
- همگام‌سازی کششی محصولات: `GET /wp-json/postyar-connector/v1/products` (سقف `per_page=50`، احراز هویت فقط با امضای HMAC + پنجرهٔ زمانی ±۳۰۰ ثانیه + سقف نرخ).
- مسیر تشخیصی: `GET /wp-json/postyar-connector/v1/ping` → `{ok, site, wp_version, wc_active, plugin_version}`.
- وب‌هوک‌های رویدادی به `{postyar_api}/api/v1/webhooks/wordpress/{publicId}` با هدرهای `X-Postyar-Signature`، `X-Postyar-Timestamp`، `X-Postyar-Site`، `X-Postyar-Event-Id` (UUID برای حذف تکراری) و `X-Postyar-Event-Type`:
  - `product.published` / `product.updated` / `product.deleted` / `ping`
- صف ارسال غیرهمگام WP-Cron: ارسال ۱۰ ثانیه پس از رویداد، تا ۳ تلاش با فاصلهٔ نمایی (۱۰ و ۶۰ ثانیه)، مهلت هر درخواست ۵ ثانیه.
- ضربان روزانه (`ping`) + هرس خودکار گزارش‌های قدیمی‌تر از ۳۰ روز.
- جدول گزارش `{prefix}postyar_connector_log` با مسیر ارتقای امن (dbDelta + نسخهٔ دیتابیس).
- پنل مدیریتی فارسی/راست‌به‌چپ با قلم وزیرمتن: تنظیمات، جریان اختصاصی «تغییر کلید» (نمایش فقط چهار نویسهٔ پایانی)، کارت وضعیت اتصال، دکمهٔ «بررسی اتصال» (AJAX با نانس + manage_options) و نمای ۲۰ رویداد اخیر با تاریخ جلالی.
- حذف کامل بدون باقی‌مانده: جدول گزارش، همهٔ گزینه‌های `postyar_connector_*`، پس‌متاهای `_postyar_sent_*` و رویدادهای کوئز.

### Security
- احراز هویت مسیرهای REST فقط با امضای HMAC (بدون کوکی/nonce) و مقایسهٔ زمان‌ثابت (`hash_equals`).
- کلید مخفی در گزینهٔ مستقل `postyar_connector_secret`؛ هرگز در نشانی‌ها، لاگ‌ها یا خروجی‌ها نمایش داده نمی‌شود.
- همهٔ اقدامات مدیریتی با `manage_options` + nonce؛ همهٔ خروجی‌ها گریز‌شده و ورودی‌ها پاک‌سازی‌شده.
- محافظ SSRF: نشانی خروجی فقط از تنظیمات ذخیره‌شده ساخته می‌شود و طرح http/https با میزبان غیرخالی الزامی است.
- تمام کوئری‌های SQL با `$wpdb->prepare` یا `$wpdb->insert`.

### Compatibility Notes
- قرارداد امضا: `sha256=<HMAC_SHA256(secret, timestamp + "\n" + rawbody)>`. تا هم‌تراز شدن سمت سرور (که هم‌اکنون امضای «فقط بدنه» را می‌سنجد)، پذیرش/ارسال حالت قدیمی نیز پشتیبانی می‌شود؛ پس از به‌روزرسانی سرویس، مسیر سازگاری در `Postyar_Signature` قابل حذف است.

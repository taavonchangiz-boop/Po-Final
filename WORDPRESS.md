# Postyar — WordPress / WooCommerce Connector — v1.0.0

سند پلاگین وردپرس «Postyar Connector» (پکیج: `wordpress-plugin/postyar-connector/`). فلسفه‌ی طراحی: مغز سمت پُست‌یار است (SaaS)، پلاگین فقط یک **آداپتور باریک و امضاشده** است — بازسازی هوشمند کلاس‌های WHCM کد مرجع (`audits/woo-hooman-channel-manager/AUDIT.md`) با اصلاح همه‌ی ضعف‌های امنیتی شناسایی‌شده (وب‌هوک بدون امضا، secret در input، uninstall ناقص و …).

## 1. Install / نصب

1. داشبارد پُست‌یار → **ووکامرس** → «افزودن سایت» → `publicId` + `secret` (فقط یک‌بار نمایش داده می‌شود — همان لحظه کپی کنید؛ rotate ممکن است: `POST /wordpress/sites/:id/rotate-secret`).
2. در وردپرس: افزونه‌ها → افزودن → آپلود `postyar-connector.zip` → فعال‌سازی.
3. تنظیمات → Postyar Connector: آدرس API (`https://example.com`)، `publicId`، `secret` → «ذخیره و آزمون اتصال» (ping به endpoint وضعیت سایت در API).
4. پیش‌نیاز: WooCommerce فعال؛ HTTPS (امضا و کوکی‌ها وابسته به آن).

## 2. Pairing & authentication model / مدل جفت‌سازی و احراز

- هر سایت یک جفت `publicId` (شناسه عمومی) + `secret` (کلید HMAC، در DB پُست‌یار رمزشده نگهداری می‌شود — AES-256-GCM؛ در پلاگین در `wp_options` ذخیره و در فرم هرگز بازنمایی کامل نمی‌شود).
- **وب‌هوک پلاگین→پُست‌یار:** `POST /api/v1/webhooks/wordpress/:publicId` با هدر `X-Postyar-Signature: sha256=HMAC(raw_body, site secret)`؛ tolerance زمان ۵ دقیقه (هدر timestamp)؛ بدنه ≤256KB؛ dedupe با event id در `wp_events`.
- **صدا زدن API توسط پلاگین:** فقط endpointهای مجاز سایت خودش؛ secret هرگز در لاگ/URL نمی‌رود.
- چرخش secret: در داشبارد rotate کنید، سپس مقدار جدید را در پلاگین ذخیره کنید — تا آن لحظه رویدادها با 401 رد می‌شوند (رفتار امن و آشکار).

## 3. Product sync / همگام‌سازی محصول

- دکمه «همگام‌سازی» در داشبارد (`POST /wordpress/sites/:id/sync`) ⇒ کار صف‌شده در `wp-sync` ⇒ پلاگین محصول‌ها را batch‌بندی‌شده می‌فرستد ⇒ ذخیره در `wp_products`.
- sync فقط خواندنی است (پُست‌یار محصول وردپرس را تغییر نمی‌دهد)؛ فیلدها: عنوان، توضیح کوتاه، قیمت (BIGINT ریال)، تصویر شاخص URL، وضعیت انتشار.
- صف‌بندی و bounded concurrency: فشار روی هاست فروشگاه محدود می‌ماند (الگوی whcm cron تک‌رخدادی، بدون دوباره‌کاری).

## 4. Auto-publish on product publish / انتشار خودکار

- رویداد `product.published` (transition به `publish` با گارد once-only مثل `_whcm_auto_sent` ولی سمت SaaS: کلید idempotency `wp:{siteId}:{productId}`) ⇒ پُست‌یار پست «انتشار محصول» با قالب تعریف‌شده روی کانال‌های انتخابی می‌سازد ⇒ همان مسیر outbox→worker→delivery با ردیابی وضعیت per-channel.
- حالت دستی هم هست: از صفحه محصول وردپرس یا داشبارد پُست‌یار «انتشار محصول روی کانال‌ها».
- کلیک‌ها با لینک کوتاه `/r/:code` رهگیری می‌شوند (جایگزین امن cookie attribution کد مرجع؛ بازشدن فقط به URL ذخیره‌شده — open-redirect safe).

## 5. Diagnostics / عیب‌یابی درون‌پلاگین

- صفحه تنظیمات پلاگین: وضعیت اتصال (آخرین ping موفق/ناموفق)، نتیجه اعتبارسنجی امضا، آخرین خطاها (بدون secret)، شماره نسخه.
- سمت پُست‌یار: `GET /wordpress/sites` (وضعیت، آخرین sync)، `GET /wordpress/sites/:id/products`، و رویدادهای اخیر در `wp_events`.
- مشکلات رایج: 401 = secret ناهماهنگ (rotate)؛ 403 = امضا/timestamp؛ صف ناتمام = worker/Redis (TROUBLESHOOTING §3/§11)؛ 413 = بدنه >256KB.

## 6. Update & uninstall / به‌روزرسانی و حذف

- به‌روزرسانی: آپلود نسخه جدید؛ تنظیمات و secret حفظ می‌شوند (migration داخلی افزونه idempotent)؛ پس از آپدیت «آزمون اتصال» را بزنید.
- حذف کامل (`uninstall.php`): حذف جداول/آپشن‌های خود افزونه (`postyar_connector_*`)، پاک‌سازی cron eventها و meta محصول؛ **نمی‌سازد** رد سمت پُست‌یار — سایت در داشبارد بماند تا تاریخچه حفظ شود؛ حذف دستی: `DELETE /wordpress/sites/:id` (Revoke).
- الزامات امنیتی رعایت‌شده (برخلاف مرجع): هیچ secret plaintext در input؛ امضای همه‌ی درخواست‌ها؛ uninstall بدون رد باقی‌مانده.

# Postyar × WordPress — Connector Protocol (v1)

این سند قرارداد اتصال ووکامرس/وردپرس به پُست‌یار را مشخص می‌کند (ماژول: `src/modules/wordpress`).

## 1. احراز هویت وب‌هوک (Authentication mode)

تصمیم نهایی v1 — **حالت «secret در هدر» با مقایسهٔ timing-safe**:

- در زمان اتصال سایت، سرور یک `site_key` (۳۲ کاراکتر hex) و یک `secret` (۳۲ کاراکتر hex) تولید می‌کند.
- سرور **فقط** `secret_hash = SHA-256(secret)` را ذخیره می‌کند؛ متن آشکار secret هرگز ذخیره نمی‌شود و **فقط یک بار** در پاسخ `POST /api/v1/wordpress/sites` (یا rotate) به کاربر برگردانده می‌شود.
- افزونهٔ وردپرس در هر درخواست این دو هدر را می‌فرستد:
  - `x-postyar-site-key: <site_key>`
  - `x-postyar-secret: <secret>`
- سرور `SHA-256(header secret)` را با `secret_hash` ذخیره‌شده با `crypto.timingSafeEqual` مقایسه می‌کند.

چرا HMAC امضا نشد؟ سرور متن آشکار secret را نگه نمی‌دارد (فقط hash)، بنابراین نمی‌تواند HMAC-SHA256 بدنه را بازتولید کند. این حالت معادل امنیتی خوبی است: ترنسپورت HTTPS + secret اختصاصی هر سایت + مقایسهٔ timing-safe + محدودیت نرخ (۶۰ درخواست در دقیقه). چون secret هرگز در URL قرار نمی‌گیرد و فقط داخل هدر ارسال می‌شود، در لاگ‌های سرور هم ظاهر نمی‌شود.

> نکته: هدرها را فقط روی HTTPS بفرستید. فعال‌سازی بدون پلن دارای feature `woocommerce` با خطای `FORBIDDEN` رد می‌شود.

## 2. Endpoints سمت پُست‌یار

### احراز هویت‌شده (session cookie + CSRF)

| Method | Path | توضیح |
|---|---|---|
| POST | `/api/v1/wordpress/sites` | `{siteUrl}` → `{site:{id,siteUrl,siteKey}, secret}` (secret فقط یک بار) |
| GET | `/api/v1/wordpress/sites` | لیست سایت‌های مستأجر |
| DELETE | `/api/v1/wordpress/sites/:id` | حذف سایت و محصولاتش |
| POST | `/api/v1/wordpress/sites/:id/rotate-secret` | secret جدید (فقط یک بار برگردانده می‌شود) |
| GET | `/api/v1/wordpress/products` | محصولات همگام‌شده (صفحه‌بندی) |

### عمومی (webhook — بدون CSRF، rate-limit 60/min)

`POST /api/v1/webhooks/wordpress`

Headers: `x-postyar-site-key`, `x-postyar-secret`
خطاها: `401 UNAUTHORIZED` (اعتبارنامه نامعتبر)، `422 VALIDATION_ERROR`، `403 QUOTA/CHANNEL` و ...

Body — action ها:

```json
{ "action": "sync_products", "products": [ { "wc_id": 101, "title": "…", "price_rial": 1250000, "permalink": "https://…", "image_url": "https://…" } ] }
```

- حداکثر ۲۰۰ محصول در هر درخواست.
- برای هر محصول `content_hash = SHA-256([wc_id,title,price_rial,permalink,image_url])` محاسبه می‌شود؛ محصول تغییرنکرده skip می‌شود → **همگام‌سازی idempotent (§23)**.
- پاسخ: `{ "success": true, "data": { "action": "sync_products", "synced": n, "skipped": m } }`

```json
{ "action": "publish_product", "product": { "wc_id": 101, "title": "…", "price_rial": 1250000, "permalink": "https://…", "image_url": "https://…" } }
```

- سهمیهٔ پلن (`assertWithinLimit('posts')`) بررسی می‌شود؛ در صورت تکمیل، `QUOTA_EXCEEDED`.
- یک post با `source=WORDPRESS`, `state=QUEUED` به‌همراه target برای حداکثر ۵ کانال `ACTIVE` ساخته می‌شود و برای هر target یک ردیف outbox با
  `event_type='wordpress.publish'` و payload زیر درج می‌گردد (dispatcher → صف delivery):

```json
{ "tenantId": "…", "siteId": "…", "productId": 101, "channelId": "…", "targetId": "…", "postId": "…", "title": "…", "body": "…", "imageUrl": "https://…" }
```

- پاسخ: `{ "success": true, "data": { "action": "publish_product", "postId": "…", "channels": n } }`

## 3. قالب متن انتشار

```
🛍 <title>

قیمت: <price_rial به رقم فارسی> ریال

<permalink>
```

(در صورتی که قیمت/لینک موجود باشد.)

## 4. رویدادها

- `wordpress.connected` — اتصال/اتصال مجدد سایت
- `wordpress.product.synced` — props: `{synced, skipped}`
- `wordpress.product.published` — props: `{productId, channels}`

## 5. چرخهٔ secret

- rotate → secret جدید فوراً معتبر و secret قبلی باطل (فقط hash جایگزین می‌شود).
- افشای secret → rotate از داشبورد؛ نیازی به تغییر سایت نیست.

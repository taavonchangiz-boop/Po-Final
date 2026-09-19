# Postyar — Security Model — v1.0.0

مدل امنیتی پُست‌یار، پاسخ مستقیم به یافته‌های فرانشکافی کد مرجع است (`audits/asovin/AUDIT.md`، `audits/woo-hooman-channel-manager/AUDIT.md`) و فهرست الزامات master prompt §38 را کامل پوشش می‌دهد. هر تهدید ← mitigation ← محل پیاده‌سازی.

## 1. Threat model (master prompt §38) — تهدید، راهکار، محل

| # | تهدید | Mitigation | Where |
|---|---|---|---|
| 1 | **SQL Injection** | فقط Drizzle query-builder / prepared statements؛ هیچ string-concat SQL؛ runner migration با جداسازی statement-breakpoint | `app/src/db/client.ts`, همه‌ی `*.repo/service.ts` |
| 2 | **XSS** | React (escape پیش‌فرض)؛ هیچ `dangerouslySetInnerHTML`؛ هدرهای helmet (CSP-سازگار) | `frontend/src/**`, `app/src/app/buildApp.ts` |
| 3 | **CSRF** | double-submit: کوکی `py_csrf` (خواندنی) + هدر `X-CSRF-Token` روی همه‌ی non-GET؛ مقایسه HMAC-محافظت‌شده | `app/src/security/csrf.ts`, `frontend/src/lib/api.ts` |
| 4 | **SSRF** | گارد خروجی: فقط http(s)، منع localhost، منع IP خصوصی/رزرو (شامل cloud metadata) + resolve DNS قبل از fetch؛ همه‌ی fetchها timeout-bound | `app/src/core/http.ts` (`assertPublicHttpUrl`, `isPrivateIp`) |
| 5 | **Path Traversal** | رسانه با id عددی سرو می‌شود نه مسیر کاربر؛ STORAGE_DIR ریشه ثابت + نام فایل تولیدی سرور | `app/src/modules/media/*` |
| 6 | **IDOR** | ownership از session؛ `assertOwnership` در هر سرویس tenant-scoped؛ کوئری‌ها همیشه با `user_id` فیلتر می‌شوند | `app/src/security/tenant.ts`, modules/* |
| 7 | **Broken Access Control** | نقش‌ها USER/ADMIN/SUPER_ADMIN با گارد سمت سرور؛ تغییر نقش فقط در admin routes با audit؛ گارد فرانت صرفاً UX است، مرجع سرور است | `app/src/security/current-user.ts`, `modules/admin/*` |
| 8 | **Session Fixation** | توکن تصادفی ۳۲بایت سمت سرور (کوکی فقط اپاک)؛ چرخش توکن پس از login/عملیات حساس/تغییر رمز؛ ابطال همه‌ی نشست‌ها پس از reset | `app/src/security/session.ts` |
| 9 | **Session Theft** | کوکی HttpOnly + SameSite=Lax + Secure در production؛ هیچ توکنی در localStorage؛ ابطال سمت سرور فوری | `app/src/security/session.ts`, ADR-006 |
| 10 | **Secret Leakage** | AES-256-GCM در حالت rest (فرمت `base64(nonce|tag|ciphertext)`)؛ توکن پس از ذخیره هرگز در response نمی‌آید (فقط `hasToken:true`)؛ redaction در لاگر pino؛ `.env` خارج از git + `chmod 600`؛ release-check الگوهای secret را می‌کشد | `app/src/core/crypto.ts`, `core/logger.ts`, `scripts/release-check.sh`, ADR-010 |
| 11 | **Webhook Forgery** | Telegram/Bale: مقایسه هدر secret با `hash_equals`؛ Bale چون secret_token را verify نمی‌کند هدر اجباری `X-Postyar-Secret` دارد؛ وردپرس: `X-Postyar-Signature: sha256=HMAC(body, secret)` + پنجره ۵ دقیقه + بدنه ≤256KB؛ dedupe با update/event id | `app/src/modules/bots/*`, `modules/wordpress/*` (contract §Webhooks) |
| 12 | **Replay Attack** | dedupe دائمی رویداد وب‌هوک در DB؛ timestamp tolerance وردپرس؛ verify پرداخت سمت-به-سمت با idempotency یکتا | `bot_events`, `wp_events`, `payments` |
| 13 | **Rate-limit bypass** | `@fastify/rate-limit` با presetهای per-route (ورود/ثبت‌نام سخت‌گیرانه‌تر)؛ محدودیت‌های پلن جدا از rate-limit در سرویس | `app/src/security/rate-limit.ts` |
| 14 | **File Upload Abuse** | فقط image/*، سقف 10MB، بررسی magic-byte (نه فقط mime ادعایی)، تبدیل WebP، ذخیره خصوصی، استریم فقط با مجوز مالک/ادمین | `app/src/modules/media/*` (contract §media) |
| 15 | **Prompt Injection** | پرامپت کاربر هرگز به system prompt تزریق نمی‌شود؛ خروجی AI فقط متن نتیجه در `ai_jobs.output`؛ سقف کوتاه (bounded output) و quota ماهانه | `app/src/modules/ai/*` |
| 16 | **Open Redirect** | `/r/:code` فقط به URL ذخیره‌شده ۳۰۲ می‌زند؛ ناشناس/نامعتبر ⇒ ۳۰2 به `APP_URL`؛ هیچ redirect بر اساس پارامتر کاربر | `app/src/modules/publishing/link.routes.ts` |
| 17 | **Header Injection** | Fastify هدرهای خام کاربر را ست نمی‌کند؛ helmet (referrerPolicy same-origin، CORP same-origin)؛ پیام‌های ارائه‌دهنده فقط بدنه JSON | `app/src/app/buildApp.ts` |
| 18 | **Command Injection** | هیچ exec/spawn در کد اپ؛ همه‌ی فراخوانی‌های خارجی fetch/MySQL protocol؛ اسکریپت‌های shell فقط عملیاتی و ثابت | کل `app/src` (طرح‌ریزی‌شده بدون exec) |
| 19 | **Mass Assignment** | zod روی بدنه‌ی هر route؛ فقط فیلدهای تعریف‌شده پذیرفته می‌شوند (role/status هرگز از بدنه‌ی عمومی) | `*.routes.ts` همه‌ی ماژول‌ها |
| 20 | **Prototype Pollution** | زبان سرور JS بدون merge عمیق روی ورودی کاربر؛ zod parse قبل از هر مصرف؛ فرانت از `Object.assign` روی ورودی خارجی استفاده نمی‌کند | zod schemas، `frontend/src/lib/api.ts` |
| 21 | **Race Conditions** | قفل‌های دیتابیسی: `SELECT … FOR UPDATE` برای کیف پول (ADR-013)؛ CAS state-transition برای delivery (`UPDATE … WHERE state IN (...)`)؛ mutex دیتابیسی first-admin (`system_bootstrap` ADR-007)؛ قفل scheduler با Redis SETNX | `modules/wallet/*`, `publishing/delivery.worker.ts`, `workers/scheduler.ts` |

## 2. Authentication posture / وضعیت احراز هویت

- رمزها: **Argon2id** با `@node-rs/argon2` (بهبود نسبت به bcrypt-12 کد مرجع) — `modules/auth/auth.service.ts`.
- ثبت‌نام: اعتبارسنجی zod (موبایل `^09\d{9}$` با نرمال‌سازی +98/0098، رمز ≥8 + تکرار، پذیرش قوانین)؛ اولین کاربر SUPER_ADMIN با mutex دیتابیسی.
- نشست: اپاک + Hash در DB؛ چرخش در عملیات ممتاز؛ خروج = ابطال سروری (نه فقط حذف کوکی).
- بازیابی رمز: پاسخ generic (کشف اکانت ممکن نیست)؛ توکن هش‌شده، ۳۰ دقیقه، تک‌مصرف، ابطال همه‌ی نشست‌ها پس از تعویض.
- خطای login همیشه generic: «اطلاعات ورود نادرست است.»

## 3. Secrets handling / مدیریت اسرار عملیاتی

1. `ENCRYPTION_KEY` (۳۲ بایت) — ریشه‌ی رمزنگاری توکن‌ها؛ تغییرش ⇒ از دست رفتن decryptability (در `.env.example` هشدار).
2. `SESSION_SECRET` / `CSRF_SECRET` ≥۳۲ کاراکتر؛ در production نبودشان بوت را fail می‌کند (`env.ts` fail-fast؛ هیچ insecure default در production).
3. `.env` فقط در `postelrobbal/app/.env` با `chmod 600`؛ خارج از git؛ فیلد مشابه در UI پنل هم ست می‌شود.
4. لاگ‌ها هرگز secret ندارند (redaction در `core/logger.ts`)؛ پاسخ‌های provider فقط به‌صورت کلاس خطای امن به کاربر نشان داده می‌شوند.
5. `scripts/release-check.sh` قبل از انتشار الگوهای `sk-`, `AKIA`, PRIVATE KEY, `password=`, `api_key=` با مقدار واقعی را می‌کشد و بلاکر است.

## 4. Verification / صحت‌سنجی

- تست‌های واحد امنیتی: `app/src/tests/core.test.ts` (SSRF `isPrivateIp`، round-trip AES-GCM، classification خطا، envelope).
- صحت‌سنجی دستی: `tests/smoke-contract.md` (CSRF، 401 بدون نشست، IDOR sample، rate limit).
- هر تغییر در `security/*` ⇒ اجرای targeted test همان ماژول (قاعده §71 master prompt)، نه treadmill کامل.

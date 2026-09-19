# Release Notes — Postyar v1.0.0

Date: 2025 · Status: initial production release of the rebuilt SaaS (independent implementation, built from frozen read-only reference audits — no code inherited).

## Delivered capabilities

**Platform**
- Fastify 5 + TypeScript API (`/api/v1`), Node ≥22; unified error contract (stable codes + Persian user-safe messages + `requestId`); zod-validated boundaries; pino logging with request IDs.
- Single worker process (BullMQ: delivery, bot-events, ai-jobs, notifications, maintenance) + cron-tick scheduler with Redis lock and transactional outbox → exactly-once publishing intent, atomic delivery claims, idempotency keys.
- Vite + React 18 + TypeScript SPA, **100 % Persian RTL UI**, Vazirmatn typography, PWA manifest/icons; static hosting under `public_html` (zero Node in the web tier).
- MySQL 8/MariaDB schema: **41 tables** with anti-cheat channel registry, plan limits, ledgers with exactly-once posting constraints; deterministic forward-only migration runner with drift detection; seed plans + system settings.
- Shared-host deployment story: cPanel/CloudLinux/Passenger layout (`postelrobbal/` private + `public_html/` public), idempotent `deploy.sh` (preflight → migrations → guarded rsync → Passenger restart → health), release packaging (`make-release.sh` → zip + `SHA256SUMS`) and a release gate (`release-check.sh`); CI (GitHub Actions) for typecheck/build/tests/security/PHP lint.

**Product modules**
- **Auth & account**: register/login (Argon2id), DB-backed sessions with rotation, CSRF double-submit, password reset, change password, account deletion (anonymization), notification preferences (6 Persian categories).
- **Channels**: connect/verify/update/disconnect for **Telegram, Bale, Rubika**; platform-wide claim registry preventing two tenants from using the same channel; live capability reporting (UI never emulates unsupported features).
- **Publishing**: draft → publish now / schedule; per-target delivery states with retries (3 attempts, exponential backoff), per-target retry, cancel; inline buttons + parse modes with capability soft-strip; media library (magic-byte-checked uploads ≤8 MB, private storage, 15-min signed URLs).
- **Bots & no-code automation**: bot connect (tokens AES-256-GCM encrypted, masked in UI), webhook + polling modes with secret'd webhooks and replay dedup; commands, keywords (EXACT/CONTAINS), and a workflow interpreter (MESSAGE/BUTTONS/AI/WAIT/CONDITION; ≤20 steps, 60 s, nesting ≤2) with per-run logging; spam guard (20 replies/chat/hour).
- **AI**: caption writer (queued job + polling), synchronous test generation, monthly quota accounting; providers OpenAI, Gemini, DeepSeek, Claude (Anthropic), Mistral, OpenRouter — all behind a fixed Persian safety prefix; quota enforced per plan.
- **Gold ticker** (plan-gated): configurable source URL (SSRF-guarded), Persian price parser (دلار/یورو/سکه امامی/طلای ۱۸ عیار/…), change-only publishing, per-tenant frequency (≥15 min), immediate run.
- **WooCommerce**: site connect with one-time secret (sha256-stored, timing-safe), idempotent product sync (content-hash), publish-to-channels through the same delivery pipeline, secret rotation. (Connector plugin status: see WORDPRESS.md §1.)
- **Monetization**: 5 seeded plans with limits/features; ZarinPal checkout for subscriptions (1–12 months) and wallet top-up with server-side verification and idempotent callback; wallet ledger + points ledger; referrals (100 pts on registration, first-purchase reward) with self-healing backfill; points→wallet conversion (min 100).
- **Analytics**: overview KPIs, append-only event timeline with ULID cursor pagination, per-day aggregates (60-day window); 180/180/90-day retention sweeps (events/clicks/bot events).
- **Admin & support**: overview KPIs, user suspend/activate, subscription gifting, payment review/approve, audit log viewer, plan editor, system settings editor, in-app broadcast, channel-registry release; ticketing with roles (USER/SUPPORT/SUPER_ADMIN/SYSTEM).

## Known limitations (v1.0.0 — honest list)

1. **Payment gateway needs a real credential**: without `PAYMENT_MERCHANT_ID` (ZarinPal) checkout/top-up cannot complete — subscriptions can still be granted by admins.
2. **SMS & email need provider credentials**: `SMS_API_KEY` (SMS.ir) and SMTP vars are required for password-reset email/SMS notifications; without SMTP, reset requests return the generic message but no email is sent (worker reports honestly, no fake success).
3. **Messaging platforms need bot tokens**: Telegram/Bale/Rubika delivery requires per-tenant bot tokens (encrypted at rest) and a public HTTPS `API_URL` for webhooks; Rubika adapter supports a reduced capability set (no inline buttons) and the UI reflects that.
4. **AI keys are deployment-level**: at least one AI provider key must be configured for AI features; per-provider cost controls are quota-based only (no spend caps).
5. **Load testing not executed**: performance numbers are unmeasured; the single-process/shared-host budget (API 1, Worker 1, Scheduler tick, `DB_POOL_MAX=5`) is a design constraint, not a benchmark result.
6. **Redis is external and single-instance**: queue visibility/rate-limit counters depend on it; no Redis persistence requirement, but its loss pauses delivery until restored (data survives in MySQL).
7. **Rate limiting is in-memory**: limits reset on API restart and are per-process (single-API-process contract).
8. **WordPress connector**: both sides shipped — SaaS protocol + `postyar-connector` plugin v1.0.0 (debounced batched sync of 50 products/request, ≤200 accepted per call; `publish_product` is protocol-ready but only `sync_products` + auto-publish flow are exercised end-to-end without live WordPress/WooCommerce instances).
9. **Migrations are forward-only**: no automatic down-migrations; rollback is code-level with expand/contract discipline (DEPLOYMENT.md §7).
10. **Persian-language product only**: UI strings are Persian by design; the admin surface shares the Persian SPA (engineering/API docs are English).

## v1.2.0 — feedback round 15 (2026-07-28 / ۲۸ شهریور ۱۴۰۵)

1. **Repo layout**: only `postelrobbal/` + `public_html/` are host-facing; every report/audit moved to `docs/` so host uploads stay clean.
2. **Official platform logos**: Rubika from rubika.ir/logo, Bale from the official blog.bale.ai download page, Telegram from telegram.org — no self-drawn icons anywhere.
3. **Brand logo**: the app now uses ONLY the reference-file logo (mark + full lockup); the self-made SVG was removed. PWA/favicon icons already derive from it.
4. **Admin → user dashboard button** in the admin panel header.
5. **Hero**: real logo on the product mock, the two floating chips moved ONTO the image, and a REAL dashboard screenshot inside the frame.
6. **Jalali-only date entry**: scheduling (and any filter/search date) uses a Persian-calendar date+time picker; no Gregorian inputs remain.
7. **Fresh preview**: database reset; the first (and only) account is the owner SUPER_ADMIN created from the setup script.
8. **Header clock**: Jalali date + 24-hour time chip next to the notification bell («شنبه ۲۸ شهریور ۱۴۰۵ - ۱۹:۱۱» format); 24h enforced app-wide.
9. **Mobile notification popover**: fixed the CSS-order bug that pushed the bell panel off the left edge of phone screens.
10. **Graphical feature icons** in «هر آنچه برای انتشار حرفه‌ای نیاز دارید» (multi-part SVG scenes on gradient tiles).
11. **Terms & conditions page** at `/terms` — full transparent Persian contract, linked from the mandatory registration checkbox and the footer.
12. **Tutorial page** at `/dashboard/help` — 10-step guide built from real application screenshots, visible only inside the user dashboard.
13. **Anti-bot captcha**: server-side SVG captcha (svg-captcha + Redis, one-time codes, 5-min TTL) enforced on login & registration with a graphical glass widget matching the forms.
14. **SPA base fix (root cause)**: Vite `base` switched from `./` to `/` — nested routes (e.g. `/dashboard/posts/new`) previously resolved bundle URLs document-relative and could render a blank page; absolute paths now work at every depth (preview rewrites + `.htaccess` updated accordingly).

## v1.3.0 — admin panel completion (2026-09-19 / ۲۸ شهریور ۱۴۰۵)

The admin area was a single page with 5 tabs; it is now a full multi-section management panel.

**Admin panel (nested routes under `/dashboard/admin`, own sidebar + role guard, «بازگشت به پیشخوان» toggle both ways)**
1. **داشبورد مدیریت** — full stats: users (total/active/suspended/new-30d), channels & bots per platform (Telegram/Bale/Rubika + active), Gold-bot (configs/enabled/snapshots-24h), posts (scheduled/published-30d/failed-24h), payments (verified-30d/total/pending-review), active subscriptions per plan, usage (AI jobs, media+storage, open tickets, deliveries-24h).
2. **کاربران** — search, suspend/activate, gift subscription.
3. **اشتراک‌ها (پلن‌ها)** — full plan CRUD: create, edit (limits/features/price/period), activate/deactivate, delete (refused while subscriptions reference the plan, with a clear Persian error).
4. **درگاه پرداخت** — online + card-to-card toggles; default gateway selector with **زیبال as the default** (زرین‌پال، آیدی‌پی also available); selecting a gateway reveals ITS settings (merchant ID / API key + sandbox); card-to-card cards editor (≤5).
5. **پیامک** — provider selector: **sms.ir default** + ملی پیامک، کاوه‌نگار، قاصدک; per-provider credentials revealed on selection.
6. **ایمیل** — SMTP settings (host/port/secure/user/pass/from) + live test-send endpoint (nodemailer).
7. **کانال‌ها / ربات‌ها** — global lists with owner join, platform filters, registry release.
8. **پرداخت‌ها / اطلاع‌رسانی / گزارش رویداد / تنظیمات عمومی** — review queue, broadcast, audit log, generic settings editor (payment/sms/email keys excluded — they live in their own sections).

**Backend**
- `GET /admin/overview` rewritten (nested shape); `GET /admin/channels`, `GET /admin/bots`; `POST/DELETE /admin/plans` (PUT extended); dedicated `GET/PUT /admin/settings/payments|sms|email` + `POST /admin/settings/email/test`; new gateway adapters `zibal.ts` / `idpay.ts`; `paymentProvider` default switched to `zibal`; new `paymentGateways` settings key with per-provider config merge.
- **Root-cause fixes**: (a) admin overview fired 27 concurrent queries against a pool with `queueLimit: 20` → mysql2 "Queue limit reached"; queries now run with bounded concurrency (5). (b) `gold_snapshots.capturedAt` was mapped to the wrong column by the shared `ts()` helper (`created_at`) — the Gold feature's snapshot lookup would crash at runtime; schema mapping corrected to `captured_at`.
- `.htaccess` restored (it had been wiped from `public_html/` by an earlier `--emptyOutDir` build) and now ships inside the Vite `public/` dir so every build re-emits it (SPA fallback + api/health passthrough + hidden-file deny + asset caching).

## v1.4.0 — پنل مدیریت، تنظیمات و آواتار (بازخورد کاربر، دور ۱۷)

**پنل مدیریت**
- **تک‌سایدبار**: پنل مدیریت دیگر داخل پوستهٔ داشبورد کاربری رندر نمی‌شود؛ مسیرهای `/dashboard/admin/*` به یک شل مستقل بالاترین‌سطح منتقل شدند — فقط سایدبار مدیریت (باسایدبار کاربری هرگز همزمان دیده نمی‌شود). آدرس‌ها بدون تغییر مانده‌اند.
- ناوبری موبایل: کشوی off-canvas از راست (backdrop/Esc/تغییر مسیر می‌بندد، قفل اسکرول، فوکوس خودکار) جایگزین ردیف چیپ‌ها؛ در ≤560px دکمهٔ بازگشت آیکونی و «خروج» داخل کشو.
- سایدبار گروه‌بندی شد: مدیریت / مالی / ارتباطات / تنظیمات.

**تنظیمات**
- ویرایشگر JSON/کد حذف شد؛ «مرکز تنظیمات» هاب کارت‌محور شد و هر بخش صفحهٔ تنظیمات فرم‌محور اختصاصی خودش را دارد:
  - **عمومی**: نام/شعار سایت، ایمیل و تلفن پشتیبانی، یادداشت قوانین، حالت تعمیر و نگهداری (+پیام).
  - **هوش مصنوعی**: انتخاب سرویس‌دهندهٔ پیش‌فرض از ۶ گزینه (تیل‌های انتخابی) — به `default_provider` واقعی متصل است.
  - **زیرمجموعه‌گیری**: امتیاز پاداش معرفی — مستقیماً در اعطای پاداش ثبت‌نام اعمال می‌شود.
  - **امنیت**: کلید ثبت‌نام و کلید کپچا — هر دو در مسیرهای auth سیم‌کشی شده‌اند (غیرفعال‌سازی واقعی).
- Endpoints: `GET/PUT /admin/settings/{general,ai,referral,security}` + عمومیِ whitelist‌شده `GET /settings/{general,security,referral}`؛ همهٔ PUTها audit می‌شوند.

**آواتارها (تصویر کاربر)**
- ۱۲ «کاراکتر استاندارد» SVG پارامتریک (دترمینیستیک، پالت‌های ملایم هماهنگ با برند) — هیچ‌جا کادر خالی/حروف اول دیده نمی‌شود؛ حالت پیش‌فرض از نام کاربر کاراکتر می‌سازد.
- کاربر می‌تواند عکس شخصی آپلود کند: `POST /users/me/avatar` (multipart) → برش مربع ۵۱۲ و تبدیل به WebP؛ `PUT /users/me/avatar/character`، `DELETE /users/me/avatar`، `GET /users/:id/avatar`. ستون آواتار در فهرست کاربران مدیر.

**خط لولهٔ تصویر فقط-WebP**
- هر تصویر آپلودی (JPG/PNG/WebP/GIF/AVIF/TIFF/BMP/HEIC) با sharp پردازش و **فقط** به WebP بهینه ذخیره می‌شود (حد ۱۹۲۰px، حفظ انیمیشن GIF→WebP چندصفحه‌ای، پر کردن width/height، چک‌سام خروجی)؛ **فایل اصلی هرگز ذخیره نمی‌شود**؛ خطای پردازش → 422 فارسی بدون ذخیرهٔ هیچ‌چیز. GIF متحرک → WebP متحرک.

**ریسپانسیو**
- admin.css از پایه mobile-first بازنویسی شد: تایپ clamp()، گریدهای `minmax(min(X,100%),1fr)`، insetهای safe-area، اهداف لمسی ۴۴px.
- جداول داده در ≤680px به کارت‌های جمع‌شونده با `data-label` فارسی تبدیل می‌شوند (کاربران/پلن‌ها/پرداخت‌ها/رویدادها/کانال‌ها/ربات‌ها).
- رفع ریشه‌ای: جدول داخل Card مسیر گرید تک‌ستونی را به ۵۶۲px می‌کشید و صفحه در RTL از چپ بریده می‌شد → `.adm-main > * { min-width:0 }`.
- فرم AuthModal از `GET /settings/security` می‌خواند: کپچا مخفی/ثبت‌نام غیرفعال به‌درستی منعکس می‌شود.

**پایگاه‌داده**: مهاجرت `0004_user_avatars.sql` (`avatar_kind`, `avatar_value`, `avatar_media_id`).

## v1.5.0 — زنگولهٔ مدیریت، پروفایل ۳۶۰°، تیکت‌ها و تنظیمات آسووین‌پایه (بازخورد کاربر، دور ۱۸)

**زنگولهٔ اعلان در پنل مدیریت (آیتم‌های ۱ و ۲ کاربر)**
- دکمهٔ زنگوله در هدر پنل مدیریت اضافه شد — درست مشابه داشبورد کاربر، با ساعت شمسی کنارش.
- اعلان‌های جدید به‌صورت **عدد** روی زنگوله نمایش داده می‌شوند (بیشتر از ۹۹ → «۹۹+») و aria-label شمارش را می‌خواند.
- سه منبع اعلان مدیریتی: **فیش‌های واریزی در انتظار تأیید**، **تیکت‌های پشتیبانی باز** و **کاربران جدید (۷ روز اخیر)** — هرکدام با شمارش کل، شمارش «جدید» و ۵ مورد آخر (با ایمیل کاربر، مبلغ و زمان نسبی).
- **رفتار «پس از دیدن»**: باز شدن پاپ‌آپ، مهر دیده‌شدن (`POST /admin/notifications/bell/seen` → مهر زمانی در system_settings) را می‌زند و نشان روی زنگوله بلافاصله صفر می‌شود؛ موارد دیده‌شده دیگر شمرده نمی‌شوند. بستن با کلیک بیرون/Esc/تغییر مسیر؛ polling هر ۶۰ ثانیه.
- در ≤640px پاپ‌آپ به شیت ثابت عرض‌کامل تبدیل می‌شود؛ ورودی‌های هر مورد به بخش مربوط (پرداخت‌ها / تیکت‌ها / کاربران) لینک می‌شوند.

**فرمت تاریخ هدر اصلاح شد (آیتم ۴)**
- خروجی خام `Intl` («۱۴۰۵ شهریور ۲۸, شنبه») با سازندهٔ اختصاصی `faDateLong` جایگزین شد: **«شنبه، ۲۸ شهریور ۱۴۰۵»** (نام روز، تاریخ، ماه، سال) — قطعه‌به‌قطعه با `formatToParts` و ارقام فارسی، یکسان در همهٔ مرورگرها؛ در هدر کاربر و هدر پنل مدیریت.

**پروفایل ۳۶۰ درجه کاربران (آیتم ۵)**
- در فهرست کاربران، دکمهٔ «پروفایل ۳۶۰°» مدال کامل پروفایل را باز می‌کند (الگوی asovin، حرفه‌ای‌تر):
  - هدر با آواتار استاندارد + نام + ایمیل + نشان نقش و وضعیت؛
  - جعبهٔ وضعیت اشتراک (پلن فعال/رایگان، تاریخ عضویت، اعتبار تا — نزدیک انقضا با هشدار)؛
  - پنل کسب‌وکار (نام، حوزه، موبایل، کد معرف، آخرین ورود، تاریخ عضویت)؛
  - «آمار جامع عملکرد ۳۶۰ درجه»: کانال‌ها، ربات‌ها، پست‌ها، تیکت‌ها، پرداخت‌های تأییدشده (تعداد + مبلغ) و کیف پول؛
  - اقدامات سریع: هدیهٔ اشتراک (همان مدال موجود را باز می‌کند)، تعلیق/فعال‌سازی، بستن.
- Endpoint: `GET /admin/users/:id/profile360` (۴۰۴ فارسی برای شناسهٔ نامعتبر؛ کوئری‌ها با هم‌وردایی محدود).

**بخش تیکت‌های پشتیبانی در پنل مدیریت (آیتم ۶ — پاریتاس ساختار asovin)**
- صفحهٔ «تیکت‌های پشتیبانی» با چیپ‌های وضعیت (همه/باز/پاسخ‌داده‌شده/بسته + شمارش)، جستجو (موضوع/کاربر) و جدول موبایل‌فرندلی.
- مدال گفتگو: رشتهٔ پیام‌ها با تمایز پیام کاربر/پشتیبانی/مدیر، پیوست‌ها (لینک + حجم)، پاسخ مدیر (تیکت → «پاسخ‌داده‌شده»)، بستن تیکت با تأیید؛ تیکت بسته پاسخ نمی‌گیرد (پیام فارسی ۴۲۲).
- Endpoints: `GET /admin/support/tickets` (+state/search/paging، پیوست شمارش پیام)، `GET /admin/support/tickets/:id`، `POST /admin/support/tickets/:id/messages`، `POST /admin/support/tickets/:id/close` — همراه audit «admin.ticket_reply» / «admin.ticket_close».

**بازسازی تنظیمات بر مبنای ممیزی سخت‌گیرانهٔ asovin (آیتم ۳ + ۶)**
- «مرکز تنظیمات» گروه‌بندی شد: **سامانه / هوش مصنوعی و ربات‌ها / مالی / ارتباطات / رشد** — با نشان وضعیت زندهٔ هر بخش.
- **عمومی** (۴ فیلدست): هویت سایت؛ راه‌های ارتباطی پشتیبانی (**آدرس تلگرام و بله جدید**)، قوانین، حالت تعمیر — ذخیره در `general` و انتشار عمومی تلگرام/بله در `GET /settings/general`.
- **هوش مصنوعی** (پاریتاس «تنظیمات سراسری هوش مصنوعی» asovin): علاوه بر انتخاب سرویس‌دهنده، **کلید API سراسری** (فقط‌نوشتنی؛ در GET ماسک می‌شود «••••۴رقم»)، **آدرس اختصاصی endpoint** و **نام مدل** — همگی واقعاً در مسیر احضار مدل‌ها اعمال می‌شوند (`aiComplete(provider, input, override?)` در ai.service و ai.worker؛ baseUrl/model فقط برای سازگارهای OpenAI، کلید برای همهٔ ۶ سرویس‌دهنده؛ پاک‌کردن کلید → بازگشت به متغیر محیطی).
- **زیرمجموعه‌گیری** (پاریتاس partial «تنظیمات زیرمجموعه‌گیری» asovin): کلید فعال‌سازی سیستم + امتیاز پاداش ثبت‌نام + **درصد پاداش خرید اول (۰ تا ۵۰)** — درصد ثابت ۱۰٪ کدحذف شد و از تنظیمات خوانده می‌شود؛ کلید خاموش = هیچ پاداشی ثبت نمی‌شود.
- **ربات طلا و سکه** (پاریتاس «تنظیمات کلان ربات طلا» asovin — صفحهٔ جدید): آدرس سورس پیش‌فرض، تناوب به‌روزرسانی (۱۵ دقیقه تا ۲۴ ساعت) و قالب پیش‌فرض پیام قیمت — به‌عنوان پیش‌فرض ساخت خودکار پیکربندی کاربران تازه اعمال می‌شود (تنظیمات موجود دست‌نخورده).
- **امنیت**: ساختار فیلدست‌مرتب شد (منطق بدون تغییر). همهٔ PUTها snapshot کامل برمی‌گردانند و audit می‌شوند.

**رفع اشکال زنگولهٔ کاربر**
- `GET /notifications` اکنون میدان `unread` را برمی‌گرداند — نشانِ تعداد روی زنگولهٔ داشبورد کاربری که بی‌صدا کار نمی‌کرد اصلاح شد.

**پاسخ‌گویی موبایل**
- ساعت هدر پنل مدیریت در ≤560px مخفی می‌شود تا عنوان کامل بماند؛ پاپ‌آپ زنگوله/مدال ۳۶۰°/جدول تیکت‌ها و کاربران همه بدون سرریز افقی.

**Backend خلاصه**: `admin-bell.service.ts` (اسنپ‌شات ۷ کوئری‌ای)، `profile360` در admin.service، توابع admin در support.service (بدون دست‌زدن مسیرهای کاربری)، گسترش system-settings (general/ai/referral + `gold` جدید + `resolveAiRuntimeOverride`)، سیم‌کشی override در ai-providers/ai.service/ai.worker، درصد خرید اول پویا در payment.service، پیش‌فرض طلا از تنظیمات در gold.service، `unread` در notification.routes. بدون مهاجرت دیتابیس (همهٔ حالت‌های جدید در system_settings).

## v1.6.0 — تخفیف‌گذاری پلن‌ها، اطلاع‌رسانی هدفمند، PWA و تکمیل تیکت‌ها/پرداخت‌ها (بازخورد کاربر، دور ۱۹)

**تخفیف تمدید/ارتقا و تخفیف خرید دوره‌ای (آیتم‌های ۱ و ۲)**
- ستون `pricing_json` روی جدول `plans` (مهاجرت `0005_plan_pricing.sql`) با مدل:
  `renewalDiscountPercent` — «درصد تخفیف تمدید / ارتقا»؛ فقط وقتی اعمال می‌شود که کاربر هنگام خرید، اشتراک **فعال و منقضی‌نشده** داشته باشد (تمدید پیش از پایان یا ارتقا — از جمله کاربر رایگانی که پیش از پایان دورهٔ رایگانش پلن پولی می‌خرد؛ ثبت‌نام برای همه یک اشتراک رایگان ۳۰روزه فعال می‌سازد).
  `durationDiscounts` — نقشهٔ «ماه ← درصد» برای خریدهای دوره‌ای (۳/۶/۱۲ ماهه یا هر مدت دلخواه دیگر، تا ۱۲ ردیف).
- دو درصد جمع می‌شوند و سقف مجموع ۹۰٪ است؛ مبلغ تخفیف به‌پایین گرد می‌شود تا مبلغ نهایی ریالی صحیح بماند.
- موتور قیمت‌گذاری سمت سرور (`computeSubscriptionPrice` + `hasUnexpiredSubscription` در plan.service) تک‌منبعِ همهٔ مسیرهای پرداخت است: درگاه آنلاین، اینتنت کارت به کارت و مسیر قدیمی checkout. ریز محاسبه (قیمت فهرستی، درصد هر تخفیف، مبلغ تخفیف، مبلغ نهایی) در `payments.meta_json` ثبت می‌شود تا پاپ‌آپ پرداخت مدیر همان را نشان دهد.
- **ویرایشگر پلن**: بخش «قیمت‌گذاری و تخفیف‌ها» با فیلد درصد تمدید و ردیف‌های «ماه ← درصد» (افزودن/حذف ردیف، اعتبارسنجی ۰-۹۰ فارسی)؛ ستون «تخفیف‌ها» در فهرست پلن‌ها با نشان‌های «تمدید ۱۰٪» و «۱۲ ماهه ۱۵٪».
- **پیش‌نمایش تسویه در صفحهٔ خرید کاربر**: جعبهٔ قیمت با «قیمت بدون تخفیف» خط‌خورده، سطرهای تخفیف دوره‌ای و تمدید/ارتقا، «سود شما از این خرید» و مبلغ نهایی؛ گزینه‌های مدت در سلکت با پسوند «— ۱۵٪ تخفیف»؛ نشان‌های تخفیف روی کارت پلن‌ها.

**اطلاع‌رسانی هدفمند (آیتم ۴)**
- `POST /admin/broadcast` علاوه بر «همه»، چهار هدف می‌گیرد: `ALL` / `ROLE` (گروه کاربری: کاربر، پشتیبان، مدیر) / `PLAN` (گروه اشتراک: دارندگان اشتراک فعال یک پلن) / `USERS` (عضو یا اعضای خاص، حداکثر ۵۰۰). ارسال همگانی همچنان دسته‌ای ۵۰۰تایی و کران‌دار است.
- Endpoint جدید `GET /admin/broadcast/targets`: شمارش کاربران فعال هر نقش و مشترکان فعال هر پلن برای پیش‌نمایش گیرندگان.
- بازطراحی صفحهٔ اطلاع‌رسانی: کاشی‌های انتخاب هدف، سلکت گروه کاربری/اشتراک با شمارش زنده، جستجوی زندهٔ کاربر با چیپ‌های انتخابی برای «اعضای خاص»، پیام تأیید با خلاصهٔ دقیق گیرندگان و پیام نتیجه با شمارش واقعی ارسال. audit شامل هدف ارسال است.

**نسخهٔ وب‌اپ (PWA) (آیتم ۵)**
- `manifest.webmanifest` (نام فارسی، راست‌به‌چپ، standalone، آیکون‌های ۱۹۲/۵۱۲ + maskable موجود) + سرویس‌ورکر `sw.js` با استراتژی محافظه‌کارانه: precache پوسته، network-first برای ناوبری با fallback آفلاین، cache-first فقط برای فایل‌های هش‌دار `/assets/`، عبور کامل `/api` و `/health` از کش.
- ثبت سرویس‌ورکر فقط در بیلد production و بدون هیچ UI یا خطای مزاحم؛ متا‌تگ‌های iOS (apple-mobile-web-app-*) و `mobile-web-app-capable`.

**ارسال و دریافت فایل در تیکت‌ها (آیتم ۶)**
- **پاسخ مدیر با پیوست**: مسیر مدیریتی `POST /admin/support/tickets/:id/messages` حالا multipart می‌پذیرد (فیلد `body` + فایل اختیاری `file`، تصویر/PDF ≤۱۰MB با بررسی magic-byte و بازکدگذاری WebP). پیوست در همان تراکنش پیام ثبت می‌شود.
- **نمایش پیوست در گفتگوی مدیریتی**: پیش‌نمایش درون‌خطی تصویر (مثل مسیر کاربر) و چیپ PDF؛ کاربر پیوست مدیر را در گفتگوی خود می‌بیند (دسترسی رسانه‌ای مبتنی بر مالکیت/دسترسی پشتیبانی، بدون تغییر).
- **پیوست هنگام ثبت تیکت**: هر دو فرم «تیکت جدید» (کاربر و مدیر) حالا پیوست دارند — `POST /support/tickets` و `POST /admin/support/tickets` multipart با فیلد فایل اختیاری.

**ثبت تیکت از سمت مدیر + پشتیبان‌ها و دسته‌بندی‌ها (آیتم ۷)**
- **تیکت از سمت مدیر**: دکمهٔ «+ تیکت جدید» در بخش تیکت‌های مدیریت — انتخاب کاربر با جستجوی زنده، موضوع، دسته‌بندی، متن و پیوست؛ نخستین پیام با نقش مدیر ثبت می‌شود (تیکت → «پاسخ‌داده‌شده») و کاربر اعلان «تیکت جدید از سمت پشتیبانی» دریافت می‌کند. audit «admin.ticket_created».
- **تیم پشتیبانی (پشتیبان‌ها)**: صفحهٔ جدید «تیم پشتیبانی» — فهرست پشتیبان‌ها با شمارش پیام‌های ثبت‌شده، ساخت حساب پشتیبانی (نام/ایمیل/موبایل/گذرواژه با همان خط‌مشی ثبت‌نام) و «سلب دسترسی پشتیبانی» (بازگشت به نقش کاربر؛ نقش مدیر ارشد قابل تغییر نیست). Endpoints: `GET/POST /admin/support/team`، `PATCH /admin/support/team/:id` (مجوز users.manage) + audit.
- **دسته‌بندی‌های پویا**: مدیریت‌کنندهٔ «دسته‌بندی‌ها» در بخش تیکت‌ها (افزودن/نام‌گذاری/حذف، ۱ تا ۲۰ مورد)؛ ذخیره در system_settings (`ticket_categories`) و استفاده در فرم تیکت کاربر، فرم مدیر و فهرست مدیریتی. تا زمان تعریف، دسته‌بندی‌های پیش‌فرض برقرارند. `GET/PUT /admin/support/categories` + audit.

**پاپ‌آپ جزئیات پرداخت (آیتم ۸)**
- هر ردیف پرداخت (کلیک روی ردیف یا دکمهٔ «جزئیات») پاپ‌آپ کاملی باز می‌کند: وضعیت، **مبلغ نهایی**، بابت، شناسهٔ پرداخت، **تصویر رسید** (در تب جدید هم باز می‌شود) و یادداشت کاربر، **نام/ایمیل/موبایل کاربر**، **پلن خریداری‌شده و مدت**، درگاه (فارسی)، کد رهگیری، شناسهٔ درگاه، زمان ثبت/تأیید/بازبینی و نام بررسی‌کننده؛ دکمه‌های تأیید/رد رسید داخل همان پاپ‌آپ برای پرداخت‌های در انتظار.
- `listAdminPayments` حالا `meta_json` (تفکیک تخفیف دور ۱۹) و نام بررسی‌کننده (join دوباره روی users) را برمی‌گرداند؛ تخفیف‌ها با «قیمت بدون تخفیف»، «تخفیف دوره‌ای»، «تخفیف تمدید/ارتقا» و «سود کاربر» نمایش داده می‌شوند.

**Backend خلاصه**: مهاجرت `0005_plan_pricing.sql`؛ `pricingJson`/`PlanPricing` در schema؛ موتور قیمت‌گذاری و بررسی اشتراک فعال در plan.service؛ اتصال به intent/checkout در payment.service؛ اعتبارسنجی قیمت‌گذاری در createPlan/updatePlan؛ هدف‌گذاری broadcast + targets در admin.service؛ ارتقای مسیرهای تیکت مدیریتی به multipart + `adminCreateTicket` + دسته‌بندی‌های پویا + توابع تیم پشتیبانی در support.service؛ `metaJson` + نام بررسی‌کننده در listAdminPayments.

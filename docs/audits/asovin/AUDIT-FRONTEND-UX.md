# AUDIT-FRONTEND-UX — Asovin «پُست‌یار» user-facing layer forensic audit

- Task ID: 02-b (Audit Team A — frontend/UX)
- Reference (READ-ONLY): `/home/z/postyar-build/po.source/asovin/asovin` @ 67a83e2
- Scope: `app/Views/**`, `public/index.php`, `public/manifest.*`, `public/service-worker.js`, `public/.htaccess`, `public/assets/js/*`, `public/assets/css/*`
- Method: full file-by-file read of every view and JS file, targeted greps for output-escaping, routes, inline code; cross-checked against `app/Domain/TextFormat.php`, `public/index.php` route table and `app/Modules/*/Routes.php`.
- No product code was modified.

---

## 1) Executive summary

The user-facing layer is a **server-rendered PHP dark-theme RTL SaaS** (no SPA). Three single-page tabbed consoles share one architecture:

| Surface | View | Size | Tabs driven by | JS |
|---|---|---|---|---|
| Landing + auth modals | `home.php` (880 lines) | 74 KB | anchor sections | `home.js` (modals, mobile menu, FAQ accordion, scroll reveal) |
| Tenant dashboard | `dashboard.php` (1,701 lines) | 143 KB | `switchSection(id)` on `.menu-item[data-target]` | `dashboard.js` (XHR actions) + `utils.js` |
| Super-admin panel (`/hnnh`) | `admin.php` (1,583 lines) | 130 KB | same pattern (`last_admin_tab`) | `admin.js` + inline scripts |

Key traits: `lang="fa" dir="rtl"`, Vazirmatn font (8 weights, self-hosted), Jalali datepicker (`data-jdp`, `jalaliDatepicker.startWatch`), Persian digits everywhere (server `TextFormat::fa_digits/fa_num` + client `toFaDigits`/`autoConvertToPersianDigits` tree-walker), emoji-first menu labels (🏠 ✉ 📻 🪙 🤖 🎫 📩 👤 ⚙ 💎 🎯 💰 👑), heavy inline styles (90+ onclick handlers, dozens of inline `style=` blocks per view), vanilla XHR (no fetch/axios outside `push.js`), no build step, no i18n layer — all strings hard-coded Persian.

**Top findings (details in §9):**
1. **Stored XSS risk** — ticket transcript rendered with `innerHTML` without HTML-escaping in `dashboard.js:299-321` and `admin.js:167-188`; a user ticket message can execute in the admin console. Highest-severity item.
2. **State-changing GET links** — admin suspend/activate/delete-user, approve-payment, delete-plan, delete-channel are `<a href>` GET actions (`admin.php:295-299,646-647`, `dashboard.php:661,683`, `index.php:167-171`) → CSRF/prlink-prefetch-prone.
3. **Massive inline styling** — visual system is duplicated between CSS files and inline `style=` attributes (dashboard.php alone has ~44 inline `onclick` and hundreds of inline styles); maintenance debt for the rebuild.
4. **Persian typos shipped in UI** — «وضعت»→«وضعیت» (dashboard.php:1582,1591), «پاین»→«پایان» (1591), «سابق»→«سوابق» (1589), «تراکش‌های»→«تراکنش‌های» (1580), «تاید»→«تایید» (1584), mixed «پستیار/پُست‌یار» spelling on the landing.
5. **Feature-gated IA** — sidebar items are conditionally rendered by plan features (`$quota['features']['gold_ticker']`, `auto_responder`, etc.) — the new frontend needs the same gating contract.
6. No automated a11y: decorative emoji inside links/buttons read by screen readers, `onclick`-only divs (`.menu-item`) without keyboard/role semantics, `maximum-scale=1.0, user-scalable=no` viewport on dashboard/admin (zoom disabled).

---

## 2) File-by-file findings

### `public/index.php` (197 lines)
- Front controller. Boots `Core\Bootstrap`, dispatches `/api/v1/*` to the Mobile API stack, then registers **all web routes** inline (lines 72–186), then `Router::dispatch()`.
- Product-flavored error pages in Persian («خطای سیستمی», «خطای داخلی سرور»).
- Notable routes: user auth (`/login`, `/register`, `/logout`, `/reset-password*`, `/sms-verify`, `/verify-sms-code`), dashboard actions (`/dashboard/add-post`, `cancel-post`, `add-channel`, `edit-channel`, `delete-channel`, `submit-payment`, `update-profile`, `change-password`, `save-gold-settings`, `save-advanced-settings`, `trigger-gold-publish`, `add-auto-reply`, `delete-auto-reply`, `toggle-responder`, `mark-*`, `add-ticket`, `referral`, `wallet`, `convert-points`, `link-stats`), admin under the **obscured prefix `/hnnh`** (reply-ticket, plans CRUD, payments, users, wipe-test-data, broadcast, bank, referral/sms/email settings, AI/gold/woo/responder/discounts/tickets), push (`/api/push/vapid-key|subscribe|unsubscribe|status`), polling (`/api/process-post-queue`, `/api/heartbeat`), link tracker (`/go/{code}`, `/click`), webhook (`/api/webhook`).
- **Additional routes are registered by modules**: `app/Modules/Support/Routes.php` adds `/dashboard/reply-ticket` and `/dashboard/close-ticket` (used by ticket modal) — so the ticket modal is NOT dead, but the route table is split between two files (discovery hazard).

### `public/.htaccess` (26 lines)
- Front-controller rewrite to `index.php`; denies dotfiles; denies `config|cron|debug|error_log|composer.(json|lock)|package.json|.env`. No caching/CORS/security headers (X-Frame-Options, CSP absent).

### `public/manifest.php` (116 lines) vs `public/manifest.json` (49)
- `manifest.php` is the **live** manifest (dashboard/home link it): dynamic absolute URLs, `name` «پُست‌یار | سامانه هوشمند مدیریت کانال‌ها», `short_name` «پُست‌یار», `dir:rtl`, `lang:fa-IR`, `display:standalone`, bg `#0a0a0a`, theme `#6366f1`, 8 `any` icons + 2 `maskable`, shortcut «داشبورد» → `/index.php?route=/dashboard`.
- `manifest.json` is a **static leftover** (relative paths, portrait) — only `admin.php:11` still references it → inconsistency (admin gets the legacy manifest).

### `public/service-worker.js` (154 lines)
- Cache name `postyar-pwa-v5`; pre-caches 3 CSS + 6 JS + 3 logos + 4 icons + 3 font weights.
- Strategy: **cache-first with background refresh** for static extensions (`.css/.js/.webp/.png/...`); **network-only** for HTML/API with offline fallback to cached `/` and a Persian «آفلاین هستید» 503 body.
- Web Push: `push` handler shows RTL/fa notification with default title «پُست‌یار»; `notificationclick` focuses or opens `data.url`.
- Registration snippet duplicated in `home.php:856-877`, `dashboard.php:1668-1688`, `admin.php:1572-1580`.

### `public/assets/js/utils.js` (63 lines)
- `SafeStorage` (sessionStorage wrapper w/ private-mode guard) used for `last_tab` / `last_admin_tab` persistence.
- `toFaDigits()` (JS Persian-digit map), `toPersianDateStr()` (returns date part; `2099` sentinel → «بدون انقضا / دائمی»), `autoDismissAlert()`, and `autoConvertToPersianDigits()` — a TreeWalker that converts every Latin digit text-node to Persian (skips SCRIPT/STYLE/INPUT/TEXTAREA/CODE/PRE). Invoked at DOMContentLoaded by both `dashboard.js:676-682` and `admin.js:446-452`.

### `public/assets/js/dashboard.js` (683 lines)
- Copy bank card to clipboard + toast; emoji/sticker popup (3 tabs: face/objects/arrows) inserting into `#p-content`; schedule input toggle; broadcast banner close (XHR `mark-announcement-read`); `switchSection()` tab engine + localStorage last tab; AI provider/model catalogs (openai/gemini/groq/deepseek/mistral/together/ollama with URLs + model lists, custom model option «-- مدل دلخواه --»).
- `selectPlan()` payment flow (lock card, show `#payment-box`, `price.toLocaleString('fa-IR')`, Blu-bank deep-link div); `openBluBank()` tries `blubank://transfer`, `blu://transfer`, `blubank://main`, intent scheme then Persian alert.
- `cancelPost()` XHR with confirm «آیا مطمئن هستید…»; `processPostQueue()` poll loop (max 5 tries / 2 s) on load; auto-reply add/delete XHR; per-channel responder toggle with optimistic UI; `postyarHeartbeat()`; bell popup + notification read/badge accounting; `saveGoldSettingsAjax()` / `saveAdvancedSettingsAjax()` via FormData; `showToast()`; Persian digit auto-convert.
- **All XHR URLs use `window.postyarBaseUrl + '/index.php?route=' + encodeURIComponent(path)` and send `csrf_token` from `window.__csrfToken`.**

### `public/assets/js/admin.js` (453 lines)
- Drawer menu; `switchSection()` (`last_admin_tab`); gift modal; **user 360° profile modal** (`openUserProfileModal` fills name/email/plan/dates/channels/posts/tickets/`total_spent.toLocaleString('fa-IR') + ' تومان'`); client-side user search `filterAdminUsers`; admin ticket modal (innerHTML transcript — see XSS finding); DOM surgery "layout fix" that re-parents 8 orphaned sections into `main` (workaround for markup escaping the wrapper); mobile bell popup centering hacks; a fake **«آمار تفکیکی انتشارها و بازخوردها»** card generated client-side whose numbers are just DOM row counts (`#section-users tbody tr` etc.) — cosmetic/dead analytics; admin AI provider/model maps (adds anthropic + openrouter, Persian model descriptors like «GPT-4o (پرچمدار)»); Jalali datepicker init (`separatorChar:'/'`, openOnFocus, retry loop); ticket status filter buttons (همه/باز/پاسخ‌داده‌شده/بسته‌شده); Persian digit auto-convert.

### `public/assets/js/home.js` (65 lines)
- `openModal/closeModal` (auth modals), backdrop click close; mobile menu; FAQ accordion (single-open); IntersectionObserver `.reveal` scroll animation. No API calls.

### `public/assets/js/push.js` (172 lines)
- Feature-detect, VAPID fetch, subscribe/unsubscribe, `checkStatus`, UI sync on `#push-toggle-btn` («اعلان‌ها فعال است» / «فعال‌سازی اعلان‌ها» with 🔔/🔕). Exposed as `window.PostyarPush`.

### `public/assets/js/pwa-install.js` (183 lines)
- Mobile/tablet-only install banner (inline-styled bottom sheet), iOS instruction variant («اشتراک‌گذاری» → «افزودن به صفحه اصلی»), Android `beforeinstallprompt`, permanent dismissal in `localStorage['pwa_install_dismissed']`, HTTPS check.

### `public/assets/js/jalalidatepicker.min.js` (~13.5 KB)
- Third-party **jalali-datepicker (jdp)** library; used via `data-jdp` attributes + `jalaliDatepicker.startWatch({...})`. Dashboard config: `minDate:"today", showTodayBtn:true, showEmptyBtn:false`. Admin config: `separatorChar:'/', openOnFocus:true`. Dark theme applied by `components.css` `.jdp-container` overrides.

### `public/assets/css/*`
- **`components.css` (129 lines)** — shared: Vazirmatn `@font-face` (100–900), dark-theme Jalali datepicker skin, number-input spinner removal, `.btn-bluebank`.
- **`dashboard.css` (1,691 lines)** — tenant design system. `:root` tokens: `--primary:#6366f1; --primary-hover:#4f46e5; --bg-dark:#0f172a; --bg-card:#1e293b; --text-light:#f8fafc; --text-muted:#94a3b8; --border:#334155; --danger:#ef4444; --success:#10b981; --warning:#f59e0b`. Includes sidebar/mobile-nav/drawer, stat cards, tables (responsive `data-label` pattern), plan cards with neon badges, credit-card widget, bell popup (appended section "extracted from inline <style>" — evidence inline styles were partially migrated), heavy ≤480px/640px mobile fixes.
- **`admin.css` (722 lines)** — same tokens; drawer, ticket-card rows, filters, bell popup overrides.
- **`home.css` (488 lines)** — landing-specific: `glass`/`glass-light` surfaces, `mesh-bg`, `noise`, marquee, `card-glow`, `float-animation`, auth modals, FAQ accordion, plans grid override. Landing also loads **`tailwind-home.css` (2 lines ≈ 23 KB)** — a minified one-line Tailwind utility subset (dark `#0a0a0a` palette).
- `jalalidatepicker.min.css` (5.4 KB) — vendor skin.

### `app/Views/dashboard.php` (1,701 lines) — see §3 for IA
- Header: logo frame, notification bell + popup (per-item unread styling, «خواندن همه ✔», `timeAgo`), user badge with 💎 plan badge (`fa_digits`).
- Sections `#section-*` as tabs; per-section detail in §3. Payment box includes clickable gradient **credit-card widget** (copy card), Blu-bank deep link, receipt upload. Ticket modal with chat bubbles (admin/suppport/user prefixes parsed from message string with regex on «[پیام مدیر سیستم …]», «[پاسخ پشتیبان در تاریخ …]» — protocol-as-string design). Inline script block sets `postyarBaseUrl`, `__csrfToken`, `__dashboardSavedCard`, AI dropdown init, datepicker init, SW registration, heartbeat every 60 s after 2 s.
- View runs **DB queries inside the template** (responder logs, settings, subscription row, occasion discount, bank settings, referral stats) — logic-in-view antipattern.

### `app/Views/admin.php` (1,583 lines) — see §4 for IA
- Drawer + desktop sidebar with 16 items incl. role gate `$is_support` (support agents see only tickets; enforced by JS hiding sections). Header badge «مدیر ارشد پلتفرم 👑» / «پشتیبان پُست‌یار 🎧». Quick-status bar. Modals: gift subscription, user 360° profile, admin ticket dialog (reply + assign + attachment + close), new-ticket-to-user (categories عمومی/فنی/مالی/پیشنهاد ویژگی/گزارش باگ/سایر; priorities پایین/عادی/بالا/بحرانی), ticket category editor (slug/title/emoji/assignee → XHR `save-ticket-categories`).
- Same logic-in-view antipattern: raw SQL in template (subscriptions list, bank/support settings, sms/email settings loads).

### `app/Views/home.php` (880 lines) — landing; full blueprint in §5.

### `app/Views/help.php` (268 lines)
- Standalone styled guide «راهنمای استفاده از داشبورد» with mascot, auto-generated TOC (JS), 9 step sections (کانال، لینک‌ها، ارسال پست، زمان‌بندی، صندوق پیام، تیکت، اشتراک، زیرمجموعه/کیف پول، تنظیمات پیشرفته), tip/warn boxes. All inline `<style>`; sticky header; «بازگشت» to dashboard.

### `app/Views/privacy.php` (315 lines)
- Standalone policy page «حریم خصوصی کاربران پُست‌یار» — 17 numbered sections (دامنه، داده‌ها، اهداف، کوکی‌ها، اشتراک‌گذاری، انتشار در سرویس‌های خارجی، انتقال داده به خارج از ایران، هوش مصنوعی، نگهداری/حذف، حذف حساب، امنیت، حقوق کاربران، اشخاص ثالث، کودکان، تغییرات، تماس، پذیرش). Inline `<style>`; uses `$assetsUrl`.

### `app/Views/errors.php` (79 lines)
- Generic error card: big code (escaped), «اوه! خطایی رخ داده است», message, CTA «بازگشت به صفحه اصلی 🏠». Inline `<style>`, light theme (inconsistent with the dark product).

### `app/Views/partials/*`
- **`referral-section.php`** (110): referral code/link copy buttons, 3 stat boxes (کل زیرمجموعه‌ها / پاداش‌داده‌شده / در انتظار خرید), points→wallet conversion form (POST `/dashboard/convert-points`, rate «هر ۱۰ امتیاز = ۱۰ تومان»), history table with statuses «✅ پاداش داده شده» / «⏳ در انتظار خرید».
- **`wallet-section.php`** (88): balance/points/points-value cards, convert form, transactions table with type labels `referral_purchase`→«🎯 پاداش زیرمجموعه», `cashback`→«💳 کش‌بک», `points_convert`→«⭐ تبدیل امتیاز», `debit`→«🔴 برداشت», `credit`→«🟢 واریز».
- **`admin-referral-settings.php`** (81): enable toggle; registration reward (امتیاز/تمدید اشتراک روز/درصد خرید اول); first-purchase reward (درصد/امتیاز ثابت); caps (حداکثر زیرمجموعه، سقف پاداش ماهانه). POST `/hnnh/save-referral-settings`.
- **`admin-sms-settings.php`** (328): SMS.ir config (کلید X-API-KEY، شماره خط), test send, template table (event keys: registration / payment_confirm / subscription_expiry / password_reset / bulk_notification / custom + TemplateId + params JSON), bulk send (target=all users), log table with filter (status/phone; `filter_phone` escaped).
- **`admin-email-settings.php` (445)**: SMTP config (host/port/user/pass/encryption TLS/SSL/none/from), templates CRUD, bulk email, send log + stats. Event keys mirror SMS (welcome/verify/reset/receipt/expiry + custom), with live preview via `/hnnh/preview-email-template`.

---

## 3) Dashboard IA catalog (user/tenant) — Persian labels verbatim

Sidebar (`dashboard.php:100-122`) — items gated by plan features marked ⛔:

1. 🏠 **وضعیت کلی** → `#section-dashboard`
   - Stat cards: «کل بازدیدهای ورودی (کلیک کل)», «بازدیدهای یکتای حقیقی (Unique)», «نرخ تعامل کانال‌های شما», «کانال‌های متصل شده (used/max)», «پست‌های ارسالی این دوره», «تاریخ اتمام اشتراک» («بدون انقضا» if none)
   - «📊 نمودار تحلیل مقایسه‌ای پیشرفته کانال‌ها» — **hard-coded decorative SVG line chart** (fake data paths «میزان کلیک‌ها (تک کلیک)»/«میزان کلیک‌های یکتا», axis «امروز شمسی/میانه دوره/شروع دوره») — no real data binding.
2. ✉ **ارسال پست جدید** → `#section-publish`
   - Form: «عنوان پست», «محتوای پست (متن پیام)» + «افزودن استیکر و اموجی پُست‌یار» popup, «بارگذاری و آپلود تصویر شاخص (فرمت بهینه وب‌پی خودکار)», «نوع انتشار» (⚡ ارسال آنی و سریع / ⏰ زمان‌بندی ارسال خودکار), «انتخاب تاریخ و ساعت دقیق ارسال» (Jalali date + ۲۴ ساعت/۶۰ دقیقه selects with Persian digits), «انتخاب کانال‌های هدف جهت انتشار پست» (checkboxes, «تلگرام/بله» suffix), CTA «انتشار و زمان‌بندی پست در پُست‌یار 🚀». POST `/dashboard/add-post`.
   - «⏳ صف انتظار و پست‌های زمان‌بندی‌شده» table (badges «در صف ارسال ⏳», «زمان‌بندی‌شده 📅», «پیش‌نویس 📝»; action «🗑 لغو و حذف» → XHR cancel-post)
   - «📋 تاریخچه پست‌های ارسالی و زمان‌بندی شده شما» (status badges «ارسال شده ✔», «در انتظار ارسال ⏳», «خطا در ارسال ❌»; columns «بازدید کل (کلیک)», «کلیک‌های یکتا»)
3. 📻 **مدیریت کانال‌ها** → `#section-channels`
   - Edit card (when `?edit_channel=`): «ویرایش تنظیمات کانال: «…»», «نام نمایشی کانال», «پلتفرم» (تلگرام / بله (Bale)), «آیدی کانال (مانند @MyGoldShop)», «توکن ربات», «🔗 تنظیمات ۳ دکمه شیشه‌ای کپشن (لینک وب‌سایت)» (buttons 1-2 name+URL; button 3 name only — URL auto-converted to click tracker), «💬 دکمه‌های شیشه‌ای تعاملی زیر پست (Interactive Buttons)» toggle + 2 buttons. POST `/dashboard/edit-channel`.
   - «📻 لیست تفکیکی کانال‌های متصل شده شما» → «🔵 کانال‌های فعال تلگرام» / «🟢 کانال‌های فعال بله» (empty states «هنوز هیچ کانال تلگرامی متصل نکرده‌اید.»); per item ⚙ edit / 🗑 delete (GET confirm).
   - «➕ اتصال کانال جدید» form (نام نمایشی، پلتفرم پیام‌رسان، آیدی کانال «شروع با @ یا آیدی عددی»، توکن ربات «توکن دریافتی از BotFather»), CTA «اتصال ربات و بررسی ارتباط 📡». POST `/dashboard/add-channel`.
4. ⛔ 🪙 **ربات طلا و سکه** (feature `gold_ticker`) → `#section-ticker`
   - «🪙 ربات خودکار و هوشمند انتشار نرخ لحظه‌ای طلا»: «زمان‌بندی بررسی و انتشار خودکار» (غیرفعال (فقط دستی) / هر ۵ / ۱۵ / ۳۰ دقیقه / هر ۱ ساعت), «واحد پول ورودی API» (تومان / ریال (تبدیل خودکار به تومان)), «آدرس اختصاصی API طلا (اختیاری)», «بارگذاری و آپلود تصویر شاخص نرخ طلا», channel checkboxes, «قالب پیام نرخ طلا» (template placeholders `{g18k} {coin} {oz} {time}`). AJAX save (btn «ذخیره تنظیمات ربات طلا 🪙»).
   - «⚡ انتشار آنی، زنده و تستی نرخ طلا» → «انتشار زنده و آنی به کانال‌ها 🚀» POST `/dashboard/trigger-gold-publish`.
5. ⛔ 🤖 **پاسخگوی خودکار** (feature `auto_responder`) → `#section-responder`
   - Explainer card «🤖 دریافت پیام‌های مشترکین و ارسال خودکار»; «📝 محتوای قالب‌های پاسخگویی خودکار» (انتخاب ربات کانال، کلمه کلیدی، متن پاسخ خودکار, «+ افزودن»), rules table (کلمه کلید/وضعیت «سرویس»/عملیات حذف)
   - «⚙️ حالت پاسخگویی خودکار» per-channel switches (optimistic toggle); «📊 آخرین ارتباط‌های مشترکین» log (replied ✅/➖).
6. 🎫 **پشتیبانی و تیکت‌ها** → `#section-tickets`
   - «📞 راه‌های ارتباط سریع…» (تلگرام/بله/ایمیل پشتیبانی links from global settings)
   - «🎫 ارسال تیکت پشتیبانی جدید» (موضوع، «دسته‌بندی تیکت» from categories — fallback «فنی و ربات‌ها 🤖 / مالی و فیش واریزی 💳 / سوال عمومی 🌐», متن پیام، «پیوست تصویر (اختیاری)») POST `/dashboard/add-ticket`
   - «📋 وضعیت تیکت‌های پشتیبانی قبلی شما» (badges «در انتظار پاسخ ⏳ / پاسخ داده شده ✔ / بسته شده»; «👁 مشاهده گفتگو و پاسخ پشتیبانی» opens modal → reply form POST `/dashboard/reply-ticket` («ارسال و بستن همزمان تیکت»), «بستن این تیکت (مختومه کردن)» POST `/dashboard/close-ticket`)
7. 📩 **صندوق پیام** → `#section-inbox` — «📩 صندوق پیام‌های دریافتی» table (کانال/فرستنده/متن پیام/تاریخ دریافت; empty state 📭)
8. 👤 **تنظیمات حساب** → `#section-settings`
   - «👤 ویرایش پروفایل کاربری» (نام و نام خانوادگی، نشانی ایمیل، «تاریخ تولد (شمسی)» `data-jdp` placeholder «مثلاً: ۱۳۷۰/۰۶/۱۵»); «🔑 تغییر کلمه عبور» (کلمه عبور فعلی/جدید/تکرار، placeholder «حداقل ۸ کاراکتر»)
9. ⚙ **تنظیمات پیشرفته** → `#section-advanced-settings`
   - «🔗 پیش‌فرض سراسری ۳ لینک پایین محتوا» (defaults «📢 کانال تلگرام» / «💬 کانال بله» / «🌐 خرید آنلاین از سایت»)
   - «🎛️ پیش‌فرض سراسری دکمه‌های شیشه‌ای تعاملی» (defaults «🛒 خرید آنلاین از سایت», «💎 پشتیبانی VIP», «📢 هومن وب»)
   - ⛔ «🛍️ اتوماسیون هوشمند فروشگاهی ووکامرس» (انتشار خودکار محصول جدید…, درج خودکار واترمرک…) — gated `woocommerce`
   - «✉️ تنظیمات ارسال و دریافت پیام» (قالب متن: «متن ساده + دکمه‌های شیشه‌ای» / «متن HTML (لینک روی متن)»; روش دریافت: «Polling خودکار (getUpdates)» / «وبهوک (Webhook)»; سرعت بررسی: هر ۳۰ ثانیه (تقریباً بلادرنگ) / هر ۱ دقیقه (پیشنهادی) / ۲ / ۵ دقیقه)
   - ⛔ «🤖 تنظیمات هوش مصنوعی مولد کپشن» — gated `ai_caption`: 9 providers incl. «Groq (سریع و رایگان)», «Ollama (محلی)»; model select + «-- مدل دلخواه --»; «کلید API هوش مصنوعی» (dir-ltr), «آدرس اختصاصی API (Completions URL)»
   - «🔔 اعلان‌های مرورگر» push toggle card
   - Save btn «ذخیره تنظیمات پیشرفته و اتوماسیون پُست‌یار 💾✔» (AJAX)
10. 💎 **خرید اشتراک** → `#section-upgrade`
   - «💎 ارتقا و تمدید اشتراک پنل کاربری»; current-subscription banner («اشتراک فعلی شما: …», «اعتبار تا: …», «✅ فعال»)
   - Plan cards from DB: plan image + neon badges («✨ <badge text>», «🔥 %N تخفیف ویژه», «⚡ %N تخفیف تمدید پیش از موعد!»), price with strikethrough + «تومان», features list (⌛ مدت زمان، 📻 سهمیه کانال، 📝 سهمیه پست «نامحدود», 📈 تحلیل آمار تفکیکی، 🪙 ربات خودکار نرخ طلا، 🤖 پاسخگوی کلمات کلیدی، 🛍 قابلیت اتصال به ووکامرس، 🧠 کپشن‌ساز هوش مصنوعی), buttons: «🔒 اشتراک فعلی شما» / «🔄 تمدید این اشتراک (N روز مانده)» / «انتخاب این پلن»
   - «💳 جزئیات پرداخت پلن انتخابی» → copyable credit-card widget (bank/holder/card), «💳 پرداخت آنلاین با بلو لینک ⚡», receipt form («کد رهگیری / شماره ارجاع تراکنش», «بارگذاری تصویر رسید پرداخت (وب‌پی خودکار)», Blu-bank button «🚀 کارت به کارت فوری در اپلیکیشن بلو بانک (مخصوص گوشی)», CTA «ثبت نهایی رسید و واریز 💳») POST `/dashboard/submit-payment`
   - «📋 سوابق اشتراک‌ها و پرداخت‌ها» (تراکش‌های پرداخت [sic] + سابق اشتراک‌ها [sic])
11. 🎯 **زیرمجموعه‌گیری** → `#section-referral` (partial; see §2)
12. 💰 **کیف پول** → `#section-wallet` (partial; see §2)
13. 📖 **آموزش استفاده** (link to `/help`)
14. 👑 **پنل مدیریت کل** (super-admin only → `/hnnh`)
15. 🚪 **خروج از حساب** (`/logout`)

Mobile bottom nav: داشبورد / پست جدید / کانال‌ها / تیکت‌ها / **بیشتر** (bottom-sheet drawer «منوی کامل» repeating items 4–15).

---

## 4) Admin IA catalog (`/hnnh`) — Persian labels verbatim

Sidebar `admin.php:111-129` (order as rendered; drawer mirrors 1–16):

1. 📊 **وضعیت کلی و آمارگیری حرفه‌ای** → `#section-dashboard` — 8 clickable stat cards: «کل کاربران ثبت‌نام شده», «کاربران فعال», «پرداخت‌های در انتظار تایید», «تیکت‌های باز منتظر پاسخ», «پلن‌های اشتراک», «اشتراک‌های فعال», «کل کانال‌های ثبت شده», «کل درآمد تایید شده» (تومان). (+ client-generated «📊 آمار تفکیکی انتشارها و بازخوردها» fake card, admin.js:237-255)
2. 👥 **مدیریت کاربران و هدیه اشتراک** → `#section-users` — search «جستجوی نام یا ایمیل یا کسب‌وکار...»; table (نام کاربر/مشخصات کسب و کار/اشتراک فعلی و اعتبار/تاریخ عضویت/کانال‌ها/وضعیت حساب فعال|مسدود/اقدامات مدیریتی: 👁 پروفایل ۳۶۰ درجه، 🎁 هدیه اشتراک، تعلیق 🚫 / فعال ✔، حذف 🗑 GET-confirm). Cards: «👤 افزودن کاربر جدید به صورت دستی» (نام/ایمیل/رمز/کسب‌وکار/«نقش کاربر: کاربر عادی (مستأجر)|پشتیبان (فقط تیکت‌ها)»/نوع کسب و کار) POST `/hnnh/add-user-manual`; «🎫 اعطای مستقیم و دستی اشتراک به کاربر» POST `/hnnh/grant-subscription-manual`.
3. 💳 **تایید فیش‌های واریزی** → `#section-payments` — «درخواست‌های فعال تایید واریز کارت به کارت (بلو بانک) 💳»; columns کاربر فرستنده/پلن درخواستی/مبلغ واریزی/کد رهگیری تراکنش/تصویر رسید («🔎 مشاهده فیش»)/وضعیت مالی («در انتظار تایید ⏳»/«تایید شده ✔»)/تأیید («تایید و فعال‌سازی» GET).
4. 🎫 **لیست اشتراک‌های فعال** → `#section-subscriptions` — table کاربر/کسب و کار/پلن/شروع/اتمام/وضعیت (فعال|منقضی).
5. 💎 **مدیریت پلن‌های اشتراکی** → `#section-plans` — create/edit form (نام پلن، قیمت (تومان)، مدت اعتبار به روز، حداکثر سهمیه کانال، «حداکثر پست ماهانه (۰ = نامحدود)», «درصد تخفیف تمدید پیش از موعد», «درصد تخفیف عمومی/مناسبتی کل پلن», «متن برچسب تخفیف روی تصویر (مثال: آفر ویژه عید)», توضیحات، تصویر وب‌پی، «لینک پرداخت مستقیم اختصاصی (بلو لینک)», feature checkboxes «📈 ربات قیمت خودکار طلا / 🤖 پاسخگوی کلمات کلیدی / 🛍 اتصال ووکامرس / 🧠 کپشن‌ساز هوش مصنوعی / ⭐ پلن پیشنهادی ویژه (محبوب‌ترین)»); plan list table with ⚙ ویرایش / حذف.
6. 🪙 **تنظیمات ربات طلا و سکه** → `#section-admin-gold` — «🪙 تنظیمات کلان ربات لحظه‌ای طلا، سکه و ارز»: «سورس رسمی دریافت زنده نرخ‌ها (API)» (TGJU / اتحادیه طلا و جواهر ایران Tala.ir / بانک مرکزی جمهوری اسلامی ایران / سورس اختصاصی و وب‌هوک دستی), «دوره تناوب استعلام نرخ زنده» (۶۰ ثانیه (پرفشار) / ۳ دقیقه (پیشنهادی) / ۵ دقیقه), «🔑 آدرس API دستی / کلید اختصاصی», «الگوی پیش‌فرض ارسال قیمت طلا برای کاربران جدید» (placeholders `{gold_18k} {coin_emami} {coin_bahar} {gold_ounce}`).
7. 🧠 **تنظیمات سراسری هوش مصنوعی** → `#section-admin-ai` — provider (OpenAI / DeepSeek / Anthropic Claude / OpenRouter / Groq / Gemini / «مدل دلخواه دستی»), model select (Persian descriptors), «کلید اصلی دسترسی به API (Global API Key)», custom URL, toggle «فعال‌سازی دستیار نگارش هوشمند (AI Writer)…».
8. 🎁 **کدهای تخفیف** → `#section-discounts` — table (کد/درصد/حداکثر استفاده/تعداد استفاده‌شده/«تاریخ انقضا (شمسی)» via data-jdp/وضعیت فعال|غیرفعال/حذف); create form (کد «حروف انگلیسی یا عدد» uppercase, درصد ۱ تا ۱۰۰, max uses «۰ = نامحدود», Jalali expiry).
9. 🤖 **تنظیمات پاسخگوی هوشمند** → `#section-admin-responder` — «حداکثر کلمات کلیدی مجاز برای هر کاربر», «تأخیر پاسخ (ثانیه)» (بدون/۲/۵), «پیام پیش‌فرض در صورت عدم تطابق کلمه».
10. 🛍 **تنظیمات اتصال ووکامرس** → `#section-admin-woo` — «متن راهنمای اتصال برای کاربران» (WordPress REST API instructions), «حداکثر فروشگاه مجاز برای هر کاربر», «الزام اتصال امن (HTTPS)».
11. 📢 **ارسال اعلان همگانی** → `#section-broadcast` — «ارسال اعلان همگانی درون‌برنامه‌ای»: عنوان، «انتخاب جامعه هدف (پلن‌های اشتراکی)» radio همه کاربران پلتفرم / کاربران پلن «…», متن پیام; + «📋 آمار و تاریخچه اعلان‌های ارسالی» (جامعه هدف «همه کاربران»/«پلن اختصاصی شناسه N»).
12. 💳 **تنظیمات کارت بانکی** → `#section-bank` — «💳 تنظیمات و شماره کارت بانکی عمومی سامانه» (شماره کارت ۱۶ رقمی، نام صاحب حساب، نام بانک) + «📞 تنظیمات راه‌های ارتباطی فرعی پشتیبانی کاربران» (تلگرام/بله/ایمیل).
13. 🎫 **تیکت‌های پشتیبانی** → `#section-tickets` — (non-support) «🏷️ مدیریت دسته‌بندی تیکت‌ها» (slug/title/emoji/assigned agent editor) + «🎧 لیست کاربران پشتیبان»; 4 stat tiles (کل تیکت‌ها/در انتظار پاسخ/پاسخ داده شده/بسته شده); filters همه/⏳ باز/✔ پاسخ‌داده‌شده/🔒 بسته‌شده; ticket cards with avatar initial, «📤 ارسال توسط ادمین» chip, 👁 مشاهده و پاسخ → modal (reply + attachment + «ارجاع به پشتیبان دیگر» + «ارسال و بستن همزمان تیکت»; «بستن این تیکت بدون پاسخ»), 🔄 reopen, 🗑 delete; «✉️ ارسال پیام جدید به کاربر» modal (target user, subject, دسته‌بندی عمومی/فنی/مالی/پیشنهاد ویژگی/گزارش باگ/سایر, اولویت 🟢 پایین/🟡 عادی/🟠 بالا/🔴 بحرانی, پیوست).
14. 🎯 **تنظیمات زیرمجموعه‌گیری** → `#section-referral-settings` (partial §2).
15. 📱 **تنظیمات پیامک** → `#section-sms-settings` (partial §2).
16. 📧 **تنظیمات ایمیل** → `#section-email-settings` (partial §2).
Then links: «🏠 رفتن به پیشخوان کاربری» (`/dashboard`), «🚪 خروج از حساب».

Support-agent mode ($is_support): drawer title «پنل پشتیبانی», badge «پشتیبان پُست‌یار 🎧», only tickets visible (sidebar items hidden via JS `admin.php:1551-1569`).

---

## 5) Landing page blueprint (`home.php`, Tailwind-dark `#0a0a0a` + glass)

Nav (glass pill, fixed): links امکانات سیستم / مقایسه کانال‌ها / نحوه کارکرد / تعرفه اشتراک / نظرات مدیران / سوالات متداول; buttons «ورود به پنل» (modal) + «ثبت‌نام رایگان» (modal); mobile hamburger drawer.
1. **Hero**: badge «نسخه ۲.۰ منتشر شد — مجهز به ربات نرخ لحظه‌ای طلا و سکه 🚀»; full logo; H1 «مدیریت هوشمند و انتشار خودکار» + gradient «در تلگرام و بله»; sub «یک بار منتشر کن، همه جا دیده شو! …»; CTAs «ثبت‌نام و شروع تست رایگان 🚀» + «مشاهده امکانات سیستم»; mascot `asovin.webp`; fake dashboard glass card («متصل به تلگرام و بله», «پست کانال تلگرام پابلیش شده • ۲ دقیقه پیش +۲۴۳ لایک», «ربات نرخ طلا ۱۸ عیار و سکه … شلیک خودکار», «پست ویدیویی کانال بله زمان‌بندی • فردا ساعت ۰۹:۰۰ در صف انتشار»); floating badges «ارسال موفق چندکاناله!» and «+۳۸٪ رشد تعامل اعضا».
2. **Trusted-by marquee**: «مورد اعتماد گالری‌های طلا، فروشگاه‌های آنلاین و کانال‌های پرمخاطب ایرانی» + fictional logos (گالری طلا آسوین، دیجیتال‌شاپ، بورس‌تایمز، …).
3. **Features** «امکانات فوق‌حرفه‌ای پُست‌یار» — 6 glass cards: ✈ سیستم هوشمند انتشار و زمان‌بندی / 🪙 ربات خودکار نرخ لحظه‌ای طلا و سکه / 🤖 پاسخگوی کلمات کلیدی و صندوق پیام / 🛍 اتصال مستقیم به ووکامرس / 🧠 کپشن‌ساز هوش مصنوعی / 📈 تحلیل آمار تفکیکی کانال‌ها.
4. **Stats banner**: ۵,۰۰۰+ کانال و کسب‌وکار فعال / ۲M+ پست منتشر شده / ۹۹.۹٪ آپتایم / ۴.۹ از ۵ رضایت (static marketing numbers).
5. **How it works** «شروع اتوماسیون در ۳ مرحله ساده»: ۱ 🔗 کانال‌های تلگرام و بله را متصل کنید، ۲ ⚙️ محتوا، ربات طلا یا ووکامرس را تنظیم کنید، ۳ 🚀 انتشار خودکار و رشد مخاطبان.
6. **Comparison table** «مقایسه پلتفرم‌های تلگرام و بله» — rows: نوع پلتفرم، دسترسی بدون فیلترشکن («نیاز به VP*N» vs «بدون نیاز به ابزار»), سرعت و پایداری در ایران، انتشار پست متنی/تصویری/ویدیویی، زمان‌بندی انتشار شمسی، ارسال همزمان چندکاناله، ربات نرخ طلا، پاسخگوی خودکار، اتصال ووکامرس، کپشن‌سازی AI، تحلیل آمار، مخاطب هدف (داخل/بین‌المللی), پشتیبانی در پُست‌یار («یکپارچه و همزمان ✨»).
7. **Pricing** «تعرفه اشتراک‌های پُست‌یار» — DB-driven `$plans` cards (same feature-list markup as dashboard), CTA «ثبت‌نام و خرید اشتراک» → register modal.
8. **Testimonials** «تجربه واقعی کاربران پُست‌یار» — 3 ★★★★★ quotes (هومن نقشی / سارا رضایی / علیرضا کاظمی, colocation with real admin name هومن نقشی).
9. **FAQ** «پاسخ به پرسش‌های شما» — 4 accordion items (دانش فنی، پیام‌رسان‌های پشتیبانی‌شده، ربات طلا، ووکامرس).
10. **Final CTA**: «آماده‌اید مدیریت کانال‌های خود را هوشمند کنید؟» + «ثبت‌نام و شروع رایگان».
11. **Footer**: logo, same anchors + «حریم خصوصی» (`{app.url}/privacy`), «تمامی حقوق مادی و معنوی محفوظ است…».

Auth modals (same file):
- **ورود** «🔐 ورود به پیشخوان پُست‌یار»: نشانی ایمیل، رمز عبور، «سوال امنیتی ضد ربات» math captcha (e.g. «۵ + ۳ = ؟»), CTA «ورود به حساب کاربری 🔑». POST `/login`.
- **ثبت‌نام** «✨ ساخت حساب کاربری جدید»: نام و نام خانوادگی، نشانی ایمیل، «نام کسب‌وکار», «نوع فعالیت», «رمز عبور امن» (حداقل ۸ کاراکتر), «تکرار رمز عبور», math captcha, hidden `ref` from `?ref=`, **required privacy-consent checkbox** linking «سیاست حریم خصوصی پُست‌یار», CTA «ایجاد حساب کاربری ✨». POST `/register`.
- Validation is minimal (HTML `required`); server messages surface as `$message` alert or redirect param. No inline field-level Persian validation messages in markup.

---

## 6) Persian vocabulary glossary (use these verbatim in the new UI)

| Concept | Persian used in product |
|---|---|
| Channel | «کانال» (verbs: «اتصال کانال جدید», «کانال‌های متصل شده», «کانال‌های هدف») |
| Platform | «پلتفرم پیام‌رسان»; Telegram = «تلگرام» / ✈; Bale = «بله» / 💬 (also «بله (Bale)») |
| Bot token | «توکن ربات (Bot Token)», «توکن دریافتی از BotFather», «توکن بات» |
| Publish | «انتشار», «ارسال پست جدید», «انتشار و زمان‌بندی پست», «پابلیش شده» (landing only) |
| Publish types | «ارسال آنی و سریع ⚡» (instant) / «زمان‌بندی ارسال خودکار ⏰» (scheduled) |
| Scheduled queue | «صف انتظار و پست‌های زمان‌بندی‌شده»; statuses «در صف ارسال ⏳», «زمان‌بندی‌شده 📅», «پیش‌نویس 📝», «در انتظار ارسال ⏳», «ارسال شده ✔», «خطا در ارسال ❌» |
| Gold robot | «ربات طلا و سکه», «ربات خودکار نرخ لحظه‌ای طلا و سکه», «نرخ لحظه‌ای», «طلا ۱۸ عیار», «سکه بهار آزادی/امامی», «انس جهانی», «شلیک خودکار» |
| Wallet | «کیف پول», «موجودی کیف پول», «تراکنش‌ها» (typo «تراکش‌های» in one heading), «واریز/برداشت/کش‌بک/تبدیل امتیاز» |
| Points | «امتیاز», «امتیازات», «هر ۱۰ امتیاز = ۱۰ تومان» |
| Subscription | «اشتراک», «پلن (اشتراکی)», «خرید اشتراک», «ارتقا و تمدید اشتراک», «تاریخ اتمام/اعتبار تا», «بدون انقضا», «نامحدود» |
| Discount | «تخفیف», «تخفیف مناسبتی», «تخفیف ویژه», «تخفیف تمدید پیش از موعد», «کدهای تخفیف» |
| Referral | «زیرمجموعه‌گیری» (main term), «کد معرف», «لینک دعوت», «زیرمجموعه‌ها», «پاداش», «در انتظار خرید», «معرفی دوستان» |
| Analytics | «تحلیل آمار تفکیکی», «بازدید کل (کلیک)», «کلیک‌های یکتا», «نرخ تعامل», «آمار» |
| Support | «پشتیبانی و تیکت‌ها», «تیکت», «موضوع تیکت», «دسته‌بندی تیکت», «در انتظار پاسخ ⏳», «پاسخ داده شده ✔», «بسته شده», «مختومه کردن» |
| Inbox | «صندوق پیام», «صندوق پیام‌های دریافتی», «فرستنده» |
| Auto-responder | «پاسخگوی خودکار», «پاسخگوی کلمات کلیدی», «کلمه کلیدی», «متن پاسخ خودکار», «حالت پاسخگویی» |
| Notifications | «اعلان‌ها», «اعلان همگانی», «پیام همگانی مدیریت», «اعلان‌های مرورگر», «فعال‌سازی اعلان‌ها» |
| AI | «هوش مصنوعی», «کپشن‌ساز هوش مصنوعی», «کپشن‌ساز», «مدل دلخواه», «سرویس هوش مصنوعی» |
| WooCommerce | «ووکامرس», «اتصال ووکامرس», «انتشار خودکار محصول جدید», «واترمرک» |
| Payment | «کارت به کارت», «کد رهگیری / شماره ارجاع تراکنش», «رسید پرداخت», «فیش واریزی», «تایید/تأیید», «بلو لینک», «بلو بانک» |
| Account | «تنظیمات حساب», «ویرایش پروفایل کاربری», «کلمه عبور» (not «رمز عبور» in settings; register uses «رمز عبور امن»), «خروج از حساب» |
| Tenancy | «مستأجر» (tenant), «کاربر عادی (مستأجر)», «پشتیبان (فقط تیکت‌ها)», «مدیر ارشد پلتفرم 👑», «پیام مدیر سیستم 👑» |
| Date/time | «تقویم شمسی», «تاریخ انقضا (شمسی)», «زمان‌بندی شمسی», «امروز شمسی», time-ago «همین الان / N دقیقه پیش / N ساعت پیش / N روز پیش» |
| Buttons | «انتخاب این پلن», «ذخیره…✔», «انصراف», «حذف 🗑», «ویرایش ⚙», «لغو و حذف», «مشاهده», «ارسال», «کپی 📋» |
| Brand | «پُست‌یار» (with ZWNJ/ُ) — but inconsistent «پستیار» also on landing/help |

---

## 7) Jalali / digits / format utilities found

**Server-side (`app/Domain/TextFormat.php`) — the canonical formatter:**
- `fa_num($num)` → `number_format` thousands + Persian digits (prices/amounts).
- `fa_digits(str)` → Latin→Persian digit map (dates, counts, codes).
- `en_num($val)` → Persian **and Arabic** digits → Latin, strips `٬ ، ,` spaces and non-numeric (used for gold API values and captcha answers).
- `g2j(gy,gm,gd)` → embedded jalaali algorithm (no Carbon/Verta dependency).
- `mysql_to_jalali($date, $from_utc=true)` → `Y/m/d - H:i` in Persian digits; UTC→Asia/Tehran for CURRENT_TIMESTAMP fields, passthrough for PHP-written fields (`scheduled_at`, `end_date`). **Two time-zone semantics — must be preserved.**
- `now_jalali()`, `jalali_month_name()` (فروردین…اسفند), `timeAgo()` («همین الان»…, falls back to Jalali after a week), `format_price()` (rial→toman ÷10; oz→دلار).
- Views call it as `\WHCM\Domain\TextFormat::fa_digits(...)` everywhere (not localized helpers).

**Client-side:**
- `utils.js` `toFaDigits()` + `autoConvertToPersianDigits()` TreeWalker converts leftover Latin digits after render (dashboard+admin only, NOT landing).
- JS price formatting: `price.toLocaleString('fa-IR')` (`dashboard.js:249`, `admin.js:109`, `dashboard.js:579` badge).
- `toPersianDateStr()` + `2099` sentinel → «بدون انقضا / دائمی» (used by mobile API; low usage in web views).

**Jalali datepicker flow:**
- Inputs marked `data-jdp` + `readonly` (sched_date, profile birthday, discount expiry). Library init after DOM: dashboard `startWatch({minDate:"today", showTodayBtn:true, showEmptyBtn:false})`; admin `startWatch({separatorChar:'/', openOnFocus:true, showTodayBtn:true})` with 200 ms retry. Dark skin forced by `components.css` `.jdp-container !important` overrides. Hours/minutes are native `<select>`s with Persian-digit labels — date and time are separate fields, submitted as `sched_date` + `sched_hour` + `sched_minute`.

---

## 8) API endpoints consumed by the UI

**Form POSTs (PHP views, CSRF field included):**
`/login`, `/register`, `/dashboard/add-post`, `/dashboard/edit-channel`, `/dashboard/add-channel`, `/dashboard/submit-payment`, `/dashboard/update-profile`, `/dashboard/change-password`, `/dashboard/trigger-gold-publish`, `/dashboard/add-ticket`, `/dashboard/reply-ticket`*, `/dashboard/close-ticket`* (*registered in `Modules/Support/Routes.php`), `/dashboard/convert-points`, `/hnnh/add-user-manual`, `/hnnh/grant-subscription-manual`, `/hnnh/create-plan`, `/hnnh/edit-plan`, `/hnnh/save-gold-settings-admin`, `/hnnh/save-ai-settings-admin`, `/hnnh/add-discount`, `/hnnh/delete-discount`, `/hnnh/save-responder-settings-admin`, `/hnnh/save-woo-settings-admin`, `/hnnh/broadcast-announcement`, `/hnnh/save-bank-settings`, `/hnnh/save-referral-settings`, `/hnnh/save-sms-config`, `/hnnh/save-sms-template`, `/hnnh/delete-sms-template`, `/hnnh/test-sms`, `/hnnh/send-bulk-sms`, `/hnnh/save-email-config`, `/hnnh/save-email-template`, `/hnnh/delete-email-template`, `/hnnh/test-email`, `/hnnh/send-bulk-email`, `/hnnh/preview-email-template`, `/hnnh/reply-ticket`, `/hnnh/close-ticket`, `/hnnh/reopen-ticket`, `/hnnh/delete-ticket`, `/hnnh/create-ticket`, `/reset-password*`, `/verify-sms-code`.

**GET state-change links (see finding S-2):** `/dashboard/delete-channel?id=`, `/hnnh/suspend-user?id=`, `/hnnh/activate-user?id=`, `/hnnh/delete-user?id=`, `/hnnh/approve-payment?id=`, `/hnnh/delete-plan?id=`; edit links `?edit_channel=`, `?edit_plan=`.

**XHR (dashboard.js / admin.js / push.js), all via `index.php?route=`:**
`/dashboard/mark-announcement-read`, `/dashboard/cancel-post`, `/api/process-post-queue`, `/dashboard/add-auto-reply`, `/dashboard/delete-auto-reply`, `/dashboard/toggle-responder`, `/api/heartbeat` (60 s interval), `/dashboard/mark-notification-read`, `/dashboard/mark-all-notifications-read`, `/dashboard/save-gold-settings` (FormData), `/dashboard/save-advanced-settings` (FormData), `/hnnh/save-ticket-categories`, `/api/push/vapid-key`, `/api/push/subscribe`, `/api/push/unsubscribe`, `/api/push/status`.

**External (client-side):** AI provider URLs (config only, not called from browser); Blu-bank deep links (`blubank://transfer` …); `mailto:` support; TGJU etc. only referenced as placeholders. **The mobile API `/api/v1/*` is NOT consumed by these web views.**

---

## 9) Security / quality findings (file:line evidence)

### Security
- **S-1 (High) — Stored XSS via ticket transcript innerHTML.** `dashboard.js:299-321` (`openTicketModal`) and `admin.js:167-188` (`openAdminTicketModal`) build bubbles with `bubble.innerHTML = header + text.replace(/\n/g,"<br>")` where `text` is the raw ticket message/reply (user-controlled). No `textContent`/escaping. A user can plant `<img src=x onerror=…>` in a ticket; it executes in the super-admin console when viewing the ticket. Fix in new frontend: render as text nodes / sanitize.
- **S-2 (High) — State-changing GET links.** `index.php:167-171` registers GET handlers; anchors at `admin.php:295-299` (suspend/activate/delete user), `admin.php:646-647` (edit/delete plan), `admin.php:426` (approve payment), `dashboard.php:661,683` (delete channel). No CSRF token, prefetchable, confirm() bypassable. New UI must use POST + CSRF for all mutations.
- **S-3 (Medium) — Secrets echoed into HTML.** Tenant AI key rendered in a visible `type=text` input `dashboard.php:1315`; admin global AI key in `type=password` but value-echoed `admin.php:749`; bot token value-echoed `dashboard.php:575` (type=password). Any XSS amplifies to credential theft; keys should be write-only.
- **S-4 (Medium) — Raw echo of server-provided values.** `$captcha_question` `home.php:793,840`, `$announcement['date']` `dashboard.php:223` (no htmlspecialchars; currently server-generated — safe today, fragile tomorrow). Generally escaping discipline is good (user data passes through `htmlspecialchars`; `json_encode(..., JSON_HEX_*)` for onclick embedding at `dashboard.php:1039`, `admin.php:292,1237,1463-1464`).
- **S-5 (Low) — `admin.php:1463` embeds `$ticket_categories`/`$support_agents` JSON unescaped into `<script>`** (JSON_UNESCAPED_UNICODE without JSON_HEX); a category title containing `</script>` would break out. Same class as S-1.
- **S-6 (Low) — No security headers**: `.htaccess` has no CSP/X-Frame-Options/X-Content-Type-Options; admin `manifest.json` static fallback (admin.php:11).
- **S-7 (Info) — Buried capability prefix**: admin lives at `/hnnh` (security by obscurity); views reference it in markup (fine, but new UI should not rely on path secrecy).
- **S-8 (Info) — DB access inside views** (`dashboard.php:924-929,1166-1172,1360-1375,1397-1404,1422-1432,1503-1512`; `admin.php:461-468,1003-1017,1076-1115`) — hard to port; the React frontend must get this via APIs.

### Quality / UX / a11y
- **Q-1 — Persian typos in shipped UI**: «وضعت» (`dashboard.php:1582,1591`), «پاین» (1591), «سابق اشتراک‌ها» (1589), «تراکش‌های پرداخت» (1580), «تاید» (1584 ×2); brand spelled «پستیار» without ُ in help/landing body text; «پابلیش شده» (home.php:175).
- **Q-2 — Inline-style explosion**: 106 inline `onclick` handlers across views (dashboard 44, admin 40, home 14, partials 8); hundreds of `style="…"` attributes (e.g. dashboard header 44-93); 3 full inline `<style>` documents (help/privacy/errors) + 9 inline `<script>` blocks. Some CSS was extracted with comments admitting it («Bell Popup & Header Overrides (extracted from inline <style>)» `dashboard.css:1644`, `admin.css:572`).
- **Q-3 — a11y**: `viewport … maximum-scale=1.0, user-scalable=no` (`dashboard.php:5`, `admin.php:5`); menu items are `<div onclick>` (no `role`, no `tabindex`, no keyboard) `dashboard.php:101-121`, `admin.php:112-127`; emoji as sole iconography inside labels; modals lack `role="dialog"`/focus trap (except PWA banner has aria-label `pwa-install.js:55`); no `aria-live` for toasts; FAQ buttons OK-ish; color-only status signals.
- **Q-4 — Dead/duplicated code**: `manifest.json` legacy + only admin links it; `toPersianDateStr` largely unused in web views; admin.js:237-255 fake analytics card (counts DOM rows, mislabeled «کل پست‌های ارسالی»); admin.js:200-215 layout re-parenting hack; duplicate SW registration blocks ×3; `home.css:164` references leftover "Uiverse Cobp/old-cat-57".
- **Q-5 — Fake chart**: dashboard hero chart is a static SVG with invented paths (`dashboard.php:296-322`) while real click metrics exist — reputational/UX risk.
- **Q-6 — Mixed cache-busting**: dashboard assets `?v=13`, admin/home/js none → stale-cache incidents.
- **Q-7 — No pagination**: users/payments/tickets/plans tables render unbounded rows (admin table scroll `max-height:520px` only).
- **Q-8 — Error surfaces**: `alert()`/`confirm()` used for critical confirmations (cancel post, delete auto-reply, Blu-bank missing); toasts inconsistently used.

---

## 10) Recommendations for the new Vite+React+TS frontend

1. **Preserve the IA and Persian vocabulary 1:1** (§3, §4, §6) — sidebar order, section ids (`dashboard, publish, channels, ticker, responder, tickets, inbox, settings, advanced-settings, upgrade, referral, wallet`), feature gating contract (`features.stats/gold_ticker/auto_responder/woocommerce/ai_caption`, `max_posts===0 → نامحدود`).
2. **Keep the color system**: port `:root` tokens (indigo #6366f1 / slate dark #0f172a/#1e293b / success #10b981 / warning #f59e0b / danger #ef4444) into Tailwind config; keep Vazirmatn self-hosted (8 weights) with `font-display:swap`; `dir=rtl` + `lang=fa-IR` at the root; keep emoji-in-label tone or replace with a consistent icon set — but keep the playful copy.
3. **Digits & dates**: implement a single `faDigits()`/`faNumber()` util + Jalali lib (e.g. `jalaali-js` or `dayjs-jalali`) reproducing `Y/m/d - H:i` format and the **UTC vs Asia/Tehran field semantics**; keep `<select>` HH/MM separate from the Jalali picker; render all counts/prices in Persian digits by default (allow toggle for codes/tracking numbers like the current `dir-ltr` inputs).
4. **Fix S-1/S-2/S-3 by design**: no `innerHTML` from user text (use React text nodes), all mutations POST via API with CSRF/auth token, secrets write-only (masked, never re-rendered).
5. **Replace polling with the same contract first, then improve**: `/api/heartbeat` (60 s), `/api/process-post-queue` (5×2 s backoff), notification read marks — wrap in a `useHeartbeat` hook; later consider SSE/WebSocket server-side.
6. **Charts**: the existing SVG chart is fake; build a real chart (Recharts/ECharts) bound to click/unique-click data per channel; reuse the legend labels «میزان کلیک‌ها (تک کلیک)» / «میزان کلیک‌های یکتا».
7. **PWA parity**: keep manifest.php semantics (RTL, fa-IR, theme #6366f1, maskable icons, «داشبورد» shortcut), SW cache-first static + network-only pages, push payload `{title,body,url}`; consolidate SW registration in one place; use one dynamic manifest (drop static manifest.json).
8. **Accessibility baseline**: keyboard-operable menus (`<button>`/`<a>` + roles), focus-trapped dialogs, `aria-live` toasts, remove `user-scalable=no`, visible focus rings, real text alternatives for emoji-only icons.
9. **Form UX**: reuse field labels/placeholders from §3/§5 verbatim; add proper Persian inline validation (the old UI only had `required` + server messages); keep math-captcha concept but server-render the question and escape it.
10. **Content cleanup**: fix the typos in Q-1, unify brand spelling «پُست‌یار», replace the fake «آمار تفکیکی» card and static landing stats with real values or remove, add pagination and consistent Persian empty states («هنوز … نشده است.» pattern).

---
*End of audit — Task 02-b.*

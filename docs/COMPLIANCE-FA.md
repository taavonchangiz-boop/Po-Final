# COMPLIANCE-FA — Persian / Persian digits / Jalali audit

Task `6-fa` · scope: `frontend/src/**` + `wordpress-plugin/postyar-connector` UI · contract: `docs/PRODUCT-SPEC.md §5` (100% Persian copy · Persian digits ۰–۹ for all visible numbers · Jalali dates everywhere · RTL · Vazirmatn).
Kernel: `frontend/src/lib/format.ts` (toFa/toEn, faNumber, faMoney, faPercent, faCompact, faDate, faDateTime, faDateLong, relativeTimeFa, jalaliToGregorianISO, JALALI_MONTHS, label maps).

## Audit checklist

| # | Area | Method | Result |
|---|------|--------|--------|
| 1 | `toLocaleDateString/toLocaleString/toLocaleTimeString` | rg over frontend/src | **PASS** — 0 hits (no locale-dependent formatting anywhere) |
| 2 | `toISOString()` rendered to users | rg + manual read | **PASS** — 3 hits, all outbound payloads/state, never rendered (JalaliPicker onChange → API; notifications readAt store) |
| 3 | `new Date(...)` interpolated raw into text | rg + manual read | **PASS** — all render paths go through faDate/faDateTime/faDayLabel/faMonthLabel; SubscriptionPage `daysRemaining` feeds `toFa(remaining)`; analytics helpers convert via toJalaali before output |
| 4 | Jalali correctness (round-trip) | bun one-liner on real lib | **PASS** — `toJalaali(2025,3,21) → {1404,1,1}` and `toGregorian(1404,1,1) → {2025,3,21}` (jalaali-js via lib/format kernel) |
| 5 | JalaliPicker | code review | **PASS** — Persian month names (JALALI_MONTHS), Persian-digit year/day/HH:mm, Jalali preview, day clamped to `jalaaliMonthLength`, exports UTC ISO for API |
| 6 | Chart axis/tooltip digits | code review Chart.tsx | **PASS** — `fmtAxis` = faNumber/faCompact on Y ticks; `<title>` tooltips use faNumber; Donut legend uses faNumber + '٪'; Persian aria-labels |
| 7 | Pagination | code review | **PASS** — `faNumber(p)` on buttons + `aria-label=صفحه …` |
| 8 | Stat / counters / length indicators | rg `toFa(` | **PASS** — char counters (`toFa(body.length) از ۵۰۰۰`), attempts (`تلاش … از …`), unread badge, quota hints all use faNumber/toFa |
| 9 | Countdown / days-remaining | code review | **PASS** — SubscriptionPage `· X روز باقی‌مانده` via toFa |
| 10 | Raw enum leaks (`TELEGRAM`, `PENDING`, …) | rg for raw interpolation + all `<Badge` sites | **PASS** — every Badge state has a Persian labels map; every provider/role/gateway/wallet/payment/ticket/workflow/AI/event type goes through `labelOf(map, …)`; fallback in `labelOf` returns key (safe) |
| 11 | Latin digits in JSX text nodes | rg `>[^<>{}]*\d[^<>{}]*<` | **FIXED** — 2 MAJOR: `GoldPage.tsx` `کانال #${String(c.id)}` and `AnalyticsPage.tsx` `ربات #${String(bot.id)}` showed Latin-digit IDs → both wrapped in `toFa()`; remaining hits are Persian-digit literals (۱۸/۲۴ عیار, ۱/۲/۳ steps, UTC+۰۳:۳۰) |
| 12 | IDs shown to users | rg `#${String(`/`#${\w` | **FIXED** — same two sites as #11; all other `#ID` strings already use `toFa` (tickets, payments, AI jobs, channels, bots, admin audit subject) |
| 13 | English UI strings in JSX | rg Latin-only text nodes + action-word lists | **PASS** — only brand/technical proper nouns remain (OpenAI/Gemini/Claude…, `<TH>IP</TH>`); all actions/states/toasts Persian |
| 14 | Placeholders / titles / aria-labels in English | rg `aria-label="[A-Za-z]`, `placeholder="[A-Za-z]`, `title="[a-z]` | **PASS** — only technical examples (`https://…`, `https://example.com`, `gpt-4o-mini`); all aria-labels Persian (nav, pagination, notifications, JalaliPicker fieldset, charts, spinner) |
| 15 | usePageTitle coverage | rg all page components | **PASS** — every route page sets a Persian title (Overview, Publishing, Scheduling, Channels, Bots, BotDetail, Workflows, AI, Gold, Woo, Analytics, Wallet, Subscription, Referrals, Support, Settings, Notifications, Admin ×4, Landing, guards); suffix «| پُستیار» |
| 16 | index.html lang/dir + meta | read | **PASS** — `lang="fa" dir="rtl"`, Persian `<title>`/description, Vazirmatn preloads |
| 17 | Landing copy quality | read LandingPage | **PASS** — native, coherent marketing Persian; hero/FAQ/pricing all Persian; Persian-digit KPI mock (۱۲٬۴۸۰ / ۹۸٫۲٪ / ۶); only `postyar.ir/app` chrome-mock URL is Latin (intentional) |
| 18 | WordPress plugin `assets/js/admin.js` | code review | **PASS** — self-contained `toFa` + inline Gregorian→Jalali converter; `.postyar-jalali[data-ts]` timestamps rendered Jalali+Persian digits; Persian fallback strings |
| 19 | WordPress plugin admin classes | code review class-postyar-admin/settings | **PASS** — Persian headings/labels/table columns, i18n strings Persian, log table renders status/event via Persian label maps + Jalali time spans |
| 20 | typecheck + build | `bun run typecheck` / `bun run build` | **PASS** — exit 0 / exit 0 |

## Violations found & fixes applied

| Severity | Count | Detail |
|----------|-------|--------|
| BLOCKER | 0 | — |
| MAJOR | 2 (fixed) | Latin-digit user-visible IDs: `frontend/src/features/gold/GoldPage.tsx:457`, `frontend/src/features/analytics/AnalyticsPage.tsx:129` → `toFa(String(id))` |
| MINOR | 3 (open, accepted) | see below |

Files changed: `frontend/src/features/gold/GoldPage.tsx`, `frontend/src/features/analytics/AnalyticsPage.tsx` (one-line each; `toFa` already imported in both). No restructuring; `app/src` untouched; `lib/format.ts` untouched (no missing formatter).

## Remaining MINOR items (accepted, no code change)

1. **AuthModal phone placeholders `09123456789` (Latin digits)** — format hint inside an LTR phone field; the entered value is normalized to Latin digits via `toEn` for the API, so the placeholder deliberately mirrors the expected input format.
2. **Referral share text `${code}`** — referral code is a copy-paste token; converting to Persian digits would break clipboard semantics.
3. **AdminPlansPage `کد پلن: ${editing.code}`** — deliberately shows the stable plan *code* (FREE/PRO…) to admins; Persian display names are used everywhere else via `planLabels`.
4. (info) `faDateLong` / `relativeTimeFa` are exported from the kernel but currently unused by pages — available for future copy, not a violation.

## Verification

- `bun run typecheck` → **exit 0**
- `bun run build` → **exit 0** (vite build ✓ built in 2.62s)

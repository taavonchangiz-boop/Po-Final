# ASSET-INVENTORY.md — Postyar Brand & Asset Audit (Task 04)

- Auditor: Agent 04 (Product Intelligence / Assets)
- Reference (READ-ONLY): `/home/z/postyar-build/po.source` @ 67a83e2e9034bcabbf87e17daa9336e1f3aac62f
- Destination tree: `/home/z/postyar-build/postyar-production-final/assets/brand/`
- Method: sha256sum for duplication; PNG/WebP dimensions parsed from binary headers (IHDR / VP8 / VP8L / VP8X); UI references found by grepping `app/Views/*`, `public/manifest.json`, `public/manifest.php`, `public/service-worker.js`, `public/assets/css/*`, `public/assets/js/pwa-install.js`.

---

## 1. Canonical set copied into the new tree

`assets/brand/` = the **po/** canonical set (byte-identical copies, verified by sha256), plus the WP-plugin font pair in `fonts/wp/`.

```
assets/brand/
├── fonts/   (8 × Vazirmatn woff2)
│   └── wp/  (2 × Vazirmatn woff2 — WP plugin variants, different hashes)
├── icons/   (15 × PNG)
└── images/  (5 × WebP)
```

**30 files copied, 0 modified.** All 25 po/ copies hash-match their source; the 2 wp/ copies hash-match `woo-hooman-channel-manager/assets/fonts/`.

---

## 2. Complete inventory table

Sizes in bytes; dimensions verified from file headers (not filename trust).

### 2.1 images/ (WebP logos)

| Path (assets/brand/…) | Format | Bytes | Dimensions | Apparent role | Duplicate in asovin assets? |
|---|---|---|---|---|---|
| images/logo.webp | WebP | 15,276 | 200×200 | Square mark — generic avatar/fallback icon (SW precache only) | ✅ identical (`441a2966…`) |
| images/logo-white-bg.webp | WebP | 7,020 | 200×200 | Square mark on white plate — UI sidebars/headers on dark panels | ✅ identical (`d3abdec8…`) |
| images/logo-full.webp | WebP | 42,978 | 600×328 | Full lockup (mark + wordmark) — hero & pre-footer | ✅ identical (`9e570c53…`) |
| images/logo-full-white-bg.webp | WebP | 20,454 | 600×328 | Full lockup on white plate — **NOT referenced anywhere in reference UI** (kept for offline/print use) | ✅ identical (`b284827c…`) |
| images/asovin.webp | WebP | 181,340 | 1024×1536 | “آسوین” branded illustration/mascot (portrait) — home hero + help page | ✅ identical (`8eb776e4…`) |

> Hash note: `asovin.webp` = `8eb776e4…` in both sets (identical to each other). `logo.webp` = `441a2966…`. The table’s “identical” column refers to po/ ↔ asovin duplication, which is 100% for all 25 shared files.

### 2.2 icons/ (PNG — favicon, apple-touch, PWA)

| Path | Format | Bytes | Dimensions | Role | Duplicate? |
|---|---|---|---|---|---|
| icons/favicon-16x16.png | PNG | 834 | 16×16 | Browser tab favicon (small) | ✅ identical (`af73bbfa…`) |
| icons/favicon-32x32.png | PNG | 2,114 | 32×32 | Browser tab favicon (standard) | ✅ identical (`3dcb16f2…`) |
| icons/apple-touch-icon.png | PNG | 22,442 | 180×180 | iOS home-screen icon (default) | ✅ identical (`df92caac…`) |
| icons/apple-touch-icon-167x167.png | PNG | 20,041 | 167×167 | iOS Pro/iPad touch icon | ✅ identical (`948652de…`) |
| icons/icon-72x72.png | PNG | 7,639 | 72×72 | PWA manifest icon + push **badge** | ✅ identical (`d6ac7426…`) |
| icons/icon-96x96.png | PNG | 12,035 | 96×96 | PWA manifest icon | ✅ identical (`49508ab8…`) |
| icons/icon-120x120.png | PNG | 18,785 | 120×120 | iOS legacy touch icon (spare) | ✅ identical (`22bd1869…`) |
| icons/icon-128x128.png | PNG | 18,522 | 128×128 | PWA manifest icon (Chrome store size) | ✅ identical (`da73b257…`) |
| icons/icon-144x144.png | PNG | 22,119 | 144×144 | PWA manifest icon | ✅ identical (`36601c66…`) |
| icons/icon-152x152.png | PNG | 28,624 | 152×152 | PWA manifest + apple-touch 152 | ✅ identical (`450da621…`) |
| icons/icon-192x192.png | PNG | 43,673 | 192×192 | PWA manifest “any” + install prompt + push icon | ✅ identical (`5da12542…`) |
| icons/icon-384x384.png | PNG | 100,759 | 384×384 | PWA manifest icon | ✅ identical (`e6a64438…`) |
| icons/icon-512x512.png | PNG | 274,845 | 512×512 | PWA manifest “any” + iOS splash (`apple-touch-startup-image`) | ✅ identical (`29e532e5…`) |
| icons/icon-192x192-maskable.png | PNG | 20,333 | 192×192 | PWA maskable (safe-zone padding) | ✅ identical (`0281f46d…`) |
| icons/icon-512x512-maskable.png | PNG | 95,555 | 512×512 | PWA maskable (safe-zone padding) | ✅ identical (`5013bd5f…`) |

All filenames match their real pixel dimensions. Filename-declared sizes are trustworthy.

### 2.3 fonts/ (woff2 — Vazirmatn, Persian UI typeface)

| Path | Format | Bytes | Weight (per components.css) | Role | Duplicate? |
|---|---|---|---|---|---|
| fonts/Vazirmatn-Thin.woff2 | woff2 | 50,568 | 100 | Display extremes | ✅ identical (`e65a0552…`) |
| fonts/Vazirmatn-Light.woff2 | woff2 | 51,180 | 300 | Body-light | ✅ identical (`a3aa104f…`) |
| fonts/Vazirmatn-Regular.woff2 | woff2 | 50,684 | 400 | Base body text | ✅ identical (`e3821013…`) |
| fonts/Vazirmatn-Medium.woff2 | woff2 | 51,128 | 500 | Emphasis / SW-precached | ✅ identical (`3333e311…`) |
| fonts/Vazirmatn-SemiBold.woff2 | woff2 | 51,032 | 600 | Headings-light | ✅ identical (`6a39a3c2…`) |
| fonts/Vazirmatn-Bold.woff2 | woff2 | 51,020 | 700 | Headings / buttons | ✅ identical (`836fae7d…`) |
| fonts/Vazirmatn-ExtraBold.woff2 | woff2 | 51,120 | 800 | Hero headings | ✅ identical (`cd67558b…`) |
| fonts/Vazirmatn-Black.woff2 | woff2 | 50,568 | 900 | Hero display | ✅ identical (`e65a0552…` ≠ Thin — both 50,568 B but different hashes) |

### 2.4 fonts/wp/ (WP-plugin variants — **different hashes, kept separately**)

| Path | Format | Bytes | Weight | sha256 (prefix) | vs po/fonts equivalent |
|---|---|---|---|---|---|
| fonts/wp/Vazirmatn-Regular.woff2 | woff2 | 79,984 | 400 | `c6fdca06…` | **DIFFERENT** (po: `e3821013…`, 50,684 B) |
| fonts/wp/Vazirmatn-Bold.woff2 | woff2 | 80,964 | 700 | `2d768316…` | **DIFFERENT** (po: `836fae7d…`, 51,020 B) |

The WP-plugin pair (~80 KB each) is ~60% larger than the po/ pair (~50 KB) — likely un-subset/full-glyph builds vs. the app’s subset builds. They are **not interchangeable**; the WP plugin must keep loading its own files (`assets/fonts/…` relative to the plugin CSS, with declared woff/ttf fallbacks that do **not** exist in the repo — woff2-only).

---

## 3. Duplication summary (po/ ↔ asovin/asovin/public/assets/)

- **100% duplication.** All 8 fonts + 15 icons + 5 images in `asovin/asovin/public/assets/{fonts,icons,images}` are **byte-identical** (sha256) to `po/fonts`, `po/icons`, `po/images`.
- Consequence: `po/` is purely the extracted brand kit; `asovin/…/assets/` is the deployed copy. The new tree keeps **one** canonical copy (`assets/brand/`) — no need to duplicate again.
- Only genuinely distinct asset files in the corpus: the WP plugin’s two font builds (different hashes — see 2.4).

## 4. Where the reference UI references each asset

| Asset | Referenced in (file:line) | Context |
|---|---|---|
| `images/logo-white-bg.webp` | `app/Views/home.php:42` (header nav), `home.php:754` (footer brand box), `home.php` CTA, `admin.php:61` (sidebar header), `dashboard.php:39` (sidebar header), `privacy.php:74` (page header) | Square mark on white plate inside dark sidebar/header/footer panels |
| `images/logo-full.webp` | `home.php:129` (hero), `home.php:731` (pre-footer CTA), `privacy.php:303` (footer branding) | Full lockup, large display surfaces |
| `images/asovin.webp` | `home.php:161` (hero illustration, h≈200px), `help.php:69` (help hero, h≈140px) | Portrait mascot/illustration beside hero copy |
| `images/logo.webp` | `public/service-worker.js:24` (precache list only) | Generic square mark — never rendered in any view |
| `images/logo-full-white-bg.webp` | — | **No references anywhere** (orphan variant) |
| `icons/favicon-32x32.png` / `-16x16.png` | `home.php:16-17`, `admin.php:15-16`, `dashboard.php:15-16`, `help.php:9-10`, `privacy.php:15` | `<link rel="icon">` on every page |
| `icons/apple-touch-icon.png` | `home.php:19`, `admin.php:18`, `dashboard.php:18` | iOS default touch icon |
| `icons/icon-152x152.png` | `home.php:20`, `admin.php:19`, `dashboard.php:19` | apple-touch 152 |
| `icons/apple-touch-icon-167x167.png` | `home.php:21` | iPad touch icon |
| `icons/icon-512x512.png` | `home.php:26` | `apple-touch-startup-image` (iOS splash) |
| `icons/icon-{72,96,128,144,152,192,384,512}.png` | `public/manifest.php:42-84` | Full PWA manifest icon ladder (`purpose: any`) |
| `icons/icon-{192,512}-maskable.png` | `manifest.php:91-100`, `manifest.json:29-38` | Maskable icons (80% safe zone per comment) |
| `icons/icon-{192,512}.png` | `public/manifest.json:17-23` | Static manifest.json icon ladder |
| `icons/icon-192x192.png` | `public/assets/js/pwa-install.js:59`, `service-worker.js:27,124` | Install-prompt image + push notification icon |
| `icons/icon-72x72.png` | `service-worker.js:125` | Push notification **badge** |
| fonts Regular/Bold/Medium | `service-worker.js:33-35` | Precache list |
| fonts all 8 weights | `public/assets/css/components.css:1-53` | `@font-face` ladder 100→900 |
| fonts R/M/B/Black | `app/Views/help.php:12-15` | Standalone help page face set |
| fonts R/B/Black | `app/Views/privacy.php:17-19` | Standalone privacy page face set |
| fonts wp Regular/Bold | `woo-hooman-channel-manager/assets/css/admin.css:4-17` | WP admin UI `@font-face` (woff/ttf fallbacks declared but absent) |

## 5. Favicon / PWA icon mapping (keep for the new product)

| Surface | File |
|---|---|
| Browser favicon | `favicon-32x32.png` (+ `favicon-16x16.png`) |
| iOS home screen | `apple-touch-icon.png` (180), `apple-touch-icon-167x167.png`, `icon-152x152.png` |
| iOS splash | `icon-512x512.png` |
| PWA manifest `purpose: any` | 72 / 96 / 128 / 144 / 152 / 192 / 384 / 512 |
| PWA manifest `purpose: maskable` | `icon-192x192-maskable.png`, `icon-512x512-maskable.png` |
| Push notification icon / badge | `icon-192x192.png` / `icon-72x72.png` |
| Service-worker precache icons | 192, 512, apple-touch-icon, favicon-32 |

Manifest identity (for the new manifest): `theme_color: #6366f1` (indigo), `background_color: #0a0a0a`, `dir: rtl`, `lang: fa-IR`, display standalone, portrait.

## 6. Font weight list

- **App set (components.css):** 100 Thin, 300 Light, 400 Regular, 500 Medium, 600 SemiBold, 700 Bold, 800 ExtraBold, 900 Black — 8 files, ~50 KB each, woff2-only.
- **Minimum viable set used by pages:** Regular 400, Medium 500, Bold 700 (SW precache), + Black 900 (privacy/help). A new build could ship just 400/500/700/900 to save ~100 KB.
- **WP set:** Regular 400 + Bold 700 only (larger, unsubset builds — keep in `fonts/wp/`, do not mix with app set).

## 7. Logo usage guidance for the new product

| Situation | Use |
|---|---|
| Dark sidebar / dark header / dark footer panel (small, square) | `logo-white-bg.webp` (mark on white plate — proven readable on dark UI) |
| Hero, pre-footer CTA, wide branding (has room for wordmark) | `logo-full.webp` |
| Light/white background where a white plate would look odd | `logo.webp` (transparent square mark) — also the generic fallback/avatar |
| Favicon / tab / push icon | PNG icons from `icons/` (never the WebP logos) |
| Standalone privacy/help/legal pages with minimal assets | `logo-white-bg.webp` header + `logo-full.webp` footer (matches reference pages) |
| `logo-full-white-bg.webp` | Unused orphan in reference UI; retained as backup for print/white contexts. Safe to drop or to adopt deliberately. |
| Dark background without plate | None of the current variants is a transparent-on-dark wordmark; if needed, produce a new white-wordmark variant. Reference UI always uses the white-bg plate instead. |
| `asovin.webp` | **Asovin-branded illustration** (1024×1536 portrait, 181 KB — heaviest asset). Contains the previous company brand (“آسوین”). Do NOT use in Postyar-facing surfaces; decide: rebrand/replace, or drop. Reference used it only for home hero + help decoration. |

## 8. Privacy / hygiene finding — committed user uploads (NOT copied)

`asovin/asovin/public/assets/` contains **runtime user uploads committed into the repo**:

- `plans/` — 4 paid-plan screenshots, WebP, 34–112 KB (`30aeb084464e563d.webp`, `61cbb7d13e4cd447.webp`, `img_6a7730719bee8.webp`, `img_6a77308d75d0e.webp`)
- `receipts/` — 6 payment receipts, WebP, 10–98 KB (`1f02cbf4622d8aa6.webp`, `43b7fa4ea9a121ce.webp`, `4eba2cdd6bb4d21a.webp`, `72e0ae51b33f1d45.webp`, `811785995389400e.webp`, `ca8b0f5fc8debeb8.webp` — three are 46,556 B, likely the same receipt uploaded multiple times)
- `uploads/` — 1 file (`227b4776b1772aed.webp`)

**Finding:** payment receipts and plan screenshots are private user data. They are readable by anyone with repo access — a privacy/compliance issue in the source repo. **None of these were copied into `postyar-production-final`.** The new tree must serve such uploads from a non-committed runtime directory and add `plans/`, `receipts/`, `uploads/` to `.gitignore`.

## 9. Copy manifest (verification)

- 25 files copied from `po/` → `assets/brand/{fonts,icons,images}/` — **all sha256-verified identical** to source.
- 2 files copied from `woo-hooman-channel-manager/assets/fonts/` → `assets/brand/fonts/wp/` — sha256-verified identical to their WP-plugin source, and confirmed **different** from the `po/fonts` equivalents (hence the separate `wp/` folder).
- Source tree untouched (read-only operations only).

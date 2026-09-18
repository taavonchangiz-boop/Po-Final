# Asset & Brand Audit — Postyar (Task 2-c)

Source of truth (READ-ONLY reference): `/home/z/my-project/reference/po.source/po/`
Audited: 28 files — 8 fonts (woff2), 15 icons (PNG), 5 logos (WebP).
Copied byte-identical into `postyar-production-final/assets/*` and `postyar-production-final/frontend/public/*`.

Dimensions verified two ways: `file` output cross-checked with a WebP RIFF container parser (VP8 / VP8L / VP8X headers per Google WebP container spec) — no guessed values.

---

## 1. Inventory

### Fonts — `assets/fonts/` + `frontend/public/fonts/` (8 files, 407,528 B)

| Path (po/fonts/) | Format | Dimensions | Bytes | Role (UI font weight) |
|---|---|---|---|---|
| Vazirmatn-Thin.woff2 | WOFF2 (TrueType, v33.197) | n/a (font) | 50,796 | Weight 100 — hairline display, optional |
| Vazirmatn-Light.woff2 | WOFF2 (TrueType, v33.197) | n/a (font) | 51,180 | Weight 300 — secondary/de-emphasized text, optional |
| Vazirmatn-Regular.woff2 | WOFF2 (TrueType, v33.197) | n/a (font) | 50,684 | Weight 400 — body text (ship) |
| Vazirmatn-Medium.woff2 | WOFF2 (TrueType, v33.197) | n/a (font) | 51,128 | Weight 500 — labels, buttons, nav (ship) |
| Vazirmatn-SemiBold.woff2 | WOFF2 (TrueType, v33.197) | n/a (font) | 51,032 | Weight 600 — card titles, emphasis (ship) |
| Vazirmatn-Bold.woff2 | WOFF2 (TrueType, v33.197) | n/a (font) | 51,020 | Weight 700 — headings (ship) |
| Vazirmatn-ExtraBold.woff2 | WOFF2 (TrueType, v33.197) | n/a (font) | 51,120 | Weight 800 — hero display, optional |
| Vazirmatn-Black.woff2 | WOFF2 (TrueType, v33.197) | n/a (font) | 50,568 | Weight 900 — largest display, optional |

Persian/Arabic-subset builds (~51 KB each — already well-sized; all 8 ≈ 408 KB, ship subset of 4 ≈ 204 KB). Exact per-file bytes are in the table.

### Icons — `assets/icons/` + `frontend/public/icons/` (15 files, 688,320 B)

| Path (po/icons/) | Format | Dimensions (px) | Bytes | Role |
|---|---|---|---|---|
| favicon-16x16.png | PNG RGBA | 16×16 | 834 | Browser tab favicon (small) |
| favicon-32x32.png | PNG RGBA | 32×32 | 2,114 | Browser tab favicon (standard/retina) |
| apple-touch-icon.png | PNG RGBA | 180×180 | 22,442 | iOS home-screen icon (default size) |
| apple-touch-icon-167x167.png | PNG RGBA | 167×167 | 20,041 | iPad Pro home-screen icon |
| icon-72x72.png | PNG RGBA | 72×72 | 7,639 | Android legacy Chrome manifest icon |
| icon-96x96.png | PNG RGBA | 96×96 | 12,035 | PWA shortcut / desktop icon |
| icon-120x120.png | PNG RGBA | 120×120 | 18,785 | iOS legacy touch icon |
| icon-128x128.png | PNG RGBA | 128×128 | 18,522 | Chrome Web Store / desktop shortcut |
| icon-144x144.png | PNG RGBA | 144×144 | 22,119 | Windows tile / Android mdpi |
| icon-152x152.png | PNG RGBA | 152×152 | 28,624 | iPad touch icon |
| icon-192x192.png | PNG RGBA | 192×192 | 43,673 | PWA manifest `purpose:any` (Android) |
| icon-192x192-maskable.png | PNG RGBA | 192×192 | 20,333 | PWA manifest `purpose:maskable` (Android) |
| icon-384x384.png | PNG RGBA | 384×384 | 100,759 | PWA intermediate density |
| icon-512x512.png | PNG RGBA | 512×512 | 274,845 | PWA manifest `purpose:any` (splash/hi-res) |
| icon-512x512-maskable.png | PNG RGBA | 512×512 | 95,555 | PWA manifest `purpose:maskable` (splash/hi-res) |

### Logos — `assets/images/` + `frontend/public/images/` (5 files, 267,068 B)

| Path (po/images/) | Format | Dimensions (px) | Bytes | Role |
|---|---|---|---|---|
| logo.webp | WebP VP8X extended, lossless inner, alpha | 200×200 | 15,276 | Square brand mark (transparent) — favicon-adjacent, header/auth mark |
| logo-white-bg.webp | WebP VP8 (lossy, no alpha — baked white bg) | 200×200 | 7,020 | Square brand mark, pre-composed for white/light surfaces |
| logo-full.webp | WebP VP8X extended, **ANIMATED**, alpha | 600×328 | 42,978 | Full logo lockup (mark + wordmark), transparent — hero/loading |
| logo-full-white-bg.webp | WebP VP8 (lossy, no alpha — baked white bg) | 600×328 | 20,454 | Full logo lockup, pre-composed for white/light surfaces |
| asovin.webp | WebP VP8X extended, alpha, contains EXIF | 1024×1536 | 181,340 | Parent-company (Asovin) brand asset — portrait; about/partner attribution use only |

---

## 2. Duplication analysis

- **All 28 files in `po/` are byte-identical (SHA-256) to copies in `asovin/asovin/public/assets/{fonts,icons,images}/`.** `po/` is a clean brand-asset mirror of the asovin PWA's public assets. Zero conflicts; the po/ set is canonical.
- **Woo plugin fonts diverge:** `woo-hooman-channel-manager/assets/fonts/Vazirmatn-{Regular,Bold}.woff2` have **different SHA-256 hashes** and are ~80 KB each (Regular 79,984 B, Bold 80,964 B) vs the ~51 KB po/ builds — a different (likely older/unsubset) Vazirmatn release. The new product must standardize on the po/ builds; the woo plugin keeps its own embedded copies (self-contained plugin, no change needed).
- **Runtime/application images in asovin public (NOT copied, noted only):** `assets/uploads/227b4776b1772aed.webp` (22,990 B); `assets/receipts/` 6 user receipt images (10,266–98,130 B); `assets/plans/` 4 subscription-plan images (34,652–112,452 B). These are user/product content, not brand assets.

## 3. Recommended UI usage map (new product)

**Logos**
| Surface | File |
|---|---|
| Landing header (dark hero) | `logo-full.webp` (transparent; animated — gate behind `prefers-reduced-motion`, fallback to static `logo-full-white-bg.webp` or first frame) |
| Landing header (light) | `logo-full-white-bg.webp` on pure-white surfaces only (no alpha — never place on tinted/dark backgrounds) |
| Footer | `logo-full-white-bg.webp` (light footer) / `logo-full.webp` (dark footer) |
| Auth (login/register) | `logo.webp` square mark above the form card (use `logo-white-bg.webp` on white cards) |
| App sidebar / compact header | `logo.webp` (square mark collapses to icon-only on mobile) |
| About / attribution | `asovin.webp` (parent brand) — do not use as the product mark |
| PWA manifest | `icon-192x192.png` + `icon-512x512.png` (`any`), `icon-192x192-maskable.png` + `icon-512x512-maskable.png` (`maskable`) — matches the reference manifest (theme `#6366f1`, bg `#0a0a0a`, `dir:rtl`, `lang:fa-IR`) |
| Favicons | `favicon-16x16.png` + `favicon-32x32.png`; Apple: `apple-touch-icon.png` (180) + `apple-touch-icon-167x167.png` |

**Fonts**
- **Ship subset (performance):** Regular 400, Medium 500, SemiBold 600, Bold 700 → ~204 KB total, `font-display: swap`, preload Regular + Bold (RTL fa-IR primary).
- **Optional (list for completeness):** Thin 100, Light 300, ExtraBold 800, Black 900 — load on demand only if a surface needs hairline/extra-black display type.
- All 8 weights are already copied so the choice is per-page/per-route, not per-repo.

## 4. Brand contract note

> **The official Postyar/Po logo family (the 5 webp files above) and the 15-icon set are the official brand marks. They are preserved byte-identical in this repo. Do NOT design or introduce a new brand mark, recolor, distort, crop, or recompose the logo. Only the pre-made white-bg variants may sit on white; the transparent variants must be used elsewhere. Product renaming/rebranding work is out of scope unless explicitly commissioned.**

## 5. Copy verification (Task 4)

| Group | Files | Source bytes | assets/ bytes | frontend/public/ bytes |
|---|---|---|---|---|
| fonts | 8 | 407,528 | 407,528 | 407,528 |
| icons | 15 | 688,320 | 688,320 | 688,320 |
| images | 5 | 267,068 | 267,068 | 267,068 |
| **Total** | **28** | **1,362,916** | **1,362,916** | **1,362,916** |

Aggregate SHA-256 over `sha256sum fonts/* icons/* images/*` listings: source, `assets/`, and `frontend/public/` all equal `0e7add7d283d047ccf6a549fc2b6aeff76bfb4c3f39e6cd3ab835807095498f2` → byte-identical copies.

## 6. Unusual findings

1. **`logo-full.webp` is an animated WebP** (VP8X + ANIM flag, 600×328) — the full logo is motion-based. Needs a `prefers-reduced-motion` static fallback in the UI.
2. **The two `*-white-bg.webp` variants have no alpha** (simple VP8 lossy) — backgrounds are baked in; misuse on dark/tinted surfaces will show a white box.
3. **`asovin.webp` is 1024×1536 portrait with EXIF metadata** (181 KB) — it is the parent-company brand asset, not part of the product mark; it dominates the images payload.
4. **Vazirmatn version drift** between po/ (~51 KB builds) and the woo plugin (~80 KB builds, different hashes) — standardize on po/ builds for all new frontend surfaces.
5. **`icon-512x512.png` is 274 KB** — heavy for an icon but preserved byte-identical per brand contract; the maskable 512 (95 KB) can serve as the leaner hi-res manifest entry if needed.
6. `file` reports extended-WebP dimensions as `N-1+1` (e.g. `1023+1x1535+1`) and `logo-full.webp` as `animated`; the bun spec-parser run confirmed exact canvas sizes (1024×1536, 600×328, 200×200) — nothing left undetermined.

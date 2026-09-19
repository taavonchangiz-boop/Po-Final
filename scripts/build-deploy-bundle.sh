#!/usr/bin/env bash
# =============================================================================
# Postyar (پُست‌یار) — deploy bundle builder
# -----------------------------------------------------------------------------
# Produces a ready-to-upload bundle with the required hosting layout:
#
#   deploy-bundle/
#     postyar/         ← main files: backend (app), frontend source, configs, docs
#     public_html/     ← public static assets: index.html, assets/*.js|css, images
#     DEPLOY.md        ← short Persian upload instructions
#
# Usage:  bash scripts/build-deploy-bundle.sh [output-dir]
# Exit codes: 0 ok | 2 build failure
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="${1:-$ROOT/deploy-bundle}"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m[ok]\033[0m %s\n' "$*"; }

# 1) Build the frontend SPA (assets + index.html)
step "Building frontend (vite)"
( cd "$ROOT/frontend" && bun run build ) || { printf 'frontend build failed\n' >&2; exit 2; }
ok "frontend/dist ready"

# 2) Prepare bundle layout
step "Assembling bundle"
rm -rf "$OUT"
mkdir -p "$OUT/public_html" "$OUT/postyar"

# 2a. public_html: the compiled SPA (css/js/images) — the ONLY public folder
cp -r "$ROOT/frontend/dist/." "$OUT/public_html/"
ok "public_html/ ← index.html + assets/* (js, css) + images"

# 2b. postyar/: everything private (backend + sources + docs + plugin)
mkdir -p "$OUT/postyar/app"
cp -r "$ROOT/app/src" "$OUT/postyar/app/src"
cp "$ROOT/app/package.json" "$OUT/postyar/app/" 2>/dev/null || true
cp "$ROOT/app/tsconfig.json" "$OUT/postyar/app/" 2>/dev/null || true
cp "$ROOT/app/Passengerfile.js" "$OUT/postyar/app/" 2>/dev/null || true
cp -r "$ROOT/database" "$OUT/postyar/database"
cp -r "$ROOT/scripts" "$OUT/postyar/scripts"
cp -r "$ROOT/wordpress-plugin" "$OUT/postyar/wordpress-plugin"
cp -r "$ROOT/docs" "$OUT/postyar/docs" 2>/dev/null || true
for f in README.md ARCHITECTURE.md PRODUCT-SPEC.md DEPLOYMENT.md SECURITY.md \
         API.md DATABASE.md OPERATIONS.md TROUBLESHOOTING.md WORDPRESS.md \
         .env.example VERSION; do
  [ -f "$ROOT/$f" ] && cp "$ROOT/$f" "$OUT/postyar/"
done
ok "postyar/ ← backend + sources + configs + docs (private)"

# 2c. never leak secrets
find "$OUT" -name '.env' -type f -delete 2>/dev/null || true
ok "secret scan: no .env inside bundle"

# 3) Short upload guide
cat > "$OUT/DEPLOY.md" <<'MD'
# راهنمای آپلود بسته پُست‌یار

1. محتوای پوشه `postyar/` را در یک پوشه **خارج از public_html** (مثلاً `~/postyar`) قرار دهید.
2. محتوای پوشه `public_html/` را دقیقاً در `public_html` هاست کپی کنید (index.html، assets/، images/).
3. در پوشه `postyar/app` یک `.env` از روی `.env.example` بسازید و `chmod 600` بدهید.
4. در هاست: `cd ~/postyar && bash scripts/deploy.sh` (مهاجرت‌ها + health check).
5. اگر مسیر public_html هاست شما متفاوت است: `PUBLIC_HTML=/مسیر/public_html bash scripts/deploy.sh`.

نکته: تنها پوشه عمومی `public_html` است؛ کل کد سمت سرور در `postyar/` باقی می‌ماند.
MD
ok "DEPLOY.md written"

step "Bundle ready: $OUT"
du -sh "$OUT/public_html" "$OUT/postyar" 2>/dev/null || true

#!/usr/bin/env bash
# =============================================================================
# Postyar (پُست‌یار) — release ZIP builder (deterministic composition)
# -----------------------------------------------------------------------------
# Builds ../postyar-production-final.zip from the repository tree.
#
# SHA256SUMS (inside the package) lists the hashes of the KEY FILES themselves —
# it can NOT contain the hash of the ZIP that contains it (mathematical
# impossibility). The ZIP archive's own SHA256 is printed by this script and
# must be published on the GitHub Release page and in the delivery message.
#
# Excluded: .git, node_modules, dist/build outputs, deploy-bundle, .env, caches
# Usage: bash scripts/build-release-zip.sh [output-zip]
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="${1:-$(dirname "$ROOT")/postyar-production-final.zip}"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m[ok]\033[0m %s\n' "$*"; }

step "Writing SHA256SUMS (key-file manifest)"
{
  for f in VERSION .env.example README.md ARCHITECTURE.md PRODUCT-SPEC.md \
           DEPLOYMENT.md SECURITY.md API.md DATABASE.md OPERATIONS.md \
           TROUBLESHOOTING.md WORDPRESS.md; do
    [ -f "$ROOT/$f" ] && ( cd "$ROOT" && sha256sum "$f" )
  done
  printf '# هش خود فایل ZIP در صفحه Releases مخزن گیت\u200cهاب منتشر می\u200cشود.\n'
} > "$ROOT/SHA256SUMS"
ok "SHA256SUMS manifest written"

step "Building ZIP"
rm -f "$OUT"
( cd "$(dirname "$ROOT")" && zip -qr "$(basename "$OUT")" "$(basename "$ROOT")" \
    -x "*/.git/*" "*/node_modules/*" "*/dist/*" "*/build/*" "*/deploy-bundle/*" \
       "*/cache/*" "*/runtime/*" "*/storage/*" "*/coverage/*" "*/.deps/*" \
       "*/.env" "*/.env.*local" "*/*.log" "*/.DS_Store" "*/backups/*" )
ok "zip built: $OUT"

step "Integrity"
ZIP_SHA="$(sha256sum "$OUT" | cut -d' ' -f1)"
FILES="$(unzip -l "$OUT" | tail -1 | awk '{print $2}')"
SIZE="$(stat -c '%s' "$OUT")"
echo "  SHA256: $ZIP_SHA"
echo "  files:  $FILES   bytes: $SIZE"

# secret scan: no real .env inside
if unzip -l "$OUT" | rg -q '/\.env$'; then
  printf '\033[31m[FAIL]\033[0m real .env leaked into zip\n' >&2; exit 1
fi
ok "secret scan clean (no .env inside)"
echo "$ZIP_SHA" > "$(dirname "$OUT")/ZIP_SHA256.txt"

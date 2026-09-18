#!/usr/bin/env bash
# =============================================================================
# Postyar — release check (master prompt §136 / §137)
# -----------------------------------------------------------------------------
# بررسی‌های انتشار: فایل‌های ممنوعه، الگوهای راز/secret، مارکرهای حل‌نشده،
# ارجاع Next.js، اسناد الزامی، ساختار پوشه‌ها.
# این اسکریپت نباید برای سبز شدن نتیجه، خطاها را مخفی کند (§137):
# هر بلاکر جدی ⇒ خروجی 1.
#
# Usage:  bash scripts/release-check.sh
# Exit:   0 = PASS | 1 = FAIL (serious blockers)
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BLOCKERS=0
WARNINGS=0
declare -a FAIL_LINES=()
declare -a WARN_LINES=()

fail() { BLOCKERS=$((BLOCKERS + 1)); FAIL_LINES+=("$1"); printf '  \033[31m✗ FAIL\033[0m %s\n' "$1"; }
warn() { WARNINGS=$((WARNINGS + 1)); WARN_LINES+=("$1"); printf '  \033[33m⚠ WARN\033[0m %s\n' "$1"; }
pass() { printf '  \033[32m✓ PASS\033[0m %s\n' "$1"; }
section() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

# candidate file set: git-tracked if repo, else filesystem (minus heavy dirs)
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  MODE="git"
  # tracked + untracked-not-ignored (everything a release artifact would carry)
  TRACKED="$( { git ls-files -z 2>/dev/null; git ls-files --others --exclude-standard -z 2>/dev/null; } | tr '\0' '\n' | sed '/^$/d' | sort -u)"
else
  MODE="fs"
  TRACKED="$(find . -type f ! -path './.git/*' ! -path '*/node_modules/*' | sed 's|^\./||')"
fi
printf 'release-check: tree=%s mode=%s\n' "$ROOT" "$MODE"

# =============================================================================
section "1) Forbidden files / فایل‌های ممنوعه"
# node_modules must never be part of the release tree
if printf '%s\n' "$TRACKED" | grep -Eq '(^|/)node_modules/'; then
  fail "node_modules present in tree — remove from release (add to .gitignore)"
else
  pass "no node_modules in tree"
fi
# .env anywhere (untracked local .env would enter a zip artifact → blocker)
ENV_HITS="$(find . -type f \( -name '.env' -o -name '.env.local' -o -name '.env.production' \) \
              ! -path './.git/*' ! -path '*/node_modules/*' 2>/dev/null | sed 's|^\./||')"
if [ -n "$ENV_HITS" ]; then
  fail ".env file(s) present: $(echo "$ENV_HITS" | tr '\n' ' ') — real env must live outside the artifact"
else
  pass "no .env files (only .env.example allowed)"
fi
# *.sqlite / *.db
SQLITE_HITS="$(find . -type f \( -name '*.sqlite' -o -name '*.sqlite3' -o -name '*.db' \) \
                 ! -path './.git/*' ! -path '*/node_modules/*' 2>/dev/null | sed 's|^\./||')"
if [ -n "$SQLITE_HITS" ]; then
  fail "sqlite/db dumps present: $(echo "$SQLITE_HITS" | tr '\n' ' ')"
else
  pass "no *.sqlite / *.db files"
fi
# *.sql dumps — migrations under database/migrations are legitimate
SQL_HITS="$(find . -type f -name '*.sql' ! -path './database/migrations/*' \
              ! -path './.git/*' ! -path '*/node_modules/*' 2>/dev/null | sed 's|^\./||')"
if [ -n "$SQL_HITS" ]; then
  fail "*.sql outside database/migrations (likely a dump): $(echo "$SQL_HITS" | tr '\n' ' ')"
else
  pass "no *.sql dumps (migrations in database/migrations only)"
fi
# .DS_Store
DS_HITS="$(find . -type f -name '.DS_Store' ! -path './.git/*' ! -path '*/node_modules/*' 2>/dev/null | sed 's|^\./||')"
if [ -n "$DS_HITS" ]; then
  fail ".DS_Store present: $(echo "$DS_HITS" | tr '\n' ' ') — remove (macOS artifact)"
else
  pass "no .DS_Store"
fi

# =============================================================================
section "2) Secret pattern scan / اسکن الگوهای راز"
# placeholder-looking values are allowed (e.g. .env.example)
PLACEHOLDER_RE='(placeholder|change_?me|change-?me|example|generate|generate_with|xxxx|<[^>]*>|\$\{|\.\.\.|__|your[_-])'
SECRET_PATTERNS=(
  'sk-[A-Za-z0-9]{20,}'
  'AKIA[0-9A-Z]{16}'
  'BEGIN (RSA |EC )?PRIVATE KEY'
  # quoted ASCII literal (code/JSON/YAML): password: "…8+…" — key must be the
  # whole identifier (errors.password OK, MYSQL_PWD excluded); value charset is
  # ASCII-without-spaces so Persian validation messages don't match.
  '(^|[^A-Za-z0-9_])(password|passwd|pwd)[[:space:]]*[=:][[:space:]]*["'"'"'][A-Za-z0-9+/=_@#%^&*!~?.,:;-]{8,}["'"'"']'
  # unquoted config line (dotenv/ini style), whole-line anchored
  '^[[:space:]]*(password|passwd|pwd)[[:space:]]*=[[:space:]]*[^"'"'"'"[:space:]]{8,}[[:space:]]*$'
  '(^|[^A-Za-z0-9_])(api[_-]?key|apikey)[[:space:]]*[=:][[:space:]]*["'"'"'][A-Za-z0-9+/=_@#%^&*!~?.,:;-]{12,}["'"'"']'
  '^[[:space:]]*(api[_-]?key|apikey)[[:space:]]*=[[:space:]]*[^"'"'"'"[:space:]]{12,}[[:space:]]*$'
)
SECRET_HITS_FILE="$(mktemp)"
trap 'rm -f "$SECRET_HITS_FILE"' EXIT
while IFS= read -r f; do
  [ -f "$f" ] || continue
  case "$f" in *.png|*.jpg|*.jpeg|*.webp|*.gif|*.woff|*.woff2|*.ttf|*.zip|*.gz|*.ico) continue ;; esac
  for pat in "${SECRET_PATTERNS[@]}"; do
    grep -IniE "$pat" "$f" 2>/dev/null | while IFS= read -r line; do
      value="$(printf '%s' "$line" | sed -E 's/.*(=|:)[[:space:]]*["'"'"']?([A-Za-z0-9+/_<${}.-]+).*/\2/')"
      if printf '%s' "$value" | grep -Eqi "$PLACEHOLDER_RE"; then continue; fi
      printf '%s: %s\n' "$f" "$(printf '%s' "$line" | cut -c1-160)" >> "$SECRET_HITS_FILE"
    done
  done
done <<EOF
$TRACKED
EOF
if [ -s "$SECRET_HITS_FILE" ]; then
  fail "secret-like patterns found ($(wc -l < "$SECRET_HITS_FILE") hit(s)):"
  sed 's/^/      /' "$SECRET_HITS_FILE" | head -20
else
  pass "no secret-like patterns (sk-*, AKIA*, PRIVATE KEY, password=, api_key= with real-looking values)"
fi

# =============================================================================
section "3) Unresolved TODO/FIXME/XXX markers in app/src + frontend/src"
MARKER_HITS="$(grep -RnE 'TODO|FIXME|XXX' app/src frontend/src --include='*.ts' --include='*.tsx' 2>/dev/null || true)"
if [ -z "$MARKER_HITS" ]; then
  pass "no unresolved markers"
else
  printf '%s\n' "$MARKER_HITS" | while IFS= read -r l; do printf '      %s\n' "$l"; done | head -20
  if printf '%s\n' "$MARKER_HITS" | grep -q 'FIXME'; then
    fail "FIXME markers present (must be resolved or converted to tracked work)"
  else
    warn "TODO/XXX markers present (non-blocking — list above)"
  fi
fi

# =============================================================================
section "4) Next.js references in app/ and frontend/ (ADR-001: no Next.js)"
NEXT_DEPS="$(grep -nE '"next"[[:space:]]*:' app/package.json frontend/package.json 2>/dev/null || true)"
NEXT_IMPORTS="$(grep -RnE "from ['\"]next|require\(['\"]next|import\(['\"]next" app/src frontend/src 2>/dev/null || true)"
if [ -n "$NEXT_DEPS" ] || [ -n "$NEXT_IMPORTS" ]; then
  [ -n "$NEXT_DEPS" ] && fail "next in package.json dependencies: $NEXT_DEPS"
  [ -n "$NEXT_IMPORTS" ] && fail "next imports found: $(echo "$NEXT_IMPORTS" | head -5)"
else
  pass "no Next.js dependency/import (Vite SPA + Fastify confirmed)"
fi

# =============================================================================
section "5) Required documentation / اسناد الزامی (§138)"
DOC_MISSING=0
check_doc() { # <name> <path-candidates...>
  local name="$1"; shift
  for c in "$@"; do
    if [ -f "$ROOT/$c" ]; then pass "$name → $c"; return; fi
  done
  fail "missing required document: $name (expected one of: $*)"
  DOC_MISSING=1
}
check_doc "README.md"          "README.md"
check_doc "ARCHITECTURE.md"    "docs/ARCHITECTURE.md" "ARCHITECTURE.md"
check_doc "DATABASE.md"        "DATABASE.md" "docs/DATABASE.md"
check_doc "SECURITY.md"        "SECURITY.md" "docs/SECURITY.md"
check_doc "DEPLOYMENT.md"      "DEPLOYMENT.md" "docs/DEPLOYMENT.md"
check_doc "OPERATIONS.md"      "OPERATIONS.md" "docs/OPERATIONS.md"
check_doc "TROUBLESHOOTING.md" "TROUBLESHOOTING.md" "docs/TROUBLESHOOTING.md"
check_doc "API.md"             "API.md" "docs/API.md"
check_doc "WORDPRESS.md"       "WORDPRESS.md" "docs/WORDPRESS.md"
check_doc "PRODUCT-SPEC.md"    "docs/PRODUCT-SPEC.md" "PRODUCT-SPEC.md"
if [ -f "$ROOT/.env.example" ]; then pass ".env.example present"; else fail "missing .env.example (placeholders only)"; fi
if [ -f "$ROOT/SHA256SUMS" ]; then
  pass "SHA256SUMS present (release manifest)"
else
  fail "missing SHA256SUMS — generate at release packaging: find . -type f ! -path './.git/*' ! -path '*/node_modules/*' -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS"
fi

# =============================================================================
section "6) Required structure / ساختار الزامی"
for d in app frontend wordpress-plugin/postyar-connector database/migrations scripts tests docs audits assets .github; do
  if [ -d "$ROOT/$d" ]; then pass "dir $d"; else fail "missing required directory: $d"; fi
done

# =============================================================================
section "خلاصه / SUMMARY — Release Check v1.0.0"
printf '  Checks: blockers=\033[31m%s\033[0m  warnings=\033[33m%s\033[0m\n' "$BLOCKERS" "$WARNINGS"
if [ "$WARNINGS" -gt 0 ]; then
  printf '  Warnings / هشدارها:\n'
  for w in "${WARN_LINES[@]}"; do printf '    - %s\n' "$w"; done
fi
if [ "$BLOCKERS" -gt 0 ]; then
  printf '  Blockers / خطاهای بازدارنده:\n'
  for b in "${FAIL_LINES[@]}"; do printf '    - %s\n' "$b"; done
  printf '\n  Result: FAIL — release blocked. / نتیجه: ناموفق — انتشار متوقف شد.\n'
  printf '  اسناد ناقص را تکمیل و SHA256SUMS را در بسته‌بندی انتشار تولید کنید، سپس دوباره اجرا کنید.\n'
  exit 1
fi
printf '\n  Result: PASS — release accepted. / نتیجه: موفق — انتشار مجاز است.\n'
exit 0

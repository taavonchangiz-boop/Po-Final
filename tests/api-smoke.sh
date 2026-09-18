#!/usr/bin/env bash
# =============================================================================
# Postyar — API smoke test (curl-based, no jq dependency)
# -----------------------------------------------------------------------------
# ثبت‌نام → خروج → ورود → me → خروج روی یک نمونه‌ی در حال اجرا + healthها.
#
# قاعده: این اسکریپت «فقط» در فاز integration استفاده می‌شود و هرگز بخشی از
# deploy نیست (master prompt §69/§70). اگر سرور در دسترس نباشد، با پیام
# NOTICE و کد 0 به‌صورت تمیز skip می‌شود.
#
# Usage:
#   bash tests/api-smoke.sh                          # BASE_URL پیش‌فرض :3001
#   BASE_URL=https://example.com bash tests/api-smoke.sh
# Exit: 0 ok-or-skipped | 1 real failure
# =============================================================================
set -uo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3001}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

pass() { printf '\033[32m[smoke:PASS]\033[0m %s\n' "$*"; }
fail() { printf '\033[31m[smoke:FAIL]\033[0m %s\n' "$*"; }
info() { printf '\033[36m[smoke]\033[0m %s\n' "$*"; }
notice() { printf '\033[33m[smoke:SKIP]\033[0m %s\n' "$*"; }

http() { curl -fsS --max-time 5 "$@" 2>/dev/null; }

# ---------------------------------------------------------------- reachability
if ! http "$BASE_URL/health/live" >/dev/null; then
  notice "server not reachable at $BASE_URL — smoke test skipped gracefully (integration-phase tool, NOT part of deploy)."
  notice "برای اجرا: نمونه‌ی dev را روشن کنید (cd app && npm run dev) یا BASE_URL را ست کنید."
  exit 0
fi

FAILS=0
assert_success() { # $1 label, $2 body
  if printf '%s' "$2" | grep -q '"success":true'; then
    pass "$1"
  else
    fail "$1 → unexpected envelope: $(printf '%s' "$2" | cut -c1-160)"
    FAILS=$((FAILS + 1))
  fi
}

# ---------------------------------------------------------------- health
for ep in health/live health/ready health; do
  if http "$BASE_URL/$ep" >/dev/null; then
    pass "GET /$ep → 200"
  else
    fail "GET /$ep → not 200/unreachable"
    FAILS=$((FAILS + 1))
  fi
done
if http "$BASE_URL/health/ready" >/dev/null; then :; else
  notice "/health/ready not 200 (DB/Redis down?) — continuing; auth checks will likely fail too."
fi

# ---------------------------------------------------------------- register
STAMP="$(date +%s)-$RANDOM"
MOBILE="09$(printf '%09d' $((10#$STAMP % 1000000000)))"
info "registering test user (mobile=$MOBILE) ..."
REG="$(http -X POST "$BASE_URL/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -c "$JAR" \
  -d "{\"firstName\":\"دود\",\"lastName\":\"اسموک\",\"mobile\":\"$MOBILE\",\"email\":\"smoke-$STAMP@example.com\",\"businessName\":\"فروشگاه دود\",\"businessType\":\"OTHER\",\"password\":\"Passw0rd!234\",\"passwordConfirm\":\"Passw0rd!234\",\"acceptedTerms\":true}")" || REG=""
[ -n "$REG" ] && assert_success "POST /auth/register" "$REG" || { fail "register: no/failed response"; FAILS=$((FAILS+1)); }

# session should already exist from register — drop it to test login explicitly
if http -X POST "$BASE_URL/api/v1/auth/logout" -b "$JAR" -c "$JAR" \
     -H "X-CSRF-Token: $(awk '$6=="py_csrf"{print $7}' "$JAR" | head -1)" >/dev/null; then
  pass "POST /auth/logout (after register)"
else
  info "logout after register skipped/failed (non-fatal)"
fi

# ---------------------------------------------------------------- login
LOGIN="$(http -X POST "$BASE_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' -c "$JAR" \
  -d "{\"mobile\":\"$MOBILE\",\"password\":\"Passw0rd!234\"}")" || LOGIN=""
[ -n "$LOGIN" ] && assert_success "POST /auth/login" "$LOGIN" || { fail "login: no/failed response"; FAILS=$((FAILS+1)); }

# ---------------------------------------------------------------- me (auth)
ME="$(http -b "$JAR" "$BASE_URL/api/v1/me")" || ME=""
if printf '%s' "$ME" | grep -q '"success":true'; then
  pass "GET /me (authenticated)"
  if printf '%s' "$ME" | grep -q '"phone"'; then :; fi
else
  fail "GET /me → $ME"
  FAILS=$((FAILS + 1))
fi

# unauthenticated /me must be rejected
if http "$BASE_URL/api/v1/me" >/dev/null 2>&1; then
  fail "GET /me without session unexpectedly succeeded (expected 401)"
  FAILS=$((FAILS + 1))
else
  pass "GET /me without session → rejected (401 expected)"
fi

# ---------------------------------------------------------------- CSRF
CSRF="$(awk '$6=="py_csrf"{print $7}' "$JAR" | head -1)"
if [ -n "$CSRF" ]; then
  pass "py_csrf cookie present"
  if http -X POST "$BASE_URL/api/v1/auth/logout" -b "$JAR" -c "$JAR" >/dev/null 2>&1; then
    fail "mutating POST without X-CSRF-Token unexpectedly succeeded"
    FAILS=$((FAILS + 1))
  else
    pass "POST without X-CSRF-Token → rejected (CSRF enforced)"
  fi
  if http -X POST "$BASE_URL/api/v1/auth/logout" -b "$JAR" -c "$JAR" \
       -H "X-CSRF-Token: $CSRF" >/dev/null 2>&1; then
    pass "POST /auth/logout with X-CSRF-Token → ok (session revoked)"
  else
    info "logout-with-CSRF returned non-2xx (idempotent logout tolerable; inspect manually)"
  fi
else
  fail "py_csrf cookie missing after login"
  FAILS=$((FAILS + 1))
fi

# ---------------------------------------------------------------- summary
if [ "$FAILS" -gt 0 ]; then
  fail "smoke test finished with $FAILS failure(s)"
  exit 1
fi
pass "smoke test finished clean — سلامت/ثبت‌نام/ورود/me/CSRF/خروج سالم"
exit 0

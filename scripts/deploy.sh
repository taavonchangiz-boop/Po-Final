#!/usr/bin/env bash
# =============================================================================
# Postyar — idempotent deployment script (master prompt §69, §200)
# -----------------------------------------------------------------------------
# preflight → dependency verification → build if necessary → migration status
# → apply existing migrations → Passenger restart → health verification
#
# قواعد سخت: Redis نصب نمی‌شود، دیتابیس recreate نمی‌شود، test suite اجرا
# نمی‌شود، worker/scheduler spawn نمی‌شود (بعد از deploy دستی restart کنید —
# DEPLOYMENT.md §11).
#
# Usage:
#   bash scripts/deploy.sh                     # تمام مراحل
#   APP_DIR=... PUBLIC_HTML=... bash scripts/deploy.sh   # مسیرهای سفارشی
# Exit codes: 0 ok | 1 preflight | 2 deps/build | 3 migration | 4 health
# =============================================================================
set -uo pipefail

# ----------------------------- configuration --------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"                  # repo root (= postelrobbal در هاست)
APP_DIR="${APP_DIR:-$ROOT/app}"
FRONTEND_DIR="${FRONTEND_DIR:-$ROOT/frontend}"
PUBLIC_HTML="${PUBLIC_HTML:-$ROOT/../public_html}"
LOG_DIR="${LOG_DIR:-$ROOT/logs}"
HEALTH_TIMEOUT_SECS=30

err()  { printf '\033[31m[deploy:ERROR]\033[0m %s\n' "$*" >&2; }
ok()   { printf '\033[32m[deploy:ok]\033[0m %s\n' "$*"; }
info() { printf '\033[36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[deploy:warn]\033[0m %s\n' "$*"; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# ============================ 1) PREFLIGHT ==================================
step "Preflight / پیش‌نیازسنجی"

# 1a. Node >= 22
if ! command -v node >/dev/null 2>&1; then
  err "node not found — Node.js 22 required / Node یافت نشد"; exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  err "node $(node -v) detected — Node >= 22 required (CloudLinux selector: Setup Node.js App)"; exit 1
fi
ok "node $(node -v)"

# 1b. .env exists (canonical: $APP_DIR/.env)
if [ ! -f "$APP_DIR/.env" ]; then
  err "$APP_DIR/.env not found — copy .env.example, fill values, chmod 600"; exit 1
fi
ENV_PERMS="$(stat -c '%a' "$APP_DIR/.env" 2>/dev/null || echo '?')"
if [ "$ENV_PERMS" != "600" ]; then
  warn ".env perms are $ENV_PERMS (expected 600) — fixing"; chmod 600 "$APP_DIR/.env"
fi
ok ".env present (chmod 600)"

# 1c. Load env; DATABASE_URL must be set
set -a
# shellcheck disable=SC1091
. "$APP_DIR/.env"
set +a
if [ -z "${DATABASE_URL:-}" ]; then
  err "DATABASE_URL is empty in $APP_DIR/.env"; exit 1
fi
ok "DATABASE_URL set"
if [ -z "${REDIS_URL:-}" ]; then
  warn "REDIS_URL not set — API will refuse to boot in production (env.ts fail-fast)"
fi

# 1d. MySQL ping (mysql client if available)
if command -v mysql >/dev/null 2>&1; then
  DB_HOST='127.0.0.1'; DB_PORT='3306'; DB_USER=''; DB_PASS=''; DB_NAME=''
  DB_RE='^mysql://([^:]+):([^@]*)@([^:/]+):?([0-9]*)/([^?]+)'
  if [[ "$DATABASE_URL" =~ $DB_RE ]]; then
    DB_USER="${BASH_REMATCH[1]}"; DB_PASS="${BASH_REMATCH[2]}"
    DB_HOST="${BASH_REMATCH[3]}"; DB_PORT="${BASH_REMATCH[4]:-3306}"; DB_NAME="${BASH_REMATCH[5]}"
    if MYSQL_PWD="$DB_PASS" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" -e 'SELECT 1;' >/dev/null 2>&1; then
      ok "mysql ping OK ($DB_USER@$DB_HOST:$DB_PORT/$DB_NAME)"
    else
      err "mysql ping FAILED — check DATABASE_URL / cPanel MySQL user / remote DB off"; exit 1
    fi
  else
    err "DATABASE_URL is not a parseable mysql:// URL"; exit 1
  fi
else
  warn "mysql CLI not found — DB connectivity will be proven by migration step instead"
fi

# 1e. Redis ping — optional, warn only (host-provided addon)
if command -v redis-cli >/dev/null 2>&1 && [ -n "${REDIS_URL:-}" ]; then
  if redis-cli -u "$REDIS_URL" ping 2>/dev/null | grep -q PONG; then
    ok "redis ping OK"
  else
    warn "redis ping FAILED — queue/scheduler degraded; API /health/ready will be 503 (continuing: host addon may allow only in-app access)"
  fi
else
  warn "redis-cli unavailable or REDIS_URL empty — skipping redis ping (optional)"
fi

# 1f. Required release artifacts that must exist BEFORE restart (§200)
if [ ! -d "$PUBLIC_HTML" ]; then
  err "public_html not found: $PUBLIC_HTML (set PUBLIC_HTML=...)"; exit 1
fi

# ======================= 2) DEPENDENCY VERIFICATION =========================
step "Dependencies (npm ci only when stale/missing) — idempotent"

dep_hash() { # hash of package.json + lockfile → detects staleness
  cat "$1/package.json" "$1/package-lock.json" 2>/dev/null | sha256sum | cut -d' ' -f1
}
deps_current() {
  local dir="$1" marker="$dir/.deps-hash"
  [ -d "$dir/node_modules" ] || return 1
  [ -f "$marker" ] || return 1
  [ "$(dep_hash "$dir")" = "$(cat "$marker" 2>/dev/null)" ]
}
mark_deps() {
  dep_hash "$1" > "$1/.deps-hash" 2>/dev/null
}

if deps_current "$APP_DIR"; then
  ok "app/node_modules up to date (hash unchanged)"
else
  [ -f "$APP_DIR/package-lock.json" ] || { err "app/package-lock.json missing — npm ci impossible"; exit 2; }
  info "npm ci (app) ..."
  (cd "$APP_DIR" && npm ci) || { err "npm ci failed in app/"; exit 2; }
  mark_deps "$APP_DIR"
  ok "app dependencies installed"
fi

if deps_current "$FRONTEND_DIR"; then
  ok "frontend/node_modules up to date (hash unchanged)"
else
  [ -f "$FRONTEND_DIR/package-lock.json" ] || { err "frontend/package-lock.json missing — npm ci impossible"; exit 2; }
  info "npm ci (frontend) ..."
  (cd "$FRONTEND_DIR" && npm ci) || { err "npm ci failed in frontend/"; exit 2; }
  mark_deps "$FRONTEND_DIR"
  ok "frontend dependencies installed"
fi

# ============================ 3) BUILD IF NEEDED ============================
step "Build only if necessary (no rebuild of unchanged apps — §72)"

build_needed() { # dir, sentinel-in-dist, src-glob...
  local dir="$1" sentinel="$2"; shift 2
  [ -f "$sentinel" ] || return 0                       # dist missing → build
  local newer
  newer="$(find "$@" -newer "$sentinel" -print -quit 2>/dev/null)"
  [ -n "$newer" ]
}

# 3a. frontend → dist → public_html
FRONTEND_SENTINEL="$FRONTEND_DIR/dist/index.html"
if build_needed "$FRONTEND_DIR" "$FRONTEND_SENTINEL" \
      "$FRONTEND_DIR/src" "$FRONTEND_DIR/public" "$FRONTEND_DIR/index.html" \
      "$FRONTEND_DIR/package.json" "$FRONTEND_DIR/vite.config.ts"; then
  info "vite build (frontend) ..."
  (cd "$FRONTEND_DIR" && npm run build) || { err "frontend build failed"; exit 2; }
else
  ok "frontend dist is newer than src — build skipped"
fi
if [ ! -f "$FRONTEND_SENTINEL" ]; then err "frontend/dist/index.html still missing after build"; exit 2; fi

info "publishing SPA → $PUBLIC_HTML"
mkdir -p "$PUBLIC_HTML"
rm -rf "$PUBLIC_HTML/assets"
cp -r "$FRONTEND_DIR/dist/." "$PUBLIC_HTML/" || { err "copy to public_html failed"; exit 2; }
ok "SPA published (index.html, assets, fonts, icons, images, manifest)"

# 3b. backend → dist/
BACKEND_SENTINEL="$APP_DIR/dist/server.js"
if build_needed "$APP_DIR" "$BACKEND_SENTINEL" \
      "$APP_DIR/src" "$APP_DIR/package.json" "$APP_DIR/tsconfig.json" "$APP_DIR/tsconfig.build.json"; then
  info "tsc build (app) ..."
  (cd "$APP_DIR" && npm run build) || { err "backend build failed"; exit 2; }
else
  ok "app dist is newer than src — build skipped"
fi
for artifact in "$APP_DIR/dist/server.js" "$APP_DIR/dist/db/migrate.js" "$APP_DIR/dist/workers/worker.js" "$APP_DIR/dist/workers/scheduler.js"; do
  [ -f "$artifact" ] || { err "required artifact missing: $artifact"; exit 2; }
done
ok "backend artifacts present (server, migrate, worker, scheduler)"

# ========================= 4) MIGRATION STATUS + APPLY ======================
step "Migrations (forward-only; drift → stop — §201)"

if ! command -v node >/dev/null 2>&1; then err "node vanished?"; exit 3; fi
MIG_OUT="$(node "$APP_DIR/dist/db/migrate.js" 2>&1)"
MIG_RC=$?
printf '%s\n' "$MIG_OUT"
if [ $MIG_RC -ne 0 ]; then
  err "migration failed (rc=$MIG_RC) — see message above; NOT restarting (§201 stop-don't-guess)"; exit 3
fi
ok "migrations applied / up to date"

# =========================== 5) PASSENGER RESTART ===========================
step "Passenger restart (touch tmp/restart.txt; best-effort alternatives)"

if [ -d "$APP_DIR" ]; then
  mkdir -p "$APP_DIR/tmp"
  touch "$APP_DIR/tmp/restart.txt" && ok "touched $APP_DIR/tmp/restart.txt (Passenger will restart the app)"
else
  warn "$APP_DIR/tmp missing — cannot touch restart.txt"
fi
# best-effort documented alternatives (non-fatal if absent):
if command -v passenger-config >/dev/null 2>&1; then
  passenger-config restart-app "$APP_DIR" >/dev/null 2>&1 \
    && ok "passenger-config restart-app OK" \
    || warn "passenger-config restart-app failed (restart.txt should still trigger restart)"
elif command -v passenger-status >/dev/null 2>&1; then
  info "passenger-status:"; passenger-status 2>/dev/null | head -20 || true
  warn "kill -USR1 to the Passenger Watchdog is a last-resort reload — only via host support"
fi
# NOTE: worker/scheduler are NOT touched here (no duplicate spawn — §69).
info "reminder: restart worker manually (DEPLOYMENT.md §11); scheduler is cron+flock supervised"

# =========================== 6) HEALTH VERIFICATION =========================
step "Health verification loop (/health/ready, up to ${HEALTH_TIMEOUT_SECS}s)"

HEALTH_PORT="${PORT:-3001}"
HEALTH_URL="http://127.0.0.1:${HEALTH_PORT}/health/ready"
DEADLINE=$((SECONDS + HEALTH_TIMEOUT_SECS))
until curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; do
  if [ "$SECONDS" -ge "$DEADLINE" ]; then
    err "health check FAILED after ${HEALTH_TIMEOUT_SECS}s: $HEALTH_URL"
    [ -d "$LOG_DIR" ] && { err "last log lines:"; tail -n 20 "$LOG_DIR"/*.log 2>/dev/null || true; }
    warn "check Passenger log in cPanel (Errors → ~/logs/) and 'Setup Node.js App' status"
    exit 4
  fi
  sleep 2
done
ok "health/ready OK on port $HEALTH_PORT"
if command -v curl >/dev/null 2>&1; then
  curl -fsS --max-time 3 "http://127.0.0.1:${HEALTH_PORT}/health" 2>/dev/null && printf '\n' || true
fi

step "Complete / تمام"
printf '%s\n' "Deployment finished successfully. Spread the word — پُست‌یار آماده است."
exit 0

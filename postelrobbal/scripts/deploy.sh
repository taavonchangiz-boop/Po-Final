#!/usr/bin/env bash
# ============================================================================
# Postyar — production deployment script (shared host, cPanel/CloudLinux/Passenger)
#
# Contract: §55/§69 (deployment layout), §200 (idempotent deploy), §66/§201
# (migrations: apply committed files exactly once, never invent), §68/§127
# (scheduler is a cron tick model; workers are single-instance).
#
# Design rules:
#   - IDEMPOTENT: safe to re-run; every step converges to the same state.
#   - Never installs Redis, never runs the test suite, never spawns duplicate
#     workers, never invents migrations.
#   - Builds are done in CI (or locally with --build); by default this script
#     REFUSES to run TypeScript/Vite builds on the production host.
#
# Usage:
#   scripts/deploy.sh [--build]
#     --build   Build app + frontend on THIS machine before deploying
#               (use only on a build box, never on the shared prod host).
#               The frontend build is synced into the release public_html/ so
#               the committed public tree and the deployed one never diverge.
#
# Overridable locations (env):
#   POSTYAR_RELEASE   release tree root           (default: parent of scripts/)
#   POSTYAR_HOME      private app root            (default: $HOME/postelrobbal)
#   PUBLIC_HTML       public web root             (default: $HOME/public_html)
# ============================================================================
set -euo pipefail

# ------------------------------------------------------------------ locations
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="${POSTYAR_RELEASE:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
APP_HOME="${POSTYAR_HOME:-${HOME}/postelrobbal}"
PUBLIC_HTML="${PUBLIC_HTML:-${HOME}/public_html}"
ENV_FILE="${APP_HOME}/config/.env"
API_PORT_FILE="${APP_HOME}/config/api.port"

BUILD_MODE=0
[ "${1:-}" = "--build" ] && BUILD_MODE=1

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ ok ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------- 1. preflight
preflight() {
  log "Preflight: tooling, directories, environment, dependencies"

  command -v node >/dev/null 2>&1 || die "node not found in PATH."
  NODE_MAJOR="$(node -p 'parseInt(process.versions.node.split(".")[0], 10)')"
  [ "${NODE_MAJOR}" -ge 22 ] || die "Node.js >= 22 required (found: $(node -v))."

  for dir in app api workers config private storage logs; do
    mkdir -p "${APP_HOME}/${dir}"
  done
  ok "Directory tree present under ${APP_HOME}"

  [ -f "${ENV_FILE}" ] || die "Missing ${ENV_FILE}. Create it from .env.example (chmod 600)."
  # shellcheck disable=SC1090
  set -a; . "${ENV_FILE}"; set +a

  : "${DATABASE_URL:?DATABASE_URL missing in ${ENV_FILE}}"
  : "${REDIS_URL:?REDIS_URL missing in ${ENV_FILE}}"
  : "${APP_URL:?APP_URL missing in ${ENV_FILE}}"
  : "${API_URL:?API_URL missing in ${ENV_FILE}}"
  : "${SESSION_SECRET:?SESSION_SECRET missing in ${ENV_FILE}}"
  : "${CSRF_SECRET:?CSRF_SECRET missing in ${ENV_FILE}}"
  [ "${#SESSION_SECRET}" -ge 32 ] || die "SESSION_SECRET must be >= 32 chars."
  [ "${#CSRF_SECRET}" -ge 32 ] || die "CSRF_SECRET must be >= 32 chars."
  [[ "${ENCRYPTION_KEY:-}" =~ ^[0-9a-fA-F]{64}$ ]] || die "ENCRYPTION_KEY must be exactly 64 hex chars (AES-256-GCM)."
  ok "Environment variables present (${ENV_FILE})"

  if [ "${BUILD_MODE}" -eq 1 ]; then
    log "--build requested: building on this machine"
    (cd "${RELEASE_DIR}/postelrobbal/app" && bun install --frozen-lockfile && bun run build) \
      || die "app build failed (bun install + bun run build)."
    (cd "${RELEASE_DIR}/postelrobbal/frontend" && bun install --frozen-lockfile \
      && bunx vite build --outDir "${RELEASE_DIR}/public_html" --emptyOutDir) \
      || die "frontend build failed (bun install + vite build into public_html)."
  fi

  [ -f "${RELEASE_DIR}/postelrobbal/app/dist/server.js" ] || die \
    "postelrobbal/app/dist missing. Build in CI (or run scripts/deploy.sh --build on a build box). Never build TypeScript on the prod shared host by default."
  [ -f "${RELEASE_DIR}/public_html/index.html" ] || die \
    "public_html/index.html missing. Build the SPA in CI (vite build into public_html/), then re-run deploy."
  ok "Build artifacts present (postelrobbal/app/dist, public_html)"

  # Runtime dependencies live with the deployed app (postelrobbal/app).
  log "Installing production dependencies into ${APP_HOME}/app (idempotent)"
  cp "${RELEASE_DIR}/postelrobbal/app/package.json" "${APP_HOME}/app/package.json"
  cp "${RELEASE_DIR}/postelrobbal/app/bun.lock" "${APP_HOME}/app/bun.lock" 2>/dev/null || true
  if [ ! -d "${APP_HOME}/app/node_modules" ]; then
    command -v bun >/dev/null 2>&1 || die "bun not found and node_modules missing; install bun or ship node_modules."
    (cd "${APP_HOME}/app" && bun install --frozen-lockfile --production) || die "dependency install failed."
  fi
  ok "Dependencies ready (node_modules present)"

  log "Reachability checks (MySQL, Redis) using the app's node_modules"
  (cd "${APP_HOME}/app" && node -e '
    const mysql = require("mysql2/promise");
    (async () => {
      const conn = await mysql.createConnection(process.env.DATABASE_URL);
      await conn.query("SELECT 1");
      await conn.end();
      console.log("mysql: connected");
    })().catch((e) => { console.error("mysql ping failed:", e.message); process.exit(1); });
  ') || die "DATABASE_URL not reachable."
  (cd "${APP_HOME}/app" && node -e '
    const Redis = require("ioredis");
    const r = new Redis(process.env.REDIS_URL, {
      lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 1,
    });
    r.connect().then(() => r.ping())
      .then(async (p) => {
        if (p !== "PONG") throw new Error("unexpected PING reply: " + p);
        console.log("redis: PONG");
        await r.quit(); process.exit(0);
      })
      .catch(async (e) => { console.error("redis ping failed:", e.message); try { await r.quit(); } catch {} process.exit(1); });
  ') || die "REDIS_URL not reachable."
  ok "MySQL + Redis reachable"
}

# ------------------------------------------------- 2. migration status + apply
migrate() {
  log "Migration status (applied vs present)"
  (cd "${APP_HOME}/app" && MIGRATIONS_DIR="${APP_HOME}/database/migrations" node -e '
    const mysql = require("mysql2/promise");
    const fs = require("fs");
    const dir = process.env.MIGRATIONS_DIR;
    (async () => {
      const conn = await mysql.createConnection(process.env.DATABASE_URL);
      let applied = [];
      try {
        const [rows] = await conn.query("SELECT name FROM schema_migrations");
        applied = rows.map((r) => r.name);
      } catch { /* table may not exist yet on first deploy */ }
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
      console.log("applied :", applied.length ? applied.join(", ") : "(none)");
      console.log("present :", files.join(", ") || "(none)");
      const unknown = applied.filter((a) => !files.includes(a));
      if (unknown.length) {
        console.error("DRIFT: applied migration(s) missing from release: " + unknown.join(", "));
        process.exit(1);
      }
      await conn.end();
    })().catch((e) => { console.error(e.message); process.exit(1); });
  ') || die "migration status check failed."
  ok "No schema drift (release contains every applied migration)"

  log "Applying pending migrations (committed files only, exactly once)"
  # NOTE: dist/db/migrate-cli.js' self-invoking CLI block only triggers when the
  # script path ends in "migrate-cli.ts" (a build artifact quirk), so we import
  # the exported runMigrations() directly — same code path as `npm run migrate`.
  (cd "${APP_HOME}/app" && MIGRATIONS_DIR="${APP_HOME}/database/migrations" APP_HOME="${APP_HOME}" node -e '
      import("file://" + process.env.APP_HOME + "/app/dist/db/migrate.js")
        .then((m) => m.runMigrations(process.env.MIGRATIONS_DIR))
        .then((applied) => {
          console.log(applied.length ? "Applied: " + applied.join(", ") : "Already up to date.");
          process.exit(0);
        })
        .catch((e) => { console.error(e.message); process.exit(1); });
    ') || die "migration run failed."
  ok "Migrations applied"
}

# ----------------------------------------------------- 3. copy build artifacts
ship_artifacts() {
  log "Shipping artifacts"

  command -v rsync >/dev/null 2>&1 || die "rsync is required on the server."

  # Frontend SPA → public_html. The release tree ships public_html/ already
  # built (committed), so this is a plain guarded copy — no build on the host.
  if [ -d "${PUBLIC_HTML}" ]; then
    if [ -f "${PUBLIC_HTML}/.postyar-deployed" ] || [ -z "$(ls -A "${PUBLIC_HTML}" 2>/dev/null)" ]; then
      rsync -a --delete "${RELEASE_DIR}/public_html/" "${PUBLIC_HTML}/"
      touch "${PUBLIC_HTML}/.postyar-deployed"
      ok "SPA deployed to ${PUBLIC_HTML} (rsync --delete, guarded)"
    else
      die "Refusing to rsync --delete into non-empty ${PUBLIC_HTML} without a previous Postyar marker (.postyar-deployed). Move existing content away or deploy manually."
    fi
  else
    mkdir -p "${PUBLIC_HTML}"
    rsync -a --delete "${RELEASE_DIR}/public_html/" "${PUBLIC_HTML}/"
    touch "${PUBLIC_HTML}/.postyar-deployed"
    ok "SPA deployed to ${PUBLIC_HTML} (fresh)"
  fi

  # Backend build → postelrobbal/app
  rsync -a --delete "${RELEASE_DIR}/postelrobbal/app/dist/" "${APP_HOME}/app/dist/"
  ok "Backend dist deployed to ${APP_HOME}/app/dist"

  # Migrations must travel with the release (apply-existing-migrations policy).
  mkdir -p "${APP_HOME}/database"
  rsync -a --delete "${RELEASE_DIR}/postelrobbal/database/migrations/" "${APP_HOME}/database/migrations/"
  ok "Migrations synced to ${APP_HOME}/database/migrations"

  # Passenger/worker/scheduler entries are COMMITTED in the release tree and
  # resolve postelrobbal/app relative to themselves (§55) — deploy only syncs them.
  install -m 0644 "${RELEASE_DIR}/postelrobbal/api/app.js" "${APP_HOME}/api/app.js"
  install -m 0644 "${RELEASE_DIR}/postelrobbal/workers/worker.js" "${APP_HOME}/workers/worker.js"
  install -m 0644 "${RELEASE_DIR}/postelrobbal/scheduler/scheduler.js" "${APP_HOME}/scheduler/scheduler.js"
  ok "Entries deployed: api/app.js, workers/worker.js, scheduler/scheduler.js"

  # .env must be readable by the API process only.
  chmod 600 "${ENV_FILE}" 2>/dev/null || warn "could not chmod 600 ${ENV_FILE}"
}

# ---------------------------------------------------------- 4. Passenger restart
restart() {
  log "Passenger restart"
  # cPanel/Passenger supports restart-by-touch: <app root>/tmp/restart.txt
  mkdir -p "${APP_HOME}/api/tmp"
  touch "${APP_HOME}/api/tmp/restart.txt"
  if command -v passenger >/dev/null 2>&1; then
    passenger restart-app --ignore-app-not-running 2>/dev/null || true
  fi
  ok "Restart signaled (tmp/restart.txt)"
}

# ------------------------------------------------------------- 5. health check
health() {
  log "Health verification (5 tries x 3s)"
  LIVE="${API_URL%/}/health/live"
  READY="${API_URL%/}/health/ready"
  curl -fsS --retry 5 --retry-delay 3 --retry-connrefused "${LIVE}" >/dev/null \
    || die "GET ${LIVE} failed after retries."
  READY_BODY="$(curl -fsS --retry 5 --retry-delay 3 --retry-connrefused "${READY}" 2>/dev/null || true)"
  if [ -z "${READY_BODY}" ]; then
    warn "GET ${READY} did not answer (MySQL/Redis degraded?) — inspect logs."
  elif printf '%s' "${READY_BODY}" | grep -q '"status":"ready"'; then
    ok "GET ${READY} → ready"
  else
    warn "GET ${READY} → degraded: ${READY_BODY}"
  fi
  ok "Live endpoint answering: ${LIVE}"
}

# --------------------------------------------------- 6. worker/scheduler note
workers_note() {
  log "Worker / scheduler check (single-instance policy, §68)"
  if pgrep -f "postyar-worker" >/dev/null 2>&1; then
    ok "A postyar worker process is already running — NOT starting another one."
  else
    warn "No running postyar worker detected. Install the cron lines from DEPLOYMENT.md:"
    warn "  * * * * * flock -n /tmp/postyar-scheduler.lock /usr/bin/node ${APP_HOME}/scheduler/scheduler.js >> ${APP_HOME}/logs/scheduler.log 2>&1"
    warn "  @reboot flock -n /tmp/postyar-worker.lock /usr/bin/node ${APP_HOME}/workers/worker.js >> ${APP_HOME}/logs/worker.log 2>&1"
    warn "Use flock (or the Redis scheduler lock) to guarantee single instances."
  fi
}

preflight
ship_artifacts
migrate
restart
health
workers_note

log "Deployment complete."
printf '  API   : %s\n' "${API_URL%/}/health/live"
printf '  SPA   : %s\n' "${APP_URL%/}/"
printf '  Home  : %s\n' "${APP_HOME}"
ok "SUCCESS"

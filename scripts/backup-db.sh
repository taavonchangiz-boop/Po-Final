#!/usr/bin/env bash
# =============================================================================
# Postyar — MySQL backup (mysqldump → postelrobbal/backups, 14-day retention)
# -----------------------------------------------------------------------------
# Usage:
#   bash scripts/backup-db.sh                     # از app/.env می‌خواند
#   POSTYAR_BACKUP_DIR=/path POSTYAR_BACKUP_RETENTION_DAYS=14 bash scripts/backup-db.sh
# Cron (پیشنهادی — روزانه 02:30):
#   30 2 * * * /bin/bash /home/account/postelrobbal/scripts/backup-db.sh >> /home/account/postelrobbal/logs/backup.log 2>&1
# Exit: 0 ok | 1 config/db error | 2 dump/verify failure
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"                    # = postelrobbal در هاست
APP_DIR="${APP_DIR:-$ROOT/app}"
BACKUP_DIR="${POSTYAR_BACKUP_DIR:-$ROOT/backups}"
RETENTION_DAYS="${POSTYAR_BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$BACKUP_DIR/postyar-$STAMP.sql.gz"

err()  { printf '\033[31m[backup:ERROR]\033[0m %s\n' "$*" >&2; }
ok()   { printf '\033[32m[backup:ok]\033[0m %s\n' "$*"; }
info() { printf '\033[36m[backup]\033[0m %s\n' "$*"; }

# --- env ---------------------------------------------------------------------
[ -f "$APP_DIR/.env" ] || { err "$APP_DIR/.env not found"; exit 1; }
set -a
# shellcheck disable=SC1091
. "$APP_DIR/.env"
set +a
[ -n "${DATABASE_URL:-}" ] || { err "DATABASE_URL empty"; exit 1; }
command -v mysqldump >/dev/null 2>&1 || { err "mysqldump not found (cPanel: /usr/bin/mysqldump)"; exit 1; }

DB_HOST='127.0.0.1'; DB_PORT='3306'; DB_USER=''; DB_PASS=''; DB_NAME=''
DB_RE='^mysql://([^:]+):([^@]*)@([^:/]+):?([0-9]*)/([^?]+)'
if [[ "$DATABASE_URL" =~ $DB_RE ]]; then
  DB_USER="${BASH_REMATCH[1]}"; DB_PASS="${BASH_REMATCH[2]}"
  DB_HOST="${BASH_REMATCH[3]}"; DB_PORT="${BASH_REMATCH[4]:-3306}"; DB_NAME="${BASH_REMATCH[5]}"
else
  err "DATABASE_URL not parseable as mysql://user:pass@host:port/db"; exit 1
fi

mkdir -p "$BACKUP_DIR"
info "dumping $DB_NAME@$DB_HOST:$DB_PORT → $OUT_FILE"

# --single-transaction: consistent InnoDB snapshot بدون قفل طولانی
# --quick: ردیف‌به‌ردیف (حافظه امن)   --no-tablespaces: سازگار با کاربر cPanel
# --routines/--triggers/--events: کامل بودن dump
if ! MYSQL_PWD="$DB_PASS" mysqldump \
      -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" \
      --single-transaction --quick --no-tablespaces \
      --routines --triggers --events 2>/dev/null | gzip -9 > "$OUT_FILE"; then
  err "mysqldump failed"; rm -f "$OUT_FILE"; exit 2
fi

# --- verify -------------------------------------------------------------------
if ! gzip -t "$OUT_FILE" 2>/dev/null; then
  err "gzip integrity check FAILED — $OUT_FILE removed"; rm -f "$OUT_FILE"; exit 2
fi
SIZE="$(du -h "$OUT_FILE" | cut -f1)"
ok "backup written and verified: $OUT_FILE ($SIZE)"

# --- retention (14 days default) ----------------------------------------------
PRUNED="$(find "$BACKUP_DIR" -name 'postyar-*.sql.gz' -type f -mtime +"$RETENTION_DAYS" -print -delete 2>/dev/null | wc -l)"
ok "retention: backups older than $RETENTION_DAYS days pruned ($PRUNED file(s))"

# بازیابی: scripts/restore-db.sh — سند همراه همین پوشه.
exit 0

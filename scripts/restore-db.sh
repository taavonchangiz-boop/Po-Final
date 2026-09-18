#!/usr/bin/env bash
# =============================================================================
# Postyar — MySQL restore (from scripts/backup-db.sh output)
# -----------------------------------------------------------------------------
# Usage:
#   bash scripts/restore-db.sh backups/postyar-YYYYMMDD-HHMMSS.sql.gz
#   bash scripts/restore-db.sh backups/postyar-....sql.gz --yes   # بدون پرامپت
#
# ⚠️  هشدار جدی: بازیابی، محتوای فعلی دیتابیس را با محتوای dump جایگزین می‌کند
#  (data rollback). سیاست migration ما forward-only است؛ جدول
#  `__postyar_migrations` داخل dump است پس نسخه‌ی اسکیمای بازیابی‌شده همیشه
#  با dump هماهنگ است. migration مخرب هرگز به‌صورت خودکار معکوس نمی‌شود.
#  قبل از restore یک backup تازه بگیرید: bash scripts/backup-db.sh
# Exit: 0 ok | 1 args/config error | 2 restore failure
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="${APP_DIR:-$ROOT/app}"

err()  { printf '\033[31m[restore:ERROR]\033[0m %s\n' "$*" >&2; }
ok()   { printf '\033[32m[restore:ok]\033[0m %s\n' "$*"; }
info() { printf '\033[36m[restore]\033[0m %s\n' "$*"; }

DUMP_FILE="${1:-}"
ASSUME_YES="${2:-}"
[ -n "$DUMP_FILE" ] || { err "usage: $0 <postyar-*.sql.gz> [--yes]"; exit 1; }
[ -f "$DUMP_FILE" ] || { err "dump file not found: $DUMP_FILE"; exit 1; }

[ -f "$APP_DIR/.env" ] || { err "$APP_DIR/.env not found"; exit 1; }
set -a
# shellcheck disable=SC1091
. "$APP_DIR/.env"
set +a
[ -n "${DATABASE_URL:-}" ] || { err "DATABASE_URL empty"; exit 1; }
command -v mysql >/dev/null 2>&1 || { err "mysql client not found"; exit 1; }

DB_HOST='127.0.0.1'; DB_PORT='3306'; DB_USER=''; DB_PASS=''; DB_NAME=''
DB_RE='^mysql://([^:]+):([^@]*)@([^:/]+):?([0-9]*)/([^?]+)'
if [[ "$DATABASE_URL" =~ $DB_RE ]]; then
  DB_USER="${BASH_REMATCH[1]}"; DB_PASS="${BASH_REMATCH[2]}"
  DB_HOST="${BASH_REMATCH[3]}"; DB_PORT="${BASH_REMATCH[4]:-3306}"; DB_NAME="${BASH_REMATCH[5]}"
else
  err "DATABASE_URL not parseable"; exit 1
fi

gzip -t "$DUMP_FILE" || { err "dump file is not valid gzip"; exit 2; }

info "target : $DB_NAME@$DB_HOST:$DB_PORT"
info "source : $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"
if [ "$ASSUME_YES" != "--yes" ]; then
  printf '\033[33mهشدار: داده‌های فعلی «%s» بازنویسی می‌شوند. ادامه می‌دهید؟ (بله/yes را تایپ کنید) \033[0m' "$DB_NAME"
  read -r ANSWER
  case "$ANSWER" in yes|YES|بله|y|Y) ;; *) err "aborted by user"; exit 1 ;; esac
fi

# first take a safety snapshot of the CURRENT state
info "safety pre-restore backup (14d retention handled by backup-db.sh) ..."
if [ -x "$SCRIPT_DIR/backup-db.sh" ]; then
  bash "$SCRIPT_DIR/backup-db.sh" || err "pre-restore backup FAILED — continuing only because you explicitly asked; consider aborting"
fi

if ! gzip -dc "$DUMP_FILE" | MYSQL_PWD="$DB_PASS" mysql \
      -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME"; then
  err "restore FAILED — دیتابیس ممکن است ناقص باشد؛ فوراً backup تازه را بازگردانید"; exit 2
fi

ok "restore complete — verify with: curl -s http://127.0.0.1:${PORT:-3001}/health/ready"
ok "پس از بازیابی، فرآیندها را بررسی کنید (worker/scheduler) و Passenger را restart کنید: touch app/tmp/restart.txt"
exit 0

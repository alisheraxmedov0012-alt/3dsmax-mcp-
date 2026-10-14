#!/usr/bin/env bash
# PostgreSQL restore from a logical backup produced by backup.sh.
#
# Usage:
#   TARGET_DATABASE_URL=postgresql://user:pass@host:5432/db ./restore.sh <dump_file>
#
# Safety:
#   * Refuses to run against a database whose name contains "prod" unless
#     ALLOW_PROD_RESTORE=yes is set, to avoid clobbering production by accident.
#   * Uses --clean --if-exists so the restore is repeatable on a scratch DB.
set -euo pipefail

DUMP_FILE="${1:-}"
if [[ -z "${DUMP_FILE}" || ! -f "${DUMP_FILE}" ]]; then
  echo "Usage: TARGET_DATABASE_URL=... $0 <dump_file>" >&2
  exit 2
fi
if [[ -z "${TARGET_DATABASE_URL:-}" ]]; then
  echo "ERROR: TARGET_DATABASE_URL is not set." >&2
  exit 2
fi

DB_NAME="$(basename "${TARGET_DATABASE_URL%%\?*}")"
if [[ "${DB_NAME}" == *prod* && "${ALLOW_PROD_RESTORE:-}" != "yes" ]]; then
  echo "Refusing to restore into '${DB_NAME}' (looks like production)." >&2
  echo "Set ALLOW_PROD_RESTORE=yes if you really intend to." >&2
  exit 3
fi

echo "Restoring ${DUMP_FILE} -> ${DB_NAME}"
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="${TARGET_DATABASE_URL}" "${DUMP_FILE}"

echo "Restore complete."

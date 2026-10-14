#!/usr/bin/env bash
# PostgreSQL logical backup.
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host:5432/db ./backup.sh [output_dir]
#
# Notes:
#   * Backups are written OUTSIDE the repository by default (/var/backups), and
#     the repository .gitignore also excludes *.dump / backups/ as defence in
#     depth. Never commit a backup.
#   * This is a logical (pg_dump) backup. It is not a substitute for the managed
#     provider's PITR/WAL archiving; RPO/RTO must be agreed with the business.
set -euo pipefail

OUT_DIR="${1:-${BACKUP_DIR:-/var/backups/3dstudio}}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${OUT_DIR}/3dstudio-${STAMP}.dump"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 2
fi

mkdir -p "${OUT_DIR}"

echo "Backing up to ${FILE}"
pg_dump --format=custom --no-owner --no-privileges --dbname="${DATABASE_URL}" --file="${FILE}"

# Verify the archive is readable before declaring success.
pg_restore --list "${FILE}" >/dev/null
echo "Backup OK: ${FILE} ($(du -h "${FILE}" | cut -f1))"

# Retention: keep the most recent 14 backups.
ls -1t "${OUT_DIR}"/3dstudio-*.dump 2>/dev/null | tail -n +15 | xargs -r rm -f

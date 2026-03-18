#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@10.0.0.100:5432/jokai}"
DATABASE_ADMIN_URL="${DATABASE_ADMIN_URL:-postgresql://postgres:postgres@10.0.0.100:5432/postgres}"
JOKAI_LEGACY_STORAGE_DIR="${JOKAI_LEGACY_STORAGE_DIR:-}"

cd "${ROOT_DIR}"
if [[ -n "${JOKAI_LEGACY_STORAGE_DIR}" ]]; then
  exec cargo run -- db status --database-url "${DATABASE_URL}" --admin-database-url "${DATABASE_ADMIN_URL}" --legacy-storage-dir "${JOKAI_LEGACY_STORAGE_DIR}"
else
  exec cargo run -- db status --database-url "${DATABASE_URL}" --admin-database-url "${DATABASE_ADMIN_URL}"
fi

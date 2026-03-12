#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@10.0.0.100:5432/jokai}"
DATABASE_ADMIN_URL="${DATABASE_ADMIN_URL:-postgresql://postgres:postgres@10.0.0.100:5432/postgres}"
JOKAI_STORAGE_DIR="${JOKAI_STORAGE_DIR:-${ROOT_DIR}/data}"

cd "${ROOT_DIR}"
exec cargo run -- db migrate --database-url "${DATABASE_URL}" --admin-database-url "${DATABASE_ADMIN_URL}" --storage-dir "${JOKAI_STORAGE_DIR}"

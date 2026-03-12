#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@10.0.0.100:5432/jokai}"
JOKAI_BIND="${JOKAI_BIND:-0.0.0.0:12040}"
JOKAI_STORAGE_DIR="${JOKAI_STORAGE_DIR:-${ROOT_DIR}/data}"

cd "${ROOT_DIR}"
npm run build
exec cargo run -- web --database-url "${DATABASE_URL}" --bind "${JOKAI_BIND}" --storage-dir "${JOKAI_STORAGE_DIR}"

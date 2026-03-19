#!/usr/bin/env zsh

set -euo pipefail

ROOT_DIR="${0:A:h}"

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@10.0.0.100:5432/jokai}"
JOKAI_BIND="${JOKAI_BIND:-0.0.0.0:12040}"

cd "${ROOT_DIR}"
npm run build
exec cargo run -- web --database-url "${DATABASE_URL}" --bind "${JOKAI_BIND}"

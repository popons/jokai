#!/usr/bin/env zsh

set -euo pipefail

source "${0:A:h}/watch-run-common.sh"

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@10.0.0.100:5432/jokai}"
JOKAI_BIND="${JOKAI_BIND:-0.0.0.0:12040}"

run_jokai_watch_web "${DATABASE_URL}" "${JOKAI_BIND}"

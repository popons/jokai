#!/usr/bin/env zsh

set -euo pipefail

export CARGO_TERM_COLOR=always

WATCH_PATHS=(
  -w src
  -w db
  -w web-src
  -w build.rs
  -w Cargo.toml
  -w package.json
  -w package-lock.json
  -w vite.config.js
)

detect_poll_flag() {
  local kernel
  kernel=$(uname -r)
  if echo "${kernel}" | grep -qE '(Microsoft|WSL)' && echo "${kernel}" | grep -qv 'WSL2'; then
    echo "--poll"
  else
    echo ""
  fi
}

shell_join() {
  local joined=""
  local arg
  for arg in "$@"; do
    joined+="${(q)arg} "
  done
  echo "${joined% }"
}

run_jokai_watch_web() {
  local database_url="$1"
  local bind="$2"
  local storage_dir="$3"
  local poll_flag
  local watch_cmd

  poll_flag=$(detect_poll_flag)
  watch_cmd=$(shell_join npm run build)
  watch_cmd+=" && "
  watch_cmd+=$(shell_join cargo run -- web --database-url "${database_url}" --bind "${bind}" --storage-dir "${storage_dir}")

  if [[ -n "${poll_flag}" ]]; then
    exec cargo watch "${poll_flag}" "${WATCH_PATHS[@]}" -s "${watch_cmd}"
  else
    exec cargo watch "${WATCH_PATHS[@]}" -s "${watch_cmd}"
  fi
}

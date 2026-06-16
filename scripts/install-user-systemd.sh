#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${JOKAI_SYSTEMD_SERVICE_NAME:-jokai}"
BIN_PATH="${JOKAI_BIN_PATH:-$HOME/.cargo/bin/jokai}"
WORK_DIR="${JOKAI_WORK_DIR:-$HOME/.local/share/jokai}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
UNIT_DIR="$CONFIG_HOME/systemd/user"
ENV_DIR="$CONFIG_HOME/jokai"
ENV_FILE="$ENV_DIR/jokai.env"
UNIT_FILE="$UNIT_DIR/$SERVICE_NAME.service"
ENABLE_LINGER="${JOKAI_ENABLE_LINGER:-1}"
DEFAULT_DATABASE_URL="postgresql://postgres:postgres@10.0.0.100:5432/jokai"
DEFAULT_DATABASE_ADMIN_URL="postgresql://postgres:postgres@10.0.0.100:5432/postgres"
DEFAULT_JOKAI_BIND="0.0.0.0:12040"
DEFAULT_JOKAI_BASE_PATH="/toys/jokai"

DATABASE_URL="${DATABASE_URL:-$DEFAULT_DATABASE_URL}"
DATABASE_ADMIN_URL="${DATABASE_ADMIN_URL:-$DEFAULT_DATABASE_ADMIN_URL}"
JOKAI_BIND="${JOKAI_BIND:-$DEFAULT_JOKAI_BIND}"
JOKAI_BASE_PATH="${JOKAI_BASE_PATH:-$DEFAULT_JOKAI_BASE_PATH}"

quote_env_value() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

write_env_if_set() {
  local name="$1"
  local value="${!name:-}"

  if [ -n "$value" ]; then
    printf '%s=%s\n' "$name" "$(quote_env_value "$value")" >>"$ENV_FILE"
  fi
}

if [ ! -x "$BIN_PATH" ]; then
  echo "binary not found or not executable: $BIN_PATH" >&2
  echo "run deck install before installing the user service" >&2
  exit 1
fi

install -d "$UNIT_DIR" "$ENV_DIR" "$WORK_DIR"

: >"$ENV_FILE"
write_env_if_set DATABASE_URL
write_env_if_set DATABASE_ADMIN_URL
write_env_if_set JOKAI_BIND
write_env_if_set JOKAI_BASE_PATH
write_env_if_set JOKAI_PDF_BROWSER_CMD
write_env_if_set JOKAI_PDFTOPPM_CMD
write_env_if_set RUST_LOG

cat >"$UNIT_FILE" <<UNIT
[Unit]
Description=Jokai user service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=$ENV_FILE
ExecStart=$BIN_PATH web
WorkingDirectory=$WORK_DIR
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
UNIT

if [ "$ENABLE_LINGER" != "0" ]; then
  loginctl enable-linger "$USER"
fi

systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE_NAME.service"

echo "installed: $UNIT_FILE"
echo "environment: $ENV_FILE"
echo "status: systemctl --user status $SERVICE_NAME.service --no-pager"

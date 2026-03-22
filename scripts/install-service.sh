#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="cortex-sync"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/$SERVICE_NAME.service"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NPM_PATH="$(command -v npm)"
NODE_BIN_DIR="$(dirname "$(command -v node)")"

if [ -z "$NPM_PATH" ]; then
  echo "Error: npm not found in PATH"
  exit 1
fi

if [ ! -f "$PROJECT_DIR/.env.local" ]; then
  echo "Error: $PROJECT_DIR/.env.local not found"
  exit 1
fi

install_service() {
  mkdir -p "$SERVICE_DIR"

  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Cortex Vault Sync (bidirectional)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR
Environment=PATH=$NODE_BIN_DIR:/usr/local/bin:/usr/bin:/bin
ExecStart=/bin/bash -c 'set -a && source $PROJECT_DIR/.env.local && set +a && exec $NPM_PATH run sync:watch'
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable --now "$SERVICE_NAME"

  echo ""
  echo "Cortex sync service installed and started."
  echo ""
  echo "  Status:  systemctl --user status $SERVICE_NAME"
  echo "  Logs:    npm run sync:logs"
  echo "  Stop:    systemctl --user stop $SERVICE_NAME"
  echo "  Restart: systemctl --user restart $SERVICE_NAME"
  echo "  Remove:  npm run sync:uninstall"
}

uninstall_service() {
  if systemctl --user is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    systemctl --user stop "$SERVICE_NAME"
  fi

  if systemctl --user is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
    systemctl --user disable "$SERVICE_NAME"
  fi

  if [ -f "$SERVICE_FILE" ]; then
    rm "$SERVICE_FILE"
    systemctl --user daemon-reload
    echo "Cortex sync service removed."
  else
    echo "Service file not found. Nothing to remove."
  fi
}

case "${1:-}" in
  install)
    install_service
    ;;
  uninstall)
    uninstall_service
    ;;
  *)
    echo "Usage: $0 {install|uninstall}"
    exit 1
    ;;
esac

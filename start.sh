#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$PROJECT_DIR/run"
LOG_DIR="$PROJECT_DIR/logs"
VENV_DIR="$PROJECT_DIR/.venv"
WEB_PORT="${WEB_PORT:-8000}"

mkdir -p "$RUN_DIR" "$LOG_DIR"

GATEWAY_PID_FILE="$RUN_DIR/gateway.pid"
WEB_PID_FILE="$RUN_DIR/web.pid"

log() {
  printf '\033[1;34m[start]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[warn]\033[0m %s\n' "$*"
}

is_running() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 1
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1
}

start_gateway() {
  if is_running "$GATEWAY_PID_FILE"; then
    log "Gateway déjà démarrée (pid $(cat "$GATEWAY_PID_FILE"))"
    return
  fi

  if [[ ! -d "$VENV_DIR" ]]; then
    warn "Virtualenv manquant ($VENV_DIR). Lance ./install.sh d'abord."
    return 1
  fi

  log "Démarrage gateway_server.py"
  (
    cd "$PROJECT_DIR"
    # shellcheck disable=SC1090
    source "$VENV_DIR/bin/activate"
    nohup python gateway_server.py >"$LOG_DIR/gateway.log" 2>&1 &
    echo $! >"$GATEWAY_PID_FILE"
  )
}

start_web() {
  if is_running "$WEB_PID_FILE"; then
    log "Web server déjà démarré (pid $(cat "$WEB_PID_FILE"))"
    return
  fi

  log "Démarrage frontend sur le port $WEB_PORT"
  (
    cd "$PROJECT_DIR"
    nohup python3 -m http.server "$WEB_PORT" >"$LOG_DIR/web.log" 2>&1 &
    echo $! >"$WEB_PID_FILE"
  )
}

stop_process() {
  local label="$1"
  local pid_file="$2"

  if ! is_running "$pid_file"; then
    warn "$label non actif"
    rm -f "$pid_file"
    return
  fi

  local pid
  pid="$(cat "$pid_file")"
  log "Arrêt $label (pid $pid)"
  kill "$pid" >/dev/null 2>&1 || true

  for _ in {1..20}; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      sleep 0.2
    else
      break
    fi
  done

  if kill -0 "$pid" >/dev/null 2>&1; then
    warn "$label ne répond pas, kill -9"
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi

  rm -f "$pid_file"
}

status() {
  if is_running "$GATEWAY_PID_FILE"; then
    log "Gateway: UP (pid $(cat "$GATEWAY_PID_FILE"))"
  else
    warn "Gateway: DOWN"
  fi

  if is_running "$WEB_PID_FILE"; then
    log "Web: UP (pid $(cat "$WEB_PID_FILE"))"
  else
    warn "Web: DOWN"
  fi

  log "Logs: $LOG_DIR/gateway.log et $LOG_DIR/web.log"
}

cmd="${1:-start}"
case "$cmd" in
  start)
    start_gateway
    start_web
    status
    ;;
  stop)
    stop_process "Web" "$WEB_PID_FILE"
    stop_process "Gateway" "$GATEWAY_PID_FILE"
    status
    ;;
  restart)
    stop_process "Web" "$WEB_PID_FILE"
    stop_process "Gateway" "$GATEWAY_PID_FILE"
    start_gateway
    start_web
    status
    ;;
  status)
    status
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac

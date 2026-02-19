#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${PROJECT_DIR}/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"
GATEWAY_PORT="${GATEWAY_PORT:-8787}"
WEB_PORT="${WEB_PORT:-8000}"
INSTALL_SYSTEM_PACKAGES="${INSTALL_SYSTEM_PACKAGES:-auto}"  # auto|yes|no

log() {
  printf '\033[1;34m[install]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[warn]\033[0m %s\n' "$*"
}

err() {
  printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

need_cmd() {
  if ! has_cmd "$1"; then
    err "Commande requise manquante: $1"
    exit 1
  fi
}

install_system_packages() {
  local use_sudo=""
  if has_cmd sudo; then
    use_sudo="sudo"
  fi

  if has_cmd apt-get; then
    log "Installation paquets système via apt (python3-venv, python3-pip, ffmpeg)"
    ${use_sudo} apt-get update
    ${use_sudo} apt-get install -y python3 python3-venv python3-pip ffmpeg
    return
  fi

  if has_cmd dnf; then
    log "Installation paquets système via dnf (python3, python3-pip, ffmpeg)"
    ${use_sudo} dnf install -y python3 python3-pip ffmpeg
    return
  fi

  if has_cmd yum; then
    log "Installation paquets système via yum (python3, python3-pip, ffmpeg)"
    ${use_sudo} yum install -y python3 python3-pip ffmpeg
    return
  fi

  if has_cmd pacman; then
    log "Installation paquets système via pacman (python, python-pip, ffmpeg)"
    ${use_sudo} pacman -Sy --noconfirm python python-pip ffmpeg
    return
  fi

  warn "Gestionnaire de paquets non reconnu. Installe manuellement: python3, python3-venv, pip, ffmpeg."
}

maybe_install_system() {
  case "$INSTALL_SYSTEM_PACKAGES" in
    yes)
      install_system_packages
      ;;
    no)
      log "Skip installation paquets système (INSTALL_SYSTEM_PACKAGES=no)"
      ;;
    auto)
      if ! has_cmd ffmpeg || ! has_cmd "$PYTHON_BIN"; then
        install_system_packages
      else
        log "Paquets système déjà disponibles"
      fi
      ;;
    *)
      err "Valeur invalide INSTALL_SYSTEM_PACKAGES=$INSTALL_SYSTEM_PACKAGES (attendu: auto|yes|no)"
      exit 1
      ;;
  esac
}

create_venv() {
  need_cmd "$PYTHON_BIN"
  if [[ ! -d "$VENV_DIR" ]]; then
    log "Création virtualenv: $VENV_DIR"
    "$PYTHON_BIN" -m venv "$VENV_DIR"
  else
    log "Virtualenv existant: $VENV_DIR"
  fi

  # shellcheck disable=SC1090
  source "$VENV_DIR/bin/activate"
  log "Mise à jour pip"
  pip install --upgrade pip setuptools wheel
  log "Installation dépendances Python (flask, paho-mqtt)"
  pip install flask paho-mqtt
}

validate_install() {
  log "Validation Python"
  "$VENV_DIR/bin/python" -m py_compile "$PROJECT_DIR/gateway_server.py"
  log "Validation JavaScript"
  need_cmd node
  node --check "$PROJECT_DIR/app.js"

  if has_cmd ffmpeg; then
    log "ffmpeg détecté: $(ffmpeg -version | head -n 1)"
  else
    warn "ffmpeg non détecté: la partie vidéo RTSP->HLS ne fonctionnera pas"
  fi
}

create_run_scripts() {
  mkdir -p "$PROJECT_DIR/bin"

  cat > "$PROJECT_DIR/bin/run_gateway.sh" <<RUN
#!/usr/bin/env bash
set -euo pipefail
cd "$PROJECT_DIR"
source "$VENV_DIR/bin/activate"
exec python gateway_server.py
RUN

  cat > "$PROJECT_DIR/bin/run_web.sh" <<RUN
#!/usr/bin/env bash
set -euo pipefail
cd "$PROJECT_DIR"
exec python3 -m http.server "$WEB_PORT"
RUN

  chmod +x "$PROJECT_DIR/bin/run_gateway.sh" "$PROJECT_DIR/bin/run_web.sh"
  log "Scripts de lancement créés:"
  log "- $PROJECT_DIR/bin/run_gateway.sh"
  log "- $PROJECT_DIR/bin/run_web.sh"
}

print_next_steps() {
  cat <<STEPS

Installation terminée ✅

Démarrage:
  1) Gateway (MQTT + RTSP->HLS)
     $PROJECT_DIR/bin/run_gateway.sh

  2) Frontend
     $PROJECT_DIR/bin/run_web.sh

Ensuite ouvre:
  http://127.0.0.1:${WEB_PORT}

Exemple broker supporté:
  mqtt://XXX.XXX.XXX.XXX:PPPPP

STEPS
}

main() {
  log "Installation Acre MQTT Monitoring"
  maybe_install_system
  create_venv
  validate_install
  create_run_scripts
  print_next_steps
}

main "$@"

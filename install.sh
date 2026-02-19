#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${PROJECT_DIR}/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"
GATEWAY_PORT="${GATEWAY_PORT:-8787}"
WEB_PORT="${WEB_PORT:-8000}"
INSTALL_SYSTEM_PACKAGES="${INSTALL_SYSTEM_PACKAGES:-auto}"  # auto|yes|no

# Auto update depuis GitHub
AUTO_UPDATE_FROM_GITHUB="${AUTO_UPDATE_FROM_GITHUB:-yes}"   # yes|no
UPDATE_REPO_URL="${UPDATE_REPO_URL:-https://github.com/MrJuju0319/Monitoring}"
UPDATE_BRANCH="${UPDATE_BRANCH:-main}"

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

auto_update_from_github() {
  if [[ "$AUTO_UPDATE_FROM_GITHUB" != "yes" ]]; then
    log "Auto update GitHub désactivé (AUTO_UPDATE_FROM_GITHUB=$AUTO_UPDATE_FROM_GITHUB)"
    return
  fi

  if ! has_cmd git; then
    warn "git non disponible, auto update ignoré"
    return
  fi

  if [[ ! -d "$PROJECT_DIR/.git" ]]; then
    warn "Dépôt git introuvable dans $PROJECT_DIR, auto update ignoré"
    return
  fi

  log "Auto update depuis $UPDATE_REPO_URL (branche: $UPDATE_BRANCH)"

  # Conserve l'état local autant que possible (pas de reset destructif)
  if ! git -C "$PROJECT_DIR" fetch "$UPDATE_REPO_URL" "$UPDATE_BRANCH"; then
    warn "fetch impossible, on continue sans auto update"
    return
  fi

  # Essai de fast-forward sur la branche courante
  if ! git -C "$PROJECT_DIR" merge --ff-only FETCH_HEAD; then
    warn "Fast-forward impossible (modifs locales / divergence). Auto update ignoré sans échec."
    return
  fi

  log "Auto update appliqué avec succès"
}

install_system_packages() {
  local use_sudo=""
  if has_cmd sudo; then
    use_sudo="sudo"
  fi

  if has_cmd apt-get; then
    log "Installation paquets système via apt (python3-venv, python3-pip, ffmpeg, git)"
    ${use_sudo} apt-get update
    ${use_sudo} apt-get install -y python3 python3-venv python3-pip ffmpeg git
    return
  fi

  if has_cmd dnf; then
    log "Installation paquets système via dnf (python3, python3-pip, ffmpeg, git)"
    ${use_sudo} dnf install -y python3 python3-pip ffmpeg git
    return
  fi

  if has_cmd yum; then
    log "Installation paquets système via yum (python3, python3-pip, ffmpeg, git)"
    ${use_sudo} yum install -y python3 python3-pip ffmpeg git
    return
  fi

  if has_cmd pacman; then
    log "Installation paquets système via pacman (python, python-pip, ffmpeg, git)"
    ${use_sudo} pacman -Sy --noconfirm python python-pip ffmpeg git
    return
  fi

  warn "Gestionnaire de paquets non reconnu. Installe manuellement: python3, python3-venv, pip, ffmpeg, git."
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
      if ! has_cmd ffmpeg || ! has_cmd "$PYTHON_BIN" || ! has_cmd git; then
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
  log "- $PROJECT_DIR/start.sh"
}

print_next_steps() {
  cat <<STEPS

Installation terminée ✅

Démarrage (recommandé):
  $PROJECT_DIR/start.sh start

Stop:
  $PROJECT_DIR/start.sh stop

Status:
  $PROJECT_DIR/start.sh status

Ou manuellement:
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
  auto_update_from_github
  create_venv
  validate_install
  create_run_scripts
  print_next_steps
}

main "$@"

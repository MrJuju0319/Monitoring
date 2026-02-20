#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${ROOT_DIR}/config/config.prod.yaml"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "[ERROR] config/config.prod.yaml manquant. Créez-le à partir de config/config.example.yaml."
  exit 1
fi

echo "[INFO] Démarrage production avec ${CONFIG_FILE}"

cd "$ROOT_DIR"
NODE_ENV=production node backend/api/server.js

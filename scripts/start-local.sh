#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${ROOT_DIR}/config/config.local.yaml"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "[INFO] config/config.local.yaml absent. Copie de config/config.example.yaml..."
  cp "${ROOT_DIR}/config/config.example.yaml" "$CONFIG_FILE"
fi

echo "[INFO] Démarrage local du backend (mode développement)..."
echo "[INFO] Utiliser le fichier de config: ${CONFIG_FILE}"

cd "$ROOT_DIR"
node backend/api/server.js

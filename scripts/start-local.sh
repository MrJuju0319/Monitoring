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

echo "[TODO] Brancher la commande réelle de lancement backend ici"
# Exemple: node backend/src/index.js --config "$CONFIG_FILE"

echo "[INFO] Démarrage local du frontend (mode développement)..."
echo "[TODO] Brancher la commande réelle de lancement frontend ici"
# Exemple: npm --prefix frontend run dev

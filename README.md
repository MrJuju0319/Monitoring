# Acre MQTT Monitoring

Application web de supervision orientée **MQTT** avec :

- lecture temps réel des topics MQTT,
- plugins **ACRE** configurables par `topicRoot`,
- décodage lisible (zones/secteurs/état contrôleur),
- mur vidéo RTSP avec passerelle locale automatique.

## Important : ton format broker `mqtt://IP:PORT`

✅ **Supporté**.

Tu peux saisir directement un broker au format :

- `mqtt://XXX.XXX.XXX.XXX:PPPPP`

Le frontend le connecte via la passerelle locale `gateway_server.py` (mode TCP MQTT). Les URLs `ws://` / `wss://` restent supportées en connexion navigateur directe.

## Installation automatique (script)

Le projet inclut maintenant un script d'installation :

```bash
./install.sh
```

Ce script :

- installe les prérequis système si possible (`python3`, `venv`, `pip`, `ffmpeg`),
- met à jour automatiquement le code depuis GitHub (`https://github.com/MrJuju0319/Monitoring`) avec branche configurable,
- crée un environnement virtuel `.venv`,
- installe les dépendances Python (`flask`, `paho-mqtt`),
- valide `gateway_server.py` et `app.js`,
- crée les scripts de lancement :
  - `bin/run_gateway.sh`
  - `bin/run_web.sh`
  - `start.sh` (start/stop/restart/status)

### Variables utiles

- `INSTALL_SYSTEM_PACKAGES=auto|yes|no` (défaut `auto`)
- `PYTHON_BIN=python3`
- `WEB_PORT=8000`
- `GATEWAY_PORT=8787`
- `AUTO_UPDATE_FROM_GITHUB=yes|no` (défaut `yes`)
- `UPDATE_REPO_URL=https://github.com/MrJuju0319/Monitoring`
- `UPDATE_BRANCH=main`

Exemples :

```bash
INSTALL_SYSTEM_PACKAGES=no WEB_PORT=8080 ./install.sh
```

```bash
UPDATE_BRANCH=develop ./install.sh
```

## Lancement simplifié

Après installation, utilise le script unique :

```bash
./start.sh start
```

Commandes disponibles :

- `./start.sh start`
- `./start.sh stop`
- `./start.sh restart`
- `./start.sh status`

## Fonctionnalités

### 1) Dashboard

- KPIs : topics, plugins actifs, zones, secteurs, état contrôleur.
- Vue décodée ACRE :
  - zones (`name`, `secteur`, `state`, `entree`)
  - secteurs (`name`, `state`)
  - sections `etat/*` (système, ethernet, alimentation, etc.)
- Vue brute des topics MQTT.

### 2) Serveurs MQTT

- Ajout serveur avec URL broker :
  - `mqtt://...` / `mqtts://...` (via passerelle locale)
  - `ws://...` / `wss://...` (direct navigateur)
- Connexion / déconnexion / suppression.
- Import snapshot JSON (`topic -> payload`).
- Démo préchargée.
- Vider topics.

### 3) Plugins

- Plugin ACRE configurable : serveur + topic root (`acre_indus`, etc.).
- Activation/désactivation/suppression.

### 4) Mur vidéo RTSP

- Ajout/suppression de caméras RTSP.
- La passerelle locale convertit RTSP -> HLS (via ffmpeg) et renvoie une URL lisible par navigateur.
- `webUrl` manuelle possible si tu as déjà un flux HLS.

---

## Démarrage manuel

### A) Frontend

```bash
python3 -m http.server 8000
```

Puis ouvrir `http://127.0.0.1:8000`.

### B) Passerelle locale (MQTT + vidéo)

Pré-requis :

- `python3`
- `pip install flask paho-mqtt`
- `ffmpeg` installé

Lancement :

```bash
python3 gateway_server.py
```

API locale par défaut :

- `http://127.0.0.1:8787`

---

## Exemples de topics ACRE

- `acre_indus/zones/1/name`
- `acre_indus/zones/1/secteur`
- `acre_indus/zones/1/state`
- `acre_indus/zones/1/entree`
- `acre_indus/secteurs/1/name`
- `acre_indus/secteurs/1/state`
- `acre_indus/etat/systeme/Heure Système`
- `acre_indus/etat/ethernet/Adresse IP`
- `acre_indus/etat/alimentation/Alimentation 230V`

## Structure

- `index.html` : UI
- `app.js` : logique MQTT/plugins/caméras
- `styles.css` : style
- `gateway_server.py` : passerelle locale (MQTT TCP + RTSP->HLS)
- `install.sh` : installation automatisée + scripts de lancement
- `start.sh` : démarrage/arrêt/status (gateway + frontend)

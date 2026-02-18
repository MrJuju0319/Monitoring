# Acre MQTT Monitoring

Application web de supervision orientée **MQTT** avec :

- lecture temps réel des topics MQTT,
- plugins de type **ACRE** configurables par `topicRoot`,
- décodage lisible (zones/secteurs/état contrôleur),
- mur vidéo RTSP avec transcoding local automatique vers HLS.

## Fonctionnalités

### 1) Dashboard

- KPIs :
  - nombre de topics reçus,
  - plugins ACRE actifs,
  - zones détectées,
  - secteurs détectés,
  - nombre de valeurs état contrôleur.
- Vue décodée ACRE :
  - zones (`name`, `secteur`, `state`, `entree`),
  - secteurs (`name`, `state`),
  - sections `etat/*` (systeme, ethernet, alimentation, etc.).
- Vue brute des topics MQTT avec icônes par type.

### 2) Serveurs MQTT

- Ajout de serveurs MQTT en **WebSocket** (`ws://` / `wss://`).
- Connexion / déconnexion / suppression.
- Import de snapshot JSON (`topic -> payload`) pour test rapide.
- Snapshot démo fourni selon le format de tes captures.
- Bouton pour vider les topics en mémoire.

### 3) Plugins

- Création d'un plugin:
  - type (`ACRE`, `Custom`),
  - nom,
  - serveur MQTT associé,
  - topic root (`acre_indus`, etc.).
- Activation / désactivation.
- Suppression plugin.

### 4) Mur vidéo RTSP (sans proxy externe)

- Ajout/suppression de caméras RTSP.
- La webapp utilise une **passerelle locale incluse** (`gateway_server.py`) qui fait:
  - `RTSP -> HLS` via `ffmpeg`,
  - exposition des flux HLS lisibles par navigateur.
- Tu peux aussi définir un `webUrl` manuel si tu as déjà un flux HLS.

---

## Démarrage

### A) Frontend

```bash
python3 -m http.server 8000
```

Ouvrir ensuite:

- `http://127.0.0.1:8000`

### B) Passerelle vidéo locale (obligatoire pour RTSP natif)

Pré-requis:

- `python3`
- `pip install flask`
- `ffmpeg` installé sur la machine

Lancement:

```bash
python3 gateway_server.py
```

API par défaut:

- `http://127.0.0.1:8787`

---

## Exemples de topics MQTT (ACRE)

- `acre_indus/zones/1/name`
- `acre_indus/zones/1/secteur`
- `acre_indus/zones/1/state`
- `acre_indus/zones/1/entree`
- `acre_indus/secteurs/1/name`
- `acre_indus/secteurs/1/state`
- `acre_indus/etat/systeme/Heure Système`
- `acre_indus/etat/ethernet/Adresse IP`
- `acre_indus/etat/alimentation/Alimentation 230V`

---

## Structure du projet

- `index.html` : structure UI (dashboard, mqtt, plugins, vidéo)
- `app.js` : logique temps réel MQTT, décodage ACRE, gestion plugins/caméras
- `styles.css` : thème responsive
- `gateway_server.py` : passerelle locale RTSP -> HLS

## Limitations connues

- Les navigateurs ne lisent pas RTSP directement. La passerelle locale règle ce point sans service proxy externe séparé.
- La connexion MQTT côté frontend requiert un endpoint WebSocket sur ton broker.

# Monitoring

Projet de monitoring Acre avec :

1. **Interface web dynamique** (HTML/CSS/JS) pour configurer l'exporter, visualiser les données et placer des overlays sur une image/plan.
2. **Bridge SPC → MQTT** (`spc_mqtt_bridge.py`) pour publier les états et consommer les commandes via MQTT.

## Fonctionnalités web

### 1) Dashboard

- Résumé visuel des volumes de données reçues depuis l'exporter:
  - zones
  - secteurs
  - portes
  - sorties
  - controller

### 2) Configuration Exporter SPC

- Formulaire de configuration depuis la page :
  - host SPC
  - utilisateur SPC
  - host/port MQTT
  - base topic
  - intervalle de refresh
  - flags d'information (`zones`, `secteurs`, `doors`, `outputs`)
- Export JSON de la configuration.
- Sauvegarde locale navigateur (`localStorage`).

### 3) Données exporter visibles

- Zone de texte JSON pour coller/charger les données exporter.
- Rendu de **toutes les catégories** sous forme de cartes :
  - zones
  - secteurs
  - portes
  - sorties
  - controller
- Bouton de chargement d'un exemple de données.

### 4) Plan & Overlays

- Upload d'une image (plan du site/bâtiment).
- Ajout d'overlays liés à une donnée exporter :
  - catégorie (`zones`, `areas`, `doors`, `outputs`, `controller`)
  - id/clé de l'élément
  - champ à afficher (`etat_txt`, `state`, `values.status`, etc.)
  - position X/Y en pourcentage
- Affichage des overlays directement sur l'image.
- Liste des overlays + suppression individuelle.

### 5) Plugins

- Ajout de plugins d'intégration (RTSP, Dahua, Hikvision, custom).

## Bridge SPC → MQTT

Le script `spc_mqtt_bridge.py` fournit :

- Reconnexion de session SPC robuste (cache, validation, relogin).
- Publication MQTT des états :
  - `zones/*`
  - `secteurs/*`
  - `doors/*`
  - `outputs/*`
  - `etat/*` (controller)
- Réception de commandes MQTT `*/+/set` avec accusés de réception :
  - secteurs
  - zones
  - portes
  - sorties
- Boucle de polling avec intervalle configurable.

## Dépendances Python (bridge)

Exemple minimal :

```bash
pip install pyyaml requests beautifulsoup4 paho-mqtt
```

> Le script importe aussi `acre_exp_status.SPCClient` qui doit être disponible dans l'environnement Python.

## Lancement

### 1) Interface web

```bash
python3 -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.

### 2) Bridge SPC → MQTT

```bash
python3 spc_mqtt_bridge.py -c /etc/acre_exp/config.yml
```

Mode debug :

```bash
python3 spc_mqtt_bridge.py -c /etc/acre_exp/config.yml --debug
```

## Structure

- `index.html` : structure des onglets (dashboard, exporter, data, plan, plugins).
- `styles.css` : thème visuel responsive et styles du plan/overlays.
- `app.js` : logique UI (config exporter, rendu des données, overlays image, plugins).
- `spc_mqtt_bridge.py` : watcher SPC + publication/commande MQTT.

## Roadmap suggérée

- Connecter directement la page web au broker MQTT (WebSocket MQTT) pour le temps réel sans copier/coller JSON.
- Ajouter édition drag & drop des overlays sur l'image.
- Persister configuration, données et plans côté backend (API + DB).
- Ajouter un mode multi-plans (un plan par zone/site).

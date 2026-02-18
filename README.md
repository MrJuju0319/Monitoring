# Acre MQTT Monitoring

Interface web orientée **lecture MQTT** (pas d'export SPC dans cette app) pour :

- configurer un ou plusieurs serveurs MQTT,
- activer des plugins de type **ACRE** en choisissant leur topic root,
- afficher les informations (zones, secteurs, états, etc.) avec logos/icônes,
- gérer un mur d'image avec caméras RTSP (ajout/suppression).

## Fonctionnalités

## 1) Dashboard

- Vue synthèse :
  - nombre de topics MQTT reçus,
  - plugins ACRE actifs,
  - nombre de secteurs,
  - nombre de zones.
- Liste des topics décodés avec icônes :
  - 📡 zones
  - 🛡️ secteurs
  - 🚪 portes
  - 🔌 sorties
  - 🧠 état contrôleur

## 2) Serveurs MQTT

- Ajout d'un broker MQTT en **WebSocket** :
  - nom
  - URL (`ws://...` ou `wss://...`)
  - identifiants optionnels
- Connexion / déconnexion par serveur.
- Suppression serveur.
- Import d'un snapshot JSON de topics MQTT (utile pour tests rapides).
- Bouton de chargement d'une démo inspirée de tes captures.

## 3) Plugins

- Création de plugins :
  - type (`ACRE`, `Custom`)
  - nom
  - serveur MQTT associé
  - topic root (ex: `acre_indus`)
- Activation / désactivation plugin.
- Suppression plugin.

## 4) Mur vidéo RTSP

- Ajouter et supprimer des caméras.
- Données caméra :
  - nom
  - URL RTSP
  - URL web optionnelle (proxy HLS/WebRTC)
- Si `webUrl` est renseignée, un player vidéo HTML5 est affiché.
- Sinon, la carte indique qu'un proxy est nécessaire pour affichage web direct de RTSP.

## Données MQTT attendues (exemple ACRE)

Topics typiques lisibles par le dashboard :

- `acre_indus/zones/1/name`
- `acre_indus/zones/1/state`
- `acre_indus/secteurs/1/name`
- `acre_indus/secteurs/1/state`
- `acre_indus/etat/systeme/Heure Système`
- `acre_indus/etat/ethernet/Adresse IP`

## Lancement local

```bash
python3 -m http.server 8000
```

Puis ouvrir :

- `http://localhost:8000`

## Fichiers

- `index.html` : structure UI (dashboard, MQTT, plugins, vidéo)
- `app.js` : logique MQTT, parsing topics, plugins, mur vidéo
- `styles.css` : style responsive

## Notes importantes

- Cette application est maintenant centrée sur la **lecture MQTT uniquement**.
- Le navigateur ne lit pas RTSP nativement : pour un affichage vidéo réel, passer par un proxy/gateway (HLS/WebRTC) et renseigner `webUrl`.

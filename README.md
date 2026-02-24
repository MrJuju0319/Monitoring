# Monitoring Supervision Web (Node.js)

Interface de supervision web moderne pour piloter et visualiser des modules/plugins en temps réel, avec pages **Dashboard**, **Plans**, **État équipements** et **Configuration**.

## Nouveautés principales

- Authentification avec rôles (`admin` / `user`).
- Plugin `MQTT I/O` configurable en web (subscribe/publish + types binary/numeric/text + unité).
- **Configuration complète depuis la page web** pour :
  - plugins,
  - plans (création + image de plan),
  - caméras (RTSP/HLS/ONVIF).

## Comptes de démonstration

- Admin: `admin / admin123`
- User: `user / user123`

## RTSP / ONVIF (important)

Les navigateurs web ne lisent pas directement les URLs `rtsp://` (**RTSP natif navigateur non supporté**).

Exemple valide pour stockage de configuration caméra :

```json
{
  "name": "Porte principale",
  "streamUrl": "rtsp://admin:password@192.168.1.167:554/cam/realmonitor?channel=1&subtype=0",
  "hlsUrl": "https://votre-passerelle/stream/cam1/index.m3u8",
  "onvif": {
    "deviceServiceUrl": "http://192.168.1.167:80/onvif/device_service",
    "username": "admin",
    "password": "password"
  }
}
```

- `streamUrl` peut contenir RTSP (référence source).
- `hlsUrl` doit être renseigné pour lecture web (HLS/WebRTC via passerelle).
- Si `hlsUrl` est vide, un **convertisseur RTSP -> flux web live (HLS)** est démarré automatiquement (`/live/<cameraId>/index.m3u8`) pour l’affichage navigateur.
- Le convertisseur RTSP est lancé dès le démarrage du serveur pour toutes les caméras RTSP configurées (pré-chauffage), afin d’avoir un flux live prêt en continu.
- Réglages ffmpeg/hls.js ajustés pour une **latence vidéo basse** (segments plus courts, buffer live réduit).
- Le backend applique une normalisation automatique des URLs RTSP mal formatées (ex: `rtsp://ip/:554/...` devient `rtsp://ip:554/...`).
- Le mode WebSocket JSMpeg reste disponible en fallback technique.
- Les images de plan uploadées via UI sont converties et enregistrées en **JPG** (fichiers `/public/uploads`), pas en base64.
- `onvif` sert à stocker les informations ONVIF de l’équipement.


## Plugin VisorX (nouveau)

Un plugin **VisorX Control** est disponible dans l’onglet Configuration > Plugins.

Il permet:
- pilotage d’ouverture via `open.cgi` (auth Digest) avec index configurable,
- lecture de l’historique via `GetEvenements.cgi` sur N pages,
- tables de correspondance configurables (nature/lecteur/utilisateur) directement en JSON dans la config plugin.

Endpoints associés:
- `POST /api/plugins/visorx-control/open` (**admin**)
- `GET /api/plugins/visorx-control/events?pages=1`

> Notes: config minimale requise `host`, `user`, `code`.

## Fonctionnalités

- **Mode plan visuel type VISO**: overlays capteurs avec icône état + durée, et dock caméra sélectionnée dans la vue Plans.
- Dashboard global avec résumé des modules, plans, caméras et alertes.
- Historique d’état des capteurs sur une fenêtre de temps configurable.
- Page Plans avec onglet par plan, image de plan et zones `ok/warning/critical`.
- Mode édition des capteurs (drag & drop) + sauvegarde persistée (**admin**).
- Onglet État équipements auto-complété.
- Configuration UI : plugins + plans + caméras.
- Bouton **Rafraîchir** dans l’onglet Configuration pour recharger manuellement les données.
- Pas d’auto-actualisation des onglets de configuration (rafraîchissement manuel via bouton dédié).
- Les mises à jour temps réel ne forcent plus de rechargement complet de la configuration pendant l’édition.
- WebSocket temps réel authentifié.
- Interface responsive.
- Grille caméras responsive (desktop/tablette/mobile) avec vidéos 16:9 adaptatives.
- Panneau **Caméra sélectionnée** en mode Plans, avec sélection au clic sur les tuiles caméra.
- Sélecteur de qualité caméra **HD / LD** pour les flux RTSP convertis.

## API rapide

### Auth
- `POST /api/auth/login`
- `GET /api/me`

### Plugins
- `GET /api/plugins`
- Plugin `RTSP Relay` configurable dans la page Configuration (ffmpegPath, résolution, FPS, bitrate).
- Plugin `VisorX Control` configurable en web (Digest + open.cgi + historique événements).
- `PATCH /api/plugins/:id/enabled` (**admin**)
- `PUT /api/plugins/:id/config` (**admin**)
- `POST /api/plugins/mqtt-io/publish` (**admin**)
- `POST /api/plugins/visorx-control/open` (**admin**)
- `GET /api/plugins/visorx-control/events?pages=1`

### Plans
- `GET /api/plans`
- `POST /api/plans` (**admin**, `multipart/form-data` avec `name` + `image`)
- `PUT /api/plans/:id` (**admin**, `multipart/form-data` avec `name` + `image`)
- `POST /api/plans/:id/zones/positions` (**admin**)

### Caméras
- `GET /api/cameras`
- `POST /api/cameras` (**admin**)
- `PUT /api/cameras/:id` (**admin**)
- `DELETE /api/cameras/:id` (**admin**)
- `GET /api/cameras/:id/playback`
- Convertisseur RTSP->HLS sync au démarrage serveur + resync périodique.
- Variantes HLS locales: `webLiveHdUrl` (HD) et `webLiveLdUrl` (LD).

### Monitoring
- `GET /api/dashboard`
- `GET /api/equipment-status`
- `GET /api/history?minutes=60`
- `GET /api/health`

## Règle de contribution

Conformément à la demande projet:
- **README.md doit être mis à jour à chaque ajout**.
- **changelog.md doit être mis à jour à chaque modification**.


## Prérequis RTSP relay

- `ffmpeg` doit être installé sur le serveur.
- Le plugin `rtsp-relay` doit être activé.
- Le frontend charge `hls.js` pour lire le flux web live HLS généré automatiquement.
- La retransmission est fournie en **HTTP HLS local** via `/live/<cameraId>/index.m3u8`.
- Le flux caméra utilise `streamUrl` en `rtsp://...` (ou `hlsUrl` si disponible pour fallback).

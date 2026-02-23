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

Les navigateurs web ne lisent pas directement les URLs `rtsp://`.

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
- Les images de plan uploadées via UI sont converties et enregistrées en **JPG** (fichiers `/public/uploads`), pas en base64.
- `onvif` sert à stocker les informations ONVIF de l’équipement.

## Fonctionnalités

- Dashboard global avec résumé des modules, plans, caméras et alertes.
- Historique d’état des capteurs sur une fenêtre de temps configurable.
- Page Plans avec onglet par plan, image de plan et zones `ok/warning/critical`.
- Mode édition des capteurs (drag & drop) + sauvegarde persistée (**admin**).
- Onglet État équipements auto-complété.
- Configuration UI : plugins + plans + caméras.
- Bouton **Rafraîchir** dans l’onglet Configuration pour recharger manuellement les données.
- Pas d’auto-actualisation des onglets de configuration (rafraîchissement manuel via bouton dédié).
- WebSocket temps réel authentifié.
- Interface responsive.

## API rapide

### Auth
- `POST /api/auth/login`
- `GET /api/me`

### Plugins
- `GET /api/plugins`
- `PATCH /api/plugins/:id/enabled` (**admin**)
- `PUT /api/plugins/:id/config` (**admin**)
- `POST /api/plugins/mqtt-io/publish` (**admin**)

### Plans
- `GET /api/plans`
- `POST /api/plans` (**admin**, `multipart/form-data` avec `name` + `image`)
- `PUT /api/plans/:id` (**admin**, `multipart/form-data` avec `name` + `image`)
- `POST /api/plans/:id/zones/positions` (**admin**)

### Caméras
- `GET /api/cameras`
- `POST /api/cameras` (**admin**)
- `PUT /api/cameras/:id` (**admin**)
- `GET /api/cameras/:id/playback`

### Monitoring
- `GET /api/dashboard`
- `GET /api/equipment-status`
- `GET /api/history?minutes=60`
- `GET /api/health`

## Règle de contribution

Conformément à la demande projet:
- **README.md doit être mis à jour à chaque ajout**.
- **changelog.md doit être mis à jour à chaque modification**.

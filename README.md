# Monitoring

Plateforme de monitoring avec deux plugins temps réel :

- `mqtt-map` : transforme des messages MQTT en états visuels sur un plan.
- `camera-rtsp` : déclare plusieurs caméras RTSP, expose leur mode de conversion web (HLS/WebRTC/MSE), et publie l’état runtime (online/offline/reconnect/timeout).

## Nouveautés implémentées

- Plugin `plugins/mqtt-map` avec ingestion MQTT + mapping visuel de points.
- Plugin `plugins/camera-rtsp` avec :
  - configuration multi-flux,
  - gestion des stratégies de diffusion web (`hls`, `webrtc`, `mse`),
  - état de flux (`starting`, `online`, `offline`, `reconnecting`),
  - timeout, backoff de reconnexion et erreurs explicites,
  - diffusion SSE des mises à jour caméra (`camera_update`).
- Frontend plan enrichi avec widgets caméra ancrables :
  - position (`x`,`y`), taille (`width`,`height`) et `zIndex`,
  - indicateur visuel d’état (badge + overlay d’erreur/reconnexion).
- API REST caméra pour introspection et pilotage des heartbeats/erreurs.

## Arborescence

```text
.
├── backend/
│   └── api/
│       ├── server.js
│       └── services/
│           └── realtime-bus.js
├── config/
│   ├── config.example.env
│   └── config.example.yaml
├── frontend/
│   └── plans/
│       └── index.html
├── plugins/
│   ├── camera-rtsp/
│   │   ├── config.example.json
│   │   └── index.js
│   └── mqtt-map/
│       ├── config.example.json
│       ├── index.js
│       └── points.model.json
├── scripts/
│   ├── start-local.sh
│   └── start-prod.sh
└── package.json
```

## Installation

```bash
npm install
```

## Lancement

### Local

```bash
./scripts/start-local.sh
```

Puis ouvrir :

- `http://localhost:8080` (plan dynamique points + caméras)
- `http://localhost:8080/api/points`
- `http://localhost:8080/api/cameras`
- `http://localhost:8080/api/stream`

### Production

```bash
./scripts/start-prod.sh
```

## Plugin `camera-rtsp`

### Objectif

Décrire des flux RTSP et leur rendu web sans imposer un seul pipeline média : le plugin publie le **catalogue caméras** + **l’état runtime**, et laisse la stack média (FFmpeg, MediaMTX, GStreamer, Janus, etc.) fournir l’URL finale consommable côté navigateur.

### Exemple de configuration multi-flux

Fichier : `plugins/camera-rtsp/config.example.json`

Chaque flux définit :

- `id`, `name`, `rtspUrl`
- `widget` (`x`, `y`, `width`, `height`, `zIndex`)
- `conversion.strategy` (`hls`, `webrtc`, `mse`)
- `conversion.publicUrl` (URL finale web)
- `timeouts` (`offlineAfterMs`, `reconnectDelayMs`, ...)

### API caméra

- `GET /api/cameras` : retourne toutes les caméras et leur état.
- `POST /api/cameras/:cameraId/heartbeat` : force un heartbeat (simule keepalive/caméra revenue).
- `POST /api/cameras/:cameraId/error` : injecte une erreur explicite (offline/timeouts/etc.).

Exemple :

```bash
curl -X POST http://localhost:8080/api/cameras/cam-entrance/error \
  -H 'content-type: application/json' \
  -d '{"code":"RTSP_OFFLINE","message":"Caméra non joignable"}'
```

### Événements SSE

`GET /api/stream` émet :

- `ready`
- `point_update`
- `camera_update`

## Gestion d’erreurs flux

Le plugin gère les cas suivants :

- **offline** : erreur explicite reportée (`reportError` ou endpoint `/error`).
- **timeout** : aucun heartbeat depuis `offlineAfterMs`.
- **reconnect** : passage en `reconnecting` puis nouvelle tentative.

Le frontend affiche :

- badge d’état (`ok`, `warning`, `error`),
- overlay visuel pour `offline/reconnecting` avec code d’erreur, message et n° tentative.

## Limitations codec / performance

1. **RTSP n’est pas lu nativement par les navigateurs** : une conversion est obligatoire.
2. **HLS** : robuste mais ajoute de la latence (souvent 3–10s selon segment/playlist).
3. **WebRTC** : faible latence mais plus coûteux côté CPU/infra (signaling, NAT traversal).
4. **MSE/fMP4** : performant sur certaines stacks, mais compatibilité codec/container à valider navigateur par navigateur.
5. **Décodage matériel client** : dépend fortement du codec/profil (H264/H265/VP9/AV1) et du poste utilisateur.
6. **Dimensionnement serveur** : la transcodification multi-caméras (surtout re-encode) est le principal facteur de charge.
7. **Bonnes pratiques** :
   - privilégier passthrough vidéo quand possible,
   - limiter la résolution/FPS pour les vignettes plan,
   - séparer worker média et backend API pour scaler indépendamment.

## Plugin `mqtt-map`

### Variables d’environnement supportées

- `MQTT_MAP_BROKER_URL`
- `MQTT_MAP_CLIENT_ID`
- `MQTT_MAP_USERNAME`
- `MQTT_MAP_PASSWORD`
- `MQTT_MAP_CA_FILE`
- `MQTT_MAP_CERT_FILE`
- `MQTT_MAP_KEY_FILE`
- `MQTT_MAP_REJECT_UNAUTHORIZED`

### Modèle de données des points

Schéma formel : `plugins/mqtt-map/points.model.json`

## Notes

- Ce projet n’est **pas** un plugin Minecraft/PaperMC ; il n’y a pas de commandes/permissions/PlaceholderAPI.

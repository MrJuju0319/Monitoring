# Monitoring

Plateforme de monitoring avec un plugin `mqtt-map` qui transforme des messages MQTT en états visuels en temps réel sur un plan.

## Nouveautés implémentées

- Plugin `plugins/mqtt-map` avec :
  - connexion broker MQTT (TLS + authentification),
  - abonnement à plusieurs topics,
  - transformation payload MQTT → état visuel de points.
- Modèle de données formel des points dans `plugins/mqtt-map/points.model.json`.
- API temps réel SSE (`/api/stream`) pour pousser les changements au frontend.
- Frontend plan dynamique (`frontend/plans/index.html`) qui affiche les points et se met à jour en live.

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

Puis ouvrir :

- `http://localhost:8080` (plan dynamique)
- `http://localhost:8080/api/points` (état actuel des points)
- `http://localhost:8080/api/stream` (flux SSE temps réel)

### Production

```bash
./scripts/start-prod.sh
```

## Plugin `mqtt-map`

### Variables d'environnement supportées

- `MQTT_MAP_BROKER_URL` (ex: `mqtts://broker.exemple.com:8883`)
- `MQTT_MAP_CLIENT_ID`
- `MQTT_MAP_USERNAME`
- `MQTT_MAP_PASSWORD`
- `MQTT_MAP_CA_FILE`
- `MQTT_MAP_CERT_FILE`
- `MQTT_MAP_KEY_FILE`
- `MQTT_MAP_REJECT_UNAUTHORIZED` (`false` pour désactiver la validation TLS)

### Modèle de données des points

Chaque point visuel contient :

- `id`: identifiant unique,
- `x`, `y`: position sur le plan (0 à 100, en pourcentage),
- `icon`: icône affichée,
- `color`: couleur de l'état,
- `label`: texte affiché,
- `sourceTopic`: topic MQTT source,
- `status`, `lastPayload`, `lastUpdate`: métadonnées runtime.

Le schéma JSON complet est disponible dans `plugins/mqtt-map/points.model.json`.

## Exemples de mapping MQTT

Fichier : `plugins/mqtt-map/config.example.json`

### 1) Capteur porte

Topic : `site/zone-a/sensor/door`

Payload attendu :

```json
{ "state": "open" }
```

Règles :

- `open` → rouge `#ef4444`, icône `🚪`, préfixe `Ouverte`
- `closed` → vert `#22c55e`, icône `🔒`, préfixe `Fermée`
- défaut → orange `#f59e0b`, icône `❔`, préfixe `Inconnu`

### 2) Capteur température

Topic : `site/zone-a/sensor/temp`

Payload attendu :

```json
{ "level": "critical" }
```

Règles :

- `normal` → vert `#22c55e`, icône `🌡️`, préfixe `OK`
- `warning` → orange `#f59e0b`, icône `⚠️`, préfixe `Alerte`
- `critical` → rouge `#ef4444`, icône `🔥`, préfixe `Critique`
- défaut → gris `#9ca3af`, icône `🌡️`, préfixe `Sans données`

## API temps réel

### `GET /api/points`

Retourne l'état courant de tous les points.

### `GET /api/stream`

Flux SSE qui envoie :

- `ready` à la connexion,
- `point_update` à chaque message MQTT transformé.

## Notes

- Aucun système de commandes/permissions/PlaceholderAPI n'est concerné ici (ce projet n'est pas un plugin Minecraft/PaperMC).

# Monitoring Supervision Web (Node.js)

Interface de supervision web moderne pour piloter et visualiser des modules/plugins en temps réel, avec pages **Dashboard**, **Plans**, **État équipements** et **Configuration**.

## Nouveautés principales

- **Authentification avec rôles** :
  - `admin` : peut configurer, éditer les capteurs, publier MQTT.
  - `user` : lecture seule (visualisation uniquement).
- **Plugin MQTT I/O** configurable en web :
  - abonnement à un topic MQTT,
  - prise en charge de 3 types de données (`binary`, `numeric`, `text`),
  - option d’**unité** (ex: °C, %, V),
  - publication de valeurs de commande vers un topic MQTT.

## Comptes de démonstration

- Admin: `admin / admin123`
- User: `user / user123`

## Fonctionnalités

- Dashboard global avec résumé des modules, plans, caméras et alertes.
- Historique d’état des capteurs sur une fenêtre de temps configurable.
- Page Plans avec onglet par plan et superposition des zones en état `ok/warning/critical`.
- Mode édition des capteurs (drag & drop) + sauvegarde persistée des positions (**admin uniquement**).
- Onglet **État équipements** auto-complété (caméras online/max, liste caméras, plugins actifs/inactifs).
- Configuration plugins depuis l’UI (activation/désactivation + JSON config, **admin uniquement**).
- Mise à jour temps réel via WebSocket.
- Interface responsive (desktop/tablette/mobile).

## Architecture

- `server.js` : API REST + WebSocket + auth + intégration MQTT.
- `public/` : frontend HTML/CSS/JS.
- `data/` : données modules/plans/caméras/utilisateurs.

## Installation

```bash
npm install
```

## Lancement

```bash
npm run dev
```

Puis ouvrir : `http://localhost:3000`.

## API rapide

### Auth
- `POST /api/auth/login`
- `GET /api/me`

### Monitoring
- `GET /api/dashboard`
- `GET /api/plugins`
- `PATCH /api/plugins/:id/enabled` (**admin**)
- `PUT /api/plugins/:id/config` (**admin**)
- `POST /api/plugins/mqtt-io/publish` (**admin**)
- `GET /api/plans`
- `POST /api/plans/:id/zones/positions` (**admin**)
- `GET /api/cameras`
- `GET /api/equipment-status`
- `GET /api/history?minutes=60`
- `GET /api/health`

## Plugin MQTT I/O

Configuration via l’onglet Configuration > module `MQTT I/O`:
- `brokerUrl`
- `username` / `password`
- `subscribeTopic`
- `publishTopic`
- `dataType` (`binary`, `numeric`, `text`)
- `unit`
- `qos`
- `retain`

Comportements:
- `binary` : normalisé en `0|1`.
- `numeric` : borné de `0` à `4`.
- `text` : chaîne libre.

## Règle de contribution

Conformément à la demande projet:
- **README.md doit être mis à jour à chaque ajout**.
- **changelog.md doit être mis à jour à chaque modification**.

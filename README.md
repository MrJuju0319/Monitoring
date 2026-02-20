# Monitoring Supervision Web (Node.js)

Interface de supervision web moderne pour piloter et visualiser des modules/plugins en temps réel, avec pages **Dashboard**, **Plans** et **Configuration**.

## Fonctionnalités

- Dashboard global avec résumé des modules, plans, caméras et alertes.
- Page Plans avec onglet par plan et superposition des zones en état `ok/warning/critical`.
- Page Configuration permettant :
  - activation/désactivation des modules/plugins,
  - édition rapide de la configuration JSON de chaque plugin depuis l’interface.
- Mise à jour temps réel via WebSocket (`/ws`).
- Données persistées dans `data/*.json`.

## Architecture

- `server.js` : API REST + WebSocket + service des fichiers statiques.
- `public/` : frontend HTML/CSS/JS (SPA légère sans framework).
- `data/` : données modules/plans/caméras.

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

- `GET /api/dashboard`
- `GET /api/plugins`
- `PATCH /api/plugins/:id/enabled`
- `PUT /api/plugins/:id/config`
- `GET /api/plans`
- `GET /api/cameras`
- `GET /api/health`

## Notes

- Les états des zones sont simulés toutes les 3 secondes pour démonstration.
- Les flux caméra utilisent des URLs de démonstration (peuvent être remplacées dans `data/cameras.json`).

## Règle de contribution

Conformément à la demande projet:
- **README.md doit être mis à jour à chaque ajout**.
- **changelog.md doit être mis à jour à chaque modification**.

# Changelog

## [0.2.0] - 2026-02-20

### Added
- Page **État équipements** avec agrégation monitoring automatique (caméras online/max, liste caméras avec pastilles vert/rouge, état plugins).
- Endpoint `GET /api/equipment-status` pour exposer l’état des équipements.
- Endpoint `GET /api/history` pour consulter l’historique des changements d’état capteurs sur une durée paramétrable.
- Support de l’historique d’état des capteurs côté dashboard.
- **Mode édition des capteurs** sur la page plans (drag & drop) avec sauvegarde persistée via `POST /api/plans/:id/zones/positions`.
- Responsive amélioré pour sidebar/navigation/pages sur mobile et tablette.

### Changed
- Dashboard enrichi avec bloc historique (fenêtre temporelle configurable).
- Frontend réorganisé pour intégrer la nouvelle page État équipements et les actions de mode édition.

## [0.1.0] - 2026-02-20

### Added
- Initialisation d’une application Node.js de supervision web.
- Backend Express avec API REST pour dashboard, plugins, plans et caméras.
- WebSocket pour mises à jour temps réel des plans.
- Interface web moderne (Dashboard, Plans, Configuration) avec navigation par onglets.
- Activation/désactivation des plugins et édition de configuration JSON depuis l’UI.
- Persistance simple via fichiers JSON dans `data/`.
- Documentation complète dans `README.md`.

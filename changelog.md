# Changelog

## [0.6.2] - 2026-02-23

### Added
- Démarrage automatique (pré-chauffage) du convertisseur RTSP->HLS au lancement du serveur pour toutes les caméras RTSP déjà configurées.

### Changed
- Resynchronisation périodique des convertisseurs RTSP->HLS (démarrage des nouveaux flux RTSP et arrêt des convertisseurs devenus orphelins).
- Création/mise à jour caméra déclenche immédiatement la sync des convertisseurs pour garder le flux live disponible en continu.

## [0.6.1] - 2026-02-23

### Added
- Convertisseur automatique RTSP -> HLS web live (démarrage à la demande) avec exposition statique `/live/<cameraId>/index.m3u8`.
- Plugin `visorx-control` configurable depuis le web avec:
  - action d’ouverture `open.cgi` en authentification Digest,
  - récupération d’historique `GetEvenements.cgi` sur plusieurs pages,
  - mapping nature/lecteur/utilisateur configurable en JSON.
- Nouveaux endpoints:
  - `POST /api/plugins/visorx-control/open`
  - `GET /api/plugins/visorx-control/events?pages=...`
- UI plugin VisorX dans la Configuration (index d’ouverture + lecture événements + sortie formatée).

### Changed
- Lecture RTSP côté UI priorise désormais le flux HLS web live converti pour un affichage navigateur plus robuste.
- RTSP relay renforcé avec options ffmpeg low-latency (`nobuffer`, `low_delay`, `ultrafast`, `zerolatency`).
- Les métadonnées playback caméras incluent le statut d’état du relay pour faciliter le diagnostic.
- Les plans stockent aussi `width/height` pour un affichage dynamique responsive fidèle au ratio d’image.
- La vue plan utilise `background-size: contain` + `aspect-ratio` dynamique.
- Suppression du rechargement complet (`loadData`) sur chaque événement zone temps réel pour éviter toute sensation d’auto-refresh de la configuration.

## [0.6.0] - 2026-02-20

### Added
- Module `rtsp-relay` pour afficher les flux RTSP directement sur la page web (ffmpeg + JSMpeg via WebSocket).
- Configuration complète depuis la page web pour les plugins, les plans et les caméras.
- Rafraîchissement manuel des données de Configuration via bouton dédié (suppression de l’auto-refresh).
- Création de plans depuis l’interface web avec ajout d’image de plan.
- Mise à jour de métadonnées de plans depuis l’UI (nom + image).
- Gestion des caméras depuis l’UI (ajout, édition, RTSP/HLS/ONVIF, statut, zone).
- Endpoints admin ajoutés:
  - `POST /api/plans`
  - `PUT /api/plans/:id`
  - `POST /api/cameras`
  - `PUT /api/cameras/:id`
  - `GET /api/cameras/:id/playback`

### Changed
- Affichage caméras: message RTSP clarifié (nécessité HLS/WebRTC pour le navigateur).
- Taille des tuiles vidéo gérée dynamiquement selon le nombre de caméras.
- Upload image plan: remplacement du base64 par enregistrement fichier JPG dans `/public/uploads`.
- Support de l’image de fond des plans dans la page Plans.
- README enrichi avec exemples de configuration RTSP/ONVIF et recommandations HLS.

## [0.3.0] - 2026-02-20

### Added
- Système d’authentification avec rôles `admin` et `user`.
- Protection des endpoints d’édition pour que seul `admin` puisse modifier/publier.
- Vue de connexion + gestion de session côté frontend.
- Nouveau plugin `MQTT I/O` configurable depuis le web.
- Intégration MQTT backend (connexion broker, souscription topic, parsing binaire/numérique/texte, unité).
- Endpoint de publication MQTT pour le contrôle: `POST /api/plugins/mqtt-io/publish`.
- Rendu du statut runtime MQTT dans l’onglet configuration et dans l’état équipements.
- Ajout de `data/users.json` avec comptes de démonstration.

### Changed
- UI adaptée au rôle courant: mode lecture seule pour `user`, édition complète pour `admin`.
- WebSocket protégé via token d’authentification.
- Documentation README mise à jour pour auth + MQTT.

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

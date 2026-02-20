# Monitoring

Monorepo de base pour une plateforme de monitoring avec séparation nette entre backend, frontend et plugins métier.

## Prérequis

- Git
- Bash (Linux/macOS/WSL)
- Docker + Docker Compose (recommandé pour la DB/MQTT en local)
- Runtime backend/frontend selon vos choix techniques (Node.js, Java, etc.)

## Arborescence

```text
.
├── backend/
│   ├── api/
│   ├── auth/
│   ├── auto-update/
│   ├── db/
│   └── plugins/
├── config/
│   ├── config.example.env
│   └── config.example.yaml
├── frontend/
│   ├── cameras/
│   ├── plans/
│   ├── ui/
│   └── widgets/
├── plugins/
├── scripts/
│   ├── start-local.sh
│   └── start-prod.sh
└── README.md
```

## Configuration centralisée

Les exemples de configuration sont fournis ici :

- `config/config.example.yaml`
- `config/config.example.env`

Ces fichiers couvrent :

- Base de données (DB)
- MQTT
- Auto-update
- Authentification
- Chargement des plugins

### Mise en place locale

1. Copier la configuration :

   ```bash
   cp config/config.example.yaml config/config.local.yaml
   cp config/config.example.env config/.env.local
   ```

2. Adapter les valeurs à votre environnement.

### Mise en place production

1. Créer `config/config.prod.yaml` depuis `config/config.example.yaml`.
2. Externaliser les secrets (vault, variables d'environnement, secret manager).
3. Ne jamais versionner les secrets réels.

## Scripts de démarrage

### Démarrage local

```bash
./scripts/start-local.sh
```

Ce script :

- initialise un `config/config.local.yaml` si absent,
- prépare le lancement backend et frontend en mode développement (points de branchement `TODO` inclus).

### Démarrage production

```bash
./scripts/start-prod.sh
```

Ce script :

- vérifie la présence de `config/config.prod.yaml`,
- prépare le lancement backend/frontend en mode production (points de branchement `TODO` inclus).

## Convention plugins Minecraft

Pour tout plugin Minecraft ajouté dans ce dépôt :

- cible obligatoire : **PaperMC 1.21.8**,
- JDK obligatoire : **Java 21**,
- pour les plugins backend Paper : utiliser **`paper-plugins.yml`** uniquement pour les serveurs backend (conformément à la contrainte projet),
- maintenir ce README à jour à chaque évolution plugin avec :
  - fonctionnalités,
  - commandes,
  - permissions,
  - placeholders PlaceholderAPI,
  - configuration et compatibilité.

Référence : https://docs.papermc.io/paper/dev/getting-started/paper-plugins/

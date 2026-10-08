# Arbestra

Jeu de stratégie web persistant : deux frontends React, une scène Babylon.js, un monolithe Fastify et PostgreSQL comme source de vérité.

## Développement local

Prérequis : Node.js 24+, Corepack/pnpm et PostgreSQL 17.

```powershell
Copy-Item .env.example .env.dev
New-Item -ItemType SymbolicLink -Path .env -Target .env.dev
corepack pnpm db:setup
corepack pnpm dev
```

- Lobby : <http://localhost:5173>
- Monde : <http://localhost:5174/?world=aube>
- Compte de développement : `player@arbestra.local` / `arbestra`

### Tester sur le réseau local

`corepack pnpm dev` écoute aussi en IPv4 sur le réseau local pour les deux interfaces web (5173/5174). Depuis un appareil connecté au même réseau, ouvrir `http://<IPv4-du-PC>:5173`, puis choisir le monde. Les liens entre lobby et monde conservent automatiquement cet hôte ; les variables `VITE_WORLD_CLIENT_URL` et `VITE_LOBBY_URL`, si définies, restent prioritaires. L'API reste sur `127.0.0.1:3000`, accessible aux clients par les proxys web. Le mode e2e reste limité à localhost.

Sur le PC de Tristan, adresse Wi-Fi constatée le 7 octobre 2026 : **http://192.168.1.4:5173** (monde : **http://192.168.1.4:5174/?world=aube**). Cette adresse peut changer avec le DHCP. Garder le serveur lancé et le PC éveillé. Utiliser le réseau principal, sans isolation des clients Wi-Fi. Les réglages DEV/LOD sont locaux à chaque navigateur et à chaque origine : ceux de localhost ne sont pas repris automatiquement sur l'adresse IP.

Le pare-feu doit autoriser Node.js en entrée pour ces ports depuis le réseau local ; aucune redirection de port sur la box n'est nécessaire. Une règle Node.js existante autorise déjà le PC de Tristan. Ce serveur HTTP de développement est destiné au réseau de confiance, pas à une exposition Internet. Les UUID de commandes utilisent `getRandomValues` lorsque le navigateur réserve `randomUUID` aux contextes HTTPS/localhost.

## Inscription et premier village

Le lobby propose **S’inscrire**, puis le choix d’un monde ouvert et les noms du personnage et du village. Le village reprend le modèle conçu par Tristan (mairie, trois maisons en troncs, Jardin sur trois parcelles, chaussées et éclairage), avec 15 habitants, 2 000 bois, 50 carottes, le coffre intact et les Jardins au tiers. Une reprise après création retrouve le même village. Voir la [tranche d’onboarding](./docs/SPEC-ONBOARDING-JOUEUR.md) pour les contrats, tests et limites.

## Tests

Les tests PostgreSQL refusent toute base dont le nom ne finit pas par `_test`.

```sql
-- À exécuter une fois avec un rôle PostgreSQL autorisé :
create database arbestra_test owner arbestra;
```

```powershell
Copy-Item .env.test.example .env.test
corepack pnpm db:test:setup
corepack pnpm test
corepack pnpm test:e2e
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

## Travail avec les agents

Commencer par [AGENTS.md](./AGENTS.md) et l'état courant de [SESSION-HANDOFF.md](./SESSION-HANDOFF.md). Le [workflow de tranche](./docs/AGENT-WORKFLOW.md) précise les statuts, la validation et le format de passation.

Les conventions durables sont dans [docs/architecture](./docs/architecture/README.md). Les specs prospectives y sont signalées séparément du code livré.

La [direction produit](./docs/DIRECTION-PRODUIT.md) rassemble les décisions actuelles et les questions ouvertes sur la découverte, la population et la protection des joueurs. Le [lore TRY — Samsara](./docs-lore/TRY-SAMSARA.md) décrit l'expérience d'essai ; ces intentions ne sont pas une liste de fonctionnalités livrées.

## World generator alpha — tranches A/B

Le panneau opérateur est disponible sur `/world-generator` du client world-web, aussi en build production. Ajouter les emails autorisés à `WORLD_GENERATOR_OPERATOR_EMAILS` (liste séparée par des virgules), avec leurs comptes habituels. La liste est vide par défaut ; aucune permission ne provient du panneau DEV.

Pour un checkout existant, appliquer les migrations additives avec `corepack pnpm db:migrate`, puis redémarrer les services. **Ne pas relancer `db:setup` pour cette mise à jour.** La migration035 conserve ouverts les anciens mondes prêts et crée les candidats suivants fermés. La migration036 ajoute la révision de recette : les nouveaux aperçus v3 utilisent maintenant r5 (hydrologie C, rivières et cascades de 5 à 8 cases, sans migration supplémentaire) ; les anciens artefacts restent intacts. Ces migrations sont appliquées au développement local et à la base de test ; la production doit les appliquer lors du déploiement. Générer un nouvel aperçu pour obtenir la nouvelle géographie.

`corepack pnpm dev` démarre aussi le worker de génération. En production, démarrer séparément `corepack pnpm --filter @arbestra/api generator:start` après build, avec la même connexion PostgreSQL que l’API. Un verrou PostgreSQL autorise un seul calcul à la fois, exécuté dans un processus enfant borné.

Les candidats v2 peuvent être conservés puis ouverts explicitement. Les candidats v3 permettent d’explorer les plateaux, les marches et le climat ; leur ouverture reste bloquée jusqu’au spawn et au streamer compatibles (D/E). La tirette des canaux est active depuis C. Voir [la recette et les limites A/B](docs/RECETTE-WORLD-GENERATOR-AB-2026-10-07.md).

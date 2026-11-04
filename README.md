# Arbestra

![Un village d'Arbestra au lever du jour : maisons de bois et de pierre, un pont, des cascades et un château au loin](apps/world-web/public/arbestra-loading.png)

*Image d'accueil du jeu (contenu sous licence [CC BY-NC-SA 4.0](LICENSE-CONTENT.md)). Ce n'est pas une capture du jeu en cours d'exécution.*

**Arbestra** est un jeu de stratégie en ligne, persistant, qui se joue dans le navigateur. Chaque joueur fonde un village sur un monde partagé et le fait grandir : il construit des bâtiments, des routes et des jardins, récolte du bois et de la pierre, loge et fait travailler ses habitants, étend son territoire, remodèle le terrain, et commerce avec les autres joueurs. Le monde continue de vivre pendant que tu n'es pas là : les chantiers avancent, les habitants travaillent, les récoltes mûrissent.

L'ambition est un jeu qu'on peut jouer cinq minutes pour améliorer sa scierie, ou des heures pour bâtir un royaume, sans fausse urgence. Les intentions sont détaillées dans la [direction produit](docs/DIRECTION-PRODUIT.md) ; ce sont des intentions, pas une liste de fonctionnalités déjà livrées. Pour ce qui se joue aujourd'hui, voir le [changelog de l'alpha](docs/CHANGELOG-ALPHA.md) ; pour la suite, la [feuille de route](docs/ROADMAP.md).

Techniquement : trois interfaces React (lobby, monde, console d'exploitation), une scène 3D Babylon.js, un monolithe Fastify et PostgreSQL comme source de vérité. Le projet est aussi pensé comme un terrain d'apprentissage : le [parcours de lecture](docs/APPRENDRE.md) explique, avec des liens vers le vrai code, comment on construit un jeu comme celui-ci.

## Comment jouer

L'**alpha est ouverte au public**. Crée ton compte sur le lobby : <https://play.arbestra.world> (bouton « S'inscrire »), choisis un monde ouvert, nomme ton personnage et ton village, et tu arrives dans ton village. Le monde de l'alpha est hébergé sur <https://alpha.arbestra.world>. C'est une version de test : le jeu évolue vite et les nouveautés sont racontées dans le [changelog de l'alpha](docs/CHANGELOG-ALPHA.md). Si tu préfères lancer le jeu chez toi, voir « Développement local » ci-dessous.

## Contribuer

De l'aide humaine est la bienvenue, y compris celle des débutants. Tout est dans le [guide de contribution](CONTRIBUTING.md) : installation en local, où regarder, comment proposer un changement (une issue d'abord pour tout ce qui touche au gameplay, car Tristan tranche), conventions. Pour apprendre le code, commence par le [parcours de lecture](docs/APPRENDRE.md) et les [bons premiers tickets](docs/BONS-PREMIERS-TICKETS.md).

## Développement local

Prérequis : Node.js 24+, Corepack/pnpm et PostgreSQL 17.

```powershell
Copy-Item .env.example .env.dev
New-Item -ItemType SymbolicLink -Path .env -Target .env.dev
corepack pnpm db:setup
corepack pnpm dev
```

Équivalent Linux / macOS pour les deux premières lignes : `cp .env.example .env.dev` puis `ln -s .env.dev .env`. Un PostgreSQL local est fourni par `corepack pnpm db:up` (Docker, voir `compose.yaml`), à lancer avant `db:setup`. Le pas-à-pas complet est dans le [guide de contribution](CONTRIBUTING.md#installer-le-projet-en-local).

- Lobby : <http://localhost:5173>
- Monde : <http://localhost:5174/village> (monde par défaut local) ; pour le monde historique : <http://localhost:5174/village?world=aube>
- Console NOC : <http://localhost:5175> (accès privilégié explicite, voir ci-dessous).
- Compte de développement : `player@arbestra.local` / `arbestra`

Sur une base déjà initialisée, lancer seulement `corepack pnpm dev` : `db:setup` migre puis réensemence. La base de tests reste séparée. Pour tester sur un téléphone ou une autre machine du réseau, et pour les réglages propres au poste de Tristan (copie RC1 locale, `.env.local`), voir le [guide développeur](docs/GUIDE-DEVELOPPEUR.md#9-poste-de-développement-réseau-local-et-poste-de-tristan).

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

## Console d’exploitation NOC

`apps/admin-web` fournit une console sombre de supervision et de support en lecture seule : infrastructure observée, mondes, comptes, villages et diagnostics d’activité. Les espaces de commandes administratives restent futurs. Aucun compte n’est autorisé par défaut.

Le diagnostic HTTP V1.1 ajoute les raisons actives du statut et les fiches des requêtes lentes, 5xx ou interrompues, avec référence serveur corrélée aux journaux. La conservation reste locale et bornée : 512 fiches pendant dix minutes au plus. `NOC_HTTP_SLOW_MS` vaut 2 000 ms par défaut ; `NOC_HTTP_LOG_MODE=anomalies|off` contrôle les lignes diagnostiques, sans désactiver les mesures ni les contrôles d’accès.

Configurer `ADMIN_ACCOUNT_IDS` avec les UUID des comptes existants explicitement autorisés et `ADMIN_ORIGIN=http://localhost:5175` pour le développement, puis redémarrer l’API. La console utilise une session distincte de celle du jeu ; les emails ne confèrent aucun droit. `corepack pnpm dev` lance aussi le frontend NOC. Il peut être lancé seul par `corepack pnpm --filter @arbestra/admin-web dev`.

La [documentation d’exploitation](docs/architecture/operations.md) décrit les sources et limites des mesures, la configuration HTTPS de `admin.arbestra.world`, le proxy, les permissions et les vérifications. Les métriques runtime couvrent l’instance répondante ; leur historique borné est perdu au redémarrage. Les diagnostics économiques lisent l’état persisté sans déclencher de réconciliation. La [spec V1](docs/SPEC-NOC-V1.md) précise le périmètre et les critères d’acceptation.

## Travail avec les agents

Commencer par [AGENTS.md](./AGENTS.md) et l'état courant de [SESSION-HANDOFF.md](./SESSION-HANDOFF.md). Le [workflow de tranche](./docs/AGENT-WORKFLOW.md) précise les statuts, la validation et le format de passation.

Les conventions durables sont dans [docs/architecture](./docs/architecture/README.md). Les specs prospectives y sont signalées séparément du code livré.

La [direction produit](./docs/DIRECTION-PRODUIT.md) rassemble les décisions actuelles et les questions ouvertes sur la découverte, la population et la protection des joueurs. Le [lore TRY — Samsara](./docs-lore/TRY-SAMSARA.md) décrit l'expérience d'essai ; ces intentions ne sont pas une liste de fonctionnalités livrées.

## World generator alpha — tranches A/B

Le panneau opérateur est disponible sur `/world-generator` du client world-web, aussi en build production. Ajouter les emails autorisés à `WORLD_GENERATOR_OPERATOR_EMAILS` (liste séparée par des virgules), avec leurs comptes habituels. La liste est vide par défaut ; aucune permission ne provient du panneau DEV.

Pour un checkout existant, appliquer les migrations additives avec `corepack pnpm db:migrate`, puis redémarrer les services. **Ne pas relancer `db:setup` pour cette mise à jour.** La migration035 conserve ouverts les anciens mondes prêts et crée les candidats suivants fermés. La migration036 ajoute la révision de recette : les nouveaux aperçus v3 utilisent maintenant r5 (hydrologie C, rivières et cascades de 5 à 8 cases, sans migration supplémentaire) ; les anciens artefacts restent intacts. Ces migrations sont appliquées au développement local et à la base de test ; la production doit les appliquer lors du déploiement. Générer un nouvel aperçu pour obtenir la nouvelle géographie.

`corepack pnpm dev` démarre aussi le worker de génération. En production, démarrer séparément `corepack pnpm --filter @arbestra/api generator:start` après build, avec la même connexion PostgreSQL que l’API. Un verrou PostgreSQL autorise un seul calcul à la fois, exécuté dans un processus enfant borné.

Les candidats v2 peuvent être conservés puis ouverts explicitement. Les candidats v3 permettent d’explorer les plateaux, les marches et le climat ; leur ouverture reste bloquée jusqu’au spawn et au streamer compatibles (D/E). La tirette des canaux est active depuis C. Voir [la recette et les limites A/B](docs/old/RECETTE-WORLD-GENERATOR-AB-2026-10-07.md).

## Licence

- **Code** : GNU Affero General Public License v3.0 ou ultérieure (`AGPL-3.0-or-later`), texte intégral dans [LICENSE](LICENSE).
- **Contenus non logiciels** (graphismes, textures, modèles 3D, sons, lore, textes de l'Oracle et du jeu) : Creative Commons BY-NC-SA 4.0, sauf exceptions tierces listées dans [LICENSE-CONTENT.md](LICENSE-CONTENT.md).
- Le nom et le logo « Arbestra » ne sont concédés par aucune de ces licences.
- Les contributions sont acceptées sous la licence correspondante : voir [CONTRIBUTING.md](CONTRIBUTING.md#licences-et-contributions). Détails et points en suspens : [inventaire des licences](docs/INVENTAIRE-LICENCES-2026-11-04.md).

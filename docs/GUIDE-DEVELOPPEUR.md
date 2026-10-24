# Guide développeur

Présentation courte du code : qui gère quoi, où trouver une fonction, comment une commande circule. Les règles métier détaillées vivent dans [docs/architecture](architecture/README.md) ; les règles de travail dans [AGENTS.md](../AGENTS.md) ; l'état courant dans [SESSION-HANDOFF.md](../SESSION-HANDOFF.md).

État au 24 octobre 2026. Les numéros de ligne bougent vite : chercher les noms de fonctions.

## 1. Vue d'ensemble

Monolithe TypeScript (Node 24, pnpm), une base PostgreSQL 17 source de vérité.

| Paquet | Rôle |
|---|---|
| `apps/api` | Fastify : routes HTTP, règles métier, sessions, worker de tâches planifiées, flux SSE. Tout ce qui décide (ressources, droits, durées). |
| `apps/world-web` | Client du monde : React (état, panneaux, HUD) + Babylon.js (rendu 3D, sélection spatiale). N'invente aucune valeur économique. |
| `apps/play-web` | Compte, lobby, choix du monde. |
| `apps/admin-web` | Console NOC : supervision, diagnostic HTTP, observation d'un village. |
| `packages/contracts` | Contrats JSON partagés (schémas TypeBox + types) et calculs déterministes communs au serveur et au client : emprises, coûts, trajets, terrain RC1, application des lots V2. |

Pas de Redis ni de file externe : les tâches différées sont des lignes `scheduled_tasks` consommées par le worker intégré à l'API.

Toute entité de monde porte `world_id`. Les coordonnées vivent sur un tore ; le viewport du client n'est jamais une frontière d'autorité.

## 2. Démarrer

```sh
corepack pnpm install
corepack pnpm db:up             # PostgreSQL local (docker compose)
corepack pnpm db:migrate        # migrations sur la base de développement
corepack pnpm dev               # api + clients en parallèle
```

- Tests : `corepack pnpm test` (vitest, fichiers en série) ; ciblé : `corepack pnpm exec vitest run <fichier> -t '<cas>'`. Les tests DB visent `TEST_DATABASE_URL` (suffixe `_test` obligatoire). **Jamais deux suites DB en parallèle** sur la même base.
- CI : `.github/workflows/test.yml` rejoue toute la suite à chaque push sur `main` et `wip/**`, en 4 tranches (`vitest --shard`) sur 4 machines avec chacune son PostgreSQL 17, plus un job format/lint/typecheck : environ 4 minutes, contre 30 en local. Résultats : `gh run list --workflow test.yml`.
- Parallélisme local (facultatif) : `ARBESTRA_TEST_WORKERS=3` clone la base de test par worker (`database/test-workers.ts`, le rôle doit avoir `CREATEDB`). Sur le portable, le gain est faible et les tests de concurrence chronométrés décrochent : la valeur par défaut reste 1.
- Navigateur : `corepack pnpm test:e2e` (Playwright).
- Qualité : `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm format` (Prettier, 120 colonnes, guillemets simples). Le reformatage de masse `102c5f4` est ignoré par `git blame` via `.git-blame-ignore-revs` (`git config blame.ignoreRevsFile .git-blame-ignore-revs`).
- Ne jamais réinitialiser la base de développement : `db:setup` re-seed, `db:test:setup` vise la base de test.

## 3. Serveur (`apps/api/src`)

### Points d'entrée

| Fichier | Contenu |
|---|---|
| `server.ts` | Processus de production : construit l'app, démarre le worker (`startScheduledTaskWorker`, table des handlers par type de tâche) et la purge du journal V2. |
| `app.ts` | `buildApp` : plugins, instrumentation (télémétrie, minutage `dev-timing`, observation NOC), enregistrement de toutes les routes, traduction `HttpError` → réponse. |
| `config.ts` | `loadConfig` : variables d'environnement. |
| `database/` | `connection.ts` (pools, `jit=off`), `migrate.ts` (liste ordonnée des migrations), `migrations/NNN_*.ts` (additives, jamais réécrites après déploiement), `schema.ts` (types Kysely, colonnes en camelCase), `seed.ts`, `reset-e2e.ts`. |
| `jobs/scheduled-tasks.ts` | Boucle du worker : prend une tâche due en `SKIP LOCKED`, appelle son handler dans une transaction, réessaie avec délai progressif. |
| `security/` | Mots de passe, sessions opaques, limitation des tentatives. |
| `errors.ts` | `HttpError(status, code, message)` : seule erreur transmise telle quelle au client. |

### Modules (`modules/`)

| Module | Gère |
|---|---|
| `auth` | Connexion, `authenticate` (cookie → compte). |
| `onboarding` | Carte de spawn, atlas, installation RC1 d'un nouveau village (`installation.ts`), kit de départ. |
| `villages` | Cœur du jeu : construction, économie, exploitation, marché, atelier, voirie, nivellement, synchronisation V1 et V2. Voir ci-dessous. |
| `population` | Cohortes d'habitants : énergie (`energy.ts`), affectations et fusion (`work.ts`), croissance (`growth.ts`), logement (`housing.ts`), gestes (`gestures.ts`), récolte des Jardins et tournées (`garden-harvest.ts`, `garden-tour.ts`), projections (`projection.ts`). |
| `deposits` | Gisements : pierre (`stone-extractions.ts`), bois (`woodland.ts`), chantiers (`worksites.ts`), réserves communes d'extraction (`extraction-pools.ts`). |
| `science` | Université : programmes, connaissances, expéditions asynchrones et leur worker. |
| `navigation` | Calcul de trajets hors transaction (pool de workers CPU `compute.ts`), cache de routes, réseau RC1. |
| `worlds` | Génération et lecture du terrain, sol RC1, vues d'ensemble, routes `/terrain`. |
| `world-generator` | Générateur de mondes (opérateur), candidats, ouverture RC1. |
| `admin` | NOC : authentification séparée, lectures de supervision, observation d'un village en direct. |
| `operations` | Télémétrie, journalisation HTTP, minutage `Server-Timing`, sonde base. |

### Le module `villages` en détail

| Fichier | Gère |
|---|---|
| `routes.ts` | Toutes les routes de commande d'un village (`POST /api/worlds/:worldSlug/villages/:villageId/...`). Négociation V1/V2 par l'en-tête `x-arbestra-protocol: 2`. |
| `service.ts` | Le gros des services historiques : `ownedVillage`, `state` (état complet V1), `villageCommandResult`, constructions, améliorations, science, atelier, exploitation, population, découvertes. |
| `reconcile-economy.ts` | `beginVillageEconomy` (verrou village puis verrous métier, borne temporelle), `reconcileVillageEconomy` (rattrape les transitions dues). |
| `construction.ts` / `complete-construction.ts` | Pose d'un bâtiment (`placeBuilding`) ; fins de chantier et la plupart des handlers du worker (`completeConstruction`, `arrivePopulation`, `completeGardenHarvest`…). |
| `processing*.ts` | Atelier : lots, dépendances, contrat V2. |
| `trade-*.ts`, `market.ts` | Marché joueurs, convois, Oracle. |
| `infrastructure.ts` | Voirie et équipements. |
| `leveling.ts` | Nivellement et terraformation. |
| `harvest-intents.ts`, `harvest-submissions.ts` | Récoltes au geste : intention reçue, traitée par le worker, reçu. |
| `exploitation-budget.ts`, `worksite-admission.ts` | Ordres d'exploitation mixtes, plafonds, admissions. |
| `sync.ts`, `sync-projections.ts`, `sync-revision.ts` | **V1** : SSE `/events`, trames et snapshots complets. En cours de retrait. |
| `sync-v2-*.ts`, `command-v2.ts`, `construction-v2.ts` | **V2** : voir §5. |

## 4. Cycle d'une commande

1. **Route** (`routes.ts`) : valide le schéma TypeBox, `authenticate`, choisit le contrat (V2 si `x-arbestra-protocol: 2`).
2. **Service** : ouvre une transaction, `ownedVillage` vérifie le propriétaire et le monde, puis `beginVillageEconomy` prend le verrou du village **avant** tout verrou métier. La borne `statement_timestamp()` est lue après l'acquisition ; commande et réponse partagent cette borne.
3. **Règles** : lectures sous verrou, refus par `HttpError` (4xx = refus métier, rien n'est écrit), écritures. Les commandes idempotentes stockent un reçu par `commandId`.
4. **Finalisation** : `villageCommandResult` → `finalizeVillageEconomy` (admissions, réveils) et `reconcileRestHousing`.
5. **Réponse** :
   - V1 : `state()` reconstruit l'état complet du village (coûteux) ou une trame ;
   - V2 : `publishPrivateEffects` publie le journal en **dernière** opération de la transaction et renvoie les effets privés (`ConstructionConfirmationV2`, `ProcessingConfirmationV2`, `VillageCommandConfirmationV2`). Toute écriture métier après la publication est refusée.

Ordre des verrous (voir l'[audit de concurrence](AUDIT-CONCURRENCE-ECONOMIE-2026-10-23.md)) : tâche planifiée → village(s) triés par UUID → verrou consultatif `infrastructure:<world>` → gisements par UUID → lignes locales → flux V2. Ne jamais prendre un village après un gisement.

## 5. Synchronisation V2

Spec : [commandes bornées et synchronisation ciblée](SPEC-COMMANDES-BORNEES-SYNCHRONISATION-CIBLEE.md).

- **Collecte** : des triggers PostgreSQL (migrations 051–061) observent chaque table métier et notent les entités touchées dans `game_sync_pending`. Aucun service n'a à « penser » à publier.
- **Publication** : `game_sync_publish()` regroupe les touches en une révision par flux (`game_sync_streams`, `game_sync_changes`, lots dans `game_sync_batches`).
- **Flux** : `village` (privé), connaissance, manifeste, chunks spatiaux, `traffic` (convois publics).
- **Lecture** : `sync-v2-capture.ts` (`captureSyncV2`) lit le journal (`sync-v2-journal.ts`) puis les entités par composant (`sync-v2-readers.ts`, `-shared-`, `-spatial-`, `-traffic-readers.ts`). Delta si possible, sinon snapshot.
- **Routes** (`sync-v2-routes.ts`, préfixe `/api/worlds/:worldSlug/villages/:villageId`) : `bootstrap` (aussi `/api/worlds/:worldSlug/village/bootstrap` au premier chargement), `sync/read`, `sync/stream` (SSE), `presentation` (versionnée).
- **Rétention** : `sync-v2-retention.ts` purge au-delà de 7 jours ou 10 000 entrées par flux.
- **Client** : `packages/contracts/src/sync-v2.ts` (`applySyncV2Batch`, application pure et idempotente), `world-web/src/api/sync-v2-session.ts`, `sync-v2-transport.ts` (requêtes, flux, réouverture d'epoch, gestes), `processing-v2.ts` (hook `useVillageSyncV2`).

Ajouter une table métier lisible en V2 : trigger de collecte dans une migration, composant et lecteur dans `sync-v2-readers.ts`, application côté contrat.

## 6. Client monde (`apps/world-web/src`)

| Emplacement | Contenu |
|---|---|
| `App.tsx` | Orchestration : état du village, mode (construction, exploitation, population…), commandes (`runAction`, `executeConstruction`, `submitExploitation`), choix V1/V2 via `villageV2Ref`. |
| `api/client.ts` | Appels HTTP historiques (V1) et lectures diverses. |
| `api/sync-v2-*.ts`, `api/processing-v2.ts` | Transport V2 et hook React. |
| `api/village-sync.ts`, `sse-reader.ts` | Flux V1 (repli quand la V2 est indisponible). |
| `ui/` | Panneaux React : construction, exploitation, marché, science, HUD, voirie, nivellement, terraformation. |
| `scene/BabylonVillageScene.ts` | Scène Babylon : terrain, bâtiments, sélection, caméras. |
| `scene/*-factory.ts`, `building-*.ts` | Modèles procéduraux des bâtiments, niveaux de détail, miniatures. |
| `scene/village-workers.ts`, `worker-*.ts` | Habitants animés (représentation, aucun crédit économique). |
| `scene/terrain-*.ts`, `rc1-terrain.ts` | Terrain, streaming par chunks, drapé. |
| `scene/village-roads.ts`, `infrastructure-*.ts` | Voirie et équipements. |
| `spawn-map/` | Carte de spawn et installation. |

Options locales utiles : `localStorage['arbestra:sync-v2']` (V2 en développement), `localStorage['arbestra:timing']='1'` (en-têtes `Server-Timing`, aussi en production).

## 7. Où trouver…

| Je cherche | Fichier / fonction |
|---|---|
| L'état complet V1 d'un village | `villages/service.ts` → `state` |
| Le verrou et la borne économique | `villages/reconcile-economy.ts` → `beginVillageEconomy` |
| La pose d'un bâtiment | `villages/construction.ts` → `placeBuilding` ; V2 : `construction-v2.ts` |
| Ce qui se passe à la fin d'un chantier | `villages/complete-construction.ts` → `completeConstruction` |
| La liste des tâches du worker | `server.ts` (table des handlers) |
| L'énergie d'un habitant | `population/energy.ts` → `advanceEnergy` |
| La fusion et l'affectation des cohortes | `population/work.ts` → `mergeCohorts`, `materializeCohorts`, `workingTeam` |
| Les coûts et emprises de bâtiments | `packages/contracts/src/building-costs.ts`, `building-footprint.ts` |
| Le calcul d'un trajet | `packages/contracts/src/route-planner.ts`, `travel-paths.ts` ; côté serveur `modules/navigation/` |
| Une erreur métier renvoyée au joueur | rechercher son code (`'EXPLOITATION_EMPTY'`…) : il est unique |
| Le contrat d'une réponse | `packages/contracts/src/<domaine>.ts`, schéma `…Schema` |
| Pourquoi une requête est lente en prod | activer `arbestra:timing`, lire `arb_*`, `arbsql_n` dans `Server-Timing` ; [operations.md](architecture/operations.md) |
| Déployer | tags `staging-*` / `alpha-*` sur `main` ; [DEPLOIEMENT-VPS.md](DEPLOIEMENT-VPS.md) |

## 8. Pièges connus

- Un gros village peut dépasser les plafonds V2 (4 096 références par snapshot, 1 024 identifiants par composant pour la plupart des lecteurs) : l'échec donne un 500 et un repli V1 silencieux. Voir l'[audit sync V2](AUDIT-SYNC-V2-2026-10-23.md).
- Les triggers par ligne coûtent cher sur les écritures en masse : préférer une instruction unique (voir 058, 060, 061).
- Les migrations déployées ne se modifient pas ; une correction est une nouvelle migration.
- Un test qui partage une transaction de fixture ne peut pas publier puis écrire : la publication V2 est terminale.
- Le rôle applicatif de production n'a pas accès à `kysely_migration` : tester une disponibilité par le catalogue (`to_regclass`), pas par la table des migrations.

# Reprise inter-agent — fondations monde

## Dernière reprise — corrections jardins, 2026-09-05

Cette section prime sur les bilans historiques ci-dessous. La review ciblée a trouvé des écarts dans la livraison Terra ; ils ont été corrigés dans le worktree, sans migration supplémentaire ni modification de la base dev.

- Récolte : réconciliation des extensions échues avant de matérialiser le buffer jusqu'au présent. Régression PostgreSQL : une heure à 60/h puis une heure à 120/h donne bien 180 carottes, même sans passage du worker.
- Polling : actif seulement si construction ou expansion présente ; suppression du piège `undefined !== null`.
- Construction : entrée par `Construire`/`B`, type puis sélection et confirmation. Drag souris, deux coins tactiles. Les bâtiments non spatiaux restent mono-case.
- Sélection : rectangle torique borné, nombre de cases/coût catalogue affichés, aperçu invalide rouge et confirmation désactivée. Une sélection invalide remplace l'ancienne ; `Recommencer`, `Annuler` et Échap nettoient l'aperçu.
- Extension : voisins proposés autour de toute l'emprise active ; vérification locale de l'adjacence. L'identifiant du Jardin à étendre ne dépend plus du menu ouvert : déplacer la caméra conserve la sélection.
- Babylon : contour seul en mode normal, grille détaillée en construction. Aperçu séparé des meshes bâtiment. Le clic gauche de construction ne pilote pas la caméra ; les gestes de caméra habituels restent disponibles hors de ce drag.
- Snapshot : les cellules de la construction initiale sont comptées en chantier, pas actives.
- Validation : 27 tests hors navigateur verts, dont 4 régressions nouvelles ; builds de production contracts/API/lobby/world-web verts (TypeScript inclus, avertissement habituel de taille Babylon). La validation souris/tactile dans le navigateur reste à Tristan ; aucune exécution navigateur par l'agent.
- Aucun commit/push. Ne pas attribuer les modifications antérieures du worktree à cette seule correction.

Date : 2026-09-04. État : **implémentation validée hors navigateur, non commit, non poussée**.

## Complément du 2026-09-05

- Picking Babylon exact au relâchement : un clic hors géométrie interactive ferme le menu ; la reprojection permanente des cases est supprimée.
- La grille globale est remplacée par un unique line system dérivé des cellules métier exposées par le serveur.
- Le décor serveur est fusionné par matériau ; les ombres individuelles des arbres et le fog sont retirés.
- La caméra comprime la perspective au village et rejoint progressivement une vue cartographique au dézoom.
- Génération v2 : noyau central de clairière `5 × 5` libre et quatre gisements déterministes hors noyau. La migration `007_clearing_deposits` enrichit les mondes v1 sans régénérer leur terrain.
- `docs/architecture/spatial-construction.md` est implémentée dans le worktree ; voir la dernière reprise en tête et les réserves de validation manuelle.

## Consigne de session prioritaire

L'interdiction de tests a été explicitement levée. Les tests navigateur restent volontairement à la charge de Tristan, car ils sont coûteux et il pilote manuellement l'UX.

Ne pas écraser les modifications existantes de `apps/world-web/src/scene/BabylonVillageScene.ts` : elles contiennent notamment sa grille de sol manuelle. `docs/architecture/Notes.md` est également non suivi et n'a pas été créé par cette tranche.

## Décisions autoritaires

- Le monde est un tore rectangulaire : `2048 × 1024` cellules, chunks `32 × 32`.
- La cellule canonique est `(world_id, cell_x, cell_y)`. Une cellule vide n'a pas de ligne SQL.
- Les occupations mondiales remplacent les anciennes `village_cells` et `building_cells`.
- Une occupation appartient exactement à un bâtiment ou une feature. Les chantiers réservent leur emprise dès la transaction de commande.
- Les clairières non réclamées sont protégées contre l'expansion normale. Les clairières de village sont `claimed`.
- Terrain : `grassland` constructible, `water` et `rocky_ground` non constructibles.
- Features : `woodland` (une cellule boisée, recette future 2–4 arbres) et `stone_outcrop`; elles bloquent la construction. Fleurs/herbes restent décor client non bloquant.
- Le rayon constructible est Chebyshev `5` autour de toute cellule d'un bâtiment terminé du village. Les chantiers occupent mais n'étendent pas ce rayon.
- Les coordonnées mondiales remplacent les UUID de « site » dans les commandes. L'`id` encore présent dans `VillageCell` est uniquement une clé UI stable, de la forme `x:y`.

Les specs de référence sont :

- `docs/architecture/world-space-and-occupancy.md`
- `docs/architecture/world-generation.md`

## Travail écrit dans le worktree

- Nouvelle migration `006_world_space_and_generation.ts`, enregistrée dans `migrate.ts`.
  - Crée `terrain_types`, `world_chunks`, `world_clearings`, `world_feature_types`, `world_features`, `world_cell_occupancies`.
  - Copie les occupations bâtiment existantes depuis le modèle legacy, puis retire `building_cells`, `village_cells` et `buildings.anchor_cell_id`.
- Nouveau module `apps/api/src/modules/worlds/` :
  - `coordinates.ts` : normalisation et distances toriques.
  - `generation-config.ts` : réglages explicites de la génération v2.
  - `generation.ts` : générateur déterministe, bruit périodique et advisory lock PostgreSQL ; `db:seed` appelle le générateur pour Aube tant que le monde n'est pas `ready`.
- Service villages, routes et client HTTP migrés vers `cellX/cellY`.
- Le contrat de snapshot expose désormais `region` : fenêtre `64×64`, terrains, élévations, features et `generationVersion`.
- Le seed crée l'hôtel de ville directement dans `world_cell_occupancies`.
- Babylon consomme le terrain, les élévations et les features du snapshot. Les faux arbres/rochers locaux ont été retirés ; la grille globale a été remplacée par la grille métier dérivée des cellules accessibles.
- `arbestra_test` a été créée comme base PostgreSQL séparée. Son reset conserve le monde généré et remet seulement l'état joueur à zéro.
- La migration 006 et la génération ont été appliquées à la base dev sans reset : Aube est `ready`, avec 2 048 chunks, 600 clairières, 29 367 features et les 3 bâtiments/4 occupations historiques conservés.

## À reprendre impérativement avant validation

1. Tristan doit contrôler manuellement l'UX Babylon et signaler les corrections visuelles nécessaires. Aucun test navigateur n'a été lancé.
2. Ajouter le point d'entrée de création de monde/spawn lors de la tranche dédiée : la génération doit être appelée transactionnellement à la création du monde, et non seulement depuis le seed de développement.
3. Le futur déplacement de la fenêtre `64 × 64` devra charger les nouvelles données ; les meshes fusionnés de l’ancienne fenêtre sont déjà disposés proprement.
4. Commit/push uniquement sur demande explicite.

## Risques connus à examiner

- Une génération complète prend environ 35–40 secondes sur la machine locale ; les resets suivants sont rapides car les données mondiales immuables sont conservées.
- Le snapshot filtre désormais terrains et features à sa fenêtre côté SQL.
- La future navigation par chunks nécessitera un cycle de vie explicite des meshes/instances ; aucun moteur de streaming n'est implémenté.

## Validation effectuée

- `typecheck` : vert sur contracts, API, lobby et world-web.
- `lint` : vert.
- `build` de production : vert sur les quatre packages ; avertissement connu sur le chunk Babylon (~1,15 Mo brut).
- Vitest complet hors navigateur : 23/23 tests verts.
- PostgreSQL 17 réel : concurrence, retry, idempotence et collision feature/bâtiment validés.
- Migration 006 validée sur une copie de la base dev : 3 bâtiments et 4 occupations conservés.
- Génération : 2 048 chunks complets, 600 clairières espacées d'au moins 40 cellules, 2 400 gisements légers ajoutés et zéro feature dans les noyaux `5 × 5`.

## Spatial gardens -- update 2026-09-05

Status: implemented, migration `008_spatial_gardens` applied to `arbestra_test` and `arbestra` without reset; not committed or pushed.

- Garden stays `level = 1`. Its active footprint area determines its production and capacity.
- Unit values per active cell: `50 wood`, `60 carrot/h`, `600 carrot`.
- Initial construction reserves one filled rectangle (1 to 100 cells) and completes through `building.complete`.
- An extension creates `building_expansions`, one `building-expansion.complete` scheduled task, and occupancy rows with `pending_expansion_id`.
- Reserved cells block construction but contribute no production, capacity, or build radius.
- At the logical deadline the worker materializes the existing Garden buffer first, activates the reserved cells, then completes the expansion. This is transactional and idempotent.
- Harvest remains available during an expansion and uses active area only.
- The server validates filled-rectangle shape, collisions, and adjacency to at least one active Garden cell.

### Core files

- `apps/api/src/database/migrations/008_spatial_gardens.ts`
- `apps/api/src/modules/villages/spatial-selection.ts`
- `apps/api/src/modules/villages/complete-construction.ts`
- `apps/api/src/modules/villages/economy.ts`
- `apps/api/src/modules/villages/service.ts`
- `packages/contracts/src/villages.ts`
- `apps/world-web/src/App.tsx`

### API / snapshot

- Spatial construction: `POST .../buildings` with `buildingType`, `anchorCellX`, `anchorCellY`, `cells`.
- Garden expansion: `POST .../buildings/:buildingId/expansions` with `cells`.
- Snapshot Garden exposes `activeCellCount`, `pendingCellCount`, and optional `expansion`.
- All footprint cells carry the same `footprint.buildingId`; anchor, active extension, and reserved extension resolve to the same Garden menu.
- The legacy single-cell build payload is still accepted temporarily for old MVP tests. New client code uses spatial selection.

### Manual UX validation required

- Normal mode: empty cells are not pickable, so no free-cell menu on arbitrary clicks.
- Bottom bar: type -> first corner -> second corner -> confirm. Same selector is used for Garden extensions.
- Check initial multi-cell Garden, multi-cell extension, collision/obstacle, clicking an extension cell, completion, and F5/reconnect.
- Browser automation was deliberately not run.

### Validation done

- `db:migrate:test`: OK.
- `db:migrate` development: OK, without reset.
- API and world-web typecheck: OK.
- lint: OK.
- `git diff --check`: OK, CRLF warnings only.
- PostgreSQL economic integration suite passed after adapting the concurrent extension case.

### Reprise warnings

- The full worktree is still uncommitted and includes prior world/visual work. Do not assume every modified file belongs solely to spatial gardens.
- Never reset `arbestra`; apply migrations only. Reset only `arbestra_test`.
- Do not overwrite `docs/architecture/Notes.md` or Tristan's manual grid adjustments in `BabylonVillageScene.ts`.
- `docs/architecture/spatial-construction.md` is implemented; the earlier statement above calling it a future Terra tranche is stale.

## Git

Dernier commit de référence : `c75115f feat: establish world and economy foundations` (déjà poussé). La tranche présente n'est pas committée.

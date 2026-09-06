# Coffre et journal de l'Oracle — 7 septembre 2026

Revue et corrections demandées par Tristan : [verdict et levée des réserves](docs/REVIEW-ASTRA-2026-09-07-COFFRE-JOURNAL.md). Les trois preuves sont renforcées ; deux mutations temporaires ont démontré la sensibilité des tests. Validation finale : **83 tests**, **4 parcours Playwright desktop/mobile**, lint, typecheck et build verts. Le parcours ancien accomplissement/clavier est validé. Les réserves techniques sont levées ; l'indice reste à arbitrer. Commit/push autorisés par Tristan pour ce lot et ses documents de référence ; `hud.css` reste hors livraison.

Sol a implémenté la [spec coffre/journal](docs/SPEC-COFFRE-JOURNAL-ORACLE.md) sur la base `master`, `1da6df0` : accomplissement PostgreSQL `town-hall-supplies`, crédit atomique et idempotent des 2 000 carottes, migration conservatrice 014, célébration Oracle et grimoire persistant dans le HUD. Voir le [handoff et les preuves](docs/HANDOFF-SOL-2026-09-07-COFFRE-JOURNAL-ORACLE.md).

Statut : **implémentée / à valider pour l'indice**. Les résultats finaux de correction figurent ci-dessus et dans la revue. Sol avait également contrôlé dans le Chrome de Tristan : journal vide, coffre, 2 050 carottes, entrée datée et F5. Migration appliquée uniquement à la base test ; base dev intacte.

Seule limite de tranche : le délai et la règle de l'indice de l'Oracle restent ouverts ; la proposition actuelle est 90 secondes de présence active sans action métier réussie, une fois par session. Première récolte recommandée ensuite. Ce handoff accompagne la livraison Git demandée ; vérifier son commit et le distant avec Git à la reprise. Préserver `apps/world-web/src/hud.css`, brouillon non suivi préexistant.

## Consolidation produit — état au 6 septembre 2026

Travail courant : **consolidation documentaire terminée**, sans implémentation. Lire la [direction produit](docs/DIRECTION-PRODUIT.md) : parcours standard inscription → monde → spawn → quêtes ; TRY dans un village abandonné partiellement construit, puis inscription pour le garder ou commencer un village neuf ; coffre/Jardin, quêtes parallèles bois-pierre, population et satisfaction, Oracle, karma. Elle distingue décisions actées, pistes et arbitrages ouverts ; elle ne rend pas ces systèmes livrés. Le [lore TRY](docs-lore/TRY-SAMSARA.md), préexistant et non suivi à cette reprise, porte désormais cette évolution au-dessus de son texte initial conservé comme historique. Les modalités de conservation du village restent ouvertes.

Base relue : `master`, `1da6df0` (population, pierre, interactions, Habitation niveau 2). Réserves applicatives : contrôle visuel des dernières corrections de revue, Playwright historique à adapter ; voir la [revue de clôture](docs/REVIEW-ASTRA-2026-09-06-CLOTURE.md). Aucun test applicatif relancé pour cette consolidation.

Précision TRY actée : garder le village conserve toute la progression, constructions et ressources incluses. L'essai sans compte est plafonné par des niveaux de bâtiments nécessitant l'inscription/incarnation pour poursuivre (Scierie 6 comme exemple, seuils à calibrer), pas par le temps passé. Les modalités techniques de conservation et d'attribution restent à cadrer.

À cette date, la prochaine tranche prévue pour **Sol** était le [coffre et journal de l'Oracle](docs/SPEC-COFFRE-JOURNAL-ORACLE.md). Elle est désormais implémentée ; l'état courant et ses preuves figurent en tête de ce fichier. Le déclenchement de l'indice reste proposé à 90 secondes et non acté. Première récolte et architecture TRY sont des tranches suivantes à ordonner. Ne pas engager population/humeur/combat au seul motif qu'ils figurent dans la direction produit. Les réveils lisibles restent un cadrage distinct.

Git au 6 septembre : modifications documentaires seulement ; aucun commit/push pour cette tâche. L'état Git courant est décrit en tête de ce fichier. `apps/world-web/src/hud.css` reste intact. `docs-lore/` était non suivi avant les éditions ; seul le préambule d'évolution a été ajouté à son document TRY. Vérification documentaire : liens locaux des documents édités et diff contrôlés ; les comptes de tests ci-dessous sont historiques.

## Notes antérieures — historique, pas état courant

Les sections suivantes conservent les preuves et le contexte de leurs reprises. Leurs mentions « aucun commit/push », délégations et propositions sont datées ; elles ne remplacent ni le point de reprise ci-dessus ni les décisions produit consolidées.

# Revue de publication — 6 septembre 2026

À la demande de Tristan : revue, clôture technique et publication du lot population/pierre/interactions React/Habitation niveau 2. Voir la [revue Astra et ses réserves](docs/REVIEW-ASTRA-2026-09-06-CLOTURE.md). Le parcours complet a été validé humainement par Tristan avec Sol ; la suite Playwright historique reste à adapter. La revue corrige le rafraîchissement du coffre concurrent, la conservation de l'effectif pierre et les intentions d'extraction par cible. Ces dernières corrections restent à recontrôler visuellement par Tristan. Les anciens statuts « aucun commit/push » ci-dessous décrivent les reprises précédentes.

# Design du réveil des cohortes pour Astra — 6 septembre 2026

Tristan demande que le joueur puisse savoir quand les cohortes se réveillent. Voir la [note de design de Sol pour Astra](docs/DESIGN-SOL-2026-09-06-REVEIL-COHORTES-POUR-ASTRA.md) : vagues de réveil autoritatives exposées sans IDs techniques, prochain effectif et heure du dernier réveil, distinction explicite entre sommeil et manque de couchages. Statut : **proposition en cadrage** ; documentation uniquement, aucun commit/push.

# Proposition de quêtes joueur pour Astra — 6 septembre 2026

> Correctif UI courant : le HUD ne recevait aucun clic car `.top-bar` déclarait `pointer-events: none`. La barre reçoit désormais les événements et la pile de notifications demeure transparente. Validation navigateur laissée explicitement à Tristan ; aucun commit/push.

> Correctif énergie courant : le serveur projetait correctement le réveil automatique, mais le front ne pollait pas lorsque le repos était la seule transition. `App.tsx` rafraîchit désormais toutes les dix secondes tant que des habitants sont au repos. Validation navigateur laissée à Tristan ; aucun commit/push.

Tristan propose de faire du coffre de l'Hôtel de ville la première quête joueur, la complétion de la quête devenant l'autorité qui crédite les 2 000 carottes. Sol recommande un onboarding scénarisé minimal, sans moteur générique prématuré. Voir le [handoff de cadrage pour Astra](docs/HANDOFF-SOL-2026-09-06-QUETES-JOUEUR-POUR-ASTRA.md). Statut : **proposition en cadrage** ; aucun code, test, accès base, commit ou push pour cette discussion.

# Habitation niveau 2 — 6 septembre 2026

Sol a ajouté l'amélioration de l'Habitation : 300 bois, 120 secondes, 25 couchages après achèvement et corps Babylon plus sombre. Voir le [handoff et les preuves](docs/HANDOFF-SOL-2026-09-06-HABITATION-NIVEAU-2.md). Migration additive 013 appliquée avec succès à la base de développement, sans reset ni seed. 78 tests verts, lint/build/typechecks verts. Validation navigateur explicitement laissée à Tristan. Aucun commit/push.

# Interactions joueur prises en charge par Sol — 6 septembre 2026

À la demande de Tristan, Sol a repris le front React et branché HUD/population, coffre, récolte différée et menu pierre, avec découpage borné d'`App.tsx`. Voir le [handoff et les preuves](docs/HANDOFF-SOL-2026-09-06-INTERACTIONS-JOUEUR.md). Statut : **implémentée / à valider sur les parcours métier complets**, sans commit/push. Suite actuelle : 77 tests verts, lint/build/typechecks verts ; vérification Chrome partielle avec une correction issue du parcours. La base dev contient 800 habitants ajoutés manuellement par Tristan : ne pas traiter cette fixture comme un défaut applicatif ni la modifier.

# Audit et relais à Sol — 6 septembre 2026

Tristan confie exceptionnellement le clavier à Sol et demande de lui transmettre l'[audit Astra : priorités métier et frontières React](docs/AUDIT-ASTRA-2026-09-06-PRIORITES-POUR-SOL.md). Audit statique : constats, limites et tranches proposées, sans validation automatique des choix gameplay. La recommandation est une extraction limitée HUD/panneau construire, puis l'intégration habitants–récoltes et pierre. Ce relais explicite prime sur l'ancienne répartition « React à Tristan » ; suivre les instructions courantes de Tristan pour le périmètre de Sol. Enregistrement documentaire uniquement, aucun test applicatif ni commit/push.

# Finition gisements pierre — 5 septembre 2026

La finition Astra est implémentée après la revue Terra. Voir le [handoff et ses preuves](docs/HANDOFF-ASTRA-2026-09-05-gisements.md) et le [contrat React](docs/API-EXPLOITATION-GISEMENTS.md). Cette note prime sur les statuts historiques ci-dessous. Aucun commit/push. La migration 012 a été appliquée à la base de développement à la demande explicite de Tristan, sans reset ni seed. React et validation visuelle restent à Tristan.

# Reprise inter-agent — état courant

## Point de reprise — 5 septembre 2026

Lire [AGENTS.md](./AGENTS.md) et le [workflow](./docs/AGENT-WORKFLOW.md). Cette section remplace les statuts et consignes opérationnelles historiques plus bas ; vérifier toujours le worktree réel.

- Dernière tranche applicative clôturée : ordre économique par village, commit `4dfd494`, poussé sur `origin/master`. [Handoff et preuves](./docs/HANDOFF-ASTRA-2026-09-05-economic-order.md) : 39 tests verts à cette clôture, lint/typecheck verts, défaut historique reproduit rétrospectivement. Ce compte n'est pas une validation des futurs changements.
- Migration `009_economic_task_notifications` appliquée ensuite à la base de développement, à la demande explicite de Tristan ; le migrateur a signalé `Success` puis aucune migration restante à la seconde exécution. Le handoff daté décrit l'état antérieur, limité à la base test.
- Tranche habitants et récolte différée : implémentation hors UI React terminée dans le worktree, à valider/committer. [Handoff](./docs/HANDOFF-TERRA-2026-09-05-population-et-recolte.md), [spec](./docs/SPEC-TERRA-2026-09-05-habitants-et-recolte.md), [mock-up/API pour le product owner](./docs/UI-MOCKUP-2026-09-05-habitants-et-recolte.md). Migrations 010/011 testées uniquement sur `arbestra_test`; ne pas présumer leur application au développement.
- Gisements : [brief de Sol](./docs/architecture/Sol-Brief-exploit.md) conservé comme cadrage futur. Ce n'est pas une instruction de démarrer son implémentation.
- Travail documentaire courant : consignes agent/workflow et clarification des références. Les nouveaux documents de spec/PO et le brief existaient déjà dans le worktree avant cette mise à jour ; ne pas les attribuer à une implémentation.
- La présente mise à jour documentaire n'est pas un commit/push. Vérifier `git status` avant toute reprise ; ne pas déduire une autorisation de publication de celle donnée pour la tranche économique clôturée.

## Archives — fondations monde et Jardins

Les sections suivantes sont conservées pour leur historique. Leurs statuts « non commité », chiffres de tests, références Git et restrictions de session décrivent leurs dates d'origine, pas l'état courant. La délégation ancienne des tests navigateur à Tristan n'est pas une dispense permanente de validation des nouvelles tranches.

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

## Ancienne consigne de session (archive)

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

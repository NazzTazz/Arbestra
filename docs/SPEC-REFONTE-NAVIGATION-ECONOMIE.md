# Refonte de la navigation et de l'économie : durées découplées, planificateur unique, calcul hors verrou, registre et processus

Date : 23 octobre 2026. Base relue : `main`, `5c1fb33` (code formaté par Prettier depuis `102c5f4` ; les numéros de ligne ci-dessous renvoient à cette base).

Statut : **spécification proposée, étude seule**. Aucun des changements décrits n'est livré par sa rédaction ; la demande courante autorise l'étude et la spécification, pas l'implémentation ni un déploiement. Elle s'appuie sur la [revue d'architecture du 23 octobre](REVUE-ARCHITECTURE-2026-10-23.md), dont chaque constat utilisé a été revérifié dans le code (section 1).

Documents de référence : [AGENTS.md](../AGENTS.md), [commandes bornées et synchronisation ciblée](SPEC-COMMANDES-BORNEES-SYNCHRONISATION-CIBLEE.md) (« spec V2 » ci-dessous), [pathfinding hiérarchique](SPEC-PATHFINDING-HIERARCHIQUE.md), [économie](architecture/economy.md), [temps serveur](architecture/server-time.md), [audit des coûts du 21 octobre](AUDIT-COUTS-SERVEUR-2026-10-21.md), [incident worker du 21 octobre](INCIDENT-ALPHA-WORKER-2026-10-21.md).

## 0. Résultat attendu et lecture retenue

Quatre changements, livrables séparément, dans cet ordre de dépendance :

1. **Durées économiques découplées du chemin détaillé.** Une durée de transport vient d'une distance stable et reproductible ; le tracé fin ne sert qu'à la présentation.
2. **Planificateur unique.** Une convention torique, un tas, des budgets en nœuds, trois issues explicites : trouvé, inaccessible prouvé, budget épuisé.
3. **Calcul hors verrou, validation de version sous verrou court.** Aucune recherche de chemin ni construction de réseau pendant qu'un verrou économique est tenu.
4. **Registre `resource_movements` et abstraction `processes`.** Chaque mouvement de ressource est journalisé ; les mécaniques à échéance partagent une table et un gestionnaire de fin.

Lecture retenue pour cette rédaction : les règles de gameplay actuelles (une seconde par case, porteurs `ceil(max(aller, retour) / 250)`, portée 16 cases, départs, réservations, énergie) sont **inchangées** sauf mention explicite dans la section 8 « À trancher par Tristan ». Quand une cible technique change une valeur perçue par le joueur, elle est signalée là, pas décidée ici.

Hors scope, comme dans la spec V2 : microservices, Redis, broker externe, WebSocket, moteur générique de workflows, event sourcing de toute l'économie, refonte du rendu, portage Rust/WASM. Le pool de navigation (`NavigationCompute`), le scheduler `SKIP LOCKED` et les tables du cache hiérarchique (migration 046) sont réutilisés.

## 1. Vérification des constats de la revue

Chaque ligne a été relue dans le code de `5c1fb33`. « Confirmé » signifie que le code montre exactement le constat ; « nuancé » qu'il est vrai avec une précision ; « infirmé » que la revue se trompait.

### 1.1 Navigation

| Constat de la revue | Vérification | Statut |
|---|---|---|
| Six implémentations de recherche coexistent | A* par cible : `buildTravelNetwork`, [travel-paths.ts:275](../packages/contracts/src/travel-paths.ts#L275). A* de raffinement : `refineTravelRoute`, [travel-paths.ts:633](../packages/contracts/src/travel-paths.ts#L633). A* grossier puis fin : `planRoute`/`searchRoute`, [route-planner.ts:113](../packages/contracts/src/route-planner.ts#L113), [:143](../packages/contracts/src/route-planner.ts#L143). HPA* paresseux : `planHierarchicalRoute`, [hierarchical-route.ts:103](../packages/contracts/src/hierarchical-route.ts#L103). Dijkstra d'accès : `buildSpawnAccessNetwork`, [spawn-access.ts:58](../packages/contracts/src/spawn-access.ts#L58). Dijkstra des tournées avec tri de la file à chaque pas : `planGardenTour`, [garden-tour.ts:48-49](../packages/contracts/src/garden-tour.ts#L48). | Confirmé |
| Deux fonctions de distance torique divergent à exactement une demi-dimension | `delta` locale, [travel-paths.ts:69-72](../packages/contracts/src/travel-paths.ts#L69) : `direct > size/2 ? direct - size : direct < -size/2 ? direct + size : direct`, qui garde le signe direct à ±size/2. `spawnDelta`, [spawn-map.ts:116-118](../packages/contracts/src/spawn-map.ts#L116) : `wrapClimate(a - b + size/2, size) - size/2`, qui renvoie −size/2. | Confirmé |
| Les budgets sont en millisecondes et le résultat dépend de la charge | `searchBudgetMs ?? (meshes ? 250 : 0)`, [compute-worker.ts:298](../apps/api/src/modules/navigation/compute-worker.ts#L298) ; watchdogs 31 000 / 6 000 ms, [compute.ts:217](../apps/api/src/modules/navigation/compute.ts#L217) ; arbres locaux 150 ms, [hierarchical-route.ts:376](../packages/contracts/src/hierarchical-route.ts#L376) ; réparations 500 ms / 32 768 nœuds, [hierarchical-route.ts:253](../packages/contracts/src/hierarchical-route.ts#L253). `planRoute` répartit `maxDurationMs` entre passes grossière et fine, [route-planner.ts:113-141](../packages/contracts/src/route-planner.ts#L113). | Confirmé |
| Faux « inaccessible » par élagage du détour | Élagage à +128 pas fins sans marquer `limited`, [travel-paths.ts:930](../packages/contracts/src/travel-paths.ts#L930) et [:995](../packages/contracts/src/travel-paths.ts#L995) ; `limited ||= pending.length > 0` seulement quand la file est vide, [:1012](../packages/contracts/src/travel-paths.ts#L1012) ; `null` sans `onLimit` → `DESTINATION_UNREACHABLE`, [service.ts:629](../apps/api/src/modules/villages/service.ts#L629) ; cible abandonnée `'unreachable'`, [worksites.ts:542-549](../apps/api/src/modules/deposits/worksites.ts#L542). Même travers à +8 cases dans `buildTravelNetwork`, [travel-paths.ts:419](../packages/contracts/src/travel-paths.ts#L419). | Confirmé |
| Route droite non certifiée insérée en cas d'échec | `routes.push({ ...goal, cells: [start, goal.destination] })`, [travel-paths.ts:470](../packages/contracts/src/travel-paths.ts#L470). | Confirmé |
| Réseau dépendant de l'ordre des cibles | Bonus `shared.has(edge) ? 0.7 : 1`, [travel-paths.ts:451](../packages/contracts/src/travel-paths.ts#L451), alimenté par les routes déjà trouvées. | Confirmé |
| Clé de cache = sérialisation JSON du village entier | `networkCache`, [travel-paths.ts:114](../packages/contracts/src/travel-paths.ts#L114) ; signature incluant `region.terrainCodes`, [travel-paths.ts:300](../packages/contracts/src/travel-paths.ts#L300). | Confirmé |
| Inaccessibilité jamais prouvée ; budget épuisé → occupé, réessayé indéfiniment | `budget-exceeded` → `TRADE_PREPARATION_BUSY` 503, [trade-service.ts:215-218](../apps/api/src/modules/villages/trade-service.ts#L215) ; raffinement épuisé → `Refinement search budget exhausted`, [compute-worker.ts:234](../apps/api/src/modules/navigation/compute-worker.ts#L234) → `NAVIGATION_UNAVAILABLE`, [compute.ts:297](../apps/api/src/modules/navigation/compute.ts#L297) ; recul plafonné à 300 000 ms, [scheduled-tasks.ts:64](../apps/api/src/jobs/scheduled-tasks.ts#L64). Aucun cache négatif (conforme à la spec hiérarchique, qui l'interdit faute de preuve). | Confirmé |
| Le watchdog tue le worker et perd ses caches | `fail()` → `worker.terminate()`, [compute.ts:326-344](../apps/api/src/modules/navigation/compute.ts#L326). | Confirmé |
| `travelDuration(path)` est sur le chemin critique économique | 1 s par case L1 torique, [travel-paths.ts:505](../packages/contracts/src/travel-paths.ts#L505). Consommateurs : commerce [trade-service.ts:116, 200-223](../apps/api/src/modules/villages/trade-service.ts#L116) ; nivellement [leveling.ts:301](../apps/api/src/modules/villages/leveling.ts#L301) ; Jardin/pierre/bois [service.ts:2713, 2756, 2797, 2972](../apps/api/src/modules/villages/service.ts#L2713) ; relevés [science/service.ts:826-869](../apps/api/src/modules/science/service.ts#L826). | Confirmé |
| Le réseau est construit inline dans des transactions verrouillées | [leveling.ts:215, 220, 243](../apps/api/src/modules/villages/leveling.ts#L215) (trois constructions) ; [infrastructure.ts:467](../apps/api/src/modules/villages/infrastructure.ts#L467) sous le verrou exclusif pris en [:669](../apps/api/src/modules/villages/infrastructure.ts#L669) ; [service.ts:496, 1071, 1481](../apps/api/src/modules/villages/service.ts#L496). Le raffinement individuel calcule en worker « sans libérer ses verrous économiques » ([economy.md:85](architecture/economy.md)). | Confirmé |
| ~200 ms de recalcul du réseau par pose | Mesure locale : 200–237 ms, 3 ms en cache, [archive du handoff](HANDOFF-ARCHIVE-2026-10-23.md) ligne 9. Non remesuré ici. | Confirmé (mesure existante) |
| Le client recalcule la durée depuis le chemin | `travelDuration(path, state.world)` dans [village-workers.ts:231](../apps/world-web/src/scene/village-workers.ts#L231), pour la présentation seulement. | Nuancé : usage visuel, sans autorité |

### 1.2 Économie

| Constat de la revue | Vérification | Statut |
|---|---|---|
| Stock borné à zéro en base | `check (amount >= 0)`, [004:48, 136, 263](../apps/api/src/database/migrations/004_world_economy_foundation.ts#L48) ; [015:80](../apps/api/src/database/migrations/015_garden_plots.ts#L80). | Confirmé |
| Aucun registre ; `amount ± n` dispersé | Onze fichiers écrivent les stocks : `economy.ts`, `trade-economy.ts`, `service.ts`, `construction.ts`, `infrastructure.ts`, `market.ts`, `processing.ts`, `garden-harvest.ts`, `gestures.ts`, `woodland.ts`, `stone-extractions.ts` (grep `amount` avec opérateur, hors tests). | Confirmé |
| Une douzaine de mécanismes d'idempotence | Sept tables `*_receipts` (`building_command`, `hud_workforce`, `infrastructure`, `population_command`, `processing_command`, `starter_pose`, `trade`) et `command_id` sur dix autres tables métier (`harvest_intents`, `harvest_submissions`, `market_exchanges`, `leveling_jobs`, `exploitation_orders`, `extraction_worksite_commands`, `expedition_submissions`, `garden_harvests`, `deposit_extractions`, `extraction_pools`). | Confirmé |
| Treize types de tâches planifiées | Registre dans [server.ts:42-54](../apps/api/src/server.ts#L42). | Confirmé |
| Verrou exclusif par monde à la pose, au nivellement, à l'infrastructure | `pg_advisory_xact_lock(... 'infrastructure:' || world_id)`, [construction.ts:68](../apps/api/src/modules/villages/construction.ts#L68) ; exclusif si chantier de nivellement actif, [reconcile-economy.ts:177-178](../apps/api/src/modules/villages/reconcile-economy.ts#L177) ; [infrastructure.ts:669](../apps/api/src/modules/villages/infrastructure.ts#L669). | Confirmé |
| Rattrapage borné seulement pour les commandes d'atelier et la tâche de rattrapage | `COMMAND_CATCHUP_BUDGET = { maxTransitions: 64, maxWorkMs: 200 }`, [reconcile-economy.ts:34](../apps/api/src/modules/villages/reconcile-economy.ts#L34) ; passé par [processing-v2.ts:20](../apps/api/src/modules/villages/processing-v2.ts#L20) et [economy-catchup.ts:94](../apps/api/src/modules/villages/economy-catchup.ts#L94) ; 42 autres appels de `beginVillageEconomy` sans budget, dont la lecture `reconcileVillageForRead`, [service.ts:1696-1718](../apps/api/src/modules/villages/service.ts#L1696). | Confirmé |
| Les lectures écrivent | `getVillageState` appelle `reconcileVillageForRead`, qui ouvre une transaction d'écriture, admet le travail et réconcilie le logement, [service.ts:1707-1715, 1730](../apps/api/src/modules/villages/service.ts#L1707). | Confirmé |
| Les départs automatiques ont lieu à la borne réelle | [economy.md:117](architecture/economy.md) : « Les nouveaux départs ont lieu à la borne réelle et cessent à l'expiration de la fenêtre, même si le worker est en retard. » | Confirmé (règle documentée) |
| Verrou consultatif global des expéditions | `'expedition-submissions'`, [expeditions.ts:99](../apps/api/src/modules/science/expeditions.ts#L99). | Confirmé |
| Tests de concurrence `economy` instables, cause environnementale non démontrée | Le handoff courant attribue désormais les échecs à un achèvement de bâtiment trop long dépassant le `lock_timeout` de 2 s d'un second worker, corrigé par 061 (`5c1fb33`). Non reproduit dans cette étude ; une analyse indépendante est en cours en parallèle de cette rédaction. | Nuancé |

Aucun constat n'a été infirmé. Les mesures citées (200 ms, 53–66 ms de pose, 1 384 tests verts) sont celles des handoffs ; cette étude n'a exécuté aucune suite.

## 2. Décisions et périmètre

**Validé dans la session :** produire cette spécification, avec vérification des constats, sans implémenter.

**Proposé ici :** les quatre cibles des sections 3 à 6, leurs lots et critères.

**Ouvert, à trancher par Tristan :** section 8. Tant qu'un point y figure, l'implémentation du lot concerné choisit l'option qui **conserve la valeur actuelle** perçue par le joueur.

**Hors scope :** liste de la section 0 ; toute modification des règles de gameplay non listée en section 8 ; retrait du protocole V1 (couvert par la spec V2).

## 3. Durées économiques découplées du chemin détaillé

### 3.1 Existant

- La durée d'une mission est `travelDuration(path)` = longueur L1 torique × 1 000 ms, calculée au moment de la commande ou de l'admission sur le chemin que la recherche a trouvé ([travel-paths.ts:505](../packages/contracts/src/travel-paths.ts#L505)). Le chemin est le résultat d'une recherche bornée en temps (section 1.1), donc deux admissions de la même cible peuvent produire deux durées différentes.
- Le chemin et `transportMs` sont figés sur la mission au départ (`path jsonb`, migrations 016/021/025/044/047) ; les missions engagées ne sont jamais recalculées. Cette propriété est bonne et conservée.
- Le réseau de présentation du village (`travelRoutes`) est reconstruit par `buildTravelNetwork` après chaque pose : un A* par cible, raffiné un par un, avec un bonus dépendant de l'ordre ([travel-paths.ts:419-470](../packages/contracts/src/travel-paths.ts#L419)). Ce réseau est à la fois affiché et réutilisé comme guide des trajets de missions (`guide`, [travel-paths.ts:633](../packages/contracts/src/travel-paths.ts#L633)).
- Les contrats V2 transportent déjà séparément `transportMs` et `path` ([sync-v2.ts:129-134](../packages/contracts/src/sync-v2.ts#L129)) : le découplage est compatible sans changement de schéma.
- Le commerce est à part : trajet HDV–HDV certifié et persisté (`navigation_hall_routes`, 046), durée figée à l'acceptation, revalidation des dépendances sous verrou (spec hiérarchique §5).

### 3.2 Cible

**Champ de distance du village.** Pour chaque village, un calcul unique depuis la porte réelle de l'hôtel de ville, sur le réseau de passages déjà utilisé par le raffinement (cases ordinaires, huitièmes de case près des géométries éditées, mêmes certifications `canWalkSpawnSegment`, mêmes règles d'emprise et de bordure), **sans budget** : le domaine est borné (région du village et son halo d'extension), donc le parcours est exhaustif. Il produit :

- `distanceMs(cell)` pour chaque case accessible du domaine, en pas de 125 ms (un huitième de case) ou 1 000 ms (une case), toujours entier ;
- le prédécesseur de chaque nœud, d'où se déduit un chemin canonique vers n'importe quelle cible, utilisé pour la présentation et comme trajet persisté de la mission ;
- la liste des cibles inaccessibles **prouvées** (nœud jamais atteint par un parcours exhaustif).

Propriétés exigées :

- **Déterminisme** : à géométrie identique, résultat identique, octet pour octet, sur le thread principal, dans un worker et après redémarrage. Aucun appel à `performance.now()`, aucun plafond de nœuds, aucun tri instable. Départage des égalités par clé canonique de nœud.
- **Clé = version de géométrie**, pas une sérialisation JSON du village (section 5.2). Le champ est recalculé seulement quand cette version change.
- **Coût borné par la taille du domaine**, pas par le nombre de cibles. Une pose coûte un recalcul, pas un A* par bâtiment.

**Durées courtes (Jardin, bois, pierre, nivellement, relevés locaux)** : `transportMs = distanceMs(accès de la cible)`. Les formules métier (travail sur place, division par l'effectif, énergie pour l'aller-retour, plafond de porteurs) restent dans leurs fichiers actuels ; seule la source de la distance change.

**Durées longues (commerce, expéditions)** : la durée est celle du **témoin certifié** stocké dans `navigation_hall_routes` (ou son équivalent pour les expéditions), identifié par son vecteur de dépendances (versions de chunks). Le devis d'une offre est lié à ce certificat ; l'acceptation réutilise le même certificat si ses dépendances sont inchangées, sinon elle sort sans effet économique et prépare à nouveau (comportement déjà spécifié en §5 de la spec hiérarchique). La durée ne dépend donc plus de la recherche qui a produit le témoin, mais du témoin lui-même, qui est persistant.

**Présentation** : `travelRoutes` devient la projection du champ (chemin canonique de chaque bâtiment, parcelle et gisement ciblé). Le bonus 0,7 dépendant de l'ordre disparaît. La préférence pour la voirie, si on la conserve pour le tracé affiché, s'exprime comme un coût d'arête dans le champ, donc elle reste déterministe ; elle ne change pas la durée (invariant « distance, coût, durée sont trois valeurs distinctes », spec hiérarchique).

### 3.3 Invariants AGENTS.md conservés

- « Les apparences et animations ne déclenchent pas les crédits économiques » : le chemin reste une donnée de présentation ; `transportMs` est la seule valeur économique, écrite par le serveur.
- « Le client ne décide ni des ressources ni des autorisations » : le client peut continuer d'appeler `travelDuration(path)` pour animer ([village-workers.ts:231](../apps/world-web/src/scene/village-workers.ts#L231)), sans effet métier ; un test vérifie que l'animation utilise `transportMs` quand il est disponible.
- « Toute entité mondiale et tout accès métier respectent `world_id` ; coordonnées canoniques sur un tore » : le champ est calculé en coordonnées canoniques, indexé par monde et village.
- Pierre : « préparer et verrouiller tous les gisements dus et la cible éventuelle par UUID canonique après le village » : inchangé ; le champ est lu, pas verrouillé.
- Une mission engagée conserve son chemin et ses échéances (spec hiérarchique) : aucune réécriture de `path` ni de `transportMs` existants.

### 3.4 Compatibilité avec les contrats V2

- Composants `SyncV2GardenHarvestSchema` et missions : `transportMs` et `path` conservés tels quels. Le chemin publié devient le chemin canonique du champ ; sa forme (`Array(point)`) ne change pas.
- Confirmation de pose (lot B livré) : inchangée. La relecture de présentation après pose lit le champ au lieu de reconstruire le réseau ; c'est elle qui gagne les ~200 ms.
- Aucune cellule de chemin n'entre dans un reçu ou une charge de commande ; la durée seule y figure. Cette règle est à respecter par les lots V2 D–G pendant leur migration.

### 3.5 Lots livrables indépendamment

1. **N1 — Champ de distance et mesure de parité.** Implémenter `villageDistanceField` dans `packages/contracts` ; harness qui, sur les fixtures existantes (petite, RC1 de test, village alpha anonymisé si disponible), compare pour chaque cible la durée actuelle (`travelDuration(refineTravelRoute(...))`) et `distanceMs`. Sortie : distribution des écarts, temps de calcul par taille de domaine. Aucun changement de comportement.
2. **N2 — Présentation depuis le champ.** `travelRoutes` dérivé du champ ; `buildTravelNetwork` conservé derrière `NAVIGATION_FIELD=0` pour retour arrière. Mesure de la relecture après pose.
3. **N3 — Durées courtes depuis le champ.** Jardin, bois, pierre, nivellement, relevés. Les anciens chemins de recherche restent disponibles derrière le même drapeau pendant la fenêtre de validation. Dépend de la décision 8.2.
4. **N4 — Durées longues liées au certificat.** Devis d'offre et d'expédition portant l'identifiant du témoin ; acceptation sans recherche sous verrou (rejoint la section 5). Dépend de la décision 8.3.

### 3.6 Critères d'acceptation mesurables

- **Même entrée → même durée** : pour 30 cibles de chaque fixture, 50 exécutions du champ sur le thread principal et 50 dans un worker, sous charge CPU artificielle, produisent le même `distanceMs` et le même chemin canonique (comparaison octet pour octet). Un seul écart invalide le lot.
- **Aucun chronomètre dans le champ** : test statique (grep de `performance.now`, `Date.now`, `maxDurationMs`) sur le module du champ ; le test échoue s'il en trouve.
- **Pose** : relecture de présentation après pose, mesurée sur la base de test comme dans le handoff : p95 ≤ 60 ms serveur (actuel : 283–348 ms, dont 200–237 ms de réseau) ; recalcul du champ ≤ 30 ms pour un domaine de la taille d'un village RC1 étendu. Ces valeurs sont des objectifs à confirmer sur le VPS ; leur dépassement interdit d'annoncer la performance comme acquise.
- **Parité** : sur les fixtures, aucune cible actuellement accessible ne devient inaccessible ; les écarts de durée sont rapportés (médiane, p95, max, signe) et soumis à la décision 8.2 avant N3.
- **Invariance des missions** : après migration, une requête vérifie qu'aucune ligne `deposit_extractions`, `garden_harvests`, `trade_journeys`, `leveling_jobs` n'a changé de `path` ni de `transport_ms`.

## 4. Planificateur unique

### 4.1 Existant

Six recherches (section 1.1), trois conventions de coût (1 / 0,7 / pondération ×2), deux fonctions de distance torique, des budgets en millisecondes et des tas réécrits quatre fois. Les issues ne sont pas uniformes : `null`, `budget-exceeded`, exception, `onLimit`. Un élagage de détour est confondu avec une preuve d'absence de chemin. Le watchdog termine le worker ([compute.ts:344](../apps/api/src/modules/navigation/compute.ts#L344)), ce qui perd caches et contexte.

### 4.2 Cible

Un module `packages/contracts/src/navigation/` :

- `torus.ts` : `wrap`, `delta`, `distance` uniques. Convention à exactement une demi-dimension : **choisir la valeur positive** (`+size/2`), documentée et testée. `spawnDelta` et la `delta` locale de `travel-paths.ts` deviennent des alias dépréciés puis sont retirés.
- `heap.ts` : un tas binaire, départage par clé canonique de nœud.
- `search.ts` : un A*/Dijkstra générique sur un graphe implicite (`neighbours(node)`, `cost(edge)`, `heuristic(node)` admissible ou nulle), avec :
  - **budget en nœuds** (`maxNodes`) uniquement ; aucun temps mur dans l'algorithme ;
  - **annulation coopérative** par `checkpoint()` fourni par l'appelant (déjà présent dans le code), qui lève une exception typée `SearchCancelled` ; c'est l'appelant qui décide d'un délai, jamais la recherche ;
  - trois issues typées : `{ kind: 'found', path, cost, visited }`, `{ kind: 'unreachable', proof: 'exhausted' | 'components', visited }`, `{ kind: 'budget', visited, frontier }`. **Tout élagage** (détour maximal, fenêtre locale) qui empêche l'exhaustivité force l'issue `budget`, jamais `unreachable`.
- `field.ts` : le champ de distance de la section 3 (Dijkstra multi-cibles sans budget).
- `hierarchy.ts` : le HPA* existant reconstruit sur `search.ts`, avec en plus les **composantes connexes par chunk** calculées depuis `navigation_chunk_meshes` (union-find sur les arêtes certifiées). Deux portails de composantes différentes dans le même chunk ne sont pas reliés ; deux HDV dont les chunks ne sont reliés par aucune chaîne de composantes sont **inaccessibles prouvés**, en quelques microsecondes, avec pour preuve le vecteur de versions des chunks parcourus. Cette preuve autorise un cache négatif, invalidé par les mêmes versions.

Les appelants (`buildTravelNetwork` tant qu'il existe, `refineTravelRoute`, `planRoute`, `planHierarchicalRoute`, `buildSpawnAccessNetwork`, `planGardenTour`) sont réécrits comme de fines couches de construction de graphe au-dessus de `search.ts`. Les règles physiques (`canWalkSpawnSegment`, emprises, bordures, équipements) ne changent pas ; elles définissent `neighbours`.

Sémantique côté API :

| Issue | Commerce | Chantiers automatiques | Commandes manuelles |
|---|---|---|---|
| `found` | devis | départ | départ |
| `unreachable` prouvé | 409 `DESTINATION_UNREACHABLE` ; mémorisé jusqu'au changement de versions | cible abandonnée `'unreachable'` (comme aujourd'hui) — voir 8.4 | 409 |
| `budget` | 503 `TRADE_PREPARATION_BUSY` (inchangé) | report avec réveil (comme `NAVIGATION_BUSY` aujourd'hui) ; **jamais** `'unreachable'` | 503 réessayable |

Le worker n'est plus terminé par watchdog pendant une recherche : le watchdog appelle l'annulation coopérative ; la terminaison reste le dernier recours si le worker ne répond pas au `checkpoint` dans un délai de grâce, et elle est comptée dans le NOC.

### 4.3 Invariants AGENTS.md conservés

- « Une recherche inachevée, un cache absent ou un graphe incomplet ne prouvent jamais l'absence de chemin » (spec hiérarchique, repris d'AGENTS.md par renvoi) : c'est la raison d'être des trois issues.
- « Un raccourci représente un chemin physique conservé » : les composantes connexes sont dérivées des arêtes certifiées, jamais d'une interpolation.
- « Pas d'infrastructure ou de refactor général préventif » : la réécriture se fait appelant par appelant, chacun derrière son drapeau de retour arrière, et retire du code à chaque lot (un tas, une `delta`).

### 4.4 Compatibilité avec les contrats V2

Aucun contrat de synchronisation ne transporte une issue de recherche. Les codes d'erreur HTTP (`DESTINATION_UNREACHABLE`, `TRADE_PREPARATION_BUSY`, `NAVIGATION_BUSY`, `NAVIGATION_UNAVAILABLE`) sont conservés ; seule leur attribution devient correcte. Les reçus V2 (`rejected` typé vs `pending`) distinguent déjà refus certain et attente ; `unreachable` prouvé devient un `rejected`, `budget` reste transitoire.

### 4.5 Lots

1. **P1 — Noyau** : `torus.ts`, `heap.ts`, `search.ts` avec tests de propriétés (admissibilité, déterminisme, issues) ; aucun appelant migré.
2. **P2 — Raffinement et réseau** : `refineTravelRoute` et le champ (N1) sur le noyau ; régression du faux « inaccessible ».
3. **P3 — Hiérarchie et composantes** : `planHierarchicalRoute` sur le noyau, composantes par chunk, cache négatif prouvé, annulation coopérative dans `compute.ts`.
4. **P4 — Retrait** : `planRoute` grossier ×2, `buildSpawnAccessNetwork`, `planGardenTour` et les tas dupliqués ; `NAVIGATION_HIERARCHICAL=0` retiré après la fenêtre de validation.

P1 et P2 peuvent précéder ou accompagner N1–N2 ; P3 précède N4.

### 4.6 Critères d'acceptation mesurables

- **Régression « faux inaccessible »** : fixture où la seule route vers une parcelle contourne une emprise et dépasse +128 pas fins (et une variante à +8 cases pour le réseau). Sur `5c1fb33`, la recherche renvoie `null` et le chantier abandonne la cible ; après P2, l'issue est `found` ou `budget`, jamais `unreachable`, et la cible n'est pas abandonnée. Le test doit être constaté rouge avant correction.
- **Inaccessibilité prouvée** : fixture avec deux HDV séparés par de l'eau ; sur `5c1fb33`, 30 s de calcul puis `TRADE_PREPARATION_BUSY` ; après P3, `DESTINATION_UNREACHABLE` en moins de 50 ms, puis réponse depuis le cache négatif ; une passerelle posée (versions de chunks modifiées) invalide ce cache et la route est trouvée.
- **Déterminisme** : pour chaque appelant migré, 50 exécutions à budget de nœuds fixe donnent le même résultat (issue, chemin, coût), sur thread principal et worker, sous charge.
- **Aucun temps mur** : test statique sur `packages/contracts/src/navigation/` interdisant `performance.now`, `Date.now`, `setTimeout`, `maxDurationMs`.
- **Non-régression du corpus** : `hierarchical-benchmark.test.ts` (30 paires RC1) : taux de réussite ≥ 30/30 avec index, médiane ≤ 354 ms et p95 ≤ 1 473 ms avec index (valeurs du 18 octobre), mesurées sur le même poste que la référence, avec ces réserves de variabilité.
- **Terminaison de worker** : sous saturation artificielle, zéro `terminate()` pendant une campagne de 100 recherches annulées par le watchdog ; les caches du worker survivent (vérifié par un hit de cache après annulation).

## 5. Calcul hors verrou, validation de version sous verrou court

### 5.1 Existant

- Trois familles de commandes construisent le réseau ou cherchent un chemin **pendant** qu'elles tiennent le village (`FOR UPDATE`) et le verrou de monde exclusif : nivellement ([leveling.ts:215-243](../apps/api/src/modules/villages/leveling.ts#L215)), infrastructure ([infrastructure.ts:467](../apps/api/src/modules/villages/infrastructure.ts#L467) après [:669](../apps/api/src/modules/villages/infrastructure.ts#L669)), gisements et Jardins ([service.ts:496, 1481](../apps/api/src/modules/villages/service.ts#L496)). Le raffinement individuel calcule en worker sans libérer les verrous ([economy.md:85](architecture/economy.md)).
- Le commerce fait déjà l'inverse : préparation hors transaction, puis revalidation du vecteur de dépendances sous les verrous ([trade-service.ts](../apps/api/src/modules/villages/trade-service.ts), spec hiérarchique §5). C'est le modèle à généraliser.
- Le verrou de monde `infrastructure:<world_id>` est pris en exclusif par toute pose ([construction.ts:68](../apps/api/src/modules/villages/construction.ts#L68)) : deux villages distants d'un même monde ne peuvent pas poser en même temps.
- Les versions existent déjà pour les chunks (`navigation_chunk_versions`, 046) mais pas pour la géométrie d'un village, dont l'identité est aujourd'hui une sérialisation JSON ([travel-paths.ts:300](../packages/contracts/src/travel-paths.ts#L300)).
- L'[audit de concurrence du 23 octobre](AUDIT-CONCURRENCE-ECONOMIE-2026-10-23.md) ne trouve aucune inversion d'ordre de verrous, mais confirme que le travail long sous verrou est la cause des échecs observés : `finaliseExpedition` demande l'exclusif avec `lock_timeout = 500 ms` derrière des partagés qui peuvent durer jusqu'à 30 s ([expeditions.ts:267-282](../apps/api/src/modules/science/expeditions.ts#L267)) ; l'installation tient l'exclusif pendant tout le calcul du plan ([installation.ts:147-195](../apps/api/src/modules/onboarding/installation.ts#L147)) ; les erreurs de verrou HTTP deviennent des 500. Ses correctifs minimaux (section 7 de l'audit) sont applicables avant cette refonte et ne la contredisent pas.

### 5.2 Cible

**Version de géométrie du village.** Colonne `villages.geometry_version bigint` (ou table dédiée si l'on veut éviter le verrou de la ligne village pour une simple lecture), incrémentée **dans la transaction métier** par toute mutation qui change les passages : pose, extension, amélioration avec nouvelle emprise, voirie et équipements, nivellement/terraformation, défrichage, épuisement d'un gisement qui bloquait une case, changement d'accès. L'union des anciennes et nouvelles emprises est couverte, comme pour les versions de chunks (spec hiérarchique §4). Le champ de distance, le cache de raffinement et le réseau de présentation sont indexés par `(world_id, village_id, geometry_version, version des chunks du domaine)` ; la sérialisation JSON disparaît.

**Protocole préparer → certifier → valider**, pour chaque commande qui a besoin d'un chemin :

1. Transaction de lecture `REPEATABLE READ READ ONLY` : charger géométrie, versions (village et chunks), accès, cibles ; aucun verrou.
2. Calcul hors transaction (worker ou thread principal selon la taille), produisant un **certificat** : chemin, durée, vecteur de versions lues.
3. Transaction d'écriture : `beginVillageEconomy` et verrous métier **dans l'ordre existant** ; comparaison du vecteur de versions ; si égal, la commande utilise le certificat sans recalcul ; sinon, sortie sans effet (`409 ROUTE_CHANGED` ou nouvelle préparation automatique **une fois**, hors transaction), jamais de recherche sous verrou.

Le champ de distance s'intègre naturellement : la préparation lit le champ courant (calculé hors verrou à la dernière mutation ou à la demande), le certificat est `(geometry_version, chunk versions)`.

**Portée du verrou spatial.** Remplacer le verrou de monde exclusif des poses, extensions, voirie et nivellement par des verrous consultatifs par chunk, `hashtextextended('chunk:' || world_id || ':' || cx || ':' || cy)`, pris en **ordre canonique** (cx, cy) sur l'ensemble des chunks de l'emprise et de son halo physique, après le village et avant les gisements, conformément à l'ordre « village → navigation → métier » de la spec hiérarchique. Le verrou de monde reste pour les mutations dont l'emprise n'est pas déterminable (génération, scripts administratifs), déjà prévues comme exception instrumentée. Un chantier de nivellement actif, qui impose aujourd'hui l'exclusif mondial à toute l'économie du village ([reconcile-economy.ts:177](../apps/api/src/modules/villages/reconcile-economy.ts#L177)), impose l'exclusif sur ses chunks seulement.

Le commerce conserve son verrou partagé de navigation pour la revalidation, qui devient un verrou partagé sur les chunks de la route ; une route de 400 chunks prend 400 verrous partagés triés, ce qui est acceptable pour une transaction courte, à mesurer.

### 5.3 Invariants AGENTS.md conservés

- « `beginVillageEconomy()` prend le village avant les verrous métier ; borne `statement_timestamp()` lue après acquisition » : inchangé ; le certificat est comparé **après** la borne, dans la même transaction que la commande.
- « Ne jamais prendre un autre village après un gisement » et « tous les gisements dus et la cible par UUID canonique après le village » : les verrous de chunk s'insèrent entre village et gisements, à la place exacte du verrou de monde actuel.
- « Pas de `SERIALIZABLE` global » : la lecture de préparation est `REPEATABLE READ READ ONLY`, la validation est une comparaison d'entiers.
- « Réconciliation et commandes ne verrouillent/modifient/acquittent aucune notification existante » : inchangé.
- Spec V2 §6.3 : « Après l'acquisition d'un compteur de publication, aucune acquisition de verrou métier » : les verrous de chunk sont des verrous métier, pris avant la phase terminale de publication.

### 5.4 Compatibilité avec les contrats V2

- Le vecteur de versions du certificat est interne au serveur ; il n'apparaît pas dans les confirmations. Un `409 ROUTE_CHANGED` est un refus typé `rejected` avec motif transitoire ; le client rejoue avec le **même** UUID après nouvelle préparation (règle V2 §7.3 : un UUID avec un contenu différent est refusé, donc la préparation ne modifie pas l'intention, seulement le certificat côté serveur).
- Le flux spatial V2 (clé monde/chunk) et les verrous de chunk partagent la même partition canonique ; une mutation publie dans les flux des chunks qu'elle a verrouillés.
- `geometry_version` peut être exposée comme version du composant « présentation » du village (la spec V2 §8.1 prévoit un « réseau de présentation indépendant » versionné), ce qui évite une relecture quand elle n'a pas changé.

### 5.5 Lots

1. **L1 — `geometry_version`** : migration additive, incrément dans chaque mutation spatiale (audit de tous les producteurs, comme pour 046), remplacement de la clé JSON par la version. Aucun changement de verrou.
2. **L2 — Préparation hors verrou** pour Jardins, bois, pierre et nivellement, sur le modèle du commerce ; recherche sous verrou interdite par un garde en mode test (section 5.6).
3. **L3 — Infrastructure et pose** : même protocole ; `buildTravelNetwork` de [infrastructure.ts:467](../apps/api/src/modules/villages/infrastructure.ts#L467) remplacé par la lecture du champ préparé.
4. **L4 — Verrous par chunk** : remplacement du verrou de monde pour les familles L2–L3, verrou de monde conservé pour les exceptions ; tests d'entrelacement à barrières.

L1 est indépendant et peut précéder N1. L2–L3 touchent les familles des lots V2 D et E : les planifier **dans** ces lots, pas après (section 7). L4 dépend de L2–L3.

### 5.6 Critères d'acceptation mesurables

- **Garde statique et dynamique** : en mode test, `beginVillageEconomy` arme un drapeau par transaction ; tout appel à `buildTravelNetwork`, `refineTravelRoute`, `planRoute`, `planHierarchicalRoute`, `compute.*` pendant que le drapeau est armé fait échouer le test. La suite complète passe avec ce garde (donc zéro recherche sous verrou).
- **Durée de verrou** : pour une pose, un ordre d'exploitation et un nivellement sur la fixture RC1, temps entre `FOR UPDATE` du village et `COMMIT` mesuré par le harness de coût : p95 ≤ 50 ms à chaud (hors rattrapage), contre les valeurs actuelles à établir par le même harness avant L2.
- **Concurrence** : deux villages d'un même monde, dans des chunks disjoints, posent simultanément avec une barrière ; aucune attente de verrou observée dans `pg_stat_activity` (`wait_event_type = 'Lock'`) ; les deux poses sont validées. Deux villages sur des chunks adjacents partagés attendent l'un l'autre et les deux commits sont corrects.
- **Certificat périmé** : barrière entre préparation et validation, mutation d'un chunk de la route par un tiers ; la commande sort sans effet économique (stocks, réservations, cohortes, tâches comparés avant/après), puis réussit après nouvelle préparation.
- **Rollback injecté** après incrément de `geometry_version` et mutation : les deux reviennent ensemble.

## 6. Registre `resource_movements` et abstraction `processes`

### 6.1 Existant

- Stocks mutables dans `village_resources.amount` (et `stored_amount` des parcelles/buffers), écrits par onze fichiers, protégés par des `CHECK >= 0` et par les verrous du village. Aucune table ne dit **pourquoi** un stock a changé ; une réparation manuelle (`ops/repairs/2026-10-17-number-university.mjs`) n'est pas distinguable d'un mouvement de jeu.
- Mécaniques à échéance, chacune avec ses tables, son handler et son type de tâche : construction, extension, Jardin (tournées, parcelles), extractions pierre/bois, chantiers et pools, ordres d'exploitation, lots d'atelier, Oracle, offres/convois/livraisons, nivellement/terraformation, science et expéditions, croissance, énergie/repos/logement, intentions de récolte. Treize handlers de tâches ([server.ts:42-54](../apps/api/src/server.ts#L42)) ; dix catégories de transitions réunies par `UNION ALL` dans `reconcile-economy.ts`.
- Dix-sept mécanismes d'idempotence (section 1.2), de schéma équivalent : UUID, empreinte de l'intention, résultat, 409 si l'intention diffère.
- Départs automatiques « à la borne réelle » ([economy.md:117](architecture/economy.md)) : une indisponibilité du scheduler perd des départs ; les lots d'atelier, eux, rattrapent ([economy.md:57](architecture/economy.md)).

### 6.2 Cible

**Registre.** Table additive `resource_movements` :

| Colonne | Rôle |
|---|---|
| `id bigint` | séquence |
| `world_id`, `village_id` | isolation |
| `resource_code` | `wood`, `stone`, `timber`, `cut-stone`, `carrot`, `rings`, codes de parcelles/buffers |
| `holder` | `village`, `plot:<id>`, `buffer:<id>` : le stock touché |
| `delta bigint` | signé, jamais nul |
| `reason` | code fermé : `production`, `construction`, `upgrade`, `processing-input`, `processing-output`, `harvest`, `extraction`, `trade-debit`, `trade-credit`, `oracle`, `feed`, `infrastructure`, `reserve`, `release`, `accomplishment`, `migration`, `repair` |
| `process_id`, `command_id` | référence du processus ou de la commande à l'origine |
| `logical_time` | échéance métier (H ou date de la transition) |
| `batch_id` | identifiant de transaction, partagé avec le journal V2 |

Un seul point d'écriture : `moveResources(tx, movements[])`, qui insère les lignes et met à jour les stocks dans un seul SQL à CTE (comme `materializeVillageResource` aujourd'hui). Les `CHECK >= 0` restent ; un échec de contrainte devient un refus typé `INSUFFICIENT_STOCK` plutôt qu'une erreur 500. Un test statique interdit toute autre écriture d'`amount`/`stored_amount` hors ce helper et des migrations.

**Invariant vérifiable** : pour tout stock, `amount = initial + sum(delta)`. Vérifié par une requête dans les tests d'intégration après chaque scénario, et par une tâche d'audit bornée en production (un village par passe, résultat dans le NOC, aucune correction automatique).

**Processus.** Table additive `processes` :

| Colonne | Rôle |
|---|---|
| `id`, `world_id`, `village_id` | identité |
| `kind` | `construction`, `expansion`, `garden-tour`, `extraction`, `processing-lot`, `leveling`, `trade-journey`, `market-delivery`, `survey`, `expedition`, `population-arrival`, … |
| `state` | `scheduled`, `active`, `completed`, `cancelled`, `failed` |
| `started_at`, `due_at` | bornes logiques ; `due_at` indexé par `(world_id, village_id, due_at, id, kind)` |
| `team` | référence des cohortes affectées (via `population/work.ts`) |
| `reserved` | mouvements de réservation déjà inscrits au registre |
| `payload jsonb` | données propres au type (recette, cible, chemin de présentation, devis) |
| `command_id` | reçu d'origine |

Un **gestionnaire de fin unique** remplace le `UNION ALL` de `reconcile-economy.ts` : sous le village et ses verrous, `select … from processes where due_at <= H order by due_at, id, kind` ; pour chaque ligne, le hook du type (`complete[kind]`) applique les crédits via `moveResources`, libère l'équipe via `work.ts`, insère les successeurs dans la même table. L'ordre (échéance, id, type) et l'entrelacement sont **conservés** ; c'est la structure qui change, pas la règle. Les hooks sont les handlers actuels, déplacés.

Un seul type de tâche planifiée `process.due` (clé : `process_id`, échéance `due_at`) remplace progressivement les treize ; `SKIP LOCKED`, acquisition tâche → village → métier et recul progressif restent.

**Départs automatiques.** Les pools et chantiers automatiques sont des processus `scheduled` dont `due_at` est la prochaine date de départ logique ; une exécution en retard les traite à leur date logique, comme les lots d'atelier. Voir la décision 8.5 : cette cible change une règle documentée.

**Reçus.** Table `command_receipts` commune (`world_id`, `village_id`, `command_id`, `family`, `intent_hash`, `status`, `result jsonb`, `created_at`), façade de lecture prévue par la spec V2 §7.3 ; les dix-sept mécanismes existants sont adoptés par famille, les anciennes tables restant lisibles jusqu'au retrait.

### 6.3 Invariants AGENTS.md conservés

- « Réconcilier les transitions dues par échéance, ID et type ; conserver les restes/cursors aux changements de production » : l'ordre est celui de l'index de `processes` ; les flux continus (`village_resource_flows`, parcelles) gardent reste et curseur, hors de `processes`.
- « Worker : tâche acquise avec `SKIP LOCKED` → village → métier » et « le scheduler ne finalise que sa propre tâche » : `process.due` suit le même chemin ; une réconciliation sous commande traite les processus dus sans toucher aux tâches.
- « Respecter l'exception d'unicité `building.complete` introduite par 009 » : conservée pendant la coexistence ; retirée seulement avec la dernière tâche `building.complete`.
- « Pas de système de qualifications/combat/transport parce qu'une extension future l'utilisera peut-être » : `processes` n'ajoute aucun type nouveau ; elle regroupe les types existants.
- « `population/work.ts` porte l'affectation commune » : inchangé, appelé par les hooks.

### 6.4 Compatibilité avec les contrats V2

- Les composants V2 (ordres, lots, missions, convois, échanges) sont des **projections** de `processes` par type ; leurs schémas ne changent pas. Les lecteurs ciblés de la spec V2 §3.3 lisent `processes` au lieu de dix tables.
- `resource_movements` n'est pas un composant synchronisé : c'est une lecture privée paginée, comme l'historique des reçus (spec V2 §8.1), sous le flux `village` si l'on expose un journal au joueur (décision 8.7).
- `batch_id` partagé avec `game_sync_changes` : un lot V2 et ses mouvements se relient sans jointure supplémentaire.
- La phase terminale de publication V2 §6.3 reste la dernière ; `moveResources` et l'insertion dans `processes` sont des écritures métier, avant elle.

### 6.5 Lots

1. **E1 — Registre en double écriture.** Table, `moveResources`, migration de chaque écrivain (onze fichiers) vers le helper, invariant vérifié en tests ; aucun changement de règle. Indépendant des autres lots et des lots V2 ; à faire **avant** les lots V2 E–F pour qu'ils n'aient pas à toucher deux fois les mêmes écrivains.
2. **E2 — `processes` par famille**, dans l'ordre des lots V2 : lots d'atelier (B, déjà V2), construction/extension (B/D), Jardin/extraction/chantiers (E), commerce/Oracle (F), science (G), croissance/logement (C). Chaque famille migre ses lignes dans une migration additive avec vue de compatibilité, remplace son handler par un hook et son type de tâche par `process.due`.
3. **E3 — Reçus communs.** Adoption de `command_receipts` famille par famille, dans les mêmes lots.
4. **E4 — Départs à l'heure logique et rattrapage borné partout.** Dépend de 8.5 ; budget `COMMAND_CATCHUP_BUDGET` appliqué à tous les `beginVillageEconomy`, avec continuation `economy.catchup` (déjà existante), ce qui réalise la cible « lectures pures » du lot V2 H.

### 6.6 Critères d'acceptation mesurables

- **Conservation** : après chaque scénario d'intégration et sur une copie anonymisée des bases alpha et staging, `select holder, resource_code, amount - initial - coalesce(sum(delta),0)` renvoie zéro partout. Le test échoue au premier écart.
- **Point d'écriture unique** : test statique (grep sur `updateTable('villageResources')`, `update village_resources`, `garden_plots.stored_amount`, hors `moveResources` et `migrations/`) ; vide.
- **Parité de réconciliation** : harness « oracle historique » du lot V2 A : sur les fixtures à échéances entrelacées (constructions, arrivées, récoltes, lots, retours à dates égales), l'ordre des transitions, les soldes, les fractions, les réservations et les tâches créées sont identiques entre `reconcile-economy.ts` de `5c1fb33` et le gestionnaire de `processes`.
- **Rattrapage** : un village absent 30 jours avec 2 000 échéances dues : la première lecture ne tient le village que ≤ 200 ms (budget) et renvoie `SCOPE_CATCHING_UP` ; le worker converge en N passes bornées ; l'état final est identique au rejeu non borné.
- **Rejeu** : tout UUID rejoué avec la même intention renvoie le résultat d'origine sans mouvement supplémentaire (zéro ligne `resource_movements` ajoutée) ; tout UUID avec une intention différente renvoie 409.
- **Réparation auditable** : `ops/repairs/*` ne peut écrire un stock qu'avec `reason = 'repair'` et un commentaire ; le script historique est rejoué en test pour vérifier que la contrainte l'aurait accepté.

## 7. Ordre des lots et articulation avec la spec V2

| Ordre | Lot | Dépend de | Articulation V2 |
|---|---|---|---|
| 1 | P1 noyau de recherche | — | aucune |
| 2 | L1 `geometry_version` | — | aucune ; simplifie la version du composant « présentation » |
| 3 | N1 champ et parité ; E1 registre | P1 ; — | E1 avant les lots V2 E–F |
| 4 | P2 raffinement/réseau sur le noyau ; N2 présentation depuis le champ | P1, N1 | relecture après pose (B livré) |
| 5 | N3 durées courtes ; L2 préparation hors verrou (Jardin, bois, pierre, nivellement) | N1, P2, décision 8.2 | **dans** les lots V2 D et E |
| 6 | L3 infrastructure/pose hors verrou ; E2/E3 par famille | L2 | **dans** les lots V2 D, E, F, G, C |
| 7 | P3 hiérarchie, composantes, cache négatif ; N4 durées longues par certificat | P2, décision 8.3 | **dans** le lot V2 F |
| 8 | L4 verrous par chunk | L2, L3 | avant le lot V2 H |
| 9 | E4 départs logiques et rattrapage borné partout | E2, décision 8.5 | réalise le lot V2 H (lectures pures) |
| 10 | P4 retrait des anciens planificateurs et drapeaux | tout | avec le lot V2 I |

Règles pendant la migration V2 en cours, reprises de la revue et confirmées ici :

- aucune cellule de chemin dans une charge de commande ou un reçu ; la durée seule ;
- périmètres de synchronisation calqués sur le domaine (village, ressources, processus, bâtiments), pas sur les tables actuelles, pour que `processes` ne force pas une seconde migration du journal ;
- forme de reçu commune dès les prochains lots V2, compatible avec `command_receipts`.

Chaque lot comprend serveur, contrats, client raccordé, tests, mesure, mise à jour de `docs/architecture` **après preuve**, et un drapeau de retour arrière tant que le lot suivant n'est pas validé. Aucun lot ne réinitialise une base ni ne réécrit une mission engagée.

## 8. À trancher par Tristan

Chaque point ci-dessous modifie une valeur ou une règle perçue par le joueur, ou conditionne le volume de migration. Jusqu'à décision, l'implémentation conserve le comportement actuel.

1. **Réinitialisation des mondes alpha et staging.** Si acceptée, E2 n'a pas besoin de migrer les lignes existantes des dix tables vers `processes`, ni de vues de compatibilité ; le registre démarre à l'état courant comme `initial`. Sinon, chaque famille porte une migration de données testée sur copie, et l'invariant de conservation prend l'état migré comme origine. Recommandation technique : réinitialiser, après annonce aux joueurs alpha ; la décision est produit.
2. **Durée = plus court chemin certifié.** Aujourd'hui la recherche préfère la voirie (coût 0,7) et accepte un détour borné ; le chemin retenu peut être plus long que le plus court. Avec le champ, `transportMs` devient la distance minimale certifiée : certaines durées **diminuent**, aucune n'augmente (section 3.6, parité). Valider que la durée soit « le plus court chemin praticable », ou demander que le champ reproduise la préférence voirie dans la durée (ce qui réintroduirait une dépendance au tracé). Les missions engagées ne changent pas dans les deux cas.
3. **Devis commercial figé au certificat.** Une offre publiée porte la durée de son témoin ; si une route plus courte apparaît avant l'acceptation, conserve-t-on la durée publiée (stabilité) ou la recalcule-t-on (avantage à l'acceptant) ? Aujourd'hui l'acceptation recalcule dans un budget. Recommandation : figer à la publication, recalcul seulement si une dépendance a changé.
4. **Cible prouvée inaccessible.** Pour un chantier automatique, aujourd'hui la cible est abandonnée `'unreachable'`. Avec la preuve, on peut aussi la conserver en attente et la réessayer quand les versions de chunks changent (une passerelle posée la débloque sans action du joueur). Choisir : abandon immédiat (actuel) ou attente avec réveil par version ; et ce que voit le joueur dans les deux cas.
5. **Départs automatiques à l'heure logique.** Règle actuelle : « à la borne réelle », donc les départs manqués pendant une indisponibilité du scheduler sont perdus, alors que les lots d'atelier rattrapent. Cible E4 : rattraper à la date logique, dans la limite de la fenêtre de l'ordre et de l'énergie. Cela augmente la production des joueurs absents pendant une panne ; c'est une règle d'équité à valider.
6. **Rattrapage borné pour toutes les commandes.** Généraliser `SCOPE_CATCHING_UP` (déjà accepté pour l'atelier) à toutes les commandes et lectures : un joueur de retour après une longue absence peut voir « actualisation en cours » quelques secondes avant de pouvoir agir. Valider cette expérience.
7. **Journal des mouvements visible par le joueur.** Le registre permet un historique (« +50 carottes, récolte Jardin, 14:02 »). Hors scope technique de cette spec ; à décider séparément si souhaité, car il devient un composant V2.
8. **Durée de mémorisation d'une inaccessibilité prouvée.** Technique en apparence, mais visible : jusqu'au changement de version des chunks concernés (recommandé, exact), ou au plus N minutes. Sans décision : jusqu'au changement de version.

Aucun autre changement de gameplay n'est nécessaire pour réaliser les sections 3 à 6.

## 9. Vérification de cette spécification

Cette rédaction s'appuie sur la lecture de `main` à `5c1fb33` : `packages/contracts/src/{travel-paths,route-planner,hierarchical-route,spawn-access,spawn-map,garden-tour,sync-v2}.ts`, `apps/api/src/modules/{navigation,villages,deposits,population,science}` (fichiers cités), `apps/api/src/server.ts`, `apps/api/src/jobs/scheduled-tasks.ts`, les migrations 004, 015, 046 et la liste des tables, ainsi que les documents de référence listés en tête. Elle ne constitue ni une recette ni un benchmark ; aucun test n'a été exécuté. Deux analyses indépendantes ont été menées en parallèle et consignées séparément : [concurrence économique](AUDIT-CONCURRENCE-ECONOMIE-2026-10-23.md) (aucune inversion de verrous ; travail long sous verrou ; explication 061 à corriger) et [justesse de la synchronisation V2](AUDIT-SYNC-V2-2026-10-23.md) (boucle client réelle au changement d'epoch, orphelins de purge, falaise des plafonds). La première alimente la section 5 ; la seconde est indépendante de cette refonte mais ses correctifs A et C sont à livrer **avant** le lot V2 H, puisque la réinitialisation éventuelle des mondes (décision 8.1) changerait les epochs.

Contrôles documentaires attendus avant clôture : liens et numéros de ligne valides sur la base citée, cohérence des lots avec le plan de migration V2 §10, absence de décision produit implicite hors section 8.

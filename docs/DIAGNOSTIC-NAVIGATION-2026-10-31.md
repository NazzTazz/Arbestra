# Diagnostic d'architecture : trajets et navigation — 31 octobre 2026

Étude en lecture seule (aucun code modifié, aucun calcul relancé ; les mesures citées viennent des commits et des docs). Cadre : [invariants du 31 octobre](DECISIONS-NAVIGATION-2026-10-31.md). Les passages **[Inférence]** sont des interprétations ; le reste se vérifie aux lignes citées (état du code au commit `ebdc2fd`).

## 1. Représentation canonique du terrain navigable

**Source de vérité physique.**
- Champ RC1 continu : `createSpawnTerrainField` puis `editedRc1Field(data, field, terraces, removedTrees, vertices)`, avec `physicalSample(x,y)` (élévation, surface d'eau) et `intersectsRock` (`apps/api/src/modules/worlds/rc1-ground.ts:32-242`).
- Retouches lues en base, mondiales : tout `world_terrain_vertices`, tout `world_spawn_terraces`, arbres absents ou souches retirées (`world_rc1_resources`, `woodland_trees`) (`rc1-ground.ts:65-120`).
- Troncs : disques sous-case (`woodlandPassage`), composés dans `rc1NetworkGround` (`apps/api/src/modules/navigation/rc1-network-ground.ts:39-84`).
- Une seule primitive de praticabilité, `canWalkSpawnSegment` (`packages/contracts/src/spawn-access.ts:22-41`) : segment cardinal uniquement ; trois couloirs à ±1/16 de case, échantillonnés tous les 1/8 ; chaque échantillon sec, non bloqué (roche, tronc), pente |dz| ≤ 0,25 × distance ; profil piéton codé en dur.

**Au moins huit représentations par-dessus.**
1. `region.terrainCodes` : 1 si le **centre** de la case est sec (`rc1-ground.ts:161-171`, `service.ts:291-300`), exigé pour toute case traversée (`travel-paths.ts` `inside()`, `land()`). Bornée à la région du village (`terrain-region.ts:22`) : un bâtiment hors région n'a pas de route (`travel-paths.ts:493`).
2. Emprises : la case entière bloque (`blocksTravelFootprint`, `travel-paths.ts:66`), sauf jardin actif à coût ×30 (`:83`) ; les portes (`buildingAccesses`) exemptent l'intérieur.
3. Gisements : la pierre bloque la case tant qu'elle n'est pas épuisée ; le bois bloque la case, sauf sur sol RC1 où seuls les troncs bloquent (`travel-paths.ts:455-463`, `:611-619`).
4. Infrastructure : surface au 1/16, bordures (obstacles), équipements et ancrages à ±1/8 (`travel-paths.ts:323-331`, `:624-634`) ; les routes ne changent que le **coût** (`ROAD_STEP_COST = 0.7`, `:96`).
5. Treillis : grille grossière par case (`buildTravelNetwork`) ; treillis fin au 1/8 (`refineTravelRoute`) ; `planRoute` à 8 ou 1 huitième (`route-planner.ts:113-140`) ; maillage par chunk (`chunk-navigation-mesh.ts:6-12`) ; portails entre chunks (`hierarchical-route.ts:13`).
6. Deux compositions du même sol dans le worker : réseau de village (`rc1NetworkGround` + `blocked`/`land()` de `travel-paths.ts`) et routes du hall (`build()`, `compute-worker.ts:60-176`), avec des détails différents (coût route 0,7 au milieu du segment d'un côté, arêtes grossières de l'autre) et une variante « legacy » sur `terrainCodes` seuls (`compute-worker.ts:63-73`).
7. Réseau d'onboarding (`buildSpawnAccessNetwork`, `spawn-access.ts:58`) : même primitive, autre algorithme.
8. Client : connecteurs A* des chantiers (`worksite-layout`), connecteurs de porte (`building-plan.ts:661`), évitement (`WorkerTraffic`) ; aucun ne vérifie pente ni eau.

Toutes les couches serveur reposent sur la même primitive, mais les filtres par case sont plus stricts qu'elle et doublés de dérogations (bosquet dont le centre est dans un tronc, `travel-paths.ts:842-866`, `ec42df8` ; emprise du hall ; portes). **[Inférence]** Plusieurs correctifs viennent de l'écart entre une grille par case et un monde continu.

## 2. Systèmes qui calculent des chemins

| Appelant | Fin | Algorithme | Exécution |
|---|---|---|---|
| Réseau du village `buildTravelNetwork` (`travel-paths.ts:348-584`) | Routes hall → chaque bâtiment, parcelle, pierre, bois visé | A* cardinal par case, détour ≤ +8 (`:495`), routes déjà calculées à 0,7 (`:476`, `:558`), ordre fixe (`:475`), puis raffinement 1/8 guidé par l'union (`:563-571`) | worker (`compute-worker.ts:241`) ou en ligne |
| Présentation | `travelRoutes` envoyées au client | idem | `presentation.ts:239-249` (worker, cache en base) |
| `state()` | réseau du snapshot | idem | `commandTravelNetwork` sous verrou du village (`service.ts:1554`) |
| `readInfrastructureSpatialState` (`service.ts:978-1110`) | routes automatiques à l'édition de route ; tournée de jardin (`service.ts:2662`, `:2730`) | réseau **complet** pour quelques parcelles | worker, sous verrou |
| Exploitations `stoneTravelPath` → `refineVillagePath` (`service.ts:374-645`) | chemin et `transportMs` (`deposits/worksites.ts:591`) | ≤ 32 cases direct ; ≤ 128 mini-réseau ; > 128 jambe en L (`:417-433`) | worker ; relances (`worksite-admission.ts:32`) |
| `refineTravelRoute` | chemin fin depuis la porte | témoin grossier (`:920-966`), `planRoute` (≤ 8 192 nœuds, 1 s), fin 1/8 (≤ 65 536 visites, détour ≤ +128 huitièmes, `:1087`, `:1101`) | — |
| Nivellement (jobs) `leveling.ts:245-330` | `LEVELING_ACCESS` (3 réseaux) et `LEVELING_UNREACHABLE` | réseau + raffinement | **fil principal** |
| Retouches instantanées `terrain-edits.ts:263-355` | `LEVELING_ACCESS` | **2 réseaux complets** | **fil principal** |
| Ancien équipement `infrastructure.ts:531-550` | `ACCESS_BLOCKED` | réseau complet | fil principal |
| Commerce (`trade-service.ts:113-225`) | trajet hall ↔ hall, `travelMs` | `planRoute`, hiérarchie par chunks, réparation, cache certifié par chunk | worker |
| Expéditions (`science/expeditions.ts:476-505`, `science/service.ts:850`) | trajet, durées | `planRoute` (262 144 nœuds, 5 s) ou `refineVillagePath` | worker |
| Onboarding (`installation-plan.ts:190`, `spawn-resource-calculation.ts:141`) | accès au départ | `buildSpawnAccessNetwork` | — |
| NOC (`compute.ts` `observationNetwork`) | diagnostic | réseau, préemptible | worker |
| Client | connecteurs, tournées de loisir sur les routes `building` (`village-workers.ts:522-528`), routes automatiques et braseros dérivés de `travelRoutes` | local | navigateur |

La construction ne cherche aucun chemin : elle refuse seulement une emprise posée sur un chemin **engagé** (`construction.ts:159-176`, `:405`, `ENGAGED_PASSAGE`).

## 3. Trajet logique serveur et déplacement visuel Babylon

- Le client reçoit tout le réseau (`travelRoutes`, ~200 Ko sur Bressuire, `travel-derivation.ts:13`) et, pour chaque mission, son chemin persisté et ses horaires (`village-workers.ts:355-430`).
- Position = `pathLength(visualPath) × elapsed / transportMs` (`village-workers.ts:843-853`) : la vitesse visuelle est dérivée. Le chemin visuel est retouché : allers-retours retirés (`worker-motion.ts:55-100`), connecteurs de porte (`BabylonVillageScene.ts:3525-3625`), A* vers les postes avec ligne droite « fantôme » après 4 échecs (`village-workers.ts:1437-1467`), couloirs, `WorkerTraffic`, tournées de loisir.
- Durée serveur = longueur de Manhattan × 1 000 ms par case (`travelDuration`, `travel-paths.ts:586-601`) : **les routes ne raccourcissent pas la durée**, elles biaisent seulement le choix.
- Un chemin persisté n'est jamais réévalué ; une retouche de terrain ne lit aucun chemin engagé (`terrain-edits.ts`), alors que bâtiments et infrastructure refusent un chemin engagé (`ENGAGED_PASSAGE`). **[Inférence]** Aucune règle ne dit qui décide quand un passage engagé devient impraticable.

## 4. Données persistées, dérivées ou en cache

- Tables : `village_travel_networks` (une ligne par village, gzip, clé = empreinte ; migration 063, `network-store.ts:23-66`) ; `navigation_chunk_versions` (triggers sur occupations, terrasses, gisements, infrastructure, sommets, souches ; 046, 048, 069) ; `navigation_chunk_crossings`, `_meshes`, `navigation_hall_routes`, `navigation_route_dependencies` (`route-cache.ts`, limites par variable d'environnement) ; chemins des missions (`deposit_extractions.path_cells`, `garden_harvests`, `science_activities.path_cells`, `trade_journeys.path`, `leveling_jobs.path`) ; `inheritedRoads`/`inheritedCells` : routes automatiques **figées** à l'édition (`infrastructure.ts:350-373`).
- Mémoire : `networkCache` 8 entrées ≤ 400 000 cellules (`travel-paths.ts:150-153`), alias, `passageCaches`, `refinementCaches` ; géométries RC1 (clé ≤ 131 072 caractères, **sinon pas de cache**, `rc1-ground.ts:27-29`, `:231`) ; `VillagePresentationReader` (64 villages, 60 s, `presentation.ts:157-235`) ; worker `sources`, `networkGrounds` (clé ≤ 131 072), `contexts`, `routes`.
- Clés : `networkFingerprint` contient `navigationEdits` **du monde entier** (`presentation.ts:126-147`) ; `TravelGround.revision` = SHA de tous les sommets, terrasses et arbres du monde (`rc1-network-ground.ts:52-54`) ; `rc1GroundVersion` = md5 de 6 tables mondiales ; `navigationRevision` = compteur mondial (`context.ts:44`). **Trois invalidations coexistent** : empreinte mondiale (village), versions par chunk (routes du hall), compteur mondial (commerce, expéditions).

## 5. Événements qui déclenchent des recalculs

- **Toute retouche de sommet ou de terrasse, n'importe où**, change toutes les empreintes : le réseau de chaque village est recalculé à sa prochaine lecture (1,8 à 4 s, `DETTE-TECHNIQUE.md`).
- Abattage : rien (stock exclu, `presentation.ts:122-134`) ; souche retirée ou défrichement : oui (`0178823`).
- Bâtiments, jardins, pierre épuisée, routes, bordures, équipements, ancrages : recalcul complet. Routes partagées et guide couplent toutes les routes ; un nouveau bâtiment peut déplacer les autres selon l'ordre des identifiants (`travel-paths.ts:475-476`, `:558`, `:563`). **[Inférence]** Ce couplage rend l'invalidation locale impossible par construction.
- Redémarrage : `village_travel_networks` évite le recalcul à empreinte identique (`a683861`).
- Au-delà d'environ 3 000 sommets retouchés, les caches de géométrie se coupent **silencieusement**.
- Recalculs systématiques : retouche (2 réseaux), nivellement (3), tournée de jardin et édition de route (réseau complet), exploitation (raffinement par cible).

## 6. Garanties métier et contrôle d'accès global

- Contrôles qui imposent la préservation de l'accès : `LEVELING_ACCESS` (`terrain-edits.ts:330-354`, `leveling.ts:245-275`) ; `ACCESS_BLOCKED` (`infrastructure.ts:548`, déjà abandonné pour les ancrages en S4a). La construction n'en fait aucun.
- Ce dont la simulation dépend vraiment : la durée d'une mission, figée à l'admission (exploitations `worksites.ts:591`, jardins `planGardenTour`, science `science/service.ts:875-939`, commerce `trade-service.ts:118`, `:225`, nivellement `leveling.ts:331`). L'inaccessibilité se constate **déjà à la demande** : `DESTINATION_UNREACHABLE` (`service.ts:643`), exclusions `unreachable` (`service.ts:2738`, `:3195`), `TRADE_ROUTE`, `LEVELING_UNREACHABLE`.
- Aucune règle économique ne lit les routes `building` du réseau : contrôles d'accès, affichage (routes automatiques, braseros, loisir), gel en `inheritedRoads`.
- Les contrôles d'accès sont de plus **imprécis** : « inaccessible » signifie « non trouvé dans les bornes » (+8 cases grossier, +16 fin, 65 536 visites, région) ; une route abandonnée disparaît silencieusement (`travel-paths.ts:567-571`) ; `route-planner.ts:112` : « an incomplete lattice never proves no physical path ». **[Inférence]** Des douves imposant un long détour seraient refusées même si un passage existe.
- **[Inférence] Sans ces contrôles** : aucune mission admise ne change (chemins et durées persistés) ; les nouvelles demandes échouent proprement avec les erreurs existantes ; moins de routes affichées. Le seul vrai manque — la réévaluation d'un trajet engagé devenu impraticable — n'est pas couvert non plus aujourd'hui.

## 7. Analyse

**Responsabilités cumulées par le réseau du village.** Le même calcul sert à la fois : (a) aux durées des tournées de jardin ; (b) à prouver l'accès ; (c) aux lignes de désir et routes automatiques, figées en `inheritedRoads` qui rétroagissent sur le coût (boucle de rétroaction) ; (d) au guide des autres routes ; (e) aux tournées de loisir. **[Inférence]** Racine du coût global : un calcul « tous les buts, couplés » là où un trajet à la demande suffirait.

**Concurrence et blocages.** `beginVillageEconomy` prend un verrou consultatif **mondial** `infrastructure:<world>`, exclusif pour les écrivains spatiaux (`reconcile-economy.ts:171-179`). Une retouche calcule ses deux réseaux **sur le fil principal en tenant ce verrou exclusif** : toutes les transactions économiques du monde attendent (1,7 à 10 s). Les commandes calculent dans un worker mais sous le verrou du village (`compute.ts:108-116`, `transaction-refinement.ts:27-47`). Rien ne réévalue les trajets engagés.

**Besoins futurs.** Un seul profil (piéton, demi-largeur 1/16, pente 0,25, cardinal) ; durée sans route ni pente ; ni gabarit, ni braquage, ni usure. **[Inférence]** Convois, charrettes et gabarit charretière demanderaient une praticabilité par profil que les caches à clé géométrique ne savent pas exprimer ; `movementProfileId` et `traversalConstraintsId` existent dans `route-planner.ts`, inutilisés.

**Classement.**
- Invariants métier confirmés : cohérence physique ; tout terrain praticable est navigable ; routes magnétiques ; inaccessibilité constatée à la demande ; durées figées à l'admission.
- Hypothèses héritées ou injustifiées : préservation de l'accès ; réseau « tous buts » recalculé par commande ; routes couplées et dépendantes de l'ordre des identifiants ; lignes de désir calculées puis figées.
- Contraintes techniques réelles : tore ; déterminisme ; pas de SQL dans les workers ; ordre des verrous ; chemins persistés ; budgets d'image client.
- Doublons : deux compositions du sol ; trois invalidations ; trois planificateurs plus l'onboarding ; A* client et serveur.
- Problèmes démontrés : invalidation mondiale ; calcul lourd sous verrou exclusif mondial et sur le fil principal ; « inaccessible » = « hors budget » ; cache coupé silencieusement ; couplage entre routes ; boucle réseau → routes automatiques → `inheritedRoads` → coût.
- **Décisions de game design ouvertes** : sort d'un trajet engagé devenu impraticable (continuer, se re-router, s'arrêter, échouer) ; les routes accélèrent-elles ou attirent-elles seulement ; lignes de désir observées ou calculées ; effet économique d'un bâtiment inaccessible ; profils par entité (piéton, charrette, convoi, armée).

## 8. Directions possibles (sans préjuger de la structure)

1. **Supprimer d'abord** : retirer `LEVELING_ACCESS` et l'ancien `ACCESS_BLOCKED` (précédent S4a) ; retouche purement géométrique ; contrôle borné des seuls chemins engagés (`worldActivePaths`, `ENGAGED_PASSAGE`) ou réévaluation paresseuse selon la décision. Simple, réutilise l'existant, supprime le calcul sous verrou mondial ; laisse le réseau global de la présentation.
2. **Trajets à la demande, par mission** : les commandes ne calculent que source → cibles demandées, comme les exploitations ; le réseau « tous buts » ne sert plus qu'à l'affichage (asynchrone, hors verrou) ou disparaît ; jardins par parcelle. Supprime le couplage dans la simulation ; lignes de désir à redéfinir.
3. **Lignes de désir observées** : routes automatiques et braseros dérivés des chemins réellement persistés (avec usure éventuelle). Conforme à la décision 2, met fin à la boucle ; changement visible et migration des `inheritedRoads`.
4. **Une seule représentation physique, invalidée localement** : généraliser les versions par chunk au sol du village et unifier `land()`/`build()`. Performance mondiale ; à n'envisager qu'après 1 et 2 ; risque de dépendance à l'historique.
5. **Profils de déplacement explicites** branchés sur `movementProfileId` : prépare charrettes, convois, armée ; caches à indexer par profil ; décider tôt des diagonales et du braquage.

## 9. Correctifs successifs (historique Git)

1. `abeee97` (30/09) : jardins et trajets initiaux (grille par case).
2. `f0d0308` (05/10) : routes et équipements ; raffinement au 1/8.
3. `8233886` (11/10) : contourner les troncs RC1.
4. `d40a43b`, `cc43b9c`, `90a8ce3` (11/10) : performance, réutilisation de géométrie et de contextes.
5. `7fa926f`, `9c8dde4` (12/10) : expéditions asynchrones ; préserver accès et retours engagés.
6. `c20cd1b` (16/10) : réseau de présentation dans des workers.
7. `a641cd6`, `20f8f2a`, `6f44bd1` (18/10) : commerce longue distance borné ; cache hiérarchique ; capacité.
8. `2674375`, `317cc93` (18-19/10) : jobs de nivellement avec contrôles d'accès ; accélération.
9. `14c6bed` (19/10) : cache de géométrie ; recherche des chantiers déportée.
10. `8f31f55` (20/10) : terraformation libre ; accès aux jardins.
11. `8234926` (21/10) : certifier la route grossière avant la recherche fine.
12. `8c54b15` (24/10) : cache de 50 000 à 400 000 cellules (9,5 s par commande sur Catmark).
13. `e43857e` (24/10) : réseau de commande sur une lane worker (fil principal bloqué).
14. `2c6eb97` (26/10) : deux géométries par monde (mémoire).
15. `ec42df8` (27/10) : bosquet dont le centre est dans un tronc (11 sur 158 faussement inaccessibles).
16. `a683861` (28/10) : réseau persisté entre redémarrages (13,7 à 15 s à froid).
17. `0178823` (29/10) : souche retirée, tronc sorti de la navigation.
18. `808e8b2` (29/10) : jardin praticable à coût ×30 (68 routes sur 105 les traversaient) ; `network-2`.
19. `2f102b5`, `0869ad9` (30/10) : cases de route ; routes qui attirent la recherche grossière ; `network-3`.
20. `64378a0`, `38254aa` (31/10) : retouches instantanées avec `assertAccess` ; nivellement transparent.

**[Inférence] Le motif** : chaque règle de jeu (troncs, jardins, routes, souches) s'est greffée dans les mêmes recherches couplées et dans leur empreinte ; chaque gain de performance est venu d'un cache ou d'un déport, sans réduire le périmètre calculé ; chaque faux négatif a été corrigé par une dérogation locale.

# Refonte des trajets : méthode

10 novembre 2026. Base relue : `7607008`, branche `wip/v2-commandes-bornees`. Statut : **spécification proposée**, à auditer, puis à valider par Tristan. Aucun code modifié.

Cadre : [invariants et décisions de game design](DECISIONS-NAVIGATION-2026-10-31.md) (1 à 11), [diagnostic du 31 octobre](DIAGNOSTIC-NAVIGATION-2026-10-31.md), [carte des verrous](VERROUS-2026-11-04.md), [dette « Trajets »](DETTE-TECHNIQUE.md). Cette spec **remplace**, pour la navigation, les sections 3 à 5 de la [spec proposée du 23 octobre](SPEC-REFONTE-NAVIGATION-ECONOMIE.md) : son §8.2 (durée égale au plus court chemin) est écarté par la décision 8, et son champ de distance « tous buts » par la décision 9 et l'invariant 6. Le registre `resource_movements` et les `processes` (§6 du 23) sont hors scope.

## 0. Résultat attendu

1. **La durée d'un trajet suit son coût** : une case de route compte 0,7 s, le reste 1 s (décision 8). La recherche choisit par ce même coût, le client anime par ce même coût.
2. **Chaque mission calcule son propre trajet** : plus aucun résultat de simulation ne dépend du réseau « tous buts » du village.
3. **Les lignes de désir sont observées** : les routes automatiques et leurs braseros viennent des trajets réellement admis (décision 9).
4. **Le réseau « tous buts » disparaît**, avec son empreinte mondiale et ses 200 Ko par présentation.
5. **L'invalidation devient locale** (versions par chunk), puis **le calcul sort des verrous** (R2 de la carte des verrous).

Chaque point est une tranche livrable seule, avec ses mesures avant/après. L'ordre alterne l'invisible et le visible (§5).

## 1. État vérifié à `7607008`

Inventaire en lecture seule du 10 novembre ; les références sont celles de `7607008`.

**Qui appelle encore le réseau « tous buts » (`buildTravelNetwork`).**

| Appelant | Usage | Verrou, fil |
|---|---|---|
| Présentation, `VillagePresentationReader.capture` (`apps/api/src/modules/villages/presentation.ts:194-253`) | Affichage seulement : `travelRoutes` (`:229`), persistées dans `village_travel_networks` (`:245-252`). Le NOC passe aussi par ce lecteur (`observation-routes.ts:47`) | Hors verrou : `state()` en lecture seule, réseau calculé après la transaction (`presentation.ts:222-228`) ; pool `navigation` |
| `readInfrastructureSpatialState` → `commandTravelNetwork` (`service.ts:876-1008`, `:997`) | **Tournée de jardin** (`planGardenTour`, `service.ts:2455-2461`) et exclusion `unreachable` des parcelles (`:2462-2468`). Seul appelant : `prepareExploitation` (`:2394`), joué par `startVillageExploitation` (`:2637-2663`), `acceptHarvestIntent` (`harvest-intents.ts:57-116`, via le scheduler) et l'aperçu (`:2614`) | **Sous la ligne du village et les zones de la région** (`reconcile-economy.ts:248-285`), worker `commandNavigation` attendu par le fil principal |
| `stoneTravelPath` (`service.ts:494`) | Mini-réseau d'un seul but entre 32 et 128 cases, puis `refineVillagePath` | Selon l'appelant |

Code mort ou sans appelant en production : branche en ligne de `state()` (`service.ts:1441-1446`), `observationNetwork` (`navigation/compute.ts:63`), `prepareInfrastructureEdit` et le gel `inheritedRoads`/`inheritedCells` (`contracts/src/infrastructure.ts:378-423`, seul appelant un aperçu client sans appelant), table `leveling_jobs`, paramètres `plan`/`stroke`/`inheritedCells` de `readInfrastructureSpatialState`. La migration 076 a vidé les plans d'infrastructure.

**Ce que la simulation lit vraiment.**

- Bois, pierre, souches : chemin par cible (`stoneTravelPath` → `refineVillagePath`), `transportMs` figé à l'admission (`deposits/worksites.ts:563-592`, `stone-extractions.ts:394-425`).
- Science : chemin par cible (`science/service.ts:841-886`), recalcul seulement au rappel (`:941-946`).
- Commerce, expéditions : `planRoute` sur le contexte mondial (`trade-service.ts:100-225`, `science/expeditions.ts:267-325`).
- **Jardin : seul consommateur du réseau complet.** `planGardenTour` (`packages/contracts/src/garden-tour.ts:5-107`) cherche dans l'union des `travelRoutes`, plan figé dans `exploitation_orders.garden_plan` et réutilisé tel quel au départ (`exploitation-budget.ts:155-170`).
- Énergie admissible : toujours sur la durée figée (`stone-extractions.ts:400-405`, `garden-tour.ts:66`, `exploitation-budget.ts:158`, `trade-service.ts:462`).

**Durée.** `travelDuration` = Manhattan × 1 000 ms, ni route ni pente (`contracts/src/travel-paths.ts:586-601`). La recherche, elle, coûte une route 0,7 (`:96`), plus un bonus 0,7 sur les arêtes déjà prises par une autre route du réseau (`:530`, couplage dépendant de l'ordre). Le raffinement choisit et accepte ses candidats **par longueur**, pas par coût (`:954`, `:1200`). Le client anime à vitesse constante `pathLength / transportMs` (`apps/world-web/src/scene/village-workers.ts:762`, `:829`, `:878`).

**Lignes de désir.** Aujourd'hui calculées côté client depuis `travelRoutes` : `automaticRoadStrokes` (`contracts/src/infrastructure.ts:304-346`), masquées sous les emprises et les cases de route (`road-profile.ts:11-24`), pavées si `kind === 'building'`, en terre sinon (`:69-81`) ; braseros `automaticBraziers` (`contracts/src/automatic-braziers.ts:18-70`). Les chemins des extractions de bois en cours y sont déjà ajoutés (`service.ts:1447-1456`) : un premier cas de ligne observée. Autres consommateurs client de `travelRoutes` : loisir sur les routes `building` (`village-workers.ts:507-528`), largeurs et obstacles de mise en place (`BabylonVillageScene.ts:1496-1503`, `:1541`), sélection d'équipement (`:747`), terrain (`terrain-renderer.ts:70`), braseros (`village-braziers.ts:166`, `:352-360`), surcouche de débogage, DevDrawer.

**Chemins persistés des missions** (matière des lignes observées) : `deposit_extractions.path_cells`, `garden_harvests.path_cells`/`return_path_cells`/`stops[].path`, `science_activities.path_cells`, `trade_journeys.path`.

**Caches et invalidation.** Mondiaux : `networkFingerprint` (sommets, terrasses et ressources du monde, `presentation.ts:126-145`), `TravelGround.revision` (`rc1-network-ground.ts:52-62`, clé de `networkCache`, `passageCaches`, `refinementCaches`), `rc1GroundVersion` (`rc1-ground-version.ts:13-24`), `navigationRevision` (`navigation/context.ts:44-48`). Locaux : `navigation_chunk_versions` (046, 048, 060), **sans déclencheur sur `road_cells` ni `road_anchors`**. `MAX_GEOMETRY_KEY = 131 072` coupe les caches de géométrie sans signal (`rc1-ground.ts:29`, `:231`).

**Écart découvert.** Le contexte du commerce et des expéditions lit `village_infrastructure.plan` (`navigation/context.ts:139-140`), vide depuis 076, et ni `road_cells` ni `road_anchors` : leurs trajets ignorent routes et accessoires. **[Inférence]** Un accessoire posé sur un trajet commercial n'est pas un obstacle pour le planificateur mondial.

**Contrôles d'accès.** `LEVELING_ACCESS`, `ACCESS_BLOCKED`, `assertAccess` : supprimés. Reste `ENGAGED_PASSAGE` (`infrastructure.ts:40-72`, `:234-236`, `:285-289`), appliqué à la construction, aux retouches de terrain case par case (`terrain-edits.ts:121`, `:270`) et aux ancrages (`road-anchors.ts:192-194`), pas aux cases de route (`road-cells.ts:66-125`), qui ne changent que le coût.

## 2. Principe

Supprimer avant d'optimiser (invariant 6). Le réseau « tous buts » porte encore deux responsabilités : la tournée de jardin et l'affichage. La décision 9 retire l'affichage, la tranche T2 retire le jardin ; il peut alors disparaître, et l'invalidation mondiale avec lui. Ce qui reste est un calcul par mission, borné à un domaine connu, dont le résultat (chemin, coût, durée) est persisté à l'admission comme aujourd'hui.

Écarté : le champ de distance du village (§3 du 23 octobre). Il rend les durées exactes, mais garde un calcul « tous buts » recalculé à chaque changement de la région. Une mission de jardin visite au plus quelques parcelles ; quelques recherches bornées coûtent moins qu'un champ complet et n'ont rien à invalider.

## 3. Coût et durée

**Une seule fonction de coût**, dans `packages/contracts` : `travelCost(path, roads, world)`, somme sur les segments du chemin de leur longueur multipliée par 0,7 si le segment est sur une case de route, 1 sinon. Règle d'appartenance : celle de la recherche aujourd'hui (milieu du segment, `travel-paths.ts:530`), sans le bonus `shared`. Durée = `round(travelCost × 1 000)` ms, entière, déterministe.

- La recherche minimise ce coût, et le raffinement choisit et accepte ses candidats par coût (`:954`, `:1200`), pas par longueur.
- `travelDuration` devient `travelCost` partout où une durée est figée (liste des appelants : `worksites.ts:592`, `service.ts:2358`, `:2553`, `garden-tour.ts:14`, `science/service.ts:877`, `:914`, `:920`, `:941`, `trade-service.ts:117`, `:201`, `:212`, `:224`, `village-workers.ts:400`).
- Les missions engagées gardent leur durée figée : aucune réécriture, aucune migration de données.
- La pente n'entre pas dans la durée (décision 8).
- **Commerce et expéditions** lisent `road_cells` et `road_anchors` (corrige l'écart du §1) : une route commerciale bénéficie des routes posées, un accessoire bloque comme dans le village.
- **Client** : la position d'un villageois suit le coût cumulé, pas la longueur cumulée. Tableau des coûts cumulés calculé une fois par chemin à sa réception ; à chaque image, une recherche dichotomique sur ce tableau (O(log n), ou O(1) amorti avec le curseur du segment courant). Effet visible : le villageois accélère sur la route.

## 4. Cible

### 4.1 Tournée de jardin par mission

`planGardenTour` ne lit plus `travelRoutes`. La tournée s'enchaîne jambe par jambe : porte de l'hôtel de ville → parcelle 1 → … → parcelle k → porte, chaque jambe calculée par le planificateur par cible (`refineVillagePath`), les parcelles sélectionnées voisines restant traversables directement par leur côté commun (règle actuelle, `garden-tour.ts:38-50`). L'ordre de visite reste celui de la sélection (`cells`, `garden-tour.ts:94`), la traversée d'un jardin non visité garde son surcoût (`GARDEN_CROSSING_COST`, `:62-65`), la durée reste « jambes + 60 s par arrêt » (`:95-106`). Aujourd'hui la recherche de jambe est un Dijkstra par case sur l'union des routes ; demain, un chemin raffiné au huitième : les jambes seront plus fidèles au sol, donc leur durée peut changer, hors effet de T1. `readInfrastructureSpatialState` ne construit plus de réseau.

Coût attendu : k + 1 recherches bornées à la région au lieu d'un réseau complet. **À mesurer** (T0, T2) : p95 de la commande d'exploitation et de `processHarvestSubmission` sous charge.

### 4.2 Issues de recherche explicites

Trois issues typées pour toute recherche par mission : `found` (chemin, coût), `unreachable` (domaine épuisé sans élagage), `budget` (élagage, plafond de nœuds ou de détour atteint). Dans la région du village, le domaine est borné : une recherche sans plafond de détour y est exhaustive, et `unreachable` y est une preuve. Hors région (gisement reconnu, science lointaine), une recherche bornée n'est jamais une preuve. On reprend seulement cette partie du « planificateur unique » du 23 octobre, pas la réécriture générale.

| Issue | Commande manuelle | Chantier automatique, scheduler |
|---|---|---|
| `found` | départ | départ |
| `unreachable` | `409 DESTINATION_UNREACHABLE` | cible écartée `unreachable` (comportement actuel, décision 10) |
| `budget` | `503` réessayable | report avec réveil, jamais `unreachable` |

### 4.3 Lignes de désir observées

**Donnée.** Une table de passages par arête de case :

```sql
create table world_desire_edges (
  world_id uuid not null references worlds(id),
  cell_x integer not null,
  cell_y integer not null,
  direction smallint not null,      -- 0 : vers l'est, 1 : vers le sud
  passages integer not null,
  last_passage_at timestamptz not null,
  primary key (world_id, cell_x, cell_y, direction)
);
```

Pas de `village_id` : une arête appartient au sol, pas à un village (deux villages voisins tracent le même sentier). Coordonnées canoniques sur le tore.

**Écriture.** À l'admission d'une mission dont le chemin est persisté (extraction, tournée de jardin, relevé scientifique local), dans la même transaction que l'insertion de la mission : un `insert … on conflict do update set passages = passages + 1` groupé (`unnest`), une ligne par arête distincte du chemin (aller et retour comptés une fois). Le chemin est déjà dans les zones tenues (contrôle de couverture, VERROUS §3) ; l'écriture n'ajoute aucun verrou ni aucun ordre de verrou nouveau. Commerce et expéditions n'écrivent pas : longs chemins, et la décision viendra avec les convois (§8).

**Affichage.** Une arête est un sentier si `passages ≥ N` (seuil à valider, §8). Masquée sous une emprise ou une case de route, comme aujourd'hui ; rien n'est supprimé (pas d'usure, décision 9). Les braseros automatiques se dérivent des sentiers par la règle actuelle de `automaticBraziers`, appliquée aux sentiers au lieu des `travelRoutes`. Les promenades de loisir suivent sentiers et cases de route.

**Synchronisation.** Un composant V2 spatial, paginé par chunk comme le terrain, publié par les déclencheurs de `game_sync_pending` (migration additive). Le client ne reçoit plus que les arêtes de sa vue, au lieu de 200 Ko de réseau par village.

**État de départ.** Les routes automatiques affichées aujourd'hui sont conservées (décision 9). Script d'opérateur, une fois par environnement, après sauvegarde : pour chaque village, calculer la présentation actuelle et insérer ses arêtes avec `passages = N`. Lancé sur test, puis dev, puis staging et alpha avec la tranche.

### 4.4 Retrait du réseau « tous buts »

Après T3 : la présentation ne calcule plus de réseau. Retrait de `travelRoutes` du contrat V2 (nouvelle version du composant), de `village_travel_networks` (migration de nettoyage, après la fenêtre de retour arrière), de `networkFingerprint`, de la voie de présentation du worker, du code mort du §1. Les consommateurs client de `travelRoutes` (§1) passent aux sentiers, aux cases de route et aux emprises. `buildTravelNetwork` ne subsiste que s'il reste un appelant (mini-réseau de `stoneTravelPath`), sinon il est supprimé.

### 4.5 Invalidation locale

Les caches de raffinement et de passage sont indexés par le vecteur des versions des chunks de leur domaine, au lieu de `TravelGround.revision` (SHA du monde). Déclencheurs de `navigation_chunk_versions` ajoutés sur `road_cells` et `road_anchors` (migration additive). Conséquences : une retouche ne coûte qu'aux recherches qui traversent ses chunks ; la clé ne sérialise plus les sommets (fin de `MAX_GEOMETRY_KEY`) ; commerce et expéditions passent de `navigationRevision` (compteur mondial) aux versions des chunks de leur route, déjà présentes dans leurs certificats.

### 4.6 Calcul hors verrou (R2)

Pour chaque commande qui calcule un trajet : préparation dans une transaction en lecture seule (sol, cibles, versions des chunks), calcul hors transaction, puis transaction d'écriture dans l'ordre existant (village → clé du monde → zones → gisements → lignes) qui compare les versions des chunks du chemin à ±1 case. Égales : le certificat sert sans recalcul. Différentes : sortie sans effet, une nouvelle préparation hors transaction, puis `409` (commande) ou report (scheduler). Le commerce suit déjà ce modèle (`trade-service.ts:283-288`). Effet attendu : la ligne du village et les zones ne sont plus tenues pendant un calcul ; c'est la cause principale du retard du scheduler sous charge (VERROUS §7).

## 5. Tranches

| | Tranche | Visible | Contenu | Dépend de |
|---|---|---|---|---|
| T0 | Mesures de référence | non | §7, sur dev et sur staging avec l'outil de test de charge | — |
| T1 | Durée = coût | **oui** | §3, commerce et expéditions sur `road_cells`, animation par coût, rapport d'équilibrage | T0 |
| T2 | Jardin par mission, issues explicites | non | §4.1, §4.2 | T0 |
| T3 | Lignes de désir observées | **oui** | §4.3 ; `travelRoutes` encore envoyé, derrière un drapeau, pour revenir en arrière | T2 (chemins de jardin par mission) |
| T4 | Retrait du réseau | non | §4.4 | T3 validée |
| T5 | Invalidation locale | non | §4.5 | T4 |
| T6 | Hors verrou | non | §4.6 | T5 |
| T7 | Nettoyage | non | migrations de retrait : `village_travel_networks`, `leveling_jobs`, `navigationRevision` (avec I.6) | fenêtre de retour arrière |

T1 et T2 sont indépendantes. T1 peut se livrer d'abord, puisqu'elle est visible et petite.

## 6. Invariants conservés

- `world_id` sur toute donnée et tout accès ; coordonnées canoniques sur le tore.
- Ordre des verrous inchangé (AGENTS.md, VERROUS §3) ; l'écriture des passages se fait sous les zones déjà tenues ; aucune notification lue, verrouillée ou acquittée par ces chemins.
- Durées figées à l'admission ; aucune mission engagée réécrite.
- `ENGAGED_PASSAGE` conservé tel quel (décision 7).
- Client non autoritaire : il anime par le coût, il ne calcule ni durée ni admission.
- Déterminisme : à sol et versions identiques, même chemin et même coût, dans le worker comme sur le fil principal.
- Décor : les sentiers et braseros restent dérivés, jamais des entités persistantes individuelles (la table compte des passages, pas des objets).

## 7. Mesures et critères d'acceptation

Mesures avant/après, dans le commit et la spec de chaque tranche :

- **Serveur** (dev, rc1-dev) : temps de présentation d'un village à froid et à chaud ; temps et nombre de recalculs de réseau après une retouche distante ; p95 de `startVillageExploitation` sur un jardin de 4 à 8 parcelles ; durée de détention de la ligne du village.
- **Charge** (staging, outil `apps/load-test`, 10 et 30 bots) : p95 des commandes, retard du scheduler, file du worker de trajets, `NAVIGATION_BUSY`.
- **Client** (AGENTS.md, Performance) : village prêt à froid et à chaud, images > 200 ms au chargement et pendant 60 s, coût par image des villageois (p95 < 2 ms) ; taille de la présentation (aujourd'hui environ 200 Ko).

Critères :

- T1 : à chemin identique, durée = coût × 1 000 ; un chemin sur route est plus court en durée que le même chemin hors route (test pur) ; rapport des durées avant/après sur les missions types de rc1-dev ; test déterministe qui borne à O(1) amorti l'évaluation de la position par image.
- T2 : aucun appel à `buildTravelNetwork` dans la préparation d'une exploitation (compteur en test) ; même ordre de visite qu'avant ; écarts de durée par jambe relevés et expliqués sur les fixtures existantes (raffinement au huitième), hors effet de T1.
- T3 : à parité de missions, les sentiers d'un village de test couvrent les chemins persistés ; aucun sentier sans passage ; script de départ idempotent.
- T4 : présentation sans réseau, taille et temps mesurés ; plus aucune lecture de `travelRoutes` côté client.
- T5 : une retouche à plus d'un chunk d'un chemin ne recalcule pas ce chemin (test) ; plus de clé de géométrie sérialisée.
- T6 : aucune recherche de chemin pendant qu'une ligne de village est tenue (instrumentation) ; rejeu et refus prouvés par barrières, comme en VERROUS §10.

## 8. À valider par Tristan

1. **Seuil d'apparition d'un sentier** (N passages). Proposition : N = 3, ce qui évite un sentier pour une seule course et en dessine un dès qu'un lieu est fréquenté.
2. **Aspect des sentiers.** Aujourd'hui les routes automatiques vers les bâtiments sont pavées, les autres en terre. Proposition : tous les sentiers en terre, les cases de route posées par le joueur restant les seules routes pavées. Changement visible sur les villages existants.
3. **Sentiers partagés entre villages.** Proposition : oui, une arête appartient au sol ; un village voit les sentiers de ses voisins.
4. **Commerce et expéditions** : laissent-ils des sentiers (routes commerciales visibles sur la carte) ? Proposition : pas maintenant, à décider avec les convois.
5. **Équilibrage de T1** : une mission sur route dure jusqu'à 30 % de moins. Proposition : livrer tel quel et juger sur le rapport de T1 ; pas de compensation préventive.

## 9. Hors scope

Profils de déplacement et diagonales (décision 11), usure des sentiers, registre de ressources, worker hors du processus de l'API, carte, convois, combat. Unification des deux compositions du sol du worker (direction 4 du diagnostic) : seulement si T5 la rend nécessaire.

## 10. Risques

- **Écritures de passages** : 50 à 200 arêtes par mission, sur la transaction d'admission. À mesurer en T3 (charge) ; repli : agrégation par lot dans le scheduler.
- **Script de départ** : un calcul de réseau par village, une fois ; à lancer hors pointe, après sauvegarde.
- **Contrat V2** : retrait de `travelRoutes` et nouveau composant ; versionner, garder l'ancien derrière drapeau pendant T3.
- **Durées plus courtes** : plus de production par heure pour les villages routiers ; voir §8.5.
- **Issues `budget` hors région** : un gisement reconnu lointain peut rester en attente au lieu d'être écarté ; à rendre visible au joueur (message existant du chantier en attente).

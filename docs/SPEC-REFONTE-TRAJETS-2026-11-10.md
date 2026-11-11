# Refonte des trajets : méthode

10 novembre 2026. Base relue : `7607008`, branche `wip/v2-commandes-bornees`. Statut : **spécification validée par Tristan le 10 novembre** (audit d'architecture intégré, §11 ; points du §8 validés tels que proposés). Aucun code modifié.

Cadre : [invariants et décisions de game design](DECISIONS-NAVIGATION-2026-10-31.md) (1 à 11), [diagnostic du 31 octobre](DIAGNOSTIC-NAVIGATION-2026-10-31.md), [carte des verrous](VERROUS-2026-11-04.md), [dette « Trajets »](DETTE-TECHNIQUE.md). Cette spec **remplace**, pour la navigation, les sections 3 à 5 de la [spec proposée du 23 octobre](SPEC-REFONTE-NAVIGATION-ECONOMIE.md) : son §8.2 (durée égale au plus court chemin) est écarté par la décision 8, et son champ de distance « tous buts » par la décision 9 et l'invariant 6. Le registre `resource_movements` et les `processes` (§6 du 23) sont hors scope.

## 0. Résultat attendu

1. **La durée d'un trajet suit son coût** : une case de route compte 0,7 s, le reste 1 s (décision 8). La recherche minimise ce même coût, le client anime par ce même coût, pour toutes les missions, bois et pierre compris.
2. **Chaque mission calcule son propre trajet** : plus aucun résultat de simulation ne dépend du réseau « tous buts » du village.
3. **Les lignes de désir sont observées** : les sentiers et leurs braseros sont agrégés, hors des commandes, depuis les trajets réellement admis (décision 9).
4. **Le réseau « tous buts » disparaît**, avec son empreinte mondiale et ses 200 Ko par présentation.
5. **L'invalidation devient locale** (versions par chunk), puis **le calcul sort des verrous** (R2 de la carte des verrous), réconciliation comprise.

Chaque point est une tranche livrable seule, avec ses mesures avant/après. L'ordre alterne l'invisible et le visible (§5).

## 1. État vérifié à `7607008`

Inventaire en lecture seule du 10 novembre, revérifié par l'audit (§11). Références à `7607008`.

**Qui appelle encore le réseau « tous buts » (`buildTravelNetwork`).**

| Appelant | Usage | Verrou, fil |
|---|---|---|
| Présentation, `VillagePresentationReader.capture` (`apps/api/src/modules/villages/presentation.ts:194-253`) | Affichage seulement : `travelRoutes` (`:229`), persistées dans `village_travel_networks` (`:245-252`). Le NOC passe aussi par ce lecteur (`observation-routes.ts:47`) | Hors verrou : `state()` en lecture seule, réseau calculé après la transaction (`presentation.ts:222-228`) ; pool `navigation` |
| `readInfrastructureSpatialState` → `commandTravelNetwork` (`service.ts:876-1008`, `:997`) | **Tournée de jardin** (`planGardenTour`, `service.ts:2455-2461`) et exclusion `unreachable` de la sélection (`:2462-2468`). Seul appelant : `prepareExploitation` (`:2394`), joué par `startVillageExploitation` (`:2637-2663`), `acceptHarvestIntent` (`harvest-intents.ts:57-116`, via le scheduler) et l'aperçu (`:2614`) | **Sous la ligne du village et les zones de la région** (`reconcile-economy.ts:248-285`), worker `commandNavigation` attendu par le fil principal |
| `stoneTravelPath` (`service.ts:374-497`) | Gisement reconnu : chemin reconnu (`:383-386`) ; sur RC1, cible à ±32 cases : raffinement direct (`:393-408`) ; au-delà de 128 cases : jambe en L (`:411-424`) ; sinon mini-réseau d'un seul but, **sans infrastructure** (`:425-497`), puis `refineVillagePath` | Selon l'appelant |

Sans appelant en production : branche en ligne de `state()` (`service.ts:1441-1446`), `observationNetwork` (`navigation/compute.ts:63`), table `leveling_jobs`, paramètres `plan`/`stroke`/`inheritedCells` de `readInfrastructureSpatialState`. Le gel `inheritedRoads`/`inheritedCells` (`contracts/src/infrastructure.ts:378-423`) n'a plus d'écrivain serveur ; son seul appelant est un aperçu client (`BabylonVillageScene.ts:683`) dont l'atteignabilité reste à vérifier avant retrait. La migration 076 a vidé les plans d'infrastructure.

**Ce que la simulation lit vraiment.**

- Bois, pierre, souches : chemin par cible, `transportMs` figé à l'admission (`deposits/worksites.ts:563-592`, `stone-extractions.ts:394-425`).
- Science : chemin par cible (`science/service.ts:841-886`). Le point d'arrêt d'un relevé se calcule par `routeLength` (`:869-870`), sa durée par `travelDuration` (`:877`) ; le rappel recalcule la position sur le chemin engagé (`:914-941`). Le client recalcule le `transportMs` des relevés depuis le chemin (`village-workers.ts:400`) : il n'est pas transmis.
- Commerce, expéditions : `planRoute` sur le contexte mondial (`trade-service.ts:100-225`, `science/expeditions.ts:267-325`).
- **Jardin : seul consommateur du réseau complet.** `planGardenTour` (`packages/contracts/src/garden-tour.ts:5-107`) fait un Dijkstra par case sur l'union des `travelRoutes`, dans l'ordre de la sélection (`:94`), avec un surcoût pour traverser un jardin non visité (`GARDEN_CROSSING_COST`, `:61-65` ; les deux jardins de la jambe sont « propres »). Le plan est figé dans `exploitation_orders.garden_plan` et réutilisé tel quel au départ, sans revalidation physique (`exploitation-budget.ts:155-173`).
- Énergie admissible : toujours sur la durée figée (`stone-extractions.ts:400-405`, `garden-tour.ts:66`, `exploitation-budget.ts:158`, `trade-service.ts:462`).

**Coût, durée et routes.** `travelDuration` = Manhattan × 1 000 ms, ni route ni pente (`contracts/src/travel-paths.ts:586-601`). Trois règles « route » coexistent dans trois recherches :

- recherche grossière du réseau : arête à 0,7 si son segment entier centre-à-centre est `manual` (`coarseRoadEdges`, `:320-347`, utilisé à `:530`), plus 0,7 sur les arêtes déjà prises par une autre route (couplage), plus une pénalité de virage de 0,05 (`:532`) ;
- recherche fine au huitième : pas à 0,7 si le pixel `manual` est au nœud **ou** si le nœud est sur le témoin grossier (`guided`, `:1152-1159`) ;
- planificateur mondial : 0,7 si le pixel au milieu du segment est `manual` (`compute-worker.ts:160-163`).

Le raffinement accepte et choisit ses candidats **par longueur** (`:954`, `:1016`, `:1200`). Pour une cible de ressource à plus de 16 cases, il certifie la queue du témoin grossier telle quelle et ne recherche que le connecteur de porte (`:918-962`). Or le témoin du mini-réseau de `stoneTravelPath` est calculé sans infrastructure : **les trajets de bois et de pierre de plus de 16 cases ignorent les routes**. Le client anime à vitesse constante `pathLength / transportMs` (`village-workers.ts:762`, `:829`, `:878`, `:899`, `:920`).

**Lignes de désir.** Aujourd'hui calculées côté client depuis `travelRoutes` : `automaticRoadStrokes` (`contracts/src/infrastructure.ts:304-346`), masquées sous les emprises et les cases de route (`road-profile.ts:11-24`), pavées si `kind === 'building'`, en terre sinon (`:69-81`) ; braseros `automaticBraziers` (`contracts/src/automatic-braziers.ts:18-70`), dont les identifiants dérivent de la géométrie des routes (`:49-56`). Les chemins des extractions de bois en cours y sont déjà ajoutés (`service.ts:1447-1456`). Consommateurs client de `travelRoutes` : loisir sur les routes `building` (`village-workers.ts:507-528`), jonctions avec les cases de route (`road-cell-links.ts:39`), largeurs et obstacles de mise en place (`BabylonVillageScene.ts:1496-1503`, `:1541`), braseros (`village-braziers.ts:166`, `:352-360`, et indirectement `BabylonVillageScene.ts:747`), profils pavés (`terrain-renderer.ts:70`), surcouche de débogage, DevDrawer.

**Chemins persistés des missions** : `deposit_extractions.path_cells`, `garden_harvests.path_cells`/`return_path_cells`/`stops[].path`, `science_activities.path_cells`, `trade_journeys.path`.

**Caches et invalidation.** Mondiaux : `networkFingerprint` (`presentation.ts:126-145`), `TravelGround.revision` (SHA des sommets, terrasses et arbres du monde, `rc1-network-ground.ts:51-62`, clé de `networkCache`, `passageCaches`, `refinementCaches` et des géométries du worker), `rc1GroundVersion` (`rc1-ground-version.ts:13-24`), `navigationRevision` (`navigation/context.ts:44-48`). Locaux : `navigation_chunk_versions` (046, 048, 060, 069). **Ni les versions de chunks ni `navigationRevision` n'ont de déclencheur sur `road_cells` ou `road_anchors`** (073 et 074 n'installent que la synchro privée). `MAX_GEOMETRY_KEY = 131 072` coupe les caches de géométrie sans signal (`rc1-ground.ts:29`, `:231`).

**Écart.** Le contexte du commerce et des expéditions lit `village_infrastructure.plan` (`navigation/context.ts:139-141`), vide depuis 076, et ni `road_cells` ni `road_anchors` : leurs trajets ignorent routes et accessoires. Le planificateur mondial applique déjà 0,7 par segment `manual` (`compute-worker.ts:162`) ; il est seulement nourri de plans vides.

**Contrôles d'accès.** `LEVELING_ACCESS`, `ACCESS_BLOCKED`, `assertAccess` : supprimés. Reste `ENGAGED_PASSAGE` (`infrastructure.ts:40-72`, `:234-236`, `:285-289`), appliqué à la construction, aux retouches de terrain case par case (`terrain-edits.ts:121`, `:270`) et aux ancrages (`road-anchors.ts:191-194`), pas aux cases de route (`road-cells.ts:66-126`), qui ne changent que le coût. Un plan de tournée figé mais pas encore parti n'est pas un trajet engagé.

## 2. Principe

Supprimer avant d'optimiser (invariant 6). Le réseau « tous buts » porte encore deux responsabilités : la tournée de jardin et l'affichage. La décision 9 retire l'affichage, la tranche T2 retire le jardin ; il peut alors disparaître, et l'invalidation mondiale avec lui. Ce qui reste est un calcul par mission, borné à un domaine connu, dont le résultat (chemin, coût, durée) est persisté à l'admission comme aujourd'hui.

Écarté : le champ de distance du village (§3 du 23 octobre). Il rend les durées exactes, mais garde un calcul « tous buts » recalculé à chaque changement de la région. Une tournée de jardin visite au plus quelques parcelles ; quelques recherches bornées coûtent moins qu'un champ complet et n'ont rien à invalider.

## 3. Coût et durée (T1)

**Une seule définition du coût, au huitième de case**, dans `packages/contracts` : chaque pas de 1/8 de case vaut 0,7 si le pixel `manual` est au nœud d'arrivée (règle de `:1152-1154`), 1 sinon ; un pas grossier d'une case vaut la somme de ses huit pas. `travelCost(path, surface, world)` somme ce coût sur un chemin ; durée = `round(travelCost × 1 000)` ms, entière, déterministe.

**Les trois recherches utilisent exactement cette définition comme coût d'arête** :

- recherche fine : `guided` sort du coût (il peut rester dans l'heuristique, qui doit rester admissible) ; le surcoût de traversée des jardins reste un facteur ≥ 1 appliqué au coût de recherche, jamais à la durée ;
- recherche grossière : `coarseRoadEdges` est déjà « huit pas `manual` » ; le bonus `shared` et la pénalité de virage restent jusqu'à T4 pour le seul affichage, et ne servent plus à aucun chemin de mission ;
- planificateur mondial (`compute-worker.ts:160-163`) : passe à la règle au huitième.

Le raffinement accepte et choisit ses candidats par coût (`:954`, `:1016`, `:1200`), pas par longueur.

**Bois et pierre voient les routes.** Le mini-réseau de `stoneTravelPath` reçoit l'infrastructure (`readNavigationInfrastructure`) ; la branche qui certifie la queue du témoin (`:918-962`) n'est prise que si le témoin a été calculé avec la même surface. Test : cible de bois à 20 cases, route parallèle à une case du trajet direct ; le chemin admis emprunte la route et sa durée est inférieure à celle du chemin hors route.

**Commerce et expéditions** lisent `road_cells` et `road_anchors`. Dans la même tranche, migration additive : déclencheurs `navigation_touch_box` (versions de chunks) et `navigation_changed` (`navigationRevision`) sur ces deux tables, pour qu'un devis commercial ou une expédition préparés soient invalidés par la pose d'une route ou d'un accessoire.

**Durées figées.** `travelDuration` devient `travelCost` partout où une durée est figée : `worksites.ts:592`, `service.ts:2358`, `:2553`, `garden-tour.ts:14`, `science/service.ts:877`, `trade-service.ts:117`, `:201`, `:212`, `:224`. Le point d'arrêt d'un relevé (`science/service.ts:869-870`) passe au même coût que sa durée. Les missions engagées gardent leur durée : aucune réécriture, aucune migration de données.

**Science.** `science_activities` reçoit une colonne additive `transport_ms`, renseignée à l'admission ; le rappel (`:914-941`) répartit cette durée propre le long du chemin engagé au lieu de recalculer avec la règle courante ; pour une activité antérieure, il la déduit de ses dates. Le contrat client transporte `transportMs` des relevés au lieu de le recalculer (`village-workers.ts:400`).

**Client.** La position d'un villageois suit le coût cumulé du **chemin visuel** (connecteurs, `workerPassagePath`, A* vers les postes, route recalculée par arrêt, `village-workers.ts:887`), avec l'appartenance aux routes lue sur les cases de route reçues par le client. Tableau des coûts cumulés calculé une fois par chemin, à sa construction ; à chaque image, un curseur de segment par acteur, qui n'avance que sur les segments franchis. Le critère porte sur le nombre de segments visités par acteur et par image (aujourd'hui `sampleWorkerPath` est en O(n), `worker-motion.ts:137-145`). Effet visible : le villageois accélère sur la route.

La pente n'entre pas dans la durée (décision 8).

## 4. Cible

### 4.1 Tournée de jardin par mission (T2)

Nouvelle entrée du planificateur, `planVillageLeg(state, from, to, ownGardens)`, dans `packages/contracts`, qui partage `prepareRefinement`, `land()`, bordures, équipements et coût jardin avec `refineTravelRoute`, mais part d'un point quelconque : aujourd'hui `refineTravelRoute` part toujours des accès de l'hôtel de ville (`travel-paths.ts:758`, `:1018-1028`) et ne connaît qu'un jardin propre (`:777-778`). `ownGardens` contient les jardins de départ et d'arrivée de la jambe, comme `garden-tour.ts:61`.

La tournée s'enchaîne : porte de l'hôtel de ville → parcelle 1 → … → parcelle k → porte. Deux parcelles sélectionnées voisines par un côté sont reliées directement (règle actuelle, `garden-tour.ts:38-50`), sans recherche. L'ordre de visite reste celui de la sélection, la durée reste « jambes + 60 s par arrêt » (`:95-106`). Les jambes, raffinées au huitième au lieu d'un Dijkstra par case sur l'union des routes, sont plus fidèles au sol : leur durée peut changer, hors effet de T1. `readInfrastructureSpatialState` ne construit plus de réseau.

Coût attendu : k + 1 recherches bornées à la région au lieu d'un réseau complet. **À mesurer** (T0, T2) : p95 de la commande d'exploitation et de `processHarvestSubmission` sous charge, p95 d'une jambe.

### 4.2 Issues de recherche explicites (T2)

Trois issues typées pour toute recherche par mission : `found` (chemin, coût), `unreachable` (domaine épuisé sans élagage), `budget` (élagage ou plafond atteint). On reprend seulement cette partie du « planificateur unique » du 23 octobre, pas la réécriture générale.

**Borne.** Dans la région du village, la recherche n'élague plus par détour : elle est bornée par le **nombre de nœuds du domaine** (cases de la région × 64 au plus), publié en constante. `unreachable` n'est rendu que si la file se vide sans avoir atteint cette borne : c'est alors une preuve. Hors région (gisement reconnu, science lointaine), une recherche bornée rend `budget`, jamais `unreachable`. Test déterministe exigé (AGENTS.md, chemins chauds) : départ enclos par des douves, nombre de nœuds visités ≤ borne publiée ; même test pour une jambe de jardin.

| Issue | Commande manuelle | Chantier automatique, scheduler |
|---|---|---|
| `found` | départ | départ |
| `unreachable` | `409 DESTINATION_UNREACHABLE` | cible écartée `unreachable` (comportement actuel, décision 10) |
| `budget` | `503` réessayable | report avec réveil (`worksites.ts:559-575`), jamais `unreachable` |

Une jambe de jardin `unreachable` exclut aujourd'hui toute la sélection (`service.ts:2462-2468`). L'exclure parcelle par parcelle serait un changement produit : §8.

### 4.3 Lignes de désir observées (T3)

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

Pas de `village_id` : une arête appartient au sol (§8.3). Coordonnées canoniques sur le tore. Un passage = une mission admise.

**Canonisation.** Une seule fonction `desireEdges(path, world)` dans `packages/contracts` : arrondi des chemins au huitième en cases par la règle de `coarseTravelPath` (`travel-paths.ts:111-139`), arêtes cardinales canonisées (direction est ou sud, origine enveloppée), dédoublonnées par mission (aller, arrêts et retour d'une tournée comptés une fois). Testée à la couture du tore.

**Écriture : agrégation asynchrone, hors des commandes.** Rien n'est écrit dans la transaction d'admission. Une tâche du scheduler par monde lit les missions admises depuis son curseur `(started_at, id)` dans `deposit_extractions`, `garden_harvests` et `science_activities` (relevés locaux), calcule leurs arêtes et les ajoute à `world_desire_edges` par lots triés par clé primaire. Elle ne prend ni ligne de village ni zone ; elle suit le cadre du scheduler (tâche acquise en `SKIP LOCKED`, aucune notification d'autrui lue ou acquittée). Une seule tâche par monde, donc pas d'écrivains concurrents sur la table. Délai d'apparition d'un sentier : celui de la tâche (de l'ordre de la minute), acceptable pour un décor. Commerce et expéditions n'écrivent pas (§8.4).

Ce choix évite deux effets d'une écriture dans l'admission : des verrous de ligne entre villages voisins, qui ne sont aujourd'hui sérialisés par rien, et des publications de flux `spatial` tenues jusqu'au COMMIT dans chaque commande qui relance un lot, scheduler compris (VERROUS §4.1, §11.6.1).

**Affichage.** Une arête est un sentier si `passages ≥ N` (§8.1). Masquée sous une emprise ou une case de route, comme aujourd'hui ; rien n'est supprimé (pas d'usure, décision 9). Les braseros automatiques se dérivent des sentiers par la règle actuelle de `automaticBraziers`, avec une **identité stable par nœud de sentier** pour ne pas invalider les braseros éteints ou supprimés par les joueurs (`suppressedBraziers`, `manualLighting`) : correspondance des anciens identifiants calculée par le script de départ. Les promenades de loisir suivent sentiers et cases de route ; le loisir, purement client, ne compte pas comme passage.

**Conséquence visible** (décision 9, à confirmer, §8.2) : aucune mission ne va vers une maison, un atelier ou le campus. Un bâtiment construit après le script de départ n'aura donc pas de sentier vers lui, et pas de promenade de loisir, tant qu'aucune mission ne passe devant.

**Synchronisation.** Un composant V2 spatial, paginé par chunk comme le terrain, publié par les déclencheurs de `game_sync_pending` (migration additive), écrit par la seule tâche d'agrégation. Le client ne reçoit plus que les arêtes de sa vue.

**État de départ.** Les routes automatiques affichées aujourd'hui sont conservées (décision 9). Script d'opérateur, une fois par environnement, après sauvegarde : pour chaque village, calculer la présentation actuelle, insérer ses arêtes avec `passages = N`, et produire la correspondance des identifiants de braseros. Idempotent. Lancé sur test, puis dev, puis staging et alpha avec la tranche.

### 4.4 Retrait du réseau « tous buts » (T4)

Après T3 validée : la présentation ne calcule plus de réseau. Retrait de `travelRoutes` du contrat V2, de `village_travel_networks` (migration de nettoyage, après la fenêtre de retour arrière), de `networkFingerprint`, de la voie de présentation du worker, du code sans appelant du §1. Les consommateurs client de `travelRoutes` (§1, `road-cell-links.ts` compris) passent aux sentiers, aux cases de route et aux emprises. `buildTravelNetwork` ne subsiste que s'il reste un appelant (mini-réseau de `stoneTravelPath`), sinon il est supprimé.

**Contrat V2.** `SyncV2SpatialChangeSchema` est une union fermée (`sync-v2-spatial.ts:45-78`, `additionalProperties: false`). Avant T3, vérifier que le client tolère un composant inconnu ; sinon, déploiement client et serveur en même temps, et retour arrière par version complète.

### 4.5 Invalidation locale (T5)

Objectif : les caches de raffinement et de passage sont indexés par le vecteur des versions des chunks de leur domaine, au lieu de `TravelGround.revision`. Une retouche ne coûte qu'aux recherches qui traversent ses chunks ; la clé ne sérialise plus les sommets (fin de `MAX_GEOMETRY_KEY`) ; commerce et expéditions passent de `navigationRevision` aux versions des chunks de leur route, déjà dans leurs certificats.

**Sous-spec obligatoire avant T5.** Remplacer `revision` suppose de composer le sol par domaine, donc probablement d'unifier les deux compositions du sol du worker (direction 4 du diagnostic). La sous-spec donne : l'inventaire « entrée du coût ou de `land()` → table → déclencheur » (comme la migration 046, `046:73-136`), à vérifier notamment pour l'épuisement d'un gisement de pierre (060 exclut `stone_deposits` des déclencheurs en lot) ; ce qui remplace `revision` dans chaque cache ; la mesure attendue.

### 4.6 Calcul hors verrou (T6)

**Commandes.** Préparation dans une transaction en lecture seule (sol, cibles, versions des chunks), calcul hors transaction, puis transaction d'écriture dans l'ordre existant (village → clé du monde → zones → gisements → lignes) qui compare les versions des chunks du chemin à ±1 case. Égales : le certificat sert sans recalcul. Différentes : sortie sans effet, une nouvelle préparation hors transaction, puis `409`. Le chemin étant connu avant la transaction, ses zones sont déclarées dès la première acquisition, ce qui supprime la plupart des rejeux de VERROUS §10.2(b). Le commerce suit déjà ce modèle (`trade-service.ts:283-288`).

**Admissions automatiques** (chantiers relancés par la réconciliation de n'importe quelle commande et par le scheduler, `admitWorksites`, `worksites.ts:558`) : c'est la part dominante du calcul sous verrou. La réconciliation n'admet un départ que si un certificat valide existe pour cette cible ; sinon elle planifie une tâche `worksite.prepare` (cible, version de l'ordre) et le chantier attend `navigation-pending`, comme `navigation-busy` aujourd'hui (`worksites.ts:567-574`). La tâche calcule hors verrou et range le certificat (table `worksite_route_certificates`, clé village + cible, avec le vecteur de versions), puis réveille le chantier. La transition reste réconciliée par échéance, ID et type ; une échéance passée pendant la préparation part à la date de validation du certificat, comme un report `navigation-busy` aujourd'hui. Ce point de règle est à confirmer avec la décision 5 du 23 octobre (départs à l'heure logique), toujours ouverte.

Effet attendu : la ligne du village et les zones ne sont plus tenues pendant un calcul ; c'est la cause principale du retard du scheduler sous charge (VERROUS §7).

## 5. Tranches

| | Tranche | Visible | Contenu | Dépend de |
|---|---|---|---|---|
| T0 | Mesures de référence | non | §7, sur dev et sur staging avec l'outil de test de charge | — |
| T1 | Durée = coût | **oui** | §3 : coût unique au huitième, bois et pierre sur routes, commerce et expéditions sur `road_cells`, déclencheurs routes et ancrages, `transport_ms` de la science, animation par coût, rapport d'équilibrage | T0 |
| T2 | Jardin par mission, issues explicites | non | §4.1, §4.2 | T0 |
| T3 | Lignes de désir observées | **oui** | §4.3 ; `travelRoutes` encore envoyé, derrière un drapeau, pour revenir en arrière | T0 ; vérification du contrat V2 (§4.4) |
| T4 | Retrait du réseau | non | §4.4 | T2 et T3 validées |
| T5 | Invalidation locale | non | sous-spec, puis §4.5 | T4 |
| T6 | Hors verrou | non | §4.6 | T5 ; règle de départ des chantiers en attente |
| T7 | Nettoyage | non | migrations de retrait : `village_travel_networks`, `leveling_jobs`, `navigationRevision` (avec I.6) | fenêtre de retour arrière |

T1, T2 et T3 sont indépendantes entre elles. T1 peut se livrer d'abord, puisqu'elle est visible et rend la décision 8 effective.

## 6. Invariants conservés

- `world_id` sur toute donnée et tout accès ; coordonnées canoniques sur le tore, y compris pour les arêtes de sentier.
- Ordre des verrous inchangé (AGENTS.md, VERROUS §3). Aucune écriture nouvelle dans les transactions de commande ; l'agrégation des sentiers ne prend ni village ni zone. Aucune notification d'autrui lue, verrouillée ou acquittée.
- Durées figées à l'admission ; aucune mission engagée réécrite (science comprise, §3).
- `ENGAGED_PASSAGE` conservé tel quel (décision 7).
- Client non autoritaire : il anime par le coût, il ne calcule ni durée ni admission.
- Déterminisme : à sol et versions identiques, même chemin et même coût, dans le worker comme sur le fil principal.
- Décor : sentiers et braseros restent dérivés ; la table compte des passages, pas des objets.

## 7. Mesures et critères d'acceptation

Mesures avant/après, dans le commit et la spec de chaque tranche :

- **Serveur** (dev, rc1-dev) : temps de présentation d'un village à froid et à chaud ; temps et nombre de recalculs de réseau après une retouche distante ; p95 de `startVillageExploitation` sur un jardin de 4 à 8 parcelles et p95 d'une jambe ; durée de détention de la ligne du village.
- **Charge** (staging, outil `apps/load-test`, 10 et 30 bots) : p95 des commandes, retard du scheduler, file du worker de trajets, `NAVIGATION_BUSY`, `busy-rescheduled`.
- **Client** (AGENTS.md, Performance) : village prêt à froid et à chaud, images > 200 ms au chargement et pendant 60 s, coût par image des villageois (p95 < 2 ms) ; taille de la présentation (aujourd'hui environ 200 Ko).

Critères :

- T1 : à chemin identique, durée = coût × 1 000 ; la recherche fine, la grossière et le planificateur mondial donnent le même coût pour un même chemin (test pur) ; cible de bois à 20 cases avec route parallèle : chemin sur la route, durée plus courte ; devis commercial invalidé par la pose d'un accessoire sur sa route ; rappel d'un relevé antérieur à T1 inchangé ; nombre de segments visités par acteur et par image borné (test déterministe) ; rapport des durées avant/après sur les missions types de rc1-dev, bois et pierre compris.
- T2 : aucun appel à `buildTravelNetwork` dans la préparation d'une exploitation (compteur en test) ; même ordre de visite qu'avant ; écarts de durée par jambe relevés et expliqués sur les fixtures existantes, hors effet de T1 ; nœuds visités ≤ borne publiée, départ enclos compris.
- T3 : à parité de missions, les sentiers d'un village de test couvrent les arêtes des chemins persistés ; aucun sentier sans passage ; script de départ idempotent ; braseros éteints ou supprimés conservés après le script ; aucune écriture dans les transactions de commande (instrumentation).
- T4 : présentation sans réseau, taille et temps mesurés ; plus aucune lecture de `travelRoutes` côté client.
- T5 : une retouche à plus d'un chunk d'un chemin ne recalcule pas ce chemin (test) ; plus de clé de géométrie sérialisée.
- T6 : aucune recherche de chemin pendant qu'une ligne de village est tenue (instrumentation) ; rejeu et refus prouvés par barrières, comme en VERROUS §10 ; chantier automatique sans certificat mis en attente puis parti après la préparation.

## 8. Points de game design (validés le 10 novembre)

Tristan a validé les huit propositions ci-dessous telles quelles ; elles sont aussi reprises en décisions 12 à 19 dans les [décisions de navigation](DECISIONS-NAVIGATION-2026-10-31.md).

1. **Seuil d'apparition d'un sentier** : N passages, un passage = une mission admise. Proposition : N = 3. Les lots de bois relancés l'atteignent vite, les tournées de jardin plus lentement.
2. **Sentiers et bâtiments.** Après T3, aucune mission ne va vers une maison, un atelier ou le campus : un bâtiment construit après la conversion n'a pas de sentier ni de promenade de loisir tant qu'aucune mission ne passe devant. Les routes automatiques existantes sont gardées. Proposition : l'accepter (conforme à la décision 9) ; le joueur pose une route s'il en veut une.
3. **Aspect des sentiers.** Aujourd'hui les routes automatiques vers les bâtiments sont pavées, les autres en terre. Proposition : tous les sentiers en terre ; seules les cases de route posées par le joueur restent pavées. Changement visible sur les villages existants.
4. **Sentiers partagés entre villages.** Une arête appartient au sol ; un village voit les sentiers de ses voisins, qui révèlent où ils récoltent et quels gisements ils exploitent. Proposition : oui, cohérent avec des convois publics et des données commerciales privées (les sentiers ne montrent ni quantités ni stocks).
5. **Commerce et expéditions** : laissent-ils des sentiers (routes commerciales visibles) ? Proposition : pas maintenant, à décider avec les convois.
6. **Équilibrage de T1** : une mission sur route dure jusqu'à 30 % de moins, bois et pierre compris. Proposition : livrer tel quel et juger sur le rapport de T1.
7. **Parcelle inaccessible dans une tournée** : aujourd'hui toute la sélection est refusée. Proposition : écarter seulement la parcelle inaccessible et partir avec les autres, comme pour les souches.
8. **Chantier automatique en attente `budget` répétée** (gisement reconnu lointain introuvable dans le budget) : attente sans fin, ou abandon après K réveils ? Proposition : abandon après 3 réveils, avec le motif affiché dans la fiche du chantier.

## 9. Hors scope

Profils de déplacement et diagonales (décision 11), usure des sentiers, registre de ressources, worker hors du processus de l'API, carte, convois, combat. Revalidation physique d'un plan de tournée figé mais pas encore parti (existant, reconduit).

## 10. Risques

- **Délai des sentiers** : l'agrégation asynchrone rend un sentier visible avec un retard ; à mesurer en T3 (débit de la tâche, lignes par lot).
- **Script de départ** : un calcul de réseau par village, une fois ; hors pointe, après sauvegarde ; correspondance des braseros à prouver sur une copie de l'alpha.
- **Contrat V2** : union fermée (§4.4) ; versionner, garder l'ancien composant derrière drapeau pendant T3.
- **Durées plus courtes** : plus de production par heure pour les villages routiers (§8.6).
- **T5** : la tranche la plus lourde ; sa sous-spec peut révéler qu'il faut unifier les compositions du sol avant.
- **T6** : nouvelle tâche et nouvelle table de certificats ; à prouver par barrières, comme les verrous de zone.

## 11. Audit d'architecture du 10 novembre

Audit indépendant en lecture seule sur `6c1c2d8`. Le §1 a été confirmé sur ses cinq points principaux (jardin seul consommateur du réseau, commerce et expéditions aveugles aux routes, absence de déclencheurs, choix par longueur, portée de `ENGAGED_PASSAGE`). Constats intégrés ci-dessus :

- **Bloquants** : les trajets de bois et de pierre de plus de 16 cases ignorent les routes (§1, §3) ; le planificateur par cible ne part que de l'hôtel de ville et ne connaît qu'un jardin propre (`planVillageLeg`, §4.1) ; trois règles « route » coexistent, d'où un coût unique au huitième utilisé par les trois recherches (§3).
- **Importants** : écriture des passages dans l'admission remplacée par une agrégation asynchrone (§4.3) ; déclencheurs routes et ancrages avancés en T1 ; admissions automatiques hors verrou spécifiées (§4.6) ; durée propre des relevés scientifiques persistée (§3) ; bâtiments sans sentier rendus explicites (§4.3, §8.2) ; recherche bornée par le domaine avec test (§4.2) ; sous-spec obligatoire pour T5 (§4.5) ; canonisation des arêtes (§4.3) ; dépendances de §5 corrigées (T3 ne dépend pas de T2, T4 dépend des deux) ; contrat V2 fermé (§4.4).
- **Mineurs** : règle d'appartenance et liste des consommateurs corrigées (§1) ; appelants de durée complétés (§3) ; critère client sur le chemin visuel (§3) ; mesures de T0 et T3 complétées (§7).
- **Ajouts au §8** : sentiers et bâtiments, confidentialité des sentiers partagés, parcelle inaccessible, attente `budget` répétée.

Non vérifié par l'audit, à faire dans la tranche concernée : atteignabilité de l'aperçu `BabylonVillageScene.ts:683` (T4), couverture des déclencheurs pour l'épuisement de la pierre (sous-spec T5), tolérance du client V2 à un composant inconnu (avant T3).

## 12. Mesures de référence (T0, 10 novembre)

Code mesuré : `e3e6894` (code applicatif identique à `7607008`). PC de Tristan (8 cœurs logiques, MX230), sans serveur de dev pendant les mesures serveur, PostgreSQL 17 natif. Les chiffres absolus valent pour cette machine ; ils servent de point de comparaison pour les tranches, avec le même protocole.

**Charge locale** (`apps/load-test`, base `arbestra_load`, mondes `t0-a` : 15 bots groupés, `t0-b` : 15 bots dispersés avec `--grant wood=5000,timber=700` ; mélange par défaut, un geste toutes les 8 s ; paliers de 120 s, seuils relâchés du 4 novembre ; résumé `out/run-local-2026-11-10T20-16-02-945Z/summary.md`, non versionné) :

| Bots | Commandes p50 / p95 | Présentation p95 (attente de la file de trajets) | `NAVIGATION_BUSY` | Retard du scheduler max | Attente du pool p95 | CPU API p95 | Boucle API p99 |
|---|---|---|---|---|---|---|---|
| 10 | 51 ms / 602 ms | 1,7 s (1,2 s) | 0 sur 96 | 6,3 s | < 1 ms | 120 % | 46 ms |
| 30 | 408 ms / 5,0 s | 8,6 s (6,8 s) | 46 sur 197 | 51,5 s (récoltes en attente jusqu'à 51 s) | 1,1 s | 336 % | 461 ms |

Première ressource saturée à 30 bots : la file du worker de trajets (×13,6 sur son seuil), devant le pool PostgreSQL, le verrou de navigation des terraformations et le scheduler. Erreurs : 2,2 % à 30 bots, toutes `ECONOMY_BUSY` (R3).

**Mesures ciblées** (`apps/load-test/src/bench-navigation.ts`, sur `arbestra_rc1_load`, copie restaurée de la base de dev du 9 novembre ; API dédiée sur 3301 ; dix répétitions ; résultats `out/bench-navigation-2026-11-10T20-24-48-483Z.json`, non versionné) :

| Mesure | Bressuire (70 bâtiments, 40 parcelles) | Test Spawn (6 bâtiments) |
|---|---|---|
| Présentation à froid | 1 009 ms, 505 Ko (réseau lu dans `village_travel_networks` ; sol RC1 646 ms) | 447 ms, 168 Ko (réseau 250 ms) |
| Présentation à chaud, p50 | 17 ms | 15 ms |
| Présentation après une retouche à l'autre bout du monde (61 s plus tard) | 1 326 ms, dont **870 ms de réseau** | 383 ms, dont 196 ms de réseau |
| Aperçu d'exploitation, 1 parcelle, premier appel | 989 ms, dont environ **820 ms de réseau** | 336 ms |
| Aperçu, 1 / 4 / 8 parcelles, appels suivants p50 (p95) | 83 (233) / 83 (92) / 92 (101) ms | 52 (64) / 50 (62) ms |

Lecture : chaque retouche de terrain, n'importe où, fait recalculer le réseau complet de chaque village à sa lecture suivante (870 ms pour Bressuire), et la première tournée de jardin qui suit le paie aussi, sous la ligne du village dans la vraie commande. La présentation de Bressuire pèse 505 Ko, et non environ 200 Ko comme noté jusqu'ici.

**Navigateur** : campagne de mesures (trois chargements, 60 s de jeu) lancée sur Bressuire ; les quatre scénarios sont **invalidés** (onglet passé en arrière-plan, fenêtre redimensionnée, mouvements de souris pendant la mesure). À refaire sur un poste au repos. Valeurs indicatives seulement, non retenues : premier chargement 16,8 s, phases p95 « Personnages / eau » 0,2 ms, « chemins automatiques » 0,9 ms, « braseros » 1,5 ms, rendu principal 39 ms.

**Staging** : en attente des décisions de [TEST-DE-CHARGE.md](TEST-DE-CHARGE.md) §9 (machine, créneau, `--grant`, mélange).

## 13. T1 livrée (10 et 11 novembre) : mesures et équilibrage

Commits `3fbb877` (T1a, durée = coût au huitième, bois et pierre sur routes), `6d5ad54` (T1b, commerce et expéditions sur `road_cells` et accessoires, migration 082), `71bf69b` (T1c, durée engagée des relevés, migration 083), `9d140ff` (T1d, villageois plus rapides sur les routes), puis le correctif de performance ci-dessous. Statut : **à valider** (recette de Tristan, mesure navigateur).

**Équilibrage** (`apps/load-test/src/bench-durations.ts`, copie de la base de dev, Bressuire, 149 cases de route ; même chemin, durée à l'ancienne règle contre la nouvelle) : bois, 42 trajets, tous touchent une route, aller **−4,2 % en moyenne** (médiane −3,6 %, au mieux −12 %), soit 2,1 s gagnées sur un aller médian de 50 s ; pierre : aucun gisement à portée ; jardin : 0 % (1 parcelle), −1,4 % (4), −1,1 % (8). Loin du plafond de 30 % du §8.6.

**Mesures ciblées** (même protocole qu'au §12, copie de la base de dev) : présentation de Bressuire après une retouche distante **1 326 ms → 952 ms** (réseau 870 → 553 ms) ; aperçu d'exploitation, appels suivants p50 1 / 4 / 8 parcelles 83 / 83 / 92 → 92 / 96 / 109 ms. La présentation à froid (3 684 ms) n'est pas comparable : le passage du §12 avait laissé dans `village_travel_networks` le réseau de l'état retouché ; `bench-navigation.ts` relit désormais la présentation après avoir rétabli le sommet.

**Régression trouvée et corrigée.** Le premier passage de charge après T1 montrait un calcul de réseau de présentation à 3,4 s au p95 à 10 bots (0,74 s au §12). Cause : sans aucune route, le témoin de `planRoute` interrogeait quand même la recherche de routes à chaque huitième de chaque arête dès qu'il y avait des jardins, et `pathCost` parcourait les chemins au huitième. Correctif : aucune recherche de routes sans case de route dans le contexte ; meilleur candidat comparé à son coût mémorisé ; planificateur mondial sans échantillonnage hors des cases de route.

**Charge locale : l'environnement a dérivé depuis le §12.** Après le correctif, un passage sur 30 villages neufs s'arrête dès 10 bots (commandes p95 12,5 s, présentation p95 4,5 s, dont réseau 1,7 s). Pour départager code et environnement, le code d'avant T1 (`0ad26f8`, worktree temporaire) a été relancé juste après, dans les mêmes conditions : il s'arrête aussi à 10 bots (commandes p95 6,9 s, présentation p95 4,4 s, réseau 1,05 s). La phase `snapshot`, que T1 ne touche pas, passe de 0,25 s (§12) à plus de 2 s dans les deux cas : la base de charge, après plusieurs provisionnements et nettoyages, et la machine ne sont plus dans l'état du §12. Conclusion : **pas de régression visible au niveau des commandes**. Le calcul de réseau reste un peu plus cher qu'avant T1 sur un seul passage bruité (1,7 s contre 1,05 s) : point à remesurer sur une base de charge neuve, avec plusieurs passages.

**Reste** : mesure navigateur sur un poste au repos ; recette de Tristan (villageois plus rapides sur les routes, durées affichées) ; remesure de la charge sur une base neuve.

## 14. T2a livrée (11 novembre) : tournée de jardin par jambes

Statut : **à valider** (recette de Tristan sur le dev local). T2b (issues explicites §4.2, décisions §8.7 et §8.8) suit.

**Code.**
- `planVillageLeg(state, from, to)` (`contracts/src/travel-paths.ts`) : une recherche fine bornée, depuis les portes de l'hôtel de ville (`from` nul) ou depuis un point. Les jardins de départ et d'arrivée sont traversés sans surcoût ; tout autre jardin coûte `GARDEN_CROSSING_COST` par pas. `refineTravelRoute` reçoit pour cela deux options, `from` et `gardens`.
- `gardenTourLegs` et `planGardenTourByLegs` (`garden-tour.ts`) : au plus k + 1 recherches. Les parcelles sélectionnées qui partagent un côté sont reliées directement, sans recherche. Le retour reprend, à l'envers, la jambe de l'hôtel de ville vers la dernière parcelle. Ordre de visite et règle « jambes + 60 s par arrêt » inchangés.
- Les jambes d'une tournée partent en un seul job sur la voie de commande du worker de navigation (`commandVillageLegs`, `legs` dans `NetworkJob`).
- `readInfrastructureSpatialState` ne construit plus de réseau. Ses paramètres sans appelant (`plan`, `routes`, `stroke`) sont retirés.
- `planGardenTour` (sur les `travelRoutes`) ne sert plus qu'aux tests, aux fixtures et à `bench-durations.ts`. Il partira avec T4.

**Preuves.**
- Compteur en test : aucun appel à `buildTravelNetwork` pendant `prepareExploitation`, sur les trois cas de `exploitation-gardens.integration.test.ts`. Même sélection retenue, mêmes refus, même ordre de visite que l'ancienne préparation.
- Jambes calculées par le worker identiques à la recherche en ligne ; jambe vers une case enclavée rendue vide, sans erreur (`network-compute.test.ts`).
- Tests purs des jambes, de la couture du tore et de la traversée des jardins (`garden-tour.test.ts`).

**Écarts de durée** (fixture des tests d'intégration, avant → après) :
- A → centre du jardin G, 5 cases au sud : 11 s → 5 s. La jambe va droit au lieu de suivre les arêtes du réseau.
- T → A : 35 s → 17 s, puis A → centre de G : 27 s → 5 s. L'ancien graphe repassait par les routes de l'hôtel de ville.
- Hôtel de ville → centre de G : 19,6 s → 17,6 s. La recherche n'est plus guidée par le témoin grossier du réseau.
- Tournées entières : 305 → 295 s, 99 → 95 s et 289 → 245 s.

Les tournées raccourcissent, surtout entre parcelles éloignées de l'hôtel de ville. C'est une conséquence directe du §4.1, à juger à la recette.

**Mesures ciblées** (`bench-navigation.ts`, copie de la base de dev `arbestra_rc1_load`, API dédiée sur 3301, serveur de dev actif, donc bruité ; trois passages avant, trois après). Bressuire, aperçu d'exploitation :

| | Avant | Après |
|---|---|---|
| Premier appel après une retouche distante, à chaud (passages 2 et 3) | 278 et 2 118 ms, dont navigation 129 et 859 ms | 82 à 109 ms, dont navigation 25 à 80 ms |
| Appels suivants, p50 (1, 4 et 8 parcelles) | 157 à 161, 160 à 170 et 167 à 174 ms | 69 à 85, 89 à 97 et 92 à 99 ms |

Le premier passage après un redémarrage de l'API reste dominé par la construction à froid du sol dans le worker : 1 886 ms avant, 778 ms après. Fichiers : `out/bench-navigation-2026-11-11T16-*.json`, non versionnés.

**Reste à mesurer** : la charge locale (10 et 30 bots) avant et après, sur une base de charge neuve, avec T2b.

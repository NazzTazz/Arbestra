# Infrastructure à la case, ancrages et places — 30 octobre 2026

Statut : **spécification en cours**. S1 (serveur et contrats des cases de route) livré le 30 octobre, **à valider** (§4.5) ; S2b (client : outil de pose par case, rendu inféré) livré le 30 octobre, rendu remplacé en S2c par des thin instances de tuiles, **à valider** (§4.6) ; S2a (case nommée deux fois dédoublonnée, routes qui attirent les trajets) livré le 30 octobre, **à valider** (§4.7) ; le reste n'est pas implémenté. Statuts : **validé** (décision de Tristan), **proposé** (recommandation à confirmer), **ouvert**, **hors périmètre**.

Remplace, pour la pose des routes, la géométrie en sous-cases de [SPEC-INFRASTRUCTURE-VOIRIE-ATELIER.md](SPEC-INFRASTRUCTURE-VOIRIE-ATELIER.md) §3. Liée à [SPEC-TRANSPORT-ATTELE-ROUTES-USURE.md](SPEC-TRANSPORT-ATTELE-ROUTES-USURE.md) (routes charretières de deux cases, usure par case), [SPEC-DEMOLITION.md](SPEC-DEMOLITION.md) et [DECISIONS-DEMOLITION-2026-10-30.md](DECISIONS-DEMOLITION-2026-10-30.md).

## 1. Constat

L'infrastructure est aujourd'hui globalement inutilisable en jeu. La subdivision 8 × 8 d'une case (64 sous-cases) sert deux usages qui ont été confondus : la **largeur** d'une voie et son **placement**. Le joueur trace des traits au 1/8 de case, avec une largeur de 2 à 8 subdivisions ; les angles, croisements et raccords deviennent difficiles à réussir.

## 2. Décisions de Tristan (30 octobre, validées)

1. **La case est l'unité de placement.** Le joueur désigne des cases ; la route est centrée dans sa case. La subdivision reste un outil de conception (factory, rendu), pas de placement en jeu.
2. **Coudes, T et croisements sont inférés** des cases voisines. La pose est simplifiée : l'unité « dessinatrice » est la case.
3. **La largeur reste nécessaire** : les routes commerciales (attelages) font **deux cases** de large. Trottoirs oui/non, et plusieurs revêtements décoratifs.
4. **Les routes manuelles existantes en alpha sont converties** en routes centrées.
5. **Braseros et accessoires** : soit un placement fin conservé au 1/64, soit des **points d'ancrage d'accessoires** (comme dans les Sims), des emplacements prévus pour recevoir braseros, buissons, etc. Voir §5.
6. **Embellissements** conçus en interne avec la factory infrastructure : buisson carré, buisson sphérique, petit tonneau. Ils s'assemblent en **placettes (2 × 2)** et **places (3 × 3)**, achetables dans le HUD Infrastructure.
7. **À terme**, les joueurs assembleront leurs places : taille, revêtement, points d'ancrage, accessoires posés sur ces points.
8. **Effet** : décoratif dans l'immédiat, puis bonheur.
9. **Prix** : fixe et abordable.
10. **Passage** : les villageois traversent une place ; son prix est supérieur ou égal à celui d'une route équivalente.

## 3. Existant (lecture du code, 30 octobre)

| Élément | Code | Conséquence |
|---|---|---|
| Plan de voirie | `packages/contracts/src/infrastructure.ts:14-49` : `RoadStroke` (2 ou 3 `SubPoint` au 1/8 de case, `width` 2 à 8, `material`, `border`, `operation` paint/border/remove), `InfrastructureEquipment` (x, y au 1/8, `quarterTurns`, `version`), `manualLighting`, `suppressedBraziers`, `stoneReserve` (réserve au 1/256), `inheritedRoads`/`inheritedCells` | Tout le modèle est en traits et sous-cases. Il est remplacé par des cases. |
| Persistance | migration `028_infrastructure.ts` : un document JSONB par village | Conversion à prévoir (§7). |
| Routes automatiques | `automaticRoadStrokes()` (`infrastructure.ts:246`), trajets en cases entières (`travel-paths.ts`), profil terre largeur 4 | Déjà centrées sur des cases : elles entrent naturellement dans le nouveau modèle. |
| Braseros automatiques | `automaticBraziers()` (`automatic-braziers.ts:18`), déduits des angles rentrants | À reporter sur des ancrages (§5). |
| Navigation | `infrastructure-navigation`, `chunk-navigation-mesh` : surface de voirie rasterisée au 1/8 | Une case de route devient une case préférée du réseau : plus simple et moins coûteux. |
| Factory infrastructure | `apps/world-web/src/scene/infrastructure-factory.ts` : recettes `straight`, `elbow`, `t`, `crossing`, `door`, `brazier`, avec matériau, largeur, bordure, rotation | Ce sont déjà les tuiles du rendu inféré. Base des embellissements et des places. |
| Coûts | 4 pierres par case de surface en pierre, 1 pierre par côté de bordure, terre et gravats gratuits | Barème réutilisable par case. |
| Usure (proposée) | `road_wear` par case (`SPEC-TRANSPORT-ATTELE-ROUTES-USURE.md` §4.4) | Cohérent avec un modèle par case. |

## 4. Routes à la case

### 4.1 Modèle (proposé)

- Une **case de route** porte : coordonnées canoniques sur le tore, revêtement, trottoirs oui/non, gabarit.
- **Gabarit** :
  - `chemin` : une case de large, chaussée centrée (largeur de rendu fixée par le revêtement et les trottoirs, en subdivisions, sans choix du joueur) ;
  - `charretière` : deux cases de large. **Proposé** : posée avec un pinceau de 2 × 2 cases ; deux cases charretières voisines forment une seule chaussée. Deux chemins parallèles voisins restent deux chemins distincts. Implémentée **après** le chemin, avec les attelages.
- Persistance **validée** (30 octobre) : une table additive `road_cells (world_id, village_id, cell_x, cell_y, surface, sidewalks, gauge, revision)` au lieu du document JSONB. Elle publie dans le journal V2 par case, se joint à `road_wear`, et borne naturellement lectures et commandes.

### 4.2 Pose

- Outil Voirie : appui, glissé, relâché. Les cases sous le pointeur sont interpolées sur le tore, en 4-connexité pour éviter les trous en diagonale. Un appui sans glisser pose une case.
- Le style choisi dans la palette (revêtement, trottoirs) s'applique aux cases posées. Reposer sur une case existante change son style (devis de la différence).
- « Pas de route » retire des cases, avec le même geste.
- Une seule commande V2 par geste : liste bornée de cases, devis attendu, `commandId` idempotent, lectures bornées, sans `state()`.

### 4.3 Rendu inféré

- Pour chaque case, les 4 voisines (routes manuelles, automatiques, accès de bâtiments) déterminent la tuile : bout, droit, coude, T, croisement.
- Les tuiles viennent de la factory infrastructure (§3). Le rendu reste par chunk, mis à jour seulement pour les cases changées et leurs voisines.

### 4.4 Tranché le 30 octobre

- **O1 — Raccord entre revêtements différents** sur deux cases voisines : **jointure franche** (validé).
- **O2 — Routes automatiques** : elles deviennent des **cases de chemin en terre** comme les autres (validé).
- **O3 — Réserve de pierre au 1/256** : **supprimée**, barème entier par case ; le reliquat actuel est rendu en pierre lors de la conversion (validé).
- **Barème et changement de style** (validé le 30 octobre, règle par défaut de tout le jeu, démolition comprise) : surface en pierre (`stone-1`, `stone-2`) 4 pierres par case, trottoirs 1 pierre par côté (2 par case), terre et gravats gratuits. Reposer un style **plus cher** fait payer la **différence** ; un style moins cher et un retrait **ne remboursent rien**. Exemple : pierre-1 → pierre-2 sans trottoirs, 0 ; terre → pierre avec trottoirs, 6.

### 4.5 Livré en S1 (30 octobre) — à valider

Serveur et contrats seulement ; aucun client (S2), aucune conversion (S3).
- **Table** `road_cells` (migration 073) : clé `(world_id, cell_x, cell_y)` — une case n'a qu'un propriétaire dans le monde —, `village_id` (cascade avec le village), `surface`, `sidewalks`, `gauge` (`chemin` ; `charretiere` accepté par la colonne mais refusé par la commande, `GAUGE_UNAVAILABLE`), `revision` (+1 à chaque changement de style). Reçus `road_cell_receipts`. Déclencheur V2 : l'écrivain privé générique de 053, composant `roadCells`, clé `x,y` ; lecteur borné (snapshot, delta, pages de 4 096) et application dans `villageStateFromSyncV2` (`VillageState.roadCells`, absent de la lecture historique).
- **Commandes** : `POST …/road-cells` (V2 seulement) `{ commandId, action: 'place', cells, style: { surface, sidewalks, gauge? }, expectedQuote: { stone } }` ou `{ commandId, action: 'remove', cells }` ; au plus **256 cases par geste** (proposé). `POST …/road-cells/preview` : même corps sans identifiant ni devis, projection en lecture seule. Reçu compact `{ placed, restyled, removed, unchanged, stone }` et effets V2. Idempotente par `commandId` (contenu canonique ; un même identifiant avec une autre demande : `COMMAND_REUSED`) ; un rejeu exact répond depuis son reçu sans verrou ni publication.
- **Ordre** : `beginVillageEconomy()` (village, puis verrou exclusif de navigation du monde, comme toute écriture d'infrastructure), lectures bornées aux cases nommées et à la fenêtre de terrain du village (jamais `state()`), refus avant toute écriture, débit, cases, reçu, publication.
- **Règles reprises de la voirie manuelle** : périmètre historique de ±32 cases autour de l'ancre (`OUTSIDE_INFRASTRUCTURE_REACH`), emprise de bâtiment de tout village ou gisement bloquant (`CELL_OCCUPIED`), prairie et, sur RC1, case entière sans eau, roche ni arbre (`INCOMPATIBLE_TERRAIN` ; plus strict qu'un trait au 1/16, une route centrée occupe sa case), case d'un autre village (`FOREIGN_INFRASTRUCTURE`), pierre insuffisante, devis périmé (`QUOTE_CHANGED`). Un retrait ne vérifie que la propriété ; une case sans route est « inchangée ». **Non repris** : collisions avec les braseros de l'ancien plan et avec les traits d'un autre village (S3/S4).
- **Construction** : une case de route de n'importe quel village refuse un bâtiment (`INFRASTRUCTURE_OCCUPIED`), dans `placeBuilding` et `assertNoInfrastructure` (agrandissements, expéditions), sous le même verrou de monde.
- **Navigation, deux sources** : `readNavigationInfrastructure` ajoute au plan fusionné (ancien JSONB du village et des voisins à moins de 64 cases) le champ `roadCells` des mêmes villages ; `infrastructurePlanSurface` dessine chaque case **par-dessus** la surface des traits comme un chemin centré (carré central d'une demi-case, bras vers chaque case de route voisine) en pixels manuels. Les pixels manuels coûtent ×0,7 dans la recherche fine, exactement comme une route manuelle ; en S1 la recherche grossière les ignorait (une route n'attirait un trajet que lorsque la recherche fine sortait du couloir grossier) ; corrigé en S2a (§4.7). Les clés de cache (réseau, raffinement) et l'empreinte du réseau persistant incluent les cases ; sans aucune case, le plan et toutes les empreintes sont identiques à avant, d'où `TRAVEL_NETWORK_VERSION` inchangé en S1 (`network-3` en S2a). Les cases ne sont pas copiées dans le plan JSONB et l'ancien plan continue d'alimenter rendu et navigation jusqu'à S3.
- **Proposé, à confirmer** : borne de 256 cases par geste. Une case nommée deux fois n'est plus refusée (§4.7).

### 4.6 Livré en S2b, le client (30 octobre) — à valider

- **Palette** (HUD Infrastructure, famille Voirie ; la famille Trottoirs disparaît, Éclairage est inchangé) : Pas de route, Terre (terre battue ou gravats), Petite Pierre, Grands Pavés, chacun sans ou avec trottoirs, coût par case affiché. Ni largeur ni subdivision à choisir ; l'ancien outil de traits au 1/8 n'est plus proposé (son code serveur reste).
- **Geste** (`ui/road-cell-gesture.ts`) : appui, glissé, relâché ; les cases sous le pointeur sont interpolées sur le tore en **4-connexité** (`sweptCells4`, deux cases successives partagent un côté), au plus 64 cases par échantillon de pointeur (une passe suivante rattrape), au plus 256 par geste, sans doublon. Un appui sans glisser pose une case. Clic droit ou Échap annule le geste en cours : rien n'est envoyé.
- **Aperçu** : une instance par case désignée (`scene/road-cell-preview.ts` : bleu pose, orange retrait, rouge refus), ajoutée une fois. Devis `/road-cells/preview` coalescé : 120 ms de calme, une requête à la fois, toujours les dernières cases. Débit en pierres affiché près du pointeur.
- **Relâché** : une seule commande V2 (`commandId`, `expectedQuote` du devis des cases exactes ; « Pas de route » envoie un retrait sans devis). Les effets V2 de la confirmation mettent à jour la session (`roadCells`) ; aucune relecture `GET /village`. Refus métier : message affiché, rien n'est posé ; issue incertaine (réseau, 5xx) : « Vérifier la même commande » rejoue le même identifiant.
- **Choix d'UX pris au plus simple** : une case refusée au milieu d'un glissé faisait refuser tout le geste ; **remplacé en S2d** (§4.8) par la décision de Tristan : les cases interdites sont sautées. Pas de surbrillance de la case survolée hors geste.
- **Rendu (S2b, remplacé en S2c)** : un `InfrastructureRenderer` dédié aux cases régénérait les secteurs touchés (8 × 8 cases terre/gravats, 4 × 4 pierre) ; une pose acceptée coûtait 140 à 204 ms (terre, gravats) et 1,8 s (première pierre avec trottoirs) dans le navigateur, au-delà du budget de 100 ms.
- **Rendu (S2c, 30 octobre)** : thin instances de tuiles (`scene/road-cell-tiles.ts`). Une tuile par forme (case isolée, bout, droit, coude, T, croisement) × revêtement × trottoirs, construite paresseusement à sa première utilisation pour **une case canonique** avec les recettes de l'ancien rendu (trame `overlayRoadCells`, `flatRoadGeometry` pour terre et gravats, maçonnerie `masonryPieces` et bordures `curbStonePiece`, extraites telles quelles d'`infrastructure-renderer.ts`) ; les voisines sont présentes pendant la génération (bras ouverts, trottoirs qui tournent les angles), seule la géométrie de la case est gardée ; matériaux partagés. Une case = une instance de la tuile inférée de ses 4 voisines (`roadTileFor`), tournée par quarts de tour, **cisaillée sur le plan moyen** du terrain de la case (pentes par les 4 coins, relevée pour qu'aucun point échantillonné — coins, milieux, centre — ne dépasse, plus 2 cm de garde : sans elle, le terrain perçait les pavés en pierre, posés à 3 mm du sol). Hors RC1 : à plat à la hauteur de la case. Une pose ou un retrait réécrit seulement les instances de la case et de ses 4 voisines (retrait par échange avec la dernière instance) ; une publication de terrain ne replanifie que les cases dont l'identité de sol a changé ; un rebasage déplace les instances sans géométrie. Une fois un style dessiné, ses autres formes sont préparées une par tâche (50 ms d'écart) pour qu'un geste suivant ne construise rien. L'ancien plan (traits au 1/8, routes automatiques) garde son rendu.
- **Performance (S2c)** : banc Node (`NullEngine`, 20 cases puis une de plus qui crée un T, ancien et nouveau rendu dans le même processus, machine chargée) — S2b / S2c avec tuile T neuve / S2c tuiles prêtes : terre 97–107 / 8–37 / 0,5–0,8 ms ; gravats 64–132 / 7–8 / 0,6–0,9 ms ; petite pierre 55–95 / 9–42 / 0,3–1,2 ms ; petite pierre + trottoirs 450–554 / 48–93 / 0,3–0,9 ms ; grands pavés 29–47 / 1–3 / 0,1–0,2 ms ; grands pavés + trottoirs 224–370 / 17–34 / 0,1–0,4 ms. Une tuile coûte 1 à 7 ms sans trottoirs, 13 à 99 ms avec (bordures). Navigateur (dev, Bressuire, machine très chargée) : mise à jour du rendu après acceptation 1,4 à 3,5 ms (pose terre, petite pierre + trottoirs, retrait, restyle en gravats), 12,6 ms pour une première pose en grands pavés (tuiles neuves) ; construction initiale (15 à 20 tuiles, ~30 cases) 416 à 571 ms pendant le chargement. 60 s de jeu avec un retrait et une pose : 803 images, p50 67 ms, p95 133 ms, 124 images > 100 ms et 17 > 200 ms, aussi hors des poses (base déjà au-delà du budget sur cette machine, non attribuable aux tuiles) ; village prêt à chaud 115 s (chargement du terrain dominant ; 62–76 s en S2b, machine moins chargée). **À refaire sur une machine au repos** pour le budget de 100 ms par image.
- **Écarts visuels** (lecture du code et captures de S2c, de nuit ; pas de capture S2b refaite, l'ancien rendu n'étant plus branché) : appareillage des pavés et joints des bordures fixés par tuile (ils dépendaient de la position dans le monde) et tournés avec la tuile ; jointure franche entre revêtements sans muret ; un trottoir s'arrête au bord de sa case (il débordait de 3 subdivisions sur une voisine sans trottoir) ; surface plane par case au lieu de suivre le relief sommet par sommet : sur forte pente, petites marches possibles entre cases, non constatées sur Bressuire (pas de pente marquée vérifiée).
- **Limites** : deux lignes parallèles voisines se relient case à case (treillis), puisque l'inférence relie toute case de route à ses 4 voisines (§4.1 voulait deux chemins distincts) ; l'inférence ne voit que les cases de route (pas les routes automatiques ni les accès de bâtiments) ; une case posée sur un ancien trait le recouvre sans raccord (jusqu'à la conversion S3) ; trottoirs des cases et des anciens traits calculés séparément ; l'outil Détruire ne désigne pas encore les cases ; sur un monde non RC1, le sol sous une case n'est pas recoloré.

### 4.7 Livré en S2a (30 octobre) — à valider

Décisions de Tristan du 30 octobre : une case désignée deux fois dans le même geste est **dédoublonnée**, pas refusée ; **les routes attirent les villageois** et les détournent des lignes de désir.
- **Dédoublonnage** : `uniqueRoadCells` (contrats) garde chaque case une fois, dans l'ordre du geste. Commande, aperçu et contenu canonique d'un `commandId` l'utilisent : le même identifiant avec la case nommée une fois est un rejeu. `INVALID_CELLS` disparaît.
- **Attraction** : la recherche grossière (`buildTravelNetwork`) compte une arête de route à `ROAD_STEP_COST` = 0,7, comme un pas routé ou guidé de la recherche fine et comme une piste partagée. Une arête est une route quand le segment entre les deux centres de case est entièrement en pixels manuels : deux cases de route voisines, et aussi les traits manuels et hérités de l'ancien plan qui suivent les centres de case (lecture du code : la recherche fine les traitait déjà comme des routes). Calcul une fois par réseau, linéaire dans les pixels manuels ; une recherche paie une consultation par pas. Le trajet grossier suit la route, devient le guide, et le raffinement le suit. Une route à k cases de côté coûte 2k pas de détour et économise 0,3 par pas suivi : elle attire un trajet qui peut la suivre sur plus d'environ 7k cases (1 : 7, 2 : 14, 3 : 20, 4 : 27) ; à 5 cases ou plus, le détour dépasse la borne grossière (+8 pas) et rien ne change. Durées inchangées : elles suivent la longueur réelle (D3). **Réglage** (défaut, à confirmer par Tristan) : `ROAD_STEP_COST` dans `travel-paths.ts`, réglable entre 0,7 et 1 ; en dessous de 0,7, toutes les bornes basses A* du fichier (0,7 par pas) devraient suivre.
- **Non couvert** : le témoin `planRoute` des ressources lointaines (`direct > 16`) et la recherche d'un chantier local (`stoneTravelPath`, sans réseau grossier) ignorent toujours l'attraction grossière ; seule la recherche fine y applique ×0,7 aux routes.
- **Version** : `TRAVEL_NETWORK_VERSION` passe à `network-3` ; chaque village recalcule son réseau persistant à la lecture suivante. Sans aucune route, trajets, nœuds visités et clés de cache sont identiques à avant (seul le numéro de version de l'empreinte persistante change).
- **Preuves** : contrats `road-cells.test` (10) : route parallèle à 2, 3 et 4 cases (des deux côtés) qui attire le trajet vers une maison et vers un rocher, rouge avec l'ancien coût (0 % du trajet sur la route) ; route à 5 cases ou plus sans effet (trajet identique) ; parité exacte sans route (empreintes des trajets capturées sur `69bb451`, raffiné et grossier) ; borne des nœuds visités sur une grille dense de routes (22 170, contre 25 060 quand la recherche grossière ignorait les routes, 6 416 sans route, inchangé). API `road-cells.integration` : case nommée deux fois comptée une fois (devis, commande, rejeu, retrait).
- **Mesure** (Bressuire, entrée capturée en lecture seule sur la base de dev, ancien et nouveau planificateur dans le même processus, machine chargée : API de dev et autre agent actifs) : 49 traits manuels, 18 hérités, 157 centres de case routés. Réseau actuel : trajets modifiés (empreinte `cbb7d1a1…` → `c3b9c6bc…`), 105 trajets, longueur totale 2 417 → 2 424 cases, nœuds visités 36 568 → 37 987 (+3,9 %) ; à froid 10,7 / 6,3 / 5,5 / 6,8 s avant, 6,4 / 7,5 / 6,2 / 1,2 s après (bruit dominant) ; à chaud (cache en mémoire) 66 à 420 ms des deux côtés. Sans route : empreinte `794ffe56…` et 20 357 nœuds des deux côtés. 200 cases synthétiques : 44 897 → 45 323 nœuds. Recherches fines des cases 216,213 et 229,220 (`refineTravelRoute` non modifié) : 37 264 et 33 118 nœuds avant comme après ; durées 5,8 à 13,5 s selon la charge, la tranche trajets en attente n'est ni aggravée ni corrigée.

### 4.8 Livré en S2d (30 octobre) — à valider

Décision de Tristan du 30 octobre : une case interdite au milieu d'un geste de pose **ne fait plus refuser tout le geste** ; les cases valides sont posées, les interdites sautées et montrées en rouge. Remplace le choix d'UX de §4.6.
- **Option retenue : la commande saute elle-même les cases interdites** (pas de course entre aperçu et commande). Refus par case, première règle qui s'applique : hors périmètre (`OUTSIDE_INFRASTRUCTURE_REACH`), case d'un autre village (`FOREIGN_INFRASTRUCTURE`), emprise de bâtiment ou gisement bloquant (`CELL_OCCUPIED`), terrain (`INCOMPATIBLE_TERRAIN`). Le devis, le débit et `expectedQuote` portent sur les cases réellement posées ; le reçu ajoute `skipped: [{ cellX, cellY, code }]` (ordre du geste, au plus 256, absent si rien n'est sauté). Une case devenue interdite entre l'aperçu et la commande est sautée ; le geste ne passe que si le devis des cases restantes est inchangé (sinon `QUOTE_CHANGED`, comme avant).
- **Restent des refus du geste entier** : toutes les cases interdites (motif de la première, l'aperçu liste quand même les cases), pierre insuffisante, devis périmé, gabarit indisponible, identifiant réutilisé, coordonnées non canoniques (400). **Retrait inchangé** : une case hors périmètre ou d'un autre village refuse encore tout le retrait.
- **Idempotence** : inchangée, par `commandId` sur la demande canonique (cases dédoublonnées) ; un rejeu renvoie le reçu avec ses cases sautées. Les anciens reçus, sans `skipped`, restent valides. Seules les cases posées sont publiées en V2.
- **Client** : l'aperçu colore en rouge les cases sautées (`RoadCellPreview` : l'instance de la case est masquée dans le maillage du geste et ajoutée une fois à un maillage rouge, O(1) par case nouvellement refusée) ; le débit affiché est celui des cases valides ; pendant le glissé « N cases · M sautées (motif) » ; après la pose « N cases posées · M sautées (motif principal) · −X ◆ » (motif le plus fréquent, le premier en cas d'égalité). Un aperçu sans aucune case valide reste rouge en entier et rien n'est envoyé.
- **Preuves** : API `road-cells.integration` (7) : geste mixte (4 cases libres, une sous l'hôtel de ville, une sur un gisement) → 4 cases posées, 16 pierres débitées, reçu listant les 2 sautées, journal et effets V2 des 4 seules cases, rejeu idempotent sans écriture, geste entièrement interdit refusé sans écriture (`CELL_OCCUPIED`, l'aperçu liste aussi la case hors périmètre) ; **rouge sur l'ancien code** (aperçu `valid: false`, aucune case). Client : `road-cell-gesture.test` (aperçu partiel, cases rouges signalées une fois, commande envoyée avec toutes les cases, message, motif principal), `road-cell-preview.test` (case refusée déplacée une fois vers le maillage rouge). Navigateur (dev, Bressuire) : ligne de 5 cases de Petite Pierre à travers une maison, case de la maison en rouge, débit −16 affiché, puis « 4 cases posées · 1 sautée (bâtiment ou gisement) · −16 ◆ ».

## 5. Braseros et accessoires

**Validé (30 octobre) : des points d'ancrage**, plutôt que le placement fin au 1/64.
- Un ancrage est un emplacement nommé d'une tuile : par exemple les deux côtés de trottoir d'une case de chemin, les coins et le centre d'une case de place.
- Un accessoire (brasero, buisson, tonneau) occupe un ancrage. Il se pose d'un clic sur un ancrage libre, mis en évidence pendant l'outil.
- Les braseros automatiques deviennent des accessoires automatiques sur les ancrages des angles rentrants. La démolition les supprime (décision du 30 octobre).
- Avantages : pose facile, cohérente avec les futures places des joueurs (décision 7), aucune géométrie fine à valider côté serveur, rendu par instances.
- **Ouvert — O4** : liste exacte des ancrages par tuile (chemin, coude, croisement, case de place).

## 6. Embellissements et places

- **Éléments** (conception interne, factory) : buisson carré, buisson sphérique, petit tonneau, puis le brasero existant. Ils sont décoratifs, rendus par instances, sans entité persistante individuelle hors de leur ancrage.
- **Modèles de place**, conçus dans la factory : placette 2 × 2 et place 3 × 3, chacune avec un revêtement, des ancrages et des accessoires posés. Catalogue fixe dans cette tranche.
- **Achat** : HUD Infrastructure, famille Places ; placement à la case avec rotation R ; prix fixe et abordable (montants **ouverts**, O5), au moins égal à celui de la surface de route équivalente.
- **Passage** : une case de place est traversable et préférée comme une route.
- **Effet** : aucun dans cette tranche. Le bonheur viendra plus tard.
- **Hors périmètre** : éditeur de places pour les joueurs (décision 7, à terme), bonheur.

## 7. Conversion des routes existantes (alpha)

- **Proposé** : toute case dont la chaussée d'un trait manuel couvre le centre, ou au moins la moitié de la surface, devient une case de chemin. Revêtement et trottoirs repris du trait le plus récent. Les traits `remove` sont appliqués avant.
- Équipements manuels : brasero déplacé vers l'ancrage libre le plus proche de sa case ; sinon supprimé et compté.
- Aucune pierre facturée ni rendue, sauf la réserve au 1/256 (O3).
- Comme pour le bois : comptage en lecture seule sur alpha (avec accord), répétition sur une copie, puis conversion pendant la maintenance.

## 8. Effets sur les autres tranches

- **Démolition** : les routes se retirent par case et les accessoires par ancrage, ce qui simplifie §5.3 et §5.4 de la spec de démolition.
- **5c (voirie sans `state()`)** : abandonnée le 30 octobre. Ses changements sont dans un stash git (`5c abandonnee…`). Les nouvelles commandes naissent en V2.
- **Navigation et trajets** : la surface de voirie au 1/8 disparaît du réseau, remplacée par des cases préférées.
- **Attelages** : le gabarit charretière vient avec eux.

## 9. Découpage proposé (sous-tranches d'environ 1 h à 1 h 30)

1. **S1** — Contrats et serveur des cases de route : table, commande V2 de pose et de retrait, devis, navigation par case, publication V2.
2. **S2** — Client : outil de pose par case, rendu inféré par tuiles.
3. **S3** — Conversion des routes alpha : outil, répétition sur une copie.
4. **S4** — Ancrages et accessoires : braseros automatiques et manuels.
5. **S5** — Factory : buissons et tonneau, modèles de placette et de place.
6. **S6** — Achat et pose des places dans le HUD.

Démolition serveur après S4 ; nivellement (5b) ensuite.

## 10. Vérifications attendues

- Parité de navigation sur des réseaux de test : cases préférées, coût des trajets, aucune régression sur Bressuire (mesure des recherches fines).
- Commandes : idempotence, refus sans écriture, devis, concurrence avec une construction sur la même case (barrières forcées).
- Conversion : comptes avant/après sur une copie, aucune case de route perdue sous un bâtiment.
- Rendu : mesure navigateur du chargement et du coût par image, avant/après (budgets d'`AGENTS.md`).

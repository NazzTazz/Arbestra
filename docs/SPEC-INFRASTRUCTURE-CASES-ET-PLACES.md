# Infrastructure à la case, ancrages et places — 30 octobre 2026

Statut : **spécification en cours**. S1 (serveur et contrats des cases de route) livré le 30 octobre, **à valider** (§4.5) ; S2b (client : outil de pose par case, rendu inféré) livré le 30 octobre, **à valider** (§4.6) ; le reste n'est pas implémenté. Statuts : **validé** (décision de Tristan), **proposé** (recommandation à confirmer), **ouvert**, **hors périmètre**.

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
- **Navigation, deux sources** : `readNavigationInfrastructure` ajoute au plan fusionné (ancien JSONB du village et des voisins à moins de 64 cases) le champ `roadCells` des mêmes villages ; `infrastructurePlanSurface` dessine chaque case **par-dessus** la surface des traits comme un chemin centré (carré central d'une demi-case, bras vers chaque case de route voisine) en pixels manuels. Les pixels manuels coûtent ×0,7 dans la recherche fine, exactement comme une route manuelle ; la recherche grossière les ignore, comme aujourd'hui (une route n'attire donc un trajet que lorsque la recherche fine décide, par exemple un détour hors du couloir grossier). Les clés de cache (réseau, raffinement) et l'empreinte du réseau persistant incluent les cases ; sans aucune case, le plan et toutes les empreintes sont identiques à avant, d'où `TRAVEL_NETWORK_VERSION` inchangé. Les cases ne sont pas copiées dans le plan JSONB et l'ancien plan continue d'alimenter rendu et navigation jusqu'à S3.
- **Proposé, à confirmer** : borne de 256 cases par geste ; refus d'une case nommée deux fois (`INVALID_CELLS`).

### 4.6 Livré en S2b, le client (30 octobre) — à valider

- **Palette** (HUD Infrastructure, famille Voirie ; la famille Trottoirs disparaît, Éclairage est inchangé) : Pas de route, Terre (terre battue ou gravats), Petite Pierre, Grands Pavés, chacun sans ou avec trottoirs, coût par case affiché. Ni largeur ni subdivision à choisir ; l'ancien outil de traits au 1/8 n'est plus proposé (son code serveur reste).
- **Geste** (`ui/road-cell-gesture.ts`) : appui, glissé, relâché ; les cases sous le pointeur sont interpolées sur le tore en **4-connexité** (`sweptCells4`, deux cases successives partagent un côté), au plus 64 cases par échantillon de pointeur (une passe suivante rattrape), au plus 256 par geste, sans doublon. Un appui sans glisser pose une case. Clic droit ou Échap annule le geste en cours : rien n'est envoyé.
- **Aperçu** : une instance par case désignée (`scene/road-cell-preview.ts` : bleu pose, orange retrait, rouge refus), ajoutée une fois. Devis `/road-cells/preview` coalescé : 120 ms de calme, une requête à la fois, toujours les dernières cases. Débit en pierres affiché près du pointeur.
- **Relâché** : une seule commande V2 (`commandId`, `expectedQuote` du devis des cases exactes ; « Pas de route » envoie un retrait sans devis). Les effets V2 de la confirmation mettent à jour la session (`roadCells`) ; aucune relecture `GET /village`. Refus métier : message affiché, rien n'est posé ; issue incertaine (réseau, 5xx) : « Vérifier la même commande » rejoue le même identifiant.
- **Choix d'UX pris au plus simple (à confirmer)** : une case refusée au milieu d'un glissé (bâtiment, terrain, autre village) fait refuser **tout le geste**, comme la commande atomique du serveur : aperçu rouge, message du devis, aucune case posée. Pas de surbrillance de la case survolée hors geste.
- **Rendu** : le rendu existant suffit (pas de tuiles de la factory) : `overlayRoadCells` (S1) dessine déjà chemin centré, bout, droit, coude, T et croisement d'après les 4 voisines. Les cases ont **leur propre** `InfrastructureRenderer`, alimenté par un plan vide plus `roadCells` (`scene/road-cells-plan.ts`, identité stable tant que le contenu ne change pas, alors que V2 reconstruit la liste à chaque delta) : une pose ne régénère que les secteurs touchés (8 × 8 cases pour terre et gravats, 4 × 4 pour la pierre) et ne rejoue jamais l'ancien plan de traits.
- **Performance, bloquant avant livraison** : le geste est borné (au plus 64 insertions et 64 instances par échantillon, devis coalescé), mais la mise à jour du rendu **après acceptation** dépasse le budget de 100 ms : navigateur (Bressuire, machine chargée) 140 à 204 ms pour quelques cases de terre ou de gravats, 1,8 s pour la première pose en petite pierre avec trottoirs ; banc Node (`NullEngine`, 20 cases puis une de plus) 328 ms en gravats, 1,3 s en pierre avec trottoirs, dont 14 à 16 ms de surface et 148 ms de trottoirs : le reste est la génération des couches d'`InfrastructureRenderer` (maçonnerie, bordures), déjà payée par l'ancien outil de traits. Piste : générer la case changée et ses voisines seulement (tuiles par case) au lieu du secteur, ou différer la génération hors de l'image.
- **Limites** : deux lignes parallèles voisines se relient case à case (treillis), puisque l'inférence relie toute case de route à ses 4 voisines (§4.1 voulait deux chemins distincts) ; l'inférence ne voit que les cases de route (pas les routes automatiques ni les accès de bâtiments) ; une case posée sur un ancien trait le recouvre sans raccord (jusqu'à la conversion S3) ; trottoirs des cases et des anciens traits calculés séparément ; l'outil Détruire ne désigne pas encore les cases ; sur un monde non RC1, le sol sous une case n'est pas recoloré.

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

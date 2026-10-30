# Infrastructure à la case, ancrages et places — 30 octobre 2026

Statut : **spécification en cours**. Rien n'est implémenté. Statuts : **validé** (décision de Tristan), **proposé** (recommandation à confirmer), **ouvert**, **hors périmètre**.

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
- Persistance **proposée** : une table additive `road_cells (world_id, village_id, cell_x, cell_y, surface, sidewalks, gauge, revision)` au lieu du document JSONB. Elle publie dans le journal V2 par case, se joint à `road_wear`, et borne naturellement lectures et commandes.

### 4.2 Pose

- Outil Voirie : appui, glissé, relâché. Les cases sous le pointeur sont interpolées sur le tore, en 4-connexité pour éviter les trous en diagonale. Un appui sans glisser pose une case.
- Le style choisi dans la palette (revêtement, trottoirs) s'applique aux cases posées. Reposer sur une case existante change son style (devis de la différence).
- « Pas de route » retire des cases, avec le même geste.
- Une seule commande V2 par geste : liste bornée de cases, devis attendu, `commandId` idempotent, lectures bornées, sans `state()`.

### 4.3 Rendu inféré

- Pour chaque case, les 4 voisines (routes manuelles, automatiques, accès de bâtiments) déterminent la tuile : bout, droit, coude, T, croisement.
- Les tuiles viennent de la factory infrastructure (§3). Le rendu reste par chunk, mis à jour seulement pour les cases changées et leurs voisines.

### 4.4 Ouvert

- **O1 — Raccord entre revêtements différents** sur deux cases voisines : jointure franche (proposé) ou transition.
- **O2 — Routes automatiques** : gardent-elles leur profil terre étroit, ou deviennent-elles des cases de chemin en terre comme les autres (proposé) ?
- **O3 — Réserve de pierre au 1/256** : supprimée avec un barème entier par case (proposé), le reliquat actuel étant rendu en pierre lors de la conversion.

## 5. Braseros et accessoires

**Recommandation : des points d'ancrage**, plutôt que le placement fin au 1/64.
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

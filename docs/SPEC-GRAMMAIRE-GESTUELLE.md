# Grammaire gestuelle (essai sur le bois)

Date : 28 octobre 2026. Base : `wip/v2-commandes-bornees`.

Statut : **décisions de Tristan intégrées ; serveur (2c, 2d, 2e) et client (tranche 3, 29 octobre) livrés, à valider** par la recette de Tristan en local ([PLAN-BOIS-ARBRE-TRANCHE-2.md](PLAN-BOIS-ARBRE-TRANCHE-2.md) ; ce qui est livré : §6). Essayée d'abord sur la coupe et le défrichage des arbres, puis à généraliser.

## 1. Décisions (Tristan, 28 octobre)

| Geste | Effet |
|---|---|
| **Toucher** un élément | Cet élément : un arbre, une souche. |
| **Glisser** sur des éléments | Tous les éléments survolés, chacun une fois, dans l'ordre. |
| **Appui long** | Bascule **globale** entre **coupe** et **défrichage**, avec un indicateur visuel du mode courant. |

Autres règles :
- **Coupe** : les arbres mis en file affichent leur bois, comme aujourd'hui.
- **Défrichage** : les arbres et souches mis en file sont **légèrement surlignés en rouge** jusqu'à la fin de l'opération. Le défrichage se fait arbre par arbre et souche par souche.
- **« Annuler »** : un bouton en haut à droite de l'écran, pendant **15 s** après chaque geste. Il retire de la file les arbres et souches de ce geste, pour la récolte comme pour le défrichage. Un arbre déjà entamé n'est pas fini : seul le lot en cours est livré (Tristan, 29 octobre).
- **Habitants** : le geste ne choisit pas d'effectif. Le **panneau Chantier** consomme la file avec ses habitants.
- **Contexte** : les gestes ne s'appliquent **qu'en mode Exploitation**.
- **Plus de confirmation** : la sécurité, c'est l'annulation.

## 2. Geste existant, étendu (pas de nouvel interpréteur)

Le balayage existe déjà pour les jardins et les bosquets (Tristan : inutile de réimplémenter un interpréteur de gestes). En mode Exploitation, `BabylonVillageScene` gère déjà :
- le toucher et le glisser (`#pointerDown.harvest`, `#continueHarvest`) ;
- l'interpolation des cases traversées (`cellsAlongSegment`) ;
- la capture du pointeur et l'annulation (`cancelGesture`, molette) ;
- le rappel `onGardenHarvest(cell, newGesture)` vers l'App.

À ajouter, sans le remplacer :
- **Appui long** : un appui principal qui reste dans une petite zone morte pendant ~450 ms bascule le mode et ne désigne rien. La détection se fait à chaque image, puisqu'un doigt immobile n'envoie aucun événement.
- **Granularité par arbre** : sous le pointeur, l'arbre (instance mince : `featureId` et indice d'arbre) plutôt que sa case. Le rappel transmet l'arbre ; les jardins restent par case.

## 3. Branchement prévu

### Scène (`BabylonVillageScene.ts`)

- Le geste de récolte existant (`#pointerDown.harvest`, `#continueHarvest`) reçoit l'appui long et la désignation par arbre. La caméra garde le clic droit, la molette et les deux doigts.
- **Désignation par arbre** : la sélection lit l'instance mince sous le pointeur (`thinInstanceEnablePicking`, `instanceFeatureIds`) et rend `featureId:treeIndex`. Les souches sont désignables dès que le rendu par arbre existe (2d, tranche 3).
- **Surlignage rouge** : une couleur d'instance (ou un calque) sur les arbres et souches en file pour le défrichage, retirée quand le serveur les annonce faits. Aucun mesh reconstruit par image.
- Les jardins gardent leur récolte actuelle tant que la grammaire n'est pas généralisée.

### Interface (`App.tsx`, `ExploitationPanel.tsx`)

- **Mode global** `cut | clear`, gardé tant qu'on reste en Exploitation ; il revient à la coupe quand on la quitte (Tristan, 29 octobre). La palette ne demande plus ni mode ni groupe d'habitants avant le geste.
- **Indicateur du mode** (proposition, à valider à l'essai) :
  - **en coupe** : HUD normal, curseur hache ;
  - **en défrichage** : liseré et fond du HUD teintés de rouge, curseur arracheur de souche ;
  - à chaque bascule, une courte bulle « Mode défrichage » ou « Mode coupe » près du pointeur, avec une vibration au doigt si l'appareil le permet.
- **« Annuler »** : un bouton fixe en haut à droite, avec un décompte de 15 s, qui vise le **dernier** geste (un nouveau geste remplace le précédent). Il appelle la commande d'annulation de file (2e). Le serveur dit ce qui a été retiré ; un élément déjà pris en charge reste.

### Serveur requis

- **2c** (fait le 29 octobre, à valider) : la commande accepte des arbres désignés (`woodTrees`, contrat dans [PLAN-BOIS-ARBRE-TRANCHE-2.md](PLAN-BOIS-ARBRE-TRANCHE-2.md)).
- **2d** (fait le 29 octobre, à valider) : chaque arbre touché est exposé (`deposit.trees`) ; la file du village se lit dans `worksites[].targets[].treeIndices` et le mode du chantier.
- **2e** (fait le 29 octobre, à valider) : contrat détaillé dans [PLAN-BOIS-ARBRE-TRANCHE-2.md](PLAN-BOIS-ARBRE-TRANCHE-2.md), ligne 2e.
  - **Mise en file** : l'intention de récolte porte `woodMode: 'cut' | 'clear'` (coupe par défaut) avec ses arbres (`woodTrees`). Le défrichage englobe la coupe : un arbre en file pour la coupe et redésigné en défrichage passe en défrichage ; l'inverse n'ajoute rien (`already-assigned`). Le reçu marque `woodMode: 'clear'` sur le bois accepté en défrichage.
  - **Lire la file** : `worksites[].targets[]` du chantier commun du bois (`poolResource: 'wood'`) : `treeIndices` (arbres en file, `null` = toute la case) et `clearTreeIndices` (ceux à défricher ; absent : aucun). Le surlignage rouge suit `clearTreeIndices` tant que la cible est `pending` et l'arbre pas encore retiré (`deposit.trees[].stumpRemoved`).
  - **Annuler** : `POST /api/worlds/:worldSlug/villages/:villageId/harvest-intents/:commandId/cancel`, sans corps, `commandId` = celui du geste. Idempotente : le premier reçu est enregistré et rejoué tel quel. Le reçu liste chaque arbre du geste : `removed`, `in-progress` (un lot du village y travaille : **seul ce lot est livré**, puis l'arbre quitte la file, décision de Tristan du 29 octobre ; le tronc garde son bois restant, en défrichage la souche reste), `queued` (gardé par un autre geste, avec son `mode`), `not-queued` (plus rien à retirer). Un geste pas encore traité est annulé d'avance (`beforeQueue: true`). Seul le bois du geste est annulé (la pierre et les jardins viendront plus tard) ; les gestes mis en file avant la migration 068 ne s'annulent pas ; pas de fenêtre de 15 s côté serveur.
  - **Navigation** : une souche retirée retire son tronc de la navigation, même si la case n'est pas encore défrichée.

## 4. Marqueurs (décidés par Tristan le 28 octobre, après essai de la planche « Cercles de récolte »)

Planche de test : https://claude.ai/artifact/VZQuVL9ZqbkziWom59JryD (dix propositions, avec la grammaire).

- **Récolte** (arbres, pierre, jardins) : **« Onde »** (proposition 5).
  - Au repos : un anneau doux.
  - À la validation : il s'éclaircit et **deux ondes partent vers l'extérieur**, puis s'effacent.
- **Défrichage** : **« Satellites »** (proposition 8).
  - Au repos : un anneau fin et **trois points en orbite**.
  - À la validation : les points plongent au centre et éclatent.
- **Le mode se lit par la forme du marqueur** : une onde, c'est une récolte ; des satellites, c'est un défrichage. Le rouge du défrichage et l'indicateur du HUD restent en complément.
- **« Colonne de lumière »** (proposition 10) : réservée au marché, voir ci-dessous.
- La proposition 1 (anneau épais, `dde67cc`) est remplacée par « Onde » et « Satellites » dans le client (`halo-marker.ts`, greffon de matériau animé par une horloge ; **à valider** en jeu). Le mode `clear` de l'outil bois donne aux halos la forme « Satellites ».

### Colonne de lumière du marché

- **Décision (Tristan, 28 octobre)** : quand une transaction de marché se termine et crédite le village, une colonne de lumière monte au-dessus de **l'hôtel de ville**, avec le « +N » des compteurs. Marché entre joueurs comme marché de l'Oracle. Effet ponctuel, donc embelli d'une vraie lumière.
- **Déclencheur** (`ui/market-deliveries.ts`, même paire d'états que le « +N », dans `applySnapshot`) :
  - livraison Oracle différée : un échange de `market.exchanges` reçoit son `completedAt` ;
  - reprise d'une annonce par l'Oracle : une annonce ouverte et reprenable quitte la liste, son `oracleAt` passé ; une acceptation par un joueur observée en retard se reconnaît au nouveau convoi entrant ;
  - échange entre joueurs, vendeur : le convoi entrant arrive (`arrivesAt` franchi) ;
  - échange entre joueurs, acheteur : notre convoi revient avec la marchandise (`returnsAt` franchi) ;
  - achat direct à l'Oracle (débit et livraison immédiats) : il ne laisse aucune trace dans l'état ; la colonne part au succès de la commande, quand l'état crédité est déjà appliqué.
  - Rien au départ d'un convoi, au premier état, au changement de village ni au rechargement d'un état identique.
  - Limite : les deux franchissements entre joueurs suivent l'heure serveur de l'état. Si un état plus récent arrive avant celui qui crédite (retard du worker), la colonne peut précéder le « +N » de ce retard.
- **Effet** (`scene/market-beacon.ts`, une seule table `MARKET_BEACON` pour les réglages) : colonne or et cœur blanc en mélange additif, bord adouci, 18 étincelles verticales et 30 particules en spirale ascendante (instances minces). Environ 1,9 s : montée 0,24 s, tenue 0,88 s, extinction 0,8 s. Plusieurs livraisons prolongent la même colonne (0,45 s par livraison supplémentaire, quatre au plus).
- **Lumière** : un point lumineux chaud préparé à l'avance dans le cluster des braseros (`clusteredEffectLight`), intensité nulle au repos. Aucune lumière ajoutée, basculée ni recompilée au déclenchement. Elle n'éclaire que lorsque le cluster est allumé, c'est-à-dire la nuit du village. Sans prise en charge du cluster, la colonne reste, sans vraie lumière.
- **Aperçu** : bouton « Tester la colonne de marché » du panneau DEV (section Effets). Banc hors build : `http://localhost:5174/bench/marche.html` (vraie halle-marché, quadrillage de l'atelier, curseur jour/nuit, réglages de la lumière ; clic sur la halle pour déclencher).
- Statut : **à valider** en jeu.

## 5. Ouvert

- **Indicateur du mode** : livré tel que proposé au §3, sans curseur propre (badge, cadre rouge, bulle, vibration). À juger en jeu.
- **Rouge du défrichage** : teinte d'instance `CLEAR_TINT` (`grove-instances.ts`), multipliée aux couleurs du kit ; lisible de jour, discrète de nuit. Intensité à régler par Tristan.
- **« Annuler » sur la pierre et les jardins** : plus tard (validé par Tristan) ; seul le bois d'un geste s'annule.

## 6. Livré (tranche 3, client, 29 octobre) — à valider

**Geste** (`BabylonVillageScene.ts`, `wood-gesture.ts`), sans nouvel interpréteur :
- L'appui de récolte ne désigne plus rien à l'enfoncement. Relâché sans bouger : un toucher ; sorti de la zone morte (8 px) : un glissé ; tenu 450 ms immobile : la bascule (sondée une fois par image, O(1)). La bascule ne s'applique qu'avec l'outil « Bois brut » ; ailleurs l'appui reste un toucher ou un glissé.
- **Toucher** : l'arbre ou la souche sous le pointeur, lu dans l'instance mince touchée (`instanceSlots`, `instanceTrees` des meshes de bosquet). Une souche ou un tronc bas manqués par le rayon : l'arbre rendu dont le pied est le plus proche du point du sol, à 0,15 case au plus (moins de la moitié de l'écart minimal entre deux arbres, 0,2).
- **Glisser** : l'arbre sous le pointeur, puis chaque arbre dont le pied est à 0,15 case au plus du segment parcouru depuis l'échantillon précédent, dans l'ordre rencontré, chacun une fois. Les candidats viennent d'un index des bosquets rendus par case (cases traversées et voisines). Jardins et pierre : les cases traversées, comme avant.
- **Mode** : en coupe, un arbre debout ou abattu dont du bois est libre ; en défrichage, tout arbre ou souche encore là.
- **Envoi** : `woodTrees` (ordre de désignation) et `woodMode: 'clear'` en défrichage, par la file `harvest-intents`. Reçus : `+N` sur la case acceptée (comme avant) ; refus traduits, dont `tree-not-found` (« Arbre introuvable »), `depleted` (« Épuisé »), `already-assigned` (« Déjà prévu »), `cancelled` (« Annulé »).
- **Serveur** : la géométrie RC1 d'un bosquet nomme désormais l'indice RC1 de chaque arbre (`rc1.trees[].index`, contrat additif). Sans lui, le client ne pouvait pas désigner un arbre d'un monde RC1 ; un arbre sans indice (ancien serveur) vaut sa case entière.

**Indicateur** : badge en haut au centre (« Coupe » ou « Défrichage », « appui long pour … »), cadre rouge autour de la vue en défrichage, bulle « Mode coupe » ou « Mode défrichage » près du pointeur à chaque bascule, vibration de 30 ms. Le mode revient à la coupe quand on quitte l'Exploitation (décision de Tristan, 29 octobre) et au rechargement. « Préparer un défrichage » de la fiche choisit aussi le mode.

**Marqueurs** (`tree-halos.ts`, `resource-overlay.ts`) : un halo par arbre (une entrée chacun), « Onde » en coupe, « Satellites » en défrichage ; validation lumineuse de 1,8 s sur le seul arbre désigné. Ne sont plus offerts : en coupe, les arbres en file ; en défrichage, ceux en file pour le défrichage (un arbre en file pour la coupe peut être pris plus loin). Au repos, une image ne parcourt plus les halos (O(1)). Les arbres acceptés restent marqués 6 s, le temps que la file du village les montre.

**File → rendu** (`wood-queue.ts`) : cibles `pending` des chantiers de bois (chantier commun, ou chantier propre en marche), `treeIndices` (null = toute la case), `clearTreeIndices`, mode `clear` d'un chantier. Les arbres et souches en file pour le défrichage sont teintés de rouge jusqu'au retrait de la souche. Un changement de file ne redessine que les bosquets des cases dont la file a changé.

**Rendu par arbre** (`grove-trees.ts`, `grove-instances.ts`) : debout ; abattu = tronc couché de longueur bois restant / 500 (au moins 0,12) à côté de sa souche ; souche ; rien une fois la souche retirée. Plus de jeunes arbres ni de repousse. Trois instances par arbre (tronc, feuillage, souche) ; un arbre qui change réécrit les siennes, avec des envois partiels au GPU ; la signature d'un bosquet ne porte plus que sa géométrie, donc ni un lot ni une réservation ne le reconstruisent. Une pièce sans instance visible (les souches d'un bosquet intact) n'est pas dessinée. Le chantier abat l'arbre que nomme son lot (`extractions[].treeIndex`) ; un retrait de souche n'abat rien.

**Navigation locale** (`grove-trunks.ts`) : les troncs des villageois (test de place des chantiers de bois) viennent d'un index par chunk, relu seulement quand le chunk change (`TerrainStore.featureVersion`), et seuls les bosquets dont les souches retirées ont changé sont replacés. Une souche retirée sort son tronc, comme sur le serveur.

**« Annuler »** (`WoodGestureHud.tsx`, `use-harvest-tool.ts`) : en haut à droite, 15 s de décompte, vise le dernier geste (un nouveau le remplace). Pas encore envoyé : retiré localement ; en cours d'envoi : annulé dès que le serveur l'a ; envoyé : `POST …/cancel`. Le résultat dit les arbres retirés, le lot en cours qui se termine, ceux déjà prévus par un autre geste, ceux déjà faits.

**Fiche du bosquet** : les arbres et leur état (debout, abattu et bois restant, souche, souche retirée) et, pour chacun, s'il est en file pour la coupe ou le défrichage. Plus de repousse. **Panneau Chantier** (carte « Coupe de bois » et fiches des chantiers) : la file en arbres (« N arbres à couper · M à défricher · K bosquets entiers »).

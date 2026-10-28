# Grammaire gestuelle (essai sur le bois)

Date : 28 octobre 2026. Base : `wip/v2-commandes-bornees`.

Statut : **décisions de Tristan intégrées ; branchement en attente des étapes serveur 2c, 2d et 2e** ([PLAN-BOIS-ARBRE-TRANCHE-2.md](PLAN-BOIS-ARBRE-TRANCHE-2.md)). Essayée d'abord sur la coupe et le défrichage des arbres, puis à généraliser.

## 1. Décisions (Tristan, 28 octobre)

| Geste | Effet |
|---|---|
| **Toucher** un élément | Cet élément : un arbre, une souche. |
| **Glisser** sur des éléments | Tous les éléments survolés, chacun une fois, dans l'ordre. |
| **Appui long** | Bascule **globale** entre **coupe** et **défrichage**, avec un indicateur visuel du mode courant. |

Autres règles :
- **Coupe** : les arbres mis en file affichent leur bois, comme aujourd'hui.
- **Défrichage** : les arbres et souches mis en file sont **légèrement surlignés en rouge** jusqu'à la fin de l'opération. Le défrichage se fait arbre par arbre et souche par souche.
- **« Annuler »** : un bouton en haut à droite de l'écran, pendant **15 s** après chaque geste. Il retire de la file les arbres et souches de ce geste qui n'ont pas encore été pris en charge, pour la récolte comme pour le défrichage.
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

- **Mode global** `cut | clear`, gardé pour la session. La palette ne demande plus ni mode ni groupe d'habitants avant le geste.
- **Indicateur du mode** (proposition, à valider à l'essai) :
  - **en coupe** : HUD normal, curseur hache ;
  - **en défrichage** : liseré et fond du HUD teintés de rouge, curseur arracheur de souche ;
  - à chaque bascule, une courte bulle « Mode défrichage » ou « Mode coupe » près du pointeur, avec une vibration au doigt si l'appareil le permet.
- **« Annuler »** : un bouton fixe en haut à droite, avec un décompte de 15 s, qui vise le **dernier** geste (un nouveau geste remplace le précédent). Il appelle la commande d'annulation de file (2e). Le serveur dit ce qui a été retiré ; un élément déjà pris en charge reste.

### Serveur requis

- **2c** : la commande accepte des arbres désignés.
- **2d** : chaque arbre est exposé (debout, abattu, souche, en file).
- **2e** : file d'attente du bois consommée par le panneau Chantier, et commande d'annulation d'un geste.

## 4. Ouvert

- **Marqueur-cercle de récolte** : Tristan veut le modifier encore. Aujourd'hui, c'est un halo au pied de chaque arbre debout (`tree-halos.ts`, spec des bosquets §5). Attente de sa description.
- **Indicateur du mode** : la proposition du §3 est à essayer en jeu.

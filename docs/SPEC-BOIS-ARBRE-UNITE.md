# Bois : l'arbre comme unité de récolte

Date : 28 octobre 2026. Base : `wip/v2-commandes-bornees`, `5203f2c`.

Statut : **décisions de Tristan du 28 octobre intégrées, implémentation autorisée.** Analyse et mesures : [ETUDE-BOIS-MODELE-SERVEUR-2026-10-28.md](ETUDE-BOIS-MODELE-SERVEUR-2026-10-28.md).

Cette spec remplace, côté serveur et sélection, l'ordre de coupe fixe, la part `B = I / N`, la repousse et le seuil de 10 % de [SPEC-BOSQUETS-SOUCHES-REPOUSSE.md](SPEC-BOSQUETS-SOUCHES-REPOUSSE.md). Restent valables de cette spec-là :
- l'abattage du vrai arbre ;
- les souches ;
- le compteur de bois coupé ;
- le choix du chantier ;
- le kit d'arbres.

Les jeunes arbres et la repousse sont reportés à la tranche **croissance spontanée**.

## 1. Décisions

| Sujet | Décision (Tristan, 28 octobre) |
|---|---|
| Unité de récolte | **L'arbre.** Le joueur désigne les arbres qu'il coupe ; c'est l'arbre désigné qui tombe. |
| Bois d'un arbre | **300 unités.** |
| Lot | **100 unités.** Un arbre fait donc **3 lots**. |
| Abattage | Quand on commence à débiter un arbre, **il tombe**. Le **tronc au sol** représente ensuite le stock de bois restant. Tronc épuisé : il ne reste qu'une **souche**. |
| Repousse | **Aucune.** Un arbre coupé ne repousse pas. La croissance spontanée de nouveaux arbres viendra plus tard, avec un placement qui ne gêne pas les joueurs. |
| Seuil de 10 % | **Supprimé.** |
| Défrichage | Permis quand la case **ne contient plus que des souches**. Il rend la case constructible. |
| Raccourci | **« Tout récolter et défricher »** reste disponible. Il sert notamment aux joueurs installés en forêt, qui doivent dégager la place pour construire. |
| Navigation | **Seuls les troncs bloquent.** Un arbre coupé reste un obstacle jusqu'au défrichage de la case. |
| Cases de bois sans arbre | **On supprime leur bois.** |

## 2. Modèle

### Arbre

Un arbre est un arbre RC1 d'une case de bois : (monde, gisement, indice d'arbre), avec position, modèle et taille donnés par RC1 (`world_rc1_resources.tree_indices`). Trois états :

| État | Bois | Rendu | Récoltable |
|---|---|---|---|
| **Debout** | 300 | arbre | oui |
| **Abattu** | tronc restant, de 1 à 299 | tronc couché, souche | oui |
| **Souche** | 0 | souche | non |

- Le premier lot qui vise un arbre debout le fait tomber, au moment prévu par la spec des chantiers. Ce que le lot emporte est retiré du tronc **au débit du lot**, comme aujourd'hui pour le stock.
- Bois disponible d'un arbre = bois de l'état actuel − réservations en cours.

### Case (gisement)

- Bois de la case = somme du bois de ses arbres. Bois initial = `300 × N`, N étant le nombre d'arbres RC1 de la case.
- **Défrichable** quand tous ses arbres sont des souches, sans lot réservé ni en cours. Le défrichage :
  - retire les troncs de la navigation (`removedIndices`, comme aujourd'hui) ;
  - rend la case constructible ;
  - fait passer la case à l'état `depleted` sur la carte.
- Tant qu'elle n'est pas défrichée, une case de bois n'est **pas constructible**, même si elle ne contient plus que des souches.

### Lot et sélection

- Le joueur choisit des arbres, au clic ou en balayant. Un ordre d'exploitation produit des lots de 100 unités au plus, chacun sur **un seul arbre**, dans l'ordre de désignation.
- Un lot prend `min(100, bois disponible de l'arbre)`.
- Un arbre réservé par un village n'est pas disponible pour un autre (réservation partielle possible : deux lots de villages différents peuvent se partager un tronc de 300).
- **« Tout récolter et défricher »** sur une sélection de cases :
  1. prépare des lots pour tous les arbres encore récoltables de ces cases ;
  2. défriche chaque case dès que son dernier tronc est épuisé.

  C'est le mode `clear` actuel des chantiers, adapté aux arbres.

### Navigation

- Les troncs de tous les arbres de la case restent des obstacles jusqu'au défrichage, qu'ils soient debout, abattus ou réduits à des souches.
- L'empreinte du réseau de trajets ne dépend pas du bois restant. Elle ne change qu'au défrichage, ou au nettoyage d'installation. C'est déjà le cas côté présentation depuis `5203f2c`.

## 3. Stockage (serveur)

- Nouvelle table `woodland_trees` (monde, gisement, indice d'arbre) : `remaining_amount`, `reserved_amount`, `felled_at`, `revision`. Une ligne n'existe qu'**à partir du premier lot** sur l'arbre : sans ligne, l'arbre est debout avec 300 unités.
- `deposit_extractions` reçoit l'indice d'arbre visé, additif et nullable pour l'historique.
- `woodland_deposits` reste la case : coordonnées, `cleared`, `cut_amount`, `initial_amount = 300 × N`. Le stock, la réservation et la repousse de la case n'y sont plus tenus.
- **La lecture n'écrit plus** :
  - plus de matérialisation de repousse ;
  - plus d'occupation de case maintenue en continu ;
  - plus de réécriture de `world_features` au réveil.
- Le réveil d'un village ne verrouille que les arbres et les cases qui ont un lot à débiter. Ordre des verrous : village, puis gisements par UUID, puis arbres par (gisement, indice).
- Une case de bois reste occupée (non constructible) jusqu'au défrichage. L'occupation ne change donc qu'au défrichage, ou à la construction sur une case défrichée.

## 4. Conversion des données existantes

- **Cases intactes** : rien à faire, puisqu'aucune ligne d'arbre n'est nécessaire. Seul `initial_amount` passe à `300 × N`.
- **Cases entamées** : convertir `cut_amount` C selon l'ordre de coupe actuel (`tree_indices`).
  - `floor(C / (300 / N))` arbres deviennent des souches.
  - L'arbre entamé devient un tronc couché, avec `300 × (reste de sa part)`.
  - Les lots en cours gardent leur réservation sur cet arbre, puis le suivant.
  - La repousse déjà acquise est **abandonnée** (plus de repousse).
- **Cases défrichées** : inchangées.
- **Cases sans arbre RC1** (4 en dev : toutes des compléments de départ `starter:`, 1 500 unités pour 3 arbres historiques) : bois supprimé (gisement retiré, case libérée). Si un lot y est en cours, il se termine d'abord (**à vérifier en base avant conversion**).
- **Équilibrage** (corrigé après vérification en base le 28 octobre) : en RC1, les bosquets valent déjà **500 par arbre** (`rc1-field.ts:44`, 1 984 bosquets sur 1 988 en dev). Passer à 300 par arbre **réduit le bois de 40 %**, sans repousse. Le « × 8 » de la version précédente venait du monde procédural `aube` (300 par case), utilisé par les tests.
- La conversion touche des données de joueurs sur l'alpha : **elle ne s'y applique qu'avec l'accord explicite de Tristan**, au moment du déploiement.

## 5. Tranches

1. **Empreinte du réseau sans le seuil des bosquets** : **faite** (`5203f2c`, côté présentation).
2. **Serveur : l'arbre comme unité.** Table `woodland_trees`, lots par arbre, plus de repousse ni de seuil, défrichage quand il ne reste que des souches, raccourci « tout récolter et défricher », lecture sans écriture, conversion. Tests :
   - trois lots sur un arbre (tombé au premier, souche au troisième) ;
   - réservation concurrente du même arbre par deux villages (barrières, attente PostgreSQL observée) ;
   - un bootstrap sans échéance n'écrit rien et ne publie rien ;
   - défrichage refusé tant qu'il reste un tronc, permis avec seulement des souches ;
   - le raccourci enchaîne coupe et défrichage ;
   - la conversion conserve le bois coupé.
3. **Client : sélection et rendu par arbre.** Le clic et le balayage désignent des arbres. Le bosquet montre l'arbre debout, le tronc couché selon son bois restant, ou la souche. Le chantier abat l'arbre désigné. Plus de jeunes arbres.
4. Allonger le délai du cache de présentation, puis mesurer.
5. Plus tard : **croissance spontanée** de nouveaux arbres.

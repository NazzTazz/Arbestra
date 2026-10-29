# Bois : l'arbre comme unité de récolte

Date : 28 octobre 2026. Base : `wip/v2-commandes-bornees`, `5203f2c`.

Statut : **décisions de Tristan du 28 octobre intégrées (deuxième série le soir : arbre de 500, défrichage arbre par arbre, file d'attente), implémentation autorisée.** Deux points ouverts au §7. Analyse et mesures : [ETUDE-BOIS-MODELE-SERVEUR-2026-10-28.md](ETUDE-BOIS-MODELE-SERVEUR-2026-10-28.md).

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
| Bois d'un arbre | **500 unités**, comme le fixe la doc RC1 (« un arbre représente 500 bois bruts », [SPEC-CARTE-SPAWN-RC1.md](SPEC-CARTE-SPAWN-RC1.md)). |
| Lot | **100 unités.** Un arbre fait donc **5 lots**. |
| Abattage | Quand on commence à débiter un arbre, **il tombe**. Le **tronc au sol** représente ensuite le stock de bois restant. Tronc épuisé : il ne reste qu'une **souche**. |
| Repousse | **Aucune.** Un arbre coupé ne repousse pas. La croissance spontanée viendra plus tard, avec un placement qui ne gêne pas les joueurs. |
| Seuil de 10 % | **Supprimé.** |
| Défrichage | **Arbre par arbre, souche par souche.** Un arbre désigné pour le défrichage est entièrement récolté, puis sa souche est retirée ; une souche désignée est retirée. Une case devient constructible quand il n'y reste plus ni arbre ni souche. |
| File d'attente | Les gestes **mettent en file** des arbres et des souches, pour la récolte ou le défrichage. Le **panneau Chantier** consomme cette file avec ses habitants : c'est lui qui décide de l'effectif. |
| Annuler | Pendant 15 s après un geste, « Annuler » **retire de la file** les arbres et souches de ce geste qui n'ont pas encore été pris en charge. |
| Navigation | **Seuls les troncs bloquent.** Un arbre coupé reste un obstacle (sa souche) jusqu'à ce que la souche soit retirée. |
| Mondes sans arbres RC1 | Comme le prévoit la doc RC1 (RC1 désigne la génération du monde, de son terrain et de ses forêts) : **2 à 5 arbres** par case. |
| Compléments de départ | De **vrais arbres** (deux bosquets de trois arbres, doc RC1), qu'on **continue de donner** aux joueurs isolés des forêts. |
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

- Le tronc d'un arbre reste un obstacle tant que l'arbre est debout, abattu ou réduit à une souche. Il quitte la navigation au retrait de sa souche (étape 2e), même si la case garde d'autres arbres ou souches et reste donc occupée, non constructible.
- L'empreinte du réseau de trajets ne dépend pas du bois restant. Elle ne change qu'au retrait d'une souche, au défrichage, ou au nettoyage d'installation.

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

## 7. Décisions du 28 octobre au soir, et points ouverts

- **Grammaire gestuelle (mode Exploitation seulement)** :
  - toucher = cet élément ; glisser = tous les éléments survolés ;
  - **appui long = bascule globale** coupe ↔ défrichage, avec un indicateur visuel à concevoir (curseur, ou couleur de fond du HUD) ;
  - arbres en file pour la coupe : leur bois s'affiche, comme aujourd'hui ;
  - arbres et souches en file pour le défrichage : léger surlignage rouge jusqu'à la fin ;
  - « Annuler » en haut à droite, 15 s, retire de la file les éléments du geste.
- **Conversion** :
  - **dev** : on peut supprimer et recréer les données de bois sans précaution ;
  - **alpha** : il faut du bois pour tout le monde, et **ne jamais ajouter d'arbre trop près des bâtiments des joueurs**. Le compteur de bois coupé est recalculé en arbres de 500. Une case à moitié coupée garde la moitié de ses arbres debout.
- **Ordre des lots** : la case la plus proche d'abord, puis l'ordre de désignation.
- **Ouvert 1. Retirer une souche** : combien de travail ? Proposition : la durée d'un lot de 100 pour un habitant, sans bois rapporté.
- **Ouvert 2. « Trop près des bâtiments »** : quelle distance minimale pour un arbre ajouté (complément de départ, mondes sans arbres RC1) ? Proposition : 2 cases de toute emprise de bâtiment, route ou terrasse.
- **Exception assumée** à la règle « pas d'entité persistante par arbre décoratif » (AGENTS.md, doc RC1) : l'arbre devient une unité de jeu. Une ligne par arbre n'existe qu'à partir de sa première coupe.

## 8. Décisions sur l'implémentation de 2b (Tristan, 28 octobre au soir)

Recommandations validées :
1. **Retrait d'une souche** : un seul habitant, 600 s plus les trajets, quelle que soit l'équipe.
2. **Arrêt d'un défrichage** : le lot engagé est livré, puis aucune souche n'est retirée.
3. **Mondes procéduraux** : une case située à 3 cases ou moins (Chebyshev) d'un bâtiment, d'une route ou d'une terrasse garde son ancien nombre d'arbres (2 à 4) quand la conversion en ajouterait.
4. **Alpha** : vérifier avant la conversion qu'il n'a pas de monde procédural. Sinon, la marge n'y joue pas.
5. **Case RC1 sans arbre** : vidée, libérée et marquée `depleted`, sans suppression de ligne.

Choix d'implémentation retenus (`8b806f2`, `c10807b`) :
- La case garde la somme de ses arbres, écrite dans la même instruction que l'arbre.
- Le défrichage final est automatique. Les troncs quittaient la navigation au défrichage complet de la case ; depuis 2e, chaque tronc la quitte au retrait de sa souche.
- Admission et départ d'un lot ont une seule borne : le bois libre de la case.
- Un départ refusé met le chantier en attente sans faire échouer la lecture, la commande ni le worker.
- La migration 066 reconvertit les cases dont les arbres ne correspondent pas au stock.

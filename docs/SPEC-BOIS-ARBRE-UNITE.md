# Bois : l'arbre comme unité de récolte

Date : 28 octobre 2026. Base : `wip/v2-commandes-bornees`, `761204a`.

Statut : **décisions de Tristan du 28 octobre intégrées ; trois interprétations à confirmer (§6).** Analyse et mesures : [ETUDE-BOIS-MODELE-SERVEUR-2026-10-28.md](ETUDE-BOIS-MODELE-SERVEUR-2026-10-28.md).

Cette spec remplace, pour le serveur et la sélection, l'ordre de coupe fixe et la part `B = I / N` de [SPEC-BOSQUETS-SOUCHES-REPOUSSE.md](SPEC-BOSQUETS-SOUCHES-REPOUSSE.md) §2. Restent valables de cette spec-là :
- l'abattage du vrai arbre ;
- les souches et les jeunes arbres visibles ;
- les compteurs de la fiche ;
- le choix du chantier ;
- le kit d'arbres.

## 1. Décisions

| Sujet | Décision (Tristan, 28 octobre) |
|---|---|
| Unité de récolte | **L'arbre.** Le joueur désigne les arbres qu'il coupe ; c'est l'arbre désigné qui tombe. |
| Bois d'un arbre adulte | **300 unités.** |
| Lot | **100 unités** de bois. Un arbre adulte fait donc **3 lots**. |
| Repousse | Linéaire, **14 jours** de la souche à l'arbre adulte. |
| Récolte d'un arbre qui repousse | Seulement à partir de **50 % de maturité**, soit 150 unités disponibles. |
| Seuil de 10 % | Inchangé. Il décide de la **construction** sur la case et du **défrichage**. |
| Navigation | **Seuls les troncs bloquent.** Un arbre coupé **reste un obstacle** jusqu'au défrichage de la case. Le seuil ne touche pas la navigation. |
| Cases de bois sans arbre | S'il existe des arbres autour, la case **perd son bois**. S'il ne reste pas d'arbres, on **remet autant d'arbres qu'il faut**. |

## 2. Modèle

### Emplacement d'arbre

Un emplacement est un arbre RC1 d'une case de bois : (monde, gisement, indice d'arbre), avec position, modèle et taille donnés par RC1 (`world_rc1_resources.tree_indices`). Son état :

- **Debout** : jamais coupé, ou repoussé. Bois disponible : `300 × maturité`, récoltable si la maturité atteint au moins 50 %.
- **Abattu** au premier lot qui le vise, à l'instant `t_abattage` :
  - le **tronc couché** porte le reste de bois, `bois avant abattage − lot` ;
  - les lots suivants débitent d'abord ce tronc ;
  - un **jeune arbre** pousse à côté de la souche (rendu déjà validé). Sa maturité vaut `(t − t_abattage) / 14 jours`, plafonnée à 1.
- Quand le tronc est épuisé et que le jeune arbre atteint 50 %, l'emplacement redevient récoltable sur le jeune arbre ; le prochain lot l'abat à son tour. La souche reste unique.

Bois disponible d'un emplacement = `tronc restant + (maturité ≥ 0,5 ? 300 × maturité : 0) − réservations`.

### Case (gisement)

- Bois physique de la case : somme, sur ses emplacements, du tronc restant et de `300 × maturité`. Le jeune arbre compte même sous 50 % : il est physiquement là.
- Bois initial de la case : `300 × N`, où N est son nombre d'arbres.
- **Seuil** : construction et défrichage sont permis quand le bois physique de la case vaut au plus 10 % de son bois initial (§6, point 1). Le seuil se calcule **au moment de la commande** ; rien n'est écrit en continu.
- Le défrichage détruit le bois restant, retire les troncs de la navigation et rend la case constructible. Une case défrichée ne repousse plus (inchangé).

### Lot et sélection

- Le joueur choisit des arbres, au clic ou en balayant. Un ordre d'exploitation produit des lots de 100 unités au plus, chacun sur **un seul emplacement**. Les emplacements choisis sont traités dans l'ordre de désignation.
- Un lot prend `min(100, bois disponible de l'emplacement)`.
- Un emplacement réservé par un village n'est pas disponible pour un autre.

### Navigation

- Les troncs de tous les emplacements restent des obstacles tant que la case n'est pas défrichée, qu'ils soient debout, abattus ou repoussés.
- L'empreinte du réseau de trajets ne dépend ni du stock ni du seuil. Seuls le défrichage et le nettoyage d'installation retirent des troncs.

## 3. Stockage (serveur)

- Nouvelle table `woodland_trees` (monde, gisement, indice d'arbre) : `felled_at`, `trunk_amount`, `reserved_amount`, `revision`. Une ligne n'existe qu'**à partir de la première coupe** : sans ligne, l'arbre est adulte et intact. Aucune réécriture des 28 927 gisements de la base de dev.
- `deposit_extractions` reçoit l'indice d'arbre visé, additif et nullable pour l'historique.
- `woodland_deposits` garde la case : coordonnées, défrichage, compteur de bois coupé (`cut_amount`). `initial_amount` devient `300 × N`.
- **La lecture n'écrit plus.**
  - Le réveil d'un village ne verrouille que les emplacements qui ont un lot à débiter ou à rendre.
  - Ordre des verrous inchangé : village, puis gisements par UUID, puis emplacements par (gisement, indice).
  - Plus de recopie du stock, plus d'occupation de case maintenue en continu, plus d'écriture de `world_features` en lecture.
- La présentation transmet, par emplacement abattu, l'instant d'abattage et le tronc restant. Le client calcule la maturité.

## 4. Conversion des données existantes

- **Gisements intacts** : rien à faire, puisqu'aucune ligne d'arbre n'est nécessaire.
- **Gisements entamés** (23 en dev) : `cut_amount` C et le stock actuel sont convertis selon l'ordre de coupe actuel (`tree_indices`).
  - Les `floor(C / (300 / N_ancien))` premiers arbres sont abattus. Leur `felled_at` est l'instant du lot qui les a fait tomber, d'après `deposit_extractions` ; à défaut, l'instant de conversion.
  - L'arbre entamé garde un tronc couché, proportionnel à ce qu'il en restait.
- **Cases sans arbre RC1** (40 en dev) : selon la règle du §1, interprétée au §6, point 3.
- **Équilibrage** : une case de N arbres contient désormais `300 × N` unités au lieu de 300, soit **environ 8 fois plus de bois** dans le monde (médiane de 8 arbres par case).
- La conversion touche des données de joueurs sur l'alpha : **elle ne s'y applique qu'avec l'accord explicite de Tristan**, au moment du déploiement.

## 5. Tranches

1. **Empreinte du réseau sans le seuil des bosquets.** **Fait** (côté présentation) : sur un sol RC1, l'empreinte ignore l'état des bosquets ; le défrichage compte via les troncs retirés. Test unitaire rouge avant, vert après. Le chemin des commandes, avec ses cibles de bois, garde l'état, qui sert à choisir ses cibles. En RC1, l'état, le blocage et le défrichage *partiel* des bosquets sortent de l'empreinte ; le défrichage complet y reste.
2. **Serveur : l'arbre comme unité.** Table `woodland_trees`, lots par emplacement, seuil calculé à la commande, lecture sans écriture, conversion. Tests :
   - lots sur un arbre adulte (3 lots) et sur un jeune arbre à 50 % ;
   - réservation concurrente du même arbre par deux villages (barrières, attente PostgreSQL observée) ;
   - un bootstrap sans échéance n'écrit rien et ne publie rien ;
   - le seuil de construction et de défrichage est calculé correctement ;
   - la conversion conserve le bois coupé.
3. **Client : sélection et rendu par arbre.** Le clic et le balayage désignent des arbres. Le bosquet montre, emplacement par emplacement, l'arbre debout, le tronc couché, la souche et le jeune arbre. Le chantier abat l'arbre désigné.
4. Allonger le délai du cache de présentation, puis mesurer.

## 6. Interprétations à confirmer

1. **Seuil de 10 %** : comparé au bois physique de toute la case, jeunes arbres compris, par rapport à `300 × N` ?
2. **Ordre de récolte d'un emplacement** : le tronc couché d'abord, puis le jeune arbre une fois à 50 % ? Le jeune arbre ne commence-t-il à pousser qu'à l'abattage ?
3. **Cases sans arbre** :
   - « autour » = les 8 cases voisines ?
   - « autant d'arbres qu'il faut » = un arbre par tranche de 300 du bois actuel de la case, arrondi au supérieur, et au moins un ?

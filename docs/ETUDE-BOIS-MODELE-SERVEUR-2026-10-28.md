# Bois : modèle serveur, problèmes et cible

Date : 28 octobre 2026. Base : `wip/v2-commandes-bornees`, `3049aae`.

Statut : **étude, rien d'implémenté.** Demandée par Tristan : « re-spécifier si besoin le bois ; il y a beaucoup de problèmes avec les arbres, s'il faut modifier quelque chose autant le faire dès maintenant ». Elle complète [SPEC-BOSQUETS-SOUCHES-REPOUSSE.md](SPEC-BOSQUETS-SOUCHES-REPOUSSE.md), qui tranche le **rendu** (souches, repousse visible, vrai arbre abattu, choix du chantier).

Légende : **lu** = constaté dans le code ou la base ; **mesuré** = relevé en navigateur ou en base ; **inféré** = déduction à vérifier ; **décidé** = dit par Tristan.

## 1. Règles confirmées par Tristan (28 octobre)

- **Seuls les troncs bloquent le passage.** Le seuil de 10 % ne change pas la navigation (**décidé**). Le code est d'accord : en RC1, le planificateur ignore le blocage de case des bosquets (`travel-paths.ts:375` et `:541`, avec `woodedCells`) et n'utilise que les troncs (géométrie fine, `removedIndices`).
- La bascule autour de 10 % décide seulement **si l'on peut construire sur la case** et **si l'on peut la défricher**. Ces cas sont assez rares pour rester hors du cache des trajets (**décidé**).
- Problème principal vu en jeu : **le groupement des arbres**. Un clic sur un arbre en fait récolter 2, 3 ou 4, et le joueur ne choisit pas lesquels (**décidé**, constat de Tristan).

## 2. Modèle actuel

### Unité de récolte : le bosquet (lu, mesuré)

- Le gisement (`woodland_deposits`) est **la case du bosquet** : 300 unités, quel que soit le nombre d'arbres. En RC1, les arbres de la case sont listés dans `world_rc1_resources.tree_indices`.
- Base de dev, mesuré : sur 1 989 bosquets RC1, **1 à 20 arbres par case, 8 en médiane** (40 cases sans arbre RC1, 2 cases à 57 arbres).
- Un arbre « vaut » donc 300 / N : 300 s'il est seul, 15 dans une case de 20.
- Un lot prélève jusqu'à **100** unités (`worksites.ts:556`). Dans une case de 9 arbres, un lot fait tomber 3 arbres. **C'est le groupement constaté en jeu.**
- La sélection en mode Exploitation porte sur la case (`instanceFeatureIds` : un arbre touché sélectionne son gisement). L'ordre de coupe est fixe et commun à tous les villages (spec du 27 octobre, §2).

### Repousse et seuil (lu)

- Repousse **linéaire**, retour à plein stock en **14 jours** (`woodland_stock_at`, migration 017). Un bosquet défriché ne repousse pas.
- Au-dessus de 10 % : la case porte une occupation (`world_cell_occupancies`), qui interdit d'y construire. La carte affiche `available`. Le défrichage est refusé.
- La vue `resource_deposits` projette déjà le stock à l'instant de la lecture : **le stock se lit sans être écrit**.

### Matérialisation à chaque réveil (lu)

À chaque réveil économique d'un village, le serveur :
- verrouille tous les bosquets à 32 cases ;
- recopie leur stock projeté ;
- recrée ou supprime l'occupation selon le seuil ;
- réécrit `world_features` pour chaque bosquet non plein, même sans changement (`woodland.ts:127-133`).

Ce réveil a lieu à chaque bootstrap, à chaque commande et à chaque tâche du worker.

Conséquences :
- **Écritures** : chaque lecture du joueur écrit des lignes et publie au journal. Présentation et version RC1 sont invalidées sans changement réel. Le 26 octobre sur l'alpha, la mémoire de l'API portait une géométrie RC1 de ~15 Mo par version.
- **Contention** : deux villages voisins se disputent les mêmes lignes.
- **Empreinte du réseau** : elle inclut l'état et le seuil de chaque bosquet (`networkState`, `travel-paths.ts:306/596`). Une bascule autour de 10 % fait donc recalculer tout le réseau du village, alors qu'en RC1 elle ne change aucun trajet.
- **Volumes** (base de dev, mesuré) : 28 927 gisements de bois, 23 en repousse, 3 défrichés.

### Navigation (lu)

- Le serveur garde le tronc des arbres **adultes**, quel que soit le stock : un arbre coupé reste un obstacle (spec du 27 octobre, §4).
- Seul le défrichage complet ou le nettoyage d'installation retire des troncs (`removedIndices`, `context.ts:227`).

## 3. Problèmes recensés

| # | Problème | Cause | Source |
|---|---|---|---|
| 1 | Un clic récolte 2 à 4 arbres, sans choix | Unité de récolte = case de 300 ; lot de 100 ; sélection par case ; ordre fixe | Tristan, lu |
| 2 | Valeur d'un arbre de 15 à 300 selon sa case | 300 par case, quel que soit le nombre d'arbres | mesuré |
| 3 | Chaque lecture du joueur écrit et publie | Matérialisation à chaque réveil | lu, mesuré |
| 4 | Caches invalidés sans changement réel ; réseau recalculé à chaque bascule de seuil | Point 3, et seuil dans l'empreinte du réseau | lu |
| 5 | Contention entre villages voisins | Verrou sur tous les bosquets à 32 cases | lu |
| 6 | Arbre coupé toujours obstacle côté serveur, alors qu'on ne voit qu'une souche | Troncs adultes indépendants du stock | lu |
| 7 | Bosquets « sans chemin », budget A* qui fait échouer toute la sélection | Tronc sur le centre de case ; cible impossible non exclue seule | handoff, 27 octobre |
| 8 | Recherches A* coûteuses autour de l'arbre abattu (gel de 77 s, corrigé en partie) | Tests de place autour des troncs | handoff, 28 octobre |

## 4. Cible proposée

### P1. L'arbre devient l'unité de récolte (**décision gameplay**)

- Chaque arbre porte **une quantité fixe de bois**, par exemple 35 unités : la moyenne actuelle est 300 / 8 ≈ 37. Le bosquet n'est plus qu'un regroupement d'arbres sur une case.
- **Sélection** : cliquer ou balayer choisit des **arbres**. Le lot vise exactement les arbres choisis. L'ordre fixe de la spec du 27 octobre disparaît : l'arbre coupé est celui que le joueur a désigné.
- **Lot** : un arbre par lot, ou un nombre d'arbres lié à l'équipe (**à décider**). Un arbre réservé par un village n'est plus disponible pour un autre.
- **Stockage** (inféré) : une table `woodland_trees` (monde, bosquet, indice d'arbre), avec réservation, instant de coupe et repousse. Elle n'est créée qu'**à la première coupe** : un arbre absent de la table est un arbre adulte intact. Aucune migration de masse des 28 927 bosquets.
- **Repousse par arbre** : jeune arbre à côté de la souche (déjà validé), récoltable de nouveau une fois adulte (**à décider** : plein bois seulement, ou au prorata).
- **Seuil de 10 %** : il s'applique à la somme des arbres de la case, pour la construction et le défrichage (règles inchangées).
- Conséquence : la quantité totale de bois du monde change. Les bosquets denses en contiennent plus, les arbres isolés moins. C'est un **équilibrage à valider**.

### P2. La lecture n'écrit plus (sans effet en jeu)

- Puisque le seuil ne concerne que la construction et le défrichage, il suffit de le **calculer au moment de la commande** de construction ou de défrichage. Pas d'occupation de case à tenir à jour en continu, pas de tâche planifiée.
- Le réveil d'un village ne verrouille plus que les arbres et bosquets qui ont une transition **due** : un débit de lot ou un retour. Invariants inchangés (AGENTS.md) : village d'abord, bosquets par UUID ensuite, jamais un autre village après un bosquet.
- Le stock d'un arbre ou d'une case se calcule à l'instant voulu. Le client projette la repousse à partir d'une référence (stock, instant, vitesse), comme pour les jardins.
- Gains attendus (inféré) :
  - plus aucune écriture ni publication en lecture ;
  - présentation et version RC1 stables ;
  - délai de 60 s du cache de présentation allongeable ;
  - plus de contention entre voisins en lecture.

### P3. Empreinte du réseau sans le seuil des bosquets (sans effet en jeu)

- En RC1, retirer de l'empreinte du réseau l'état, le blocage et le défrichage des bosquets, puisqu'ils ne changent aucun trajet. Seuls les troncs retirés (`removedIndices`) et les défrichages y restent.
- Monter `TRAVEL_NETWORK_VERSION`.
- Indépendant de P1, faisable tout de suite.

### P4. L'arbre coupé et la navigation (**décision gameplay**)

| Option | Effet | Coût |
|---|---|---|
| A. Comme aujourd'hui : un arbre coupé reste un obstacle jusqu'au défrichage de la case | Peu cohérent avec la souche visible | Aucun recalcul à la coupe |
| B. La souche ne bloque plus : l'arbre coupé rejoint `removedIndices` ; le jeune arbre rebloque une fois adulte | Ce qu'on voit est ce qui bloque | Un recalcul du réseau du village **par arbre coupé** (avec le cache persistant, une seule fois par changement) |

Recommandation : **A pour l'instant.** La coupe est l'événement le plus fréquent du bois : la rendre gratuite pour la navigation protège les performances. B reste possible plus tard, avec un calcul incrémental du réseau.

## 5. Questions pour Tristan

1. P1 : l'arbre comme unité de récolte, avec une quantité fixe par arbre ? Quelle valeur (proposition : 35) ?
2. Un lot correspond-il à **un arbre**, ou à plusieurs arbres choisis selon la taille de l'équipe ?
3. Un arbre repoussé se récolte-t-il seulement une fois adulte ?
4. P4 : l'arbre coupé reste-t-il un obstacle jusqu'au défrichage (A), ou la souche laisse-t-elle passer (B) ?
5. Garde-t-on la repousse linéaire sur 14 jours et le seuil de 10 % (construction et défrichage) ?
6. Les 40 cases sans arbre RC1 (disposition historique) : on leur attribue des arbres, ou on les retire ?

## 6. Tranches proposées (après décisions)

1. **P3** : empreinte du réseau sans le seuil des bosquets. Petite tranche, sans décision de gameplay. Test : une bascule de seuil ne change pas l'empreinte, un défrichage la change.
2. **P2** : la lecture n'écrit plus. Tests :
   - régression qui compte les lignes écrites et les publications lors d'un bootstrap sans échéance (zéro attendu) ;
   - concurrence entre deux villages voisins (barrières, attente PostgreSQL observée) ;
   - construction et défrichage refusés ou permis selon le stock calculé à la commande.
3. **P1** : l'arbre comme unité. Table `woodland_trees`, contrat (lot et sélection par arbre), mode Exploitation (sélection d'arbres), rendu (l'arbre abattu est celui choisi), équilibrage. Migration additive, sans réécriture des bosquets existants : la quantité restante de chaque bosquet entamé se répartit sur ses arbres selon l'ordre de coupe actuel.
4. **P4** selon la décision.

Risques :
- Les invariants économiques (AGENTS.md) concernent directement cette zone.
- Sur l'alpha, les bosquets déjà entamés par des joueurs doivent garder leur bois. La conversion de P1 touche des données de joueurs : elle demande l'accord de Tristan avant d'être appliquée.

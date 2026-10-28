# Bois : modèle serveur, problèmes et cible

Date : 28 octobre 2026. Base : `wip/v2-commandes-bornees`, `a683861`.

Statut : **étude, rien d'implémenté.** Demandée par Tristan : « re-spécifier si besoin le bois ; il y a beaucoup de problèmes avec les arbres, s'il faut modifier quelque chose autant le faire dès maintenant ». Complète [SPEC-BOSQUETS-SOUCHES-REPOUSSE.md](SPEC-BOSQUETS-SOUCHES-REPOUSSE.md), qui tranche le **rendu** (souches, repousse visible, vrai arbre abattu, choix du chantier) mais presque pas le **modèle serveur**. Les décisions de cette spec-là restent valables.

Légende : **lu** = constaté dans le code ou la base ; **mesuré** = relevé en navigateur ou en base ; **inféré** = déduction à vérifier.

## 1. Modèle actuel

### Données (lu)

- `woodland_deposits` (migration 017, 062) : par bosquet, `initial_amount` (300), `remaining_amount`, `reserved_amount` (lots en cours), `cut_amount` (cumul coupé), `cleared`, `regrowth_period_ms` (14 jours partout), `regrowth_updated_at` (curseur de repousse), `revision`, `updated_at`.
- Repousse **linéaire** : `woodland_stock_at(w, t)` ajoute `initial × durée / période`, plafonné à `initial`, en rejouant les lots revenus dans l'ordre de leurs échéances. Un bosquet défriché ne repousse pas.
- Seuil de **10 %** (`stock > initial / 10`), qui décide trois choses à la fois :
  - si la case **bloque le passage** : une ligne dans `world_cell_occupancies` ;
  - l'état de la carte (`world_features.state` : `available` ou `depleted`) ;
  - si le défrichage est permis.
- La vue `resource_deposits` projette déjà le stock à l'instant de la lecture (`woodland_stock_at(w, economy_through)`) : **le stock se lit sans être écrit**.

### Matérialisation (lu)

À chaque réveil économique d'un village (`beginVillageEconomy`, `reconcile-economy.ts`), le serveur :
- verrouille (`FOR UPDATE`) tous les bosquets à 32 cases du village ;
- recopie le stock projeté dans `remaining_amount` (`materializeWoodlandsWithoutReturns`) ;
- avance `regrowth_updated_at` ;
- recrée ou supprime l'occupation de case selon le seuil ;
- réécrit `world_features.state` et `updated_at` **pour chaque bosquet non plein**, même quand rien n'a changé (`woodland.ts:127-133`).

Ces réveils ont lieu à chaque bootstrap du joueur, à chaque commande, à chaque tâche du worker sur ce village, et à chaque changement d'activité vu par le flux.

### Conséquences (lu, puis mesuré)

- Chaque écriture déclenche le journal de synchronisation (déclencheurs par ligne de 054 sur les flux village et sur les **chunks spatiaux partagés**). Les révisions couvrant la présentation bougent donc, et la présentation est recapturée. Le handoff le notait déjà : « la version de présentation change à chaque lecture à cause de la repousse ».
- `rc1GroundVersion` agrège par md5 **tous** les bosquets et features du monde. La géométrie RC1 est reconstruite quand un bosquet franchit le seuil ou est défriché, et elle n'est pas mémorisée si une ligne a bougé pendant le chargement. Le 26 octobre, sur l'alpha, 4 versions de ~15 Mo du même monde occupaient le cache, une nouvelle clé par arbre abattu.
- Le franchissement du seuil change l'occupation des cases, donc l'entrée du planificateur, donc **tout le réseau de trajets** du village est recalculé.
- Deux villages à moins de 64 cases verrouillent les mêmes lignes de bosquets à chacun de leurs réveils.
- Base de dev, mesuré le 28 octobre : 28 927 bosquets, **23 en repousse**, 3 défrichés.
  - Le stock d'un bosquet en repousse gagne une unité entière toutes les ~67 min (300 en 14 jours).
  - Un bosquet coupé à 10 % ou moins mais non défriché repasse au-dessus du seuil en **au plus ~34 h**.

### Navigation et arbres (lu, et handoff)

- Le blocage se fait **par case**, au-dessus de 10 %.
- En RC1, chaque arbre a en plus un tronc, qui est un obstacle à l'intérieur de la case. Le serveur prend les arbres **adultes**, quel que soit le stock : la spec du 27 octobre dit « les trajets serveur ne changent pas ».
- Les souches ne sont pas des obstacles (spec, §8).

## 2. Problèmes recensés

| # | Problème | Cause | Source |
|---|---|---|---|
| 1 | Chaque lecture du joueur écrit des dizaines de lignes et publie au journal | Matérialisation à chaque réveil, y compris en lecture | lu, mesuré (`world_features:update` dans le bootstrap) |
| 2 | Cache de présentation et version RC1 invalidés sans changement réel | Point 1, plus `updated_at` réécrit sans condition | lu |
| 3 | Réseau de trajets recalculé quand un bosquet franchit 10 % dans un sens ou dans l'autre | Occupation de case liée au seuil | lu |
| 4 | Contention entre villages voisins | Verrou ligne sur tous les bosquets à 32 cases à chaque réveil | lu |
| 5 | Bosquets « sans chemin », budget A* épuisé qui fait échouer toute la sélection (503) | Tronc qui couvre le centre de la case ; une cible impossible n'est pas exclue seule | handoff, 27 octobre |
| 6 | Gel du client (image de 77 s), recherches A* de ~600 ms autour de l'arbre abattu | Tests de place autour des troncs ; corrigé en partie (`f4ab7e8`, `cb6b1b0`) | handoff, 28 octobre |
| 7 | Mémoire de l'API alpha : une géométrie RC1 de ~15 Mo par version | Version RC1 qui change à chaque arbre abattu | handoff, 26 octobre |
| 8 | Incohérences possibles entre ce qu'on voit et ce qui bloque : souches praticables mais troncs adultes toujours obstacles côté serveur | Navigation qui ignore le stock | lu (spec §4, §8) |
| 9 | *À compléter par Tristan* : ce que tu vois en jeu | | |

## 3. Cible proposée

### P1. La lecture n'écrit plus (pas de gameplay en jeu)

- Le stock d'un bosquet se **calcule** à l'instant voulu ; il n'est plus recopié en base à chaque réveil. C'est déjà le cas de la vue `resource_deposits`.
- La base ne change qu'aux **événements** :
  - réservation d'un lot ;
  - retour et débit d'un lot (déjà des tâches à échéance) ;
  - défrichage, ou construction sur la case ;
  - **franchissement du seuil de 10 %**. La repousse étant linéaire, son instant exact se calcule au débit qui fait passer sous le seuil : `t = maintenant + (initial/10 − stock) × période / initial`. On le planifie comme une tâche (`woodland.threshold`), réconciliée par échéance, identifiant et type, comme les autres transitions (AGENTS.md).
- Un réveil de village ne verrouille plus que les bosquets qui ont une transition **due**. Les invariants restent : village d'abord ; bosquets par UUID ensuite ; jamais un autre village après un bosquet.
- Gains attendus (inféré) :
  - plus aucune publication au journal en lecture ;
  - présentation et version RC1 stables tant qu'il ne se passe rien ;
  - le délai de 60 s du cache de présentation pourra être allongé ;
  - plus de contention entre voisins en lecture.

### P2. Le client projette lui-même la repousse (pas de gameplay en jeu)

- Le serveur envoie `stock de référence`, `instant de référence`, `vitesse` et `plafond`. Le client calcule le stock affiché, comme il le fait déjà pour les jardins et les figurants.
- La présentation ne change plus de version avec le temps.

### P3. Ce que bloque un bosquet (**décision gameplay**)

Aujourd'hui, un bosquet au-dessus de 10 % bloque toute sa case, et la repousse peut la rebloquer seule en ~34 h. Chaque franchissement recalcule le réseau de trajets du village. Options :

| Option | Effet en jeu | Coût |
|---|---|---|
| A. Inchangé | Une forêt coupée puis abandonnée se referme sur les chemins | Un recalcul du réseau par franchissement (rare avec P1, mais à chaque fois) |
| B. Une case passée sous 10 % reste praticable jusqu'au défrichage ou à la repousse **complète** | La forêt se referme plus tard (14 jours) | Moins de franchissements |
| C. Le blocage ne dépend plus du stock : les **troncs debout** sont les obstacles, à l'intérieur de la case ; les souches et les jeunes arbres ne bloquent pas | Ce qu'on voit est ce qui bloque (cohérent avec la spec des souches) | Le planificateur travaille au niveau des troncs (il en connaît déjà les positions RC1) ; les recalculs suivent le nombre d'arbres debout |

Recommandation : **C à terme**, parce que c'est le seul modèle où le rendu et les trajets disent la même chose. En attendant, **A avec P1** suffit pour les performances.

### P4. Bosquet partagé entre villages (**à confirmer**)

Plusieurs villages coupent le même bosquet, dans un ordre fixe (spec du 27 octobre). Avec P1, le verrou ligne n'est pris qu'à la réservation et au débit. Point à confirmer : un village peut-il réserver un bosquet déjà réservé à 100 % par un voisin ? Le code le refuse (stock disponible = stock − réservations) ; c'est à valider comme règle.

## 4. Questions pour Tristan

1. Problèmes d'arbres que tu vois en jeu : à ajouter au tableau du §2 (captures bienvenues).
2. P3 : faut-il qu'une forêt coupée se referme toute seule sur les chemins ? Si oui, au bout de combien de temps ? Ta préférence entre A, B et C ?
3. Repousse de 14 jours, linéaire : à garder ?
4. Seuil de 10 % pour le défrichage et le blocage : à garder tel quel ?
5. Stock affiché dans la fiche : l'unité entière suffit-elle, avec une projection côté client ?

## 5. Tranches proposées (après décisions)

1. **P1 côté serveur** : tâche de seuil, réveil limité aux transitions dues, plus aucune écriture en lecture. Tests :
   - régression qui compte les lignes écrites et les publications lors d'un bootstrap sans échéance (zéro attendu) ;
   - concurrence entre deux villages voisins (barrières, attente PostgreSQL observée) ;
   - franchissement du seuil à l'instant exact, avec reste conservé.
2. **P2** : référence de repousse dans le contrat ; projection par le client.
3. **P3** selon la décision. Pour C : obstacles par tronc dans le planificateur et dans le réseau persistant (`village_travel_networks`), version du planificateur à monter.
4. Allonger le délai du cache de présentation, puis mesurer chargement et mémoire de l'alpha.

Risques :
- Les invariants économiques (AGENTS.md) concernent directement cette zone. Toute migration de données doit rester additive.
- La tâche de seuil doit survivre à un report de lot et aux retours tardifs : rejeu par échéance, comme `materializeWoodland` le fait aujourd'hui pour les retours physiques.

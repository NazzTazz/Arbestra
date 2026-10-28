# Bosquets : souches, repousse et abattage du vrai arbre

Date : 27 octobre 2026. Base : `wip/v2-commandes-bornees`, `378ac2e`.

Statut : **arbitrages de Tristan intégrés le 27 octobre, implémentation autorisée.** Remplace, pour le bois, l'« arbre accessoire » de [SPEC-CHANTIERS-ANIMES-SEQUENCES.md](SPEC-CHANTIERS-ANIMES-SEQUENCES.md) §6 : l'arbre ajouté en tranche 3 était un leurre, refusé en recette.

## 1. Décisions

| Sujet | Décision |
|---|---|
| Arbre abattu | **Validé** : c'est un vrai arbre du bosquet, même modèle, taille et orientation. Il tremble à chaque coup avant de tomber. Aucun arbre ajouté. |
| Bosquet au fil des lots | **Validé** : il perd ses arbres un par un selon le stock serveur, au lieu de rétrécir en bloc. Même vue pour tous, stable après F5. |
| Compteurs | **Validé** : deux compteurs par bosquet, **bois disponible** (stock actuel moins réservations, existant) et **bois coupé**, cumulé depuis l'origine, repousse comprise, jamais décroissant. Affichés dans la fiche du bosquet. |
| Souches | **Validé** : un arbre coupé laisse une souche, pour toujours. |
| Repousse | **Validé** : un jeune arbre pousse à côté de chaque souche ; adulte, il garde sa souche à côté. |
| Défrichage | **Validé** : seuil actuel inchangé, à 10 % de stock ou moins. Un bosquet complètement récolté ne montre que des souches et de très jeunes pousses. |

## 2. Modèle (pur, client)

Données serveur par bosquet : `initialAmount` I (300), stock physique `remainingAmount` R (repousse comprise), nouveau `cutAmount` C (cumulé). N emplacements d'arbres : les arbres RC1 du bosquet, ou la disposition historique.

- Part d'un emplacement : `B = I / N`. Ordre de coupe fixe et commun à tous les villages (plusieurs villages exploitent le même bosquet) : l'ordre des arbres du bosquet (`treeIndices`, disposition historique : indice).
- Souches : `S = min(N, ceil(C / B))`. Les S premiers emplacements portent une souche.
- Arbres d'origine encore debout : les `N − S` autres, à pleine taille.
- Emplacement en cours (le S-ième, si `C` n'est pas un multiple de `B`) : son tronc est **couché**, de longueur `1 − (C mod B) / B`.
- Jeunes arbres : le bois présent au-delà des arbres d'origine debout, `max(0, R − (N − S) × B − tronc couché)`, est réparti dans l'ordre de coupe sur les emplacements à souche, jusqu'à `B` chacun ; taille ∝ part, minimum visible 15 %.
- Quand un jeune arbre devenu adulte est coupé de nouveau, il tombe à son tour, sa souche reste unique.

## 3. Abattage pendant un lot

Un lot réserve `reservedAmount` (≤ 100) de bois au départ.
- Si le lot entame la part d'un arbre encore debout (d'origine ou repoussé à pleine taille), **cet arbre-là** est abattu en direct : tremblement visible à chaque coup (hache ou scie), chute à l'instant prévu par §6 de la spec des chantiers, puis débitage.
- Sinon, l'équipe débite le tronc déjà couché.
- Pendant le lot, l'instance du bosquet est masquée et remplacée par la même géométrie animée ; à la fin du lot, le bosquet reprend l'état calculé par §2 à partir des données serveur.
- Les règles de temps, d'arrivée en retard, de F5 et de fin de travail de la spec des chantiers s'appliquent sans changement.

## 4. Serveur

- **Compteur stocké** (choix de Tristan, pour la performance avec beaucoup d'arbres) : migration 062, `woodland_deposits.cut_amount`, rempli exactement depuis les lots déjà débités (les lots sont conservés) puis augmenté à chaque débit d'un lot revenu, dans la même instruction que la réservation. La vue `resource_deposits` y ajoute les lots revenus pas encore débités, comme pour le stock. Le défrichage n'y ajoute rien (le reliquat est détruit, pas coupé) ; la repousse ne le diminue jamais.
- Contrat : `StoneDeposit.cutAmount` optionnel, présent pour le bois. Fiche du bosquet (`readStoneDeposit`) : fait. Lecteurs de chunks, spatial V2 et présentation : à ajouter en tranche 3, par une agrégation groupée par bosquet.
- Les trajets serveur ne changent pas : ils utilisent déjà des arbres adultes, indépendamment du stock.

## 5. Mode Exploitation

Retour de Tristan (« ça agace tout le monde ») :
- **Cercles** : aujourd'hui un halo par case de gisement, à son centre (`resource-halos.ts`, `#updateResourceOverlay`), alors que les arbres RC1 sont répartis dans et autour de la case ; et seulement les 128 cases les plus proches de la caméra. Cible : un halo autour du pied de chaque arbre debout (ou repoussé) du bosquet, aux positions exactes de `woodlandTrees`, et rien sur les souches seules ; plafond exprimé en arbres visibles plutôt qu'en cases proches, sans trou au milieu de l'écran.
- **Balayage** : sélectionner en glissant sur les arbres eux-mêmes, pas seulement sur les cercles. Le bosquet porte déjà la sélection par instance (`thinInstanceEnablePicking`, `instanceFeatureIds`) : un arbre touché sélectionne son gisement.

## 6. Tranches

1. Mode Exploitation : cercles au pied des arbres, balayage sur les arbres. Client seul, le plus attendu.
2. Serveur : `cutAmount` stocké (migration 062), contrat ; compteurs dans la fiche du bosquet. **Fait.**
3. Rendu du bosquet : souches, arbres d'origine, tronc couché, jeunes arbres (§2).
4. Abattage du vrai arbre pendant un lot (§3), qui remplace l'arbre accessoire de la tranche 3 des chantiers. **Fait le 28 octobre**, ordre fixe du bosquet (choix de Tristan : plusieurs villages coupent le même bosquet) : le tronc couché d'abord, sinon l'arbre d'origine suivant ; la scène le masque dans le bosquet (instances à l'échelle 0) pendant le lot puis une minute, le chantier le dessine avec la même pièce du kit, à la même place, échelle et rotation. Un lot coupe `reservedAmount / part` d'un tronc : ce qui en reste est le tronc couché que le bosquet montre ensuite. Tremblement de ±0,05 rad à chaque coup.

**Disposition d'équipe** (proposée par la session de mise en scène, 28 octobre ; `#woodPlan`) : tout le chantier se règle sur l'arbre réel. Repère au pied B : A vers la clairière (bout de route), L le long de la lisière. L'arbre tombe selon ±L du côté libre (échantillons tous les 0,4 m sur la longueur du fût), sinon vers la clairière. Bûcheron seul en B + 0,6 A, face au tronc. Binôme 0 en travers de sa chute (B ± 0,49 ⊥ chute) : il abat l'arbre, puis le débite là où il est couché, du bout vers le pied, en avançant d'un pas à chaque tronçon (sa scie suit, plus de tronc de chevalet pour lui) ; si le poste côté bosquet n'est pas libre, l'arbre tombe vers la clairière. Chevalets des autres binômes après le bout du tronc, billots des fendeurs côté clairière à mi-tronc. Tout poste non libre garde sa place d'origine, pour ce rôle seulement. Reste à faire : prise plus basse pendant l'abattage (0,30), scieurs qui se redressent et regardent tomber l'arbre, souche du kit au pied dès la chute, pas lissé entre deux coupes.

## 7. Kit d'arbres

Kit modulaire livré le 27 octobre (`origin/etude/kit-arbres`, `blender-elements/arbres/kit-arbres-b.json`, style B validé par Tristan) : sapins a/b/c et feuillu (un pour quatre sapins), chacun en fût et feuillage séparés, pousses (plant 0,36 m, arbuste 0,96 m), souches a/b, bûche, branche. Format du kit des villageois, un matériau à couleurs de sommet. Il remplace l'arbre procédural de `#buildWoodland`, les formes provisoires et l'arbre accessoire. Arbre couché sans feuillage : remonté de 0,19 × échelle.

## 8. Hors périmètre

Souches comme obstacles de navigation, récompense du défrichage, effets (feuilles, copeaux, poussière) : tranche 5 de la spec des chantiers.

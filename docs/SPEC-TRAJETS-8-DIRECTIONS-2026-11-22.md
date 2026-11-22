# Trajets à 8 directions et recherche à la case

22 novembre 2026, sur `fd7d699`. Statut : **spécification validée par Tristan le 22 novembre** sur ses deux décisions (§1) ; le reste est la cible technique, à vérifier contre le code par chaque tranche avant de coder.

Contexte : [audit du 22 novembre](AUDIT-GLOBAL-2026-11-22.md) §2, [spec de la refonte des trajets](SPEC-REFONTE-TRAJETS-2026-11-10.md) (T1 à T3 livrées, T4 à T6 non faites). Cette spec **remplace T5** (invalidation locale) et prépare T4 et T6.

## 1. Décisions de Tristan (22 novembre)

- **Décision 23.** Les trajets à pied peuvent aller en diagonale (8 directions). Un pas en diagonale coûte √2 fois un pas droit, en durée comme en coût : la règle « coût = durée » (décision 8) est conservée. Un trajet en biais dure donc jusqu'à 29 % de moins. Remplace le « piéton cardinal » de la décision 11.
- **Décision 24.** La refonte du cœur de recherche se fait maintenant, par remplacement : l'ancien code est supprimé dans la même série. Une seule recette de Tristan, sur le résultat final (sentiers en diagonale compris).

## 2. Constat mesuré

Le 22 novembre, sur le dev (Bressuire), la tâche `deposit.worksite.wake` qui a admis trois départs de défrichage (trajets de 34 à 44 cases) a duré **8,2 s** (due 17:00:39,04, terminée 17:00:47,26), sous la ligne du village. Cause probable, à confirmer par profil en R1 : recherche au huitième de case (64 nœuds par case dans les cases boisées), test physique refait à chaque pas, égalités massives de la distance en L.

La contrainte cardinale est présente à sept niveaux : les cinq recherches (4 voisins, Manhattan) ; `canWalkSpawnSegment` (erreur sur un segment non cardinal, `spawn-access.ts:25`) ; `travelDuration` (|dx| + |dy|) ; `desireEdges` et `world_desire_edges` (directions est et sud, diagonales jetées) ; le rendu (tracés, braseros, raccords) ; les promenades client ; la décision 11.

## 3. Cible

### 3.1 Modèle de chemin

Un chemin de mission est une suite de **centres de cases** reliés par des pas unitaires vers l'un des 8 voisins, plus un connecteur de porte à chaque extrémité qui en a une (seuil, point extérieur, premier centre). Un pas dont la ligne droite est gênée par un obstacle plus petit qu'une case (tronc, accessoire) porte un **détour local** au huitième de case, contenu dans ses deux cases. Le chemin persisté reste une liste de points `TravelCell` : les chemins cardinaux déjà persistés restent valides, animation et durée comprises.

### 3.2 Praticabilité précalculée par chunk

Le maillage par chunk existe déjà pour le commerce : `ChunkNavigationMesh` (`contracts/src/chunk-navigation-mesh.ts`, 2 bits par arête cardinale dirigée), table `navigation_chunk_meshes`, invalidation par `navigation_chunk_versions`. **On l'étend, on n'en crée pas un second.**

- Par case, 4 arêtes non dirigées (est, sud-est, sud, sud-ouest), 2 bits chacune : inconnue, bloquée, droite, coudée (détour local). Le test de pente et d'obstacle est symétrique ; à vérifier.
- Une arête est certifiée une fois, à la demande, par le test physique existant généralisé aux segments obliques ; si la ligne droite est bloquée par un obstacle fin, par une petite recherche au huitième bornée aux deux cases (128 nœuds au plus). Le résultat est rangé dans le maillage du chunk et persisté.
- **Diagonale** : permise seulement si elle est certifiée droite et si les quatre arêtes cardinales du carré qu'elle traverse sont praticables. Aucun passage entre deux coins.
- Tout ce qui bloque aujourd'hui une recherche de village doit bloquer ici : emprises, réservations, gisements bloquants, eau, pentes, troncs, bordures, accessoires. Les parcelles de jardin actives restent traversables au coût `GARDEN_CROSSING_COST`. R1 commence par l'inventaire des écarts entre le contexte de village (`refineTravelRoute`) et le contexte mondial (`navigation/context.ts`), et l'écrit au §6.
- Nouveau format : nouvelle version de politique (`rc1-pedestrian-2`) ; les maillages de l'ancien format sont ignorés puis purgés.

### 3.3 Une seule recherche

A* sur les cases, 8 voisins, heuristique octile × 0,7.

- **Coût d'un pas** : longueur (1 ou √2) × moyenne des facteurs de ses deux cases (0,7 pour une case de route, 1 sinon) × facteur jardin. `travelDuration` applique la même règle au chemin persisté, en longueur euclidienne par segment ; pour un chemin cardinal existant le résultat est inchangé.
- **Départage à coût égal**, déterministe : le moins de changements de direction. Le coût et la durée n'en dépendent pas.
- **Borne** : les cases du domaine (région du village), et non plus cases × 64. Les trois issues `found`, `unreachable`, `budget` de T2b sont conservées, avec leur sémantique.
- **Aucun cache de routes** : la recherche doit être assez rapide pour s'en passer. Seul le maillage est mis en cache. Les caches `networkCache`, alias, `refinementCaches` et `passageCaches` disparaissent avec le code qu'ils servent.
- Cette recherche sert les missions de village (bois, pierre, souches, jardins par jambes, science locale). Commerce et expéditions y passent ensuite (R3) ; d'ici là leur planificateur continue de fonctionner sur le maillage étendu ou sur son test direct.

### 3.4 Sentiers, rendu, braseros (R2)

- `world_desire_edges.direction` : 0 est, 1 sud, 2 sud-est, 3 sud-ouest (migration additive, contrainte élargie). `desireEdges` compte les pas en diagonale au lieu de les jeter. L'entité V2 `desirePaths` gagne `southEast` et `southWest` ; client et serveur se déploient ensemble.
- Rendu : sentiers de terre en diagonale, raccordés aux cases de route (qui restent carrées) et aux autres sentiers.
- Braseros automatiques : aux **carrefours** (trois bras ou plus) et aux **extrémités**, plus aux simples coudes. Les identités par nœud restent stables : un brasero éteint ou supprimé le reste.
- **Sentier battu** (proposé par défaut, constante réglable) : un pas le long d'un sentier visible coûte 0,9. Les trajets se regroupent sur les sentiers existants au lieu de tracer des colonnes parallèles. Effet sur les durées : 10 % au plus sur la part du trajet qui suit un sentier. À confirmer par Tristan à la recette ; 1 désactive.
- Seuil d'apparition : inchangé (3 passages par bord). À rejuger à la recette, une fois les trajets regroupés.
- Promenades de loisir du client : 8 directions sur les sentiers et les routes.

## 4. Tranches

| Tranche | Contenu | Dépend de |
|---|---|---|
| **R1** | Profil des 8,2 s ; maillage étendu ; recherche à la case à 8 directions pour les missions de village ; `travelDuration` euclidienne ; suppression de la recherche fine, de ses raccourcis et de ses caches ; mesures avant et après | — |
| **R2a** | Sentiers en base et dans le flux V2 à 4 directions ; `desireEdges` ; conversion en routes d'affichage | — (interface du §3.1) |
| **R2b** | Rendu des diagonales, raccords, braseros aux carrefours, sentier battu, promenades | R1, R2a |
| **Recette** | Tristan, dev local, mode 0 | R2b |
| **R3** | T4 (retrait du réseau « tous buts », du drapeau, de la recherche grossière), commerce et expéditions sur la recherche unique, calcul hors verrou si encore utile (T6) | Recette |

## 5. Critères d'acceptation

- **Vitesse (R1)** : sur le dev, les trois trajets de défrichage du 22 novembre (hôtel de ville vers (259, 216), (258, 219), (262, 223)) : avant et après, à froid et maillage chaud. Cible : moins de 50 ms par trajet maillage chaud, moins de 500 ms à froid. Un dépassement est rapporté avec son profil, pas masqué.
- **Équivalence d'accessibilité (R1)** : sur les fixtures existantes (douves, jardins enclos, cibles en forêt, couture du tore, portes), mêmes verdicts `found` / `unreachable` qu'avant ; tout écart est listé et expliqué. Coût du nouveau chemin ≤ coût de l'ancien, à l'arrondi près, hors détours locaux.
- **Test déterministe de chemin chaud (R1)** : nombre de certifications d'arêtes borné par trajet maillage chaud (zéro), et nœuds visités ≤ cases du domaine.
- **Diagonales** : aucune entre deux coins d'emprises ; test dédié.
- **Durées** : chemin cardinal persisté, durée inchangée au milliseconde près ; chemin en biais, durée √2 par pas diagonal.
- **Sentiers (R2a)** : un pas diagonal compte un passage sur son arête ; aller-retour compté une fois ; couture du tore ; migration réversible.
- **Invariants conservés** : ordre des verrous, admissions, énergie sur durée figée, `world_id`, coordonnées canoniques, aucune écriture nouvelle dans les transactions de commande.
- **Suppression** : à la fin de R1, `refineTravelRoute` et ses caches n'ont plus d'appelant de mission ; ce qui ne sert plus qu'au réseau d'affichage est marqué pour R3.

## 6. Inventaire et écarts (à remplir par R1 avant de coder)

À écrire ici : ce que bloque chaque contexte, les écarts, le choix retenu ; puis le profil des 8,2 s.

## 7. Journal des tranches

Les mesures et preuves de chaque tranche vont dans son commit ; cette section ne reçoit qu'une ligne de statut par tranche.

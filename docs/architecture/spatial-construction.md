# Construction spatiale et Jardin surfacique

Statut : **implémenté dans le worktree**. Preuves serveur et navigateur du 30 septembre dans la [reprise courante](../../SESSION-HANDOFF.md).

## Principe

Depuis 029, une construction de maison peut fournir `houseVariant: stone | logs | beams` (défaut API `stone`). Les deux chemins de commande, cellule et sélection spatiale, persistent respectivement `stone-house`, `log-house` ou `beam-house` dans `visual_layout`, avec la même emprise et les mêmes coûts actuels. Le matériau est inclus dans le reçu idempotent ; une amélioration conserve la recette et l'orientation. Aucun stock de bois transformé ni déblocage d'ère n'est créé dans cette passe. Le rendu compilé et sa génération sont décrits dans la [spec factory](../SPEC-FACTORY-BATIMENTS.md).

Depuis la tranche Infrastructure (028), le placement accepte `quarterTurns` (0 à 3, défaut legacy 0). Ghost, vraie emprise rectangulaire, accès et rendu utilisent la même transformation ; une amélioration conserve l'orientation. Une voie manuelle ou un équipement doit être retiré/déplacé avant de réserver son emplacement pour un nouveau bâtiment. L'invariant est revalidé au serveur, y compris pour les plans voisins du même monde ; les trajets engagés sont protégés. La touche R ne modifie pas la seule apparence du mesh. Voir la [spec Infrastructure](../SPEC-INFRASTRUCTURE-VOIRIE-ATELIER.md).

Le snapshot expose aussi `village.townHallBuildingId` : l'ancre du village n'est pas nécessairement celle du bâtiment hôtel de ville, ni une case de son emprise. Le routage utilise cette identité issue des bâtiments du village, y compris dans le contexte territorial contenant des voisins. Le raffinement local des accès conserve la préférence du réseau commun ; un accès physiquement bloqué ne reçoit pas de trajet traversant les emprises.

Un bâtiment `spatial` possède une emprise variable. Sa superficie et son niveau sont deux axes distincts :

- `level` choisit une éventuelle variante technologique ;
- la superficie est le nombre de cellules actives de `world_cell_occupancies` ;
- une cellule réservée par un chantier appartient déjà au bâtiment, mais ne produit pas et n’étend pas la zone constructible.

Dans cette tranche, le Jardin reste au niveau 1. Il n’existe plus de « Jardin niveau 2 » : un Jardin de deux cellules est un Jardin niveau 1 de superficie 2.

## Catalogue et économie

Pour un type `spatial`, les coûts, productions et capacités du niveau courant sont des valeurs **par cellule**. Aucun nouveau catalogue générique n’est créé.

Jardin niveau 1 :

- coût : `50 bois × cellules nouvellement construites` ;
- production : `60 carottes/h × cellules actives` ;
- capacité : `600 carottes × cellules actives` ;
- la durée configurée s’applique au chantier complet et n’est pas multipliée par la surface dans cette tranche.

Chaque parcelle active possède son stock, son reliquat et son curseur dans `garden_plots`. Une nouvelle parcelle commence à produire à l'échéance exacte de son chantier ; les parcelles existantes gardent leurs propres curseurs. Une capacité atteinte suspend la production de cette parcelle jusqu’à sa récolte.

Les stocks et productions matérialisées restent entiers avec reliquat exact selon [Économie](./economy.md).

## Données minimales

Ajouter `building_expansions` :

- `id`, `world_id`, `village_id`, `building_id` ;
- `status` : `under-construction | completed` ;
- `started_at`, `completes_at`, `completed_at`, `created_at` ;
- clés étrangères composites garantissant monde, village et bâtiment ;
- index unique partiel : une seule expansion non terminée par bâtiment.

Ajouter `pending_expansion_id` nullable à `world_cell_occupancies` :

- nullable = cellule active, sous réserve que le bâtiment initial soit terminé ;
- renseigné = cellule réservée par cette expansion ;
- uniquement permis pour une occupation de bâtiment avec rôle `extension` ;
- clé étrangère composite garantissant le même monde et le même bâtiment.

Une construction initiale continue d’utiliser `buildings.status = under-construction` pour toute son emprise. Une extension ultérieure ne remet jamais le bâtiment en chantier : le Jardin reste `completed` et exploitable pendant que ses nouvelles cellules sont réservées.

## Sélection de cellules

Le composant client de sélection produit des coordonnées ; il ne décide ni du coût ni de la validité métier.

Version initiale :

- surface rectangulaire pleine, sans trou ;
- coordonnées normalisées sur le tore et cellules uniques ;
- rectangles traversant une couture torique autorisés via les voisinages enveloppés ;
- maximum technique initial de 100 cellules par commande, configurable et non présenté comme une règle d’équilibrage.

Construction initiale : toutes les cellules doivent être constructibles avant la commande. Elles ne peuvent pas utiliser leur propre chantier pour étendre le rayon de construction.

Extension : le geste décrit un rectangle complet. Une cellule active d'un Jardin logique du même village est tolérée et gratuite ; seules les cellules libres sont réservées et facturées. Une cellule en chantier ou occupée par un autre objet rejette toute la commande. Le rectangle doit recouvrir ou toucher par un côté le Jardin actif ; une diagonale seule ne suffit pas. Un rectangle sans cellule nouvelle est un no-op sans débit ni tâche.

## Cycle de vie

### Nouveau Jardin

Dans une transaction :

1. verrouiller les invariants du village nécessaires ;
2. normaliser et valider tout le rectangle ;
3. calculer puis débiter `50 × aire` une seule fois ;
4. créer un unique bâtiment `under-construction` ;
5. réserver toutes ses occupations, dont une ancre explicite ;
6. créer une seule tâche `building.complete`.

À l’échéance logique, le bâtiment devient `completed`, toutes ses cellules deviennent actives et son buffer démarre à cette échéance.

### Extension

Dans une transaction :

1. verrouiller le Jardin et vérifier l’absence d’expansion courante ;
2. classer le rectangle complet entre parcelles existantes tolérées, nouvelles cellules et obstacles ;
3. valider et réserver uniquement les nouvelles cellules ;
4. débiter `50 × nouvelles cellules` une seule fois ;
5. créer `building_expansions` et une tâche `building-expansion.complete`.

À l’échéance logique, le handler active les occupations de l’expansion, crée leur état `garden_plots` avec `production_updated_at = completes_at`, puis termine l’expansion. Une réconciliation à la lecture applique la même règle si le worker est en retard.

Le handler est transactionnel et idempotent. La clé primaire des occupations arbitre les collisions concurrentes ; un échec ne laisse ni débit, ni chantier, ni cellule réservée.

## Récolte

Les Jardins actifs du même village qui se touchent par un côté forment une composante logique unique, y compris à travers une couture du tore. Le snapshot choisit le plus petit UUID comme identifiant canonique et réécrit les footprints publics vers lui sans supprimer les bâtiments physiques historiques. Un contact diagonal ne fusionne pas ; une liaison en chantier fusionne seulement à son achèvement.

Chaque parcelle contenant au moins une carotte se récolte séparément avec un habitant. Plusieurs trajets peuvent coexister sur des parcelles distinctes ; une parcelle en trajet continue de produire mais refuse un second départ. Le clic maintenu/glissé parcourt toutes les cases du segment dans l'ordre, déduplique celles déjà visitées et envoie les commandes dans une file séquentielle. Le manque d'habitants arrête les départs suivants du geste. Un bouton par parcelle fournit le chemin clavier.

## Contrats HTTP

La construction utilise une sélection explicite :

`POST /api/worlds/:slug/villages/:villageId/buildings`

```json
{
  "buildingType": "garden",
  "anchorCellX": 1024,
  "anchorCellY": 512,
  "cells": [{ "cellX": 1024, "cellY": 512 }]
}
```

Pour un bâtiment non spatial, `cells` contient exactement une cellule. L’ancre doit toujours appartenir à la sélection.

Une extension utilise :

`POST /api/worlds/:slug/villages/:villageId/buildings/:buildingId/expansions`

avec `{ "cells": [...] }`. L’ancien upgrade spatial par cellule unique est retiré ; l’upgrade vertical reste inchangé.

Une récolte utilise le même endpoint historique avec une cible explicite :

`POST /api/worlds/:slug/villages/:villageId/buildings/:buildingId/harvest`

avec `{ "commandId": "…", "cellX": 1024, "cellY": 512 }`. Le reçu est idempotent pour cette coordonnée ; réutiliser son identifiant sur une autre parcelle produit `COMMAND_ID_CONFLICT`.

Le snapshot Jardin expose :

- `activeCellCount`, `pendingCellCount` ;
- `expansions`, toutes les extensions en cours avec `id`, `startedAt`, `completesAt` et leurs cellules propres ; `expansion` conserve la première pour compatibilité ;
- `plots`, avec coordonnées, stock projeté, capacité, taux, saturation et trajet éventuel ;
- chaque `VillageCell.footprint.state` reste `active | reserved`.

Le client peut retrouver l’ancre dans `state.cells` grâce au `buildingId` d’une extension ; il ne duplique pas l’objet bâtiment sur chaque cellule.

## UX

Mode normal :

- aucune action « case libre » ;
- grille réduite au contour discret de la zone aménageable ;
- bâtiments et emprises existantes restent sélectionnables.

Mode **Construire** :

- entrée par une commande dédiée au bord inférieur du monde, raccourci `B` sur desktop ;
- contours blancs continus et léger voile bleuté sur les seules cellules `canBuild` du snapshot, suivant le relief et masqués par les bâtiments et features au premier plan ;
- choix du type, puis sélection de surface ;
- Jardin : drag rectangulaire desktop, premier/deuxième coin au tactile ;
- aperçu distinct des parcelles existantes, nouvelles et obstacles, avec coût sur les seules nouvelles cellules ;
- confirmation explicite avant toute commande serveur.

Le bouton **Étendre** d’un Jardin réutilise ce sélecteur, limité aux extensions valides. Annuler une prévisualisation ne produit aucune écriture. Une commande confirmée n’est pas annulable dans cette tranche.

**Gérer les Jardins** ouvre directement le seul Jardin ou propose toutes les composantes, avec leurs coordonnées. Après une fusion, le choix se résout vers la composante restante. Chaque parcelle possède un bouton accessible au clavier. Le glissé de récolte parcourt les intersections réelles du segment avec la grille, y compris le dernier segment au relâchement, et déduplique les coordonnées canoniques. Hors construction, un départ sur une parcelle récoltable consomme le glissé ; départ sur sol libre, glissé droit et zoom conservent les commandes caméra.

La file client ordonne les départs. Une réponse réseau incertaine garde le même reçu par monde/village/coordonnée, même si la fusion change l'ID canonique ou si un snapshot montre déjà le trajet. Reprise automatique toutes les deux secondes et au retour en ligne/focus, ou bouton Réessayer ; les cibles suivantes attendent sa résolution. Un manque d'habitants abandonne les départs restants du geste sans réservation différée. Indicateur de parcelle et bouton en attente sont distincts d'un trajet accepté ; le symbole plein reste une présentation du snapshot. Les intentions sont conservées pendant la session React, sans persistance après rechargement complet.

## Migration des Jardins existants

- Jardin terminé : conserver toutes ses occupations comme actives, fixer `level = 1`, recalculer taux et capacité depuis leur nombre.
- Migration 015 : matérialiser chronologiquement les changements échus et la production due à sa borne commune avant répartition par quotient/reste ; conserver le reliquat exact et laisser les trajets globaux déjà partis terminer une seule fois. Voir [Économie](./economy.md) pour la limite sur les bases déjà migrées.
- Construction initiale en cours : conserver le bâtiment et toute son emprise sous `buildings.status`.
- Ancien passage niveau 1 → 2 en cours : convertir ses timestamps et sa cellule réservée en `building_expansions`, remettre le Jardin existant à `completed`, niveau 1.
- Supprimer les lignes catalogue Jardin niveau 2 ; les valeurs Jardin niveau 1 deviennent les valeurs par cellule.

Aucune carotte accumulée ni aucun coût déjà payé ne doit être perdu ou rejoué.

## Validation ciblée

- coût, production et capacité proportionnels à l’aire active ;
- rectangle atomiquement réservé, y compris sous concurrence ;
- cellule invalide = rejet complet et aucun débit ;
- cellules réservées non productives et non propagatrices du rayon constructible ;
- Jardin récoltable pendant son extension ;
- complétion et réconciliation idempotentes ;
- clic sur toute cellule = même Jardin ;
- migration fidèle des Jardins à une et deux cellules.

Les défauts de la [recette du 7 septembre](../REVIEW-2026-09-07-JARDINS.md) sont corrigés. Chromium desktop et Pixel 7 couvrent glissé rapide, retour sur ses pas, manque d'habitants, clavier, caméra, extension tolérante, fusion visible et réponse perdue ; les tests SQL couvrent saturation à la migration, échéances, concurrence forcée et rollback. La recette finale ouvre aussi un village après exécution de la vraie migration 015 et vérifie la protection puis la livraison unique de son ancien trajet global. La reprise courante précise les fixtures et les limites de cette validation.

## Hors scope

Décorations, formes libres peintes cellule par cellule, routes, suppression de cellules, démolition, automatisation de récolte, niveaux technologiques du Jardin et équilibrage des durées.

La sélection géométrique pourra servir plus tard aux zones décoratives, mais cette tranche ne crée ni modèle générique de zone ni système décoratif.

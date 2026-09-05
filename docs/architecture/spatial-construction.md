# Construction spatiale et Jardin surfacique

Statut : **implémentation dans le worktree ; validation UX desktop/tactile manuelle en attente**.

## Principe

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

Avant toute variation de superficie active, le buffer est matérialisé au timestamp PostgreSQL de l’échéance avec son ancien taux et son ancienne capacité. Le nouveau taux commence à cette échéance. Une capacité atteinte suspend toujours la production jusqu’à une récolte ou une augmentation de surface.

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

Extension : toutes les cellules sont nouvelles, forment un rectangle et au moins l’une partage un côté avec une cellule **active** du Jardin. Une diagonale seule ne suffit pas.

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
2. matérialiser son buffer au temps PostgreSQL courant ;
3. valider et réserver toutes les nouvelles cellules ;
4. débiter `50 × nouvelles cellules` une seule fois ;
5. créer `building_expansions` et une tâche `building-expansion.complete`.

À l’échéance logique, le handler matérialise d’abord le buffer jusqu’à `completes_at` avec l’ancienne superficie, active toutes les occupations de l’expansion, puis termine l’expansion. Une réconciliation à la lecture applique la même règle si le worker est en retard.

Le handler est transactionnel et idempotent. La clé primaire des occupations arbitre les collisions concurrentes ; un échec ne laisse ni débit, ni chantier, ni cellule réservée.

## Récolte

Toute cellule de l’emprise renvoie au même `building_id`. Cliquer l’ancre, une extension active ou une extension en chantier ouvre donc le même Jardin.

La récolte reste possible pendant une extension et ne concerne que la production accumulée par les cellules actives. Le verrou du buffer continue d’interdire toute double récolte.

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

Le snapshot Jardin remplace `extensionCell` et `pendingExtensionCell` par :

- `activeCellCount`, `pendingCellCount` ;
- une éventuelle expansion avec `id`, `startedAt`, `completesAt` et ses cellules ;
- chaque `VillageCell.footprint.state` reste `active | reserved`.

Le client peut retrouver l’ancre dans `state.cells` grâce au `buildingId` d’une extension ; il ne duplique pas l’objet bâtiment sur chaque cellule.

## UX

Mode normal :

- aucune action « case libre » ;
- grille réduite au contour discret de la zone aménageable ;
- bâtiments et emprises existantes restent sélectionnables.

Mode **Construire** :

- entrée par une commande dédiée au bord inférieur du monde, raccourci `B` sur desktop ;
- grille détaillée des cellules valides ;
- choix du type, puis sélection de surface ;
- Jardin : drag rectangulaire desktop, premier/deuxième coin au tactile ;
- aperçu du nombre de cellules, du coût total et des invalidités ;
- confirmation explicite avant toute commande serveur.

Le bouton **Étendre** d’un Jardin réutilise ce sélecteur, limité aux extensions valides. Annuler une prévisualisation ne produit aucune écriture. Une commande confirmée n’est pas annulable dans cette tranche.

## Migration des Jardins existants

- Jardin terminé : conserver toutes ses occupations comme actives, fixer `level = 1`, recalculer taux et capacité depuis leur nombre.
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

La validation navigateur desktop/tactile est manuelle par le product owner.

## Hors scope

Décorations, formes libres peintes cellule par cellule, routes, suppression de cellules, démolition, automatisation de récolte, niveaux technologiques du Jardin et équilibrage des durées.

La sélection géométrique pourra servir plus tard aux zones décoratives, mais cette tranche ne crée ni modèle générique de zone ni système décoratif.

# Espace mondial et occupation

Statut : **spécification autoritaire implémentée**.

## But

PostgreSQL doit pouvoir décider si une cellule canonique `(world_id, cell_x, cell_y)` est libre, occupée et constructible. Cette vérité est commune aux bâtiments, chantiers et éléments exploitables du monde.

Une cellule vide est implicite : aucune ligne SQL ne doit être créée uniquement pour déclarer de l’herbe libre.

## Coordonnées

- Toutes les entrées sont normalisées modulo `width_cells` et `height_cells` avant lecture ou écriture.
- Distances et voisinages utilisent les plus courts écarts sur le tore.
- `CELL_SIZE` reste exclusivement une échelle Babylon.

## Modèle

### `world_feature_types`

Catalogue minimal : `code`, `blocks_construction`. Les premiers codes seront ajoutés par la génération du monde.

### `world_features`

Une feature est une entité mondiale persistante : `id`, `world_id`, `feature_type_code`, `state`, `variant_seed`, timestamps. Une feature peut occuper plusieurs cellules.

### `world_cell_occupancies`

Empreinte universelle et clairsemée :

- `world_id`, `cell_x`, `cell_y` : clé primaire ;
- `building_id` nullable ;
- `feature_id` nullable ;
- `role` : `anchor`, `extension` ou `body` ;
- contrainte : exactement une référence parmi `building_id` et `feature_id` ;
- clés étrangères garantissant que l’occupant appartient au même monde.

La clé primaire est l’arbitre final : deux transactions ne peuvent jamais réserver la même cellule.

`world_cell_occupancies` remplace `building_cells`. `village_cells` et les cellules libres précréées sont retirées après migration de leurs données.

## Invariants métier

- Toute l’emprise d’un bâtiment est réservée dès le début de sa construction.
- L’extension d’un bâtiment est réservée dans la même transaction que son coût et sa tâche différée.
- Une construction terminée conserve les mêmes occupations ; seul son état métier change.
- Une transaction qui échoue ne laisse ni coût débité, ni tâche, ni occupation.
- Une feature bloquante interdit construction et extension.
- Le client ne décide jamais qu’une cellule est libre.

## Zone constructible d’un village

Une cellule est candidate si :

1. sa distance de Chebyshev torique à au moins une cellule d’emprise d’un bâtiment **terminé** du village est inférieure ou égale à 5 ;
2. son terrain autorise la construction ;
3. aucune occupation n’existe ;
4. elle n’appartient pas à une clairière protégée non attribuée.

Les chantiers occupent leur emprise mais n’étendent pas encore la zone. La zone est dérivée à la lecture et n’est pas persistée.

Le client ne dessine la grille interactive que pour les cellules exposées par cette dérivation. La région de terrain reçue n’est pas implicitement constructible et un clic hors d’une géométrie interactive ne sélectionne aucune cellule.

## Commandes et contrats

- Construire : `POST /api/worlds/:slug/villages/:villageId/buildings` avec `{ buildingType, cellX, cellY }`.
- Améliorer spatialement : le corps contient `{ extensionCellX, extensionCellY }` lorsque requis.
- Les anciennes commandes adressées par `cellId` sont retirées.
- Les cellules exposées au client sont identifiées par leurs coordonnées canoniques ; une clé UI peut être `${cellX}:${cellY}`.

La commande de construction recalcule la zone, vérifie le terrain et tente les occupations dans sa transaction autoritative. Un conflit de clé devient une erreur métier `CELL_OCCUPIED`.

## Migration

1. Créer features et occupations.
2. Copier chaque `building_cell` en occupation avec ses coordonnées actuelles.
3. Faire lire et écrire les services via les occupations.
4. Modifier les contrats et le client.
5. Supprimer `building_cells`, `village_cells` et `buildings.anchor_cell_id` devenus inutiles.

La migration conserve strictement les bâtiments et extensions existants.

## Validation ciblée

- normalisation et distance aux jointures du tore ;
- conflit atomique bâtiment/bâtiment et bâtiment/feature ;
- réservation atomique d’une empreinte multizone ;
- rayon de 5 calculé depuis toute l’emprise terminée ;
- chantier non influent mais déjà occupant ;
- Jardin niveau 2 toujours jointif et réservé une seule fois.

## Hors scope

Extraction, terrassement, rendements des gisements, territoire politique, quêtes, spawn, streaming et rendu 3D du tore.


## Pierre épuisée (012)

La position persiste dans `stone_deposits` après suppression de l’occupation. Le snapshot conserve la feature depleted comme trace, qui ne bloque pas `canBuild`. La cellule libérée reste soumise au terrain et aux autres règles de construction. Les commandes recherchent le UUID dans le monde, jamais dans la fenêtre 64×64. Les rochers sont invalidés individuellement par ID/révision, indépendamment du terrain.

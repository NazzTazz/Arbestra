# Génération d’un monde

Statut : **spécification autoritaire implémentée — génération v2**.

## But

La création d’un monde exécute une génération déterministe une seule fois. Son résultat persiste dans PostgreSQL et reste identique après déploiement, redémarrage ou évolution d’un futur générateur.

Configuration initiale : tore rectangulaire `2048 × 1024`, chunks `32 × 32`, objectif de 500 grands villages.

## Cycle de vie

`worlds` reçoit `generation_version`, `generation_status` (`pending`, `generating`, `ready`, `failed`) et `generated_at`.

- Aucun spawn n’est possible avant `ready`.
- `generateWorld(worldId)` prend un verrou advisory par monde.
- Un monde `ready` n’est jamais régénéré implicitement.
- Terrain, clairières, features et occupations sont écrits dans une transaction unique, puis le monde passe à `ready`.
- Un crash annule tout. Une relance avec la même seed et la même version produit le même monde.
- `scheduled_tasks` n’est pas détourné en queue de génération.

Le générateur utilise un PRNG non cryptographique stable et explicite. `Math.random()` est interdit.

## Terrain par chunks

`world_chunks` contient : `world_id`, `chunk_x`, `chunk_y`, `generation_version`, `terrain_codes`, `elevations`, timestamps. La clé est `(world_id, chunk_x, chunk_y)`.

- Chaque tableau contient 1 024 entiers en ordre `local_y * 32 + local_x`.
- Les valeurs d’élévation sont quantifiées et raccordées entre chunks.
- Le générateur est périodique sur les deux axes : aucune couture aux bords du rectangle.
- Une future modification locale du terrain utilisera des overrides clairsemés ; elle ne régénérera pas le chunk.

Types initiaux :

- `grassland` : constructible ;
- `water` : non constructible ;
- `rocky_ground` : non constructible avant futur terrassement.

`rocky_ground` est un terrain. `stone_outcrop` est une feature exploitable : les deux notions ne doivent pas être confondues.

## Clairières de spawn

`world_clearings` contient : monde, centre canonique, rayon intérieur, rayon de transition, statut et éventuel village attributaire.

Version actuelle :

- 600 clairières pour un objectif de 500 villages ;
- rayon intérieur aplani : 12 cellules ;
- noyau de spawn `5 × 5` garanti libre de toute feature ;
- distance torique minimale entre centres : 40 cellules ;
- rayon de transition configurable par le générateur v1.

La clairière est aplatie et convertie en prairie. La génération v2 conserve son noyau central `5 × 5` vide et place quatre gisements déterministes et espacés entre les distances 3 et 8 : trois `woodland` et un `stone_outcrop`. La transition réduit progressivement la densité des features naturelles extérieures.

Une clairière non attribuée est protégée contre toute construction ordinaire. Plus tard, une commande explicite de colonisation pourra l’attribuer à un acteur disposant d’une autorisation exceptionnelle. Cette tranche n’implémente ni quête ni système générique de permissions.

## Features générées

Types initiaux :

- `woodland` : une cellule métier affichant une petite recette de 2 à 4 arbres ;
- `stone_outcrop` : une cellule ou petite emprise rocheuse.

Les features sont persistées dans `world_features` et réclament leurs cellules dans `world_cell_occupancies`. Elles ne sont jamais placées dans le noyau central `5 × 5`. Les quelques gisements de clairière invitent à la future exploitation sans compromettre le spawn.

L’extraction et les rendements sont reportés. Cette tranche garantit seulement existence, emprise, collision et rendu.

## Décor non exploitable

Fleurs, herbes, petits cailloux et variations mineures sont générés côté client par une fonction déterministe de `(world seed, generation version, coordonnées)`.

- Ils ne bloquent jamais une cellule.
- Ils disparaissent sur terrain incompatible ou cellule occupée.
- Tout arbre visible comme arbre et tout rocher visiblement bloquant doivent provenir d’une feature serveur.

## Pipeline v2

1. Produire des champs périodiques d’élévation et d’humidité.
2. Classifier prairie, eau et terrain rocheux.
3. Sélectionner 600 centres suffisamment espacés ; échouer explicitement si la garantie est impossible.
4. Aménager les clairières et leurs transitions.
5. Placer déterministiquement les gisements naturels puis quatre gisements légers hors du noyau `5 × 5` de chaque clairière.
6. Persister chunks, clairières, features et occupations.
7. Marquer le monde `ready`.

Les seuils visuels et densités appartiennent au fichier de configuration du générateur, pas au schéma SQL.

## Contrat de lecture initial

Le snapshot du village reçoit une région fixe de `64 × 64` cellules autour de son ancre : origine canonique, terrains, élévations et features. La représentation reste compatible avec les chunks, sans implémenter maintenant un moteur de streaming.

Babylon :

- construit le sol depuis les données reçues ;
- instancie les recettes `woodland` et `stone_outcrop` ;
- conserve React hors du rendu 3D ;
- ne recalcule aucune collision ou constructibilité.

## Monde de développement existant

La migration crée uniquement le schéma. Une commande explicite génère `aube`. Les villages déjà présents deviennent des clairières revendiquées obligatoires : leur voisinage est aplani et aucune feature ne peut recouvrir une occupation existante.

`db:seed` peut garantir la génération d’un monde absent ou `pending`, mais ne modifie jamais un monde `ready`. La migration v2 enrichit explicitement les mondes v1 avec les seuls gisements de clairière ; terrain, bâtiments et features existantes sont conservés.

## Validation ciblée

- même seed/version : résultat identique ; seed différente : résultat différent ;
- raccord parfait sur les quatre bords du tore ;
- tableaux de chunks complets et coordonnées canoniques ;
- 600 clairières espacées et protégées ;
- noyau `5 × 5` libre et quatre gisements hors noyau par clairière ;
- aucune feature sur une occupation existante ;
- transaction atomique et retry après échec ;
- lecture/rendu de la région autour du village existant.

## Hors scope

Spawn, colonisation exceptionnelle, extraction, terrassement, régénération des ressources, biomes avancés, déplacements, brouillard de guerre, streaming et planète-donut.

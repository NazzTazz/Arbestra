# Installation RC1 — candidate de contre-recette

État au 10 octobre 2026 : **implémentée / à valider**, avant ouverture d’un monde réel. Cette tranche prolonge l’[atlas](IMPLEMENTATION-ATLAS-RC1.md) et la [spec](SPEC-CARTE-SPAWN-RC1.md#7-parcours-suivant--starter-kit-et-terrassement). Elle comprend aussi le travail atlas et le starter compact auparavant non committés depuis `06837b9`.

## Parcours et réemploi

`SpawnPlacement` charge le kit et le terrain puis fournit un état local de préparation à **App → VillageScene → BabylonVillageScene**. Aucun village ni compte économique n’est créé par cet état de rendu. Le HUD ouvre **Construire**, avec seulement **Village initial** et **Hôtel de ville**. Population, Exploitation et le bouton de gestion des habitants sont indisponibles avant l’HDV confirmé par le serveur. Après sa pose, les modes deviennent accessibles ; les éléments gratuits restants et les constructions ordinaires se trouvent dans Construire.

La scène de pose séparée a été retirée après le rappel de Tristan. Picking, gestes, coordonnées toriques, bordures, streaming et palette sont ceux du village. `previewCells` sert aux emprises ordinaires et composées. Le diagnostic spécialisé adapte les règles RC1 (nettoyage gratuit, voisins, territoires) à cet aperçu ; il ne possède ni caméra ni moteur de scène. Le serveur recontrôle chaque pose.

L’aperçu du kit est un groupe conservé en cache, chargé depuis les assets de bâtiments précalculés existants ; mouvements et rotations ne reconstruisent pas leur géométrie. Les clones de présentation permettent des matériaux transparents sans modifier les instances des bâtiments posés. Les jardins utilisent leur surface de prévisualisation. R tourne une fois par pression ; clic gauche pose ; clic droit / Échap sélectionne le placement manuel, HDV en premier.

## Autorité et persistance

- Migration additive **038** : installation/version de kit, inventaire restant, reçus de commandes, terrasses et provenance des agrégats naturels. Appliquée uniquement à `127.0.0.1/arbestra_test`.
- Pose initiale : compte, nouveau village, verrou spatial du monde, snapshot frais, calcul borné en worker, puis écritures dans une transaction. Le timestamp économique suit l’acquisition des verrous. Source RC1 inchangée ; les terrasses et indices d’arbres retirés sont des ajouts séparés.
- Pose restante : propriétaire et `world_id`, `beginVillageEconomy`, règles d’emprise à la hauteur initiale, portée de construction existante, consommation d’un élément identifié. Retry conservant la même commande ; aucune nouvelle population ou dotation.
- Première projection naturelle : **2 000 pierres par formation `stoneSite`** (28 formations, pas 177 rochers décoratifs). Bois à 500 par arbre, stock regroupé par agrégats de 4 × 4 cases ; pas d’entité persistante par arbre décoratif.
- Compléments : deux mini-gisements de 150 et deux grands de 2 000 ; bois seulement si nécessaire, deux bosquets de trois arbres. Marges et trajets sont vérifiés sur le champ RC1. Un échec annule aussi ressources, occupations, stocks et terrasses.
- Sol détaillé : champ approuvé + terrasses, patches de demi-case dans les chunks du renderer existant. Une projection entière de 128 chunks fournit les données nécessaires aux lectures historiques et aux premiers relevés. Elle n’est pas la source d’autorité des emprises RC1.
- Les bosquets pleins et correctement occupés utilisent le même prédicat économique de réconciliation, exprimé par lectures séparées indexables ; les `EXISTS` corrélés donnaient des temps excessifs avec les agrégats RC1. Ni ordre des verrous ni échéance économique modifiés.

## Routes ajoutées

| Route sous `/api/worlds/:slug` | Usage |
| --- | --- |
| `GET /starter` | Kit figé et installation du compte |
| `GET /starter/terrain?chunks=…` | Streaming authentifié avant HDV |
| `POST /starter/inspect` | Diagnostic sans pose |
| `POST /starter` | Pose initiale groupée ou HDV seul |
| `POST /villages/:villageId/starter` | Pose d’un élément restant |

L’entrée lobby RC1 mène à l’atlas ; le join automatique historique refuse ce parcours. Les mondes v2 conservent leur entrée actuelle. Aucune recherche automatique de position de village n’est ajoutée.

## Preuves de cette session

- Tests DB isolés : pose groupée et manuelle, stocks/population, projection pierre, lecture village/terrain, reprises idempotentes, refus d’artefact changé, rollback injecté après écritures attestées, réconciliation de bosquet, concurrence avec barrière et attente PostgreSQL observée. Les six cas ont passé dans des processus terminés ; voir le handoff pour le découpage exact des exécutions.
- La lecture village présente quatre sites logiques pour cinq bâtiments persistants : les deux jardins contigus sont un seul site avec deux parcelles. L’assertion initiale de cinq sites a été corrigée, sans changer ce comportement du jeu.
- Recette navigateur manuelle sur monde jetable : HUD limité avant HDV, R, clic droit, pose HDV, accès aux autres modes, reconnexion avec quatre éléments restants, puis deux maisons et deux jardins placés par Construire. Stocks initiaux 2 000 bois / 50 carottes et population 15 conservés. Le kit disparaît lorsqu’il est consommé. Captures locales sous `test-results/`, exclues du dépôt.
- Recette groupée sur API et frontend compilés : pose à (140,20), inventaire restant vide confirmé par API, quatre sites logiques visibles, 15 habitants / capacité 40, stocks 2 000 bois / 50 carottes. Les panneaux Population et Exploitation s’ouvrent après pose ; captures relues, aucune erreur JS applicative relevée. Les fixtures de ces deux parcours et leurs comptes ont été nettoyés et leur absence vérifiée.
- Build et lint racine terminés avec succès. **41 tests distincts** ont chacun passé dans plusieurs exécutions terminées (détail en tête du handoff), sans revendiquer une campagne unique complète.
- Les premiers essais ont exposé une lecture village sans chunks, une prévisualisation transparente appliquée à des instances, des requêtes lentes et une attente de verrou de cinq secondes trop courte pour la première projection. Corrections et essais ultérieurs consignés ; les essais échoués ne sont pas comptés comme verts.

## Contre-recette et audit demandés

Sur une copie de test dédiée, migrer et utiliser la fixture `tests/browser/spawn-map-fixture.mjs --built`. Elle crée uniquement son monde/compte et refuse une cible différente de `127.0.0.1/arbestra_test`. Elle expose un compte jetable et une URL ; fermer via stdin pour nettoyer. Ne pas réinitialiser la base pendant une fixture active. Le point historique de recette (140,20) est une entrée de test, pas une recommandation automatique au joueur.

Rejouer atlas → préparation → groupé et manuel, quatre orientations, refus d’occupation/eau/roche, retry, déconnexion, accès Population/Exploitation avant/après HDV et absence de redotation. Vérifier visuellement le terrassement et les arbres conservés avec un second client connecté. Vérifier également clavier et tactile sur les dimensions cibles.

Axes d’audit prioritaires :

1. Ordre des verrous, atomicité de la première projection et de la pose, concurrence compte/monde, réponses périmées et reprise après résultat réseau incertain.
2. Emprises/portes/orientations communes au kit, aux bâtiments posés et aux chemins ; collision fine versus grille historique.
3. Projection économique naturelle, arbres retirés d’un agrégat et accessibilité réelle des dépôts ; pas de crédit lié aux seuls meshes.
4. Coût du premier spawn : génération de la projection sous verrou spatial, sérialisation de l’artefact, diagnostics et lectures économiques. Les mesures locales varient fortement ; aucun budget de latence garanti.
5. Fidélité du renderer RC1 et frontières d’intégration : le rendu courant utilise une palette simple et des volumes rocheux simplifiés ; la branche détaillée RC1 ne reprend pas encore l’excavation visuelle des routes/infrastructures du terrain historique. Tous les appelants historiques de navigation/relevés ne consomment pas encore le champ fin RC1. Ces points restent à traiter avant une ouverture publique ; la recette de pose ne les certifie pas.

La suite applicative complète et les parcours économiques complets RC1 ne sont pas certifiés par cette livraison. Les tests isolés évitent le reset de la base partagée où subsiste une démo antérieure. Aucune migration de développement, ouverture publique, configuration VPS ou livraison prod/staging effectuée.

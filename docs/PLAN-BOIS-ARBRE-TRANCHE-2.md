# Bois par arbre : plan d'implémentation de la tranche serveur

Date : 28 octobre 2026. Base : `92223e9`. Spec : [SPEC-BOIS-ARBRE-UNITE.md](SPEC-BOIS-ARBRE-UNITE.md).

Statut : **plan validé par Tristan le 28 octobre au soir, avec ses réponses (spec §7) : arbre de 500 (5 lots), défrichage arbre par arbre, file d'attente consommée par le panneau Chantier, « Annuler » qui retire de la file.** Les points ci-dessous qui supposaient 300 ou une annulation de lots en route sont remplacés par ces décisions. Le plan a été établi par lecture du code (sous-agent) ; les volumes ont été vérifiés en base de dev. Les numéros de ligne datent de `92223e9`.

## Constats qui orientent le plan

- **Quantités en base.** Les bosquets RC1 valent 500 par arbre (`onboarding/rc1-field.ts:44`, nettoyage d'installation `rc1-resources.ts:175,203`). Les compléments de départ valent 1 500 pour 3 arbres historiques (`spawn-resources.ts:191`). Les mondes procéduraux valent 300 par case (`worlds/generation.ts:325`).
- **Monde de test.** Le monde procédural `aube`, celui de toutes les fixtures, n'a aucun arbre RC1.
- **Débit des lots.** N'importe quel village qui réveille le bosquet débite aujourd'hui les lots dus de tous les villages (`woodland.ts:160-193`). Cible : seul le village propriétaire débite, à l'échéance du lot.
- **Occupation des cases.** Un bosquet RC1 occupe toutes les cases de ses arbres (`rc1-resources.ts:119-146`). Après un passage sous 10 %, seule la case du gisement est réoccupée (`woodland.ts:270-281`).
- **Aucune annulation.** Aucune commande ne permet de revenir sur un geste d'exploitation (`harvest-intents.ts` : `acceptHarvestIntent` seulement). Le `stop` des anciens chantiers ne s'applique pas au geste.

## Schéma cible (additif)

- **`woodland_trees`** :
  - clé (monde, gisement, indice d'arbre) ;
  - colonnes `remaining_amount` (0..300), `reserved_amount` (≤ `remaining_amount`), `felled_at`, `revision` ;
  - clé étrangère vers `woodland_deposits`, en cascade.
  - Une ligne n'existe qu'à partir du premier lot sur l'arbre ; sans ligne, l'arbre est debout avec 300 unités.
  - Indice : en RC1, l'indice de `forest.trees`, déjà utilisé par `tree_indices` et `removed_indices`.
- **`deposit_extractions.tree_index`** et **`extraction_worksite_targets.tree_indices`** : nullables. Une valeur nulle désigne tous les arbres de la case, dans l'ordre RC1.
- **Vue `resource_deposits`** : redéfinie sans repousse ni seuil.
  - Le bois d'une case est la somme de ses arbres, moins les lots dus et pas encore débités.
  - `blocks_cell` vaut `not cleared`.
  - Nouvelle colonne `clearable` : vraie s'il ne reste que des souches et aucun lot en cours.
- **Écritures**, toutes sous le verrou de la case :
  - réservation par upsert sur l'arbre ;
  - débit par le propriétaire du lot, à son échéance ;
  - défrichage.
- **Lecture** : elle n'écrit plus rien sur le bois.
- Déclencheurs du journal sur `woodland_trees` : publication du chunk spatial de la case et `village_sync_change`.

## Ordre des verrous

1. Village.
2. Verrou consultatif de navigation.
3. Borne `through`, lue après acquisition des verrous.
4. Pierres par UUID.
5. **Bois par UUID**, restreint aux lots dus et aux cibles : le rayon de 32 cases disparaît.
6. Transitions dues.
7. Arbres, uniquement sur des cases déjà tenues, par indice croissant.

Tout écrivain d'un arbre tient d'abord sa case. Deux villages qui visent le même arbre se sérialisent donc sur la case, jamais sur l'arbre seul, et aucun cycle n'est possible. Écart assumé avec la lettre de la spec : une lecture garde le verrou de case des cibles en attente, parce qu'elle peut admettre un lot ; ce verrou ne produit aucune écriture.

## Sous-tranches

| # | Contenu | Effet en jeu |
|---|---|---|
| 2a | **Fait (28 octobre).** Migration 064 : table `woodland_trees` (0 à 500, réservation dans le tronc, souche retirée vide, cascade), `deposit_extractions.tree_index`, `extraction_worksite_targets.tree_indices`. Règles pures partagées dans `packages/contracts/src/woodland-trees.ts` : 500 par arbre, lots de 100, état d'un arbre, ordre RC1 sans les arbres retirés, prochain lot sur les arbres désignés, 2 à 5 arbres par case générée, conversion d'un bosquet entamé (part coupée de la case, compteur en arbres de 500). La fonction SQL de conversion est reportée à 2b : la conversion en dev peut tout recréer. | Aucun |
| 2b | **Fait (28 octobre, nuit), à valider ; migration 065 appliquée en test seulement.** Arbre de 500, lots de 100 sur un arbre, débit par le propriétaire, défrichage souche par souche (lot de retrait sans bois, un habitant), case occupée jusqu'au retrait de sa dernière souche, lecture sans écriture, conversion idempotente `woodland_convert_to_trees` (voir SESSION-HANDOFF). Écarts : la case garde la somme de ses arbres (pas de déclencheur sur `woodland_trees`, le journal passe par la case) ; pas de colonne `clearable` (le défrichage final est automatique) ; troncs retirés de la navigation à la case entière. Prévu à l'origine : **Bascule** en un seul commit : vue redéfinie, conversion appelée, débit par le propriétaire, défrichage sur souches seulement, raccourci « tout récolter et défricher », plus de repousse, de seuil ni de rayon de 32 cases, sol RC1 et version RC1 sans seuil, construction, installation à 300 par arbre. Désignation par défaut : tous les arbres de la case dans l'ordre, pour que le client actuel continue de fonctionner. Tests : trois lots par arbre, défrichage, raccourci, bootstrap sans écriture, concurrence sur un même arbre, rollback, conversion. | L'arbre devient l'unité, sans repousse |
| 2c | **Fait (29 octobre), à valider ; aucune migration.** `woodTrees: [{ featureId, treeIndices }]` sur `HarvestIntent`, `ExploitationRequest` et `StartExtractionWorksiteRequest` ; chaque case désignée figure aussi dans `wood` / `featureIds` (sinon 400 `WOOD_TREES_OUTSIDE_SELECTION`) ; une case sans désignation garde tous ses arbres. Ordre : la case la plus proche, puis l'ordre de désignation, jamais trié. Refus par arbre `tree-not-found` (champ `treeIndex` du refus) ; en coupe, les souches désignées sont écartées sans refus, une désignation de souches seules donne `depleted` ; en défrichage, les souches sont gardées, les souches déjà retirées écartées. File (`appendPoolTargets`) : les nouveaux arbres s'ajoutent après ceux de la cible en attente, la case entière absorbe tout, rien de neuf donne `already-assigned`. La désignation suit la cible quand un autre consommateur de la file la prend (elle se perdait). Défrichage partiel : seuls les arbres et souches désignés ; la case n'est défrichée qu'au retrait de son dernier arbre ou souche. Rejeu avec d'autres arbres : `COMMAND_ID_CONFLICT` (intention et ordre d'exploitation). Écarts : navigation retirée à la case entière seulement (arbre par arbre en 2e) ; pas de mode `clear` sur `HarvestIntent`, la file reste en coupe (2e) ; `StartExtractionWorksiteRequest` n'a pas de route client et son rejeu ne compare pas les arbres. | Le serveur accepte les arbres choisis |
| 2d | **Fait (29 octobre), à valider.** `deposit.trees` : arbres touchés seulement (`treeIndex`, `remainingAmount`, `reservedAmount`, `felledAt`, `stumpRemoved`), les lots échus non débités comptés coupés comme pour la case ; absent si aucun arbre n'est touché ou si la case est défrichée. Dans les chunks, le flux spatial V2, le snapshot (donc la présentation) et la fiche du bosquet, qui n'expose plus `regrowthPerHour`. File du village : `worksites[].targets[].treeIndices` (null : tous les arbres) avec le `mode` du chantier ; lot en cours : `extractions[].treeIndex`. Journal : le chunk de la case est publié à chaque arbre abattu, lot débité et souche retirée (pas au départ d'un retrait de souche, qui ne change rien de visible). Mesure (chunk 32,15 de `aube`, 19 bosquets) : taille inchangée sans arbre touché, +4,6 Ko bruts (+123 octets gzip) avec deux arbres touchés par case ; coût SQL du champ 0,008 ms par case. Correctif trouvé en mesurant : migration 067 (vue `resource_deposits` aplatie, régression de 065). | Aucun, prépare la tranche 3 |
| 2e | **Fait (29 octobre), à valider ; migrations 068 et 069 appliquées sur la base de test seulement.** **File** : `HarvestIntent.woodMode` (`cut` par défaut, `clear`). Chaque cible de la file du bois garde ses arbres (`tree_indices`), ceux à défricher (`clear_tree_indices`, exposé en `worksites[].targets[].clearTreeIndices`) et la part de chaque geste (`designations` : `[{ commandId, mode, treeIndices }]`, colonne JSON qui suit la cible quand un autre consommateur la prend). La part d'un geste est exactement ce que son reçu a accepté. Le défrichage englobe la coupe : un arbre en coupe redésigné en défrichage passe en défrichage (part du second geste) ; la coupe d'un arbre déjà en défrichage n'ajoute rien (`already-assigned`) ; défricher la case entière ne prend que les arbres pas encore en défrichage. Le panneau Chantier (chantier commun) consomme la file avec ses règles d'effectif : bois d'abord (case la plus proche, puis ordre de désignation), puis les souches à défricher, une par une, un habitant. **Annulation** : `POST …/harvest-intents/:commandId/cancel`, sans corps, synchrone, sous verrou du village (puis cases de la file par UUID) ; idempotente par geste (reçu enregistré dans `harvest_intent_cancellations`, rejoué tel quel). Elle retire les arbres et souches de la part du geste, sauf ceux qu'un lot du village travaille (« pris en charge » : lot réservé ou en cours ; l'arbre reste alors en file jusqu'au bout de son mode). Les parts des autres gestes restent ; une cible sans part est supprimée (aucun chantier vide). Reçu arbre par arbre : `removed`, `in-progress`, `queued` (avec `mode`), `not-queued`. Geste pas encore traité par le worker : annulé d'avance (`beforeQueue`), son intention refuse chaque case avec `cancelled`. Geste d'un autre village : 404. **Navigation** : la souche retirée retire son tronc (déclencheur sur `woodland_trees` : boîte du tronc, `navigation_changed`), le sol RC1 (`absent`, version du sol), le contexte des trajets et les compléments `starter:` (`removedTrees`) ; la construction ne voit plus ce tronc mais la case reste occupée jusqu'au défrichage. L'empreinte du réseau change avec `absent`, et seulement au retrait d'une souche. **Écarts** : seul le bois d'un geste est annulé (ni jardins ni pierre) ; un geste mis en file avant 068 n'a pas de part et ne s'annule pas ; `TRAVEL_NETWORK_VERSION` inchangé (l'entrée du planificateur change d'elle-même) ; l'installation de village et la carte d'installation ne lisent pas les souches retirées (comme pour les cases défrichées). | Bouton « Annuler » branchable |
| 3 | Client : grammaire gestuelle (toucher, glisser, appui long pour changer de mode, surlignage rouge du défrichage, « Annuler » pendant 15 s), rendu par arbre. | Nouvelle interaction |

## Risques

- **Conversion.** Changer `initial_amount` sur ~29 000 lignes déclenche, ligne par ligne, la navigation et le journal. À mesurer sur une copie de la base de dev ; procéder monde par monde.
- **Mondes procéduraux.** Un bois coupé y reste bloquant jusqu'au défrichage, et l'empreinte du réseau y inclut le gisement : un recalcul du réseau par lot dans ces mondes.
- **Occupation multicase.** Les cases d'arbres déjà libérées sous l'ancien seuil restent constructibles sans défrichage.
- **Alpha.** La conversion touche les données des joueurs : accord explicite de Tristan au déploiement.

## Questions pour Tristan

- **Q1. Mondes procéduraux** (monde de test `aube`), sans arbre RC1 : combien d'arbres par case ? Recommandation : la disposition historique que le client dessine déjà (2 à 4 arbres selon la graine).
- **Q2. Compléments de départ** (`starter:`, 1 500 pour 3 arbres historiques) : ce sont les cases sans arbre. Faut-il, en plus de supprimer les existants, cesser d'en créer à l'installation des villages pauvres en bois, ou leur donner 3 vrais arbres ?
- **Q3. Compteur de bois coupé à la conversion** : le recalculer en arbres de 300 (souches × 300 + entame du tronc) ? Recommandation : oui, pour rester cohérent avec le rendu.
- **Q4. Bosquets entamés** : la part déjà coupée se mesure en fraction de la case (une case à moitié coupée garde la moitié de ses arbres debout) ? Recommandation : oui.
- **Q5. Ordre des lots** : entre plusieurs cases, la plus proche d'abord (comme aujourd'hui) ; dans une case, l'ordre de désignation. D'accord ?

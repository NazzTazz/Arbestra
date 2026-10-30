# Démolition — 29 octobre 2026, révisée le 31 octobre

Statut : serveur et client **livrés le 31 octobre, à valider** par Tristan en recette sur le dev (§9.6). Statuts : **validé** (décision de Tristan), **proposé** (recommandation à confirmer), **ouvert** (décision manquante), **hors périmètre**.

**Révision du 31 octobre (Tristan, validée)** : la démolition est **immédiate** pour toutes les cibles, sans durée ni villageois ; un délai d'annulation côté client précède l'envoi ([décisions](DECISIONS-DEMOLITION-2026-10-30.md)). Le §9 remplace les §3 à §5, écrits avant les cases de route (S1) et les ancrages (S4), et conservés pour l'historique.

## 1. Décisions validées

- La palette Constructions devient **Bâtiments / Infrastructure / Outils**. Outils regroupe Terraformation et **Détruire**.
- Un **balayage** désigne ce qu'il touche : bâtiments, y compris en chantier, maisons, jardins, routes et braseros. **L'hôtel de ville ne se démolit jamais.**
- Les cibles désignées passent en **rouge pulsant**. Un bouton **Annuler** est disponible, comme pour le défrichage.
- **Aucun remboursement.**
- La démolition **dure 1/10 de la construction** et **mobilise des villageois**.
- Les habitants et les ouvriers d'un bâtiment démoli se retrouvent dans le village, puis rentrent à l'hôtel de ville ou dans une maison.

Tristan a d'abord évoqué un délai de 30 s avant suppression, puis la règle du dixième. Le §3 propose comment les concilier.

## 2. Parcours

1. Outils → Détruire. L'outil reprend le canal de gestes de la voirie (`infrastructureTool`) : appui, glissement, relâché, clic droit, Échap.
2. Le balayage marque les cibles case par case. Les cases entre deux échantillons du pointeur sont interpolées sur le tore, avec au plus 64 cases par échantillon. Un appui sans glissement marque une seule case.
3. La fiche affiche les comptes (bâtiments, cases de route, braseros), la mention « Sans remboursement », **Démolir** et **Annuler**. Clic droit ou Échap désélectionne tout.
4. **Démolir** envoie une seule commande pour toute la sélection (§4). Une fois la commande admise, les cibles pulsent jusqu'à la fin du chantier ; la fiche montre la durée restante et **Annuler**.
5. Quitter l'outil, changer de domaine ou de village abandonne une désignation non envoyée. Un chantier admis continue.

## 3. Durée, équipe, coût

- **Proposé — base de durée** : 1/10 de la somme des durées de construction des niveaux atteints. Exemples avec les valeurs seedées :
  - maison niveau 1 : 60 s → 6 s ;
  - maison niveau 2 : 60 + 120 s → 18 s ;
  - université niveau 3 : 600 + 1 200 + 2 400 s → 420 s.
  - Les règles particulières :
    - un bâtiment en chantier compte aussi le niveau visé ;
    - un jardin compte son niveau et chacune de ses extensions, chaque extension ayant la durée du niveau 1 du jardin ([service.ts:2350](../apps/api/src/modules/villages/service.ts)) ;
    - `CONSTRUCTION_DURATION_MS` s'applique comme pour la construction.
- **Ouvert — routes et braseros** : ils n'ont pas de durée de construction, car leurs aménagements sont immédiats. **Proposé** : 30 s par commande pour ces cibles, ce qui reprend le délai évoqué par Tristan ; une commande mixte dure le maximum de ses parties.
- **Ouvert — équipe** : aujourd'hui, la construction ne mobilise aucun villageois. `placeBuilding` et `upgradeBuilding` n'appellent pas `assignWorkers`. La démolition serait le premier chantier de bâtiment avec équipe. **Proposé** :
  - équipe fixe de 3 villageois disponibles et reposés, choisis par `eligibleWorkers`, comme le nivellement ;
  - la durée ne dépend pas de l'effectif, puisque le dixième est la règle validée ;
  - sans villageois disponible, la commande est refusée avec un message explicite, sans file d'attente.
- **Coût** : aucun débit et aucun crédit. Un stock interne au bâtiment (tampons de ressources, lots en cours) est perdu. **Ouvert** : faut-il prévenir le joueur quand des ressources tamponnées vont disparaître ?

## 4. Commande et persistance (proposé)

Modèle : le chantier de nivellement (`admitLeveling` / `completeLevelingAt`, [leveling.ts](../apps/api/src/modules/villages/leveling.ts)).

- `POST …/demolitions` avec `{ commandId, buildings: [{ id }], roadCells: ["x:y"], equipment: [{ id, version }] }`. La commande est bornée à 64 bâtiments, 1 024 cases de route et 64 braseros. Elle est idempotente par `commandId` ; réutiliser un identifiant avec une autre demande est refusé.
- Admission :
  - `beginVillageEconomy(..., true)` d'abord. Le verrou de navigation est nécessaire, car les routes changent ;
  - verrouillage ensuite des bâtiments ciblés par UUID canonique ;
  - lecture de `statement_timestamp()` après acquisition.
  - Refus dans les cas suivants : hôtel de ville, bâtiment d'un autre village ou monde, cible déjà en démolition, route absente ou automatique, brasero de version différente.
- Table additive `demolition_jobs` : `world_id`, `village_id`, `id`, `command_id`, `status` (`active` | `completed` | `cancelled`), `started_at`, `completes_at`, `targets` (JSON borné), reçu de commande.
  - Colonne additive `buildings.demolition_job_id`, nullable. Elle bloque amélioration, extension, ordres d'atelier, science et récolte, sur le modèle du refus d'amélioration pendant un ordre d'atelier ([service.ts:2476](../apps/api/src/modules/villages/service.ts)).
- Équipe : `assignWorkers({ demolitionJobId })` dans `population/work.ts`, avec les mêmes règles d'éligibilité que Jardin, pierre et nivellement.
- Tâche `demolition.complete`, ajoutée à l'union des transitions dues de [reconcile-economy.ts](../apps/api/src/modules/villages/reconcile-economy.ts), triée par échéance, ID et type. Le scheduler ne finalise que sa propre tâche ; une notification ancienne ne décide rien.

## 5. Effets

### À l'admission (proposé)

- Un ordre d'atelier en cours sur la cible passe en annulation demandée : le lot entamé se termine selon la sémantique existante, aucun nouveau lot n'est admis.
- La science sur la cible s'arrête, et ses contributeurs sont libérés.
- Les ouvriers d'une récolte de jardin sont libérés, et les intentions de récolte du jardin sont retirées.
- Les dormeurs **restent couchés jusqu'à la fin**. **Ouvert** : faut-il les réveiller dès l'admission ?

### À l'achèvement, dans une seule transaction

1. **Bâtiments.**
   - Mise à `null` de `population_cohorts.rest_building_id`, dont la clé étrangère ne cascade pas ([022](../apps/api/src/database/migrations/022_rest_housing.ts)).
   - Clôture des `science_activities` encore liées (pas de cascade non plus).
   - Puis `delete from buildings` : occupations, tampons, extensions, parcelles, récoltes, contributions et ordres d'atelier cascadent. Les cases redeviennent libres.
2. **Logement.** `reconcileRestHousing` replace les dormeurs dans une autre maison, puis à l'hôtel de ville. Le surplus dort sans lit, sans pénalité, comme aujourd'hui (`allocateRestHousing`, [housing.ts](../apps/api/src/modules/population/housing.ts)). La cible de croissance est recalculée et baisse ; les cohortes au-delà de la cible ne sont jamais supprimées.
3. **Routes.** Pour chaque case marquée, un trait `remove` horizontal de largeur 8 passe par le centre de la case et la couvre exactement, de `(8x−4, 8y)` à `(8x+4, 8y)`. Une seule révision +1 du plan est écrite, avec un reçu. Les routes automatiques (trajets) ne sont pas ciblables.
4. **Braseros.** Une opération `delete` par brasero manuel, dont la version est vérifiée. **Ouvert** : un balayage doit-il aussi supprimer les braseros automatiques (`suppressedBraziers`) ? Le client ne marque aujourd'hui que les braseros manuels.
5. **Équipe.** `releaseWorkers` : les villageois redeviennent disponibles sur place et rentrent selon les règles existantes.

### Annulation (proposé)

`POST …/demolitions/:id/cancel` est idempotente et enregistre un reçu, comme `cancelHarvestIntent`. Elle est possible jusqu'à l'achèvement, pas seulement pendant la fenêtre de 15 s du défrichage côté client, puisqu'il s'agit d'un chantier :
- le job passe en `cancelled` ;
- `demolition_job_id` est remis à `null` ;
- l'équipe est libérée, sans coût ni restitution.

Un ordre d'atelier annulé à l'admission n'est pas rétabli.

## 6. Points ouverts supplémentaires

- **Jardins fusionnés** : un jardin logique peut s'étendre sur plusieurs lignes `buildings` (SPEC-JARDINS-PARCELLES-FUSION). **Proposé** : le balayage désigne la ligne touchée seulement ; il faut alors vérifier que le reste du composant reste cohérent.
- **Synchronisation V2** : le job de démolition est une nouvelle entité du snapshot et du journal. À coordonner avec la clôture V2 en cours.
- **Démolition pendant une livraison du marché** ou un convoi lié à un bâtiment : sans objet, tant que seul l'hôtel de ville sert de départ, et il est exclu.
- **Animation** des villageois sur le chantier : reprise du modèle des chantiers animés. Elle reste décorative et ne déclenche aucun crédit.
- **Amélioration notée — teinte des jardins** : aujourd'hui, un jardin désigné reçoit une plaque rouge par case, traversée par ses plantes (§8). Tristan préférerait voir le jardin lui-même teinté ; la plaque est acceptée en attendant.
  - Piste : les plantes et le sol des jardins sont dessinés en commun pour tous les jardins (`garden-kit.ts`), comme les arbres. Les arbres reçoivent déjà une couleur par arbre, multipliée à leurs couleurs propres (teinte du défrichage, `thinInstanceSetBuffer('color', …)`). Le même principe ne passerait au rouge que les plantes et le sol des cases désignées.
  - À vérifier d'abord : que les matériaux du jardin acceptent cette couleur par plante.
  - Ce code s'exécute à chaque image. Il faudra un test déterministe qui borne les mises à jour (seules les plantes des parcelles désignées sont réécrites, et seulement au marquage), et une mesure navigateur avant/après.

## 7. Vérifications attendues

- Tests métier :
  - durée, équipe et refus (hôtel de ville, autre village, double démolition, version de brasero) ;
  - idempotence ;
  - annulation ;
  - achèvement, avec la suppression, la remise à `null` des clés sans cascade, le relogement et la baisse de la cible de croissance.
- Concurrence, avec des barrières bornées :
  - démolition contre amélioration ;
  - démolition contre ordre d'atelier ;
  - démolition contre récolte ;
  - achèvement contre annulation.
- Rollback avec erreur injectée après la suppression : toutes les tables touchées sont comparées.
- Navigateur : balayage, pulsation, Démolir, Annuler, achèvement ; mesure de cadence pendant 60 s avec marques.

## 8. Livré côté client (branche `refactor/hud-infrastructure`)

- `ui/demolition-selection.ts` :
  - index construit une fois par état, avec bâtiment par case (hôtel de ville exclu), cases de route manuelles et braseros manuels ;
  - balayage interpolé et borné ;
  - sélection en ensembles, à coût constant par case.
  - Test déterministe des cibles, du tore et du nombre de recherches par échantillon.
- `ui/DemolitionTool.tsx` : geste, fiche, désélection. **Démolir est désactivé** tant que la commande serveur n'existe pas.
- `scene/demolition-tint.ts` : les cibles elles-mêmes passent en rouge pulsant, sans volume ajouté.
  - Bâtiments et braseros : copies teintées de leurs propres maillages, les originaux masqués le temps de la désignation. Matériaux et sources teintés sont mis en cache par original ; une image coûte une couleur par matériau distinct.
  - Routes : une peau rouge suit exactement les pixels de route des cases désignées, reconstruite au plus une fois par image.
  - Jardins : une plaque rouge sur chaque case du jardin, ses plantes la traversant.

## 9. Spécification révisée (31 octobre)

### 9.1 Commande (proposé, dans le cadre validé)

`POST /worlds/:slug/villages/:villageId/demolitions`, V2 seulement (en-têtes de commande V2), modèle `roadCellsCommandV2` :

```
{ commandId, buildings: [{ id }], gardenCells: [{ cellX, cellY }], roadCells: [{ cellX, cellY }], braziers: [{ vertexX, vertexY }] }
```

- Bornes : 64 bâtiments, 256 cases de jardin, 256 cases de route (`ROAD_CELLS_PER_COMMAND`), 64 sommets ; au moins une cible. Coordonnées canoniques.
- Les jardins sont désignés **par case** (décision 6 : seules les parcelles touchées) ; un identifiant de jardin dans `buildings` est refusé (`GARDEN_BY_CELL`).
- Idempotente par `commandId` (table `demolition_receipts`, migration 077, forme de `road_cell_receipts`) ; même identifiant avec un autre contenu : 409 `COMMAND_REUSED`. Le contenu canonique dédoublonne les cibles.
- Réponse : `{ protocol: 2, worldId, villageId, commandId, status: 'applied', commandTime, result, effects? }`, `result = { buildings, gardenCells, roadCells, braziers, unchanged }` (comptes).

### 9.2 Admission

1. Rejeu du reçu hors transaction ; puis `ownedVillage`, `beginVillageEconomy(…, true)` (village, verrou de navigation exclusif du monde ; `statement_timestamp()` après acquisition), rejeu concurrent.
2. Lectures bornées, tous les refus avant toute écriture :
   - bâtiment absent du village : compté `unchanged` (balayage concurrent) ; hôtel de ville : 409 `TOWN_HALL` ;
   - case de jardin sans jardin du village : `unchanged` ; case d'un autre village : refus de la commande (`FOREIGN_INFRASTRUCTURE`) ;
   - routes : règles de retrait des cases (`roadCellRefusals`) ; une case absente est `unchanged`, une case étrangère refuse la commande ;
   - braseros : règles de retrait des ancrages, évaluées **après** le retrait des cases de la même commande (un retrait peut créer un brasero automatique).
3. Verrouillage des bâtiments ciblés (`FOR UPDATE`, UUID canonique), après le village.

### 9.3 Effets, dans la transaction de la commande

- **Villageois occupés par une cible**, libérés par `releaseWorkers` : lot d'atelier en cours (le lot entamé est perdu, sans remboursement), activité de science (supprimée, sans attribution de recherche ni de formation), récolte de jardin en cours sur un bâtiment touché ou passant par une case retirée (récolte supprimée, carottes réservées perdues).
- **Dormeurs** : `rest_building_id` remis à `null` ; ils restent au repos et la réallocation des lits de la fin de commande (`reconcileRestHousing`) les reloge dans une autre maison, puis à l'hôtel de ville, sinon sans lit.
- **Bâtiments** : `delete from buildings` ; occupations, tampons, extensions, parcelles, récoltes, contributions et ordres d'atelier cascadent. Un logement démoli relance `advancePopulationGrowth(…, true)` : la cible baisse, aucune cohorte n'est supprimée.
- **Cases de jardin** : une extension en attente est supprimée avec sa réservation ; sinon la parcelle et l'occupation de la case. Une ligne de jardin sans case active restante est supprimée ; si sa case `anchor` est partie, la première case restante (x, puis y) devient l'ancre. Les composantes fusionnées se recalculent d'elles-mêmes.
- **Routes** : suppression des `road_cells`, puis `cleanRoadAnchors`.
- **Braseros** : retrait d'ancrage (manuel supprimé ou passé à `none` sur un coin rentrant ; automatique supprimé par une ligne `none`).
- Reçu, puis `villageCommandResult` (réconciliation de fin, lits) et publication V2. Le journal privé est écrit par les triggers existants ; aucune nouvelle composante de synchronisation.
- Les tâches planifiées restantes (`building.complete`, `processing.complete`, `science.wake`) sont sans effet sur une cible disparue.

### 9.4 Client (proposé)

- Sélection sur `roadCells` et `roadAnchorAccessories` (braseros automatiques compris), jardins par case.
- **Démolir** lance un délai d'annulation de 15 s (fiche : décompte et **Annuler**) ; à son terme, une seule commande. Avertissement si une cible détient des ressources stockées (décision 3).

### 9.5 Vérifications

Tests métier (refus, idempotence, rejeu concurrent, effets par catégorie, relogement, cible de croissance, jardin fusionné et changement d'ancre, brasero automatique après retrait), concurrence avec barrières (contre une amélioration et contre un ordre d'atelier), rollback après écritures constatées, puis parcours navigateur.

### 9.6 Livré le 31 octobre — à valider

- Serveur : `demolitionCommandV2` (`apps/api/src/modules/villages/demolition.ts`), route `POST …/demolitions`, migration 077 (`demolition_receipts`), contrat `packages/contracts/src/demolition.ts`. Retrait de cases et d'ancrages partagé avec la voirie (`roadCellsToRemove`, `removeRoadAnchors`) ; abandon de science sans attribution (`abandonScienceAt`).
- Client : sélection sur `roadCells` et les braseros affichés (manuels et automatiques, aux coins des cases balayées), jardins par case ; délai de 15 s avec décompte et **Annuler** ; avertissement statique dès qu'un bâtiment ou un jardin est désigné (les stocks exacts ne sont pas lus côté client) ; teinte des routes sur le tramage des cases, des braseros d'ancrage par leur clé de rendu.
- Preuves (base de test) : `demolition.integration.test.ts`, 6 tests verts — effets par catégorie (bâtiments, routes, brasero manuel et coin automatique créé par le retrait, lot d'atelier, formation sans attribution, dormeurs relogés à l'hôtel de ville, effets V2 appliqués, rejeu sans écriture ni publication, `COMMAND_REUSED`), refus sans écriture, jardin fusionné avec changement d'ancre et tournée interrompue, rollback après écritures constatées, deux sérialisations avec une amélioration (barrière bornée, attente PostgreSQL observée). Mutation (lits non libérés) : rouge. Voisins verts : `road-anchors`, `road-cells`, `science` (intégration), `demolition-selection` (4). `tsc` API et client, eslint, prettier.
- Navigateur (dev, Bressuire, chargement à froid) : balayage de 3 cases de route et 2 braseros, maison isolée en rouge ; décompte puis **Annuler** (rien n'est démoli après 17 s) ; **Démolir** au terme : maison, cases et brasero manuel disparus, capacité 1 000 → 995, aucune erreur console. Un brasero reste visible au coin de l'ancienne route : par lecture, celui de la route automatique (trajets) qui passe dessous, hors périmètre ; à confirmer en recette.
- Non mesuré : coût par image (la désignation ne touche aucun crochet par image ; teinte reconstruite au plus une fois par image comme avant).

## Hors périmètre

Remboursement, démolition de l'hôtel de ville, routes automatiques, déplacement de bâtiment, démolition par d'autres joueurs ou militaire.

# Démolition — 29 octobre 2026

Spec d'une tranche **non implémentée côté serveur**. Le geste client est livré sur la branche `refactor/hud-infrastructure` (voir §8) et reste **à valider** par Tristan. Statuts : **validé** (décision de Tristan, 29 octobre), **proposé** (recommandation à confirmer), **ouvert** (décision manquante), **hors périmètre**.

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
- `scene/demolition-marks.ts` : volumes rouges en instances fines sur une seule boîte. Bâtiments sur leur emprise, routes et braseros par case. Une image coûte une seule mise à jour d'opacité.

## Hors périmètre

Remboursement, démolition de l'hôtel de ville, routes automatiques, déplacement de bâtiment, démolition par d'autres joueurs ou militaire.

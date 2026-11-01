# Inventaire du lot I (retrait de la synchronisation V1) — 1er novembre 2026

Étude en lecture seule, base `af5555f`. Aucun code modifié, aucune base interrogée. « Lu » = vu dans le code ; **[déduit]** = inférence. Chemins relatifs à `apps/api/src/modules/villages/` (API) et `apps/world-web/src/` (client), sauf mention. Revérifiés dans le code avant rédaction : les trois constats ci-dessous, l'absence de 426, l'absence de `SUPPLIES_ALREADY_DISCOVERED` côté serveur.

Cadre : [inventaire de la synchro V2](INVENTAIRE-SYNC-V2-2026-10-29.md), [spec commandes bornées §10](SPEC-COMMANDES-BORNEES-SYNCHRONISATION-CIBLEE.md).

## Trois constats qui changent le périmètre

1. **`village_sync_changes` n'est pas que du V1.** La colonne `navigation_changed` alimente `navigationRevision()` (`modules/navigation/context.ts:44-48`), utilisée par le contexte de navigation (`context.ts:78`), les expéditions (`science/expeditions.ts:295`) et le refus `TRADE_CHANGED` du marché (`trade-service.ts:281`). Supprimer la table ou ses écrivains casse ces trois parcours vivants.
2. **`state()` ne disparaît pas.** La présentation V2 l'appelle (`presentation.ts:205`), comme `legacy-commands.fixture.ts` et plusieurs tests. Seuls ses modes `'observation'` et `'construction'` (`service.ts:1520,1537,1543,1548`) et ses deux lectures COUNT (`1181`, `1568-1571`) deviennent morts. Chaque capture de présentation paie aujourd'hui un COUNT mondial.
3. **Le protocole d'image du NOC reste.** `observation-routes.ts` (`villageFrame`, `syncRevision`) et `ObservationEntry.tsx` (`villageSnapshotIsValid`, `applyVillageFrame`) restent sur les trames historiques ; `syncRevision` y est un compteur propre à l'observation (`observation-village.ts`). `VillageStateSchema` reste : `sync-v2.ts`, `sync-v2-shared.ts` et `village-presentation.ts` réutilisent ses sous-schémas.

## 1. Serveur

**Routes mutantes à branche V1** (`routes.ts`) : `market/trades`, `processing`, `exploitation` (hors aperçu), `science` (hors `survey`/`explore`, qui sont des reçus), `discover-cat-eyes`, `buildings` (forme historique `cellX/cellY` et mode `x-construction-confirmation`), `buildings/:id/expansions`, `buildings/:id/upgrade`, `worksites/:id`, `buildings/:id/discover-supplies`. Déjà V2 seules : `road-cells`, `road-anchors`, `terrain-edits`, `demolitions`. Neutres : HUD (`extraction-pools`, `population/gestures`), `harvest-intents`, `commands/receipts/read`.

Plomberie V1 à retirer : schémas d'en-têtes, `villageReplyOptions`, `commandResponse`, `constructionResponse`, unions `VillageStateSchema` des réponses ; `ConstructionReplyMode` et le mode `'snapshot'` (`service.ts:743-770`). Fonctions V1 seules : `constructBuilding`, `constructBuildingArea`, `readConstructionConfirmation`, `readVillageObservation`, `placementResult`, `commandVillageScience`, `discoverCatEyes`, `commandPlayerMarket`. Le noyau `placeBuilding`, `upgradeBuilding`, `expandGarden` reste (appelé par la V2 avec `afterWrites`).

**Purement V1** : `GET /village` (journal `LEGACY_VILLAGE_READ`) → `getVillageState` → `reconcileVillageForRead` + `read-reconciliation.ts` ; `/events` SSE (`sync.ts`, `VillageSyncSession`, `reconcileSyncDeadline`, `villageTransitionDue` ; `cohortActivityDue` dans `population/work.ts` n'a que lui comme appelant) ; `ExpeditionWakeups` (`app.ts`, LISTEN `arbestra_expeditions`) n'a que `/events` comme consommateur **[déduit]**, le déclencheur `notify_expedition_receipt` (042) deviendrait orphelin. En V2, les reçus d'expédition passent par un sondage de 3 s tant qu'un reçu est en attente (`ui/use-expeditions.ts:149`).

**Projections V1** : `sync-projections.ts` entier (`observedBase` mort, `peek` sans appelant externe, `commandResponse`) ; hook `preSerialization` (`sync.ts`). `villageFrame` reste pour le NOC.

**Révision COUNT** : `villageSyncRevision` appelée par `service.ts:1181,1568`, `hud-workforce.ts:48,120`, `construction.ts:671`, `routes.ts:241`, `sync.ts`. `minimumRevision` vit aussi dans `ConstructionConfirmationSchema` (`contracts/village-sync.ts:57`, 0 sous V2) et `HudWorkforceState` (`contracts/hud-workforce.ts:61`). La table n'est jamais purgée.

## 2. Client : replis V1

- Appelants de `getVillage` (`client.ts:391`) : `App.tsx` `refresh()` quand la V2 n'est pas prête ; `initial-village.ts` (404 ou session expirée, drapeau à 0) ; `discoverOrRefreshSupplies` (branche morte : le serveur n'émet plus `SUPPLIES_ALREADY_DISCOVERED`) ; `setFactoryEnabled` (interrupteur du `DevDrawer`, résultat jeté sous V2 : `refresh()` suffit **[déduit]**).
- Drapeau `SYNC_V2_VILLAGE` (`sync-v2-initial.ts:14`), lu par `client.ts` (`legacyCaller`), `initial-village.ts`, `App.tsx`, `SpawnPlacement.tsx` ; `VITE_SYNC_V2=1` dans `ops/deploy/build.sh:13`.
- Flux V1 : `VillageSynchronization` (`api/village-sync.ts`), derrière `villageV1Stream`.
- Commandes V1 de `client.ts` (`requestState`, `requestVillageCommandState`, `buildBuilding`, `expandGarden`, `upgradeBuilding`, `commandProcessing`, `commandPlayerMarket`, `startExploitation`, `commandScience`, `changeWorksite`, `discoverBuildingSupplies`, `discoverCatEyes`), appelées seulement quand la V2 n'est pas prête.
- Mort si la V2 devient obligatoire : `village-sync.ts`, `construction-presentation.ts`, branches `'frame' in update` / `fromV2` / ordre par `syncRevision` d'`applySnapshot`, `revisioned` du HUD, double voie « village » ou « atelier seul » de `useVillageSyncV2`. **Déjà mort depuis le 1er novembre** : `infrastructure-presentation.ts`, `applyInfrastructureConfirmation` (`App.tsx`), `contracts/infrastructure-confirmation.ts`, `TimedInfrastructureConfirmation` ; `InfrastructureTools.tsx` déclare `onSnapshot`/`onConfirmation` sans les appeler.
- À reprendre : le HUD workforce est ordonné par `minimumRevision` (sous V2 par `serverTime` seul, limite documentée) ; le chargement initial utilise le repli `getVillage` pour produire le 401 (session expirée → `needsLogin` directement ; un 404 doit rester un arrêt) ; le statut `unavailable` du hook V2 bascule aujourd'hui sans bruit sur `/events`.

## 3. Le 426

Prévu par l'inventaire V2 (point 7) et la spec §10 (« réponse explicite de mise à jour requise »), rien n'existe. Emplacements **[déduit]** : un `onRequest`/`preValidation` sur les dix routes mutantes à branche V1 quand `x-arbestra-protocol` ≠ `2` ; `GET /village` et `/events` refusés avant authentification (l'ancien client se reconnecte toutes les 2 s). `HttpError(426)` passe par le gestionnaire d'`app.ts` ; la RFC 9110 demande un en-tête `Upgrade`. Un ancien client n'affiche que `error.message` : texte lisible par un joueur. Une commande refusée avant exécution ne consomme pas son UUID ; les intentions en `sessionStorage` sont rejouées par la V2 au rechargement. Les routes HUD, reçus et lectures n'ont pas d'en-tête de protocole.

## 4. Tests

- Serveur à supprimer (≈ 2 400 lignes) : `sync.integration.test.ts` (sauf reçus `commands/receipts/read`, classification des erreurs HTTP, projections de chantiers), `sync-lifecycle.test.ts`, `sync-projections.test.ts`, `read-reconciliation.test.ts`, `trade-sync.test.ts`.
- Serveur à adapter : `server-costs.integration`, `construction.integration` (mode confirmation), `vertical`, `stonemason`, `observation` (`market/trades`, oracle COUNT), `expeditions` (2 tests SSE), `http-logging`, `dev-timing`.
- Une vingtaine de fichiers utilisent des fonctions V1 comme fixtures (`constructBuilding` ×10, `getVillageState` ×15, `commandPlayerMarket` ×29 dans `trade.integration`) : les déplacer dans `legacy-commands.fixture.ts` réduit le changement à un import **[déduit]**.
- Oracle « rien n'a été écrit » par `villageSyncChanges` dans `read-previews`, `admin/service`, `trade`, `observation`, `bulk-insert-triggers`.
- `tests/fixtures/command-inventory.json` (`/village`, `/events`) ; e2e lisant `GET /village` ou forçant la V1 (`terrain-latency`, `-memory`, `-performance`, `-streaming`, `terrain-missions`).
- Client : `village-sync.test.ts`, `construction-presentation.test.ts`, `infrastructure-presentation.test.ts`, `client.test.ts`, `initial-village.test.ts`, `hud-intents.test.ts` ; contrats : `infrastructure-confirmation.test.ts`, tri dans `village-sync.test.ts`, `leveling.test.ts`, `terraforming.test.ts`.

## 5. Migrations de nettoyage (prochain numéro libre : 079)

**Nivellement.** Table `leveling_jobs` (047, contrainte refaite en 049, index `leveling_jobs_due`, déclencheur V2 de 053 et `village_sync_change` de 047). Colonne `population_cohorts.leveling_job_id` avec sa FK et le check d'exclusivité (à retirer avant la table ; le check de 044 couvre les autres colonnes). Type `world_feature_types('leveling-site')` (FK sans cascade depuis `world_features`, vider d'abord ; toute écriture sur une table suivie déclenche la publication V2). Filtre `retiredPrivateComponents` : rétention du journal 7 jours ou 10 000 entrées, dernières entrées `levelingJobs` le 30 octobre, donc retrait possible à partir du 6 novembre après vérification de `game_sync_changes` **[déduit]**. Ne pas éditer 047/053. Code et contrats liés : clés de terrain composées (`terrainFeatureKey` → `feature.id`), schémas `Leveling*`/`Terraform*` morts ; garder `levelingWork`, `LEVELING_WORK_MS_PER_QUARTER`, `isBuildingFootprintFlat`, `terraformCells`, `terraformQuote`, `MAX_TERRAFORM_CELLS`, `TerraformRequest`, `LevelingQuote`. **Conflit** : `leveling_jobs` contient les reçus des jobs terminés, et la spec §10 interdit d'effacer des reçus métier dans ce nettoyage.

**COUNT historique.** Table `village_sync_changes` (041), colonne `navigation_changed` et index (042), fonctions `mark_village_sync_change` / `mark_village_sync_catalog` (041), une cinquantaine de déclencheurs `village_sync_*` (041, 044, 047, 050, refaits par 060 et 061). Six fonctions écrivent `navigation_changed=true` (`mark_navigation_change` 042/046/065, `terrain_vertex_changed` et `terrain_model_changed` 048, `bulk_insert_collect` 060, `woodland_stump_navigation_change` 069), deux écrivent des marqueurs ordinaires (`bulk_science_places_collect` 061, seconde branche de `bulk_insert_collect`). PostgreSQL ne détecte pas ces références au `DROP TABLE`. Deux paliers : (1) supprimer les déclencheurs `village_sync_*` et purger les lignes `navigation_changed=false` ; (2) plus tard, redéfinir les huit fonctions et remplacer la table de navigation (compteur additif). Optionnel : `notify_expedition_receipt` si `ExpeditionWakeups` disparaît.

**Fenêtre de rollback.** Le déploiement migre (`ops/deploy/deploy.py`) et ne rétablit l'ancienne version que si le schéma n'a pas changé ; le binaire d'avant le lot I lit `village_sync_changes`. Livrer d'abord le code sans V1 (schéma intact), la migration ensuite.

## 6. Découpage proposé

1. **I.0 – Décisions et mesures.** Compter sur alpha et staging les `LEGACY_VILLAGE_READ` et les requêtes sans en-tête de protocole (critère de la spec §10).
2. **I.1 – HUD sans révision COUNT.** Indépendant. Recommandation : passer les deux routes HUD au contrat V2 avec `effects`. Navigateur : glisser-déposer, rechargement avec gestes en attente, deux onglets.
3. **I.2 – Client sans V1.** Drapeau, `getVillage`, `VillageSynchronization`, commandes V1, surcouches de confirmation, `legacyCaller`, `build.sh`. Serveur inchangé. Navigateur : chargement à froid, session expirée, monde sans village, V2 indisponible, toutes les commandes, kit, mobile, zéro `GET /village` ni `/events`. Risque principal : erreurs du chargement initial.
4. **I.3 – Serveur : 426, puis suppression.** 426 d'abord (revenable), suppression ensuite avec déplacement des fonctions V1 utiles en fixtures ; après expiration des anciens onglets. Le plus gros volume de tests.
5. **I.4 – Contrats et `state()`.** `VillageCommandResponse`, `VillageSyncBase`, `minimumRevision`, `InfrastructureConfirmation`, COUNT et modes morts de `state()`.
6. **I.5 – Migration nivellement, puis I.6 – migration COUNT** (deux paliers), après la fenêtre de rollback ; validées sur base de test.

**Décisions produit** (tranchées, voir plus bas) : texte et comportement du 426 ; ordre du HUD ; écran quand la V2 ne démarre pas (plus de repli invisible) ; perte de la poussée SSE des reçus d'expédition (sondage de 3 s) ; suppression du dernier filet de réveil par lecture (après le lot I, seule une commande réconcilie un village dont une notification se serait perdue) ; archivage ou perte des lignes `leveling_jobs`.

## Décisions de Tristan (1er novembre 2026, validées)

1. **Ancien client** : 426 avec « Une nouvelle version d'Arbestra est disponible. Rechargez la page. » ; les intentions en attente sont rejouées après rechargement.
2. **V2 qui ne démarre pas** : écran « Connexion au village impossible » avec « Réessayer » et reprises automatiques espacées ; plus de repli invisible sur la V1.
3. **Reçus** : pas de sondage. Tranche préalable à I.2 : reçus d'expédition et de récolte en composantes privées V2, publiées par déclencheurs sur `expedition_submissions` et `harvest_submissions`, livrées par le SSE V2 ; suppression du sondage de 3 s (`use-expeditions.ts`) et de la relève de `readHarvestReceipts`.
4. **Réveil par lecture** : supprimé ; risque accepté (notifications durables), balayage de réparation plus tard si une perte est observée.
5. **Historique `leveling_jobs`** : archivé dans une table d'archive, puis la table est supprimée (I.5).
6. **HUD** : ses deux routes passent au contrat V2 avec `effects` (I.1).

Ordre retenu : reçus V2, I.1, I.2, I.3 (mesure des accès V1 sur alpha avant le 426), I.4 ; I.5 et I.6 après la fenêtre de rollback.

## Zones d'incertitude

Données réelles (lignes `leveling-site`, `leveling_jobs`, entrées `levelingJobs` du journal) ; fréquence de `LEGACY_VILLAGE_READ` en production ; définition active de `mark_navigation_change` et nombre exact de déclencheurs (`pg_get_functiondef`) ; `WorkforceHud`/`Hud` en mode NOC avec `syncRevision` ; `reconcileVillageSnapshot` et `latestVillageSnapshot` (utilisés par des états V2, à garder) ; dépendances d'`ExpeditionWakeups` ; scripts `scripts/audit-command-closure.mjs` et `audit-command-dependencies.mjs` ; docs d'architecture à mettre à jour ensuite.

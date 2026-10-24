# Audit de la concurrence économique — 23 octobre 2026

Base relue : `main`, `5c1fb33`. Statut : **étude par lecture du code**, aucun test exécuté, aucune modification. « Observé » = lu dans le code ; « inféré » = raisonnement sur le comportement de PostgreSQL. Les points marqués ★ ont été revérifiés ligne par ligne lors de la rédaction ; les autres proviennent de l'analyse déléguée et restent à confirmer avant usage dans une spec.

## 1. Ordre canonique des verrous (observé)

Rang imposé par `beginVillageEconomy` ([reconcile-economy.ts:162-262](../apps/api/src/modules/villages/reconcile-economy.ts#L162)) :

| Rang | Verrou | Où |
|---|---|---|
| R0 | ligne `scheduled_tasks` (`SKIP LOCKED`) ou `expedition_submissions` | scheduler, expéditions |
| R1 | ligne(s) `villages` `FOR UPDATE`, triées par UUID si plusieurs | `:162` ; commerce [trade-service.ts:241-248](../apps/api/src/modules/villages/trade-service.ts#L241) |
| R2 | consultatif `infrastructure:<world_id>`, partagé ou exclusif, décidé **avant** acquisition ★ | `:173-178` |
| R3 | `stone_deposits` par UUID | `:223` |
| R4 | `woodland_deposits` par UUID (rayon 32 cases) | `:238` |
| R5 | lignes locales du village, `player_science` | handlers |
| R6 | `game_sync_streams` en ordre canonique, phase terminale | `game_sync_publish`, migration 059 |

Chemins examinés : scheduler et ses treize handlers, toutes les commandes HTTP de `service.ts`, `harvest-intents.ts`, `hud-workforce.ts`, la réconciliation de lecture, les écrivains spatiaux (`upgradeBuilding`, extension, factory, campus, `infrastructure.ts`, `leveling.ts`, `installation.ts`, `expeditions.ts`, `completeLeveling`), `placeBuilding` (verrou village puis consultatif dans une seule instruction à CTE), le commerce, `publishHallRoute`, l'onboarding, `atlas-routes.ts`, `terrain-vertices.ts`, la génération de monde, la rétention V2, la migration 015. Aucune fonction PL/pgSQL ne prend de verrou.

## 2. Interblocages

**Aucune inversion trouvée** (inféré depuis le code, non prouvé par test) :

- village/village : seul `beginTradePair` prend deux villages, triés ; aucun chemin ne prend un village après un gisement ;
- village/consultatif : toujours village d'abord ; l'exclusif est demandé dès la première acquisition ou ré-acquis par la même session ; aucune promotion partagé → exclusif (`hasActiveLeveling` est évalué avant R2 ★) ;
- gisement/consultatif : gisements toujours après R2 ;
- flux V2 : verrouillés en dernier, en ordre canonique.

**Erreurs de verrou mal exposées** (observé ★) : les commandes HTTP ne posent aucun `set local lock_timeout` ; une erreur PostgreSQL de verrou (55P03, 40P01) n'est pas une `HttpError` et devient un **500 `INTERNAL_ERROR`** ([app.ts:96-97](../apps/api/src/app.ts#L96)), sans `Retry-After`. Exceptions : `processing-v2.ts` et `economy-catchup.ts` (2 s / 5 s), `expeditions.ts` (500 ms / 2 s / 2 s ★).

## 3. Écrivains sous verrou partagé

Sous R2 **partagé**, ces chemins modifient un état pertinent pour la navigation : matérialisation des bosquets (occupation, `cleared`), achèvement de construction et d'extension, extraction de pierre, admissions de chantiers (`path_cells`), publication du cache HDV. Deux détenteurs partagés peuvent donc changer l'occupation de cases différentes en même temps. La sûreté repose sur les versions de chunks (triggers 046) et sur les lectures `REPEATABLE READ` du contexte de navigation. Résidu inféré, faible : `refineVillagePath` lit occupation et features en plusieurs instructions `READ COMMITTED` puis persiste `path_cells` sans certificat ; une vue déchirée par un commit partagé concurrent est possible.

## 4. Tests de concurrence `economy` et correctif 061

Observé ★ dans [economy.integration.test.ts](../apps/api/src/modules/villages/economy.integration.test.ts) : barrière `bounded()` à **5 s** (`:52`), `lock_timeout = '4s'` dans `backend()` (`:68`). **Aucun des deux tests ne pose 2 s** ; les 2 s viennent de `processing-v2.ts` et `economy-catchup.ts`, non exercés ici. Le handoff courant (« dépassant le `lock_timeout` de 2 s d'un second worker ») est donc imprécis : les limites qui jouaient sont la barrière de 5 s (somme des deux achèvements) et le `lock_timeout` de 4 s du test.

Migration 061 : remplace deux triggers par ligne sur `science_places` par un trigger par instruction. Le coût retiré est le relevé initial de 64 × 64 cases inséré par lots de 500 ([science/service.ts:212-215](../apps/api/src/modules/science/service.ts#L212) ★), exécuté par `admitScience` **après** la réconciliation mais toujours sous le verrou village ([complete-construction.ts:73-74](../apps/api/src/modules/villages/complete-construction.ts#L73) ★). Le correctif **réduit la fenêtre** (3,0–3,5 s → 0,9 s selon le handoff) sans retirer la cause : relevé, `readRc1Ground`, touches spatiales V2 et matérialisation des bosquets restent sous R1. Marge restante (inférée) : ~1,6 s sous la barrière de 5 s pour deux achèvements, ~1,1 s sous les 2 s de production de l'atelier V2. Les tests restent sensibles à la machine.

## 5. Travail exécuté sous verrou (observé)

- Village + R2 : `refineVillagePath` attend le pool de calcul (budget 30 s) ou raffine inline ([service.ts:615-628](../apps/api/src/modules/villages/service.ts#L615)) ; `stoneTravelPath` construit le réseau inline (`:496`) ; appelé par chaque réveil de chantier et par la **réconciliation de lecture** (`:1707-1714`).
- R2 exclusif : installation attend `compute.run` ([installation.ts:191-196](../apps/api/src/modules/onboarding/installation.ts#L191), `lock_timeout` 60 s) ; nivellement et infrastructure construisent le réseau ×3 ; `placeBuilding` charge `readRc1Source`.
- Village : relevé scientifique de 4 096 lignes ; sérialisation JSON du sol pour le worker au premier usage ; bosquets dans un rayon de 32 cases ; réécriture de toutes les cohortes à chaque `materializeCohorts`.

## 6. Risques concrets, par ordre d'importance

1. **Exclusif derrière de longs partagés.** `finaliseExpedition` demande l'exclusif avec `lock_timeout = 500 ms` ★ ; toute réconciliation de lecture ou tout worker tenant le partagé plus de 500 ms (raffinement jusqu'à 30 s, relevé 0,9 s) le fait échouer ; après trois tentatives, `EXPEDITION_COMPUTE_FAILED`. Fréquence inférée, non mesurée.
2. **Calcul de trajet sous R1/R2** : bloque toute commande du village et, dès qu'un exclusif est en attente, toute transaction économique du monde (PostgreSQL met les nouveaux partagés en file derrière un exclusif en attente — inféré).
3. **Aucun `lock_timeout` HTTP ; verrou → 500** au lieu d'un 503 réessayable.
4. **Installation sous exclusif** pendant tout le calcul du plan (jusqu'à 60 s).
5. **061 réduit sans supprimer** ; tests liés à l'horloge.

## 7. Correctifs minimaux proposés (sans refonte)

- Sortir le relevé initial de `admitScience` de l'achèvement de bâtiment vers sa propre tâche `science.wake` (déjà existante), pour que `building.complete` ne porte plus 4 096 insertions.
- Dans les entrées HTTP économiques : `set local lock_timeout` (2–3 s) et correspondance 55P03 / 40P01 / 57014 → 503 `ECONOMY_BUSY` avec `Retry-After` dans `app.ts` ; le scheduler réessaie déjà.
- `finaliseExpedition` : `lock_timeout` ≥ la durée partagée attendue, ou `navigationWrite = false` si cette finalisation n'écrit pas le terrain (à vérifier à [expeditions.ts:282](../apps/api/src/modules/science/expeditions.ts#L282)).
- Tests : barrières calculées depuis une mesure d'un achèvement isolé, ou assertion sur l'attente PostgreSQL observée (comme le second test) plutôt que sur une somme d'horloge ; `lock_timeout` posé explicitement dans les deux workers à la valeur testée.
- Corriger le handoff : `lock_timeout` de test 4 s, barrière 5 s ; les 2 s concernent l'atelier V2 et le rattrapage.

Les points 2 et 4 sont traités structurellement par la section 5 de la [spec de refonte](SPEC-REFONTE-NAVIGATION-ECONOMIE.md) (calcul hors verrou).

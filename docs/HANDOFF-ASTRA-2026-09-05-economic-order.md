# Handoff Astra — ordre temporel économique par village

Date : 5 septembre 2026. Implémentation : Terra/Codex ; finition et validation : Astra/Codex. Ce document accompagne le commit de clôture de la tranche.

## Objet de la tranche

Cette tranche implémente la priorité n°1 de la revue : l’état économique d’un village, à une borne H donnée, ne dépend plus de l’ordre dans lequel workers, retries et requêtes découvrent les transitions dues.

La spec complète est [SPEC-TERRA-2026-09-05-village-economic-order.md](./SPEC-TERRA-2026-09-05-village-economic-order.md). Elle était déjà non suivie dans le worktree au début de cette intervention et a été conservée.

## Décision mise en œuvre

Le nouveau point d’entrée est `beginVillageEconomy()` dans `apps/api/src/modules/villages/reconcile-economy.ts`.

1. Il verrouille la ligne `(world_id, village_id)` dans `villages` avec `FOR UPDATE`.
2. Il lit `statement_timestamp()` dans une instruction suivant l’acquisition du verrou.
3. Il récupère constructions et extensions dues jusqu’à cette borne.
4. Il les fusionne et les applique dans l’ordre `(échéance, id du sujet, type)`.
5. Une construction matérialise les flux directs et ses buffers à son échéance, puis devient terminée. Une extension matérialise les buffers, active ses cellules et devient terminée.

Le contexte retourné contient uniquement `worldId`, `villageId` et `through`. Les commandes le réutilisent pour débits, récolte, dates de départ et snapshot. `state()` relance une réconciliation à la même borne afin qu’une transition de durée nulle créée par la commande apparaisse dans le snapshot.

La borne n’emploie pas `transaction_timestamp()` : une transaction ouverte avant une attente de verrou ne doit pas ensuite faire reculer les curseurs avec une horloge périmée.

## Verrous et scheduler

Convention effectivement appliquée :

```text
Worker : tâche déjà acquise avec SKIP LOCKED → village → bâtiment/extension → flux/buffer/ressource
Requête :                                  village → bâtiment/extension → flux/buffer/ressource
```

Le scheduler dans `apps/api/src/jobs/scheduled-tasks.ts` n’a pas été modifié : il conserve `FOR UPDATE SKIP LOCKED`, ses savepoints et l’acquittement de sa seule tâche. Les handlers font une lecture non verrouillante du sujet pour retrouver le village, puis appellent le point d’entrée commun. Une tâche T2 peut donc appliquer T1 puis T2 sans acquérir ou modifier la tâche T1 ; le worker de T1 pourra l’acquitter ensuite sans effet économique supplémentaire.

Les jointures verrouillées de l’amélioration et de la récolte ciblent maintenant explicitement `buildings`. Les buffers et ressources sont parcourus par `resourceCode`. Les cellules d’une sélection sont réservées dans un ordre `(cellX, cellY)` stable.

## Notification ancienne et migration

`009_economic_task_notifications` remplace l’index unique pending des tâches par le même index, à l’exception de `building.complete`.

Motif : une lecture peut terminer une construction sans acquitter sa notification. Une amélioration ultérieure du même bâtiment doit créer sa propre tâche sans attendre, modifier ou acquitter l’ancienne tâche. Les autres types de tâche conservent l’unicité pending existante.

La migration est volontairement forward-only. Elle ne modifie aucune migration historique et ne supprime aucune donnée.

## Fichiers modifiés ou ajoutés

- `apps/api/src/modules/villages/reconcile-economy.ts` — nouveau coordinateur de réconciliation.
- `apps/api/src/modules/villages/complete-construction.ts` — handlers délégués au coordinateur.
- `apps/api/src/modules/villages/service.ts` — commandes et snapshots sur le même contexte économique ; verrou ciblé `buildings` ; ordres stables.
- `apps/api/src/modules/villages/economy.ts` — préconditions de verrou documentées.
- `apps/api/src/database/migrations/009_economic_task_notifications.ts` — adaptation de l’index pending.
- `apps/api/src/database/migrate.ts` — enregistrement de la migration 009.
- `apps/api/src/modules/villages/economy.integration.test.ts` — régressions temporelles et concurrence.
- `docs/architecture/economy.md` — invariant et convention de verrou.

## Tests réellement exécutés

La base ciblée était `arbestra_test` sur `127.0.0.1:5432`, validée par le garde-fou `_test`. La migration 009 a été appliquée à cette base de test uniquement pendant cette validation. Aucune base de développement n’a été réinitialisée.

`corepack pnpm test` : **39 tests verts**, dont 21 tests économiques PostgreSQL.

Les scénarios reproduits par les nouveaux tests PostgreSQL :

- T2 est volontairement rendue disponible avant T1 ; le worker qui prend T2 applique les deux transitions dans l’ordre temporel et atteint `1180` bois (`1000 + 60 + 120`). Le retry de T1 ne modifie plus ce résultat.
- Deux workers acquièrent deux notifications distinctes avant d’entrer dans leurs handlers. Ils finissent sans retry/deadlock et atteignent le même résultat économique.
- Une lecture termine une Scierie échue sans acquitter sa notification ; une amélioration est ensuite créée, donc deux notifications pending coexistent. Le traitement de l’ancienne notification ne termine pas l’amélioration future.
- Une commande détient le village ; un véritable worker acquiert ensuite l’ancienne notification avec `SKIP LOCKED` et attend le village. Le test observe cette attente avec `pg_blocking_pids`, puis laisse la commande réconcilier, débiter une seule fois et insérer la nouvelle notification. Les deux transactions terminent ; la nouvelle amélioration reste en cours.
- Un retry réel échoue avant sa réconciliation, est replanifié par `availableAt`, puis une notification plus récente réconcilie le village. Le retry ultérieur ne double pas le bois.
- Deux transitions au même timestamp sont découvertes dans les deux ordres, avec un reliquat initial de `0,5` et des débits de production fractionnaires avant/après l’échéance. Stock et reste sont vérifiés à une borne commune, à la précision numérique stockée. Un test distinct vérifie qu’une échéance exactement à la borne est incluse et celle située une milliseconde après est exclue.
- Une transaction de récolte ouverte en premier attend le village pendant qu’une autre récolte avance réellement le curseur économique. L’attente est observée dans PostgreSQL ; le snapshot suivant doit employer une borne au moins aussi récente et conserver le stock total, le reste et le curseur attendus.
- Une commande de durée nulle retourne directement son bâtiment terminé dans le snapshot.
- Un crash après réconciliation annule tous les changements de stock, reliquat, curseur et statut. Un crash d’extension conserve aussi la cellule réservée et son `pendingExpansionId`.
- Un buffer déjà plein avant une extension échue ne récupère pas rétroactivement la production plafonnée avant l’augmentation de capacité.

La comparaison chronologique applique T1 puis T2 dans deux transactions à leurs bornes respectives. Elle compare les ressources, restes, curseurs, buffers, niveaux, statuts, dates d’achèvement et occupations avec la découverte inverse. Les fixtures normalisent les dates initiales ; les identifiants aléatoires ne participent pas à cette comparaison métier.

Le retry utilise un délai positif de 60 secondes : il est effectivement inéligible après la réconciliation plus récente. Le test rend ensuite son `availableAt` éligible sans changer son échéance économique et vérifie l’acquittement de cette même tâche.

Les tests de rollback vérifient d’abord que les transitions ont réellement changé l’état dans le handler, puis injectent une erreur identifiée. Après le rollback au savepoint, toutes les lignes économiques sont comparées à leur état initial, y compris buffers et occupations. Un retry valide ensuite l’achèvement. Les barrières de concurrence sont bornées et leurs transactions sont drainées même en cas d’échec.

Les régressions existantes qui restent vertes couvrent notamment récolte concurrente, plafond de buffer, extension échue avant récolte, rollback d’un handler et double construction concurrente.

`corepack pnpm lint` : vert.

`corepack pnpm typecheck` : vert.

`git diff --check` : vert ; Git affiche seulement les avertissements CRLF habituels.

## Vérification rétrospective des régressions

Il ne s’agit pas d’un développement initial test rouge puis correction : Terra avait déjà implémenté la correction à la reprise. Astra a exécuté des variantes temporaires chargées par un transform Vitest, sans modifier les sources applicatives sur disque :

- Handler de construction du commit `7ddbe60` : le test T2 avant T1 échoue avec **1120 au lieu de 1180 bois**, reproduisant la perte historique de 60 bois.
- Lecture de `statement_timestamp()` déplacée avant le verrou village : le test de transaction ancienne échoue sur un `serverTime` antérieur à la récolte précédente.
- Suppression du verrou village : le même test échoue parce que l’attente PostgreSQL requise n’existe plus.
- Borne exclusive `<` au lieu de `<=` : le test de frontière échoue, la construction reste en cours à son échéance exacte.
- Suppression du rollback au savepoint : les deux tests de crash échouent sur les changements persistés de ressources, curseurs, statuts ou occupations.

Ces échecs attendus prouvent la sensibilité de ces régressions aux défauts visés ; ils ne constituent pas une preuve exhaustive de tous les entrelacements possibles. Le petit lanceur local dans `test-results/` est un artefact de vérification ignoré par Git, pas une nouvelle infrastructure livrée.

## Limite produit connue

La correction ne compense pas une production éventuellement perdue dans des données historiques : le modèle ne contient pas un journal suffisamment précis pour la reconstruire. Toute compensation doit être une décision produit et une tranche séparée.

## État Git à la reprise

La base de la tranche est `7ddbe60 feat: preserve world space and spatial gardens with September review`. Le commit de clôture contient la réconciliation, ses tests, la migration 009, la spec et cette documentation. Aucun refactor UI, monde, génération, gisements, combat, auth ou catalogue Jardin n’entre dans cette tranche. Le scheduler est inchangé ; aucune infrastructure ni modification de gameplay supplémentaire n’est introduite. La migration 009 reste à appliquer lors du déploiement normal de l’API.

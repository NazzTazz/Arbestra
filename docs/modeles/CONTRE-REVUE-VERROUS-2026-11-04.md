# Contre-revue : verrous de zone

Dépôt `NazzTazz/Arbestra`, branche `world-lock-scope`. Diff à relire : `d788b36..3a60fc3` (4 commits). Déployé sur staging (`staging-2026.11.04.8`), pas encore sur l'alpha.

```sh
git fetch origin world-lock-scope
git diff d788b36..3a60fc3 --stat
```

## Contexte

Avant cette branche, toute transaction économique prenait un verrou consultatif unique par monde, `infrastructure:<monde>`. Il était partagé pour les lecteurs et exclusif pour les écrivains spatiaux : terraformation, routes, pose, démolition, amélioration, installation. Un seul écrivain arrêtait donc tout le monde. Le test de charge local montrait 34 % d'erreurs à 30 bots.

La branche remplace ce verrou par des **verrous de zone**, un par chunk de 32 cases : `infrastructure:<monde>:<zx>:<zy>`. La clé du monde reste pour les installations, les territoires et les écrivains du monde entier. Le code annonce aucune migration et aucun changement de règle : mêmes refus, mêmes codes.

## À lire d'abord

1. `AGENTS.md`, section « Invariants techniques à préserver » : ordre village → verrous métier, borne `statement_timestamp()` lue après acquisition, worker en `SKIP LOCKED`, gisements de pierre verrouillés par UUID après le village.
2. `docs/VERROUS-2026-11-04.md` : la carte des verrous, telle que l'auteur la comprend. **Vérifie-la contre le code**, ne la tiens pas pour acquise.
3. `apps/api/src/modules/worlds/spatial-locks.ts` : le nouveau module.
4. Les appelants : `villages/reconcile-economy.ts` (`beginVillageEconomy`), `construction.ts`, `terrain-edits.ts`, `road-cells.ts`, `road-anchors.ts`, `demolition.ts`, `infrastructure.ts`, `trade-service.ts`, `service.ts`, `installation.ts`, `expeditions.ts`, `route-cache.ts`.
5. Les tests : `villages/spatial-locks.integration.test.ts` et `worlds/spatial-locks.test.ts`.

## Ce que je cherche

- **Entrelacement qui produit un état faux.** Deux transactions validées qui aboutissent à : double dépense ou double crédit, ressource négative, deux bâtiments sur une case, un trajet qui traverse une case modifiée pendant qu'il était admis, un sommet partagé incohérent avec une fondation voisine.
- **Zones insuffisantes.** Un écrivain qui modifie ou lit des cases hors des zones qu'il a prises. Un lecteur qui admet un trajet hors de la région calculée (`villageRegionZones`). Vérifier aussi les halos (`SPATIAL_WRITE_HALO`, `SPATIAL_READ_MARGIN`, `INSTALLATION_RADIUS`) contre les règles réelles. Y a-t-il un trajet admis qui sort de la région ? Une règle de voisinage qui regarde à plus de 2 cases ?
- **Interblocage.** Un chemin qui prend les verrous hors de l'ordre village → clé du monde → zones → gisements → lignes. Par exemple :
  - la prise « en retard » de `assertSpatialCoverage` en production ;
  - le passage d'une zone de partagé à exclusif dans une même transaction ;
  - un deuxième appel à `lockSpatial` après des gisements ;
  - le commerce entre deux villages.
- **Tore.** Zones à la couture du monde, monde dont la largeur n'est pas un multiple de 32, `wrappedSpan` sur un village à cheval sur la couture.
- **Cache `held`.** Il est indexé par objet transaction (`WeakMap`). Peut-il mentir : savepoint annulé, transaction réutilisée, `lockWholeWorld` ?
- **Tests de concurrence.** Forcent-ils réellement l'entrelacement (barrière, attente observée dans `pg_stat_activity`) ? Ou deux promesses en parallèle passent-elles par chance ? Un cas de conflit important manque-t-il ?
- **Rollback.** Après une erreur au milieu d'une transaction, plus aucun verrou ni aucune écriture ne doit rester.

## Hors sujet

- Le style, le nommage, les refactors généraux.
- Les performances, sauf si un défaut rend la correction fausse.
- Les recommandations R1 à R4 de la carte (scheduler, pool, calcul sous verrou) : c'est la tranche suivante.
- Ne modifie pas le code, ne pousse rien.

## Format attendu

Pour chaque point, du plus grave au moins grave :

- **Gravité** : bloquant, à corriger, ou remarque.
- **Scénario concret** : transaction A fait…, transaction B fait…, résultat.
- **Fichiers et lignes** au SHA `3a60fc3`.
- **Niveau de certitude** : lu dans le code, déduit, ou reproduit.

Si tu ne trouves rien de bloquant, dis-le explicitement et liste ce que tu as vérifié.

---

# Deuxième passage : correctif de ta revue

Commit `0208207` sur `wip/v2-commandes-bornees` (et `zone-locks-fixes`), un commit au-dessus de `3a60fc3`. Diff : `git diff 3a60fc3..0208207`. La voie choisie et les preuves sont dans `docs/VERROUS-2026-11-04.md` §10.

Résumé de l'auteur, à vérifier :

- Plus aucune zone n'est prise après coup. Un trajet qui sort des zones tenues lève `SpatialZonesMissing`. `withSpatialRetry` / `spatialTransaction` annule alors toute la transaction et la rejoue une fois, en déclarant d'emblée les zones apprises. Un second manque donne `409 SPATIAL_ACCESS_CHANGED`. Le scheduler rejoue dans un nouveau savepoint.
- `beginVillageEconomy` ajoute à la région les zones du dernier trajet inscrit vers les gisements distants des chantiers.
- Clé du monde : un drapeau `whole`, posé seulement par `lockWholeWorld`.
- Savepoints : `spatialSavepoint(tx)` restaure le cache après `rollback to savepoint`.
- Tests : `villages/spatial-locks-remote.integration.test.ts`, qui reprend ton scénario (dont l'interblocage forcé, `40P01` avant la correction), et `worlds/spatial-locks-cache.integration.test.ts`.

Ce que je cherche en plus des points du premier passage :

- **Rejeu non idempotent.** Un effet de bord hors base fait pendant la première tentative et qui survit à l'annulation : cache mémoire, publication SSE, file en mémoire, compteur, `devTime`, cache `held`.
- **Transactions non couvertes.** Une transaction qui admet un trajet ou écrit dans l'espace sans passer par `spatialTransaction`, et qui donnerait donc un 409 au lieu d'un rejeu, ou pire, aucune vérification.
- **Zones apprises.** Est-ce qu'elles suffisent toujours au rejeu, ou peut-il calculer un autre trajet qui sort encore des zones ? Est-ce qu'un rejeu peut prendre une zone dans un ordre qui recrée un cycle ?
- **Scheduler.** Le rejeu dans un savepoint sous la même ligne de tâche : verrous de village et de gisements déjà tenus avant le savepoint, puis zones prises après eux ?
- **Tes trois scénarios du premier passage** : sont-ils vraiment fermés ?

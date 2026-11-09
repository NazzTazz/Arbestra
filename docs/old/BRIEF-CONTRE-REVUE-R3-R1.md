# Contre-revue : délai de verrou des commandes (R3) et scheduler non bloquant (R1)

Dépôt `NazzTazz/Arbestra`, branche `wip/v2-commandes-bornees`. Diff à relire : `40d7c76..688c420`, en deux commits :

- `827425f` : R3, délai de verrou des commandes HTTP ;
- `688c420` : R1, scheduler non bloquant.

Déployé sur staging (`staging-2026.11.05.2`), pas encore sur l'alpha.

```sh
git fetch origin wip/v2-commandes-bornees
git diff 40d7c76..688c420 --stat
```

## Contexte

Les verrous de zone, que tu as relus en deux passages, sont déjà livrés. Ils remplacent le verrou mondial par un verrou par chunk.

Deux défauts restaient :

1. **Commandes HTTP (R3).** Une commande économique attendait un verrou sans limite, connexion tenue, jusqu'au délai du client (15 s), et finissait en 500.
2. **Scheduler (R1).** La boucle traitait une tâche à la fois. Une tâche qui attendait un village tenu par une commande bloquait toutes les autres. Le pool de 8 connexions était partagé avec l'API. Retard mesuré en local : 72 s à 10 bots, 156 s à 30 bots.

Ce que l'auteur annonce, à vérifier :

- **R3**
  - `set_config('lock_timeout', '4s', true)` dans `spatialTransaction`, seulement si aucun délai n'existe déjà. L'installation garde 60 s, l'atelier et le rattrapage 2 s, l'expédition 500 ms.
  - `55P03` donne `503 ECONOMY_BUSY` avec `Retry-After: 2`, hors de `withSpatialRetry`.
  - Une intention de récolte traitée par le scheduler ne devient jamais un refus définitif parce que le village est occupé.
  - Le client V2 n'est pas modifié : il traite un 5xx comme une issue incertaine et renvoie la même commande (même UUID).
- **R1**
  - Délai de 1,5 s posé après la prise de la tâche.
  - Un dépassement replanifie la tâche 1 s plus tard (issue `busy-rescheduled`), sans toucher `attempts` ni `last_error`.
  - 3 passes concurrentes de `drainScheduledTasks`, attendues ensemble (`allSettled`).
  - Pool séparé de 3 connexions pour le scheduler, auquel est aussi liée la voie de commandes du worker de trajets.
  - VPS : `max_connections = 60` pour alpha et staging ensemble.
- Pas de migration, pas de changement de règle de jeu.

## À lire d'abord

1. `AGENTS.md`, sections « Invariants techniques à préserver » (économie, worker, pierre) et « Vérification proportionnée ».
2. `docs/VERROUS-2026-11-04.md` §11 (R3 et R1), puis §4 et §5 pour la carte des verrous. **Vérifie-les contre le code.**
3. `apps/api/src/jobs/scheduled-tasks.ts`, `apps/api/src/server.ts`, `apps/api/src/app.ts`, `apps/api/src/errors.ts`, `apps/api/src/database/connection.ts`, `apps/api/src/modules/worlds/spatial-locks.ts` (`spatialTransaction`), `apps/api/src/modules/villages/harvest-submissions.ts`.
4. Les tests : `villages/command-lock-timeout.integration.test.ts` et `jobs/scheduled-tasks-busy.integration.test.ts`.

## Ce que je cherche

- **Scheduler parallèle et invariants.** Deux tâches traitées en même temps qui produisent un état faux. Pistes :
  - deux tâches du même village ;
  - une tâche qui finalise ou acquitte autre chose que sa propre ligne ;
  - une notification modifiée par une réconciliation ;
  - l'exception d'unicité `building.complete` ;
  - un ordre de traitement que le code supposait sériel, par exemple une tâche qui suppose qu'une autre, plus ancienne, est déjà passée.
- **Interblocage nouveau.** Avec 3 passes plus les commandes HTTP, un ordre de verrous qui forme un cycle. Pistes : tâche → village → zones → gisements, la ligne de tâche tenue pendant tout le handler, le worker de trajets sur le pool du scheduler.
- **Replanification `busy-rescheduled`.** Une tâche peut-elle être retentée indéfiniment sans jamais aboutir, ou affamer les autres tâches ? Peut-elle perdre son échéance ? Après le `rollback to savepoint`, reste-t-il un effet, un verrou ou une entrée de cache, en particulier le cache des zones restauré par `spatialSavepoint` ?
- **Délai de verrou mal placé.** Un `lock_timeout` qui fuit hors de sa transaction : `set_config(..., true)` est local à la transaction, à vérifier. Un délai qui s'applique à une transaction qui ne devait pas en avoir, comme l'installation, une migration ou une rétention. Un 503 renvoyé alors que des écritures ont été validées.
- **Commande rejouée par le client après un 503.** Le même UUID peut-il être appliqué deux fois, ou rester dans un état intermédiaire ? Que voit le joueur ?
- **Connexions.** Le compte de 21 connexions par environnement est-il juste : API, scheduler, observation, générateur, rétentions, pendant une migration ? Le pool du scheduler peut-il s'épuiser et bloquer la voie de commandes du worker de trajets, ou l'inverse ? L'arrêt propre (`shutdown`) attend-il bien les passes en cours avant de détruire les pools ?
- **Tests.** Les entrelacements sont-ils forcés (barrière, attente observée dans `pg_stat_activity`) ou passent-ils par chance ? Manque-t-il un cas important ?

## Hors sujet

- Le style, le nommage, les refactors généraux.
- Les performances, sauf si un défaut rend la correction fausse.
- R2 (calcul des trajets sous verrou) et la refonte des trajets : tranches suivantes.
- Ne modifie pas le code, ne pousse rien.

## Format attendu

Pour chaque point, du plus grave au moins grave :

- **Gravité** : bloquant, à corriger, ou remarque.
- **Scénario concret** : ce que fait A, ce que fait B, et le résultat.
- **Fichiers et lignes** au SHA `688c420`.
- **Niveau de certitude** : lu dans le code, déduit, ou reproduit.

Si tu ne trouves rien de bloquant, dis-le explicitement et liste ce que tu as vérifié.

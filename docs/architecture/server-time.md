# Temps serveur et actions différées

PostgreSQL est l’horloge autoritative. Les transactions utilisent `transaction_timestamp()` ; les dates sont des `timestamptz` exposés en ISO 8601 UTC.

Trois moments sont distincts :

- l’échéance métier (`construction_completes_at`) rend le résultat logiquement vrai ;
- la matérialisation applique ce résultat en base ;
- une notification client est un feedback sans autorité.

Une commande de construction débite, réserve l’emprise, crée le chantier et sa tâche `building.complete` atomiquement. Le worker prend une tâche éligible avec `FOR UPDATE SKIP LOCKED`. Le handler et la complétion de tâche partagent la transaction ; une erreur revient au savepoint et programme un retry.

Le handler est idempotent : un bâtiment déjà terminé est un no-op. Un index unique partiel interdit plusieurs tâches non terminées pour `(world_id, task_type, subject_id)`.

Une lecture réconcilie les chantiers dont l’échéance est passée avant de produire le snapshot. Le worker accélère donc la matérialisation sans créer une fenêtre de vérité fausse. Le snapshot fournit `serverTime` ; le navigateur estime un offset pour compteurs et animations seulement.

Pas de tick de ressource, de workflow générique, de queue externe ni de notification temps réel dans cette fondation.

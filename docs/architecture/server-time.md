# Temps serveur et actions différées

PostgreSQL est l’horloge autoritative ; les dates sont des `timestamptz` exposés en ISO 8601 UTC. Pour l'économie, `beginVillageEconomy()` verrouille d'abord le village, puis lit `statement_timestamp()` dans l'instruction suivante. Cette borne, prise après l'attente éventuelle, est commune à la commande et à son snapshot. `transaction_timestamp()` reste utilisé par le scheduler pour l'éligibilité et le retry des notifications ; il ne doit pas fournir une borne économique périmée après attente du village.

Trois moments sont distincts :

- l’échéance métier (`construction_completes_at`) rend le résultat logiquement vrai ;
- la matérialisation applique ce résultat en base ;
- une notification client est un feedback sans autorité.

Une commande de construction débite, réserve l’emprise, crée le chantier et sa tâche `building.complete` atomiquement. Le worker prend une tâche éligible avec `FOR UPDATE SKIP LOCKED`. Le handler et la complétion de tâche partagent la transaction ; une erreur revient au savepoint et programme un retry.

Les handlers retrouvent le village par une lecture non verrouillante du sujet, puis réconcilient toutes ses constructions/extensions dues dans l'ordre `(échéance, ID, type)`. Une notification déjà dépassée ne répète pas la transition achevée ; elle peut néanmoins déclencher d'autres transitions dues du village. Le scheduler acquitte uniquement sa tâche. La réconciliation n'acquiert jamais les verrous des autres notifications.

Depuis la migration 009, l'index unique partiel des tâches pending exclut `building.complete`. Une ancienne notification de construction peut donc coexister avec celle d'une amélioration ultérieure, sans qu'une commande tenant le village attende une ancienne tâche détenue par un worker. L'unicité reste en place pour les autres types. L'état métier, pas la présence d'une notification, décide de l'échéance applicable.

Une lecture réconcilie les chantiers dont l’échéance est passée avant de produire le snapshot. Le worker accélère donc la matérialisation sans créer une fenêtre de vérité fausse. Le snapshot fournit `serverTime` ; le navigateur estime un offset pour compteurs et animations seulement.

Pas de tick de ressource, de workflow générique, de queue externe ni de notification temps réel dans cette fondation.


## Échéances d’extraction

`deposit.extraction.complete` réveille la réconciliation du village propriétaire du travail. Réservations et travail persistent indépendamment de la notification. Retry ou ancienne tâche : aucun nouvel effet si le travail est terminé. Toutes les fins ≤H sont appliquées à leur date logique D ; les travailleurs consomment en working jusqu’à D, puis idle/repos jusqu’à H. `updated_at` du gisement est la date SQL de mutation ; `completed_at` du travail reste D. Aucun temps d’animation n’est autoritatif.

# Audit de justesse de la synchronisation V2 — 23 octobre 2026

Base relue : `main`, `5c1fb33`. Statut : **étude par lecture du code**, aucun test exécuté, aucune modification. Les trois risques « signalés, non reproduits » du handoff sont examinés ; pour chacun : réel (trace concrète), impossible (preuve par le code) ou indécidable. « Observé » = lu dans le code ; « inféré » = entrelacement raisonné. Les points marqués ★ ont été revérifiés ligne par ligne lors de la rédaction.

## Risque A — boucle client au changement d'epoch : **réel** (inféré), boucle de 2 s, non bornée

**Qui change une epoch.** Aucun code applicatif. `epoch` n'est écrite que par le défaut de colonne `gen_random_uuid()` ([051:12](../apps/api/src/database/migrations/051_game_sync_foundation.ts#L12) ★). La rétention ne touche que `retained_from` ([sync-v2-retention.ts:67-70](../apps/api/src/modules/villages/sync-v2-retention.ts#L67) ★) ; le handoff a raison sur ce point. Aucun `update … set epoch` ni `delete from game_sync_streams` dans `apps/`, `ops/`, `scripts/` ★. Déclencheurs réalistes : **restauration d'une sauvegarde** (`ops/deploy/backup.py` existe, et une restauration a été testée le 16 octobre), réparation manuelle, réinstallation. Une restauration produit aussi le cas voisin « révision cliente en avance » à epoch inchangée.

**Trace** (chemin de code observé ★) :

1. Le flux relit avec le curseur du client ; `readJournalSelection` renvoie `snapshot-required` motif `epoch` ([sync-v2-journal.ts:58](../apps/api/src/modules/villages/sync-v2-journal.ts#L58)) ; le flux écrit `event: reset` et se termine.
2. Client : `reset` → `SyncV2ResyncRequired` ([sync-v2-session.ts:100](../apps/world-web/src/api/sync-v2-session.ts#L100)) → `listen()` l'attrape et appelle `refresh(true)` ([sync-v2-transport.ts:178-180](../apps/world-web/src/api/sync-v2-transport.ts#L178)), qui lit `/sync/read` avec `cursors: []` et reçoit un snapshot complet portant la **nouvelle** epoch.
3. `session.apply(input)` → `applySyncV2Batch`, même génération, même session, périmètre déjà connu avec l'ancienne epoch :
   ```ts
   // packages/contracts/src/sync-v2.ts:514-516
   // Epoch replacement is an explicit recovery in a new subscription
   // generation. An old snapshot from a previous epoch cannot roll it back.
   if (previous && previous.epoch !== group.stream.epoch) return { kind: 'resync', state };
   ```
   Vrai aussi pour un `scope-snapshot` (test « rejects … an unsolicited epoch replacement »). État inchangé, `SyncV2ResyncRequired` relevée ([sync-v2-session.ts:52](../apps/world-web/src/api/sync-v2-session.ts#L52)).
4. `listen()` n'attrape que `SyncV2SessionExpired` dans ce `catch` ([:181-187](../apps/world-web/src/api/sync-v2-transport.ts#L181)) ; l'erreur de resync est avalée ; `setTimeout(listen, 2000)` ([:190](../apps/world-web/src/api/sync-v2-transport.ts#L190)) reconnecte avec les **anciens** curseurs → étape 1.

Aucun chemin ne crée une nouvelle génération ou session sur resync : `start()`/`bootstrapWorld` ne sont appelés qu'au montage ; `reconnect()` réutilise la session. La boucle est donc non bornée : toutes les 2 s, une capture `/sync/stream` et un `/sync/read` **complet de tous les périmètres abonnés** (privé, connaissance, manifeste, trafic, chunks), aussitôt rejeté. L'interface reste `ready` avec des données figées, sans erreur visible. Seul un rechargement de page (nouvelle génération) converge. Même boucle pour le motif `ahead` (restauration sans changement d'epoch) : `toRevision < previous.revision` → `continue` ([sync-v2.ts:519](../packages/contracts/src/sync-v2.ts#L519)), résultat `ignored`, curseurs inchangés → `reset` → … toutes les 2 s.

Aucune condition de course n'est nécessaire ; un seul changement d'epoch suffit.

**Correctif proposé** : sur `SyncV2ResyncRequired` issue de `refresh(true)`, reconstruire la session avec des périmètres vides (ou incrémenter la génération et rappeler `start()`), afin que `previous` soit indéfini et que le snapshot soit accepté. Régression : fixture avec epoch modifiée en base entre deux lectures ; sur `5c1fb33`, le client ne converge pas en 10 s ; après correctif, un seul snapshot puis reprise normale.

## Risque B — deux purges concurrentes : **orphelin réel** (inféré), **référence pendante impossible**, « sans incidence de lecture » **exact**

Préconditions : deux passes exigent deux processus (vol unique par processus, [sync-v2-retention.ts:97-103](../apps/api/src/modules/villages/sync-v2-retention.ts#L97) ; une seule unité `arbestra-api@env` par environnement) : chevauchement de déploiement ou seconde instance. `FOR UPDATE SKIP LOCKED` sérialise par **flux**, pas par **lot**.

**Entrelacement orphelin** (`READ COMMITTED`, pas d'isolation posée) : le lot B est référencé par r1 (flux S1) et r2 (flux S2), tous deux expirés. P1 verrouille S1 et supprime r1 ; P2 verrouille S2 et supprime r2. P1 exécute `delete from game_sync_batches … not exists(select 1 from game_sync_changes …)` ([:75-77](../apps/api/src/modules/villages/sync-v2-retention.ts#L75) ★) : son instantané voit encore r2 (P2 non validé) → B conservé ; symétriquement P2 voit r1 → B conservé. Les deux valident ; B n'a plus de référence et rien ne le revisitera (la suppression de lots ne porte que sur les `removed` de la passe courante). Fuite permanente, de taille bornée par le nombre de lots multi-flux expirés pendant un chevauchement.

**Référence pendante impossible** : la migration 059 pose `foreign key (world_id, dependencies_batch_id) references game_sync_batches(world_id, batch_id)` sans `on delete` ([059:19-20](../apps/api/src/database/migrations/059_game_sync_batch_dependencies.ts#L19) ★) ; supprimer un lot encore référencé viole la contrainte et annule la passe de ce flux. Les lecteurs chargent les vecteurs dans le même instantané `REPEATABLE READ` que les lignes ; un lot orphelin n'est jamais consulté ; un vecteur manquant ferait échouer la lecture explicitement (`Missing synchronization batch`, [sync-v2-journal.ts:100](../apps/api/src/modules/villages/sync-v2-journal.ts#L100)) plutôt que silencieusement.

**Correctif proposé** : supprimer les lots orphelins dans une passe dédiée bornée (`not exists` sur tous les lots plus vieux que la rétention), ou poser `SERIALIZABLE` sur la seule transaction de rétention ; la seconde option est plus simple et le volume est faible.

## Risque C — plafonds 4 096 références / 10 000 révisions : **falaise réelle**, pas de troncature, pas de perte silencieuse, mais un périmètre devenu **inchargeable**

Plafonds (observé ★) :

- Delta : plus de 10 000 révisions ([sync-v2-journal.ts:64](../apps/api/src/modules/villages/sync-v2-journal.ts#L64)), plus de 4 096 références ou 128 dépendances (`:109`) → `snapshot-required` motif `size`. Sûr : converge vers un snapshot.
- Snapshot privé : `limit 4097` puis `if (references.length > 4096) throw new RangeError(...)` ([sync-v2-readers.ts:80, 90](../apps/api/src/modules/villages/sync-v2-readers.ts#L80)) ; puis, par composant, `ids.length > 1024` → `RangeError` (`:150` et suivantes) ; trafic > 1 024 convois actifs par monde ; spatial 4 096 / 1 024. Une `RangeError` n'est pas une `HttpError` → **500 `INTERNAL_ERROR`** ([app.ts:96-97](../apps/api/src/app.ts#L96) ★).

Rien n'est tronqué : lecture de 4 097 lignes, puis exception. Pire cas : un village de plus de 1 024 bâtiments, ou de plus d'environ 4 090 entités privées (`garden_plots` compte **une ligne par case**, [015:76-83](../apps/api/src/database/migrations/015_garden_plots.ts#L76)), ou un monde de plus de 1 024 convois en vol (chaque écran de village inclut `traffic`) :

- bootstrap → snapshot → 500 → le village **ne se charge plus du tout** ;
- client connecté dont le curseur passe sous `retained_from` (7 jours ou 10 000 révisions) ou dont le delta dépasse 4 096 références → `reset` → `refresh(true)` → 500 (`SyncV2HttpError` avalée) → 2 s → `floor`/`size` à nouveau → boucle de 2 s, interface figée. Le plancher de rétention transforme donc un curseur valide en snapshot forcé, qui échoue ;
- désalignement journal/lecteur : un delta de moins de 4 096 références mais de plus de 1 024 identifiants d'un même composant (bâtiments, par exemple) lève dans le lecteur au lieu de retomber sur un snapshot → 500 sur `/sync/stream`, réessai toutes les 2 s avec le même curseur, sans progrès tant que la rétention n'a pas dépassé ce curseur.

La spec V2 prévoit la pagination (§8.4 : « un lot trop grand devient une invalidation suivie d'une lecture ciblée paginée ») ; elle n'est pas implémentée. Les seuils sont improbables aujourd'hui en alpha, mais ce sont des échecs durs, pas des dégradations.

**Correctifs proposés**, par ordre : (1) convertir chaque `RangeError` de lecteur en `HttpError` 503 typée `SCOPE_TOO_LARGE` avec `Retry-After`, pour que le NOC la voie et que le client affiche un état plutôt qu'un silence ; (2) aligner les plafonds journal/lecteur (le journal doit demander un snapshot avant que le lecteur ne puisse lever) ; (3) implémenter la pagination de snapshot prévue par la spec, en commençant par le composant le plus nombreux (`garden_plots`).

## Autres invariants vérifiés

- Ordre et trous : compteur et ligne validés dans une même transaction ; le lecteur contrôle nombre et contiguïté dans le même instantané ([sync-v2-journal.ts:79, 95](../apps/api/src/modules/villages/sync-v2-journal.ts#L79)). Sain (observé).
- Livraison au moins une fois, application idempotente : groupes relivrés avec `toRevision <= previous.revision` ignorés ([sync-v2.ts:519-520](../packages/contracts/src/sync-v2.ts#L519) ★) ; les `effects` n'avancent jamais le curseur. Sain.
- Lot mixte périmé/en avance → resync, puis la boucle A ne s'applique que si une condition epoch/ahead existe ; sinon `refresh(true)` est accepté et converge.
- `batch-too-large` (256 Kio) et client lent convergent par snapshot HTTP, sauf si C se déclenche.
- **Indécidable ici** : les lecteurs de snapshot partagé, spatial et trafic émettent-ils toujours tous les composants du registre (exigé par `sync-v2.ts:505-509`) ? Le lecteur privé le fait ; les trois autres n'ont pas été vérifiés.

## Priorité

A est le plus grave : un seul événement d'exploitation ordinaire (restauration) fige tous les clients ouverts sans message, et chaque client charge un snapshot complet toutes les 2 s. Le correctif tient en quelques lignes côté client. C vient ensuite (observabilité puis pagination). B est une fuite bornée, à traiter avec la rétention.

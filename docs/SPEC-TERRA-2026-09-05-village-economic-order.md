# Tranche Terra — Ordre temporel et sérialisation économique par village

Date : 5 septembre 2026. Destinataire : Terra/Codex, agent d’implémentation.

**Mission : implémenter cette spec, rien de plus.** Terra convient à cette tranche bornée ; le recours à Sol n’est pas nécessaire. Relire le worktree avant intervention et conserver les éventuelles modifications intervenues depuis cette spécification.

Cette tranche couvre uniquement la priorité n°1 de la revue architecturale : consolider l’ordre temporel et la sérialisation économique par village.

## État de référence et niveau de preuve

La spécification provient d’une nouvelle lecture du worktree, sauvegardé dans le commit `7ddbe60` sur `origin/master`. Le distant possédait aussi `main`, restée sur `c75115f` ; elle n’a pas été déplacée. Le commit sauvegarde les travaux préexistants, pas l’implémentation de cette spec.

Lors de cette lecture : `typecheck` et `lint` passent. Aucun test PostgreSQL, reset ou migration n’a été exécuté. **Les défauts temporels et scénarios de concurrence décrits sont établis par analyse du code, pas reproduits pendant cette session.** Les résultats de tests historiques présents dans le handoff ne constituent pas une reproduction de ces nouveaux scénarios.

Le contrôle du contenu indexé signalait deux détails de whitespace préexistants dans `docs/ARBESTRA_CONTEXT_FOR_ASTRA.md`, conservés. Ne pas profiter de cette tranche pour les corriger.

Pour l’implémentation, exécuter les validations PostgreSQL sur une base de test dédiée et vérifier sa destination avant tout setup/reset. Ne jamais réinitialiser la base de développement. Ne pas exécuter de migration destructrice. Distinguer dans le compte rendu les garanties du code, les déductions et les scénarios effectivement reproduits.

## 1. But joueur et invariant métier

Une construction ou une extension doit commencer à produire à son échéance prévue, même si le joueur revient tard ou si plusieurs workers découvrent les échéances dans un ordre différent.

> Pour un état initial valide, des règles économiques identiques, une même suite de commandes acceptées avec leurs dates d’effet et une même borne d’observation H, l’état économique du village à H doit être indépendant de l’ordre de découverte des échéances, de leur répartition entre workers et des retries.

La précision « même suite de commandes acceptées » est nécessaire : deux commandes concurrentes qui dépensent le même stock peuvent légitimement avoir un gagnant différent. Cette tranche garantit leur sérialisation, pas la commutativité de leurs résultats.

L’état économique comparé comprend les stocks, fractions de production, buffers, capacités et taux actifs. Deux exécutions peuvent avoir matérialisé leurs compteurs à des moments différents ; leur comparaison doit donc se faire à une borne commune.

Pour chaque intervalle entre deux transitions, la production est calculée avec les règles actives pendant cet intervalle. À une échéance T :

1. Calculer la production jusqu’à T avec les anciennes règles.
2. Appliquer la transition.
3. Employer les nouvelles règles après T.

| Entrée | Garantie |
|---|---|
| Lecture d’état | Toutes les transitions dues jusqu’à sa borne sont appliquées avant la projection. Le snapshot économique est cohérent à cette borne. |
| Commande joueur | Réconciliation avant validation économique, débit, récolte ou modification des capacités/taux. Mutation et snapshot utilisent la même borne. |
| Worker | Sa tâche déclenche la réconciliation du village, incluant les transitions antérieures encore dues. |
| Retry | Aucun effet économique déjà appliqué n’est rejoué. Une ancienne tâche ne termine jamais prématurément une nouvelle amélioration du même bâtiment. |
| Deux workers du même village | Un seul applique des transitions économiques à la fois. Le second relit l’état après l’acquisition du verrou. |

Une lecture sans transition due continue de projeter la production sans écrire systématiquement les compteurs.

## 2. Diagnostic exact de l’existant

### Fichiers concernés

- [scheduled-tasks.ts](../apps/api/src/jobs/scheduled-tasks.ts)
- [complete-construction.ts](../apps/api/src/modules/villages/complete-construction.ts)
- [economy.ts](../apps/api/src/modules/villages/economy.ts)
- [service.ts](../apps/api/src/modules/villages/service.ts)
- [server.ts](../apps/api/src/server.ts), qui enregistre les deux handlers.

### Acquisition et transaction du scheduler

`processNextScheduledTask()` :

1. Ouvre une transaction.
2. Sélectionne une tâche non terminée, avec `dueAt` et `availableAt` échus selon `transaction_timestamp()`.
3. Trie par `availableAt`, puis `id`.
4. Prend `FOR UPDATE SKIP LOCKED` sur cette tâche.
5. Crée un savepoint et appelle le handler dans la même transaction.
6. En cas de succès, acquitte uniquement cette tâche.
7. En cas d’erreur, annule les effets du handler jusqu’au savepoint, incrémente `attempts` et reporte `availableAt`.

Le verrou de tâche reste détenu pendant le handler. `startScheduledTaskWorker()` évite deux polls simultanés dans sa propre instance, mais ne sérialise pas plusieurs instances.

### Achèvement d’une construction

`completeConstruction()` appelle directement `completeConstructionById()` :

1. Verrou du bâtiment.
2. Vérification de son statut et de la présence d’une échéance.
3. Matérialisation de **tous les flux directs du village** jusqu’à `constructionCompletesAt`, dans l’ordre des codes ressource.
4. Matérialisation des buffers du bâtiment à cette même date.
5. Application de `targetLevel`, passage à `completed`, et `completedAt` égal à l’échéance.

Il n’y a ni verrou village ni vérification que l’échéance actuelle du bâtiment est effectivement due. Ce dernier point compte pour un retry : le bâtiment peut avoir commencé une autre amélioration depuis la réconciliation de l’ancienne.

### Achèvement d’une extension

`completeExpansionById()` :

1. Verrou de l’extension.
2. Matérialisation des buffers du bâtiment à `completesAt`.
3. Activation des occupations par suppression de `pendingExpansionId`.
4. Passage de l’extension à `completed`.

La boucle des buffers n’est pas triée. Le bâtiment et le village ne sont pas verrouillés explicitement.

### Ressources et curseurs

`materializeVillageResource()` prend : `flux FOR UPDATE → ressource UPDATE`. Sans flux, il verrouille directement la ressource.

`materializeBuildingBuffer()` verrouille le buffer, lit son taux et sa capacité, puis écrit quantité, reste et curseur. Pour le Jardin, le taux et la capacité dépendent des occupations actives.

Les deux matérialisations utilisent `effectiveThrough = max(échéance demandée, curseur enregistré)`. Cela empêche le recul du curseur, mais **ne répare pas une transition appliquée en retard derrière ce curseur**.

Déduction directe du code : si le Jardin à T2 est terminé avant la Scierie à T1, son achèvement matérialise aussi le bois jusqu’à T2 avec l’ancien taux. Appliquer ensuite la Scierie à T1 ne recalcule pas l’intervalle T1–T2.

### Chemins interactifs et snapshot

`state()` capture `transaction_timestamp()`, puis appelle les deux réconciliations, les projections de ressources et buffers, et construit le snapshot.

Les deux recherches d’échéances sont sans tri. Les constructions sont toujours parcourues avant les extensions, sans fusion chronologique.

| Chemin | Réconciliation avant la mutation |
|---|---|
| `constructBuilding()` | Constructions |
| `constructBuildingArea()` | Constructions puis extensions |
| `expandGarden()` | Constructions puis extensions |
| `upgradeBuilding()` | Constructions ; le chemin de compatibilité Jardin délègue à `expandGarden()` |
| `harvestGarden()` | Constructions puis extensions |
| `state()` final | Constructions puis extensions à nouveau |

Toutes ces commandes retournent ensuite `state()` dans leur transaction.

### Ordres de verrous actuels

En omettant les lectures ordinaires :

- Worker construction : `tâche → bâtiment → flux → ressource → buffer`.
- Worker extension : `tâche → extension → buffer → occupations`.
- Construction interactive : réconciliation préalable, puis éventuellement advisory lock de limite, ressources, insertion bâtiment/occupations/buffers/tâche.
- Extension interactive : réconciliation, puis bâtiment, buffer, ressources, nouvelle extension, occupations, tâche.
- Amélioration : réconciliation, puis bâtiment et occupation jointe, ressources, modification bâtiment, tâche.
- Récolte : réconciliation, puis bâtiment et catalogue joint, buffer, ressource.

Les `FOR UPDATE` des jointures d’amélioration et de récolte ne ciblent pas uniquement `buildings`. Ils peuvent donc verrouiller respectivement les occupations jointes et une ligne partagée de `buildingTypes`.

### Autre contrainte directement liée

La migration [004_world_economy_foundation.ts](../apps/api/src/database/migrations/004_world_economy_foundation.ts) crée `scheduled_tasks_one_pending_subject`.

Cet index unique interdit plusieurs tâches pending pour le même `(world_id, task_type, subject_id)`.

Après un achèvement par lecture, l’ancienne tâche peut rester pending. Une nouvelle amélioration du même bâtiment tente alors d’insérer une autre tâche `building.complete` et rencontre cette unicité.

C’est un conflit garanti pour cette configuration. Un deadlock de cet `INSERT` précis n’a pas été reproduit ; en revanche, résoudre le conflit en acquittant ou mettant à jour l’ancienne tâche sous verrou village introduirait l’inversion interdite.

## 3. Design minimal proposé

Créer un petit module `apps/api/src/modules/villages/reconcile-economy.ts`. Il contient la coordination temporelle et les primitives d’application des transitions. Garder les handlers et leurs constantes dans `complete-construction.ts`.

Deux fonctions étroitement liées suffisent :

- `beginVillageEconomy(tx, worldId, villageId)` : prend le verrou village, choisit la borne, réconcilie, retourne un contexte de transaction.
- `reconcileVillageEconomy(tx, context)` : applique les transitions dues jusqu’à la borne explicite du contexte, sous le verrou déjà acquis.

Le contexte contient uniquement `worldId`, `villageId` et `through`. Il appartient à la transaction appelante ; il ne doit jamais être conservé ou réutilisé dans une autre transaction. Aucune classe de session économique ou infrastructure supplémentaire.

### Acquisition et borne

`beginVillageEconomy()` doit :

1. Verrouiller la ligne `villages` identifiée par monde et village avec `FOR UPDATE`.
2. Après le retour de cette requête, lire l’heure PostgreSQL dans une **nouvelle instruction**, par exemple `statement_timestamp()`.
3. Fixer cette valeur comme `through`.
4. Appeler la réconciliation.

Ne pas employer `transaction_timestamp()` pour cette borne : une transaction commencée tôt peut attendre un village déjà avancé par une transaction commencée plus tard.

La borne n’est ni fournie par le client ni dérivée de `task.dueAt`. Ce n’est pas une API de lecture historique.

### Parcours des transitions

Sous le verrou village :

1. Lire les constructions/améliorations en cours dont `constructionCompletesAt <= through`.
2. Lire les extensions en cours dont `completesAt <= through`.
3. Fusionner ces transitions.
4. Les trier par `(échéance, identifiant du sujet, type de transition)`.
5. Les appliquer séquentiellement.

Le type sert uniquement à rendre l’ordre total si deux tables contiennent le même UUID à la même échéance. L’identifiant de tâche et `availableAt` ne participent jamais à l’ordre métier.

Conserver les calculs actuels :

- Construction/amélioration : matérialiser les flux directs et les buffers concernés à l’échéance, puis changer le statut/niveau.
- Extension : matérialiser les buffers à l’échéance, puis activer la surface.
- Ne pas matérialiser systématiquement tous les compteurs jusqu’à `through` à la fin.

Les primitives par identifiant deviennent internes au module. Elles revérifient le statut et l’échéance avant application ; aucun handler ne peut les appeler directement en contournant la réconciliation.

### Handlers

Le handler retrouve le village du sujet par une lecture **sans verrou métier**, y compris si le sujet est déjà terminé. Il appelle ensuite `beginVillageEconomy()`.

Ainsi, une tâche T2 peut terminer T1 puis T2. Elle peut aussi réconcilier une transition antérieure dont la tâche est en retry ou détenue par un autre worker.

Les lignes métier portent la vérité des échéances. Le scheduler acquitte ensuite seulement la tâche qu’il détient.

Un sujet absent reste un succès sans effet, conformément au comportement actuel. Une ancienne tâche ne doit pas déclencher l’achèvement direct du chantier actuellement porté par son `subjectId` : seules les transitions réellement dues à `through` sont applicables.

### Commandes et `state()`

Après identification et contrôle d’appartenance du village :

1. Chaque commande appelle `beginVillageEconomy()` avant toute validation dépendant de l’état économique ou des constructions.
2. Elle utilise `context.through` pour débits, récoltes et dates de départ.
3. Les nouvelles échéances sont calculées depuis cette même borne.
4. Le snapshot final réutilise le contexte, sans reprendre une heure différente.
5. Juste avant ce snapshot, une nouvelle réconciliation à la **même borne** permet de traiter une transition créée avec une durée nulle.

Pour `getVillageState()`, `state()` obtient lui-même ce contexte. Pour une mutation, il reçoit celui déjà acquis. Cette adaptation locale de signature suffit ; ne pas décomposer tout le service.

Le verrou reste détenu jusqu’au commit, snapshot compris.

### Adaptation minimale de l’unicité des tâches

Ajouter une migration limitée remplaçant l’index unique pending par un index unique de mêmes colonnes dont le prédicat exclut `task_type = 'building.complete'`.

Les autres types conservent leur unicité actuelle. Les tâches conservent leur clé primaire.

Pour `building.complete`, la création unique de chaque chantier est assurée par la commande transactionnelle sous verrou village et sa vérification de statut. Une ancienne notification pending peut donc coexister avec celle d’une nouvelle amélioration.

Ne pas ajouter d’`UPSERT`, d’acquittement anticipé ou de nettoyage des anciennes tâches depuis la réconciliation. Ne pas modifier les migrations historiques ni supprimer des tâches existantes.

## 4. Politique de verrouillage

> Toute opération sur l’économie d’un village acquiert son verrou village avant ses verrous métier et le conserve jusqu’à la fin de transaction. Sous ce verrou, elle n’acquiert jamais une tâche existante du scheduler, explicitement ou par résolution d’un conflit d’insertion.

Il s’agit d’un ordre partiel, suffisant pour cette tranche :

```text
Worker : tâche déjà acquise → village → verrous métier du village
Requête :                     village → verrous métier du village
```

Après le village :

- Application des transitions dans l’ordre temporel défini.
- Verrou du bâtiment ou de l’extension avant ses matérialisations.
- Pour un flux direct : flux avant ressource.
- Parcours des ressources et buffers par `resourceCode`.
- Réservations de plusieurs cellules par `(cellX, cellY)` normalisées, dans un ordre stable.
- `FOR UPDATE` des jointures limité à la table métier visée ; aucun verrou de catalogue partagé pour récolter un Jardin.

Il n’est pas nécessaire d’imposer « tous les bâtiments avant tous les buffers » à l’échelle du village : cela compliquerait le parcours chronologique sans renforcer sa sérialisation.

Les réservations ordonnées concernent aussi deux villages qui disputeraient plusieurs cellules communes. Elles doivent être appliquées dans `reserveSelection()` sans changer l’ancre ni la forme choisie.

Endroits à adapter ou vérifier :

- Les deux handlers et les primitives d’achèvement.
- `getVillageState()`/`state()`.
- Les cinq commandes de construction, amélioration, extension et récolte.
- `debit()` et les matérialisations : précondition de verrou village documentée.
- `reserveSelection()`.
- Les insertions de tâches après une mutation.
- Les appels directs des tests.

### Cas de deux workers

W1 détient la tâche T2 et le village. W2 détient T1 et attend le village.

W1 applique les transitions métier T1 puis T2 **sans toucher à la tâche T1**. Il acquitte T2 et commit. W2 obtient alors le village, constate les transitions déjà appliquées, puis acquitte T1.

Il n’y a pas de cycle tâche/village.

Conserver les savepoints et retries actuels. Ne pas ajouter `SERIALIZABLE` globalement ni de verrou global des villages.

## 5. Tests de régression obligatoires

Écrire les tests dans les suites PostgreSQL existantes, éventuellement dans un fichier économique dédié si leur lecture devient difficile. Utiliser des barrières explicites pour la concurrence, avec timeout et libération en `finally`. Un simple `Promise.all()` ne prouve pas l’entrelacement voulu.

Les résultats doivent être vérifiés par des valeurs métier calculées indépendamment, pas seulement en comparant deux exécutions potentiellement fausses. Pour les comparaisons exactes, utiliser une borne commune et des dates de fixture explicites sous verrou ; ne pas exposer une horloge réglable au client. Pour les commandes utilisant l’heure réelle PostgreSQL, calculer les attentes depuis leur borne et éviter les assertions fragiles fondées sur la vitesse de la machine.

### A — Découverte T2 puis T1

- Initial : bois `1000`, reste `0`, curseur T0, production naturelle `60/h`. Scierie L1 et Jardin en chantier ; coûts déjà payés.
- Échéances : Scierie à T1 = T0 + 1 h ; Jardin à T2 = T0 + 2 h. Toutes deux échues.
- Actions : imposer par `availableAt` l’acquisition de la tâche Jardin avant celle de la Scierie. Comparer avec une fixture identique traitée chronologiquement.
- Attendu à T2 : `1000 + 60 + 120 = 1180` bois, reste `0`, taux `120/h`, deux bâtiments terminés à leurs échéances respectives.
- Invariant : découvrir T2 déclenche d’abord T1 ; les `60` bois supplémentaires de T1–T2 ne disparaissent pas.

Vérifier le résultat après la première tâche, puis son absence de changement économique au traitement de l’ancienne tâche.

### B — Deux workers du même village

- Initial et échéances : fixture A.
- Actions : W1 acquiert T2, W2 acquiert T1 ; une barrière garantit que les deux tâches sont détenues avant de laisser les handlers continuer.
- Attendu : deux tâches acquittées, résultat de A, aucun `retry-scheduled` dû à un deadlock.
- Invariant : `SKIP LOCKED` laisse acquérir deux tâches distinctes, tandis que le village sérialise leur effet économique.

La barrière doit précéder le verrou village ; attendre que les deux workers aient ce verrou serait un test incorrect.

### C — Retry ancien

- Initial : fixture A, tâche T1 différée par un retry tandis que T2 est disponible.
- Actions : traiter T2 ; rendre ensuite T1 disponible et la traiter.
- Attendu : T2 a déjà produit les `1180` bois à T2 ; T1 n’ajoute ni ne retire de production et ne change pas les dates d’achèvement.
- Invariant : `availableAt` reporte une notification, pas la date d’effet économique.

Ajouter dans ce test une branche avec une nouvelle amélioration de Scierie, échéance future T3 : rejouer l’ancienne notification ne doit ni terminer cette amélioration ni avancer son niveau.

### D — Extension, récolte et snapshot

Conserver et renforcer le test existant de récolte d’une extension échue :

- Initial : Jardin d’une cellule, buffer vide à T0, taux `60/h`, capacité `600`, stock village `50` carottes.
- Échéance : activation d’une cellule supplémentaire à T1 = T0 + 1 h.
- Action : récolte à H = T0 + 2 h sans worker préalable.
- Attendu : `50 + 60 + 120 = 230` carottes au village, buffer vide, deux cellules actives, capacité `1200`, aucune extension pending.
- Invariant : capacité et taux changent à l’échéance, avant l’avancement du buffer et la récolte.

Vérifier aussi le plafond par une variante ciblée : buffer initialement plein, une heure avant extension puis une heure après. Attendu à H : `600 + 120 = 720`, sans récupération de la production perdue avant l’augmentation de capacité.

### E — Égalité d’échéances, borne et fractions

- Initial : Scierie L2 en amélioration vers L3, production totale `168/h`, reste bois `0,5` à T0 ; Jardin en construction.
- Échéance commune : T = T0 + 10 s.
- Actions : découvrir les deux tâches dans les deux ordres ; comparer à H = T + 10 s.
- Attendu : production exacte ajoutée avec reste initial : `0,5 + 168 × 10 / 3600 + 254,4 × 10 / 3600 = 1,673333…`. Donc une unité entière ajoutée et le reste numérique correspondant, sans remise à zéro.
- Invariant : ordre total pour les égalités, conservation des fractions, aucune durée artificielle entre transitions simultanées.

Avec une borne de réconciliation explicite T, les deux transitions sont incluses ; une transition à T + 1 ms reste en chantier.

### F — Transaction ancienne et snapshot de mutation

- Initial : Jardin productif, buffer non plafonné.
- Actions : ouvrir une transaction B avant A ; A acquiert le village et récolte. Faire attendre B sur le village jusqu’au commit de A, puis laisser B récolter.
- Attendu : borne de B postérieure ou égale à celle de A ; aucun recul de curseur, aucun double comptage. La somme récoltée correspond à la production réelle jusqu’à la borne de B.
- Invariant : la borne est prise après acquisition, pas au début de transaction.

Dans le chemin de commande, vérifier que `serverTime`, la date de départ du chantier et les projections emploient exactement la même borne. Ajouter une construction de durée nulle : elle doit être terminée dans le snapshot retourné.

### G — Ancienne tâche pending et nouvelle amélioration

- Initial : Scierie L1 achevable à T1 ; ancienne tâche encore pending.
- Actions : une commande détient le village ; un worker détient l’ancienne tâche et attend ce village. La commande réconcilie T1 puis démarre L2, échéance future T2, et insère sa tâche.
- Attendu : la commande commit sans violation d’unicité ni attente sur l’ancienne tâche ; un seul débit ; L2 reste en chantier. L’ancien worker peut ensuite terminer sa notification ; la nouvelle tâche subsiste.
- Invariant : aucune dépendance village → ancienne tâche, y compris lors de l’insertion.

### H — Atomicité de plusieurs transitions

- Initial : fixture A.
- Actions : injecter une erreur après réconciliation mais avant succès du handler.
- Attendu après rollback au savepoint : stocks, restes, curseurs, statuts et occupations identiques à l’état initial ; seul le retry de la tâche est enregistré. Le retry réussi donne ensuite les valeurs de A.
- Invariant : la réconciliation complète est atomique.

## 6. Critères d’acceptation

- [ ] Tests A–H verts sur PostgreSQL, avec entrelacements forcés pour B, F et G.
- [ ] Suites économiques et de construction différée existantes vertes, notamment projection sans écriture, plafonds, double récolte, doubles commandes et rollback.
- [ ] `typecheck` et `lint` verts.
- [ ] `processNextScheduledTask()` conserve `FOR UPDATE SKIP LOCKED`, ses savepoints et son acquittement limité à sa tâche.
- [ ] Aucun ordre métier fondé sur `availableAt`, l’ordre d’acquisition ou l’identifiant de tâche.
- [ ] Aucun accès verrouillant à une tâche existante depuis la réconciliation ou les commandes.
- [ ] Migration d’index sans suppression de données, testée sur base de test ; aucune modification des migrations historiques.
- [ ] Aucun changement voulu des coûts, durées, taux, capacités, règles de placement ou contrats publics.
- [ ] Aucune nouvelle infrastructure et aucun passage global à `SERIALIZABLE`.

## 7. Hors scope

Ne doivent pas entrer dans le diff :

- Généralisation Jardin ou catalogue spatial.
- Viewport, chunks, génération mondiale ou gisements.
- Auth, combat, assets, nouvelle UI ou modifications Babylon.
- Refonte générale de `service.ts`.
- Event sourcing, CQRS, bus distribué, moteur de workflow.
- Repository généralisé ou abstraction universelle de scheduler.
- Nouveau système d’historique ou de versionnement économique.
- Nettoyage de tâches historiques.
- Recalcul ou compensation des ressources éventuellement déjà perdues : le modèle courant ne contient pas nécessairement l’historique permettant de les reconstruire.
- Reformattage massif et corrections annexes du worktree sauvegardé.

Aucune décision produit n’est nécessaire pour implémenter cette correction. **Question pour Tristan uniquement si des pertes historiques sont avérées : faut-il une compensation ?** Ce serait une tranche séparée, pas un blocage de celle-ci.

## 8. Plan d’implémentation atomique

| Étape | Fichiers probables | Modification conceptuelle | Validation |
|---|---|---|---|
| 1 | `economy.integration.test.ts`, `vertical.integration.test.ts` | Ajouter les fixtures temporelles et les régressions A, C et G, avec valeurs attendues explicites. | Constater les échecs métier sur la base actuelle, sans changer le code applicatif. |
| 2 | Nouvelle migration `009_…` (ou prochain numéro libre), `database/migrate.ts` | Restreindre l’unicité pending pour permettre plusieurs notifications `building.complete` du même bâtiment. Conserver l’unicité des autres types. | Ancienne et nouvelle tâche de construction coexistantes ; aucune ligne perdue ; autres types toujours protégés. |
| 3 | Nouveau `reconcile-economy.ts`, `complete-construction.ts` | Extraire les applications internes, ajouter verrou village, borne après verrou et parcours fusionné ordonné. Faire déléguer les handlers. | A, B, C, E et H verts. |
| 4 | `service.ts` | Brancher toutes les commandes et `state()` sur le contexte commun ; réutiliser la borne dans le snapshot final ; réconciliation finale à borne identique pour durée nulle. | D, F et G verts ; test existant de lecture sans écriture conservé. |
| 5 | `service.ts`, commentaires de préconditions dans `economy.ts` | Limiter les `FOR UPDATE` aux tables métier visées ; stabiliser les parcours de ressources et réservations ; supprimer les anciens chemins de réconciliation. | Tests de doubles commandes/récoltes et B/G verts ; recherche exhaustive des appels pour vérifier l’absence de contournement. |
| 6 | `docs/architecture/economy.md`, tests concernés | Documenter l’invariant temporel, l’ordre partiel des verrous et l’interdiction de toucher aux anciennes tâches sous verrou village. | Suites ciblées et économiques complètes, `typecheck`, `lint`, contrôle du diff contre le hors-scope. |

Le compte rendu final doit préciser les fichiers modifiés, les scénarios réellement reproduits avant correction, les commandes de validation et leurs résultats, ainsi que toute limite restante. Garder un diff minimal et relisible.

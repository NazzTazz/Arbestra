# Synchronisation du village

11 octobre 2026 — implémentée et intégrée ; validation produit distincte. Base relue : `adda2ed0367c6d99bcc98cb60b118c49e26a68a6`. Les preuves et limites sont dans la [contre-recette](../CONTRE-RECETTE-SYNCHRONISATION-VILLAGE-2026-10-11.md).

## Chemins réutilisés

Les commandes HTTP et leurs UUID idempotents restent en place. `App → VillageScene → BabylonVillageScene` conserve sa durée de vie et son cache de bâtiments. `state()` reste l'assembleur de `VillageState` ; la science dispose maintenant d'une lecture sans acquisition de verrou métier ni initialisation. La réconciliation économique normale, les handlers et l'ordre des verrous restent les capacités autoritaires existantes.

`App` conserve une copie locale, initialisée par HTTP, puis raccordée à `GET /api/worlds/:worldSlug/villages/:villageId/events`. L'ancien polling du village entier à 500 ms / 2 s / 10 s disparaît. La lecture initiale est unique même sous le double montage React de développement ; le rafraîchissement HTTP de secours est également à lecture unique en vol. Focus/retour à l'onglet reconnectent le flux actif.

## Périmètre de révision

`syncRevision` désigne une époque d'écriture **du monde**, et non un compteur privé de chaque village. Les snapshots et trames portent aussi l'identité du village. Ce périmètre conservateur couvre le terrain partagé, les autres occupations du monde et les connaissances joueur/monde consommées par le snapshot. Il peut provoquer une nouvelle projection du village quand seule une donnée voisine a changé ; il ne sérialise pas pour autant les stocks privés des voisins.

La migration additive `041_village_sync` crée `village_sync_changes(world_id, transaction_id)`. Des triggers ajoutent un marqueur par monde et transaction de modification des tables effectivement consommées : terrain, occupations, bâtiments, populations, économie, ressources, chantiers, science, infrastructure, installation et paramètres de génération/factory. Les catalogues globaux invalident les mondes ; sessions, reçus et notifications du scheduler ne sont pas des changements de `VillageState`. Les modifications de présentation de l'atlas et les territoires ont leur propre contrat, hors de ce flux.

La révision est le **nombre de marqueurs visibles et validés**. Le marqueur et les écritures partagent COMMIT/ROLLBACK, y compris dans les workers et leurs savepoints. On n'utilise pas le maximum d'une séquence : deux transactions de mondes/villages partagés peuvent valider dans l'ordre inverse de leur démarrage. Aucun compteur mondial verrouillé n'est ajouté après les verrous de gisements. Les contrôles de lecture utilisent `txid_current_if_assigned()` et n'allouent pas eux-mêmes d'identifiant de transaction.

La migration donne une base 0 aux mondes déjà existants ; les changements suivants avancent la révision. Les marqueurs ne contiennent aucun payload d'entité : c'est une détection durable de modification, pas un journal permettant de rejouer les événements historiques. Ils ne sont pas purgés dans cette tranche. Le coût de `COUNT` croît avec leur nombre ; une politique de checkpoint/compaction exigera son propre contrat de reprise avant suppression.

## Snapshot et jonction

`readVillageProjection()` assemble données, `serverTime` et révision dans une transaction PostgreSQL `REPEATABLE READ`, `READ ONLY`. Il réutilise `state()` avec un contexte temporel explicite, sans réconcilier ni admettre des tâches. Toutes ses requêtes voient le même état validé.

Les commandes conservent leur transaction et leur borne économique après verrou. `state()` compare les marqueurs des autres transactions avant/après son assemblage ; un hook HTTP `preSerialization`, exécuté après le commit du handler, recontrôle la révision. Un snapshot devenu incertain est remplacé par la projection cohérente en lecture seule. La commande réussie n'est pas rejouée par ce mécanisme.

Toute ouverture SSE, y compris une reprise, commence par **un nouveau snapshot cohérent**. Le paramètre `revision` fournit le contexte du client ; il n'existe pas de replay de payload conservé. `Last-Event-ID` est un identifiant de réception, jamais la preuve d'une application réussie. Une écriture validée entre le snapshot HTTP et l'ouverture SSE apparaît dans ce snapshot de jonction ; une écriture concurrente à ce dernier apparaît au prochain contrôle de révision. Une nouvelle resynchronisation utilise exactement la même jonction.

`serverTime` peut avancer sans nouvelle écriture persistante. À révision égale, une projection complète plus récente est admise ; une projection plus ancienne ou identique est ignorée. Les compteurs et animations continuent à évoluer localement entre les projections, sans décider de crédits économiques.

## Trames et application atomique

Le serveur compare deux projections cohérentes d'un même monde/village. Une trame `fromRevision → toRevision` peut regrouper plusieurs transactions. Le contrat partagé `villageFrame()` calcule des modifications de champs et des ajouts/modifications/suppressions de collections à clés stables ; l'ordre est fourni si nécessaire.

`applyVillageFrame()` fonctionne sans React, Babylon ou SQL :

- contexte différent : ignorer ;
- `toRevision ≤ révision locale` : doublon entièrement couvert, ignorer ;
- `fromRevision = révision locale` : construire le candidat immuable, le valider entièrement, puis publier ensemble état et nouvelle révision ;
- trou, chevauchement inexploitable, chemin invalide ou candidat non conforme : conserver l'ancien état et demander une reprise.

Les chemins dangereux sont refusés. Une application échouée ne modifie aucune branche de l'ancien objet. `latestVillageSnapshot()` est partagé par App et SpawnPlacement ; la révision prime sur l'heure d'une réponse retardée. `reconcileVillageSnapshot()` conserve les références des entités inchangées, même lors d'un reset complet. HTTP et SSE peuvent rapporter la même mutation sans double application.

`VillageSynchronization` invalide immédiatement la génération de l'ancien abonnement lors d'une reprise ou fermeture. Les callbacks déjà en attente sont ignorés. Les requêtes village HTTP capturent cette génération à l'envoi ; App ignore une réponse d'une ancienne génération ou d'un autre contexte. Une erreur de protocole reconnecte après 100 ms ; une erreur de transport après 2 s. Un flux silencieux pendant 30 s est remplacé. Ces délais sont des temporisations client, pas des délais SQL garantis.

## Notification perdue et échéances

La disponibilité du flux ne dépend pas d'une publication éphémère après commit. Toutes les **2 secondes après le contrôle précédent**, chaque abonnement revalide session/propriété, vérifie les échéances et lit la révision autoritaire. Si un worker a validé puis s'est arrêté sans publier, son marqueur reste visible : une nouvelle projection et sa trame sont envoyées même sans autre modification. Une révision inchangée produit une petite trame `revision`, qui détecte aussi un écart silencieux de la copie cliente. Les lectures en vol d'un même compte/monde/village sont partagées ; aucun snapshot dynamique ancien n'est mis en cache.

Le délai nominal de détection est le prochain contrôle, soit 2 s, **plus le temps des lectures, des attentes et de la projection**. Ce n'est pas un plafond en présence de contention. Un rollback n'est jamais visible dans le comptage ni dans une projection validée.

L'ancien polling pouvait également réveiller la réconciliation paresseuse. `reconcileSyncDeadline()` lit les échéances déjà exposées et les cursors d'énergie, avec `advanceEnergy()` / `energyState()`. Une échéance ou transition d'activité appelle `getVillageState()` avec les verrous et la borne autoritaires existants ; un contrôle sans transition ne reconstruit pas le village. Le scheduler continue son fonctionnement normal. Le contrôle de révision ne remplace ni un tick économique ni les règles de mission.

## Rendu, droits et limites

Les branches inchangées de React sont conservées. Babylon conserve son instance et ses signatures/cache de meshes : une construction terminée remplace le bâtiment concerné ; les autres bâtiments, la caméra et le panneau ouvert restent en place. Une sélection existante reste liée à l'ID de l'entité ; si celle-ci disparaît, les données de jeu ne sont pas recréées artificiellement. La recette ciblée prouve la conservation du panneau Population et des meshes inchangés, pas tous les panneaux du jeu.

Le flux utilise les cookies existants et `ownedVillage()`, recontrôlés périodiquement. Il ne donne aucun privilège de preview. La fermeture de session produit `expired` ; arrêt serveur et déconnexion ferment les timers. Les en-têtes SSE interdisent le cache et demandent la désactivation du buffering ; un buffer d'écriture excessif provoque une reconnexion. Le reverse proxy de production reste à recetter.

Les commandes HTTP renvoient encore leur snapshot complet, et les projections serveur peuvent rester coûteuses sur RC1. Cette tranche réduit le transfert répétitif et les lectures HTTP concurrentes du client ; elle ne revendique pas une suppression de toute latence de construction. Le streaming terrain autour de la caméra conserve son propre mécanisme. L'application de la migration au développement/production et la recette LAN/staging/production restent distinctes des preuves locales.

Références du mécanisme : [isolation PostgreSQL](https://www.postgresql.org/docs/current/transaction-iso.html), [format et reprise SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).

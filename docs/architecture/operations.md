# NOC : observation et exploitation

Évolution **implémentée localement, à revue humaine, non déployée** : [observation d’un village et assistance en direct](../SPEC-NOC-OBSERVATION-VILLAGE.md). Baux d’observation, scène sur l’origine NOC, suivi de caméra et fil d’actions borné. Le [dossier d’implémentation](../IMPLEMENTATION-NOC-OBSERVATION-VILLAGE-2026-10-17.md) distingue les preuves exécutées et les validations restantes.

15 octobre 2026. Architecture de la [V1 NOC](../SPEC-NOC-V1.md) et du [diagnostic HTTP V1.1](../SPEC-NOC-V1-1-DIAGNOSTIC-HTTP.md). Les preuves de recette et l’état de déploiement figurent dans le [handoff courant](../../SESSION-HANDOFF.md). Ce document décrit le code et les opérations nécessaires ; il ne certifie pas la configuration DNS, TLS ou du proxy public.

## Composants et périmètre

`apps/admin-web` est un frontend React séparé du jeu. Il consulte le même monolithe Fastify via `/api/admin`. `packages/contracts/src/admin.ts` porte les contrats ; `modules/admin` assemble les lectures de support ; `modules/operations` collecte les observations du processus API, de ses workers et de ses flux SSE.

L'instrumentation est référencée par `app.server`, le serveur HTTP partagé entre les instances Fastify encapsulées. Les routes NOC enregistrées dans leur plugin retrouvent ainsi les mêmes observations et événements que les routes racines.

Le NOC permet de parcourir l’installation, les mondes, comptes, villages et activités. Les stocks, cohortes et échéances affichés sont **persistés**, sans matérialiser de production, terminer une activité ou déclencher une réconciliation. Les POST/DELETE NOC contrôlent la session administrateur et les observations éphémères. Les outils de mutation métier restent hors V1.

La console utilise les tables et le rôle PostgreSQL existants. Elle ne crée aucun rôle SQL, aucune table ni migration. Le worker externe de génération n’est pas instrumenté par cette V1 : son état runtime est inconnu, même lorsque le processus API répond. La console n’agrège pas plusieurs instances et n’observe pas une machine distante.

## Lectures et charge

Le correctif de scheduler du 21 octobre, dont le statut de publication figure dans le [rapport d'incident alpha](../INCIDENT-ALPHA-WORKER-2026-10-21.md), calcule le délai de reprise après l'échec et augmente les délais successifs jusqu'à cinq minutes. Une tâche en erreur conserve intention, échéance et compteur ; seules ses propres erreurs différées ralentissent. Ce délai ne déclare pas une destination inaccessible et ne remplace pas la correction de sa navigation.

`AdminReadService` utilise une transaction `REPEATABLE READ` puis `SET TRANSACTION READ ONLY`. Les lectures ne prennent pas les verrous économiques et n’appellent pas les commandes du village. Les bornes SQL sont `statement_timeout=2s`, `lock_timeout=250ms` et `transaction_timeout=4s` ; elles ne constituent pas une garantie de durée HTTP incluant l’attente du pool, l’authentification et le réseau.

Le cache est propre à l’instance : durée 15 s, 128 clés au maximum, une collecte partagée par clé, quatre collectes distinctes simultanées. Au-delà, la réponse est `503 ADMIN_BUSY`. Une collecte échouée ne devient pas un résultat vide réussi. Les listes de mondes, comptes et villages sont limitées à 100 éléments ; les listes d’activités à 50. Les réponses signalent la troncature ; il n’existe pas encore de pagination générale.

Le récapitulatif des expéditions compte exactement les demandes en attente et les activités `exploration`/`survey` en cours dans le périmètre demandé. Le compteur actif inclut les activités plus anciennes que l'échantillon ou antérieures au mécanisme de reçus asynchrones. Les compteurs admis, terminées, refus et échecs portent sur les 1 000 derniers reçus au maximum, avec taille et troncature explicites. Un reçu de préparation, une activité scientifique admise et son achèvement restent des objets distincts. Une notification scheduler en retard n’atteste pas, à elle seule, une transition métier manquée.

Les listes d'activités mélangent les reçus d'expédition récents, les activités scientifiques en cours et les notifications en attente. Elles ne constituent pas un historique exhaustif des activités achevées ; les endpoints de détail peuvent retrouver un objet terminé par son identifiant et son périmètre.

La sonde PostgreSQL utilise une connexion séparée au maximum, identifiée `arbestra-noc-probe`. Connexion et instruction SQL sont limitées à 1 500 ms, attente de requête à 2 000 ms ; résultat conservé 15 s, collecte en cours partagée. `select 1` mesure la disponibilité et sa latence ; les compteurs de `pg_stat_activity` restent limités à ce que voit le rôle. Aucun texte SQL ni secret de connexion n’est exposé. Une absence de visibilité sur les statistiques vaut inconnu.

L’authentification administrateur dépend toujours de PostgreSQL. Une panne complète peut donc empêcher l’accès au diagnostic avant l’exécution de la sonde ; le frontend conserve alors les anciennes données avec leur date et l’erreur de lecture. Ce NOC ne remplace pas une surveillance externe. `/api/health` reste une réponse de vie du processus, pas un contrôle complet de la base ou des workers.

## Mesures runtime et conservation

Les observations portent l’identifiant de l’instance, sa date de démarrage et leur date de collecte. Elles disparaissent au redémarrage. Plusieurs API donnent des observations différentes même si elles partagent la même base.

| Observation | Source et limites |
|---|---|
| HTTP | Fenêtre de 5 min ; total des réponses terminées et interruptions, avec compteurs distincts. Percentiles sur les 4 096 dernières réponses terminées au maximum ; taille et troncature affichées. Une interruption n’est pas une réponse 499 et ne participe pas aux percentiles. Les SSE établis sont exclus de ces agrégats. |
| Série | 120 échantillons au maximum, collecte prévue toutes les 5 s ; début/fin de période réels, nombre de réponses et d’interruptions, taille d’échantillon et troncature. Aucune valeur n’est reconstruite pendant un arrêt ou un blocage. |
| CPU | Consommation du processus entre deux observations, exprimée en pourcentage d’un cœur ; elle peut dépasser 100 %. Inconnue avant le premier intervalle. |
| Mémoire | RSS du processus et heap JavaScript courant ; ce ne sont ni la RAM totale de l’hôte ni celle du générateur externe. |
| Event loop | Percentile de délai mesuré par Node depuis le démarrage de l’observateur, distinct de la fenêtre HTTP de 5 min. |
| Workers | Cycle scheduler, préparation des expéditions, pool de navigation et connexion LISTEN réellement observés. Une boucle muette ou une erreur récente peut produire un état dégradé. |
| Présence | Flux SSE ouverts et comptes distincts sur cette instance. Plusieurs onglets peuvent appartenir au même compte ; ce compteur ne mesure pas les joueurs actifs. |
| Événements | Tampon de 100 événements d’exploitation au maximum. Textes et codes contrôlés, sans erreurs internes brutes. `ADMIN_ACCESS` est exclu du tampon ; connexions, déconnexions et refus y restent. Ce tampon n’est pas un journal d’audit durable. |

Les valeurs absentes sont `null`/inconnues. Le statut global conserve cette couverture inconnue, notamment pour le générateur externe, au lieu d’afficher un vert global sans preuve. Le frontend actualise normalement toutes les 15 s, suspend ce rafraîchissement dans un onglet masqué et distingue les anciennes données en cas d’échec ou de retard.

## Diagnostic HTTP local

Chaque requête reçoit un UUID serveur, rendu dans `X-Request-Id`, y compris dans l’écriture brute du flux SSE. Un identifiant envoyé par le client n’est pas repris. La référence complète est le couple `instanceId` / `requestId` ; elle ne confère aucun accès. Les motifs actifs du statut sont calculés avec le snapshot : 5xx dans les cinq minutes, sonde DB dégradée/indisponible, workers dégradés/indisponibles et couverture inconnue. La lenteur seule n’ajoute aucune règle de dégradation.

Le tampon HTTP conserve les réponses 5xx, les réponses dépassant `NOC_HTTP_SLOW_MS` et les connexions interrompues avant la fin observée. Une seule fiche contient plusieurs motifs si nécessaire. La durée monotone couvre l’entrée dans Fastify jusqu’à `finish` ou `close` ; elle ne prouve pas la réception par le navigateur. Une interruption a un statut `null`, sans attribution de sa cause au client. Les flux SSE établis ont leurs compteurs propres ; les refus avant ouverture restent des réponses HTTP ordinaires.

Les fiches copient uniquement méthode contrôlée, route modèle enregistrée, statut, dates/durée et codes d’un catalogue fermé. Ni URL concrète, query, body, en-têtes, email, IP, SQL, message d’exception, cause ou pile ne sont conservés. Le contexte compte/monde/village des requêtes n’est pas déduit de leur URL. `ADMIN_DATA_UNAVAILABLE` indique une lecture indisponible et ne prouve aucune cause SQL. Un événement HTTP est relié explicitement à sa fiche ; une panne de sonde à la même heure demeure indépendante.

Bornes : 512 fiches, dix minutes après terminaison, 2 Kio sérialisés par fiche au plus ; les événements, séries et latences conservent leurs bornes distinctes. Le coût mémoire réel inclut les objets JavaScript. Évictions, expirations, échecs de collecte et pertes de journaux sont visibles. La collecte ne fait aucun SQL et n’attend aucune écriture de logs dans une commande métier. Aucun inventaire détaillé des requêtes en cours n’est fourni.

La liste expose 50 éléments par défaut, 100 au maximum. Ses filtres portent sur l’instant de terminaison, dans `[from,to)`, dix minutes au maximum. Une première page fixe une séquence supérieure ; les suivantes conservent l’instance, les dates, filtres et séquences. L’éviction peut créer des trous sans réordonner les éléments retenus. L’interface fige les pages anciennes et propose le retour aux observations récentes. Un changement d’instance produit `409 INSTANCE_MISMATCH` et exige une action explicite ; une référence absente donne `404 HTTP_OBSERVATION_NOT_RETAINED`, sans prétendre distinguer expiration et UUID jamais enregistré.

### Mesure locale du coût V1.1

Mesures terminées le 15 octobre 2026, Windows, Node 24.19.0. Le script `apps/api/src/modules/operations/http-diagnostics.benchmark.ts` utilise un vrai serveur HTTP loopback, sans DB ni route métier. Client et serveur partagent un processus : CPU, heap et RSS incluent les deux. La sortie de logs est un puits asynchrone local, sans disque. La comparaison utilise une copie locale de la télémétrie V1 antérieure aux modifications ; sans `--baseline`, le script compare à un serveur non instrumenté, ce qui constitue une autre référence.

Une première série à huit connexions, perturbée notamment par les compilations, a montré une dispersion excessive. La lecture du chemin fréquent a identifié deux coûts évitables : reparcours des 512 dates à chaque anomalie et construction de fiches rejetées pour les réponses rapides. La version finale garde une échéance d’expiration exacte et des timestamps numériques, et ne construit la fiche que si elle est retenue. Un test vérifie l’expiration à la milliseconde avec des dates désordonnées ; aucun arrondi ni relâchement de rétention n’est utilisé.

Les mesures suivantes portent sur cette version finale. Simple et mélange de 50 % de 503 : cinq répétitions alternant l’ordre V1/V1.1, une connexion, 3 000 requêtes de chauffe puis 3 000 mesurées. Lente : trois répétitions alternées, huit connexions, 16 de chauffe puis 96 réponses retardées de 260 ms. Valeurs du tableau : médianes entre répétitions, **V1 → V1.1** ; le p95 est calculé dans chaque répétition, puis sa médiane est reportée.

| Charge | Débit req/s | p50 ms | p95 ms | CPU ms par lot | Heap après GC Mio | RSS Mio |
|---|---:|---:|---:|---:|---:|---:|
| Simple | 1 401 → 1 038 | 0,589 → 0,791 | 1,118 → 1,572 | 2 343 → 3 156 | 17,16 → 17,23 | 150,11 → 150,77 |
| 50 % de 503 | 1 068 → 641 | 0,756 → 1,149 | 1,415 → 2,631 | 2 968 → 4 594 | 17,19 → 17,67 | 151,03 → 152,29 |
| Lente contrôlée | 29,09 → 28,82 | 274,169 → 274,537 | 283,415 → 289,832 | 47 → 16 | 15,71 → 15,84 | 90,79 → 90,61 |

**Le budget de surcharge n’est pas validé globalement.** La différence des médianes p95 vaut +0,454 ms pour la route simple et +1,216 ms pour le mélange, au-dessus du budget de 1 ms pour ce dernier. La lente vaut +6,417 ms, sous sa borne de 5 % (14,17 ms). La dispersion demeure forte, même sans compilations : p95 simple V1 de 0,871 à 5,990 ms, V1.1 de 1,122 à 4,390 ms ; mélange V1 de 0,739 à 3,199 ms, V1.1 de 1,472 à 5,713 ms. Ces résultats ne permettent ni d’attribuer tout l’écart à la collecte ni de certifier le budget en charge. Une mesure sur hôte isolé, avec client séparé et transport de logs représentatif, reste à faire avant de lever cette réserve ; aucune preuve de charge en production ou d’endurance n’est annoncée.

Les cinq lots de mélange finaux atteignent 512 fiches retenues et zéro échec de collecte. Après deux lots supplémentaires de 3 000 requêtes, les paires de heap après GC sont respectivement 17,36/17,24 ; 17,46/17,46 ; 17,69/17,78 ; 17,83/18,00 ; 17,97/17,91 Mio. Il n’y a pas de croissance proportionnelle aux observations dans ces lots ; cela ne constitue pas un test d’endurance. La RSS augmente au fil du processus partagé et des variantes, et ne représente pas à elle seule le coût du tampon. Les bornes du tampon et de la file de logs sont aussi vérifiées par tests déterministes.

Commande de la série finale simple/mélange (baseline et résultats bruts conservés localement dans `test-results/`, ignorés par Git) :

```powershell
node --expose-gc --import tsx apps/api/src/modules/operations/http-diagnostics.benchmark.ts --baseline test-results/noc-v1-telemetry-baseline.ts --concurrency 1 --repeats 5 --warmup 3000 --count 3000 --plateau-batches 2 --workloads simple,mixed
```

La série lente utilise `--concurrency 8 --repeats 3 --plateau-batches 0 --workloads slow`. Résultats locaux : `noc-v11-benchmark-final.json` et `noc-v11-benchmark-slow-final.json` ; la première série bruitée reste `noc-v11-benchmark.json`.

## Autorisation et session

`ADMIN_ACCOUNT_IDS` contient uniquement les UUID explicites de comptes existants maîtrisés. La liste vide refuse tout accès. Une adresse email sert à la connexion par mot de passe ; elle ne confère aucun privilège. Les UUID et l’origine sont validés au démarrage ; une configuration invalide fait échouer le démarrage au lieu d’ouvrir un accès par défaut.

Chaque endpoint NOC revalide la session en base et l’UUID dans la configuration courante. Pour retirer un accès, supprimer l’UUID de la configuration puis redémarrer les instances concernées ; une session encore stockée ne contourne pas cette liste. Il n’existe pas de rechargement automatique des variables d’environnement.

Le cookie `arbestra_admin_session` est host-only, `Path=/api/admin`, `HttpOnly`, `SameSite=Strict`, `Secure` en production et expire après une heure. Il n’hérite jamais de `COOKIE_DOMAIN`. Le token stocké est hashé avec un espace de noms administrateur : copier un token joueur dans ce cookie, ou un token administrateur dans le cookie joueur, ne donne aucun accès. La reconnexion remplace la session administrateur précédente de ce navigateur ; la déconnexion la supprime en base.

`ADMIN_ORIGIN` fixe l’origine exacte autorisée. Hôte et protocole sont vérifiés ; HTTPS est obligatoire en production. `POST` et `DELETE` exigent un en-tête `Origin` exactement correspondant ; une origine étrangère ou un contexte cross-site est refusé. Le frontend appelle la même origine, sans besoin de CORS.

Les tentatives sont limitées sur une fenêtre de 15 min, par IP et identité normalisée hashée : 20/IP et 5/identité pour le NOC, 60/IP et 15/identité pour la connexion joueur. L’inscription conserve sa limite de 5/IP. Chaque limiteur retient au plus 10 000 clés et refuse les nouvelles tentatives quand cette borne est atteinte. Ces limites sont locales au processus et repartent à zéro au redémarrage ; elles ne sont pas agrégées entre instances.

`TRUSTED_PROXY_CIDRS` est vide par défaut. Elle accepte uniquement les IP ou CIDR explicitement maîtrisés, sans confiance globale. Le proxy doit remplacer les en-têtes de transfert reçus du client par ses propres valeurs. Déclarer une plage plus large que les proxies réellement contrôlés ferait confiance à des adresses clientes et à un protocole annoncés par des tiers.

## Endpoints NOC

Tous les chemins suivants commencent par `/api/admin`. Les lectures exigent la permission V1 `noc:read`, commune à tous les administrateurs de la liste. Aucun filtre monde reçu du navigateur ne remplace la vérification du périmètre SQL.

| Méthode et chemin | Paramètres / résultat |
|---|---|
| `POST /session` | Email et mot de passe du compte existant ; crée la session si son UUID est autorisé. |
| `GET /session` | UUID du compte et permission `noc:read`. |
| `DELETE /session` | Supprime la session courante ; origine obligatoire. |
| `GET /overview` | Compteurs globaux, notifications, expéditions et activités récentes. |
| `GET /infrastructure` | Processus, sonde DB, HTTP, workers, SSE, série et événements. |
| `GET /http-requests` | Filtres `instanceId`, `from`, `to`, `reason`, `method`, `route`, `scope`, `requestId`, `minDurationMs`, `limit`, `snapshotSequence`, `beforeSequence` ; page et couverture mémoire. |
| `GET /http-requests/:requestId` | `instanceId` obligatoire ; fiche retenue et événements explicitement corrélés encore conservés. |
| `GET /worlds` | Liste bornée des mondes. |
| `GET /worlds/:id` | Monde, villages, notifications et activités. |
| `GET /accounts` | Recherche facultative `query`, filtre facultatif `worldId`. |
| `GET /accounts/:id` | Compte, adhésions, villages et activités. |
| `GET /villages/:id` | `worldId` obligatoire ; état persisté et échéances. |
| `GET /activities` | Filtres facultatifs `worldId`, `villageId`, `accountId`, `kind`. `villageId` exige `worldId`. |
| `GET /activities/:id` | `worldId` et `kind` obligatoires, `villageId` facultatif pour lever une ambiguïté. |
| `POST /observations/` | `worldId`, `villageId` ; ouvre un bail propre à l’administrateur. |
| `GET /observations/:id` | Métadonnées, sources et fil d’actions ; propriétaire courant vérifié. |
| `POST /observations/:id/heartbeat` | Maintient le bail visible. |
| `POST /observations/:id/follow` | Audite le choix `sourceId` ou le retour en libre. |
| `DELETE /observations/:id` | Ferme le bail et son flux. |
| `GET /observations/:id/snapshot` | Projection persistée cohérente, sans réconciliation. |
| `GET /observations/:id/events` | SSE snapshot/trames, statuts, caméras ; une génération par bail. |
| `GET /observations/:id/terrain` | `kind=chunks\|updates\|overview\|vegetation\|villages`, paramètres de viewport bornés. |

Les types d’activité sont `expedition`, `science` et `task`. Les recherches et détails de comptes peuvent exposer leur adresse email aux administrateurs autorisés pour le support ; les événements de supervision ne la contiennent pas.

`/api/admin/world-generator` est une API opérateur historique distincte, avec ses propres autorisations et mutations. Elle n’appartient pas au NOC et doit être exclue du routage du domaine administrateur.

### Observation d’un village

Depuis la fiche village, **Observer le village** ouvre un nouvel onglet lanceur `#/observe?worldId=…&villageId=…`, puis le client monde `/village?world=…&observe=…#observationToken=…`. `POST /api/admin/observations/launch` délivre un jeton aléatoire à usage unique, valable 30 s, lié au bail et à la session admin. Le client retire immédiatement le fragment et l’échange via `POST /api/observation/exchange` contre un cookie observateur HttpOnly, hôte seul, SameSite Strict, Secure en production et `Path=/api/observation/<bail>`. La session admin ne quitte pas le NOC. Copier l’URL nettoyée ne transmet aucun accès ; avant consommation, le lien est sensible. Le rechargement utilise le cookie dédié.

`WORLD_ORIGIN` doit contenir l’origine HTTPS du client monde en production, sous forme de modèle par monde (`https://{world}.arbestra.world`, `https://{world}.arbestra.fr` pour staging) : le lien ouvre le sous-domaine du monde observé, et l’échange comme les lectures refusent le sous-domaine d’un autre monde ; la création d’un lien est refusée sans elle. Le bootstrap natif la renseigne pour les installations nouvelles ; compléter les environnements existants avant promotion. En développement loopback seulement, le port 5174 sert de valeur de repli. Les lecteurs utilisent `/api/observation/:id` et ses sous-routes, avec les mêmes handlers de lecture que `/api/admin/observations`, revalidation de la session admin et contrôle du bail exact à chaque requête. L’échange du jeton n’attend aucune lecture de projection ; les routes de données revalident la propriété avant livraison. Aucune migration requise.

La scène réside dans `world-web`, avec les mêmes `VillageScene`, HUD, écran de chargement, renderer et assets que le joueur. `ObservationEntry` fournit seulement le contrôle d’observation et le transport `readOnly`. Le contrôleur joueur et ses prélectures ne sont pas montés, aucune commande ni source caméra joueur n’est raccordée. Le NOC ne contient plus de renderer ni de copie d’assets. Le joueur conserve sa session et une bannière d’assistance ; ses POST `/api/worlds/:worldSlug/villages/:villageId/observation/{status,sources,camera}` vérifient origine, session et propriété.

`observation-hub.ts` borne les baux à 4 par administrateur / 16 par instance, durée 30 min, inactivité 45 s. Les caches, sources et journaux sont séparés par monde/village/propriétaire ; changement de propriétaire ou dernière fermeture efface le contexte concerné. Les sources sont aussi liées à la session et à l’onglet : au plus 4, confirmation toutes les 5 s, poses jusqu’à 5 Hz, suspension à 15 s et suppression à 30 s. La vue habitant n’est pas suivie. Le journal couvre les familles de commandes testées dans `observation-actions.test.ts`, distingue admission métier et transport HTTP, et reprend les reçus jardin/bois/pierre et expéditions. Aucun historique antérieur à la collecte, ni preuve de rendu du navigateur joueur.

`observation-reads.ts` partage projection, révision et reçus par contexte à cadence 2 s ; au plus 64 reçus par lecture. Une projection joueur déjà transportée est réutilisable seulement pour le même propriétaire/monde/village et la révision exacte, âge au plus 2 s ; une projection en vol n’est jamais attendue. `readVillageObservation()` assemble le village en lecture seule sans réseau de trajets prévisionnels : infrastructures persistées et chemins des missions engagées conservés, aucune lane de navigation requise. Un village hors ligne peut être inspecté avec le cache worker RC1 froid. Les routes prévisionnelles absentes ne sont pas un diagnostic d’inaccessibilité. Le dernier état cohérent est daté et conservé en cas de dégradation ; sans premier état, l’interface indique la lecture initiale retardée. Le statut publié après la lecture retire l’avertissement à la reprise, même sans nouvelle révision.

Le pool habituel passe de 10 à 8 connexions maximales ; le pool d’observation réserve les 2 restantes, toutes lectures confondues, en lecture seule par défaut. Pas de nouveau rôle ni migration. Acquisition 500 ms, instruction 2 s, verrou 250 ms, transaction 4 s ; la sonde de santé distincte conserve son budget existant. La géographie immuable RC1 est préparée après contrôle de propriété, avant la transaction bornée ; son identité et les modifications locales sont relues dans le snapshot. La lecture autonome conserve les cellules pour le renderer mais ne calcule pas leur aptitude à construire (`canBuild=false`), les commandes étant interdites. SSE : 1 Mio par connexion, 8 Mio cumulés, remplacement par génération ; réauthentification toutes les 5 s, livraison coupée au plus tard à 10 s sans autorisation confirmée. Le SSE NOC n’est pas compté comme présence joueur ni comme longue requête HTTP ordinaire. Terrain : 2 lectures en vol par bail, 4 globales, 5 départs/s/bail ; 429 et Retry-After. Codes de saturation contrôlés dans le diagnostic HTTP.

Les baux, poses, actions (500 / 15 min, 8 Mio globaux) et buffers sont locaux à une instance et disparaissent au redémarrage. Le multi-instance sans affinité n’est pas pris en charge. Ouverture, fermeture, source suivie et refus sont audités avec identifiants sûrs ; le sink existant expurge cookies, corps et erreurs brutes. La rétention durable dépend toujours de l’exploitation. Publication du 17 octobre : staging et alpha en `74d33e2`, `WORLD_ORIGIN` ajouté aux deux configurations existantes, contrôles publics GitHub verts après un épisode réseau résolu. Parcours authentifié staging vérifié, projection et terrain alpha contrôlés en lecture seule sans session de diagnostic. Le [handoff](../../SESSION-HANDOFF.md) porte les sauvegardes, les preuves et les limites.

## Statistiques de développement village et terrain

Dans le client monde lancé en développement, **DEV → Statistiques en overlay** affiche une ventilation blanche, textuelle, en millisecondes. Le choix est conservé dans le navigateur (`arbestra.dev.statistics`) : activer puis recharger pour observer l'entrée dans le village. Le bouton **Masquer** désactive aussi la collecte. Aucune lecture supplémentaire n'est déclenchée par l'overlay ; son rafraîchissement à 500 ms consulte seulement la mémoire locale.

Les lectures GET village, starter/préparation, terrain/mises à jour et vues régionales portent alors `x-arbestra-dev-timing: 1`. L'API l'accepte aussi en production depuis le 23 octobre 2026 (diagnostic de la pose lente sur staging/alpha ; durées seulement, sur demande explicite par requête), pour ces routes déclarées et les GET/POST sous `/api/worlds/:worldSlug/villages/:villageId/`, hors flux SSE ; elle renvoie `Server-Timing` et interdit le cache de la réponse instrumentée. Cela permet aussi de mesurer un geste ou un devis avec cet en-tête, sans collecte forcée. Les autorisations existantes restent nécessaires. La validation/application des trames SSE est mesurée séparément côté client. Ce dispositif n'ajoute ni endpoint administratif, ni privilège, ni migration. En production, l'option locale `localStorage['arbestra:timing']='1'` fait porter l'en-tête aux requêtes V2 du village (bootstrap, lecture, présentation, commandes) ; la ventilation se lit dans l'onglet Réseau du navigateur (Timing → Server Timing).

Le catalogue fermé dans `packages/contracts/src/dev-timing.ts` couvre authentification, acquisition des connexions, appels SQL, acquisitions des verrous village/navigation, réconciliation et admission économiques, assemblage du snapshot et ses lectures, terrain RC1 (source, JSON, checksum, champ, géométrie), connaissance géographique, chunks, réseau de trajets, contrôle de cohérence et sérialisation. Les en-têtes ne contiennent que noms de phases contrôlés, durées et nombres d'appels ; aucune requête SQL, paramètre, erreur brute ou identité métier. La référence HTTP existante permet de rapprocher une mesure du diagnostic NOC.

Depuis le raccord des projections au pool de navigation, `navigation_queue` couvre l'attente d'une lane et son éventuel démarrage ; `navigation_input` couvre l'encodage initial de la source et la copie synchrone vers le worker. `navigation` couvre l'aller-retour du job, préparation géométrique et recherche incluses : c'est une durée murale, pas une mesure exclusive de CPU. Le transfert retour et son traitement sont inclus dans cet aller-retour. L'assemblage SQL du snapshot termine sa transaction avant cette phase. Le NOC observe le même pool partagé avec les expéditions et indique le nombre de projections en attente ; désactiver le coordinateur d'expéditions ne désactive pas la navigation requise par les lectures.

Chaque phase présente un **cumul** inclusif, un temps **propre** excluant l'union temporelle de ses sous-étapes et un nombre d'appels. Ce sont des durées murales : des appels parallèles peuvent se recouvrir et les lignes ne s'additionnent pas. Le SQL comprend la file du driver, le réseau et les attentes PostgreSQL ; une acquisition de verrou comprend son trajet SQL complet, sans prétendre isoler la seule attente du verrou. Le total serveur s'arrête au hook d'envoi après sérialisation, avant transfert du corps au navigateur.

Le client sépare attente des en-têtes (serveur inclus), lecture/décodage du corps et parsing JSON. Il conserve la première et la dernière requête lancée de chacun des huit types, sans corps ni URL métier. Les mesures d'application d'état, SSE, mise à jour de scène et intégration des chunks ont leur propre horodatage ; elles ne sont pas attribuées artificiellement à la requête sélectionnée. Leurs maxima portent sur toute la période depuis activation. Le choix **Scène / FPS uniquement** masque la partie HTTP sans arrêter sa collecte.

Le rendu affiche cadence, mise à jour, soumission CPU et callback complet pour les images **achevées** pendant les deux dernières secondes, avec au plus 120 images conservées. Un callback qui dure plus de deux secondes reste ainsi visible juste après son achèvement. Dix-sept phases séquentielles ventilent la caméra, la demande/intégration terrain, les reprojections, les voiries, les braseros, la visibilité, les effets, les personnages, le rendu, les diagnostics et la construction visuelle progressive. Moyenne par image et maximum récent sont affichés ; une phase sautée vaut zéro dans la moyenne, sans inventer d'échantillon pour une fenêtre vide. Les phases se partagent le callback, sans chevauchement ; leurs maxima peuvent venir d'images différentes. Les phases incluent leurs sous-appels : une reprojection déclenchée par un changement d'origine pendant la gestion caméra est comptée dans Caméra / transitions. Le formatage des nombres et heures réutilise les formateurs locaux.

Le tableau Babylon distingue sélection des meshes/matrices, dessin CPU, particules, textures de rendu, compilations de shaders et nombres de draws/meshes actifs/résidents. Ces compteurs peuvent se chevaucher : ils ne s'additionnent pas aux phases séquentielles. Les échantillons de la scène village/région ne sont pas mélangés avec ceux du monde. Moyennes/maxima portent sur deux secondes et au plus 120 échantillons ; une fenêtre vide vaut « — ».

Le temps GPU utilise les requêtes temporelles natives lorsqu'elles sont disponibles, converties de nanosecondes en millisecondes. Chaque nouveau résultat est enregistré une seule fois ; résultat absent/invalide ou compteur inchangé ne produit aucune mesure. Le retour est asynchrone, distinct des images CPU, et couvre toutes les scènes dessinées par le moteur, y compris une transition. « Non disponible » indique une extension absente ; « — » indique l'absence de résultat récent. Un résultat encore en attente lors de la désactivation est écarté à la réactivation. Les collecteurs GPU, shaders, particules et textures de rendu sont activés par l'overlay et arrêtés à sa désactivation/destruction ; aucune collecte de cet overlay en production.

Les callbacks SSE et React exécutés **entre** deux images ne sont pas inclus dans leur ventilation ; le commit React reste non isolé. Les compteurs CPU sont des durées murales du thread principal, pas une attribution exhaustive du temps processeur. Une API en production ou non recompilée peut fournir la réponse sans ventilation serveur.

Le contexte serveur utilise `AsyncLocalStorage` par requête, avec un catalogue fermé de phases. Le driver conserve ses connexions originales et leurs mécanismes de libération. Les frontières de mesure entourent les opérations existantes sans changer leurs règles. La collecte s'arrête à la réponse ; elle n'est pas une archive et ne mesure pas séparément le CPU des workers en arrière-plan.

Tests associés : `modules/operations/dev-timing.test.ts`, cas ciblés de `modules/villages/sync.integration.test.ts`, `database/connection.integration.test.ts` et `world-web/src/dev/statistics.test.ts`. Ils couvrent isolation concurrente, durées propres, sérialisation réelle, production sans mesures, conservation du transport et comparaison économique avec/sans instrumentation. Les résultats exécutés et la recette navigateur figurent dans le handoff courant. Une mesure sur le PC partagé ou dans un navigateur automatisé n'est pas un benchmark de capacité de production.

## Démarrage local

Utiliser la base de développement déjà initialisée et un compte préexistant dont l’attribution a été décidée explicitement. Lire son UUID avec une requête ciblée en lecture seule, sans exporter ses secrets. Aucun compte réel n’est automatiquement choisi par le NOC.

Dans la configuration locale de l’API, remplacer le marqueur suivant par cet UUID :

```dotenv
ADMIN_ACCOUNT_IDS=<UUID_DU_COMPTE_AUTORISE>
ADMIN_ORIGIN=http://localhost:5175
TRUSTED_PROXY_CIDRS=
NOC_HTTP_SLOW_MS=2000
NOC_HTTP_LOG_MODE=anomalies
```

Redémarrer l’API pour prendre cette configuration en compte. Depuis la racine, `corepack pnpm dev` compile les contrats et démarre les services de développement, dont `admin-web`. Si l’API est déjà lancée avec la bonne configuration, démarrer uniquement la console :

```powershell
corepack pnpm --filter @arbestra/admin-web dev
```

Ouvrir `http://localhost:5175`. `127.0.0.1` et `localhost` sont des origines différentes : conserver l’hôte déclaré. Vite relaie `/api` vers `http://127.0.0.1:3000` par défaut en préservant le Host public (`changeOrigin: false`) ; `VITE_API_PROXY_TARGET` permet de viser une API locale isolée. Le serveur Vite écoute uniquement localhost. Ce serveur n’est pas le serveur public de production.

Ne pas lancer `db:setup`, seed ou reset pour ouvrir la console. Il n’y a aucune migration NOC à appliquer.

## Déploiement sur admin.arbestra.world

Le dépôt fournit le frontend et l’API. Il ne configure pas automatiquement DNS, certificat TLS, service système, sauvegarde ou filtrage réseau. Réaliser ces opérations dans l’environnement cible avant exposition.

1. Construire depuis le checkout validé : `corepack pnpm install --frozen-lockfile`, puis `corepack pnpm build`. Publier `apps/admin-web/dist` comme fichiers statiques sur le domaine dédié. Le routage du frontend utilise le fragment `#/...`.
2. Exécuter l’API compilée avec `corepack pnpm --filter @arbestra/api start`, les variables DB existantes et `NODE_ENV=production`. Le NOC est intégré à cette API ; ne pas créer une seconde API concurrente par inadvertance. Le générateur reste un processus séparé suivant le runbook existant.
3. Définir `ADMIN_ACCOUNT_IDS` avec les seuls UUID approuvés et `ADMIN_ORIGIN=https://admin.arbestra.world`. Conserver secrets DB et configuration réelle hors Git. Aucune adresse email ni UUID d’exemple ne doit attribuer un accès réel.
4. Terminer TLS au reverse proxy et limiter l’accès direct au port API. Si proxy et API sont sur le même hôte, garder l’API sur loopback et déclarer uniquement les IP loopback réellement utilisées dans `TRUSTED_PROXY_CIDRS`. Pour un réseau conteneurisé, déclarer les IP/CIDR du proxy réellement contrôlés. Ne pas recopier une plage générale par commodité.
5. Transmettre le Host public, `X-Forwarded-Proto: https` et une chaîne d’IP établie par le proxy. Supprimer ou remplacer les valeurs de transfert fournies par le client. Une erreur de Host/protocole donne un refus d’origine/TLS ; elle ne se corrige pas en désactivant les contrôles.
6. Sur ce domaine, relayer **uniquement les chemins et méthodes du tableau NOC**. Refuser les autres `/api/*`, en particulier `/api/admin/world-generator` et ses descendants, les endpoints de jeu et les anciens outils DEV. Une règle générique exposant tout `/api/admin/` inclurait le générateur historique et serait insuffisante. Ne pas mettre en cache les réponses API NOC ; les sessions restent sur la même origine que les fichiers statiques.
7. Pour l’alpha, ajouter une protection indépendante par VPN ou contrôle d’accès au proxy. La liste d’UUID applicative reste nécessaire derrière cette protection. Régler la rétention, la rotation et l’accès aux journaux dans l’infrastructure d’hébergement.

Le navigateur ne reçoit aucun secret de configuration ni droit SQL. L’hébergement statique ne doit pas rendre accessibles les sources, les fichiers d’environnement ou les journaux serveur.

## Hôtes publics

Chaque monde est servi sur le sous-domaine de son slug : `alpha-rc1.arbestra.world/village`, sans `?world=`. Alpha vit sur `arbestra.world` (`play.`, `noc.`), staging sur `arbestra.fr` (`play.`, `noc.`, `beta-rc1.`). La source unique est `ops/deploy/sites.py` : bootstrap, passerelle et réparations en dérivent ; un slug ne peut prendre un label réservé (`play`, `noc`, `www`, `api`, anciens hôtes).

- Le DNS est un wildcard `*.arbestra.world` / `*.arbestra.fr` vers le VPS. La passerelle partagée, sans challenge DNS, liste explicitement chaque hôte : relancer `configure-gateway.py` après l’ouverture d’un monde.
- Le client lit le monde dans son hôte (`VITE_WORLD_HOST`, posé par `build.sh`) ; sans ce modèle, en local, il garde `?world=`. Une ancienne adresse `alpha.arbestra.world/village?world=…` est redirigée vers le sous-domaine en conservant le reste de l’adresse ; `play-beta`/`noc-beta.arbestra.world` redirigent vers `arbestra.fr`.
- L’API garde le monde dans son chemin (`/api/worlds/:slug/…`) ; seul l’hôte de la page change.
- Bascule des environnements existants : `ops/repairs/2026-10-24-world-hosts.py` (`hosts`, puis `env` une fois déployée une API qui accepte le modèle `{world}`).

## Journaux et vérification d’exploitation

Les événements d’authentification utilisent des codes contrôlés, l’action et l’UUID acteur lorsqu’il est connu. Ils omettent email, mot de passe, cookie, token, URL avec paramètres et erreur DB brute. Les lectures réussies restent traçables dans les logs structurés ; leurs événements `ADMIN_ACCESS` sont exclus du tampon en mémoire pour préserver la visibilité des incidents pendant les rafraîchissements. Le tampon ne remplace pas la conservation externe des logs.

Le logger API est actif en développement et en production avec une projection positive. Les logs automatiques d’accès brut sont désactivés ; les sérialiseurs et le hook de journalisation excluent les erreurs et messages libres. La politique concerne le processus API, pas le stdout du générateur externe ou du reverse proxy.

`NOC_HTTP_SLOW_MS` accepte un entier de 250 à 60 000 ms, 2 000 par défaut. `NOC_HTTP_LOG_MODE=anomalies|off` vaut `anomalies` par défaut ; `off` désactive uniquement les nouvelles lignes `http.diagnostic`, sans désactiver le tampon ni l’audit des accès administrateur. Une fiche retenue produit au plus une ligne diagnostique ; plafond 20 lignes/s, burst 40. La sortie asynchrone partage une file bornée à 256 lignes et 512 Kio, écriture en cours comprise. Le transport n’est jamais attendu par la requête. Les pertes diagnostiques distinguent limite de débit, capacité et transport. Une sortie bloquée peut perdre des lignes ; les logs ne sont pas une archive durable garantie par le NOC.

Pour diagnostiquer : ouvrir **Infrastructure → Diagnostic HTTP**, sélectionner la période/méthode/route et copier le couple instance/requête depuis la fiche. Rechercher cette référence dans le stdout protégé de cette instance, événement `http.diagnostic`. Le NOC ne lit pas ces fichiers. Configurer rotation, rétention et accès dans l’hébergement ; une panne totale empêchant l’authentification DB reste hors visibilité de la console.

Configurer également l’expurgation au proxy, dans les collecteurs et pour les logs HTTP généraux : ne pas journaliser les corps de connexion, en-têtes Cookie/Authorization, paramètres de recherche de comptes ou chaînes DB. Les accès et la durée de conservation de ces logs sont une responsabilité d’exploitation, pas une propriété fournie par le tampon RAM du NOC.

Vérifier le déploiement sans commande métier :

- Sans session, une lecture NOC sur l’origine correcte est refusée ; un compte ordinaire ne peut pas créer de session admin. Utiliser une fixture ou un compte d’essai approuvé pour la recette.
- Avec un compte explicitement autorisé, parcourir Overview → Infrastructure → monde → village/compte → activité. Contrôler dates, données manquantes et indicateurs tronqués ; consulter ne doit ni créditer des stocks ni acquitter une tâche.
- Vérifier le cookie host-only, Secure, HttpOnly et SameSite strict, puis la déconnexion. Un ancien cookie et un cookie joueur ne doivent pas ouvrir le NOC.
- Vérifier que le domaine refuse `/api/admin/world-generator`, `/api/auth/*` et les routes de jeu. Examiner les journaux protégés pour confirmer l’absence de secrets et de paramètres de recherche.
- Contrôler un redémarrage prévu : nouvel identifiant d’instance, séries runtime reparties sans passé inventé, données métier conservées. Une recette de panne DB doit utiliser un environnement isolé ; ne pas interrompre la base de développement ou de production pour cette vérification.

Les suites liées sont `modules/admin/auth*.test.ts`, `modules/admin/service*.test.ts`, `security/attempt-limiter.test.ts`, `config.test.ts` et les tests de `modules/operations`. Les scénarios DB utilisent des fixtures privées sur une cible `_test` vérifiée, sans reset ; leurs résultats courants doivent être lus dans le handoff, pas déduits de ce document.

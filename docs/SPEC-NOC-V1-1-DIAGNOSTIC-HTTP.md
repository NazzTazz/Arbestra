# NOC V1.1 — Diagnostic HTTP et corrélation locale

15 octobre 2026. Base relue : `main`, HEAD `9c8dde4966d457d291be87cf07992761389532df`, avec la V1 NOC présente dans le worktree non commité.

**Statut : implémentée et recette fonctionnelle locale validée le 15 octobre 2026 ; budget de performance à confirmer en environnement isolé.** Périmètre : retrouver les requêtes lentes et les erreurs HTTP, comprendre le statut de supervision et rapprocher chaque observation de son journal serveur. La console reste en lecture seule. Les preuves courantes et limites de livraison sont consignées dans la [passation](../SESSION-HANDOFF.md) ; les mesures et la réserve sont détaillées dans le [runbook](architecture/operations.md#mesure-locale-du-coût-v11).

Références : [V1 NOC](SPEC-NOC-V1.md), [architecture et exploitation actuelles](architecture/operations.md), [passation](../SESSION-HANDOFF.md).

## 1. Décisions et résultat attendu

**Validé dans la session :** monolithe Fastify/PostgreSQL, contrats partagés, accès par UUID de compte, consultation uniquement, aucune donnée fictive, préservation des mondes. La demande « implémente la spec » autorise cette tranche bornée.

**Périmètre retenu :** diagnostic HTTP local au processus, seuil initial de lenteur de 2 secondes, conservation bornée en mémoire et journalisation corrélée disponible en développement comme en production. Les valeurs et règles ci-dessous définissent la cible acceptée ; leur vérification demeure distincte de cette acceptation. Aucun arbitrage de gameplay ni choix produit bloquant n’est identifié.

Un exploitant doit pouvoir répondre à quatre questions :

1. Pourquoi l’état supervisé est-il actuellement dégradé ou inconnu ?
2. Quelle route a répondu lentement, échoué ou été interrompue ?
3. Quels faits sont établis pour cette requête, et quelle référence chercher dans les journaux ?
4. Quelles informations manquent ou ne sont plus conservées ?

Exemple d’acceptation : une route renvoie `503 ADMIN_DATA_UNAVAILABLE` après 8 secondes. Le NOC affiche **une observation**, avec les motifs « lente » et « erreur serveur », la route modèle, la durée mesurée, le code sûr et une référence. L’événement HTTP et la ligne de journal portent cette même référence. Une sonde PostgreSQL échouée à proximité demeure un autre événement ; elle n’est pas présentée comme la cause de cette 503.

La tranche permettra d’identifier la requête et sa catégorie d’échec. Elle ne promet pas d’expliquer automatiquement le temps passé dans SQL, le pool, un verrou ou le navigateur.

## 2. Base V1 vérifiée avant cette tranche et problème concret

L’épisode observé le 15 octobre a produit un événement HTTP à 19:49:54 puis un échec de sonde DB à 19:50:01, heure de Paris. La V1 a détecté l’épisode mais n’a pas conservé l’association entre route, durée et erreur. Leurs causes et leur éventuel lien restent indéterminés ; cette tranche ne reconstituera pas les faits passés manquants.

| Source réelle | Comportement de la V1 avant modification / limite |
|---|---|
| `apps/api/src/modules/operations/telemetry.ts` | `instrumentHttp()` observe `finish`/`close`, avec garde de terminaison unique. `recordRequest()` conserve durée/statut, sans route ni identifiant. Une interruption est assimilée à un 499 synthétique. |
| Même module | Fenêtre HTTP de 5 min, 4 096 durées au plus, 120 échantillons temporels, 100 événements. Registre commun aux plugins via `app.server`. |
| `apps/api/src/app.ts` | Le logger dépend de `isProduction`. Le gestionnaire utilise `app.log.error(error)`, sans corrélation avec la requête ; les `HttpError` sont renvoyées directement. |
| `modules/admin/service.ts` | `ADMIN_BUSY` distingue la capacité de lecture occupée ; `ADMIN_DATA_UNAVAILABLE` masque volontairement l’erreur technique. Aucune cause DB ne peut être déduite de ce dernier code seul. |
| `modules/operations/database-probe.ts` | Sonde séparée, cache 15 s, seuil dégradé supérieur à 500 ms. Elle ne mesure pas l’attente du pool métier ni les verrous d’une requête donnée. |
| `modules/villages/sync.ts` | Les SSE sont marqués puis servis par `hijack()` / réponse brute. Leur durée de connexion est exclue des requêtes HTTP courtes. |
| `apps/admin-web/src/pages.tsx` | Overview et Infrastructure affichent des agrégats et un journal filtré par gravité, sans détail HTTP corrélé. Le p95 du graphe est calculé par période de collecte. |

Le Fastify installé expose `request.routeOptions.url` et permet de configurer `genReqId` et `requestIdHeader`. Son sérialiseur de requête par défaut utilise l’URL brute : activer simplement les logs en développement ne satisfait pas la confidentialité attendue.

## 3. Périmètre fonctionnel

### 3.1 Expliquer le statut actuel

Le badge de statut ouvre une liste de **raisons actives**, calculées à partir du même snapshot que le badge :

- nombre de réponses 5xx dans la fenêtre HTTP de cinq minutes ;
- sonde DB indisponible ou au-dessus de son seuil, avec date et durée observées ;
- worker dégradé ou indisponible, avec son dernier signal ;
- couverture inconnue : composant non instrumenté ou observation absente.

Une raison indique sa source, son périmètre, sa fraîcheur et, lorsqu’il existe, un lien vers le diagnostic pertinent. Les incidents historiques ne sont pas tous des raisons encore actives. Les raisons de couverture inconnue restent visibles même lorsqu’un autre signal impose « dégradé ».

**Les règles de statut V1 restent conservées.** Une réponse 5xx suffit actuellement à dégrader la fenêtre. Le seuil de lenteur proposé sélectionne des observations ; il ne devient pas un nouvel objectif de disponibilité ou une règle de dégradation implicite.

### 3.2 Consulter les requêtes retenues

Sous **Infrastructure → Diagnostic HTTP**, afficher une liste des requêtes terminées retenues, avec : fin observée, méthode, route modèle, durée, résultat, motifs, code connu et référence courte. Les routes de la console portent le libellé « Console » ; les autres, « API ». Ce classement provient des routes enregistrées, pas d’un en-tête client.

Filtres : fenêtre temporelle, motif (`erreur serveur`, `lente`, `interrompue`), méthode, route modèle exacte, périmètre Console/API, référence exacte et durée minimale. Les filtres sont combinés par ET ; une requête ayant plusieurs motifs reste une ligne unique. Valeurs de durée proposées dans l’UI : seuil actif, 5 s, 10 s. Aucun filtre de payload, expression régulière ou recherche libre dans les journaux.

Le résultat est intitulé **« observations conservées »**. Il n’est ni un journal exhaustif des accès ni une base permettant de recalculer des percentiles représentatifs de toutes les requêtes.

### 3.3 Ouvrir un diagnostic

La fiche présente :

- la référence complète `(instanceId, requestId)`, copiable ;
- début, fin observée, durée monotone, méthode, route et résultat ;
- les motifs de conservation et le seuil réellement appliqué ;
- le code sûr, sa catégorie et une explication issue d’un catalogue contrôlé ;
- les événements portant **explicitement** la même référence ;
- les limites de preuve : cause non établie, contexte non capturé, données non conservées.

Une explication peut être « capacité de lecture du NOC occupée », « lecture diagnostique indisponible » ou « erreur interne non classée ». Une cause non enregistrée ne reçoit pas une explication automatique.

Les observations proches dans le temps peuvent être consultées via le journal existant filtré sur la période, dans un bloc nommé **« Autres événements de cette période »**. Ce voisinage ne crée aucun lien causal. La santé DB affichée aujourd’hui n’est jamais présentée comme sa santé à l’instant d’une ancienne requête.

Les rattachements automatiques à monde/village/compte sont **hors scope de cette tranche** : ils demanderaient une propagation de contexte métier validé. Les diagnostics métier de la V1 restent accessibles séparément. Aucun UUID n’est extrait arbitrairement de l’URL pour fabriquer ce contexte.

### 3.4 Entrées depuis la synthèse

- Le compteur 5xx ouvre le diagnostic filtré sur les erreurs et la fenêtre affichée.
- Le journal ouvre le détail HTTP uniquement lorsqu’une référence explicite a été enregistrée.
- Chaque mesure du tableau accessible associé au graphe propose « Voir les requêtes retenues de cette période ». Une interaction équivalente sur le point du graphe est possible, sans rendre la souris obligatoire.
- Une liste vide affiche « Aucune observation conservée pour ces filtres », jamais « Aucun incident n’a eu lieu ».

La navigation principale reste stable. Aucun bouton de relance, réparation, annulation ou rejeu de commande n’est ajouté.

## 4. Règles de mesure et de sélection

### Identité et temps

Générer un UUID serveur pour chaque requête entrant dans l’instrumentation Fastify, utilisé comme `request.id`. Déclarer explicitement `requestIdHeader: false` : un identifiant ou un `traceparent` envoyé par le client ne remplace pas cette identité. La clé de consultation inclut toujours l’instance, déjà identifiée au démarrage de la V1.

Émettre `X-Request-Id` sur les réponses, y compris les refus et erreurs gérés par l’application. Ne pas modifier les corps JSON métier pour cela. Vérifier le chemin SSE brut séparément ; les erreurs survenant avant la prise en charge Fastify ne bénéficient pas d’une garantie de corrélation.

`startedAt` et `endedAt` sont des dates serveur UTC. `durationMs` vient d’une horloge monotone : ne pas la recalculer par soustraction de dates murales. Elle s’étend de l’entrée du hook à la terminaison observée côté serveur et inclut les attentes éventuelles. `finish` ne prouve pas que le navigateur a reçu ou affiché la réponse.

### Résultat et motifs

| Cas | Observation / traitement |
|---|---|
| Réponse terminée 5xx | Retenue systématiquement ; motif `server_error`. Le statut final est conservé même sans exception. |
| Réponse terminée, durée ≥ seuil | Retenue avec `slow`, quel que soit le statut. Une 503 lente a deux motifs et une seule fiche. |
| Connexion fermée avant fin de réponse | Retenue avec `aborted` et, si applicable, `slow`. Statut final `null` ; ne pas afficher « réponse 499 ». La cause de fermeture n’est pas attribuée au client sans preuve. |
| Réponse rapide 2xx/3xx/4xx | Compteurs HTTP conservés, pas de fiche détaillée. Les refus privilégiés continuent d’alimenter l’audit existant. |
| SSE ouvert | Exclu des durées courtes et du tampon HTTP détaillé. Son cycle reste dans les métriques/événements SSE. |
| Refus avant ouverture SSE | Réponse HTTP ordinaire, soumise aux règles ci-dessus. |

**Correction sémantique incluse :** une interruption n’entre plus dans les réponses 4xx ni dans les percentiles des réponses terminées. Ajouter un compteur distinct d’interruptions ; le total des requêtes terminées ou interrompues conserve une définition explicite. Les événements de flux SSE restent distincts des 5xx HTTP. Une fermeture normale de flux n’est pas une erreur serveur.

Un hook d’erreur sert à annoter les faits disponibles ; il ne finalise pas l’observation. Le statut et l’issue finaux font foi. Conserver un seul point de finalisation pour éviter les doublons `onError`/`finish`/`close`, y compris en cas d’erreur de sérialisation.

### Bornes proposées

| Paramètre | Proposition |
|---|---|
| Seuil lent | `NOC_HTTP_SLOW_MS`, 2 000 ms par défaut ; entier 250–60 000, validé au démarrage. La réponse indique le seuil actif. |
| Rétention maximale | 10 min après terminaison, cohérente avec l’horizon des séries V1 ; éviction anticipée possible. |
| Capacité | 512 observations au total, expiration et éviction des plus anciennes. Pas de promesse de fenêtre complète. |
| Taille | DTO individuel limité à 2 Kio sérialisés, chaînes et tableaux bornés par schéma ; aucune référence à `request`, `reply`, `Error` ou promesse conservée. L’empreinte réelle du heap est à mesurer. |
| Page | 50 par défaut, maximum 100. |
| Rafraîchissement UI | 15 s en vue récente, une requête à la fois ; suspendu pendant l’exploration des pages anciennes. |
| Journal HTTP diagnostique | Au plus 20 lignes/s, burst 40 ; dépassements comptés explicitement. Cette limite ne modifie pas les compteurs HTTP ni le tampon RAM. |
| File de sortie diagnostique | Au plus 256 lignes et 512 Kio en attente, la première borne atteinte s’appliquant ; les pertes sont comptées. Aucun buffer applicatif sans limite. |

Le tampon détaillé ne remplace ni les 4 096 durées V1, ni les agrégats cinq minutes, ni les événements d’exploitation. Les compteurs d’éviction par capacité, d’expiration et d’échec de collecte sont séparés. Le comptage global des réponses continue même si une fiche ne peut plus être conservée.

L’inventaire détaillé des requêtes **encore en cours** est reporté. Le compteur global existant demeure visible ; une requête bloquée n’obtient une fiche qu’à sa terminaison ou interruption. Cette limite doit être indiquée dans la page.

## 5. Contrats et endpoints proposés

Créer des schémas JSON TypeBox partagés dans `packages/contracts`, réutilisés pour les types TypeScript et la sérialisation Fastify. Étendre les contrats runtime de façon explicite ; aucun objet d’erreur natif ne traverse un contrat.

### Observation HTTP

| Champ | Règle |
|---|---|
| `instanceId`, `requestId` | UUID serveur ; identité stable pendant la conservation. |
| `sequence` | Entier strictement croissant dans l’instance, attribué à la finalisation ; ordre de pagination. |
| `startedAt`, `endedAt`, `durationMs` | Dates ISO UTC, durée finie et positive ou nulle. |
| `method`, `route`, `scope` | Méthode bornée, route modèle enregistrée (256 caractères max), `api` ou `console`. Repli constant `unmatched` pour une route non résolue, jamais URL brute. |
| `outcome`, `statusCode` | `response` avec statut final, ou `aborted` avec statut final `null`. |
| `reasons`, `slowThresholdMs` | Motifs distincts `server_error`, `slow`, `aborted`, seuil utilisé à la finalisation. |
| `safeCode`, `errorCategory` | Valeurs d’un catalogue fermé ou `null` ; catégories `application`, `internal`, `transport`, `unknown`. |
| `captureSite` | Point de capture contrôlé, par exemple `http.error-handler`, `admin.read` ou `http.finalize`, jamais chemin système. |

Catalogue initial : `INTERNAL_ERROR`, `ADMIN_BUSY`, `ADMIN_DATA_UNAVAILABLE`, `VALIDATION_ERROR`, `HTTP_SERVER_RESPONSE`, `CONNECTION_INTERRUPTED`. Les autres codes doivent être ajoutés explicitement au catalogue avant exposition ; une regex de forme ne suffit pas à déclarer un code sûr. Une réponse 5xx construite directement reçoit le repli contrôlé `HTTP_SERVER_RESPONSE` si aucune annotation sûre n’est disponible. Ne pas analyser un payload sérialisé pour y chercher un code.

`ADMIN_DATA_UNAVAILABLE` reste une lecture indisponible **sans attribution DB plus précise** dans cette tranche. Une classification SQLSTATE ou le détail d’attente du pool constitue une extension ultérieure ; il ne doit pas être inventé à partir de ce code générique.

### API de consultation

| Endpoint | Fonction |
|---|---|
| `GET /api/admin/http-requests` | Page d’observations avec filtres bornés, métadonnées de couverture et pagination. |
| `GET /api/admin/http-requests/:requestId?instanceId=…` | Une observation retenue et les événements explicitement corrélés encore présents. |
| `GET /api/admin/infrastructure` existant | Ajout des raisons de statut, du compteur d’interruptions et des métadonnées nécessaires aux périodes du graphe. Pas d’embarquement des 512 fiches à chaque rafraîchissement. |

La liste accepte `instanceId`, `from`, `to`, `reason`, `method`, `route`, `scope`, `requestId`, `minDurationMs`, `limit`, `snapshotSequence` et `beforeSequence`. Schéma strict, paramètres inconnus refusés, dates ordonnées et intervalle demandé limité à 10 min, valeurs/longueurs bornées. Par défaut, le serveur fixe `to` à l’instant de lecture et `from` dix minutes auparavant, puis retourne ces bornes effectives. Le filtrage porte sur `endedAt` dans l’intervalle `[from, to)`, comme le classement des réponses dans les échantillons temporels ; le frontend conserve ces dates lorsqu’il poursuit la pagination.

La première page fixe une `snapshotSequence`. Les suivantes restent sous cette borne et avant la dernière séquence lue ; elles gardent les mêmes filtres et l’instance. Tri décroissant par séquence, sans offset. Un changement de filtre ouvre une nouvelle fenêtre. Pas de stockage serveur de curseurs ni de chargement illimité.

Chaque réponse de liste inclut : `observedAt`, `instanceId`, `startedAt`, seuil actif, rétention/capacité, nombre actuellement retenu, plus ancienne observation conservée ou `null`, compteurs d’éviction/expiration/échec de collecte, mode de journalisation et pertes de lignes, `snapshotSequence` et `nextBeforeSequence`. Les trous dus à une éviction concurrente sont signalés par les compteurs et bornes retournés ; une pagination ne garantit pas la complétude d’un historique volatil. Les séquences sont des entiers bornés valides, jamais une autorité d’accès ; le détail et la liste recontrôlent toujours la session.

Une instance demandée différente retourne `409 INSTANCE_MISMATCH` avec l’identité de l’instance répondante après authentification. Une référence absente du tampon de la même instance retourne `404 HTTP_OBSERVATION_NOT_RETAINED` : le serveur ne prétend pas distinguer un UUID jamais vu d’une fiche expirée sans tombstone. Aucun registre supplémentaire des UUID évincés n’est requis.

Les nouveaux endpoints appliquent `requireAdmin` et `noc:read`, origine et cookie V1, `Cache-Control: private, no-store`, schemas de réponse et audit d’accès. Aucun accès direct à un fichier de logs depuis l’API. Leur authentification SQL existante reste nécessaire ; la consultation du contenu diagnostique est uniquement en mémoire.

## 6. Confidentialité et journaux corrélés

La projection est construite par liste positive. Sont exclus de la RAM diagnostique, des contrats frontend et des nouvelles lignes de journal : URL brute/query string, corps de requête/réponse, cookies, tokens, mot de passe, email, IP, user-agent, en-têtes arbitraires, SQL/paramètres, chaîne de connexion, message d’exception et pile bruts. Une route non reconnue utilise le repli constant, même si son chemin contient un secret. Méthodes non standard et valeurs non reconnues utilisent également des replis contrôlés.

Proposer `NOC_HTTP_LOG_MODE=anomalies|off`, avec `anomalies` par défaut en développement et en production. Cette option régit uniquement les nouvelles lignes diagnostiques HTTP ; elle ne désactive ni la collecte RAM, ni les permissions, ni la journalisation des accès/refus administrateur. Le mode `off` est visible dans les métadonnées d’exploitation et ne signifie pas que l’incident n’existe pas.

Une finalisation retenue produit au plus une ligne `http.diagnostic` contenant les champs sûrs de la fiche et la même référence. L’événement HTTP, le log et l’en-tête de réponse utilisent exactement le même UUID serveur. Un événement de sonde ou de worker garde une corrélation absente, sauf lien réellement établi par son code ; aucune association par horodatage.

Réutiliser le logger Fastify/Pino existant avec une politique indépendante de `NODE_ENV`, et des sérialiseurs sûrs pour requêtes, réponses et erreurs. Désactiver les logs automatiques d’accès contenant l’URL brute ou les remplacer par la même projection sûre. Auditer les appels existants avant activation en développement : `app.log.error(error)` ou `warn(error, …)` ne doivent pas réintroduire un message, une cause imbriquée ou une pile brute par un autre chemin. Utiliser le contexte de la requête pour le gestionnaire HTTP, au lieu d’un log global non corrélé.

Ne pas ajouter de writer SQL ou de service de logs. La sortie structurée utilise un mécanisme asynchrone borné ; un transport lent ou en panne ne doit pas faire croître une file sans limite ni changer la réponse métier. Les lignes diagnostiques non émises sont comptées (`logsDropped`), avec cause de limitation/transport lorsque connue. La mémoire du tampon et les compteurs restent utilisables même si la sortie de logs échoue. La rétention/rotation du stdout par l’hébergement demeure une responsabilité du runbook, sans garantie de journal durable fournie par cette tranche.

Les traces brutes, piles détaillées, mode de journalisation de toutes les réponses rapides et recherche distante dans les logs sont hors scope.

## 7. Frontend : précision et états dégradés

Conserver le thème et les composants V1, avec une route enfant d’Infrastructure et un détail identifiable dans l’URL. Afficher les durées longues en secondes lisibles (par exemple 24,5 s), avec les millisecondes exactes dans le détail.

Les échantillons temporels doivent exposer début et fin de période réellement observés, nombre de réponses terminées, taille d’échantillon et troncature. Ne pas supposer qu’un timer s’exécute exactement toutes les cinq secondes : un intervalle retardé est affiché avec sa durée réelle. Le p95 d’une petite population peut correspondre à sa réponse la plus lente ; une note accessible le précise. Les périodes sans réponse restent vides, avec leurs coupures et points isolés conservés.

La liste se rafraîchit en vue récente ; elle est figée volontairement lorsqu’on parcourt les pages anciennes. Afficher « Fenêtre consultée au… » et une action « Revenir aux observations récentes ». Le détail ne saute pas vers une nouvelle requête au rafraîchissement. Un retour rétablit filtres et fenêtre.

| Situation | Rendu attendu |
|---|---|
| Chargement initial | État de chargement explicite, aucune ligne inventée. |
| Aucun résultat | Absence d’observations conservées pour les filtres, pas absence historique d’incident. |
| Échec réseau/503 | Dernier résultat gardé avec sa date, erreur visible et reprise ; aucune déclaration de santé nouvelle. |
| Fenêtre figée | Distincte d’une actualisation échouée. |
| Redémarrage/autre instance | Bannière et retour explicite aux données de l’instance actuelle ; aucune fusion de séries, séquences ou références. |
| Éviction/expiration | Couverture limitée signalée ; détail absent expliqué sans prétendre connaître la cause de disparition. |
| Aucun événement corrélé retenu | « Aucun événement corrélé encore conservé » ; aucune causalité déduite d’un voisinage temporel. |
| Incident sans référence HTTP | Faits de l’incident conservés dans le journal V1 ; pas de faux lien vers une requête. |

Parcours au clavier, tableaux défilants sur petit écran, libellés explicites et timestamps absolus/relatifs. L’actualisation ne déplace pas le focus. Copier une référence ne copie pas les données de compte ni les paramètres d’une requête.

## 8. Architecture et invariants

Changements attendus, limités aux points nécessaires :

- `packages/contracts` : observations, métadonnées, raisons de statut et validation JSON des nouveaux échanges ;
- `modules/operations` : finalisation unique, tampon borné, projection sûre et lien événements/requêtes ;
- `app.ts` / configuration : identité serveur, en-tête, annotation du gestionnaire d’erreur et politique de logs sûre ;
- `modules/admin/routes.ts` : deux lectures protégées en mémoire ;
- `apps/admin-web` : explication de statut, liste/détail et accès depuis les signaux ;
- `sync.ts` : seulement le raccordement nécessaire à l’en-tête de corrélation et la préservation de l’exclusion SSE ;
- runbook / `.env.example` : seuil, mode de logs, lecture des limites et nouveaux chemins autorisés au proxy.

Aucune migration, nouvelle base, Redis, Kafka, OpenTelemetry obligatoire, microservice ou stockage de logs dans PostgreSQL. Aucun changement aux commandes économiques, verrous, crédits, notifications, workers ou reçus. Aucun ajout de requête SQL pour collecter une observation. Aucun `await` de collecte ou de log dans une transaction métier. Le collecteur ne conserve pas un objet de requête après sa fin.

La capture doit échouer sans modifier le statut HTTP, le corps, l’idempotence ou les écritures métier. Les incidents liés à la collecte sont des compteurs/signalements contrôlés, sans journalisation récursive d’un échec du logger. Les endpoints diagnostiques sont eux-mêmes mesurés, sans provoquer de requête HTTP interne ni boucle d’incidents.

Les erreurs d’une infrastructure amont, l’indisponibilité totale de l’API et une panne DB empêchant l’authentification restent hors visibilité directe de la console. Ne créer aucun endpoint public de contournement pour cette tranche.

## 9. Acceptation et preuves à produire lors de l’implémentation

| Cas | Preuve attendue |
|---|---|
| Identité | En-tête client forgé ignoré ; même ID serveur dans réponse, fiche, événement HTTP et log. Deux requêtes simultanées conservent des identités distinctes. |
| Confidentialité | Secrets témoins dans chemin inconnu, query, corps, headers, exception multiligne et cause imbriquée absents de toute sortie diagnostique, y compris logs automatiques en dev/prod. |
| Route | Paramètres différents d’une même route donnent le même modèle ; aucune URL concrète recopiée. |
| Classification | Exception 500, `ADMIN_BUSY`, `ADMIN_DATA_UNAVAILABLE`, 503 directe sans exception, erreur de sérialisation, validation et refus d’accès testés séparément ; pas de fausse cause DB. |
| Temps / terminaison | Seuil juste en dessous/au-dessus, succès lent et 503 lente, une seule finalisation malgré `finish` puis `close`. Horloge monotone injectable pour les limites. |
| Interruption | Vraie connexion interrompue : issue `aborted`, statut final null, compteur actif nettoyé, absence de faux 499 reçu et exclusion des percentiles des réponses terminées. |
| Concurrence | Barrières bornées entre deux requêtes et libération en `finally` ; aucune durée, erreur ou référence échangée entre les requêtes. |
| SSE | Reprendre le test réel : en-tête effectivement émis dans la réponse brute, flux hors statistiques courtes et tampon, compteurs à zéro après fermeture ; refus avant ouverture traité en HTTP. |
| Rétention / pages | Dépasser 512 observations, avancer l’horloge, ajouter/évincer pendant la pagination ; ordre stable pour les éléments encore retenus, pertes signalées, mémoire/tailles bornées. |
| Instance | Redémarrage ou instance différente : réponse et UI explicites, aucune ancienne référence réaffectée. |
| Statut | Raison 5xx et période cohérentes avec le badge ; expiration du signal après cinq minutes sans effacer artificiellement une autre raison active. |
| Événements | HTTP et fiche reliés explicitement ; panne de sonde simultanée sans lien causal fabriqué ; incident évincé annoncé comme non conservé. |
| Autorisation | Anonyme/compte ordinaire refusés sur les deux nouveaux endpoints, admin autorisé, révocation recontrôlée et aucune fuite via le détail d’une référence. |
| Collecte / logs défaillants | Sink en échec et en contrepression, dépassement de budget : réponse inchangée, file bornée, pertes visibles, pas de récursion. |
| Économie | Sur une commande existante en fixture privée, même réponse métier et mêmes données finales avec diagnostic actif/inactif ; aucun SQL de collecte ajouté, aucun reset de base. |
| UX | Overview → raison/liste filtrée → détail → retour, filtre conservé, données absentes, réseau en échec, éviction et mobile ; capture navigateur des parcours réels. |

Mesurer également le coût avant/après sur le même environnement : endpoint simple, réponse lente contrôlée, mélange d’erreurs et collecte au-delà de la capacité. Reporter débit, p50/p95, CPU et mémoire après stabilisation. Cible proposée de surcoût : p95 inférieur à 5 % ou 1 ms (la borne la plus large), sans croissance mémoire continue. Un résultat bruité ou supérieur exige analyse et correction/documentation avant clôture, pas une performance proclamée depuis un microtest.

Tests DB uniquement sur cible `_test` vérifiée avec fixtures privées et suites séquentielles. Validation liée puis lint, types, builds concernés et parcours navigateur. Les résultats de la V1 ne constituent pas une preuve pour cette nouvelle tranche.

## 10. Ordre de réalisation et sortie de tranche

1. Poser contrats, règles de sélection, identité serveur et tests de projection sûre/terminaison ; vérifier les erreurs directes, précoces et interrompues.
2. Raccorder capture et journal sûr, puis lectures protégées et pagination ; conserver le fonctionnement SSE et les invariants métier.
3. Livrer explication du statut, liste/détail, navigation depuis le graphe et états de couverture ; recetter dans le navigateur.
4. Mesurer le coût, rejouer les suites liées, mettre à jour le runbook et la passation avec preuves réelles et limites.

**Sortie attendue :** la prochaine anomalie HTTP éligible devient une observation identifiable, consultable et corrélable au serveur, sans fuite de secrets ni modification du jeu. La tranche est à valider tant que les preuves de confidentialité, d’isolation, de bornage et de parcours manquent.

Hors scope : résolution de l’incident du 15 octobre, optimisation métier générale, instrumentation SQL/pool/verrous détaillée, inventaire des requêtes en cours, contexte compte/monde propagé partout, agrégats multi-instance, historique durable, recherche dans des fichiers, alerting externe, invitations/permissions fines et commandes administratives.

Ordre de grandeur proposé : 3–5 jours de développement et recette concentrés, dépendant du travail nécessaire sur les sorties de logs existantes. Ce n’est ni une date d’engagement ni l’estimation de toute l’alpha privée.

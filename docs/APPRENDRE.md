# Apprendre Arbestra : un parcours de lecture

Ce parcours explique comment le jeu est construit, en suivant le code réel. Il est écrit pour quelqu'un qui sait un peu programmer mais n'a jamais vu un jeu en ligne de l'intérieur. Les liens `fichier:ligne` pointent vers le code à l'état du 4 novembre 2026 ; les numéros de ligne bougent, cherche alors le nom de la fonction citée. Pour la version « référence » (règles, pièges), voir le [guide développeur](GUIDE-DEVELOPPEUR.md) et l'[index d'architecture](architecture/README.md). Pour installer le projet : [CONTRIBUTING.md](../CONTRIBUTING.md).

## 1. Le monorepo en une minute

Un seul dépôt, plusieurs paquets (gérés par pnpm, voir [pnpm-workspace.yaml](../pnpm-workspace.yaml)) :

| Dossier | Rôle |
|---|---|
| [`apps/api`](../apps/api/src) | Le serveur (Fastify). Il **décide de tout** : ressources, droits, durées. Il parle à PostgreSQL et fait tourner les tâches différées (chantiers qui finissent, récoltes). |
| [`apps/world-web`](../apps/world-web/src) | Le client du monde : React pour les panneaux et le HUD, Babylon.js pour la 3D. Il affiche et envoie des demandes ; il n'invente aucune valeur de jeu. |
| [`apps/play-web`](../apps/play-web) | Compte, inscription, choix du monde (le « lobby »). |
| [`apps/admin-web`](../apps/admin-web) | Console d'exploitation (NOC) : supervision réservée aux administrateurs. |
| [`packages/contracts`](../packages/contracts/src) | Les **contrats** : la forme exacte des messages entre client et serveur, plus des calculs que les deux côtés doivent faire de la même façon (emprises de bâtiments, coûts, trajets). Voir par exemple [`building-footprint.ts`](../packages/contracts/src/building-footprint.ts). |

Pourquoi un paquet `contracts` ? Parce que le client et le serveur doivent s'accorder au caractère près sur ce qu'ils s'échangent. Un contrat partagé fait échouer la compilation, plutôt que le jeu, quand l'un des deux change sans l'autre.

La règle d'or : **le client propose, le serveur dispose**. Même si un joueur modifie le code de son navigateur, il ne peut pas se donner du bois.

## 2. Le trajet d'une commande

Exemple : le joueur pose un bâtiment. Voici le chemin, du clic jusqu'à l'écran.

**Dans le client**

1. Le clic arrive dans la scène, puis dans `App.tsx`, qui prépare une commande avec un identifiant unique (`commandId`) : [`executeConstruction`](../apps/world-web/src/App.tsx#L967) appelle `villageV2.construct(...)` ([ligne 992](../apps/world-web/src/App.tsx#L992)). L'identifiant sert à rejouer la commande sans danger si la réponse se perd : le serveur reconnaît un doublon.
2. [`sync-v2-transport.ts`](../apps/world-web/src/api/sync-v2-transport.ts) envoie la requête HTTP : [`construct`](../apps/world-web/src/api/sync-v2-transport.ts#L518) puis [`confirmConstruction`](../apps/world-web/src/api/sync-v2-transport.ts#L552). Toute requête porte l'en-tête `x-arbestra-protocol: 2` ([ligne 172](../apps/world-web/src/api/sync-v2-transport.ts#L172)).

**Dans le serveur**

3. La route `POST /api/worlds/:worldSlug/villages/:villageId/buildings` ([`routes.ts:575`](../apps/api/src/modules/villages/routes.ts#L575)) refuse d'abord les clients trop anciens (`requireProtocolV2`), valide la forme de la requête avec un schéma venu de `contracts`, authentifie le joueur, puis appelle [`placeBuildingV2`](../apps/api/src/modules/villages/construction-v2.ts#L12).
4. [`placeBuilding`](../apps/api/src/modules/villages/construction.ts#L481) ouvre **une transaction PostgreSQL** : tout ce qui suit réussit ensemble ou n'a jamais eu lieu. Elle commence par prendre le verrou du village ([`lockPlacement`](../apps/api/src/modules/villages/construction.ts#L62), `for update`) : deux commandes sur le même village se mettent en file au lieu de se marcher dessus. D'autres commandes passent par [`beginVillageEconomy`](../apps/api/src/modules/villages/reconcile-economy.ts#L145), qui prend le même verrou puis lit **l'heure du serveur** une fois le verrou obtenu : commande et réponse partagent ainsi la même borne de temps.
5. Les règles s'appliquent (coût, emplacement, portée), puis les écritures ont lieu : le bâtiment en construction, les ressources payées, un reçu de commande ([`construction.ts:604`](../apps/api/src/modules/villages/construction.ts#L604)). Un refus lève une `HttpError` (4xx) et rien n'est écrit.
6. En dernier dans la transaction, [`publishPrivateEffects`](../apps/api/src/modules/villages/sync-v2-effects.ts#L11) appelle la fonction SQL `game_sync_publish()` ([migration 051](../apps/api/src/database/migrations/051_game_sync_foundation.ts)). Elle transforme les changements notés par des triggers de la base en une nouvelle « révision » du flux du village, que la réponse renvoie au client.
7. La fin du chantier n'est pas dans la requête : une tâche planifiée (table `scheduled_tasks`) sera prise plus tard par le worker ([`jobs/scheduled-tasks.ts`](../apps/api/src/jobs/scheduled-tasks.ts), handlers dans [`jobs/task-handlers.ts`](../apps/api/src/jobs/task-handlers.ts), par exemple [`complete-construction.ts`](../apps/api/src/modules/villages/complete-construction.ts)), qui publiera à son tour une révision.

**Le retour : la synchronisation V2**

8. Le client garde une connexion ouverte (SSE) vers `sync/stream` ([`sync-v2-routes.ts`](../apps/api/src/modules/villages/sync-v2-routes.ts), [`serveSyncV2Stream`](../apps/api/src/modules/villages/sync-v2-stream.ts#L25)). Dès qu'une révision est publiée, PostgreSQL envoie un `NOTIFY` ([migration 080](../apps/api/src/database/migrations/080_game_sync_notify.ts)) ; le serveur réveille les flux concernés ([`sync-v2-wakeups.ts`](../apps/api/src/modules/villages/sync-v2-wakeups.ts)), relit ce qui a changé ([`captureSyncV2`](../apps/api/src/modules/villages/sync-v2-capture.ts#L95)) et l'envoie en delta.
9. Côté client, [`SyncV2Session.apply`](../apps/world-web/src/api/sync-v2-session.ts#L116) passe le lot à [`applySyncV2Batch`](../packages/contracts/src/sync-v2.ts#L665), une fonction pure et idempotente (le même lot appliqué deux fois donne le même état) vivant dans `contracts`. La réponse directe de la commande est appliquée de la même façon (`applyEffects`, [ligne 562](../apps/world-web/src/api/sync-v2-transport.ts#L562)).
10. Le hook React [`useVillageSyncV2`](../apps/world-web/src/api/processing-v2.ts#L203) remet l'état à `App.tsx` ([`applySnapshot`](../apps/world-web/src/App.tsx#L232), branché ligne 318), qui le passe au composant de la scène : [`VillageScene.tsx:263`](../apps/world-web/src/scene/VillageScene.tsx#L263) appelle `update(...)` sur la scène Babylon. C'est le sujet de la section suivante.

Résumé : **clic → HTTP → transaction PostgreSQL (verrou, règles, écritures, publication) → réponse + flux V2 → état client → scène**. Beaucoup de décisions d'architecture (ordre des verrous, borne de temps unique, publication en dernière opération) existent pour qu'aucune de ces étapes ne puisse montrer au joueur un état incohérent.

## 3. La scène Babylon

Babylon.js est un moteur 3D pour le navigateur. Toute la scène du village est dans [`scene/BabylonVillageScene.ts`](../apps/world-web/src/scene/BabylonVillageScene.ts) (un très gros fichier : cherche par nom de méthode). Le composant React [`VillageScene.tsx`](../apps/world-web/src/scene/VillageScene.tsx) la crée ([ligne 226](../apps/world-web/src/scene/VillageScene.tsx#L226)) et lui transmet l'état.

- **Création** : le constructeur fabrique le moteur ([`new Engine`, ligne 1353](../apps/world-web/src/scene/BabylonVillageScene.ts#L1353)), règle la résolution de rendu (`setHardwareScalingLevel`, ligne 1355) et la cadence maximale, puis la scène.
- **Recevoir l'état** : [`update(...)`](../apps/world-web/src/scene/BabylonVillageScene.ts#L2039) est appelé à chaque nouvel état du village. Il construit ou met à jour les bâtiments (un cache de meshes, [`#buildingCache`](../apps/world-web/src/scene/BabylonVillageScene.ts#L2327)) et prévient les villageois ([`this.#workers.sync(...)`, ligne 2231](../apps/world-web/src/scene/BabylonVillageScene.ts#L2231)).
- **Le terrain** vient d'un autre chemin : le serveur envoie le sol par morceaux (chunks) à mesure que la caméra se déplace. [`TerrainStore`](../apps/world-web/src/scene/terrain-store.ts#L86) garde les données, [`TerrainRenderer`](../apps/world-web/src/scene/terrain-renderer.ts#L35) en fait des meshes, et [`#streamTerrain`](../apps/world-web/src/scene/BabylonVillageScene.ts#L5322) décide à chaque image quoi demander ou retirer. Le terrain est un tore (le monde se raccorde sur lui-même) : les coordonnées sont toujours ramenées dans le monde.
- **Les bâtiments** sont des modèles procéduraux ou précalculés ([`building-geometry.ts`](../apps/world-web/src/scene/building-geometry.ts), [`building-assets.ts`](../apps/world-web/src/scene/building-assets.ts), niveaux de détail dans [`building-lod.ts`](../apps/world-web/src/scene/building-lod.ts)).
- **Les villageois** sont gérés par [`VillageWorkers`](../apps/world-web/src/scene/village-workers.ts#L264) : `sync` ([ligne 331](../apps/world-web/src/scene/village-workers.ts#L331)) apprend qui travaille où depuis l'état, `animate` ([ligne 1959](../apps/world-web/src/scene/village-workers.ts#L1959)) les fait avancer à chaque image. Ce sont des **représentations** : un villageois qui marche ne crédite rien, l'économie est calculée par le serveur.
- **La boucle de rendu** : [`runRenderLoop`](../apps/world-web/src/scene/BabylonVillageScene.ts#L1657) appelle une fonction à chaque image. Elle met à jour la caméra, diffuse le terrain, met à jour les surcouches et les villageois ([`animate`, ligne 1825](../apps/world-web/src/scene/BabylonVillageScene.ts#L1825)), puis dessine : [`this.#scene.render()`, ligne 1842](../apps/world-web/src/scene/BabylonVillageScene.ts#L1842).
- **Les phases mesurées** : pour savoir où part le temps d'une image, la boucle pose des repères `frame?.mark('camera')`, `'streamingStats'`, `'visibility'`, `'terraform'`, `'population'`, `'render'`, `'clouds'`, `'diagnostics'`… (de [ligne 1710](../apps/world-web/src/scene/BabylonVillageScene.ts#L1710) à la 2007). La classe [`FrameTimings`](../apps/world-web/src/dev/statistics.ts#L207) additionne le temps écoulé entre deux repères ; la liste des phases, avec leur libellé, est juste au-dessus dans le même fichier. Pour les voir : active `localStorage['arbestra:dev']='1'`, recharge, ouvre le bouton DEV et l'overlay de statistiques (voir le [guide](GUIDE-DEVELOPPEUR.md) §6). Le budget : aucune image de plus de 100 ms une fois le village prêt, villageois sous 2 ms par image.

Ce qui est exécuté à chaque image doit rester très bon marché : pas de reconstruction d'un chunk ni d'une liste complète dans la boucle. C'est une des règles les plus importantes du dépôt ([AGENTS.md](../AGENTS.md), section Performance).

## 4. Les tests : où ils sont, comment en écrire un

- **Tests unitaires** : à côté du code, nommés `*.test.ts`, lancés par [Vitest](https://vitest.dev) ([`vitest.config.ts`](../vitest.config.ts) : tous les `apps/**/*.test.ts` et `packages/**/*.test.ts`). Exemple court et lisible : [`harvest-cancel.test.ts`](../apps/world-web/src/ui/harvest-cancel.test.ts) ; exemple sur un calcul partagé : [`building-footprint.test.ts`](../packages/contracts/src/building-footprint.test.ts).
- **Tests avec la base** : `*.integration.test.ts`, dans `apps/api/src/modules/...` (par exemple [`sync-v2-wakeups.integration.test.ts`](../apps/api/src/modules/villages/sync-v2-wakeups.integration.test.ts)). Ils parlent à une vraie base PostgreSQL de test, dont le nom doit finir par `_test` (préparation : [CONTRIBUTING.md](../CONTRIBUTING.md#lancer-les-tests)).
- **Tests de navigateur** : [`tests/e2e`](../tests/e2e) (Playwright), lancés par `corepack pnpm test:e2e`.
- **Les composants React** sont testés sans navigateur en produisant leur HTML (`renderToStaticMarkup`), par exemple [`WorldLoading.test.ts`](../apps/world-web/src/ui/WorldLoading.test.ts).

Écrire un test, pas à pas :

1. Trouve la fonction pure à vérifier (les plus faciles sont dans `contracts` ou dans `ui/`). Crée `mon-fichier.test.ts` à côté de `mon-fichier.ts`.
2. Écris le cas comme une phrase : `it('refuse une case hors de portée', () => { expect(...).toBe(...) })`.
3. Construis `contracts` puis lance seulement ton fichier : `corepack pnpm --filter @arbestra/contracts build`, puis `corepack pnpm exec vitest run chemin/du/fichier.test.ts -t 'refuse une case'`.
4. Pour un bug : fais d'abord échouer le test, corrige, constate qu'il passe.

## Pour aller plus loin

- Une commande précise, du début à la fin : cherche son code d'erreur (par exemple `'EXPLOITATION_EMPTY'`), il est unique.
- L'ordre des verrous et les pièges de concurrence : [audit de concurrence](AUDIT-CONCURRENCE-ECONOMIE-2026-10-23.md).
- La synchronisation V2 en détail : [spec](SPEC-COMMANDES-BORNEES-SYNCHRONISATION-CIBLEE.md).
- Le catalogue « où trouver… » : [guide développeur](GUIDE-DEVELOPPEUR.md) §7.
- Des tâches pour débuter : [bons premiers tickets](BONS-PREMIERS-TICKETS.md).

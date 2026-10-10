# Synchronisation village — candidate et contre-recette

11 octobre 2026, branche `main`, base relue `adda2ed0367c6d99bcc98cb60b118c49e26a68a6`. Candidate : commit contenant ce rapport ; son hash exact est communiqué à la livraison. **Implémentée, intégrée et vérifiée techniquement dans le périmètre ci-dessous ; prête pour validation produit de la synchronisation.** Ce verdict ne lève pas les réserves historiques de latence de l'alpha et n'autorise aucune ouverture publique.

## Existant vérifié et changements effectifs

L'existant fournit les commandes HTTP idempotentes, `state()` et les réconciliations serveur, le pipeline App/VillageScene/Babylon et un cache de meshes par signature. Il ne fournit pas encore de flux SSE ou de révision durable ; App peut lancer des lectures du village entier à 500 ms sans garde, avec des snapshots également conservés dans SpawnPlacement. Le diagnostic précédent avait reproduit huit lectures simultanées ; il n'avait pas encore corrigé ce chemin.

La candidate ajoute la migration additive 041, un lecteur cohérent sans écriture économique, le flux SSE et des trames partagées. App conserve sa copie locale et arrête ce polling. Une lecture initiale et un rafraîchissement de secours ne se chevauchent pas avec eux-mêmes. App et SpawnPlacement utilisent réellement `latestVillageSnapshot()` ; HTTP et SSE partagent les règles de révision et `reconcileVillageSnapshot()`. Le renderer existant conserve ses meshes inchangés et sa caméra.

Le [contrat d'architecture](architecture/village-synchronization.md) détaille les tables couvertes, les consommateurs, la jonction et les limites. Aucune règle de portée, de terrassement, de ressources, de coût ou de délai de construction n'est changée.

## Garanties retenues

- Révision = nombre de marqueurs de transactions validées **dans le monde** ; identité du village également obligatoire. Les écritures métier et leur marqueur valident ou s'annulent ensemble. Le comptage couvre les validations concurrentes dans un ordre différent de leur démarrage, sans compteur mondial verrouillé après les gisements.
- Données et révision du snapshot SSE partagent une vue PostgreSQL `REPEATABLE READ`, `READ ONLY`. Le hook HTTP après commit remplace un snapshot dont l'assemblage ou la révision est devenu incertain.
- Chaque abonnement/reprise commence par un snapshot courant cohérent. Le commit entre lecture HTTP et abonnement est récupéré ; un commit pendant la projection sera récupéré au prochain contrôle. Pas de confiance dans Last-Event-ID comme preuve d'application.
- Une trame est appliquée complètement puis validée avant d'exposer ensemble données/révision. Doublon couvert : ignoré. Trou/chevauchement inexploitable : reprise contrôlée sans changement partiel. Réponses HTTP et callbacks SSE d'une ancienne génération sont neutralisés.
- Le marqueur durable est contrôlé toutes les 2 s après le cycle précédent, même si aucune publication ou mutation suivante ne survient. Le délai inclut ensuite les lectures/attentes/projection ; ce n'est pas un SLA de 2 s. Un flux silencieux est remplacé après 30 s ; une erreur réseau reconnecte après 2 s.
- Les échéances et transitions d'énergie continuent de réveiller les réconciliations existantes. Les contrôles sans changement n'assemblent pas de snapshot complet. Un changement économique n'est jamais crédité par une animation.

## Vérifications terminées

Toutes les suites DB ont été exécutées **séquentiellement**, sur des mondes/comptes UUID isolés dans `127.0.0.1/arbestra_test`, sans reset. Les processus ci-dessous ont terminé avec succès ; les fixtures ont leurs nettoyages bornés. La migration 041 a été appliquée à cette base uniquement.

| Vérification | Résultat et portée |
| --- | --- |
| Contrats/client et suites connexes | **37 tests verts**, six fichiers : `packages/contracts/src/village-sync.test.ts`, `apps/world-web/src/api/village-sync.test.ts`, `api/client.test.ts`, `scene/terrain-store.test.ts`, `ui/exploitation-navigation.test.ts`, `scene/camera-focus.test.ts`. Application immuable complète, doublons, collections, trous/chevauchements, mauvaises données, contexte, génération, watchdog, priorité révision/heure et projection temporelle à révision égale. |
| PostgreSQL/Fastify/SSE réel | **10 tests verts**, `apps/api/src/modules/villages/sync.integration.test.ts` : jonction, marqueur et écritures annulés après observation et erreur sentinelle identifiée, commits inversés avec barrière bornée, commit forcé pendant la lecture MVCC, réponse HTTP devenue incertaine, droits, POST construction/idempotence/doublon SSE, échéance/repos sans worker vivant, publication perdue sans mutation suivante. |
| Pose RC1 | Cas `atomically places the compact kit…` vert dans `installation.integration.test.ts` : source signée, pose atomique, dotation unique, pierre naturelle 2 000. Un test joué, neuf explicitement filtrés. |
| Boucle RC1 bois/pierre | Cas `delivers the first wood and stone lots…` vert dans le même fichier : commandes d'extraction réelles, livraisons et effets économiques au retour. Un test joué, neuf filtrés ; pas la campagne spatiale entière. |
| App + Babylon réels, transport contrôlé | `node tests/browser/village-sync.mjs`, frontend local 5279 : un seul GET initial, un seul bâtiment reconstruit à la complétion, mesh HDV inchangé, même canvas/caméra, panneau Population conservé, doublon et callback ancien ignorés, reprise par snapshot sans reconstruction supplémentaire. Aucune erreur JS. |
| Geste d'exploitation, non-régression | `node tests/browser/harvest-gestures.mjs`, même frontend : quatre gestes, zéro commande au survol, aucune requête preview, réception/reprise idempotentes, sélection de catégorie correcte, zéro erreur JS. Scène substituée/API contrôlée ; pas une preuve du picking Babylon. |
| Navigateur RC1 réel | Frontend de recette 5280/API 3103, connexion et reprise de Bressuire, 13 bâtiments/0 chantier. Sonde SSE authentifiée réelle : snapshot R192 → frame R192→197 (10 changements) → contrôle R197 ; un seul GET village relevé, pas de boucle HTTP. Aucune erreur JS relevée. Aucun ordre économique envoyé dans le village utilisateur. La sonde prouve le transport réel ; la recette contrôlée ci-dessus prouve précisément l'application App/Babylon. |
| Compilation/types/lint | Build contrats, build API, typecheck world-web et build Vite world-web isolé `test-results/village-sync-dist` en mode e2e terminés avec succès ; lint racine vert, puis lint ciblé des deux fichiers serveur affinés. Avertissement Vite existant de chunks >500 Ko, sans échec. Pas de build play-web ou de suite globale DB revendiqués. |

Les captures `test-results/village-sync-render.png` et `test-results/village-sync-rc1.png` ont été inspectées. La première conserve le panneau Population et le retour de fin de construction ; la seconde présente le showroom Constructions sur le vrai village. Ce sont des preuves de continuité de présentation, pas une validation de la charte graphique.

Commandes reproductibles (contrats compilés au préalable) :

```powershell
corepack pnpm exec vitest run packages/contracts/src/village-sync.test.ts apps/world-web/src/api/village-sync.test.ts apps/world-web/src/api/client.test.ts apps/world-web/src/scene/terrain-store.test.ts apps/world-web/src/ui/exploitation-navigation.test.ts apps/world-web/src/scene/camera-focus.test.ts
corepack pnpm exec vitest run apps/api/src/modules/villages/sync.integration.test.ts
corepack pnpm exec vitest run apps/api/src/modules/onboarding/installation.integration.test.ts -t 'atomically places the compact kit'
corepack pnpm exec vitest run apps/api/src/modules/onboarding/installation.integration.test.ts -t 'delivers the first wood and stone lots'
node tests/browser/village-sync.mjs
node tests/browser/harvest-gestures.mjs
```

Les tests navigateur utilisent leur transport contrôlé ; `RC1_BROWSER_URL` permet de pointer un frontend local de recette. Les scripts ne doivent pas être confondus avec une mutation d'un village utilisateur.

## Mesures observées

Dernier passage SQL, fixture simple **generationVersion 1, 512 × 256**, quatre chunks plats et petit village, pendant compilation de l'API :

- Snapshot initial sérialisé : **38 051 caractères** ; trame après complétion : **5 437 caractères**, environ sept fois plus petite. Mesure de `JSON.stringify().length`, pas mesure UTF-8/TCP/compression.
- Rattrapage après le commit du handler de worker : **2 282 ms**. Le test décale son curseur initial pour que le fallback d'échéance ne déclenche pas une autre mutation ; la révision finale est exactement celle du commit observé. Il n'appelle aucune publication.
- Handler/transaction et réception ensemble : **20 220 ms**, dont environ 17,9 s avant la mesure post-commit. La contention/charge de ce passage ne prouve aucun gain du temps d'exécution économique. Un passage antérieur moins chargé, avec fallback d'échéance, donnait 786 ms post-commit ; il ne remplace pas la preuve renforcée finale.
- Contrôle de révision seul : 10 lectures, 13 marqueurs, **médiane 3 ms / maximum 5 ms**. Ne comprend pas droits/cohortes ni projection complète et ne qualifie pas le coût sur une longue histoire de monde.
- Recette de rendu : une seule lecture initiale et un seul bâtiment régénéré. Le délai clic → premier pixel d'une construction RC1 réelle n'est pas remesuré dans cette tranche.

## Limites et verdict

Les points demandés de convergence sont couverts dans les preuves ciblées : continuité, reprise, rollback, perte de publication silencieuse, idempotence et application ciblée. **Candidate prête pour validation produit de la synchronisation.**

Restent à qualifier avant déploiement/ouverture : recette LAN sans TLS et proxy SSE de staging/production ; application de la migration 041 dans l'environnement cible ; charge avec plusieurs villages/abonnements et historique conséquent. Les marqueurs sont append-only et leur comptage croît : pas de qualification de long terme ni de purge implicite. Les payloads HTTP de commande sont toujours complets et le coût de projection/calcul RC1 demeure ; cette livraison ne clôture pas à elle seule les blocages historiques de latence/stabilité sous verrou. Tous les panneaux, la sélection d'une entité supprimée et le tactile ne sont pas recettés au navigateur ici.

Les services de recette 5279/5280/3103 et le navigateur dédié sont fermés en clôture. La démo utilisateur 5278/3102 n'est pas remplacée par cette candidate. Bressuire, le parent de fixture session 48641/PID 8212 et ses enfants 3101/5275, la démo 3100/5274 et le dev 5174 sont préservés. Le transcript utilisateur non suivi reste exclu du commit ; captures, logs, scripts locaux et builds sous `test-results/` sont ignorés.

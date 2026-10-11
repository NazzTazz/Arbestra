# Construction : réponses HTTP incrémentales

11 octobre 2026. Base relue : `06a460e31ab5b1ed3817b3bf98a67ac297ab821d`, main. Direction acceptée par Tristan : commencer par la construction et partager les trames SSE. **Implémentée, intégrée et vérifiée techniquement ; prête pour validation produit de cette tranche.** Aucun nouveau choix de gameplay. Ouverture publique non validée par ce travail.

## Périmètre réellement livré

La construction simple/composée, l'extension de jardin et l'amélioration demandées par App reçoivent une trame autoritaire HTTP. La réponse inclut les autres effets économiques reconciliés, puis les changements concurrents visibles dans une même projection cohérente. Snapshot de repli lorsque la base exacte manque ou que la révision n'a pas avancé. Les anciennes commandes sans négociation gardent leur réponse historique ; kit, infrastructure, exploitation, transformation, population et science restent hors de cette première tranche.

L'existant était la copie locale, le contrat `villageFrame/applyVillageFrame`, les marqueurs durables, les reprises et générations de SSE, les UUID de commande, `state()` et le cache Babylon. Les raccords effectifs sont maintenant :

- `finalizeVillageEconomy()` sert `state()` et les quatre services de construction en mode commit ; admissions et transitions à durée zéro restent à H, repos finalisé dans la transaction ;
- `readVillageProjection()`, déplacée dans le service sans réécriture de ses règles, sert SSE, les snapshots HTTP devenus incertains et les nouvelles réponses de construction ;
- `VillageSyncProjections` partage les lectures en vol et les bases exactes entre ces chemins ;
- `villageFrame()` produit SSE et HTTP ; App applique les deux par `applyVillageFrame()`, puis la réconciliation existante conserve les références et meshes inchangés.

Le contrat des en-têtes, l'isolation compte/monde/village, les limites du cache, les bornes `commandTime/serverTime` et le repli sont décrits dans [l'architecture](architecture/village-synchronization.md#réponses-http-de-construction). Aucun SQL de projection complète n'est ajouté à la finalisation sous verrou en mode commit. Le calcul complet existe encore après commit : la tranche ne prétend pas l'avoir éliminé.

## Preuves terminées

La régression « returns a construction frame… » a été exécutée sur l'ancien code avant le raccord : rouge, `kind` absent car VillageState complet. Puis verte sur la candidate.

`corepack pnpm exec vitest run apps/api/src/modules/villages/sync.integration.test.ts` : **17 cas verts**. Jonction, MVCC, commits inversés, notification worker perdue sans mutation suivante, contrôle autoritaire, idempotence historique restent verts. Nouveaux cas : trame depuis GET, HTTP/SSE dans les deux ordres sans double débit, même reçu UUID retransmis, complétion due d'un autre bâtiment incluse, amélioration, extension, base d'heure inconnue et repli cohérent. La fixture d'amélioration a été corrigée pour demander le niveau cible 2 et respecter les coûts de la maison en troncs ; les cellules de mesure/rollback ont été rapprochées pour respecter la portée existante. Ces refus de fixture n'ont entraîné aucune modification de règle.

Le cas de rollback a ensuite été enrichi et **rejoué seul avec succès** : construction de durée zéro en mode commit, bâtiment réellement completed, reçu/occupation/révision observés avant la sentinelle exacte ; comparaison avant/après des villages, ressources/flows, bâtiments, occupations, tâches, reçus, cohortes, parcelles/extensions, accomplissements, buffers, activités/science et provisions. Ce n'est pas une exception métier acceptée comme preuve.

Barrière bornée dans la lecture REPEATABLE READ après commit : occupation réellement persistée ; pendant la suspension de la projection, une transaction indépendante prend le village FOR UPDATE avec lock_timeout 1 s et modifie son nom. La réponse est ensuite libérée, attendue et le serveur fermé. Cela prouve la libération du verrou avant le calcul de réponse, sans attribuer tout le coût HTTP à un verrou.

**23 cas purs/client verts** : `sync-projections.test.ts`, `client.test.ts`, `village-sync.test.ts`, contrats `village-sync.test.ts`. Base exacte isolée par compte/heure, éviction, refus d'une projection restant ancienne, lecture partagée acquise avant commit remplacée, parse HTTP, repli, timeout/retransmission, réponse malformée incertaine et génération capturée avant une reconnexion ; doublons/trous/application atomique des contrats conservés.

Recettes navigateur contrôlées avec **App et Babylon réels** : `tests/browser/construction-http.mjs` et `tests/browser/village-sync.mjs` verts. Geste souris → un POST négocié → copie actualisée → nouveau mesh seul ; HDV/autre maison/canvas/caméra conservés. Doublon SSE ignoré ; trou puis snapshot de reprise et trame suivante appliqués. Une lecture initiale, aucun polling supplémentaire. Les erreurs de fixture visuelle ont été corrigées pour employer l'entrée -z réellement utilisée par le serveur et mesurer après le survol ; elles ne sont pas revendiquées comme défauts produit. Capture `test-results/construction-http-render.png` inspectée, artefact ignoré.

Build contrats/API, typecheck world-web et build Vite e2e isolé terminés avec succès ; lint racine vert, puis lint des derniers fichiers de preuve vert. Avertissements habituels de taille des bundles. Pas de reset DB ni de migration nouvelle : fixtures UUID seulement dans `127.0.0.1/arbestra_test`, nettoyées ; aucune commande économique de l'agent dans Bressuire.

## Mesures et portée

Quatre POST Fastify réels, sur la même fixture chaude v1 plate 512 × 256, alternativement legacy puis incrémental, petites maisons en troncs d'une case. Lecture GET préalable exclue des temps POST ; machine de développement avec serveurs/worker de démo et outils de vérification actifs. Mesure finale de la suite verte :

| Réponse | Temps HTTP Fastify | Octets JSON UTF-8 |
|---|---:|---:|
| snapshot legacy, passage 1 | 609 ms | 51 422 |
| trame, passage 1 | 418 ms | 14 532 |
| snapshot legacy, passage 2 | 450 ms | 53 740 |
| trame, passage 2 | 377 ms | 17 130 |

Le volume est réduit d'environ 70 % sur cette fixture. Les villages grandissent entre les passages ; ces quatre points ne sont pas une qualification de charge ni une mesure TCP/clic → pixel. La compilation concurrente et les premiers passages ont présenté des pointes bien plus longues ; aucun budget froid RC1 ni gain constant n'est établi. Contrôle révision seul dans la suite finale : dix lectures, 12 marqueurs, médiane 3 ms, maximum 4 ms. Rattrapage de publication worker perdue : 1 944 ms après commit, dans ses conditions de test ; pas un plafond SQL.

## Limites et suite

Le serveur assemble encore une projection complète après commit pour produire le diff. La validation spatiale et les admissions peuvent aussi lire le terrain sous verrou. Optimiser ces lectures constitue la tranche suivante, sur profils RC1 ; ne pas inférer d'index ou de budget à partir de la fixture plate. Le cache de bases exactes peut perdre une base : snapshot cohérent explicite plutôt qu'un diff inventé. Le contrat de SSE conserve la reprise après chevauchement et le contrôle durable toutes les 2 s plus coûts de lecture ; aucune publication éphémère n'est nécessaire à la convergence.

Ni parcours LAN/proxy production, ni première construction froide RC1 complète avec diff, ni capacité multi-instance sous charge ne sont qualifiés ici. Les autres commandes HTTP restent à convertir par tranches, en partageant la même finalisation autoritaire. Cette candidate est prête pour validation produit **de la construction incrémentale** ; elle ne lève pas à elle seule les limites alpha de latence signalées dans les rapports précédents.

Démo 5278 actualisée, build client main-BklbayBw et API compilée avec worker. Contrôle navigateur réel par agent-browser : 26 bâtiments, snapshot SSE R1317 puis trames R1318/R1319, une lecture initiale du village, terrain chargé en fin de recette ; capture finale inspectée. Après relance sous charge, le terrain avait affiché une interruption et ses requêtes comportaient des status 0, avant reprise sans correction de code. Cet état transitoire et le rendu chargé restent une limite de performance, pas un critère RC1 devenu satisfait. Lectures seules distinctes : village 200 en 1 237 ms / 167 225 octets (25 bâtiments à ce moment), quatre chunks 200 en 749 ms. Aucun ordre de jeu de l'agent ; les constructions que Tristan continue d'ajouter sont conservées. Navigateurs dédiés et port temporaire 5279 fermés ; API 3102/frontend 5278 restent ouverts.

La référence exacte Git et l'état des services de la démo sont consignés en tête de SESSION-HANDOFF.md et au bilan de livraison. Le transcript utilisateur non suivi reste hors commit.

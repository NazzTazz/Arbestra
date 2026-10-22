# État au 22 octobre 2026

A/B non clôturés ; routes et atelier V2 désormais raccordés côté serveur, transport client autonome testé mais React non raccordé. Migrations 053–056 actives uniquement sur test. Voir la passation courante dans [le handoff détaillé](HANDOFF-AB-REPRISE-COMPTE-2026-10-21.md), qui remplace les statuts historiques ci-dessous. Pause demandée par Tristan pour quota ; aucun déploiement.

---

# Commandes bornées A/B — travail partiel du 21 octobre 2026

Base : `main`, `4966379`. [Spec conservée](SPEC-COMMANDES-BORNEES-SYNCHRONISATION-CIBLEE.md).

**Statut : en cours, non livré.** La demande autorise A puis B, sans déploiement. Les éléments ci-dessous ne clôturent ni A ni B. Aucun chemin de jeu ne négocie V2 ; aucun changement de gameplay ou de transport applicatif n'est activé.

## Inventaire et références A

`tests/fixtures/command-inventory.json` classe les 105 routes réellement enregistrées par Fastify, méthodes et valeurs du discriminant `action` comprises. Le test `command-inventory.integration.test.ts` compare cet inventaire aux routes de l'application, y compris les boucles et préfixes des plugins. Il refuse une route ajoutée sans mise à jour et une route `/api/worlds/…` classée hors périmètre. Cela ne prouve pas encore la classification de toutes les variantes internes sans discriminant `action` (par exemple les deux entrées de démarrage atelier).

`node scripts/audit-command-dependencies.mjs` produit `test-results/command-sync/dependencies.json` : références directes aux lecteurs/écrivains SQL, propriétaires des fonctions, appels aux assembleurs/finaliseurs et templates SQL à relire. Dernier relevé : 193 fichiers, 1 412 références, 346 appels d'écriture. Ce relevé inclut migrations, scripts et workers ; ce n'est **pas** une fermeture transitive certifiée des dépendances par action.

| Famille | Entrées vérifiées | Dépendances restant à borner |
|---|---|---|
| Pose | `construction.ts`, routes `buildings` | Publication privée/spatiale commune V2, conservation du contrat déjà borné |
| Atelier | `commandVillageProcessing`, `commandProcessing`, `processingSnapshot` | Stocks, cohortes, lots et prédécesseurs ; retrait du finaliseur global ; reçu et lecteur par identifiants |
| Population/pools | `commandHudWorkforce`, `population/work.ts` | Synthèses et cohortes effectivement affectées ; ne pas perdre les autres producteurs du flux privé |
| Autres commandes | Catalogue de routes, relevé AST, spec | Lecteurs typés et couverture de publication avant activation du flux privé, même si leurs commandes restent V1 |
| SSE actuel | `VillageSyncSession`, `readVillageProjection` | Nouvelle projection globale à chaque changement, reprise par snapshot ; pas encore de lecteur V2 |
| Workers, installation, factory, administration | Relevé AST et catalogue transversal de la spec | Correspondance exhaustive tables/composants/flux et tests des écritures non issues de commandes |

## Mesures initiales locales

Cible exclusive : `127.0.0.1/arbestra_test`. Fixtures dans des mondes jetables, nettoyées après le test ; aucune remise à zéro du développement. Windows, Intel i7-1065G7, quatre cœurs/huit threads. Autres processus de développement présents et builds/checks locaux pendant certaines séries : les latences ne constituent pas une mesure isolée du VPS.

Le harness existant accepte désormais `ARBESTRA_AUDIT_REPEATED=1`, `ARBESTRA_AUDIT_SCALE=1|10|100`, `ARBESTRA_AUDIT_BACKLOG=1` et `ARBESTRA_AUDIT_LABEL`. Chaque série comprend un échauffement puis trente répétitions. La branche sans retard démarre un ordre sans intrants puis pause/reprise/annulation et leurs rejeux exacts. Les UUID sont distincts ; l'historique des ordres terminaux croît jusqu'à la limite existante de vingt éléments. Les trois tailles contiennent 3/30/300 bâtiments, mais seulement trois sont placés : elles éprouvent la collection et le logement, **pas** un grand village spatial représentatif. La population initiale est trente habitants.

| Variante | Bâtiments | SQL médian | HTTP brut médian | Médiane / p95 ms |
|---|---:|---:|---:|---:|
| Pause sans intrant | 3 | 81 | 64 989 | 129 / 327 |
| Pause sans intrant | 30 | 81 | 67 258 | 277 / 453 |
| Pause sans intrant | 300 | 81 | 89 940 | 155 / 476 |
| Rejeu pause | 3 | 78 | 64 989 | 127 / 326 |
| Reprise sans intrant | 3 | 93 | 65 001 | 163 / 385 |
| Annulation sans lot engagé | 3 | 81 | 65 014 | 130 / 311 |
| Pause, deux lots échus | 3 | 121 | 65 185 | 224 / 439 |

La projection de synchronisation consécutive à une pause coûte 49 appels SQL et environ 2 413 octets de données SSE dans les trois tailles. Médianes/p95 : 81/188, 162/295 et 89/296 ms. **Cette mesure utilise `VillageSyncSession` et le lecteur de bas niveau sans exécuteur de navigation ; elle exclut le passage CPU par le pool, la boucle socket, la réauthentification et le réveil d'échéances du handler SSE.** Elle ne certifie pas son coût réseau complet. Le même compteur SQL n'implique pas le même travail interne ni un coût constant.

Le retard est préparé explicitement par le noyau atelier à une borne historique sous verrou du village : six lots demandés, deux payables, trente minutes de retard. La pause HTTP rattrape les deux lots, livre 40 unités et laisse l'ordre en pause sans lot courant. Les assertions vérifient le résultat métier ; le rejeu est également mesuré. Le worker économique n'est pas lancé par ce harness.

Les artefacts `test-results/server-costs/bounded-baseline-{small,medium,large,backlog}.json` contiennent les requêtes sans paramètres, temps, octets, estimation gzip hors réseau et phases disponibles. `scripts/summarize-command-costs.mjs` calcule médiane/p95/max par variante. L'estimation gzip ne prétend pas mesurer une compression négociée. Lignes examinées, attente/durée de verrou des commandes, CPU isolé, mémoire, charge concurrente et endurance ne sont pas certifiés.

Le parcours Playwright atelier collecte désormais les octets HTTP transmis (`encodedDataLength`), les octets des données SSE et l'en-tête de protocole réellement envoyé. Il vérifie l'absence de GET village après les deux actions. Aucun jeton, cookie ou contenu métier n'est conservé dans l'attachement. Première passe ordinateur : **1/1, code 0**, production/pause/crédit unique vérifiés, capture relue.

Les reprises ont révélé deux problèmes de test : une erreur de détachement CDP après timeout pouvait empêcher la fermeture DB ; le message Oracle affiché après 90 secondes interceptait le bouton « 1 h » sur les démarrages lents. La dernière trace prouve cette interception, pas un échec de la commande atelier (aucun POST atelier envoyé). Nettoyage corrigé pour toujours fermer la DB ; le test ferme désormais l'Oracle avec « Masquer » avant le clic normal, borné à dix secondes. Délai global 300 secondes pour la fixture et le rendu froid. Aucun clic forcé ni changement du jeu. Artefacts rouges conservés dans `browser-timeout` et `browser-oracle-overlay` sous `test-results/command-sync`.

Une reprise intermédiaire n'a pas démarré : esbuild refusait un accès de fichier au chargement de Vite dans le bac à sable. Son seul serveur API de test a été identifié et nettoyé, puis le démarrage hors bac à sable a réussi. La fermeture ponctuelle de l'Oracle a ensuite révélé une course visibilité/clic ; le test utilise maintenant `addLocatorHandler` pour actionner « Masquer » lorsque le panneau apparaît pendant les contrôles d'interaction.

**Dernière recette ordinateur : 1/1, code 0**, en 2,8 minutes, `browser-complete.log`. Fichier `test-results/e2e/material-processing-le-tai-c5d73-forme-un-lot-après-sa-pause-chromium/atelier-network.json` conservé. Deux POST atelier sans en-tête de négociation : **125 653 et 125 661 octets HTTP transmis**, durées réseau observées **7 627 et 1 410 ms**. Ouverture SSE : snapshot de **124 722 octets** ; trames suivantes de **1 961, 1 183, 1 183 et 1 613 octets de données**. Aucun GET village après les commandes ; pause et crédit unique de 20 pierres taillées vérifiés. Ce parcours unique sur fixture complète et machine chargée n'est pas un p95 ni une mesure de latence serveur isolée. Le parcours mobile conserve son exclusion existante et n'est pas certifié.

## Fondations B isolées

`packages/contracts/src/sync-v2.ts` est un module expérimental non raccordé. Il ne couvre que stocks et ordres atelier, et refuse les autres flux. Les applications pures testées distinguent effets superposés et curseur complet, comparent les révisions avec `bigint`, refusent trous/epochs inconnues/doublons de clés/lots invalides, conservent les tombstones et ignorent les anciennes générations. Ces tests ne sont pas des tests d'ACK HTTP ou de transport SSE V2 réels.

`051_game_sync_foundation.ts` n'est **pas enregistrée dans `migrate.ts`**. Les tests l'installent dans un schéma jetable de la base de test puis détruisent ce seul schéma. Elle propose compteurs, journal, touches transactionnelles et publication terminale canonique. Les tables de publication n'ont aucune FK vers les tables métier. Un savepoint annule les touches SQL ; un oubli de publication refuse le commit ; une touche après publication est refusée. Les dépendances du batch sont internes : elles ne doivent jamais être exposées sans filtrage d'autorisation.

Aucun trigger métier, backfill, activation, lecteur ciblé, rétention, endpoint de reprise ou raccord React n'est encore installé. Aucun flux privé ne peut être déclaré complet à partir de ces deux composants. Le modèle de publication doit encore être intégré à tous ses écrivains et aux reçus avant toute activation.

## Vérifications et suite obligatoire

- Passe finale `vitest run` sur inventaire, contrats V2 et journal : **13/13**, code 0. Le journal couvre six cas, dont attente PostgreSQL effectivement observée et commits inversés de flux indépendants.
- Builds contrats et API terminés avec code 0. Le premier build API a signalé deux défauts de typage du test d'inventaire, corrigés avant la reprise verte.
- Lint ciblé terminé avec code 0 ; deux imports Node manquants dans les scripts ont été corrigés.
- Séries de coûts : trente répétitions mesurées par variante, pas une mesure V2. Logs et résultats dans `test-results/command-sync` et `test-results/server-costs`.
- Les premières assertions de contrats ont échoué sur une fixture incomplète et le registre de formats non installé ; la passe finale ci-dessus inclut les corrections.

Reste à faire pour A : matrice transitive par variante, couverture des variantes internes, oracle historique explicitement isolé pour les comparaisons V1/V2, coût complet de la synchronisation, fixtures spatiales représentatives et variantes restantes. Pour B : couverture des écrivains et lecteurs de tous les composants du flux privé, reprise durable et autorisations multi-flux, ateliers bornés, reçus, pose raccordée au même contrat, client réel, SSE ciblé, preuves de parité/concurrence et mesures finales. Aucun de ces travaux n'est remplacé par les fondations isolées.

État Git : changements non commités, non poussés. Spec et modifications documentaires préexistantes conservées ; artefacts personnels non suivis intacts. Aucun déploiement et aucune migration appliquée au développement.

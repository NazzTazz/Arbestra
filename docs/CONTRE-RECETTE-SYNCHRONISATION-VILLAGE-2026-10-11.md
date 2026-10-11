# Synchronisation village — candidate et contre-recette

## Réactivité Voirie — complément actuel du 11 octobre

Base eb6c4506bedc5568eafe00c92bb9ff7cd18b931e. Implémenté/intégré ; validation interactive encore à Tristan. Les anciennes limites « assemblage complet avant validation Voirie » ci-dessous sont levées pour les routes et leur annulation sans équipement déplacé. Les autres opérations gardent leur contexte complet. La projection HTTP/SSE après commit reste complète et potentiellement coûteuse.

Chemins effectivement partagés :

- createInfrastructureEditContext/prepareInfrastructureEdit : baseline spatiale HUD, raster final transmis à Babylon et validation API, capture automatique et historique des largeurs ; aucun second propriétaire d’état village.
- flatRoadGeometry : aperçu et chemins terre/gravats confirmés ; sommets communs et seulement parois exposées. InfrastructureRenderer : caches par matériau/repère/hauteurs, trottoirs et pavage issus des mêmes helpers, invalidation sur leurs lectures effectives. Meshes inchangés conservés lors d’un ajout ailleurs ou d’une révision non géométrique.
- readVillageOccupancies/groupVillageOccupancies : snapshot complet et readInfrastructureSpatialState. Même terrain, emprises, accès, navigation et stocks projetés à H. Prévisualisation read-only et commande autoritaire revalident les données courantes ; géographie immuable préchauffée avant verrou village. Pas de cache des droits, stocks ou occupations.
- TravelNetworkState : données géométriques utiles au moteur existant ; destinations identiques à froid/chaud, sans objets économiques supplémentaires dans le DTO.

Preuves terminées dans cette tranche : cas contexte partagé/périmé et concordance complète aux coutures/largeurs/croisements ; trois régressions navigation connexes ; DTO de destination froid/chaud. Sept cas renderer verts, puis trois cas ciblés rejoués après cache final : reconstruction du seul matériau changé, conservation des pavés/trottoirs par identité, modification de relief locale et parois externes au coin torique. Une ancienne attente renderer obsolète a été confrontée au HEAD initial avant correction (joint périphérique : largeur 2,4890625 et sommet +0,064). Cinq tests DB de sync.integration.test.ts verts : devis pendant verrou village acquis, HTTP après commit + SSE/retry/undo, rollback observé avec erreur identifiée, commandes valides mesurées et concordance contexte léger/complet sans lectures science/cohortes/chantiers/marché/catalogue. Fixture UUID isolée dans 127.0.0.1/arbestra_test, aucun reset ; timing rejoué séparément. Lecture réelle Bressuire en même vue et même H : 67 cellules occupées, 33 bâtiments et accès, 34 trajets/1 035 points, deux parcelles groupées ; plans, prix et surfaces concordants pour capture nouvelle/existante et coutures X/Y/coin. Aucun ordre Voirie envoyé dans ce village. Golden de 40 variantes sur snapshot conservé : nouveaux résultats identiques à l’ancien préparateur. Build contrats/API/world-web, types API/client et lint ciblé verts ; pas de tests navigateur agent ou de suite globale.

| Mesure actuelle | Conditions et résultat |
| --- | --- |
| Préparation au pointeur | Même snapshot conservé, 19 voies manuelles/18 héritées, 438 cellules, 11 068 pixels, 40 positions. Médiane 108,6 → 22,8 ms ; p95 optimisée 47,7 ms. |
| Aperçu rendu | NullEngine, même snapshot et terrain constant : médiane 52,8 → 8,2 ms, p95 optimisée 23,8 ms. Ne mesure pas le GPU ni la fluidité du navigateur. |
| Réseau confirmé | Base : 9 meshes/162 570 sommets avant, 6 meshes/63 255 sommets après. Trois vrais ajouts de voies terre après dernier cache : 4 192 ms à froid, 722 puis 517 ms, 6 meshes/63 602 à 64 296 sommets. Charge locale variable ; le froid reste perceptible. Les temps 143/82 ms d’essais de révision sans changement géométrique ne représentent pas une nouvelle pose. |
| Devis direct Bressuire | Ancien chemin : 63 requêtes, 1 884/1 074 ms ; nouveau : froid 15 requêtes/2 714 ms, puis 14 requêtes/709/422/334 ms. Même voie refusée pour équipement, aucune écriture ; charge et état courant variables, pas de ratio garanti. |
| HTTP démo actualisée | Après relance finale API 3102 : lecture 2 793 ms, 198 377 octets, R3605/20 voies ; devis refusés 313/249 ms, 153 octets. Le snapshot peut être préchauffé par le flux utilisateur déjà ouvert. Mesure précédente pendant compilations : lecture 6 032 ms, devis 989/1 255 ms. Aucune pose réelle RC1 chronométrée. |
| Commandes valides | Fixture v1 plate 512 × 256, quatre voies courtes distinctes, legacy/frame alternés : 11 545/5 762 ms à froid puis 525/524 ms ; ~40 Ko legacy et 2 523–2 655 octets frame, devis 92–111 ms. Froid/réconciliation/projection et charge non contrôlée : réserve restante, pas un temps garanti pour Bressuire. |

Limites actuelles : projection complète postcommit et premier calcul froid encore lents ; pas de mesure GPU ni de confirmation visuelle manuelle par l’agent, conformément au partage interactif demandé. Les commandes, devis autoritaires et stocks ne sont pas rendus optimistes pour masquer ce coût. Aucun changement produit ou migration. Candidate vérifiable techniquement ; validation de la réactivité réelle à Tristan.

---

Extension Voirie du 11 octobre, base 9b325703729dafd4057acecf8ac5403206b20d92 : implémentée et intégrée, validation interactive par Tristan. Même négociation HTTP que les constructions, même projection exacte de base, mêmes trames HTTP/SSE et reprise par snapshot. UUID/session/reçu/devis/undo conservés. Le finaliseur partagé villageCommandResult termine les écritures avant commit ; projection de réponse ensuite hors verrou village. Les devis utilisent withVillageProjection (REPEATABLE READ READ ONLY), sans réconciliation ni verrou économique. prepareInfrastructureEdit fournit la surface finale réellement retenue au renderer et à la validation serveur, y compris le cas sans effet.

Profil des lectures Bressuire : boucle N+1 dans readWorksites, avec relecture de chaque mission et de son gisement. Lectures groupées en trois requêtes indépendamment du nombre de chantiers (32 maximum), missions actives projetées par readExtractions ; extractionProjection sert également la lecture individuelle. Aucun cache économique. Monde/village explicitement filtrés, cibles dans l’ordre ordinal, chantiers dans l’ordre historique. state utilise aussi readExtractions pour les missions actives.

Preuves ciblées terminées : quatre cas DB Voirie (devis pendant verrou acquis sans écriture due, réponse après commit/verrou libéré + doublons HTTP/SSE/retry/undo, rollback exact après plan/débit/reçu/révision observés, mesures de commandes valides). Un cinquième cas DB, rejoué séparément, prouve trois lectures pour six chantiers, concordance avec la mission individuelle, ordre des cibles, absence de fuite vers un autre village et rollback de fixture. UUID privés, aucun reset de la base partagée. Trois cas purs client/contrat et un cas capture automatique/surface sans effet verts. Build contrats/API, typecheck world-web et lint ciblé ; pas de campagne navigateur agent conformément au mode interactif demandé.

Mesures finales, petit monde isolé v1 plat 512 × 256 : commandes legacy 3163 puis 328 ms / environ 40 Ko ; incrémentales 1815 puis 274 ms / 2523–2655 octets. Devis valides 92–117 ms. Chaque commande ajoute une voie courte distincte, alternance legacy/frame ; mesures locales sous charge variable, pas un benchmark statistique. Réduction de transport proche de 94 %, ne prouve pas une pose Bressuire à 274 ms. Profil direct Bressuire, même voie existante refusée par équipement : avant regroupement 1653/1561 ms et 81 requêtes ; après 677/791 ms et 63 requêtes. Profil CPU activé avant, charge non contrôlée : gain observé, ratio exact non garanti. Aucune commande Voirie envoyée sur Bressuire par l’agent. Contrôle HTTP final sur API actualisée 3102 : première lecture après redémarrage 23070 ms, suivante 2117 ms, 196773 octets ; devis refusés 1051/547 puis 815/1157 ms (14 voies, révisions différentes dues à la vie du village). Aucun temps de pose RC1 déduit de ces lectures.

Limites : base absente/périmée ou révision inchangée = snapshot de repli voulu. Assemblage complet avant validation de commande encore présent sous verrou ; devis encore projection complète en lecture seule. Le froid vérifie l’artefact RC1 et construit les routes fines, coût restant de plusieurs secondes. La réactivité sur le vrai village et le rendu du traceur restent à valider manuellement. Pas de nouvelle migration ni changement de gameplay.

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

Les services de recette 5279/5280/3103 et le navigateur dédié sont fermés en clôture. À la livraison initiale de la candidate, la démo utilisateur 5278/3102 n'avait pas encore été remplacée ; la mise à jour demandée ensuite est décrite ci-dessous. Bressuire, le parent de fixture session 48641/PID 8212 et ses enfants 3101/5275, la démo 3100/5274 et le dev 5174 sont préservés. Le transcript utilisateur non suivi reste exclu du commit ; captures, logs, scripts locaux et builds sous `test-results/` sont ignorés.

## Mise à jour de la démo à la demande de Tristan

La démo 5278 sert désormais le client compilé de `d982f3db29cc2d2e5cf49fa7a4107268e1f49d4e` depuis `test-results/village-sync-dist`, avec API 3102 relancée sur le build courant et son worker. Migration 041 déjà présente dans sa base `127.0.0.1/arbestra_test`, vérifiée avant relance ; aucun reset, seed ou migration supplémentaire. Le parent de fixture et ses enfants sont restés ouverts.

Vérification navigateur sur cette adresse réelle : le EventSource ouvert par App reçoit un snapshot R906, une trame R907, un contrôle R907 puis une trame R908, avec un seul GET village et aucune erreur JS relevée. Le rendu comporte 13 bâtiments ; lecture SQL préalable : 14 lignes bâtiment persistantes du village. L'agent s'est connecté sans envoyer d'ordre économique. Cette preuve confirme l'intégration des builds à la démo existante ; elle ne remplace pas une recette LAN/production ou une validation produit.

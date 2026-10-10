# Handoff Sol → Astra — lenteurs de la carte de spawn RC1

Date / agent : 9 octobre 2026 / Sol, pour Astra, à la demande de Tristan.
Base relue : `main`, HEAD `06837b9`, worktree d'implémentation non committé.
Statut : **implémentation en cours ; fluidité non acquise**. Cette passation est documentaire : aucun nouveau profilage ni test applicatif exécuté pour la rédiger.

Lire [AGENTS.md](../AGENTS.md), la tête de [SESSION-HANDOFF.md](../SESSION-HANDOFF.md), la [spec courante](SPEC-CARTE-SPAWN-RC1.md), puis [l'état réel d'implémentation](IMPLEMENTATION-CARTE-SPAWN-RC1.md). Architecture concernée : [génération de monde](architecture/world-generation.md).

## Résultat attendu et périmètre de reprise

Le joueur explore la carte, choisit le point de son hôtel de ville et l'orientation du kit, puis ajuste son projet avec le disque de diagnostic. **Ne pas rechercher une ancre éligible ou une orientation à sa place.** La spec a été corrigée sur ce point ; le code n'implémente pas de recherche d'autre emplacement du village.

Le calcul automatique existant concerne les accès et le placement des seuls compléments de ressources autour du projet choisi : quatre gisements, et deux bosquets si nécessaire. Il est encore interne et en lecture seule. La priorité de reprise est de comprendre et réduire les lenteurs de ce parcours précis, sans étendre son architecture ou modifier la géographie pour accélérer un contrôle.

La carte `/spawn-map?world=<slug>` n'est pas raccordée au lobby. « Choisir cet emplacement » reste désactivé. Préparation locale, kit transparent, pose HDV, corrections locales persistantes et création atomique de la dotation restent à implémenter. La projection économique naturelle RC1 manque : `resource-check` teste conservativement les deux bosquets, annonce `naturalProjection: 'pending'`, et n'émet pas de pauvreté depuis les arbres/rochers décoratifs. `readiness: 'terrain-only'` n'autorise aucun spawn.

## Mesures réellement obtenues

Les mesures viennent des passes d'implémentation précédant ce handoff. Chrome installé, headless, backend D3D11 ; desktop 1440 × 1000, puis contexte tactile séparé. Windows local, API et Vite de recette. Des builds/types/lint ont parfois tourné en parallèle : **ces essais ne constituent pas une comparaison contrôlée à froid/à chaud**. Aucun percentile de latence du parcours n'a été établi.

| Essai | Rendu prêt après rechargement | Géométrie dans le worker | Diagnostic worker rapporté | Contrôle terrain/dotation | Résultat et portée |
|---|---:|---:|---:|---:|---|
| Première passe, terrain seul | 24 788 ms | 12 081,5 ms | 3 844,1 ms | Non mesuré | Recette carte passée |
| Autre mesure de cette passe | 33 079 ms | 17 154,9 ms | 3 121,8 ms | Non mesuré | Recette carte passée |
| Reprise avant optimisation finale des rochers | 64 105 ms | Non consigné | Non consigné | >60 s | Essai arrêté sur le contrôle serveur, aucune erreur JS rapportée |
| Reprise après optimisation rocheuse | 63 997 ms | 32 718,6 ms | 1 969,8 ms | 43 888 ms | Contrôle passé ; recette arrêtée au clic de coin, ensuite corrigée côté coordonnées de recette |
| Recette complète suivante | 44 136 ms | 24 737 ms | 859,9 ms | 44 280 ms | Carte, contrôle, coin, tactile passés ; zéro erreur JS |
| Après finition de navigation | 25 171 ms | Non consigné | Non consigné | >60 s | Nouvel arrêt sur le contrôle ; n'a pas atteint la régression de caméra |
| Dernière recette, `--navigation-only` | 25 039 ms | 8 616,7 ms | 579,1 ms | **Non exécuté** | Navigation corrigée, coin, tactile passés ; zéro erreur JS |

Le contrôle API réel sur le projet `(140,20)`, orientation `0`, a aussi pris environ 102 s au début, puis environ 22 s après premières optimisations, et **90 809 ms** dans un test ciblé sous vérifications concurrentes. Ne pas transformer ces valeurs en promesse de gain. Le passage d'un essai complet n'efface pas les timeouts suivants.

`readyMs` mesure le rechargement jusqu'à `[data-render-status=ready]`, pas le seul GPU. `geographyMs` mesure `buildWorldGeometry()` dans le worker, pas le transfert ni toute la création de scène. `diagnosticMs` est actuellement un attribut partagé : il est écrit pour les messages disque **ou sélection**, même lorsque leur résultat est périmé. Ce n'est donc ni un p95 du disque ni la durée souris → image. `resourcePreflightMs` mesure clic → assertions visibles, pas le seul calcul serveur.

### Profilage CPU isolé, avant précalcul des rochers

Un script Node éphémère a reconstruit le calcul du projet `(140,20)`, orientation `0`, hors HTTP/SQL et sans protections privées. Il n'est pas un benchmark enregistré dans le dépôt. Sortie observée :

| Compteur | Valeur |
|---|---:|
| Durée totale | 30 243 ms |
| Appels au champ de passage dans le réseau | 57 318 |
| Sampling géographique de ces appels | 5 530 ms |
| Collisions rocheuses de ces appels | 13 037 ms |
| Préparation des candidats de dotation | 5 633 ms |
| Placement combinatoire des compléments | 1 254 ms |
| Routes explorées / candidats retenus | 1 024 / 973 |
| Essais du planificateur final | 9 ; plan complet trouvé |

Cette mesure situe un coût important dans la qualification de nombreux points et candidats. Elle ne permet pas d'attribuer la totalité des 44–90 s HTTP au placement combinatoire, ni de désigner PostgreSQL comme goulot. Les compteurs sampling/collisions concernent ici le réseau ; les sondes de préparation des candidats sont dans son temps propre.

## Optimisations et corrections déjà faites

- T1 : bruit de facettes identique réutilisé à l'intérieur d'un sample, segments à contribution nulle ignorés. Dix hauteurs gardées en régression ; comparaison exacte avec `06837b9` sur 512 points.
- Géologie : cache des hauteurs de la grille d'analyse et réutilisation du sample topographique déjà calculé. Comparaison JSON exacte de 512 samples géographiques complets avant/après. Aucun changement recherché du relief.
- Champ spawn : paramètres fixes des 177 rochers précalculés ; même test de séparation, rejet d'abord sur Y. Résultats identiques sur 6 928 surfaces, incluant alentours des rochers et coutures. Micro-mesure de 2 000 collisions : 291 ms avant, 69 ms après ; gain local, pas budget UX atteint.
- Dotation : exploration arrêtée dès qu'un placement complet existe ; candidats préparés progressivement, tentative de placement tous les 512 nœuds lorsque le front dépasse 20 cases. Types les plus contraints traités en premier, permutations des deux compléments identiques évitées. Ce sont des positions de ressources, pas des ancres de village.
- Client : maillage et diagnostics dans un worker, dernière demande en attente par canal, réponses périmées ignorées pour l'état, temporisation du disque de 120 ms. Le même point ne relance plus son diagnostic lorsqu'une référence React change. La scène entière n'est pas reconstruite au survol.
- Rendu : attente du shader du terrain visible plutôt que de toutes les instances décoratives inactives pour déclarer la carte prête.
- Navigation : `ArcRotateCamera.setTarget()` reconstruisait angle et rayon au glissement. Reproduction isolée avant correction : `beta` 0,001 → 0,2058 rad, rayon 140 → 143,018. Glisser/zoom/retour global préservent maintenant la vue à plat ; recette spécifique passée. Conserver cette correction pendant l'optimisation.

## Chemins à lire et pistes restant à confirmer

| Chemin / fonction | Lecture du code actuel | Diagnostic à poursuivre |
|---|---|---|
| [spawn-resources.ts API](../apps/api/src/modules/onboarding/spawn-resources.ts), `inspectSpawnResources()` | Lecture repeatable-read, champ immuable réutilisé, calcul numérique synchrone dans la transaction | Chronométrer séparément lectures/signature, protections, terrain, réseau, candidats et placement ; distinguer calcul et attente |
| [spawn-map.ts API](../apps/api/src/modules/onboarding/spawn-map.ts), `readSpawnMap()` | L'artefact est lu et son checksum canonique recalculé à chaque contrôle | Mesurer décodage/hash/payload avant de proposer un cache ; ne pas perdre la vérification d'identité |
| [spawn-state.ts](../apps/api/src/modules/onboarding/spawn-state.ts), `spawnSpatialState()` | Protections de toutes les occupations/missions concernées dans le monde courant | Mesurer nombre de lignes, volume et SQL ; aucune preuve actuelle d'un problème DB |
| [spawn-access.ts](../packages/contracts/src/spawn-access.ts), `buildSpawnAccessNetwork()` / `canWalkSpawnSegment()` | Graphe cardinal ; passage sondé sur trois lignes au pas ≤1/8 ; chemins témoins copiés ; cache d'arêtes par appel | Compter sondes uniques/répétées, allocations de chemins et coût des champs/indices ; comparer même projet et même état |
| [spawn-map.ts contrats](../packages/contracts/src/spawn-map.ts), `createSpawnTerrainField()` | Cache des samples par coordonnées ; **effacement complet à 100 000 entrées** ; tous les rochers encore parcourus par `some()` | Compter hits/misses/effacements et coût post-optimisation. Thrashing ou besoin d'index rocheux restent des hypothèses |
| [spawn-resources.ts contrats](../packages/contracts/src/spawn-resources.ts), `planSpawnResources()` | Filtrage des candidats contre les emprises, calcul des passages, recherche bornée | Mesurer avant nouvelle optimisation ; le dernier profil isolé trouvait un plan en 9 essais |
| `candidate()` dans le module API | Surface sèche sondée au 1/8 et parcours `forest.trees.some()` pour chaque candidat | Mesurer sondes/scan forêt/allocations et les rejets ; envisager une indexation seulement si le coût est confirmé |
| [terrain-worker.ts](../apps/world-web/src/spawn-map/terrain-worker.ts) / [world-geography-mesh.ts](../apps/world-web/src/world-generator/world-geography-mesh.ts) | Maillage construit à l'initialisation ; buffers en tableaux JS ordinaires, `postMessage()` sans liste de transfert | Mesurer nombre/octets, génération, copie et arrivée React séparément. Le worker déplace le coût ; il ne le supprime pas |
| [SpawnMap.tsx](../apps/world-web/src/spawn-map/SpawnMap.tsx) | Canaux disque/sélection, séquences, debounce 120 ms, annulation HTTP côté navigateur | Mesurer souris → résultat courant → premier rendu ; qualifier les demandes qui s'accumulent pendant un calcul synchrone |
| [PreviewScene.tsx](../apps/world-web/src/world-generator/PreviewScene.tsx), `updateMapOverlay()` / `overlayPosition()` | Overlay recréé lorsqu'il change ; sampling géographique sur le thread UI pour le draper ; cache effacé au-delà de 50 000 points | Mesurer ce coût et les longues frames. Les durées worker ne prouvent pas que le survol reste fluide |

**Inférences à vérifier :** le calcul synchrone dans Fastify peut retarder les autres requêtes et continuer malgré l'abandon client. Dans le worker, remplacer les demandes en attente ne préempte pas le calcul en cours. La charge parallèle, les allocations et le GC peuvent expliquer une part de la variabilité. Aucun de ces points n'a encore son profil contrôlé ; ne pas annoncer une cause unique.

## Première tranche recommandée à Astra

1. Établir une mesure reproductible sur le point `(140,20)`, orientation `0`, même copie et mêmes protections : sans builds/tests simultanés, premier appel puis répétitions, temps total et phases/compteurs. Faire la même séparation pour chargement et disque, sans confondre les canaux.
2. Identifier le coût dominant **après les optimisations actuelles**, puis corriger ce coût dans les modules concernés. Vérifier l'équivalence des résultats et comparer dans les mêmes conditions. Pas de changement de résolution, de pente ou de bande d'altitude présenté comme optimisation technique.
3. Recetter le contrôle complet et le mouvement continu du curseur, puis la navigation/tactile. Rapporter médiane, dispersion et pire cas observé, conditions et limites. Les 60 s d'attente Playwright sont une limite de recette, **pas un objectif UX** ; augmenter le timeout ne corrige pas le parcours.

Aucun budget chiffré d'acceptation UX n'a été validé par Tristan. La latence actuelle reste manifestement trop longue. Proposer un budget après mesure, sans prétendre qu'il constitue déjà une décision produit.

## Invariants à conserver

- Source approuvée : `apps/world-web/public/studies/t1-alpha512-rc1.json`, 512 × 256, seed 4109. SHA256 octets `de165c395c26eb70572a4370d9a537661e9eaf78b477e1694cfda283418702a4`. Checksum canonique JSON distinct `5e80042349e495c504900531c189bac1912795f65e739aee09f95bdcf452a9f0`. Aucun monde opérationnel ouvert, garde v3 conservé.
- Le joueur choisit point/orientation. Disque descriptif de rayon 30 ; rouge hors des emprises ne refuse pas le projet. Terrassement ±1 niveau = ±0,25 case autour de l'altitude initiale HDV, limité aux emprises réellement posées. Tristan évoque un élargissement éventuel, **aucun nouveau seuil choisi**.
- Accès piétons distincts : sol sec, pente ≤0,25 verticale par case parcourue, contrôlée entre les points. `canTraverseLandscape()` historique n'a pas été changé. Résolution finie/profil rocheux conservateur encore à certifier avant autorité de pose.
- Pierre 150/150/2 000/2 000 ; minis à séparation bord/kit ≥10 et trajet ≤20 ; gros trajet >20 et ≤40. Bois conditionnel, deux bosquets de 1 500 à trajet <15. Référence du kit manuel complet conservée. Aucune réduction de dotation ou extension silencieuse des distances.
- Réseau borné à 4 000 nœuds, portée des centres 40,5625 puis accès extérieur au dépôt à 1/16 du bord ; placement limité à 10 000 essais **par appel au planificateur**. Les bornes métier s'appliquent à l'accès réel. Calcul incomplet ≠ absence de place ; pas de plan partiel ni de faux refus définitif.
- Caches seulement géographiques immuables ; occupations/réservations/missions relues par `world_id`. Ne pas exporter les protections opérationnelles des voisins au navigateur. Cette solution privée remplace une proposition de payload rejetée par la revue automatique.

## Reproduction, preuves et état Git

Les commandes ci-dessous sont pour la reprise ; **elles n'ont pas été relancées lors de la rédaction**. Les preuves précédentes : 37 cas ciblés +22 connexes passés ; après dernière optimisation rocheuse, les 31 cas contrats/UI ciblés repassent. Types/lint racine et build racine/World passés avant finition de navigation, puis types World/lint affectés et recette Vite de navigation revérifiés. Le résultat navigateur complet et celui de navigation seule sont distingués dans la table.

```powershell
corepack pnpm --filter @arbestra/contracts build
corepack pnpm exec vitest run apps/api/src/modules/onboarding/spawn-map.integration.test.ts -t 'preflights actual'
corepack pnpm exec vitest run packages/contracts/src/spawn-map.test.ts packages/contracts/src/spawn-access.test.ts packages/contracts/src/spawn-resources.test.ts apps/world-web/src/spawn-map/periodic-lines.test.ts
```

Selon le code modifié, connexes : `world-geography.test.ts`, `world-geology.test.ts`, `terrain-study.test.ts`, `terrain-study-variation.test.ts`, `travel-paths.test.ts` dans `packages/contracts/src`.

Recette réelle, dans deux terminaux à la racine :

```powershell
# Terminal 1 : crée une nouvelle fixture isolée et affiche son URL/e-mail.
node --import tsx tests/browser/spawn-map-fixture.mjs

# Terminal 2 : reprendre l'URL et l'e-mail de CETTE fixture.
$env:SPAWN_MAP_URL = '<URL affichée>'
$env:SPAWN_MAP_EMAIL = '<e-mail affiché>'
node tests/browser/spawn-map.mjs

# Validation indépendante de la navigation ; ne teste pas resource-check.
node tests/browser/spawn-map.mjs --navigation-only
```

Les scripts refusent une autre origine/fixture et la fixture DB exige `127.0.0.1/arbestra_test`. Ports 3100/5274 libres requis. Ne pas lancer de reset DB ou utiliser la base de développement. Contrats compilés **avant** de démarrer l'API ; redémarrer la fixture après changement de leurs exports compilés. Ne pas exécuter les recettes DB concurrentes. Une entrée stdin/Ctrl+C dans le terminal 1 déclenche le nettoyage de son propre monde et de ses deux comptes ; attendre le code final. La fixture libère désormais stdin après nettoyage.

Les anciennes fixtures et navigateurs dédiés ont été arrêtés ; nettoyage SQL ciblé vérifié. Ne pas réutiliser leurs UUID/e-mails disparus. Captures `test-results/spawn-map-{global,selected,corner,mobile}.png` et comparaisons `spawn-geology-before.json` / `spawn-rocks-before.json` sont locaux, ignorés par Git ; les captures sont écrasées par chaque essai. Le profil CPU éphémère n'est pas fourni comme artefact reproductible : refaire l'instrumentation avant de tirer une conclusion nouvelle.

Le worktree contient les modules/API/tests `onboarding/spawn-*`, contrats/tests `spawn-*`, dossier World `spawn-map`, raccord route/PreviewScene, petites optimisations T1/géologie et docs. La spec non suivie et le handoff modifié existaient avant la première implémentation ; leur contenu a été préservé et complété. `codex-session-01a07944-0d99-7ab3-9983-b16b69419275.md` est un transcript utilisateur non suivi, intact. Aucun nouveau schéma/migration, aucune écriture de développement, aucun commit/push. Ne pas confondre HEAD `06837b9` avec cette implémentation non committée.

# Revue Astra — carte de spawn RC1 et lenteurs

9 octobre 2026. Demande de Tristan : examiner le travail partiel de Sol et ses difficultés. **Revue et mesures, aucune correction du code applicatif dans cette passe.** Base : `main` / `06837b9`, implémentation non committée. Références : [spec](SPEC-CARTE-SPAWN-RC1.md), [état réel](IMPLEMENTATION-CARTE-SPAWN-RC1.md), [handoff de Sol](HANDOFF-ASTRA-2026-10-09-SPAWN-RC1-LENTEURS.md).

## Conclusion

La carte et ses interactions constituent un socle réutilisable, mais la qualification courante est trop coûteuse et son exécution bloque le processus serveur. Le disque souffre aussi de son déclenchement : il disparaît pendant le mouvement et attend une pause du pointeur. Le chargement reconstruit à chaque entrée une géométrie volumineuse depuis l'artefact fixe.

Le projet testé `(140,20)`, orientation `0`, est accepté sur les trois appels : terrain compatible, dotation de 4 300 pierres et 3 000 bois conservateur calculée, 1 024 nœuds visités, réponse identique. La difficulté observée n'est pas de rechercher un autre emplacement du village. **Le joueur garde le choix du point et de l'orientation.** Aucun changement de la tolérance ±1 niveau n'est nécessaire pour diagnostiquer ces lenteurs.

## Réserves prioritaires

### P1 — Une qualification bloque les autres tâches du même processus pendant plusieurs secondes

Dans [inspectSpawnResources()](../apps/api/src/modules/onboarding/spawn-resources.ts), la lecture repeatable-read est suivie du calcul synchrone de réseau, de candidats et de dotation. La [route Fastify](../apps/api/src/modules/onboarding/routes.ts) appelle directement cette fonction dans son processus.

Reproduction par appel de la vraie fonction métier, sur copie PostgreSQL isolée et sans serveur HTTP : trois contrôles en 8 935, 10 518 et 11 471 ms. Un timer à intervalle de 20 ms subit un écart maximal de 7 923, 8 164 puis 10 413 ms. Ce blocage de la boucle d'événements est mesuré ; son impact sur les autres requêtes HTTP du monolithe découle du chemin d'appel, sans test HTTP concurrent réalisé ici.

Les onze lectures instrumentées prennent au total 504, 1 102 et 641 ms. Cela inclut le retour pilote et les transformations Kysely ; ce n'est pas un temps SQL mesuré dans PostgreSQL. Le coût dominant de cet essai est bien côté JavaScript. Un appel à chaud ne rend pas actuellement le contrôle rapide.

La priorité est de réduire les calculs géographiques/spatiaux répétés, puis d'empêcher le calcul restant de monopoliser le serveur. Un `async` autour de la fonction ne suffit pas. Déporter le même calcul sans le réduire préserverait la disponibilité du serveur, mais laisserait une longue attente au joueur. La transaction de lecture reste également ouverte pendant ce travail ; conserver un snapshot cohérent n'impose pas à lui seul de garder la connexion occupée durant tout le calcul pur.

### P1 — Le disque ne suit pas le déplacement continu du pointeur

Lecture de [SpawnMap.tsx](../apps/world-web/src/spawn-map/SpawnMap.tsx), effet dépendant de `cursorX` / `cursorY` : chaque changement incrémente la séquence, exécute `setDisk(null)`, puis arme un timeout de 120 ms annulé au changement suivant. L'overlay reçoit sa position de `disk.point`, donc du résultat terminé, et non directement du pointeur.

Conséquence déduite du code : tant que le joueur traverse des cases à moins de 120 ms d'intervalle, le timeout est repoussé et le disque est retiré. Après arrêt, il faut encore attendre le diagnostic et le rendu. Mesure du diagnostic pur sur quatre inspections successives : 3 287 ms à froid, 1 135 puis 1 150 ms sur les cases voisines, 956 ms au retour au point initial. Ce sont des durées Node de calcul, pas des latences de bout en bout dans le navigateur.

Le correctif à privilégier est de faire suivre immédiatement au pointeur le disque neutre, puis d'actualiser les incompatibilités pour ce point. Les résultats rouges périmés ne doivent pas être transposés au nouveau point. Le calcul peut être limité et remplacé par une demande plus récente sans faire disparaître l'aide de placement.

### P2 — Le chargement recalcule puis copie une géométrie importante à chaque ouverture

[terrain-worker.ts](../apps/world-web/src/spawn-map/terrain-worker.ts) lance `buildWorldGeometry()` à chaque initialisation. [world-geography-mesh.ts](../apps/world-web/src/world-generator/world-geography-mesh.ts) produit des tableaux JavaScript ordinaires, renvoyés au thread principal par `postMessage()` sans transfert de buffers.

Mesure Node séparée, sans DB, navigateur ou GPU : **31 741 ms** pour construire le maillage, **3 312 ms** pour un `structuredClone()` de sa sortie. Sortie exacte : 272 186 triangles de terrain, 89 594 triangles d'eau, **8 954 906 entrées numériques** réparties entre positions, couleurs, indices et cellules. La source JSON fait 8 940 626 octets. Ces volumes sont des constats ; la mesure unique n'est pas une distribution de performance navigateur.

Une géographie approuvée et immuable permet de réutiliser une représentation dérivée du même artefact. Pistes bornées : buffers typés transférables et réutilisation/versionnement du maillage dérivé, en conservant positions, couleurs, eau, coutures et identité source. Il faut comparer le coût de chargement de cette représentation au coût actuel avant de choisir le format. Réduire arbitrairement la résolution ou remplacer le relief approuvé n'est pas requis.

### P2 — La mesure actuelle du diagnostic ne prouve pas la réactivité du disque

Dans le handler du worker de [SpawnMap.tsx](../apps/world-web/src/spawn-map/SpawnMap.tsx), `data-diagnostic-ms` est mis à jour pour les canaux `disk` et `selection`, même si la séquence du résultat est périmée. Il manque le temps de debounce, la file d'attente, le transfert, React et la mise à jour Babylon.

De plus, [PreviewScene.tsx](../apps/world-web/src/world-generator/PreviewScene.tsx), `updateMapOverlay()` / `overlayPosition()`, refait du sampling géographique et reconstruit les meshes de l'overlay sur le thread principal. Son coût n'a pas été mesuré dans cette revue. Les bons chiffres d'une réponse worker ne suffisent donc pas à conclure à un survol fluide. Séparer les canaux et mesurer pointeur → résultat courant → rendu avant de fixer un budget UX.

## Ce que le profil CPU précise

Le deuxième appel métier est profilé avec le profiler V8, sans modification de l'algorithme. Le profil couvre environ 11,3 s avec son propre coût de démarrage/arrêt ; la durée d'appel instrumentée n'est pas directement comparable aux deux appels sans profiler. Les temps inclusifs ci-dessous se recouvrent et **ne doivent pas être additionnés**.

| Fonction / groupe | Temps échantillonné indicatif | Lecture |
|---|---:|---|
| `buildSpawnAccessNetwork()` et ses callbacks de préparation/placement | 7,44 s inclusives | Le coût est dans tout le pipeline local, pas seulement le parcours du graphe |
| `canWalkSpawnSegment()` et ses appels | 3,75 s inclusives | Qualification répétée des passages |
| Sampling géographique via `sample()` | 2,50 s inclusives | Le cache de samples ne supprime pas ce coût sur cet appel |
| Requêtes à `createSpawnSurfaceIndex()` | 1,52 s inclusives | Le test des surfaces est aussi un poste important |
| `artifactChecksum()` | 1,18 s inclusives | Relecture et sérialisation canonique de l'artefact complet à chaque contrôle |
| `planSpawnResources()` et sa préparation | 1,07 s inclusives | Le solveur de placement n'explique pas à lui seul la lenteur |
| Filtre initial candidats/emprises dans le planificateur | 0,79 s propres | Le code recrée et parcourt l'ensemble des emprises pour chaque candidat |
| GC | 0,21 s propres | Pas le goulot principal de ce profil |

Le scan linéaire `forest.trees.some()` existe également dans la préparation de chaque candidat. Plusieurs callbacks API apparaissent anonymes sur une même ligne dans la transformation TSX ; leur total ne permet pas de leur attribuer séparément un temps fiable sans instrumentation supplémentaire.

Les pistes à traiter en priorité sont les requalifications répétées du même terrain et des mêmes surfaces, puis la préparation des candidats. Un index plus adapté ou un cache de classifications immuables peut aider, à condition de conserver exactement les comparaisons et d'isoler les occupations dynamiques. La validation du checksum peut être mutualisée seulement avec une identité/invalidation fiables, sans se fier au seul checksum déclaré par la ligne DB.

**Non établi :** rôle de l'effacement du cache à 100 000 samples, profil mémoire navigateur, saturation GPU, causes exactes des anciens 44–90 s, comportement sous plusieurs clients. Aucun de ces points ne justifie encore une refonte générale.

## Première tranche proposée

Corriger ensemble l'aide de placement et le contrôle du point choisi : disque neutre mobile immédiat, diagnostic mesuré par canal, réduction ciblée des recalculs identifiés. Isoler le calcul métier pur du snapshot spatial pour pouvoir le mesurer et protéger la boucle serveur si son coût résiduel le nécessite. Garder le voisinage et les protections par monde, le terrain approuvé et les règles de dotation.

La preuve attendue est une comparaison sur le même projet et le même état : résultat identique, répétitions documentées, absence de gel de plusieurs secondes du processus, puis recette navigateur avec mouvement continu, réponse périmée, clic, rotation, coin et tactile. Aucun seuil de performance chiffré n'est présenté comme déjà validé par Tristan. Une tranche distincte peut ensuite traiter le maillage de chargement, sans mélanger son gain avec celui du contrôle serveur.

Il reste du travail fonctionnel après la performance : projection des ressources naturelles, certification du sol et des accès, préparation/kit transparent, pose HDV transactionnelle et persistance du kit/terrassement/dotation. Les avertissements de pauvreté et le bouton d'installation ne sont pas encore opérationnels. Les garanties fonctionnelles de toute cette suite n'ont pas été auditées ici.

## Reproduction et portée des preuves

Compilation exécutée avec succès : `corepack pnpm --filter @arbestra/contracts build`.

Deux scripts locaux de diagnostic sont conservés dans `test-results/`, ignoré par Git :

```powershell
node --import tsx test-results/spawn-audit-astra.mts
node --import tsx test-results/spawn-geometry-audit-astra.mts
```

Le premier appelle la vraie fonction `inspectSpawnResources()` trois fois sur une nouvelle copie `127.0.0.1/arbestra_test`, sans migrations/reset et sans serveur HTTP. Il mesure les lectures via un plugin Kysely d'observation, un timer 20 ms et le CPU ; seul le deuxième appel active le profiler V8. Le timer mesure un écart entre ticks, pas une latence HTTP. Les trois réponses ont le même hash, statut `planned`, 4 300 pierres / 3 000 bois et 1 024 nœuds visités. Il effectue ensuite quatre diagnostics purs avec l'inspecteur réel. Les scripts de mesure ont été lancés séquentiellement, après compilation, sans autre campagne de test/build lancée par cette revue ; les processus préexistants de l'utilisateur n'ont pas été arrêtés.

Sorties locales : `spawn-audit-astra.json`, `spawn-audit-astra.cpuprofile`, `spawn-geometry-audit-astra.json`. Les processus ont terminé avec code 0. La fixture a supprimé son propre monde et son compte ; relecture SQL finale : zéro ligne pour chacun. Aucun village ni ressource créé, aucune base de développement modifiée. Le deuxième script mesure le constructeur de maillage réel et sa copie en Node ; il ne constitue pas une recette de rendu.

Pas de nouvelle recette navigateur ni de suite de tests applicatifs dans cette revue. Les tests et captures de Sol restent des preuves historiques, avec leurs limites décrites dans son handoff. La reproduction présente ne remplace ni une recette HTTP complète ni les tests de concurrence/pose encore à écrire.

SHA256 source contrôlé avant le profilage : `de165c395c26eb70572a4370d9a537661e9eaf78b477e1694cfda283418702a4`. Code applicatif et transcript utilisateur préservés. Aucun commit/push. Revue enregistrée et handoff courant actualisé ; statut de l'implémentation inchangé.

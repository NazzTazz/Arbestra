# Carte de spawn RC1 — corrections de réactivité

9 octobre 2026, Astra. Base `main` / `06837b9`, travail de Sol conservé dans le worktree. Tranche demandée après la [revue des lenteurs](REVIEW-ASTRA-2026-10-09-SPAWN-RC1.md). **Tranche de réactivité implémentée et vérifiée ; arrivée jouable toujours en cours.**

## Résultat et périmètre

Le disque neutre suit le point courant pendant le calcul ; les arêtes incompatibles ne sont affichées que pour ce même point et cette orientation. La sélection du panneau reste indépendante. Le navigateur conserve une seule inspection en vol et la dernière demande de chaque canal, avec priorité à la sélection. Une réponse périmée ne met à jour ni l'état ni les mesures de la file.

L'overlay de la carte à plat est projeté au-dessus du rendu, sans rééchantillonner la géographie sur le thread d'affichage à chaque mouvement. Les décisions rouges viennent toujours de l'inspecteur partagé. Les mesures distinguent calcul `disk`/`selection`, réception du résultat courant et image rendue ; l'ancien attribut ambigu `data-diagnostic-ms` est retiré.

Le serveur termine sa transaction de lecture repeatable-read avant d'admettre le calcul dans un worker CPU dédié à l'application Fastify. Le worker ne possède aucune connexion DB. Une file accepte au maximum quatre demandes, calcul actif inclus ; surcharge, interruption ou dépassement de 60 secondes de calcul renvoient une erreur réessayable, jamais une impossibilité d'installation. La fermeture de l'application termine le worker et rejette les demandes restantes. Le chemin compilé charge du JS ; le développement charge le TS dans le worker avec TSX.

Le snapshot conserve les voisins et protections privés du monde courant. L'artefact est lu en texte JSONB : parsing, signature canonique et calcul lourd quittent la boucle API. La réutilisation exige l'égalité du **texte réellement lu**, pas seulement le checksum déclaré, l'ID du candidat ou sa seed. Les occupations ne sont jamais réutilisées entre demandes.

Optimisations ciblées : index locaux des surfaces, rochers et arbres ; qualification des points de passage réutilisée seulement dans le calcul courant ; filtrage indexé des candidats de dotation ; cache borné des extrema et obstacles des surfaces immuables, indépendant de l'altitude de référence. Pas de modification des pas d'échantillonnage, des comparaisons géométriques, de la pente ou du terrassement. Le disque garde son rayon 30. Le joueur choisit toujours son point et son orientation.

Le maillage mondial de chargement reste calculé comme auparavant. Sa représentation dérivée réutilisable relève de la tranche suivante. Préparation du village, projection économique naturelle et pose transactionnelle HDV restent à réaliser ; le bouton de choix demeure désactivé.

## Preuves et mesures

La régression API ajoutée avant correction échoue sur un retard de timer de **18 176,7 ms**, puis passe après isolation. Elle appelle le véritable endpoint et attend le dernier tick afin qu'un gel synchrone ne puisse passer inaperçu. Ce test ne prouve pas un débit multiutilisateur ni tous les entrelacements DB.

Les suites ciblées vérifient géographie, seuils, accès, dotation, protections, isolation par monde, absence d'écritures, réponses périmées, saturation/fermeture du worker et refus d'un artefact altéré avec checksum déclaré inchangé. La comparaison locale des **6 928 collisions rocheuses** enregistrées avant optimisation ne trouve aucun écart. Le SHA256 des octets RC1 reste `de165c395c26eb70572a4370d9a537661e9eaf78b477e1694cfda283418702a4`.

Régression visuelle rétrospective isolée : le remplissage du disque a été temporairement conditionné au résultat du diagnostic. La recette échoue au premier déplacement, avec `141:20` attendu et aucun disque courant rendu. La mutation est restaurée dans un `finally` et l'égalité du fichier original est vérifiée. Ce n'est pas une exécution intégrale de l'ancienne version de Sol. Script et journal ignorés : `test-results/spawn-disk-mutation.mjs` / `.log`.

Reprise du script de revue sur une nouvelle copie locale `127.0.0.1/arbestra_test`, trois contrôles de `(140,20)`, orientation 0, sans campagne concurrente lancée par Astra :

| Essai | Contrôle complet | Retard maximal du timer API | Lectures instrumentées |
|---|---:|---:|---:|
| Premier appel, worker démarré à froid | 17 349 ms | 141 ms | 957 ms |
| Deuxième appel, profiler attaché au processus principal | 8 792 ms | 238 ms | 1 109 ms |
| Troisième appel | 3 908 ms | 128 ms | 1 532 ms |

Les trois réponses ont le hash exact de la revue initiale `d82d76b898c2ecaf000cdbbcd122fa61bb18b38763bb25a235d2337362c88c78` : `planned`, 1 024 nœuds, 4 300 pierres et 3 000 bois conservateur. Le deuxième profil n'observe plus le CPU du worker et n'est pas comparable au profil monothread initial. Ce sont trois observations locales, pas des percentiles ni une promesse de temps à froid. L'isolation supprime le gel mesuré de plusieurs secondes ; elle ne rend pas immédiatement tous les contrôles rapides.

Diagnostic pur dans le même script, inspecteur réel : 2 103 ms au premier point, puis 314 et 287 ms sur les cases voisines, 72 ms au retour au point initial. Comptes d'incompatibilités identiques à la revue : 1 186 / 1 203 / 1 220 / 1 186. Artefacts locaux ignorés : `test-results/spawn-performance-after-astra.mts`, `.json`, `.cpuprofile`. Fixture supprimée, zéro ligne du monde/compte vérifié par SQL.

Recette Chrome complète `tests/browser/spawn-map.mjs`, sur fixture isolée : **passée**, aucune erreur JavaScript. Survol village, panneau et courbe, terrain/dotation, dix mouvements continus, absence de rouge associé à un autre point, sélection conservée, rotation, glissement/zoom, clavier, coin et tactile. Les captures sélection/coin/mobile ont été inspectées. Inspection complémentaire avec `agent-browser`, session dédiée fermée.

Mesures de cette recette : rendu prêt 37 345 ms, maillage worker 21 303,9 ms, premier contrôle serveur 16 528 ms. Calcul disque 1 287,8 ms, sélection 1 744,5 ms, délai pointeur → diagnostic rendu 4 641,8 ms sur le point observé. **Disque neutre rendu en 111,3 à 163 ms sur dix déplacements**, pendant que le calcul reste asynchrone. Le disque suit maintenant le mouvement ; le chargement et certains résultats froids restent lents. Aucun objectif 60 FPS ou délai maximal joueur n'est déclaré atteint.

## État de clôture

**44 tests distincts passent** dans sept fichiers : `spawn-map.test.ts` (13), `spawn-access.test.ts` (8), `spawn-resources.test.ts` (9), `inspection-queue.test.ts` (2), `spawn-map.integration.test.ts` (7), `spawn-compute.test.ts` (2), `periodic-lines.test.ts` (3). Les deux tests du worker ont été relancés après la finition de gestion d'erreur au démarrage, sans les compter deux fois. Commande utilisée : `corepack pnpm exec vitest run <fichiers>` après build des contrats.

`corepack pnpm typecheck`, `corepack pnpm lint` et **`corepack pnpm build` terminés avec succès** ; lint du worker revérifié après sa dernière finition. L'avertissement Vite de chunks volumineux reste présent. Un appel réel au worker depuis `apps/api/dist`, sans TSX, valide les emprises RC1 `(140,20)` puis ferme le worker. Pas de nouvelle campagne applicative générale ni de simulation de charge multiutilisateur.

Navigateur et fixture arrêtés. Le stdin de la fixture n'étant pas disponible dans cette session, son processus API enfant identifié a été arrêté ; le parent a exécuté son `finally` de nettoyage et terminé avec code 0. SQL final : zéro monde pour l'UUID de recette et zéro compte `@spawn-browser.test`. Ports de recette libérés. Artefacts de tests ignorés par Git. Aucun commit/push, aucune nouvelle migration, aucune écriture de développement. Les anciens résultats de Sol restent historiques dans le suivi d'implémentation.

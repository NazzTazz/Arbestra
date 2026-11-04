# Contre-recette Infrastructure — 5 octobre 2026

## Mise à jour après correction autorisée

Les défauts de routage et d'invalidation ci-dessous sont corrigés dans le worktree. L'audit initial est conservé comme preuve de l'état avant correction.

La cause dominante de lenteur a été isolée ensuite dans `frosted-glass.ts` : `renderListPredicate` reconstruisait à chaque image la liste de toute la scène. Les mutations observées par Babylon invalidaient les définitions d'éclairage. La liste est désormais remplacée en une fois lors d'un changement des meshes ; elle reste stable entre deux images et exclut toujours le verre. Un test couvre son renouvellement, sa stabilité et le retrait de la capture sans vitre.

| Mesure, vue Village stabilisée | Avant | Après |
| --- | ---: | ---: |
| Nuit, images/s | 6,7 | 47,1 |
| Nuit, intervalle p95 | 333 ms | 49,9 ms |
| Aperçu diurne 2:24, images/s | 4,1 | 53,8 |
| Aperçu diurne, intervalle p95 | 349 ms | 33,3 ms |

Les mesures après correction vérifient explicitement `viewMode=village`, zéro bâtiment en génération et dix chunks chargés. Une première mesure à 56,5 images/s pendant l'arrivée et une mesure diurne pendant la génération ont été écartées. Les à-coups ne sont pas tous éliminés ; ces chiffres caractérisent la session locale automatisée.

Autres corrections :

- Identité autoritaire de l'hôtel de ville dans le snapshot et le contexte territorial, indépendante des ancres. Régression serveur sur village décalé et tests purs avec voisin / emprise multi-case.
- Préférence du réseau commun maintenue lors du raffinement. Sur la copie alignée de l'audit : 12 intersections et 1 boucle, contre 16 et 3 ; calcul froid 1,37 s contre 4,12 s. Les boucles utiles ne sont pas interdites par principe. Le réseau réel contient désormais 33 trajets fins, confirmé via l'API de développement.
- Diagnostic des sept échecs : cinq portes immédiatement contre des parcelles de jardin ; deux portes dans une poche fermée par le campus et les maisons voisines. Ce sont des obstacles de l'implantation, conservés. Aucun repli traversant les murs, aucune modification des missions engagées ou des données du village.
- Angles fantômes supprimés lorsque le segment mène à une case dont la chaussée est exclue. Le cas synthétique échouait avant correction. Les quatre bras hérités manuels sont conservés : ils ne constituent pas un défaut de calcul démontré.
- Dérivés spatiaux de voirie mis en cache, feux calculés une seule fois ; invalidation des meshes manuels fondée sur les hauteurs locales et la projection. Test de conservation de l'identité des meshes sur révision distante et de reconstruction sur changement local.

**Validation :** 40 tests purs ciblés et 12 tests DB Infrastructure verts, lint/typecheck verts ; contrats reconstruits. Pas de suite E2E. Recette visuelle jour/nuit, captures et métriques locales conservées dans le dossier de preuves. Aucun commit/push, aucun reset/migration de développement. Les anciens résultats et hypothèses ci-dessous restent historiques.

## Audit avant correction

**Verdict : tranche à corriger avant validation.** Audit du worktree sur `main`, base `ffb6707`, et du village réel Clairière sur `localhost:5174/?world=aube`. Les modifications applicatives étaient déjà présentes. Aucun correctif applicatif, reset, migration ou aménagement du village effectué pendant cette revue.

## 1. Routage fin silencieusement désactivé sur le village réel — P1

Dans `packages/contracts/src/travel-paths.ts`, `refineTravelRoute()` exige que l'ancre du bâtiment hôtel de ville soit exactement l'ancre du village. Sinon il renvoie le trajet ancien sans erreur.

Le snapshot réel contient :

- ancre village `(1102, 21)` ;
- ancre de l'hôtel de ville `(1101, 21)` ;
- 19 bâtiments, 3 tracés manuels et 6 équipements manuels ;
- 40 trajets, aucun en version 2.

Le rejeu hors base avec et sans infrastructure produit exactement le même réseau : 543 sommets cumulés dans les itinéraires, 151 nœuds hors bâtiments, 150 arêtes, 17 intersections de degré ≥ 3, aucune boucle. Les recherches fines retournent immédiatement.

**Conséquence :** le raccord nouveau aux accès, aux voies et aux obstacles fins n'est pas exécuté dans cette branche. L'affichage de l'infrastructure et le routage peuvent donc diverger. Corriger uniquement l'apparence des intersections ne répare pas ce défaut.

**Correction minimale :** identifier sans ambiguïté l'hôtel de ville du village concerné, indépendamment de l'égalité entre ces deux ancres. Ne pas sélectionner simplement le premier hôtel de ville du snapshot : il peut appartenir à un voisin. Préserver les accès réels et leur orientation. Couvrir le cas réel d'un hôtel de ville multi-case dont l'ancre diffère de celle du village.

## 2. Deux calculs successifs de réseau ont des objectifs différents — P1

`buildTravelNetwork()` construit d'abord des chemins qui favorisent les tronçons déjà partagés et pénalisent les changements de direction. Puis `refineTravelRoute()` recherche de nouveau chaque trajet, indépendamment des autres. Il favorise les pixels manuels, mais ne conserve ni la préférence pour les tronçons automatiques communs ni la pénalité de virage du premier calcul.

Reproduction isolée : copie du snapshot en mémoire, seule l'ancre village est alignée sur l'hôtel de ville pour activer cette seconde branche. Ce n'est **pas** une correction appliquée ni une mesure du village inchangé.

| Mesure sur cette copie | Réseau initial | Après raffinement |
| --- | ---: | ---: |
| Itinéraires | 40 | 33 |
| Nœuds hors bâtiments après projection à la case | 145 | 195 |
| Arêtes | 143 | 197 |
| Intersections de degré ≥ 3 | 15 | 16 |
| Boucles indépendantes | 0 | 3 |
| Calcul à froid, une exécution | 354 ms | 4 123 ms |

Les 33 trajets restants sont en version 2. Un échec du raffinement renvoie `null`, puis `flatMap()` supprime l'itinéraire. La raison précise des sept échecs reste à établir cible par cible : il ne faut ni les déclarer tous accessibles sans preuve, ni masquer leur disparition par un trajet traversant les obstacles.

**Conclusion bornée :** la perte du réseau partagé est établie et les boucles sont reproduites lorsque le raffinement fonctionne. Elle n'explique pas directement les intersections actuellement visibles sur Clairière, puisque le défaut n°1 court-circuite cette branche. Sur le village réel, je n'ai pas démontré de prolifération des boucles du graphe automatique.

**Correction minimale :** conserver le réseau commun comme référence et limiter le raffinement aux raccords nécessaires, ou préserver explicitement son coût partagé dans la recherche. Un seul réseau accepté doit alimenter les trajets et les projections décoratives. Rendre les échecs de raccord diagnostiquables. Ne pas simplement lever le court-circuit n°1 sans traiter ce second comportement.

## 3. Lenteur reproduite, avec invalidations graphiques trop larges — P1

Session navigateur dédiée, viewport 1264 × 569, sans changement de caméra entre les deux mesures de dix secondes :

- nuit : 69 images, **6,7 images/s**, intervalle p95 **333 ms** ;
- aperçu joueur à 2:24, éclairage direct confirmé : 43 images, **4,1 images/s**, intervalle p95 **349 ms** ;
- terrain stabilisé : 10 chunks résidents, aucune requête ni intégration en attente ;
- scène : **1 522 meshes**, **1 381 géométries**, **74 matériaux**, environ **1 420 à 1 654 draw calls** selon l'échantillon ;
- qualité réduite déjà activée.

Ces mesures démontrent la lenteur dans la session automatisée ; elles ne constituent pas un benchmark GPU du navigateur personnel de Tristan. Les deux échantillons ne prouvent pas que le jour est intrinsèquement plus coûteux. En revanche, passer au jour ne résout pas le problème : ce n'est pas uniquement une animation de flammes nocturnes.

Le profil CPU situe une part importante du coût dans `MaterialDefines.toString`, `PrepareDefinesForLight`, `isReadyForSubMesh` et la préparation des effets. Côté application, `#updateTravelPaths`, `#streamTerrain`, la géométrie des routes et les braseros ressortent. Les temps inclusifs imbriqués ne doivent pas être additionnés.

Défaut précis vérifié dans le code :

1. `BabylonVillageScene.#streamTerrain()` appelle `#updateTravelPaths()` à chaque changement de version globale du renderer.
2. Cette méthode recalcule obstacles, surface et braseros avant le garde de signature des lignes debug ; les braseros sont calculés deux fois dans ce parcours.
3. `InfrastructureRenderer.update()` inclut cette version globale dans sa signature, puis détruit et reconstruit ses meshes dès qu'elle change, même si le chunk concerné n'affecte pas le plan.
4. Les routes historiques possèdent déjà une seconde signature de géométrie qui évite certaines reconstructions. Il serait incorrect de dire que tous leurs meshes sont systématiquement recréés.

Le snapshot produit 94 positions de braseros automatiques, plus 6 équipements manuels. Cela ne signifie pas 100 lumières actives : le code borne les lumières proches à six. Le traitement matériaux/lumières reste une piste de coût attestée par le profil, mais son attribution exacte à une modification de cette livraison n'est pas démontrée. La liaison des lumières et le dégel des matériaux existaient déjà avant cette tranche.

**Correction minimale :** cacher les dérivés du plan par révision spatiale pertinente ; invalider la géométrie sur les hauteurs/emprises effectivement touchées, pas sur tout événement de streaming. Ensuite profiler à nouveau matériaux, lumières et draw calls sur ce même village. Ne pas ajouter seulement un cache HTTP ou supprimer les flammes au hasard.

## 4. Raccords visibles : vérification complémentaire nécessaire

Le plan réel conserve quatre demi-bras de terre hérités sur les cases `(1103,23)` et `(1104,23)`, perpendiculaires au tracé manuel. Ils proviennent de la capture de la voirie automatique lors d'une édition ; leur présence est distincte d'une nouvelle boucle de pathfinding.

Les braseros canoniques sont désormais déduits des trajets bruts, alors que la chaussée affichée découpe les trajets sur les cases occupées/éditées. Le premier calcul peut encore retenir une direction vers une case ensuite exclue ; ce décalage de découpage mérite une reproduction locale avant correction. Il ne suffit pas de compter les feux pour compter les intersections routières.

Il reste donc à isoler un carrefour visuellement indésirable précis et comparer : trajet, surface automatique, bras hérités et surface manuelle. Aucune suppression des raccords hérités n'est justifiée par cette revue seule.

## Chargement et cache

Deux lectures du village sont observées au démarrage du client de développement : environ 3,0 s et 4,3 s. Une lecture ultérieure mesurée depuis le navigateur prend 7,75 s, délai qui inclut aussi l'ordonnancement du thread principal. Aucune de ces durées ne prouve à elle seule sept secondes de calcul serveur ou d'attente PostgreSQL.

Le cache de routage **existe**. Sur le snapshot réel, un calcul à froid prend environ 0,50–0,61 s et une répétition en cache 1,8–2,3 ms dans les rejeux. Dire « il n'y a pas de cache » serait donc inexact. Aucune mesure des verrous SQL ou comparaison avec un build de production n'a été faite pendant cette contre-recette.

## Ordre de correction et critères de sortie

1. Couvrir l'identification du bon hôtel de ville et la stabilité du réseau partagé ; diagnostiquer les sept cibles perdues de la copie de reproduction avant d'activer le raffinement sur le village réel.
2. Borner les recalculs et reconstructions de l'infrastructure. Un chunk sans incidence sur la voirie ne doit pas reconstruire ses meshes.
3. Comparer la surface finale et les raccords sur les intersections signalées ; aligner les consommateurs du réseau sans retirer des branches utiles.
4. Mesurer de nouveau chargement, fluidité au repos et navigation jour/nuit sur le même village, puis isoler les coûts matériaux/lumières restants.

Garanties à vérifier : accès de l'hôtel de ville réellement utilisé ; obstacles respectés ; chemins mutualisés ; aucune disparition inexpliquée de destination ; missions engagées inchangées ; surface/braseros/routage cohérents ; aucune reconstruction globale déclenchée par un chunk distant. Tests ciblés sur ces régressions, puis recette humaine. Pas de nouvelle suite E2E exécutée dans cet audit.

## Preuves et limites

Artefacts locaux ignorés par Git : `test-results/infrastructure-review/` contient captures jour/nuit, snapshot, trace CPU, synthèse CPU, mesures idle/jour, comparaison de réseau et fixture alignée. Les scripts de diagnostic sont conservés dans ce dossier. Aucun correctif de production ni commit/push effectué. Les serveurs de développement existants sont conservés.

Cette revue cible les deux symptômes demandés ; elle ne revalide pas toute l'économie, les annulations ou les ateliers. Les résultats de tests précédents du handoff restent historiques et ne remplacent pas ces reproductions sur le village réel.

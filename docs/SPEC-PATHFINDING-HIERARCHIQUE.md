# Pathfinding hiérarchique et cache durable HDV–HDV

Date : 18 octobre 2026. Base relue : `main`, `5de7b09` (application `a641cd6`).

Statut : **implémentation validée localement et déployée en staging et alpha**, autorisée explicitement par Tristan le 18 octobre après rédaction de cette spec. Aucun changement de règle de transport. Commit `20f8f2a`, tags `staging-2026.10.18.3` et `alpha-2026.10.18.3` ; migration 046 appliquée dans les deux environnements et contrôles publics verts. Preuves dans le [suivi de déploiement](DEPLOIEMENT-VPS.md). Les mesures et limites de validation sont consignées dans le handoff ; les objectifs de performance ci-dessous ne sont pas des garanties de production.

## Résultat attendu et périmètre

Un joueur consulte un échange, obtient un trajet praticable entre les accès réels des hôtels de ville et peut le confirmer sans refaire une recherche fine sur tout le monde. Les calculs utiles survivent au redémarrage. Une modification locale conserve les portions encore valides ; un détour plus large reste possible si la zone modifiée ferme un passage important.

Première tranche : transports commerciaux entre joueurs. Réutiliser le noyau de navigation et ses certifications physiques, sans basculer simultanément expéditions, réseau villageois, récoltes ou animations locales. Les consommateurs historiques conservent leurs contrats. Le défaut visuel de terrain régional à Arkham est explicitement différé.

**Orientations demandées en session :** cache évolutif HDV–HDV, persistance PostgreSQL, réutilisation des zones non modifiées, réparation des zones touchées. **Choix de réalisation proposés :** hiérarchie à deux niveaux inspirée de HPA*, A* sur le graphe abstrait, traversées locales certifiées et versionnées. LPA*/D* Lite, JPS et matrice exhaustive sont hors première tranche. Aucun arbitrage produit bloquant identifié ; les budgets ci-dessous sont des objectifs à démontrer, pas des performances acquises.

## Existant vérifié avant cette tranche

| Code | Comportement actuel |
|---|---|
| `packages/contracts/src/route-planner.ts` | A* borné, grille fine au huitième de case, connecteurs d'accès certifiés et distance torique. `coarseFirst` tente une grille de cases avec heuristique pondérée puis un repli fin ; ce n'est pas un graphe HPA*. |
| `apps/api/src/modules/navigation/context.ts` | Lecture cohérente repeatable-read du terrain et des obstacles. Révision mondiale issue du nombre de changements de synchronisation marqués navigation ; identité RC1 comprenant actuellement des informations physiques PostgreSQL. |
| `apps/api/src/modules/navigation/compute-worker.ts` | Champ physique incluant eau, relief, roches, troncs, occupations et équipements. Préférence de coût pour les chemins manuels. Caches RAM de contextes et de routes. |
| `apps/api/src/modules/navigation/compute.ts` | CPU en workers, admission bornée avec refus temporaire en saturation ; watchdog commercial 31 s. |
| `apps/api/src/modules/villages/trade-service.ts` | Préparation hors transaction économique, budget commercial 30 s / 262 144 nœuds, revalidation de révision mondiale à l'acceptation. |
| `apps/api/src/modules/villages/infrastructure.ts` | Prise du verrou mondial d'infrastructure et protection des chemins commerciaux engagés. |

Le cas alpha diagnostiqué a demandé 20,736 s à froid, puis 0,311 s à chaud dans un worker isolé, pour 438,104 s de marche. Ce sont deux mesures ponctuelles, sans preuve de charge ni mesure HTTP authentifiée. La présente tranche vise notamment le coût du premier calcul et sa répétition après changement ou reboot.

## Fondement et limites de la recherche

[Botea, Müller et Schaeffer, HPA*](https://webdocs.cs.ualberta.ca/~jonathan/publications/ai_publications/jogd.pdf) proposent de relier des entrées de régions par des traversées calculées localement, puis de chercher sur ce graphe réduit. Nous retenons ce principe ; les gains et la proximité de l'optimum observés dans leur corpus ne constituent pas une garantie pour Arbestra.

[Lifelong Planning A*](https://idm-lab.org/bib/abstracts/papers/aij04.pdf) et [D* Lite](https://publications.ri.cmu.edu/d-lite) réutilisent des états de recherche lorsque les coûts changent. Conserver seulement des chemins n'est pas implémenter ces algorithmes. Leur adoption éventuelle sur le graphe abstrait dépendra des mesures ; la V1 répare les traversées puis relance A* sur le petit graphe.

[Jump Point Search](https://ojs.aaai.org/index.php/AAAI/article/view/7994) vise notamment les symétries des grilles à coûts uniformes. Les coûts aménagés, connecteurs et certifications d'Arbestra ne justifient pas son application directe dans cette tranche.

## Invariants de navigation et de commerce

- Tout identifiant, cache, dépendance, requête et verrou est isolé par `world_id`.
- Les positions sont canoniques sur la grille périodique ; ni le viewport, ni le LOD graphique, ni la courbure du donut Babylon ne décident de la praticabilité.
- Un raccourci représente un chemin physique conservé. Il ne traverse pas implicitement eau, relief, arbre, roche ou bâtiment. Chaque segment et chaque connecteur utilisent les mêmes règles de certification que le solveur fin.
- L'exemption d'occupation d'un accès reste limitée à son propre bâtiment. Elle ne s'applique jamais à une traversée partagée entre chunks.
- Distance géométrique, coût de recherche et durée sont trois valeurs distinctes. Conserver la préférence actuelle pour la voirie ; conserver `travelDuration()` pour la durée commerciale à une case par seconde. Ne pas transformer le facteur de préférence 0,7 en bonus de vitesse.
- Maximum commercial aller simple, porteurs `ceil(max(aller, retour) / 250)`, réservations, énergie, crédits et échéances restent inchangés. L'Oracle instantané n'utilise pas ce calcul.
- Une mission engagée conserve son chemin complet et ses échéances dans les données métier, indépendamment de toute éviction du cache. Aucun recalcul de cache ne téléporte ses habitants ni ne déplace ses crédits.
- Une recherche inachevée, un cache absent ou un graphe incomplet ne prouvent jamais l'absence de chemin.

## 1. Partition et graphe de traversées

Utiliser les chunks logiques du monde, avec leur taille configurée (32 cases dans la configuration habituelle), indépendamment des tuiles de rendu. Supporter les chunks terminaux plus petits si les dimensions ne sont pas multiples de cette taille. Ne pas coder en dur les dimensions RC1 512 × 256.

Un portail est une transition certifiée entre deux chunks adjacents. Les portails sont identifiés par coordonnées canoniques et version de politique, avec orientation explicite. Les frontières droite/gauche et haute/basse du monde sont des frontières ordinaires. Une transition partagée dépend des versions des deux côtés et des données de voisinage réellement consultées.

Construire les passages de frontière sur la grille fine existante. Regrouper les transitions contiguës en entrées et retenir des représentants déterministes, sans réunir deux composantes séparées par un obstacle. Proposition initiale : extrémités et milieu de chaque entrée ; enrichissement local avec d'autres transitions fines si le graphe ne fournit pas de témoin. Les passages étroits restent représentables. Les limites de portails limitent le travail, jamais la vérité physique : dépassement = calcul incomplet, pas frontière fermée.

À l'intérieur d'un chunk, une arête relie deux portails uniquement si une recherche locale a produit un chemin certifié. Elle porte géométrie, longueur, coût, dépendances et versions. Le calcul peut utiliser A* pour une paire ; Dijkstra est pertinent pour plusieurs destinations depuis une même entrée. Aucun pré-calcul systématique de toutes les paires de tous les chunks n'est requis.

Les accès HDV sont des nœuds temporaires raccordés aux portails de leurs chunks par des chemins locaux. Considérer tous les accès admissibles et le trajet direct local si les HDV partagent un chunk. Un chemin local ne peut sortir puis rentrer du chunk sans que ces transitions apparaissent dans le graphe.

Les données naturelles immuables sont chargées une fois par identité de terrain ; les surcharges dynamiques sont appliquées localement. Un chunk jamais modifié peut toujours contenir des obstacles naturels. Il bénéficie du même cache certifié qu'un chunk construit.

## 2. Recherche globale et tore

Sur des coordonnées canoniques, poser `dx = min(abs(x1-x2), W-abs(x1-x2))`, et de même pour `dy`. L'heuristique de la V1 est `minimumCost × (dx + dy)`, compatible avec la métrique cardinale actuelle et une borne inférieure démontrée du coût. Prendre zéro si cette borne n'est pas connue. Ne pas réutiliser le multiplicateur 2 du correctif `coarseFirst` dans l'A* abstrait.

Le graphe peut être matérialisé progressivement : à l'expansion d'un portail, résoudre ses traversées locales encore inconnues dans le budget commun. Une arête inconnue n'est pas une arête impossible. Tous les coûts doivent être non négatifs ; les arêtes complètes exposent le coût réel du témoin.

Assembler les chemins locaux sans supprimer leurs passages aux frontières. Vérifier les jonctions, accès, dépendances et métriques. La géométrie transmise reste compatible avec `TravelCell[]` et le déroulement torique du renderer. Définir un départage déterministe à exactement une demi-dimension ; aucune interpolation ne doit choisir une traversée différente du témoin certifié.

L'A* abstrait peut optimiser le graphe représenté, sans garantir le chemin globalement optimal sur la grille fine. Si la hiérarchie échoue, enrichir les portails puis utiliser le solveur fin dans le budget restant. Conserver le correctif commercial existant comme stratégie de repli versionnée lors de la transition.

Si un trajet trouvé dépasse le maximum de l'annonce, tenter une amélioration bornée avant le refus. Un échec d'amélioration par budget donne une indisponibilité temporaire. Un refus de distance concerne le trajet calculé, pas une preuve mathématique qu'aucun trajet plus court n'existe ; conserver ce sens dans les messages et mesures. Garantir le meilleur trajet commercial constituerait une autre exigence produit.

## 3. Cache PostgreSQL et cache mémoire

Migration additive, noms physiques à aligner sur les conventions du dépôt :

| Relation cible | Contenu et clés |
|---|---|
| `navigation_chunk_versions` | Marques append-only par monde, chunk et transaction ; la révision est le nombre de marques commises. Une absence initiale signifie version zéro. Aucun verrou de ligne de chunk ne s'ajoute après les verrous métier. |
| `navigation_chunk_meshes` | Certificats physiques des arêtes cardinales unitaires : deux bits par direction, quatre directions par case, sérialisés en hexadécimal. Dépendances du chunk et de son voisinage ; fusion uniquement à versions identiques. |
| `navigation_chunk_crossings` | Identité de terrain, version d'algorithme/politique, profil, contraintes, chunk, portails orientés, vecteur de dépendances, chemin certifié, longueur, coût, date et taille. |
| `navigation_hall_routes` | Monde, clé orientée HDV source/destination et profil/contraintes, espace de politique, chemin témoin complet, coût, certificat local, dernière utilisation. Les accès sont couverts par leurs dépendances physiques et vérifiés à nouveau lors d'une réparation. |
| `navigation_route_dependencies` | Route, chunk et version attendue ; index inverse par monde/chunk pour identifier les routes candidates à réparation. |

La route conserve son chemin complet plutôt qu'une composition de références : lecture durable en une ligne, éviction indépendante des traversées et absence de jointures pour reconstituer un devis. C'est un choix de réalisation par rapport à la proposition initiale. Une réparation remplace atomiquement le chemin et son certificat. Toutes les clés incluent le monde. Une transaction ne publie jamais une demi-route ou un mélange de versions incompatibles.

L'identité durable du terrain comprend génération, dimensions et checksum/version métier persistante ; **ne pas employer `xmin` ou `ctid` comme identité durable**. Le cache n'est pas invalidé par un simple redémarrage ou une maintenance physique PostgreSQL. Un changement de règles, de génération ou de profil change son espace de clés.

La matrice est clairsemée : calcul à la demande des paires effectivement utilisées. Mutualiser A→B et B→A seulement après preuve de symétrie de la praticabilité, des coûts, contraintes et connecteurs ; sinon conserver deux clés orientées. Les identifiants d'offres et quantités n'entrent pas dans la clé géométrique.

La RAM sert de cache borné devant PostgreSQL. À froid, charger route, traversées et versions nécessaires ; ne pas reconstruire tous les champs physiques si les signatures et dépendances sont encore valides. Toute lecture de cache doit vérifier les versions persistées, même après un autre processus serveur. Les notifications d'invalidation ne sont qu'une accélération.

Limites configurables par monde : `NAVIGATION_CACHE_ROUTES` (1 024), `NAVIGATION_CACHE_CROSSINGS` (4 096), `NAVIGATION_CACHE_MESHES` (2 048), `NAVIGATION_CACHE_BYTES` (16 Mio par relation). Routes évincées par dernière utilisation, traversées/index par dernière publication ; les touches d'usage sont regroupées à une par minute et clé. RAM bornée à 64 routes et 65 536 points par pool. Les missions stockent leur propre témoin complet et ne retiennent pas le cache. Pas de cache négatif durable pour les budgets expirés. Le journal de marques n'est pas purgé dans cette tranche ; sa croissance reste à surveiller.

### Stratégie adaptative effectivement implémentée

La hiérarchie brute s'est révélée coûteuse à froid sur RC1. Sans index, le worker utilise immédiatement le solveur commercial existant et mémorise les arêtes physiques qu'il certifie. Avec un index disponible, il accorde au graphe de portails au plus 250 ms, puis utilise le budget restant dans le solveur commercial, qui bénéficie du même index. Les traversées locales partagent un arbre Dijkstra par entrée. Un passage fin absent du graphe reste traité par le repli historique ; aucun échec de la représentation grossière ne devient une preuve d'impossibilité.

Correction issue de la recette Test commerce → Bressuire : le solveur commercial conserve aussi des arêtes au huitième de case dans un voisinage torique de trois cases par axe autour de chaque extrémité, avec raccords fins certifiés. Un HDV accessible à pied peut en effet déboucher sur une petite poche isolée sur la seule grille de centres. Ce raccord local évite d'épuiser la recherche globale grossière avant de traiter le passage étroit. Les compteurs de nœuds et de temps restent communs ; le repli fin global reste disponible au-delà de ces voisinages. Sur ce cas réel : 70,354 s de marche trouvées en 2,911 s à froid chargé, puis cache durable relu en 211 ms. Mesures ponctuelles, sans modification du maximum commercial ni des règles physiques.

L'index se remplit progressivement au fil des recherches. Il ne contient ni exemptions de bâtiments, ni coûts de voirie : ceux-ci sont recalculés selon le contexte courant. Aucun préchauffage complet du monde n'est exécuté dans une requête joueur, et aucun nouveau service de préchauffage n'est introduit. Le benchmark distingue explicitement un index préparé intégralement d'un monde sans index.

Un ancien chemin de même politique est d'abord recertifié avec ses accès actuels. Si un segment est bloqué, une recherche bornée raccorde les points encore praticables autour de l'obstacle, en conservant préfixe et suffixe. Trois réparations locales au plus, chacune plafonnée à 500 ms et 32 768 nœuds, précèdent le repli général dans le budget restant. Une modification de dépendance ne supprime donc pas systématiquement tout le témoin.

## 4. Changements locaux et réparation

Toute mutation affectant la navigation incrémente, **dans sa transaction métier**, les versions des chunks dont les données physiques ou les coûts changent. Couvrir construction et extension, accès/layout/rotation, terrassement, arbres retirés ou ajoutés, équipements et voirie ; prendre l'union des anciennes et nouvelles emprises.

L'emprise inclut le support d'influence réel du calcul physique : interpolation du sol, volume des obstacles, certification des segments et connecteurs. Le halo doit être dérivé de ces lectures et testé, pas fixé arbitrairement à une case. Normaliser avant indexation, y compris aux coutures du tore. Un changement purement économique, météorologique visuel ou cosmétique ne doit pas invalider une route.

Auditer tous les producteurs actuels de changements de navigation avant activation. Une mutation dont l'emprise n'est pas déterminable déclenche exceptionnellement une nouvelle époque mondiale, pour rester sûre ; elle est instrumentée et ne doit pas devenir le chemin ordinaire. Conserver la révision globale historique pour les consommateurs non migrés.

À la prochaine demande d'une route périmée :

1. Comparer les dépendances et signatures des accès. Garder les traversées dont les versions correspondent.
2. Revalider le témoin des traversées touchées ; si sa géométrie et son coût restent admissibles, publier une certification à jour sans recherche.
3. Sinon recalculer entre leurs anciens portails. Conserver préfixe et suffixe lorsque les jonctions restent valides.
4. Si un portail disparaît ou qu'aucun raccord local n'est trouvé, reconstruire les frontières concernées, élargir aux voisins puis relancer A* sur le graphe abstrait. Les autres traversées restent réutilisables.
5. Recourir au repli fin si nécessaire, sans dépasser le budget global. Un changement massif peut demander une nouvelle route complète.

Une ouverture hors du trajet peut créer un raccourci : l'ancienne route reste praticable, mais son optimalité n'est pas garantie. La V1 n'invalide pas tous les chemins pour rechercher ces améliorations. Un rafraîchissement borné des routes utilisées peut améliorer leur qualité ; il n'est pas nécessaire pour garantir leur sécurité. Aucun recalcul opportuniste ne modifie les missions engagées.

## 5. Cohérence, publication et économie

Le calcul CPU reste hors transaction économique. Charger une vue cohérente du terrain, de ses surcharges, des accès et versions. Avant publication d'un résultat, comparer les dépendances dans une transaction courte sous le verrou partagé `infrastructure:<worldId>`. En cas de modification concurrente, abandonner le résultat périmé avec `TRADE_ROUTE_CHANGED`, permettant une nouvelle préparation ; pas de boucle automatique de recalcul dans cette V1. Aucun verrou SQL n'est gardé pendant une recherche CPU.

Les mutations pouvant ajouter un obstacle ou changer un accès prennent le verrou exclusif correspondant avant modification. La suppression monotone d'un tronc pendant une réconciliation économique conserve le verrou partagé existant : elle peut ouvrir un raccourci mais ne rend pas un témoin praticable dangereux. Ne jamais promouvoir ce verrou après prise des gisements. Conserver les ordres de verrous village → navigation → métier existants ; ne pas introduire de verrou de chunk pris avant un village. Une publication de cache ne réconcilie aucun village et ne prend aucun verrou économique.

À l'acceptation, `PreparedTrade` porte l'identité de politique, le témoin, les signatures d'accès et le vecteur de dépendances. Sous les verrous existants des deux villages ordonnés par UUID et le verrou partagé de navigation, revalider ces valeurs et les règles de l'annonce avant débit et création de mission. Une mutation étrangère à ces dépendances n'impose plus `TRADE_ROUTE_CHANGED`. Si une dépendance a changé, sortir sans effet économique et préparer à nouveau hors transaction ; ne pas chercher un détour sous les verrous métier.

Préserver `beginVillageEconomy()`, la borne temporelle post-verrou, l'ordre des transitions et l'idempotence. L'acceptation fige chemin et durée pour l'aller-retour. Les changements spatiaux ultérieurs conservent la protection existante des missions engagées, à couvrir par des tests de toutes les mutations pertinentes.

## 6. Admission, API et exploitation

Garder les endpoints marché existants. Les détails de chunks et portails sont internes au serveur. Distinguer succès, accès invalide, budget épuisé, saturation et contexte périmé ; garder `TRADE_PREPARATION_BUSY` contrôlé dans le NOC. Ne pas convertir une panne du cache en « aucun trajet ».

Regrouper les demandes simultanées d'une même clé dans un processus pour partager un seul calcul, tout en vérifiant séparément autorisations, annonce et maximum. Borner le nombre de requêtes en attente. Entre processus, accepter au départ un calcul redondant borné et une publication atomique idempotente ; pas de verrou PostgreSQL conservé pendant tout le calcul.

Les calculs commerciaux interactifs attendent désormais une place dans la file commune des projections : quatre demandes au plus, attente plafonnée à 15 s avant chargement SQL du terrain, puis budget de calcul habituel de 30 s. La file pleine ou expirée conserve `TRADE_PREPARATION_BUSY`. Cette attente évite le refus immédiat lorsque le worker est occupé par une projection ou une observation préemptible ; elle ne garantit pas la disponibilité sous saturation prolongée. Les expéditions gardent leur admission immédiate et leurs reprises par ordonnanceur. Aucun worker supplémentaire ni verrou économique pendant l'attente.

Correctif d'admission déployé en staging et alpha sous `6f44bd1`, tags du 18 octobre suffixés `.4`. Régression métier de contention constatée rouge puis verte, 55 tests connexes verts. Sonde isolée sur les données alpha Pinkystan–Catmark après publication : attente effective puis chemin trouvé en 21,421 s, sans mutation économique ; mesure ponctuelle, pas une garantie de latence HTTP.

Les demandes interactives ont priorité sur le préchauffage. Le préchauffage est facultatif, déclenché pour des paires utiles, exécuté seulement avec capacité libre et annulable ; aucune explosion de toutes les paires à chaque annonce. Réutiliser le pool existant, sans multiplier les workers par joueur. Les budgets de temps et de nœuds englobent recherche abstraite, calculs locaux, enrichissement, réparation et repli ; watchdog cohérent avec ce budget et temps de préparation mesuré séparément.

Mesurer : lecture SQL, chargement du terrain, portails, recherches locales/abstraites, réparation, repli, cache RAM/SQL, publication ; nœuds visités, chunks touchés/réutilisés, octets, taux de saturation et résultats périmés. Les journaux donnent des références contrôlées, sans secrets. Aucun nouveau tableau de bord général requis.

## 7. Critères d'acceptation

### Correction et non-régression

- Petits mondes de référence : comparer au solveur fin exhaustif ou à Dijkstra sous la même politique ; tous les témoins trouvés sont certifiés, métriques recalculées identiques. Mesurer les écarts de coût/longueur sans revendiquer l'optimalité générale.
- Coutures X, Y et double couture, demi-dimension, chunks terminaux, deux mondes aux mêmes coordonnées, HDV dans le même chunk, accès multiples, passage inférieur à une case et obstacles aux frontières.
- Modification locale : preuve que les traversées éloignées ne sont pas recalculées ; obstruction nécessitant un détour hors chunk, portail supprimé, ouverture créant un raccourci, changement de coût sans blocage et déplacement d'accès.
- Restart réel du worker/API : route reprise depuis PostgreSQL avec zéro recherche géométrique si toutes les versions correspondent. Éviction RAM, cache SQL partiellement absent et changement de version de politique doivent tous rester sûrs.
- Concurrence avec barrières bornées : mutation pendant calcul, avant publication et entre préparation/acceptation. Observer l'attente PostgreSQL pertinente ; aucune publication obsolète ni débit fondé sur un chemin périmé. Attendre et libérer toutes les transactions, même en échec.
- Rollback injecté après écritures prouvées : versions de chunks et mutation physique reviennent ensemble à leur état initial ; une erreur de cache ne touche pas stocks, cohortes, offres ou notifications.
- Budget expiré et saturation restent temporaires ; aucun cache négatif mensonger. Rafale sur même paire partage le travail localement, paires différentes respectent le pool borné.
- Suites commerce, navigation, infrastructure, changements physiques et consommateurs historiques ; parcours navigateur marché complet puis transport visible à travers une couture torique, sans changement de hauteur de fiche ni erreur de rendu.

### Performance à démontrer

Constituer un corpus reproductible sur une copie de test de RC1, incluant le couple alpha diagnostiqué, proches/lointains, forêts, frontières, passages étroits et zones construites. Comparer ancien et nouveau solveur à matériel, données et nombre de workers identiques. Publier médiane, p95, maximum, taux de réussite, qualité de trajet, taille SQL et RSS. Au moins 30 paires et répétitions distinctes pour cache vide, cache SQL seul après reboot, cache RAM et réparation locale ; ne pas présenter une mesure isolée comme un p95.

Objectifs de recette proposés pour le devis serveur de navigation, hors débit/acceptation : p95 ≤ 2 s sur une paire inconnue avec index de chunks préparé, ≤ 500 ms depuis SQL après reboot, ≤ 250 ms depuis RAM, ≤ 1 s pour une réparation limitée à un chunk et son halo. Un monde entièrement vierge d'index doit également être mesuré : viser p95 ≤ 5 s ; conserver le budget de sécurité actuel à 30 s pendant la transition et rapporter chaque repli. Ces objectifs sont à valider sur le matériel cible ; leur dépassement interdit d'annoncer la performance comme acquise.

Tester séparément une rafale de dix demandes identiques et de dix paires différentes, avec le pool configuré : CPU/mémoire bornés, absence de double engagement, saturation explicite et pas de dégradation non mesurée des autres consommateurs. Ne pas augmenter le nombre de workers pour masquer le coût du nouvel algorithme.

## 8. Livraison bornée

1. Versions locales persistantes et instrumentation des mutations, avec tests de cohérence ; maintien du solveur actuel.
2. Traversées certifiées, portails toriques et recherche abstraite pure ; corpus comparatif et repli fin.
3. Persistance des traversées et routes HDV, reprise après reboot, limites/éviction et réparation locale.
4. Intégration commerciale, contrôle transactionnel des dépendances, déduplication des demandes et diagnostics.
5. Recette fonctionnelle, concurrence, navigateur et performance ; documentation de l'existant mise à jour seulement après preuve.

Prévoir une bascule serveur permettant de revenir au solveur commercial actuel sans supprimer les caches ni réécrire les missions. Migration additive testée sur la base de test autorisée ; aucun seed/reset de développement ou production. Application de migrations, commit, push et déploiement ne font pas partie de la demande de spécification.

## Mesures locales du 18 octobre 2026

Validation fonctionnelle : 117 tests distincts sur 13 fichiers vérifiés sur plusieurs passages, build complet et lint complets verts, puis build API et lint ciblé après les dernières corrections. Recettes marché ordinateur et mobile terminées avec succès, chemin traversant la couture X, présence du porteur dans le renderer, crédits et libération à son retour ; captures inspectées. Les délais globaux de recette et de chargement des miniatures ont été adaptés au poste local, sans changer les délais métier. Régression du bosquet synthétique constatée rouge puis verte ; les neuf tests du cache ont passé ensemble après correction. Détails des passages et limites dans le handoff.

Corpus reproductible opt-in : `NAVIGATION_BENCHMARK=1 corepack pnpm exec vitest run apps/api/src/modules/navigation/hierarchical-benchmark.test.ts` (adapter l'affectation d'environnement au shell). Trente paires sur le substrat RC1 fixe, budget de recherche identique de 5 s, sans requête HTTP ni mutation de monde réel. Sortie ignorée : `test-results/navigation/rc1-corpus.json`. Campagne achevée avec succès ; poste de développement également occupé par les vérifications, donc aucune certification de charge ou SLA cible.

Cette campagne de trente paires précède la correction des raccords fins aux extrémités. Elle décrit la mesure historique de la tranche, pas un nouveau benchmark après ce correctif ; sa recette ciblée et ses régressions figurent dans le handoff.

| Cas | Trajets trouvés | Médiane | p95 | Maximum |
|---|---:|---:|---:|---:|
| Ancien solveur | 19/30 | 1 157 ms | 5 022 ms | 5 064 ms |
| Nouveau, index vide | 21/30 | 184 ms | 5 003 ms | 5 007 ms |
| Nouveau, index préparé | 30/30 | 354 ms | 1 473 ms | 2 382 ms |
| Ancien témoin, index du chunk de départ retiré | 30/30 | 95 ms | 295 ms | 499 ms |

La dernière ligne mesure la **recertification**, sans nouvel obstacle ; les réparations avec détour sont vérifiées fonctionnellement, sans p95 représentatif revendiqué. Les temps incluent les recherches expirées : les p95 à 5 s ne signifient pas une réussite dans ce délai. Préparation complète de l'index : 218 s, 262 144 octets hexadécimaux ; RSS final du processus comparatif : environ 409 Mio, comprenant le terrain et tous les modes. Ce préchauffage complet appartient au banc d'essai, pas au chemin interactif.

Trente relectures SQL après création d'un nouveau pool et trente hits RAM, avec lecture cohérente des versions et touche d'usage : SQL médiane 6,23 ms / p95 9,04 ms / maximum 195 ms ; RAM médiane 3,71 ms / p95 4,34 ms / maximum 4,42 ms. La dernière relance pendant compilation donne respectivement SQL 15,38 / 20,21 / 379,59 ms et RAM 8,33 / 10,33 / 10,73 ms, ce qui illustre la variabilité du poste. Ces payloads synthétiques ne mesurent pas le devis HTTP complet, les accès RC1, ni le coût économique d'acceptation. La reprise métier réelle est couverte séparément avec un nouveau pool et un exécuteur qui refuse tout calcul.

Limites restantes : monde totalement froid encore susceptible d'épuiser 5 s (budget interactif conservé à 30 s), pas de préchauffage automatique, pas de campagne de charge HTTP multi-paires ni de recette du couple alpha sur le matériel distant. Les objectifs ci-dessus restent des objectifs dans ces conditions non mesurées.

## Références internes

- [Marché joueurs](SPEC-MARCHE-JOUEURS.md)
- [Monde et grille](architecture/world-grid.md)
- [Espace mondial et occupation](architecture/world-space-and-occupancy.md)
- [Workflow](AGENT-WORKFLOW.md)
- [Reprise courante](../SESSION-HANDOFF.md)

# Installation RC1 — candidate de contre-recette

État au 10 octobre 2026 : **consolidation implémentée / intégrée, bloquée pour validation produit alpha** par la stabilité sous verrou décrite ci-dessous. Base installation/atlas `8903402`. Cette tranche prolonge l’[atlas](IMPLEMENTATION-ATLAS-RC1.md) et la [spec](SPEC-CARTE-SPAWN-RC1.md#7-parcours-suivant--starter-kit-et-terrassement). Les sections historiques restent séparées des preuves actuelles.

## Consolidation alpha — candidate issue de la base 8903402

Décision produit du 10 octobre : RC1 512 × 256 retenu pour le parcours alpha, ouverture visée le 11 au soir sous validation explicite. La consolidation couvre atlas, installation, construction et première exploitation bois/pierre. Les preuves précédentes restent historiques.

| Capacité | Existant et consommateurs | Raccord nécessaire |
| --- | --- | --- |
| Terrain | createSpawnTerrainField, editedRc1Field ; workers, readRc1Ground, chunks | Champ fin commun aux autorisations ordinaires ; identité et dimensions vérifiées |
| Emprises | poseStarterElement, spawnSurfacesAt, sélections de construction | Convention de rotation commune et contexte dimensionnel ; mêmes cellules pour pose et aperçu |
| Occupations / portée | worldCellOccupancies, candidates, assertBuildable, assertNoInfrastructure | Préparer les lectures une fois par emprise ; revalidation transactionnelle conservée |
| Portes | buildingAccesses, starterTownHallExits, recettes visuelles | Calculer les accès depuis le bâtiment déjà transformé ; recette compatible pour le fantôme |
| Navigation | buildTravelNetwork, refineTravelRoute, canWalkSpawnSegment | Départ/approche identiques au diagnostic ; terrain fin et dimensions dans les adaptateurs économiques |
| Rendu | TerrainStore, rc1Height, terrain-unit, BabylonVillageScene | Hauteur continue distincte de l’index ; terrasses et mises à jour multi-client |
| Visibilité | readTerrain, knownGeography, atlas public | Politique préparatoire distincte de preview ; aucune quantité/réservation/occupation étrangère dynamique |
| État courant | App.applySnapshot, SpawnPlacement | Diagnostic alimenté par le dernier snapshot accepté, réponses anciennes refusées |


## Preuves de consolidation du 10 octobre (base auditée : 8903402)

Les assertions précédentes sur la pose ne valaient pas validation de la cohérence spatiale. Reproductions réellement rouges avant correction : six orientations d’accès à 90°/270°, interpolation du relief arrondie, construction payante réussie contre la roche en (194,251), avec débit de bois. Les corrections ont ensuite passé leurs régressions. Aucun changement du JSON approuvé : SHA256 fichier `de165c395c26eb70572a4370d9a537661e9eaf78b477e1694cfda283418702a4` ; checksum canonique conservé séparément.

Capacités effectivement raccordées :

- `transformFootprint` : `poseStarterElement` et `fixedBuildingFootprint`. Ce dernier sert les sélections client Université/tailleur et les commandes/contrôles serveur correspondants. `rotateSpawnPoint` porte également la convention de `buildingAccesses` ; le planificateur de dotation pose maintenant la vraie définition du HDV avant d’en lire les portes.
- `withinBuildReach` : pose restante du kit et contrôle d’emprise payante ; sources éligibles chargées par chaque politique. `withinDepositRange` : détails/commande d’exploitation et admissibilité des mini-gisements de dotation. **16 cases** validées par Tristan, distance de Chebyshev depuis les cellules terminées ; aucune exemption starter. Le parcours reste obligatoire et les gros gisements peuvent demander une extension du village.
- `assertBuildableCells` prépare terrain fin, occupations, protections et emprises terminées une fois pour la surface contrôlée. Ses consommateurs sont pose ordinaire simple, surface/composition, extension de Jardin et agrandissement du campus. Les frais et délais ordinaires restent appliqués. Le terrain détaillé participe aussi à `canBuild` et aux transitions d’infrastructure ; supprimer un aménagement n’exige pas de rendre son ancien sol constructible.
- `readRc1Ground` conserve le substrat vérifié, relit les modifications locales et fournit le terrain de navigation aux trajets de village, à l’exploitation et au contrôle d’accès d’infrastructure. Samples et segments sont mémorisés dans le contexte de calcul ; la projection entière n’autorise aucune emprise fine. Une marche à la sortie d’une terrasse reste bloquante pour le piéton.
- `recipeFor` / `bakedPlanKey` : bâtiment confirmé et fantôme. Le HDV à porte +X utilise sa recette réelle. `clonePreviewMaterial` conserve les textures sources en lecture seule : cloner une texture dynamique Babylon créait une texture vide et rendait le HDV fantôme invisible. Régression et capture navigateur après correction. Les aperçus se reprojettent lorsque le terrain streamé arrive.
- Hauteur continue séparée de l’indexation dans `TerrainStore` ; picking RC1 sur les triangles réellement rendus. Synchronisation du dernier snapshot accepté entre App et le diagnostic du kit, avec refus des réponses plus anciennes. Helper UUID existant réutilisé.

Lecture d’arrivée : compte authentifié, monde RC1 ouvert/prêt, géographie et modifications locales publiques ; dépôts sérialisés à null, occupations dynamiques vides. Le privilège de preview opérateur n’est plus utilisé. La recette HTTP avec un autre compte contrôle les champs effectivement sérialisés.

Recette navigateur achevée sur copie jetable, API compilée et frontend e2e : atlas → choix (140,20) → Construire, fantôme complet visible, rotation R, HDV manuel, Population/Exploitation déverrouillés ; maison ordinaire (142,20) à 25 bois ; retour au kit avec case occupée rouge ; Jardin (138,19) gratuit ; rechargement avec trois éléments restants et 1 975 bois. Le parcours de pose a réellement utilisé HTTP sur 192.168.1.4, `isSecureContext=false` et `crypto.randomUUID===undefined`. Un second client a vu passer les terrasses de [] aux deux cellules du HDV, sans occupation privée exposée. Captures relues, aucune erreur JS applicative relevée. Navigateurs, proxy LAN et fixture dédiés fermés/nettoyés ; la démo antérieure est conservée.

La boucle économique est prouvée par les commandes serveur réelles sur monde isolé : installation, construction payante, départ bois/pierre, réservations/cohortes et trajets, puis réconciliation à la borne de retour des deux missions. Résultat : +100 bois et +100 pierre, missions terminées. Le temps est avancé dans la fixture ; ce n’est pas une attente chronométrée de dix minutes dans le navigateur.

Mesures locales (Windows, PostgreSQL test partagé, démo antérieure conservée) : première copie non projetée 10 288 ms ; installation suivante 18 645 ms ; workers 7 294 / 6 174 ms. Concurrent ciblant le même site : attente du verrou spatial observée dans PostgreSQL, puis refus après revalidation, durée totale 12 707 ms. Cette durée comprend attente et traitement, ce n’est pas une mesure pure du verrou. En présence de compilation et de deux clients graphiques : 7 998 / 42 395 ms, workers 2 086 / 14 419 ms, opération concurrente 48 095 ms. Ne pas comparer ces séries comme un benchmark avant/après. La projection immuable n’explique pas à elle seule le coût : la seconde installation est plus lente. Aucun déplacement aveugle de la projection ou relâchement des verrous n’est livré.

Le scénario contre la roche, étendu à la construction composée et à l’équipement, a dépassé 120 s avant mémorisation des segments. Il passe ensuite en 55 145 ms (durée du scénario entier). La reprise manuelle a rencontré à plusieurs reprises le lock_timeout de cinq secondes sur le village, puis passe seule en 98 925 ms sous compilation concurrente. L’observation PostgreSQL de cette dernière exécution montre une transaction attendant la ligne village détenue pendant les lectures spatiales ; elle n’attribue pas rétrospectivement les deux échecs à un processus précis. Le délai de verrou configuré n’a pas été augmenté pour faire passer la preuve. Ces résultats ne démontrent pas une latence acceptable ni l’absence de refus intermittent.

### Matrice de preuve de cette consolidation

| Frontière | Preuve réellement exécutée | Portée / réserve |
| --- | --- | --- |
| Roche (194,251) après HDV (189,246) | Commandes simple, surface et équipement refusées ; stocks, occupations, bâtiments, notifications et reçus inchangés | Cas canonique sur l’artefact signé |
| Rotations / coutures | 12 cas portes HDV aux quatre tours, X/Y/coin ; tests trajet cardinal, emprises et portée aux coutures | Pas quatre installations navigateur complètes aux coutures |
| Terrasse / navigation | Lèvre admissible au terrassement mais refusée entre porte et nœud extérieur ; obstacles intermédiaires dans les segments | Kit et piéton conservent deux politiques distinctes |
| Picking | Hauteur continue et rayons contre triangles sur pente et terrasse ; recette visuelle de pose | Pas campagne exhaustive de toutes les inclinaisons de caméra |
| État / reprise | Navigateur HDV → maison payante → refus rouge sur occupation → élément gratuit → rechargement | Réponses anciennes filtrées par borne serveur ; pas de réseau artificiellement réordonné en navigateur |
| Aperçu devenu périmé | Deux installations visent le même point ; barrière, attente PostgreSQL, seconde revalidation refusée sans village résiduel | Occupation changée dans le monde, pas simple lancement de deux promesses |
| Terrain multi-client | Second client relit les deux terrasses HDV après pose | Lecture réellement observée ; pas deux caméras animées comparées pixel par pixel |
| Arrivée / LAN | HTTP préparatoire d’un autre compte : aucun stock/réservation/occupation ; pose en HTTP LAN sans crypto.randomUUID | Géographie et terrasses publiques conservées |
| Économie | Commandes bois et mini-pierre, réservation, retour et crédits +100 / +100 | Horloge de retour avancée dans la transaction de test |

Build racine et lint racine terminés code 0. Les six suites finales géométrie/navigation/portée totalisent 61 tests verts ; les suites rendu, UUID, terrain, sélection et dotation ont également passé dans des processus distincts. Ne pas additionner leurs passages répétés. Dernière campagne DB : **8 passent / 1 échoue**, 210,85 s ; reprise du kit encore refusée par lock_timeout village. Contre-exemple roche étendu : 27 480 ms. Première installation 7 345 ms, suivante 22 101 ms, workers 2 412 / 5 023 ms ; opération concurrente 16 628 ms au total. Ce dernier passage ne remplace pas un échec par un ancien résultat vert. Pas de suite globale réinitialisant la base partagée.

### Verdict et suite bornée

**Candidate implémentée et intégrée, bloquée pour la validation produit alpha par des points identifiés.** Le parcours nominal est démontré ; la robustesse et la latence sous contention ne sont pas établies. Priorité avant feu vert : profiler séparément lecture spatiale, planification et snapshot sous verrou sur une fixture avec worker de la même candidate, reproduire l’attente village → pose restante, puis réduire la durée de rétention sans déplacer la borne économique ni supprimer la revalidation dynamique. Les essais à 5 s en échec restent une réserve, même après un passage vert. Cette réserve est technique et ne demande aucun changement de règle de jeu.

Améliorations différables par rapport au premier bois/pierre : fidélité des volumes rocheux, excavation visuelle des infrastructures et navigation scientifique/lointaine. Le premier parcours économique utilise le champ RC1 ; cette livraison ne certifie pas tous les appelants historiques ni tous les autres parcours du jeu. La suite complète DB avec reset n’a pas été lancée pour préserver la démo existante. Aucune ouverture publique, migration de développement ou opération prod/staging.

Les sections suivantes décrivent la candidate précédente et ses preuves historiques.

## Parcours et réemploi

`SpawnPlacement` charge le kit et le terrain puis fournit un état local de préparation à **App → VillageScene → BabylonVillageScene**. Aucun village ni compte économique n’est créé par cet état de rendu. Le HUD ouvre **Construire**, avec seulement **Village initial** et **Hôtel de ville**. Population, Exploitation et le bouton de gestion des habitants sont indisponibles avant l’HDV confirmé par le serveur. Après sa pose, les modes deviennent accessibles ; les éléments gratuits restants et les constructions ordinaires se trouvent dans Construire.

La scène de pose séparée a été retirée après le rappel de Tristan. Picking, gestes, coordonnées toriques, bordures, streaming et palette sont ceux du village. `previewCells` sert aux emprises ordinaires et composées. Le diagnostic spécialisé adapte les règles RC1 (nettoyage gratuit, voisins, territoires) à cet aperçu ; il ne possède ni caméra ni moteur de scène. Le serveur recontrôle chaque pose.

L’aperçu du kit est un groupe conservé en cache, chargé depuis les assets de bâtiments précalculés existants ; mouvements et rotations ne reconstruisent pas leur géométrie. Les clones de présentation permettent des matériaux transparents sans modifier les instances des bâtiments posés. Les jardins utilisent leur surface de prévisualisation. R tourne une fois par pression ; clic gauche pose ; clic droit / Échap sélectionne le placement manuel, HDV en premier.

## Autorité et persistance

- Migration additive **038** : installation/version de kit, inventaire restant, reçus de commandes, terrasses et provenance des agrégats naturels. Appliquée uniquement à `127.0.0.1/arbestra_test`.
- Pose initiale : compte, nouveau village, verrou spatial du monde, snapshot frais, calcul borné en worker, puis écritures dans une transaction. Le timestamp économique suit l’acquisition des verrous. Source RC1 inchangée ; les terrasses et indices d’arbres retirés sont des ajouts séparés.
- Pose restante : propriétaire et `world_id`, `beginVillageEconomy`, règles d’emprise à la hauteur initiale, portée de construction existante, consommation d’un élément identifié. Retry conservant la même commande ; aucune nouvelle population ou dotation.
- Première projection naturelle : **2 000 pierres par formation `stoneSite`** (28 formations, pas 177 rochers décoratifs). Bois à 500 par arbre, stock regroupé par agrégats de 4 × 4 cases ; pas d’entité persistante par arbre décoratif.
- Compléments : deux mini-gisements de 150 et deux grands de 2 000 ; bois seulement si nécessaire, deux bosquets de trois arbres. Marges et trajets sont vérifiés sur le champ RC1. Un échec annule aussi ressources, occupations, stocks et terrasses.
- Sol détaillé : champ approuvé + terrasses, patches de demi-case dans les chunks du renderer existant. Une projection entière de 128 chunks fournit les données nécessaires aux lectures historiques et aux premiers relevés. Elle n’est pas la source d’autorité des emprises RC1.
- Les bosquets pleins et correctement occupés utilisent le même prédicat économique de réconciliation, exprimé par lectures séparées indexables ; les `EXISTS` corrélés donnaient des temps excessifs avec les agrégats RC1. Ni ordre des verrous ni échéance économique modifiés.

## Routes ajoutées

| Route sous `/api/worlds/:slug` | Usage |
| --- | --- |
| `GET /starter` | Kit figé et installation du compte |
| `GET /starter/terrain?chunks=…` | Streaming authentifié avant HDV |
| `POST /starter/inspect` | Diagnostic sans pose |
| `POST /starter` | Pose initiale groupée ou HDV seul |
| `POST /villages/:villageId/starter` | Pose d’un élément restant |

L’entrée lobby RC1 mène à l’atlas ; le join automatique historique refuse ce parcours. Les mondes v2 conservent leur entrée actuelle. Aucune recherche automatique de position de village n’est ajoutée.

## Preuves de cette session

- Tests DB isolés : pose groupée et manuelle, stocks/population, projection pierre, lecture village/terrain, reprises idempotentes, refus d’artefact changé, rollback injecté après écritures attestées, réconciliation de bosquet, concurrence avec barrière et attente PostgreSQL observée. Les six cas ont passé dans des processus terminés ; voir le handoff pour le découpage exact des exécutions.
- La lecture village présente quatre sites logiques pour cinq bâtiments persistants : les deux jardins contigus sont un seul site avec deux parcelles. L’assertion initiale de cinq sites a été corrigée, sans changer ce comportement du jeu.
- Recette navigateur manuelle sur monde jetable : HUD limité avant HDV, R, clic droit, pose HDV, accès aux autres modes, reconnexion avec quatre éléments restants, puis deux maisons et deux jardins placés par Construire. Stocks initiaux 2 000 bois / 50 carottes et population 15 conservés. Le kit disparaît lorsqu’il est consommé. Captures locales sous `test-results/`, exclues du dépôt.
- Recette groupée sur API et frontend compilés : pose à (140,20), inventaire restant vide confirmé par API, quatre sites logiques visibles, 15 habitants / capacité 40, stocks 2 000 bois / 50 carottes. Les panneaux Population et Exploitation s’ouvrent après pose ; captures relues, aucune erreur JS applicative relevée. Les fixtures de ces deux parcours et leurs comptes ont été nettoyés et leur absence vérifiée.
- Build et lint racine terminés avec succès. **41 tests distincts** ont chacun passé dans plusieurs exécutions terminées (détail en tête du handoff), sans revendiquer une campagne unique complète.
- Les premiers essais ont exposé une lecture village sans chunks, une prévisualisation transparente appliquée à des instances, des requêtes lentes et une attente de verrou de cinq secondes trop courte pour la première projection. Corrections et essais ultérieurs consignés ; les essais échoués ne sont pas comptés comme verts.

## Contre-recette et audit demandés

Sur une copie de test dédiée, migrer et utiliser la fixture `tests/browser/spawn-map-fixture.mjs --built`. Elle crée uniquement son monde/compte et refuse une cible différente de `127.0.0.1/arbestra_test`. Elle expose un compte jetable et une URL ; fermer via stdin pour nettoyer. Ne pas réinitialiser la base pendant une fixture active. Le point historique de recette (140,20) est une entrée de test, pas une recommandation automatique au joueur.

Rejouer atlas → préparation → groupé et manuel, quatre orientations, refus d’occupation/eau/roche, retry, déconnexion, accès Population/Exploitation avant/après HDV et absence de redotation. Vérifier visuellement le terrassement et les arbres conservés avec un second client connecté. Vérifier également clavier et tactile sur les dimensions cibles.

Axes d’audit prioritaires :

1. Ordre des verrous, atomicité de la première projection et de la pose, concurrence compte/monde, réponses périmées et reprise après résultat réseau incertain.
2. Emprises/portes/orientations communes au kit, aux bâtiments posés et aux chemins ; collision fine versus grille historique.
3. Projection économique naturelle, arbres retirés d’un agrégat et accessibilité réelle des dépôts ; pas de crédit lié aux seuls meshes.
4. Coût du premier spawn : génération de la projection sous verrou spatial, sérialisation de l’artefact, diagnostics et lectures économiques. Les mesures locales varient fortement ; aucun budget de latence garanti.
5. Fidélité du renderer RC1 et frontières d’intégration : le rendu courant utilise une palette simple et des volumes rocheux simplifiés ; la branche détaillée RC1 ne reprend pas encore l’excavation visuelle des routes/infrastructures du terrain historique. Tous les appelants historiques de navigation/relevés ne consomment pas encore le champ fin RC1. Ces points restent à traiter avant une ouverture publique ; la recette de pose ne les certifie pas.

La suite applicative complète et les parcours économiques complets RC1 ne sont pas certifiés par cette livraison. Les tests isolés évitent le reset de la base partagée où subsiste une démo antérieure. Aucune migration de développement, ouverture publique, configuration VPS ou livraison prod/staging effectuée.

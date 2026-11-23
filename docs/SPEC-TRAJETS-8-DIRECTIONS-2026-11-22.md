# Trajets à 8 directions et recherche à la case

22 novembre 2026, sur `fd7d699`. Statut : **spécification validée par Tristan le 22 novembre** sur ses deux décisions (§1) ; le reste est la cible technique, à vérifier contre le code par chaque tranche avant de coder.

Contexte : [audit du 22 novembre](AUDIT-GLOBAL-2026-11-22.md) §2, [spec de la refonte des trajets](SPEC-REFONTE-TRAJETS-2026-11-10.md) (T1 à T3 livrées, T4 à T6 non faites). Cette spec **remplace T5** (invalidation locale) et prépare T4 et T6.

## 1. Décisions de Tristan (22 novembre)

- **Décision 23.** Les trajets à pied peuvent aller en diagonale (8 directions). Un pas en diagonale coûte √2 fois un pas droit, en durée comme en coût : la règle « coût = durée » (décision 8) est conservée. Un trajet en biais dure donc jusqu'à 29 % de moins. Remplace le « piéton cardinal » de la décision 11.
- **Décision 24.** La refonte du cœur de recherche se fait maintenant, par remplacement : l'ancien code est supprimé dans la même série. Une seule recette de Tristan, sur le résultat final (sentiers en diagonale compris).

## 2. Constat mesuré

Le 22 novembre, sur le dev (Bressuire), la tâche `deposit.worksite.wake` qui a admis trois départs de défrichage (trajets de 34 à 44 cases) a duré **8,2 s** (due 17:00:39,04, terminée 17:00:47,26), sous la ligne du village. Cause probable, à confirmer par profil en R1 : recherche au huitième de case (64 nœuds par case dans les cases boisées), test physique refait à chaque pas, égalités massives de la distance en L.

La contrainte cardinale est présente à sept niveaux : les cinq recherches (4 voisins, Manhattan) ; `canWalkSpawnSegment` (erreur sur un segment non cardinal, `spawn-access.ts:25`) ; `travelDuration` (|dx| + |dy|) ; `desireEdges` et `world_desire_edges` (directions est et sud, diagonales jetées) ; le rendu (tracés, braseros, raccords) ; les promenades client ; la décision 11.

## 3. Cible

### 3.1 Modèle de chemin

Un chemin de mission est une suite de **centres de cases** reliés par des pas unitaires vers l'un des 8 voisins, plus un connecteur de porte à chaque extrémité qui en a une (seuil, point extérieur, premier centre). Un pas dont la ligne droite est gênée par un obstacle plus petit qu'une case (tronc, accessoire) porte un **détour local** au huitième de case, contenu dans ses deux cases. Le chemin persisté reste une liste de points `TravelCell` : les chemins cardinaux déjà persistés restent valides, animation et durée comprises.

### 3.2 Praticabilité précalculée par chunk

Le maillage par chunk existe déjà pour le commerce : `ChunkNavigationMesh` (`contracts/src/chunk-navigation-mesh.ts`, 2 bits par arête cardinale dirigée), table `navigation_chunk_meshes`, invalidation par `navigation_chunk_versions`. **On l'étend, on n'en crée pas un second.**

- Par case, 4 arêtes non dirigées (est, sud-est, sud, sud-ouest), 2 bits chacune : inconnue, bloquée, droite, coudée (détour local). Le test de pente et d'obstacle est symétrique ; à vérifier.
- Une arête est certifiée une fois, à la demande, par le test physique existant généralisé aux segments obliques ; si la ligne droite est bloquée par un obstacle fin, par une petite recherche au huitième bornée aux deux cases (128 nœuds au plus). Le résultat est rangé dans le maillage du chunk et persisté.
- **Diagonale** : permise seulement si elle est certifiée droite et si les quatre arêtes cardinales du carré qu'elle traverse sont praticables. Aucun passage entre deux coins.
- Tout ce qui bloque aujourd'hui une recherche de village doit bloquer ici : emprises, réservations, gisements bloquants, eau, pentes, troncs, bordures, accessoires. Les parcelles de jardin actives restent traversables au coût `GARDEN_CROSSING_COST`. R1 commence par l'inventaire des écarts entre le contexte de village (`refineTravelRoute`) et le contexte mondial (`navigation/context.ts`), et l'écrit au §6.
- Nouveau format : nouvelle version de politique (`rc1-pedestrian-2`) ; les maillages de l'ancien format sont ignorés puis purgés.

### 3.3 Une seule recherche

A* sur les cases, 8 voisins, heuristique octile × 0,7.

- **Coût d'un pas** : longueur (1 ou √2) × moyenne des facteurs de ses deux cases (0,7 pour une case de route, 1 sinon) × facteur jardin. `travelDuration` applique la même règle au chemin persisté, en longueur euclidienne par segment ; pour un chemin cardinal existant le résultat est inchangé.
- **Départage à coût égal**, déterministe : le moins de changements de direction. Le coût et la durée n'en dépendent pas.
- **Borne** : les cases du domaine (région du village), et non plus cases × 64. Les trois issues `found`, `unreachable`, `budget` de T2b sont conservées, avec leur sémantique.
- **Aucun cache de routes** : la recherche doit être assez rapide pour s'en passer. Seul le maillage est mis en cache. Les caches `networkCache`, alias, `refinementCaches` et `passageCaches` disparaissent avec le code qu'ils servent.
- Cette recherche sert les missions de village (bois, pierre, souches, jardins par jambes, science locale). Commerce et expéditions y passent ensuite (R3) ; d'ici là leur planificateur continue de fonctionner sur le maillage étendu ou sur son test direct.

### 3.4 Sentiers, rendu, braseros (R2)

- `world_desire_edges.direction` : 0 est, 1 sud, 2 sud-est, 3 sud-ouest (migration additive, contrainte élargie). `desireEdges` compte les pas en diagonale au lieu de les jeter. L'entité V2 `desirePaths` gagne `southEast` et `southWest` ; client et serveur se déploient ensemble.
- Rendu : sentiers de terre en diagonale, raccordés aux cases de route (qui restent carrées) et aux autres sentiers.
- Braseros automatiques : aux **carrefours** (trois bras ou plus) et aux **extrémités**, plus aux simples coudes. Les identités par nœud restent stables : un brasero éteint ou supprimé le reste.
- **Sentier battu** (proposé par défaut, constante réglable) : un pas le long d'un sentier visible coûte 0,9. Les trajets se regroupent sur les sentiers existants au lieu de tracer des colonnes parallèles. Effet sur les durées : 10 % au plus sur la part du trajet qui suit un sentier. À confirmer par Tristan à la recette ; 1 désactive.
- Seuil d'apparition : inchangé (3 passages par bord). À rejuger à la recette, une fois les trajets regroupés.
- Promenades de loisir du client : 8 directions sur les sentiers et les routes.

## 4. Tranches

| Tranche | Contenu | Dépend de |
|---|---|---|
| **R1** | Profil des 8,2 s ; maillage étendu ; recherche à la case à 8 directions pour les missions de village ; `travelDuration` euclidienne ; suppression de la recherche fine, de ses raccourcis et de ses caches ; mesures avant et après | — |
| **R2a** | Sentiers en base et dans le flux V2 à 4 directions ; `desireEdges` ; conversion en routes d'affichage | — (interface du §3.1) |
| **R2b** | Rendu des diagonales, raccords, braseros aux carrefours, sentier battu, promenades | R1, R2a |
| **Recette** | Tristan, dev local, mode 0 | R2b |
| **R3** | T4 (retrait du réseau « tous buts », du drapeau, de la recherche grossière), commerce et expéditions sur la recherche unique, calcul hors verrou si encore utile (T6) | Recette |

## 5. Critères d'acceptation

- **Vitesse (R1)** : sur le dev, les trois trajets de défrichage du 22 novembre (hôtel de ville vers (259, 216), (258, 219), (262, 223)) : avant et après, à froid et maillage chaud. Cible : moins de 50 ms par trajet maillage chaud, moins de 500 ms à froid. Un dépassement est rapporté avec son profil, pas masqué.
- **Équivalence d'accessibilité (R1)** : sur les fixtures existantes (douves, jardins enclos, cibles en forêt, couture du tore, portes), mêmes verdicts `found` / `unreachable` qu'avant ; tout écart est listé et expliqué. Coût du nouveau chemin ≤ coût de l'ancien, à l'arrondi près, hors détours locaux.
- **Test déterministe de chemin chaud (R1)** : nombre de certifications d'arêtes borné par trajet maillage chaud (zéro), et nœuds visités ≤ cases du domaine.
- **Diagonales** : aucune entre deux coins d'emprises ; test dédié.
- **Durées** : chemin cardinal persisté, durée inchangée au milliseconde près ; chemin en biais, durée √2 par pas diagonal.
- **Sentiers (R2a)** : un pas diagonal compte un passage sur son arête ; aller-retour compté une fois ; couture du tore ; migration réversible.
- **Invariants conservés** : ordre des verrous, admissions, énergie sur durée figée, `world_id`, coordonnées canoniques, aucune écriture nouvelle dans les transactions de commande.
- **Suppression** : à la fin de R1, `refineTravelRoute` et ses caches n'ont plus d'appelant de mission ; ce qui ne sert plus qu'au réseau d'affichage est marqué pour R3.

## 6. Inventaire et écarts (R1, 22 novembre, sur `0eb07d3`)

### 6.1 Profil des 8,2 s

Banc : `apps/load-test/src/bench-village-paths.ts`, en lecture seule (transaction `read only` annulée) sur la base de dev, connexion par la configuration de l'API. Cibles réelles du 22 novembre : (259, 216), **(258, 220)** (et non (258, 219) : lu dans `harvest_submissions`) et (262, 223). L'état du sol à 17:00 est reconstitué en remettant debout les 11 troncs abattus depuis (`--restore-trees`).

- **Les 8,2 s ne sont pas la durée de la tâche `deposit.worksite.wake`.** `scheduled_tasks.completed_at` vaut `transaction_timestamp()`, le *début* de la transaction de la tâche : celle-ci a commencé à 17:00:47,261, 8,2 s après son échéance, et ses lots sont partis à 47,291 (borne économique lue après le verrou). La tâche elle-même a duré quelques dizaines de millisecondes. L'attente vient du planificateur : la passe qui traitait la tâche précédente, `harvest.intent` (commencée à 38,943, elle a créé la tâche de réveil), l'a enchaînée en fin de traitement ; les deux autres passes étaient au repos et une nouvelle ronde ne démarre qu'à la fin de toutes les passes (`startScheduledTaskWorker`). Les 8,2 s sont donc, pour l'essentiel, la durée de `harvest.intent` (trois cases en défrichage, trois recherches `stoneTravelPath`).
- **Les recherches ne l'expliquent pas.** Rejouées, sol reconstitué : trajet complet (`stoneTravelPath`, contexte compris) 82 à 394 ms à froid, 11 à 98 ms ensuite ; recherche seule 24 à 260 ms à froid, 17 à 34 ms à chaud. **Zéro nœud** de recherche fine visité : le témoin `planRoute` répond à chaque fois. La recherche fine complète (celle des jambes de jardin, sans témoin) : 888 à 2 245 nœuds, 105 à 152 ms à froid, 55 à 73 ms à chaud, dont 37 à 76 ms de lectures du sol (17 000 à 30 000 échantillons). Par la voie de calcul du serveur (un worker neuf) : 1,75 s de démarrage, 1,15 s pour le premier trajet (transfert et analyse de la géographie), puis 62 à 124 ms.
- **Non expliqué** : environ 5 s. Candidats non départagés en lecture seule : redémarrage de l'API de dev (worker froid, ≈ 3 s mesurées ci-dessus), réconciliation économique, attentes de verrous (bornées à 1,5 s par instruction). L'hypothèse du §2 (recherche au huitième de case) n'est **pas confirmée** ; R1 reste justifiée par les décisions 23 et 24, et ses critères de vitesse du §5 se mesurent sur le même banc.

### 6.2 Ce que bloque chaque contexte

| Obstacle | Village (`refineTravelRoute`, `prepareRefinement`, `land`, `walk`) | Monde (`navigation/context.ts`, `compute-worker.ts`) |
|---|---|---|
| Domaine | Région du village ; hors région = bloqué | Tore entier |
| Eau | Code de terrain de la case ≠ 1, et échantillons non secs | Échantillons non secs |
| Pente, roches, troncs | `canWalkSpawnSegment` sur le sol (pente 0,25, largeur ±1/16) | Idem, même champ RC1 et mêmes troncs |
| Emprises et réservations | Toute emprise de la région bloque la case (chantier, agrandissement en attente compris) | Toute occupation du monde bloque l'échantillon de sa case |
| Jardins actifs | Traversables, ×30 hors jardins des extrémités | **Bloquants** (occupation) |
| Gisements | Affleurement non épuisé, chantier de nivellement : case bloquée ; bois : seulement hors RC1 | Chantier de nivellement bloquant ; affleurement : seules ses roches physiques |
| Bordures | `infrastructureBlockedPixels` : ensemble **vide** depuis la refonte des trottoirs | Absentes |
| Accessoires de route | Carré de ±1/8 | Carré de ±1/8 |
| Exceptions | Case de destination admise (missions de ressource) ; emprise du bâtiment de la porte pour son connecteur | Emprise du bâtiment de l'accès ; cibles occupées des mondes historiques |
| Coût | Pixel de route 0,7 par huitième ; jardin ×30 | Pixel de route 0,7 par huitième |

Écarts : jardins (traversés contre bloqués), affleurements (case contre roches), domaine (région contre tore). Les bordures ne bloquent plus nulle part. Symétrie du test physique : pour un segment unitaire cardinal, les points échantillonnés à l'aller et au retour sont les mêmes (l'actuel `ChunkNavigationCache` l'exploite déjà) ; un test le vérifie aussi pour les diagonales.

### 6.3 Choix retenus (techniques)

- **Le maillage ne porte que la physique du sol** (eau, pente, roches, troncs), la seule partie commune et lente. Tout ce qui dépend du village ou de la mission (domaine, code de terrain, emprises, réservations, gisements, jardins, case de destination) est un **masque par case** appliqué par la recherche avant de lire le maillage ; les accessoires de route (rares, sur les routes) sont vérifiés à chaque recherche sur les seules cases qui en portent. Ainsi le masque du village garde exactement ses règles d'aujourd'hui, et le contexte mondial garde les siennes : les écarts du §6.2 sont conservés, pas unifiés, faute de décision qui les tranche.
- **Un seul format** : `ChunkNavigationCache` passe à 4 arêtes non dirigées par case (est, sud-est, sud, sud-ouest ; 2 bits : inconnue, bloquée, droite, coudée). Le commerce l'utilise sur son propre champ, avec la même interface `walk` ; `ROUTE_POLICY_VERSION` passe à `rc1-pedestrian-2`, donc ses maillages persistés de l'ancien format ne sont plus lus (autre espace de noms) et sortent par l'éviction existante. Pas de migration.
- **Maillage du village en mémoire**, par révision du sol, dans le processus qui calcule (worker ou appel direct) : le persister demanderait une écriture hors des transactions de commande et un rattachement des abattages aux versions de chunks. Non fait en R1 ; « à froid » désigne donc un maillage vide.
- **Point d'ancrage** : le nœud d'une case est son centre, sauf si un tronc ou une roche le couvre ; il est alors le point libre le plus proche au huitième, dans la case. Sans cela, une case boisée dont le centre est pris deviendrait infranchissable alors que l'ancienne recherche la traversait.
- **Coût d'un pas = sa durée** (décision 8) : la règle exacte de `travelDuration` (pixel de route par sous-pas d'au plus un huitième, en longueur euclidienne), fois le facteur jardin. Pour des cases de route pleines, c'est la moyenne des facteurs des deux cases du §3.3.
- **Heuristique** : au lieu de l'octile × 0,7, le coût exact jusqu'à la destination sur le seul masque du village (sans physique), chaque pas à son plus petit facteur (0,7 sur une case de route, ×30 sur un jardin étranger), propagé à la demande depuis la destination. Borne inférieure cohérente, exacte en terrain libre : l'octile × 0,7 faisait explorer une ellipse entière dès qu'une route existe. Elle prouve aussi l'inaccessibilité par le masque sans physique, et la destination sans aucun point praticable est refusée avant la recherche.
- **Départage** : un changement de direction ajoute 10⁻⁷ à la clé de recherche seulement (jamais au coût ni à la durée), par case et non par (case, direction) : la borne « nœuds ≤ cases du domaine » tient.
- Une destination hors région (science, pierre lointaine) est atteinte par le dernier point local de son témoin grossier, la suite gardée telle quelle ; sans chemin local, `budget` (sémantique T2b).

### 6.4 Résultats (R1)

**Équivalence d'accessibilité**, mesurée par une sonde temporaire qui rejouait l'ancienne recherche fine à chaque recherche de mission pendant les suites existantes (sonde retirée) : 326 recherches, dont 139 dans les tests de `contracts` et 187 dans 16 fichiers d'intégration de l'API (pierre, bois, chantiers, jardins, science, installation, worker). **Mêmes verdicts partout** sauf deux écarts expliqués : (1) une route vers un **bâtiment** (destination de l'affichage seulement, aucune mission n'en a) : non prise en charge par la nouvelle recherche, l'affichage garde l'ancienne ; (2) une destination dont aucun point n'est praticable, que l'ancienne recherche bornée à 2 048 nœuds déclarait `budget` : la nouvelle la prouve `unreachable` d'emblée. **Durée nouvelle ≤ ancienne** sur les 289 chemins trouvés des deux côtés : rapport 0,70 à 1,00, médiane 0,84 (contracts) et 0,90 (API).

**Vitesse** (banc §6.1, trois trajets du 22 novembre, sol reconstitué ; recherche seule). Même session que les mesures « avant » (chargement du sol 510 ms dans les deux cas) : maillage froid 43 à 70 ms, chaud 8,5 à 28 ms ; 88 à 123 cases visitées sur 4 891, 314 à 451 arêtes certifiées à froid, **0 à chaud**. Avant : 24 à 260 ms à froid et 17 à 34 ms à chaud quand le témoin `planRoute` répondait, 105 à 152 ms et 55 à 73 ms pour la recherche fine complète. Durées des trois trajets : 29,3 s, 33,8 s, 37,0 s contre 32,3 s, 36,6 s et 42,3 s (−9 à −13 %). Des mesures plus tardives sur une machine chargée (chargement du sol 1,3 à 2,1 s, trois fois plus lent) donnent 136 à 916 ms à froid et 23 à 169 ms à chaud : le critère des 50 ms n'est tenu que sur machine au repos.

**Durées** : un chemin cardinal garde sa durée au milliseconde (même découpage en sous-pas, même ordre d'addition) ; un pas diagonal vaut √2 (1 414 ms). Les animations du client mesuraient déjà les segments en longueur euclidienne.

**À retirer en R3** (ne sert plus qu'au réseau d'affichage « tous buts » ou au couloir grossier de `stoneTravelPath`) : `refineTravelRoute`, `prepareRefinement`, ses raccourcis « queue certifiée » et « témoin `planRoute` », `passageCaches`, `networkCache` et ses alias, `buildTravelNetwork` (dont le couloir de `stoneTravelPath` au-delà de 32 cases et la jambe en L au-delà de 128).

## 7. Journal des tranches

Les mesures et preuves de chaque tranche vont dans son commit ; cette section ne reçoit qu'une ligne de statut par tranche.

- **R1** (22 novembre) : **validée le 23 novembre**. Recherche à la case en 8 directions pour toutes les missions de village, maillage étendu, `travelDuration` euclidienne, recherche fine des missions et `refinementCaches` supprimées ; profil et résultats au §6.
- **R2b** (22 novembre) : **validée le 23 novembre**. Sentiers diagonaux dessinés (bras jusqu'au coin partagé, éperon dans le coin d'une case de route), braseros automatiques aux carrefours et aux extrémités seulement (règle partagée, mode 1 compris), promenades à 8 directions, sentier battu à 0,9 (`DESIRE_TRAIL_COST`) dans la recherche et les durées des missions de village ; preuves et mesures dans les commits `9adeeb2` et `62d6f3f`.
- **Recette** (23 novembre, dev, mode 0) : **validée** par Tristan. Sentier battu 0,9, seuil de 3 passages et braseros aux carrefours et aux extrémités acceptés tels que vus. Défaut trouvé et corrigé pendant la recette (`2c4c356`) : le chantier de bois du client ne suivait pas le rebasage de la scène (équipe partie vers un arbre décalé de 32 cases) ; sans lien avec les 8 directions. Journal `scheduler.slow-task` de la recette : 15 fins d'extraction sur 27 au-dessus d'une seconde ; les cas de 6 à 11 s suivent tous un redémarrage de l'API (rechargement de la source RC1 : somme de contrôle, lecture et analyse, 1 à 4 s), les autres font 1,1 à 2,5 s, surtout en SQL (120 à 140 requêtes). **Pas de préchauffage** : en production l'API ne redémarre qu'au déploiement. Aucune mission lancée après le passage à l'API sans surveillance de fichiers : le délai clic-départ à chaud n'a pas de mesure propre.

## 8. R3 : inventaire et ordre (23 novembre, sur `fae9bcc`)

Lecture du code, rien de modifié.

**Ce qui appelle encore l'ancien réseau en production** :

- `presentation.ts` : calcule le réseau « tous buts » (`networkJob`, `village_travel_networks`) à chaque capture, même en mode 0, où le client l'ignore (`sync-v2-village-state.ts` remplace `travelRoutes` par les sentiers). C'est le coût de charge à supprimer.
- `stoneTravelPath` (`service.ts`) : au-delà de 32 cases de l'hôtel de ville, couloir grossier par `commandTravelNetwork` puis `refineVillagePath` ; au-delà de 128, jambe en L. En deçà, la recherche à la case seule.
- `desire-start.ts` (script T3d) : lit `presentation.travelRoutes` pour semer les sentiers d'un village à partir du réseau qu'il affiche.
- Commerce et expéditions : `planRoute` et `planHierarchicalRoute`, hors du réseau « tous buts ».

**Hors production** : `state()` sans report de navigation n'est plus appelé que par `legacy-commands.fixture.ts` ; `buildTravelNetwork` et `refineTravelRoute` gardent une soixantaine d'appels dans les tests de `contracts`.

**Contrainte d'ordre** : le script T3d a besoin de l'ancien réseau. Il doit donc tourner sur l'alpha avant que R3 retire ce réseau, sinon les villages de l'alpha perdent leurs sentiers affichés jusqu'à ce que les villageois les retracent. Deux ordres possibles : (A) déployer l'état validé sur l'alpha en mode 0 avec T3d, puis R3 ; (B) R3 d'abord, en gardant `buildTravelNetwork` pour le seul script jusqu'au passage de l'alpha. **Recommandé : A.** À trancher par Tristan (T3d écrit dans des données de joueurs).

**Tranches** :

| Tranche | Contenu | Dépend de |
|---|---|---|
| **R3a** | `stoneTravelPath` sur la recherche unique au-delà de 32 cases ; plus de couloir grossier ni de jambe en L | — |
| **R3b** | Retrait du drapeau, `pathSource` toujours `desire`, présentation sans réseau ni `village_travel_networks`, `travelRoutes` vide puis retiré du contrat | Alpha semée (ordre A) |
| **R3c** | Suppression de `buildTravelNetwork`, `refineTravelRoute`, `networkCache`, `passageCaches`, `commandTravelNetwork`, `desire-start.ts` et de leurs tests ; fixture sans réseau | R3a, R3b |
| **R3d** | Commerce et expéditions sur la recherche unique | À rejuger : leurs durées changent pour les joueurs |

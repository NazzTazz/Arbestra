# Navigation RC1 asynchrone — première intégration aux expéditions

Date : 12 octobre 2026. Base relue : main, be6532d94086112ebe97af6f4127f2ea7fa9f260.

Statut : **implémentée ; réserves fonctionnelles R1–R3 corrigées et vérifiées le 12 octobre ; recette globale encore à valider**. [Corrections et mesures](CORRECTIONS-EXPEDITIONS-RC1-ASYNCHRONES-2026-10-12.md), [contre-recette historique](CONTRE-RECETTE-EXPEDITIONS-RC1-ASYNCHRONES-2026-10-12.md) et [campagnes initiales](IMPLEMENTATION-EXPEDITIONS-RC1-ASYNCHRONES.md). Restent les preuves mémoire/endurance, le corpus froid complet et la recette visuelle/réseau. Migration 042 appliquée en test et en développement local (`arbestra`) ; API dev redémarrée sur le code actuel le 12 octobre. Les objectifs ci-dessous restent des critères de recette.

## 1. Décisions et frontière

**Validé par Tristan :** garder l'API légère et réactive, déléguer les calculs coûteux à des workers asynchrones et transmettre le résultat au client par SSE. Pour les expéditions d'un même village : **ordre de réception, sans réservation de cartographe pendant le calcul ; disponibilité vérifiée au départ réel**.

**Choix techniques de cette spec :** pool CPU TypeScript persistant et borné, intentions/reçus PostgreSQL, calcul hors transaction et admission transactionnelle courte, réveil SSE par LISTEN/NOTIFY avec rattrapage durable. Rust reste une optimisation ultérieure soumise à mesure.

**Aucun arbitrage produit bloquant restant pour ce périmètre.** L'ordre validé porte sur les expéditions asynchrones du même village. Il ne leur donne aucune priorité ni réservation vis-à-vis d'une récolte, d'une recherche ou d'une autre activité. Le premier demandeur peut donc être refusé si ses moyens ont été mobilisés entre-temps.

### Noyau réutilisable, première intégration scientifique

Extension du 16 octobre : le pool `NavigationCompute` est également utilisé pour les projections de réseau village HTTP/SSE. Ce job conserve l'algorithme de réseau existant et ses caches ; le moteur A→B et les règles d'expédition ci-dessous ne changent pas. Une file de lectures bornée partage la capacité CPU, sans connexion PostgreSQL pendant le calcul. Voir [synchronisation village](architecture/village-synchronization.md#calcul-du-réseau-dans-le-worker-de-navigation--16-octobre) pour les limites, erreurs et portée de cette extension.

La navigation a vocation à être utilisée ensuite pour rejoindre un combat et acheminer des ressources entre joueurs. **La première intégration métier est l'expédition ; le moteur géométrique ne dépend pas de la science.** Cette séparation fait partie des critères de livraison de la tranche.

| Responsabilité | Contrat de cette tranche | Réutilisation ultérieure |
|---|---|---|
| Moteur de trajets | Points/accès de départ et d'arrivée, contexte physique, profil de passage, contraintes de parcours, résultat géométrique versionné. | Même moteur pour un déplacement militaire ou commercial compatible avec les profils pris en charge. |
| Exécution CPU | Pool borné, corrélation de requête, limites de temps/mémoire, isolation, cache de contexte. | Le pool ne connaît ni cartographe, ni inventaire, ni règle de combat. |
| Orchestration métier | Intention et reçu d'expédition, FIFO du village, disponibilité du cartographe, admission, budget aller/relevé/retour, connaissance. | Combat et commerce fourniront leurs propres règles d'admission, priorités, réservations, arrivée et reçus. |

Un résultat found certifie un passage pour un contexte et un profil donnés. Il n'autorise pas une attaque, ne réserve pas une cargaison, ne promet pas une livraison et ne décrit pas le résultat d'une rencontre. Ces décisions appartiennent au métier appelant.

Le modèle A → B ne présume ni départ à l'hôtel de ville, ni destination dans le village d'origine, ni retour, ni cible immobile pendant toute la mission. Le métier résout des extrémités concrètes lors de la préparation et revalide leur pertinence à l'admission. Une poursuite/interception ou un recalcul en cours de mission demandera ses propres règles ; un trajet calculé vers une position datée ne suit pas automatiquement une cible mobile.

Une seule politique piétonne existante est réalisée maintenant. Son identifiant/version porte les règles de largeur, pente, obstacles et coût utilisées. De futurs profils pourront étendre ces règles lorsqu'ils seront spécifiés ; cette tranche n'ajoute ni chariot, ni taille d'armée, ni vitesse militaire. La réutilisation concerne le calcul et son exécution, sans table universelle de missions ni catalogue de mécaniques futures.

Le FIFO et l'absence de réservation validés ici restent **propres aux expéditions**. Leur application aux armées ou aux stocks échangés n'est pas présumée. La transaction d'admission d'un échange entre deux joueurs devra notamment définir ses propres droits, réservations et ordre de verrous ; celui d'un village scientifique ne peut pas être recopié implicitement.

### Inclus

- Les deux commandes scientifiques existantes survey et explore, proches ou distantes, depuis leur réception jusqu'au départ, au rappel et au retour.

- Un trajet piéton vérifié sur toute sa longueur dans la géographie RC1 : relief, eau, rochers, troncs, emprises, accès, équipements et voirie.

- Une demande durable, un résultat durable et un retour SSE rapide, y compris en cas de refus sans changement du village.

- Le raccord minimal de SciencePanel, App et du client API aux demandes en cours et aux reçus.

- La cohérence des nouvelles observations de terrain RC1 et la compatibilité des trajets scientifiques avec leurs consommateurs actuels.

- La régression des mondes historiques : conservation de leurs règles de terrain, passage par le même protocole asynchrone pour survey/explore.

### Hors périmètre

Implémentation du combat et du commerce entre joueurs ; migration générale des commandes économiques vers des jobs ; refonte du scheduler économique ; déport de toutes les projections SSE ; nouveau HUD Population ; nouvelle interaction de désignation d'objectif ; nouvelle règle de relevé à distance d'un obstacle ; accès distants d'exploitation généralisés ; navigation de chaque figurant ; système de foule ; transport/ponts/bateaux ; terraformation ; Redis/broker/microservice de navigation ; conversion Rust ; architecture générale de stores/bus/ECS.

Les chemins persistés de la science alimentent notamment les accès reconnus aux gisements : leur compatibilité est obligatoire, mais cette tranche ne promet pas de corriger tous les chemins de stoneTravelPath.

## 2. Résultat observable

Le joueur utilise les actions actuelles de relevé et de reconnaissance. Son ordre est enregistré rapidement et apparaît comme « Préparation de l'expédition… ». Il peut continuer à observer et utiliser le village.

La préparation se termine par un départ confirmé ou un motif de non-départ. Une simple réception HTTP ne crée ni mission, ni représentant, ni dépense d'énergie de voyage. Le départ confirmé possède un activityId et des heures serveur. L'expédition continue ensuite avec le fonctionnement scientifique existant.

Le trajet aller et son retour suivent des passages effectivement praticables ; aucune portion distante ne traverse implicitement une étendue d'eau, un rocher ou une emprise pour rejoindre la destination. Les passages de couture du tore sont continus. Une interruption réseau ou un redémarrage ne crée pas un deuxième cartographe.

## 3. Existant vérifié et écarts à résoudre

Constats de **lecture du code**, sans nouvelle reproduction ni mesure dans cette phase documentaire :

| Chemin actuel | Fait vérifié | Conséquence pour la tranche |
|---|---|---|
| [scienceCommand](../apps/api/src/modules/science/service.ts) et [commandVillageScience](../apps/api/src/modules/villages/service.ts) | survey/explore calculent après beginVillageEconomy ; la réponse assemble VillageState. | Sortir préparation et recherche du verrou économique ; retourner un reçu compact. |
| [sciencePath](../apps/api/src/modules/science/navigation.ts) | A* borné à 8 192 visites, chargement SQL de chunks, terrainCodes/occupations, recherche linéaire du meilleur nœud ouvert. | Séparer acquisition des données et calcul pur ; utiliser une file de priorité ; certifier le terrain fin. |
| [refineTravelRoute](../packages/contracts/src/travel-paths.ts) | Affinage borné autour du village, puis conservation de la queue distante. | Le nouveau parcours scientifique ne peut dépendre de cet affinage local pour sa garantie complète. |
| [readRc1Ground](../apps/api/src/modules/worlds/rc1-ground.ts) | Sol édité, terrasses, rochers et troncs disponibles ; la révision navigation actuelle ne couvre pas toutes les occupations/voiries. | Réutiliser les règles et données ; compléter l'identité du contexte. |
| [recordPlaces](../apps/api/src/modules/science/service.ts) | Terrain/altitude lus dans worldChunks ; seuls les sommets entiers sont enregistrés. | Utiliser le terrain RC1 et préserver explicitement les lieux parcourus quand le chemin devient plus fin. |
| [scheduled-tasks](../apps/api/src/jobs/scheduled-tasks.ts), [server](../apps/api/src/server.ts) | Scheduler dans le processus API, tâche verrouillée et transaction ouvertes pendant le handler. | Ne pas y attendre le calcul CPU d'une expédition. |
| [harvest-submissions](../apps/api/src/modules/villages/harvest-submissions.ts) | Soumission et reçu idempotents existent ; traitement via le scheduler économique. | Réutiliser le principe, sans recopier la transaction longue. |
| [SpawnCompute](../apps/api/src/modules/onboarding/spawn-compute.ts) | Worker CPU persistant et file bornée existent. | Réutiliser les conventions de chargement, messages et arrêt ; adapter au cycle durable propre aux expéditions. |
| [sync](../apps/api/src/modules/villages/sync.ts) | Contrôle toutes les 2 s, snapshot de jonction, trames, revalidation des droits et buffer borné. | Garder les garanties ; ajouter réveil et reçus sans attendre une projection lourde. |
| [use-harvest-tool](../apps/world-web/src/ui/use-harvest-tool.ts) | Reçus de récolte interrogés toutes les secondes. | Leur migration SSE demeure hors scope. |

Références métier : [science](architecture/science.md), [spec Université](SPEC-UNIVERSITE-SCIENCES-DECOUVERTE.md). Références de cohérence : [synchronisation](architecture/village-synchronization.md), [économie](architecture/economy.md), [continuité des représentants](SPEC-DEPLACEMENTS-ET-ANIMATION-CHANTIERS.md).

## 4. Règles scientifiques conservées

1. survey exige Géographie 1 et une cible déjà connue ; explore exige Géographie 2. Les coordonnées reçues sont canoniques et dans les dimensions du monde ; aucun objectif n'est changé silencieusement.

2. Une expédition mobilise un cartographe disponible et assez reposé pour la durée entière. La préparation ne réserve ni cohorte ni énergie. L'attente technique ne compte pas dans le budget de mission.

3. Le budget actuel couvre aller + relevé de 60 secondes + retour. Il peut borner l'expédition à un lieu intermédiaire réellement accessible, comme aujourd'hui. Le reçu admis expose la cible demandée et la cible effectivement retenue ; aucune arrivée à l'objectif initial n'est prétendue.

4. Le calcul doit d'abord établir un trajet admissible vers l'objectif. Un budget CPU épuisé ne devient pas arbitrairement une expédition partielle. La coupe par budget de mission s'applique à un résultat géométrique certifié.

5. Le départ commence à H, borne économique lue après les verrous de l'admission ; aucune mission n'est antidatée à la réception ou au début du calcul. Les durées restent calculées par travelDuration et les règles actuelles.

6. Le rappel concerne une activité déjà admise. Il conserve les règles actuelles de retour et de publication des connaissances ; une demande en préparation n'est pas une activité rappelable. Aucun bouton d'annulation supplémentaire n'est introduit.

7. Connaissances et rapports sont intégrés seulement au retour. Aucun nœud exploré par A*, trajet candidat ou refus ne crée de connaissance, ne révèle des stocks ni n'actualise des voisins.

8. Un trajet engagé et ses échéances ne sont pas remplacés au gré du cache ou d'une réponse de worker. Les protections existantes contre l'obstruction des passages engagés s'appliquent au trajet complet. Toute lacune de ces protections rencontrée sur les nouvelles expéditions doit être corrigée localement ou signalée comme réserve de recette.

## 5. Contrat HTTP et reçus

### Soumission

Conserver POST /api/worlds/:worldSlug/villages/:villageId/science. Pour survey/explore, le contrat partagé exige désormais :

~~~ts
type ExpeditionIntent = {
  commandId: string; // UUID conservé lors des retries
  action: 'survey' | 'explore';
  target: { cellX: number; cellY: number };
  budgetSeconds: number; // bornes existantes 60..86400
};
~~~

Les autres actions scientifiques conservent leur contrat synchrone. Les deux branches de réponse sont discriminées dans les contrats et le client ; une réponse d'expédition ne passe jamais dans requestState comme un VillageState.

La réception authentifie, vérifie l'appartenance monde/village, le schéma, les bornes canoniques, l'idempotence et la capacité d'admission de la file. Elle enregistre l'intention et répond **202 après commit**, sans construire le terrain, initialiser la connaissance, réconcilier l'économie ni produire de snapshot. Les droits scientifiques et moyens courants seront autoritaires à l'admission.

- Même monde/village/commandId et même intention canonique : retrouver le même reçu ; 202 s'il est en cours, 200 s'il est terminal.

- Même clé et autre intention : 409 COMMAND_ID_CONFLICT, aucune modification de l'ancienne demande.

- Surcharge avant enregistrement : 429 EXPEDITION_QUEUE_FULL avec Retry-After ; aucune promesse d'enregistrement. Le client conserve le même UUID pour réessayer.

- Réponse perdue ou connexion coupée : statut local incertain, relecture/réémission du même UUID ; jamais création automatique d'un nouvel ordre.

- Un ancien client sans commandId reçoit une erreur explicite de mise à jour, sans admission synchrone de secours. Le déploiement serveur/client est coordonné et ce cas est testé.

### Reçu public

Champs communs : kind = expedition-receipt, commandId, worldId, villageId, version monotone **propre à ce reçu**, receivedAt, status, requestedTarget.

| status | Contenu et sens |
|---|---|
| pending | Demande durable, préparation/admission en attente ; aucune promesse de départ. |
| admitted | activityId, startedAt, completesAt, effectiveTarget ; mission et affectation validées ensemble. |
| rejected | code/motif métier : prérequis, cible, budget de mission, cartographe indisponible, passage impossible démontré. |
| failed | code technique : budget de recherche, contexte trop changeant, terrain absent, interruption persistante ou délai total expiré ; aucune preuve d'inaccessibilité. |

Terminal signifie fin de la **demande de départ**, pas fin de la mission. Un reçu admitted demeure admitted après retour, rappel ou achèvement de l'activité. Les reçus n'embarquent ni snapshot, ni champ fin de navigation, ni trajet candidat privé.

Ajouter GET /api/worlds/:worldSlug/villages/:villageId/science/expeditions :

- lecture par liste d'UUID, au plus 64, pour résoudre les demandes connues ;

- lecture de toutes les demandes pending du contexte, bornées par la limite de file, et historique terminal paginé ;

- mêmes contrôles de session/ownership et filtrage accountId ; un compte ne récupère jamais le reçu d'un autre propriétaire.

Nom de la table et détails de pagination restent des choix locaux. Le contrat doit permettre de retrouver un résultat après rechargement sans dépendre d'un SSE historique conservé ni de la mémoire du processus.

## 6. Ordre, persistance et reprise

Une table spécifique aux demandes d'expédition suffit : identité monde/village/compte/commande, intention normalisée, ordre reçu, date limite, état interne, tentative, leaseUntil, compteurs de reprise, reçu et activité éventuelle. La migration est additive ; aucune réécriture des missions engagées.

L'ordre de réception est l'ordre **attribué durablement par le serveur pour un village**. Une courte sérialisation de soumission propre à cette file garantit que deux connexions concurrentes ont un ordre total. Un simple timestamp client, l'ordre des réponses HTTP ou un numéro SQL alloué avant commit ne suffisent pas à prouver cet ordre.

Pour cette première tranche, une seule demande non terminale par village est traitée à la fois : la plus ancienne. Les autres villages peuvent progresser en parallèle. Un retry reste à sa place jusqu'à son issue bornée ; après refus/échec, la suivante peut partir. Aucun blocage global par une cible difficile.

Cycle interne : queued → computing → finalisation → terminal ; un recalcul retourne à queued avec tentative augmentée. La finalisation est une transaction, pas une réussite publique intermédiaire.

1. Acquisition courte avec SKIP LOCKED, attribution d'un token de tentative et d'un bail, puis commit.

2. Lecture cohérente des données ; fermeture de la transaction avant préparation CPU/recherche.

3. Calcul pur dans un worker ; aucun accès SQL ni autorité économique dans ce moteur.

4. Nouvelle transaction : verrou de la demande, vérification token/bail/échéance/ordre, puis admission métier.

5. Reçu terminal et activité éventuelle dans le même commit. Une réponse d'une ancienne tentative ne peut plus modifier la demande.

Le coordinateur est une boucle légère propre aux expéditions, distincte du drain du scheduler économique ; elle peut vivre dans le processus API et délègue tout calcul lourd au pool. Elle ne monopolise pas une connexion PostgreSQL pendant l’attente du worker.

Le coordinateur renouvelle son bail seulement tant que sa tentative reste propriétaire et respecte le budget. Une expiration permet reprise après crash. La date PostgreSQL décide de l'expiration ; les horloges des workers ne font pas autorité.

Les limites sont imposées côté serveur, atomiquement même avec deux instances API. Valeurs techniques initiales, ajustables sur mesures consignées sans changer le gameplay :

- pool : 1 calcul CPU simultané par processus, configurable à 2 pour la recette de concurrence ;

- au plus 4 demandes non terminales par village et 64 par instance de base couverte par le service ;

- préparation/recherche : au plus 5 s par tentative, 262 144 nœuds visités et 8 192 points dans le chemin retourné ; dépassement classé technique, jamais inaccessible ;

- mémoire : plafond initial de 256 Mio pour les données de navigation conservées par worker, hors runtime Node, avec éviction des contextes inactifs ; une demande trop grande échoue explicitement ;

- au plus 3 tentatives au total ; bail 10 s renouvelable ; échéance totale 30 s depuis réception, incluant l'attente en file ;

- sweeper de reprise/expiration : au plus 2 s de retard lorsque le service est sain.

Un arrêt total suspend évidemment la livraison ; au redémarrage, une demande expirée se clôture sans départ tardif. Après épuisement, le reçu failed est durable. Le dépassement d'une limite ne lance pas un solveur plus large sous verrou ni un calcul synchrone dans l'API. Les attentes de verrous et la transaction finale ont elles aussi une borne inférieure au temps restant ; un timeout annule la transaction et libère ses verrous. Recontrôler l’échéance après les attentes et avant d’engager : un bail valide au début ne permet pas un départ après expiration.

Conserver des reçus compacts pour l'idempotence. Les payloads de calcul, caches et tentatives obsolètes sont libérés. Aucune purge de reçu ni réutilisation d'UUID n'est introduite sans contrat de rétention ; cette table durable n'est pas intégralement chargée en mémoire.

## 7. Acquisition et moteur géographique

Le worker reçoit un contexte versionné conservé entre demandes, puis de petits messages internes. L'API ne retransfère pas un monde JSON complet pour chaque trajet. Les structures de calcul sont construites dans le worker ; la préparation coûteuse du relief ne reste pas cachée dans le handler HTTP.

~~~ts
type RouteEndpoint =
  | { kind: 'point'; cellX: number; cellY: number } // coordonnées continues canoniques
  | { kind: 'access'; accessId: string }; // accès et raccords présents dans le contexte

type RouteQuery = {
  worldId: string;
  contextId: string; // identité complète des données effectivement utilisées
  policyVersion: string;
  movementProfileId: string; // seul pedestrian-v1 est réalisé dans cette tranche
  traversalConstraintsId: string; // contraintes résolues par le serveur, même si aucune
  starts: RouteEndpoint[]; // candidats non vides admis par le métier
  goals: RouteEndpoint[]; // candidats non vides admis par le métier
  limits: { maxNodes: number; maxDurationMs: number };
};

type RouteJob = {
  requestId: string;
  attemptToken: string; // corrélation d'exécution, sans signification scientifique
  query: RouteQuery;
};
~~~

RouteQuery ne contient ni village obligatoire, ni action survey/explore, ni cohorte, ni budget scientifique, ni durée de relevé. Le métier expédition résout les accès de son hôtel de ville en starts et sa cible en goals. Un départ depuis une position courante ou une arrivée par la porte d’un autre site utilisent les mêmes formes d’extrémités ; seuls les raccords explicitement autorisés par le contexte bénéficient des exemptions intérieures. Les candidats ne permettent pas au moteur de déplacer librement l’objectif.

Le profil et les contraintes de parcours sont construits par le serveur. Les contraintes de connaissance ou d’accès sont des données géométriques du contexte, sans dépendance du solveur aux tables science ni callback métier. Leur identité entre dans les clés de cache avec le profil, la politique et la révision physique : un résultat calculé sous un autre ensemble de passages autorisés n’est pas réutilisé. Aucun profil inconnu ne retombe silencieusement sur le piéton.

Le module de calcul et son worker doivent pouvoir être importés/testés sans dépendre de modules/science, des cohortes ou du client React. Le coordinateur durable et les reçus de cette première intégration restent scientifiques. Cette frontière requiert une extraction locale ; elle ne justifie pas un framework de missions.

Le protocole de chargement d'un contexte et celui de recherche peuvent être distincts. Les tableaux compacts/transferts d'ArrayBuffer sont préférés lorsque mesurés utiles ; aucun objet Babylon ni fonction de sampling n'est sérialisé. Le worker importe le noyau géométrique pur partagé.

Le contexte associe explicitement :

- monde, dimensions du tore, identité/checksum de l'artefact RC1 et version du code géométrique ;

- terrasses, modifications naturelles affectant le passage, troncs effectifs ;

- occupations, géométrie/rotation des bâtiments et portes, voirie/trottoirs/équipements de tous les villages concernés ;

- version des règles de passage/coût et, lorsqu'elle est utilisée, contrainte de connaissance propre au demandeur.

Lecture READ ONLY REPEATABLE READ des entrées et de leur révision dans la même vue, puis fermeture. Chargement immuable partagé et caches bornés ; aucune permission, réserve de ressources ni disponibilité de cohorte n'est reprise du cache. Une extension de contexte pendant une recherche doit conserver cette identité ; mélanger des secteurs issus de révisions différentes est interdit.

La stratégie recommandée est un guidage à la case/au secteur, affiné là où les passages l'exigent, avec file de priorité. Aucun maillage intégral au huitième de case de chaque monde n'est imposé. La stratégie retenue doit chercher des alternatives si un corridor grossier échoue et respecter les budgets ; elle ne peut transformer l'échec d'une grille grossière en preuve d'inaccessibilité.

### Certification du trajet

- Extrémités : points canoniques ou accès présents dans le contexte. Pour l’adaptateur expédition, les départs sont les accès actuels de l’hôtel de ville ; considérer les candidats applicables avant de conclure à l’absence de sortie. Les connecteurs de départ comme d’arrivée sont contrôlés ; seule une portion intérieure explicitement définie et autorisée bénéficie de son exemption.

- Segments extérieurs cardinaux ; virages à 90°, coutures toriques et connecteurs continus. Une compression enlève seulement des points collinéaires sans modifier la géométrie.

- Pour le profil pedestrian-v1 livré ici, même règle que canWalkSpawnSegment : largeur 1/8, échantillonnage longitudinal au plus 1/8, sol sec, hauteur finie, obstacles et pente locale au plus 0,25. Ces valeurs appartiennent au profil de navigation et non à une condition « mission scientifique ».

- Les emprises/équipements sont contrôlés en plus du champ naturel. Aucun sommet accessible ne suffit à valider un segment qui traverse un obstacle.

- La voirie et ses accès conservent les règles actuelles ; un lissage graphique ne change jamais le chemin certifié.

- La cible n'est pas une exemption pour pénétrer une emprise, un rocher ou l'eau. Un objectif physiquement bloqué reçoit un refus explicite ; inventer une distance de relevé ou déplacer la cible sur une berge est hors scope.

- Le résultat du moteur couvre tout le trajet orienté départ → arrivée, y compris au-delà de ±32 cases. Il n’ajoute aucun retour. L’adaptateur expédition compose et certifie son aller-retour selon les règles actuelles ; réutiliser l’inverse suppose la symétrie vérifiée du profil et des contraintes de cette tranche. Aucune queue historique non vérifiée n’est ajoutée.

- L'altitude provient du terrain serveur. Les coordonnées Babylon de rendu ne deviennent pas le contrat mondial ; aucun z fourni par le navigateur ne fait autorité.

Le moteur retourne found avec extrémités choisies, chemin certifié, longueur/coût géométriques et identité du contexte/profil/contraintes ; ou unreachable avec domaine de preuve ; ou budget-exceeded ; ou context-unavailable. Les diagnostics d'obstacles précis restent internes lorsque leur publication révélerait des informations étrangères.

unreachable est recevable lorsque tous les candidats autorisés d’une extrémité sont physiquement interdits, ou après exploration d’un domaine de recherche complet défini par les règles. L’échec d’une seule porte candidate ne suffit pas. Un corridor restreint, une fenêtre locale, une grille incomplète ou une limite de visites ne permettent pas ce verdict : ils conduisent à un résultat technique explicite.

Le coût géométrique et les distances cumulées permettent au métier de calculer ses durées. Le moteur n’ajoute ni temps de relevé, ni temps de combat, ni temps de chargement ; le budget aller-retour et travelDuration sont appliqués par l’adaptateur scientifique.

## 8. Révision physique et admission atomique

syncRevision est une révision générale du monde ; geographyRevision est une révision de connaissances. Aucune des deux ne suffit à identifier le contexte physique sans invalidations ou omissions inappropriées. Le hash navigation actuel de readRc1Ground ne couvre pas à lui seul les bâtiments et la voirie.

Prévoir une révision physique transactionnelle couvrant tous les inputs du contexte. La solution locale privilégiée est d'étendre les marqueurs existants de village_sync_changes par un indicateur de changement de navigation et un index adapté, via nouvelle migration. La révision compte les marqueurs physiques **visibles et validés**, avec identité de source/politique séparée ; ni MAX(sequence), ni horloge JS, ni compteur mondial verrouillé après les gisements.

L'inventaire des producteurs fait partie de l'implémentation : pose/déplacement/suppression d'emprise et de porte, terrasse, voirie/barrière/équipement, installation RC1, suppression/retour de tronc, identité de source. Ne pas invalider sur énergie, stock sans effet physique, reçu, horloge ou sélection. Pour une forêt, le franchissement du seuil de présence du tronc invalide, pas chaque unité coupée.

La granularité mondiale, conservatrice, suffit pour cette tranche. Une édition physique lointaine peut provoquer un recalcul ; son coût est mesuré. Aucun système de versions par secteur n'est requis préventivement.

### Transaction finale des expéditions

Ordre : demande d'expédition → village → verrou de navigation → gisements selon l'ordre canonique existant → science/métier. Ne jamais acquérir un autre village après ces verrous. La soumission et la réconciliation économique ne verrouillent pas les demandes déjà prises par le coordinateur.

Pour la première implémentation, l'admission prend le verrou de navigation mondial **exclusif existant**, dès beginVillageEconomy avec navigationWrite, avant les gisements. Les autres transactions économiques prennent aujourd'hui le verrou partagé ; les écritures spatiales explicites utilisent déjà l'exclusif. Ce choix conservateur empêche également un changement physique issu d'une autre réconciliation pendant la vérification finale. Aucune montée partagé → exclusif en cours de transaction.

Auditer tous les producteurs physiques, y compris installation/génération et repousse : une écriture pouvant affecter ce contexte doit participer au même protocole avant sa mutation. Un trigger de révision seul ne ferme pas la course entre « vérifier » et « engager ».

Après réconciliation à H et acquisition du verrou science, recontrôler :

- propriétaire/monde/état de la demande, tentative encore valable et ordre ;

- pertinence actuelle des extrémités et des contraintes choisies par le métier ; la seule révision du terrain ne valide pas l’identité, la position ou le droit d’approcher une cible ;

- identité de source, politique et révision physique courantes, y compris les changements causés par la réconciliation de cette transaction ;

- prérequis et cible scientifiques, durée/budget et disponibilité/énergie des cohortes ;

- intégrité des bornes et extrémités du résultat calculé.

Révision identique : utiliser le résultat certifié, sans réexécuter A* ni reconstruire le réseau mondial. Révision différente : abandonner ce candidat et programmer un recalcul borné après commit. Toute réconciliation déjà due conserve son traitement autoritaire normal ; un candidat périmé n'accorde aucune mission.

L'admission appelle les primitives existantes d'affectation, de création d'activité et de notification science.wake. Obtenir l'activityId sans dupliquer startActivity et ses règles. Activité + affectation + reçu admitted sont atomiques ; l'échéance économique reste gérée par le scheduler actuel, qui acquitte seulement sa propre tâche.

Le refus métier n'attend pas qu'un cartographe se libère : il termine cette demande et laisse passer la suivante. Les retries concernent les problèmes techniques/contextes périmés, dans les bornes prévues.

Le verrou mondial peut attendre une autre commande existante, notamment une installation encore coûteuse. Le mesurer séparément. Cette tranche réduit la durée ajoutée par la nouvelle navigation ; elle ne promet pas que toutes les transactions du monde sont déjà courtes.

## 9. Retour scientifique et compatibilité

Le nouveau chemin doit rester compatible avec travelDuration, le rappel, VillageWorkers et recognizedDepositRoute. Les tests vérifient ces consommateurs, pas seulement la réponse du solveur.

La coupe par budget et le rappel utilisent des distances cumulées ou un parcours linéaire ; ils ne recalculent pas travelDuration sur chaque préfixe par une boucle quadratique. Le rappel reste une commande courte, sans nouvelle recherche de route.

Le chemin de déplacement peut contenir des points fractionnaires et être comprimé. Conserver ou dériver explicitement les cellules réellement parcourues et les lieux d'arrêt utilisés par la science ; ne pas dépendre de la présence fortuite de sommets entiers. Lors du rappel, ne rapporter que le préfixe réellement parcouru selon le temps serveur et les règles actuelles.

Pour RC1, les nouvelles mesures utilisent la même source de sol édité que la navigation/rendu, avec les unités persistées existantes de sciencePlaces. La date de référence reste celle de restitution prévue par la science. Ne pas présenter cette lecture comme un historique continu de la géographie à chaque instant du voyage. Les anciens rapports datés ne sont pas recalculés lors d'un simple affichage.

Les accès reconnus consommant ces nouveaux rapports doivent continuer à retrouver le trajet rapporté et les lieux effectivement relevés ; adapter localement leur décodage si nécessaire. Ni les connaissances ni l'exploitation distante ne s'ouvrent à partir d'un candidat de route non parcouru.

## 10. SSE rapide, durable et limité au bon contexte

Ajouter expedition-receipt au flux village existant. Le même reçu est utilisé pour HTTP, GET et SSE. Sa version ne fait **jamais** avancer syncRevision et l'événement ne réutilise pas ce champ pour simuler une trame. Le client applique un terminal une fois et ignore toute version plus ancienne.

Écrire le reçu et émettre pg_notify dans la même transaction : la notification n'est livrée qu'après commit. Le payload contient seulement les identifiants nécessaires au réveil ; les données autorisées sont relues en base.

Un listener PostgreSQL par instance API, sur connexion dédiée hors transaction longue, réveille les abonnements autorisés concernés. Plusieurs réveils sont regroupés ; les contrôles restent à une seule exécution en vol, avec un indicateur de réveil à rattraper si un commit arrive pendant une lecture. Pas de connexion LISTEN par navigateur.

Le reçu compact peut partir avant la projection complète du village. L'admission réveille également sa synchronisation ; les activités/cohortes entrent dans la scène via la trame/snapshot autoritaire existant. Le reçu seul ne crée aucun figurant ni mutation parallèle de l'état React.

Une ouverture/reconnexion :

1. établit l'écoute et la jonction de snapshot existante ;

2. retrouve les demandes connues/non terminales et résultats récents par lecture durable ;

3. fusionne reçus HTTP/SSE/GET par contexte, commandId et version ;

4. rattrape un réveil arrivé pendant cette jonction.

Conserver le contrôle périodique de secours, incluant les reçus suivis : LISTEN/NOTIFY accélère la découverte, il ne porte pas la durabilité. Un refus sans nouvelle syncRevision doit être livré. Last-Event-ID n'est ni un acquittement applicatif ni une garantie de replay.

Conserver revalidation des droits/session, fermeture sur expiration, limites de buffer, nettoyage des timers/listeners et gardes de génération lors du changement de village. Tester le buffering du proxy dans l'environnement de recette ; aucun résultat ne doit dépendre d'une fermeture artificielle de la connexion pour apparaître.

## 11. Client et continuité

Adapter les méthodes existantes : UUID créé avant envoi, intention immuable, état pending/uncertain local, récupération au rechargement. Une déconnexion n'est pas présentée comme un refus. Les autres commandes et la caméra restent utilisables pendant la préparation.

SciencePanel affiche un retour court dans son emplacement actuel : préparation, départ ou motif de non-départ. Aucun nouveau parcours de sélection ni refactor visuel Population. Les heures d'activité sont celles du serveur ; le reçu expose la cible effective lorsqu'elle diffère de l'objectif.

Un reçu et la trame peuvent arriver dans les deux ordres. Le client ne double ni message de confirmation ni mission. Un terminal reçu avant le 202 ne régresse pas vers pending. Aucun événement d'un ancien monde/village/compte ne modifie le contexte actuel.

Après apparition de l'activité autoritaire, conserver la continuité des représentants : identifiant et rattachement existants, sélection vivante, porte réelle, progression conservée lors des mises à jour. Le worker de routes ne prend jamais possession de la position visuelle.

## 12. Mesure et critères de performance

Mesurer séparément réception HTTP, attente en file, acquisition des données, préparation/transfert CPU, recherche, nombre de visites, reprises, attente des verrous, durée des verrous, commit → reçu SSE et commit → activité visible. Le temps complet réception → décision est une mesure obligatoire : un 202 rapide ne suffit pas.

Profil de référence à consigner : CPU/cœurs, RAM, OS, Node, PostgreSQL, builds, artefact RC1, nombre de villages/constructions, taille des données et configuration du pool. Utiliser une copie de test identifiée ; jamais réinitialiser la base dev ni le monde de recette utilisateur.

Cibles initiales pour une machine de référence locale documentée, hors démarrage du processus et sans latence Internet :

| Mesure | Cible de recette |
|---|---|
| HTTP de soumission sous charge CPU de routes, au moins 1 000 requêtes/probes | p95 ≤ 200 ms, p99 ≤ 500 ms ; refus de capacité distingués des demandes enregistrées. |
| Lecture légère/API santé pendant cette charge | p95 ≤ 100 ms ; aucun gel de la boucle égal à la durée d'une recherche. |
| Commit terminal → reçu SSE, connexion active | p95 ≤ 250 ms ; notification manquée rattrapée par le secours de 2 s, hors panne DB/réseau. |
| Demande isolée sur corpus représentatif, worker chaud | réception → décision p95 ≤ 3 s sur au moins 100 essais. |
| Première demande avec cache géométrique froid, worker démarré | décision ≤ 8 s sur chaque cas de référence ; temps d'initialisation publié séparément. |
| Travail de navigation dans la transaction finale, contexte inchangé | aucun solveur ; validation de version/intégrité p95 ≤ 25 ms hors attente SQL et réconciliation économique. |
| Borne des demandes | aucune pending au-delà de 30 s + 2 s de passage du sweeper sur service sain. |

Ces seuils sont à prouver, pas à remplacer par un ancien compte de tests. Publier aussi la durée totale de verrou et le délai d'apparition réelle de l'activité ; une projection SSE coûteuse reste une limite visible même si le reçu est rapide.

Corpus : courts/longs trajets, forêt/passage fin, détours d'eau/roche/pente, village dense, coutures X/Y/coin, cible fermée et cas budget-exceeded. Mesures à froid séparées des répétitions chaudes, résultats géométriques équivalents vérifiés. Sous saturation, mesurer âge de file, équité entre villages, mémoire stable et absence de famine du scheduler économique.

Rust n'est reconsidéré qu'après attribution du coût au noyau CPU et comparaison bout en bout à contrats/règles identiques. Aucun gain de langage n'est revendiqué dans cette tranche.

## 13. Régressions et recette d'acceptation

### Réutilisabilité du noyau

- Avec le même profil piéton, résoudre point → point hors des accès de l’hôtel de ville, accès → point et accès → accès de deux sites distincts ; le moteur renvoie un seul trajet orienté complet, sans retour ajouté. Aucun domaine combat/commerce n’est nécessaire à ces fixtures.
- Charger et exécuter le moteur sans DB, état scientifique, cohorte ou village propriétaire obligatoire. Les contrôles de propriétaire restent testés dans l’adaptateur métier.
- À géométrie identique, changer les contraintes de passages autorisés : aucun réemploi d’une route interdite par le nouveau contexte. Un profil inconnu est refusé explicitement.
- Prouver que budget scientifique, FIFO, réservation et calcul de l’échéance ne sont pas codés dans le noyau géométrique ou le worker CPU.

### Navigation et science

| Cas | Preuve attendue |
|---|---|
| Cible au-delà de 32 cases avec détour praticable autour d’un obstacle distant | Ancien chemin non certifié reproduit ; nouveau détour complet certifié et destination atteinte. Un refus seul ne fait pas passer ce cas. |
| Eau, pente excessive, roche et tronc sur un segment | Aucun segment accepté ne les traverse ; endpoints seuls insuffisants. |
| Passage fin et corridor grossier trompeur | Route fine trouvée dans le budget ; échec de grille jamais déclaré inaccessible sans preuve. |
| Couture X/Y/coin et portes aux quatre orientations | Trajet continu, cardinal, bonne longueur/durée, raccord sans saut. |
| Budget de mission court | Cible effective atteignable, aller + relevé + retour dans le budget, objectif demandé conservé dans le reçu. |
| Budget CPU épuisé / contexte incomplet | Code technique distinct, aucun départ ni révélation de cellules candidates. |
| Retour/rappel avec points fractionnaires | Seuls les lieux effectivement parcourus sont rapportés ; terrain/altitude RC1 cohérents ; accès reconnu compatible. |
| Mondes historiques | Pas de changement de coûts, prérequis, rappel ou connaissance du fait du nouveau transport asynchrone. |

### PostgreSQL et pannes

Forcer les entrelacements avec barrières bornées, observer les attentes PostgreSQL pertinentes et terminer toutes les transactions même en échec.

- Doubles soumissions simultanées, réponse HTTP perdue, retry après admission et UUID réutilisé avec autre corps.

- Deux demandes d'un village : forcer la lenteur de la première, prouver son ordre durable et l'absence de dépassement ; premier refus/échec libère la suivante.

- Deux villages : le calcul lent du premier ne bloque pas celui du second ; quotas corrects avec deux coordinateurs.

- Pendant le calcul, une autre commande utilise le dernier cartographe : aucune réservation cachée ; reçu de refus à l'admission, aucune double affectation.

- Modifier terrain/porte/occupation/équipement/tronc entre capture et admission : candidat abandonné et reprise bornée. Une variation d'énergie/stock sans effet physique ne périme pas la géométrie.

- Forcer un changement physique concurrent pendant la finalisation : la mutation attend le verrou ou précède la vérification ; aucune mission admise dans l'intervalle non protégé.

- Crashes après acquisition, après calcul, après commit avant livraison ; bail expiré puis réponse tardive de l'ancien worker : au plus une activité et une affectation.

- Échec injecté après création d'activité/affectation : observer les mutations avant l'exception précise, puis prouver rollback exact et absence de reçu admitted/notification de succès.

- Reprises répétées, processus absent puis relancé, expiration : aucun départ après échéance, aucun pending permanent.

- Vérifier qu'aucun verrou village ni connexion SQL n'est conservé pendant la recherche CPU. Vérifier le chemin production compilé, le démarrage/arrêt dev et l'absence de worker orphelin.

### SSE, client et navigateur

- Succès et refus livrés même sans changement de révision village ; notification perdue, listener reconnecté et réception avant réponse HTTP.

- Snapshot, reçu et trame reçus dans les deux ordres ; doublons, ancien reçu, changement monde/village, logout, onglet fermé/réouvert.

- Navigateur sur RC1 de test : lancer une expédition distante avec détour ; manipuler caméra et une action indépendante pendant la préparation ; observer départ, suivre le cartographe à un coude/une porte et le sélectionner en marche ; vérifier retour et connaissance publiée.

- Recharger pendant préparation, puis couper/reprendre SSE autour de l'admission : retrouver l'unique demande et l'unique activité.

- Exercer rappel et cible atteinte avant l'objectif par budget. Ne pas se contenter d'un HTTP 202 ou d'un solveur pur.

- Si un parcours reste manuel à Tristan selon la répartition de session, le fournir avec cible/conditions exactes et garder le statut à valider jusqu'au retour correspondant.

### Commandes et preuves

Construire contracts avant les tests ciblés ; exécuter les nouvelles suites et les suites connexes navigation/science/synchronisation/continuité touchées. Types API/contracts/world-web, lint des fichiers modifiés et build API/world-web requis. Les tests DB partageant une base s'exécutent séquentiellement, sur cible _test vérifiée sans secret, sans reset de recette. Utiliser les scripts actuels de package.json ; le contournement local --configLoader runner peut être consigné si nécessaire.

Cette spec n'atteste aucune exécution de ces tests. La livraison doit donner les commandes réellement terminées, les mesures et leurs limites, les observations navigateur et les éventuels écarts.

## 14. Séquence de réalisation et condition de fin

1. Reproduire les écarts de navigation distante et établir une mesure de référence ; inventorier toutes les mutations du contexte physique.

2. Introduire contrat/reçu et persistance additive, FIFO/baux/idempotence bornés ; tester les courses et reprises.

3. Extraire les entrées de navigation et le moteur pur A → B indépendant de la science, couvrir RC1 entier et mondes historiques, intégrer le pool et les caches bornés ; prouver la réutilisabilité des extrémités et contraintes.

4. Raccorder l'admission transactionnelle, la révision physique et les consommateurs scientifiques ; prouver l'absence de calcul long sous verrou.

5. Raccorder les reçus au SSE et au client existants ; terminer récupération réseau, visibilité et sélection.

6. Exécuter recette géométrique, DB, navigateur et charge ; corriger les écarts ; mettre à jour handoff et références effectivement modifiées.

La tranche est terminée lorsque le noyau A → B est indépendant des règles scientifiques et passe les cas de réutilisabilité, que les commandes ciblées produisent un trajet complètement certifié ou une issue explicite, que FIFO/reprise/admission empêchent doubles départs et décisions périmées, que le joueur reçoit un résultat durable et réactif, et que les vérifications ci-dessus sont exécutées. Un seuil manqué est documenté et maintient la performance concernée à valider ; il n'est pas effacé par le seul succès du protocole.

Limites à rappeler au bilan : autres commandes/projections encore potentiellement coûteuses, invalidations physiques mondiales conservatrices, exploitation distante générale non migrée, aucune promesse de charge production déduite d'un benchmark local.

## 15. Références techniques

- [Node.js 24 — Worker threads](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html) : calcul CPU parallèle, pool persistant, transfert de buffers.

- [PostgreSQL 17 — NOTIFY](https://www.postgresql.org/docs/17/sql-notify.html) : signal délivré après commit, données durables conservées dans les tables.

- [WHATWG — Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html) : transport et reconnexion ; le contrat de rattrapage applicatif reste celui d'Arbestra.

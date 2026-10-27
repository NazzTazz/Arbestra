# Déplacements des villageois et animation des chantiers

Correctif du 27 octobre 2026 (site compact) : l'équipe part en formation routière comme sur un site ouvert ; la file d'attente se forme **en vue, sur la route**, au seuil d'installation (à dégagement de toutes les places), et non plus invisible à la porte jusqu'à ce que le précédent ait parcouru toute la route. Un seul installateur quitte la route à la fois, le plus avancé d'abord, au point de la route le plus proche de sa place ; le suivant est admis 1,5 m derrière lui ou dès qu'il a quitté la route. Un poste partagé est occupé par le premier pair présent tant que le pair désigné par le tour n'est pas là ; un tour ne permute jamais son titulaire. Au départ, le site se vide dans l'ordre du convoi (jonction la plus en aval d'abord, un raccord de sortie à la fois, jonction au point de route le plus proche, replanification après 1,5 s d'attente comme à l'installation) ; une rotation en cours termine avant de charger. Un retardataire encore sur la route à l'heure du retour fait demi-tour sans charge ; quelqu'un qui atteint son poste après cette heure repart aussi sans charge. Les raccords locaux (installation, rotation, sortie) partagent les passages routiers étroits avec leur équipe sans en être un flux (`local` sur l'acteur de trafic). Aucun changement des trajets économiques, échéances ou effectifs. Limites connues : des places d'attente posées sur la route en deux rangées à 0,6 m (repli « routes autorisées ») laissent moins d'une largeur de corps entre rangées et peuvent se bloquer mutuellement en rotation ; le test unitaire de ce cas donne à la route une marge praticable (|z| ≤ 1,2) au lieu de la poser au bord exact de la zone libre.

Complément du 19 octobre 2026 : les équipements, dont les braseros automatiques, sont aussi indexés dans le plan local. Leur projection est recalculée lors d'un changement d'équipements ou d'origine torique, puis chaque sonde ne vérifie que les équipements voisins, avec la même marge exacte. Un raccord local refuse immédiatement une destination occupée : aucun détour ni recherche A* ne peut rendre ce dernier point libre. La tentative suivante réévalue ce point, sans cache d'échec persistant ; les déplacements restent soumis aux collisions habituelles. L'éclairage fallback des braseros reste réservé à la nuit. Les mesures CPU distinguent ce contrôle de collision du calcul d'éclairage.

Correctif du 19 octobre 2026 : les vérifications d’obstacles des raccords locaux utilisent un index par case canonique pour les bâtiments/emprises et les ressources bloquantes, ainsi qu’un accès direct à la ressource cible. Les tableaux de cases et de features d’une projection acceptée sont immuables ; chaque index est reconstruit uniquement lorsque son tableau source change. Une sonde ne reparcourt plus tout le village. Conserver les collisions, les autres ressources présentes sur une même case, les ressources dégagées et l’exception de la cible courante ; les contrôles de terrain, voirie, équipements et barrières restent en place. Mesures avant/après et limites de fluidité dans le handoff.

Correctif du 16 octobre 2026 : les trajets visuels bois/pierre retirent les détours fermés qui repassent par le même point, en conservant uniquement des segments du trajet serveur. Les obstacles routiers utilisent le même masque que les routes affichées ; un chantier sans emplacement peut utiliser une route physiquement libre. Les obstacles réels restent vérifiés. En site compact, les arrivées sont espacées et alimentent les différents postes avant leurs files ; les places d'attente vides ne sont pas des murs. Les raccordements locaux contournent les postes et corps présents, avec recherche bornée à 2 048 nœuds après échec des raccordements directs et nouvelle tentative après une attente de 1,5 s. Les gestes de travail demandent l'arrivée réelle au poste. Aucun changement des trajets économiques, échéances, crédits ou effectifs. Vérifications et limites de recette dans la tête du handoff courant.

Mise à jour : 12 octobre 2026, base relue `e212152`. Statut : **continuité implémentée ; régressions et parcours WebGL isolés vérifiés, retour utilisateur favorable sur la recette restaurée**. Ce retour ne détaille pas tous les cas de la checklist.

Date initiale : 2 octobre 2026. Tristan a ensuite autorisé l'implémentation. Les détails de réalisation restent à recetter. Base : `main`, HEAD `0a0873a`, worktree comprenant les chantiers persistants en validation.

Cette tranche rend lisibles les équipes qui circulent et travaillent : départs espacés, files ou binômes, collisions simples, priorités de passage, apparences variées et gestes adaptés au bois et à la pierre. Elle prolonge la [spec des chantiers](SPEC-CHANTIERS-EXPLOITATION-GISEMENTS.md), sans modifier implicitement leurs ressources, durées, fatigue ni conditions de livraison. Destinataires : Tristan pour les arbitrages et l'agent chargé de l'implémentation pour le périmètre technique.

## Décisions validées et propositions

| Sujet | Statut et règle |
|---|---|
| Circulation | **Validé** : supprimer les grappes, organiser des files ou des groupes de deux, gérer simplement les collisions et des priorités sur les itinéraires. Pas de moteur de foule. |
| Apparences | **Validé** : 3 teintes de peau, 5 couleurs de vêtements, 3 couleurs de cheveux, soit 45 combinaisons. |
| Bois seul | **Validé** : une personne attaque l'arbre à la hache. |
| Bois à deux | **Validé** : deux personnes tiennent chacune un côté d'une grande scie. |
| Bois à partir de trois | **Validé** : des binômes scient les arbres et les autres débitent les troncs tombés. La table de répartition ci-dessous est validée. |
| Pierre à dix | **Validé** : 5 piocheurs, 3 débiteurs et 2 manutentionnaires. Les derniers déplacent les blocs vers les débiteurs puis remplissent les paniers de graviers. |
| Pierre à effectif réduit | **Validé** : table progressive ci-dessous jusqu'à 5/3/2 à dix. |
| Effectifs visibles | **Validé** : conserver les participants du chantier observé ; réduire d'abord le détail des animations éloignées. |
| Priorités précises | **Proposé** : circulation à droite, premier arrivé aux conflits, groupe engagé prioritaire, entrants prioritaires à la porte avec protection contre la famine des sortants. |
| Identité visuelle | **Proposé** : apparence stable pendant le lot et après reconstruction du même lot ; continuité entre lots du chantier autant que possible, sans identité individuelle persistante. |
| Conséquences des attentes | **Validé, révisé le 12 octobre** : décalage visuel accepté, économie inchangée ; une attente active ne reconstruit plus les représentants observés. Retrait borné des missions obsolètes et reconstruction initiale/après absence longue, sans double incarnation. |

Les répartitions, le compromis temporel et le maintien des effectifs ont reçu des accords distincts de Tristan. Les palettes exactes et les paramètres de circulation sont des réglages de recette, pas de nouvelles règles métier.

## Réalisation de cette tranche

`worker-motion.ts` porte les formations et la circulation commune : pas fixe de 1/30 s, disques balayés, voisinage spatial, droite, conflits réservés, alternance des passages étroits et continuité des clés canoniques. Les voies utilisent les largeurs du réseau graphique (0,94 pavé, 0,8 terre), avec porte resserrée. Le rendu interpole les positions entre les pas ; une attente arrête les gestes de marche. Une boucle empruntée dans le même sens accepte une file compatible, sans autoriser les collisions.

`village-workers.ts` est l'unique propriétaire des figurants Jardin/bois/pierre. Les anciennes méthodes indépendantes de `BabylonVillageScene.ts` ont été retirées. Onze matières de palette et une géométrie de boîte partagée sont réutilisées. Les rôles, scies communes, troncs, blocs et charges sont décoratifs. Les petits effectifs alternent des gestes secondaires ; les manutentionnaires circulent à l'extérieur de la ligne de débitage. Aucune affectation, échéance ou ressource serveur n'est changée.

`worksite-layout.ts` essaie front, aire latérale et postes compacts partagés avec places d'attente et rotations. Les raccords internes essaient un nombre borné de parcours orthogonaux, contrôlés contre les obstacles. Les postes compacts conservent les dix participants ; un passage vide entre deux tours laisse sortir le précédent. Une disposition sans place praticable reste signalée `blocked` en debug : la couverture des géométries difficiles doit être recettée, sans promesse universelle.

Les synchronisations ordinaires conservent les figures et leur progression. La fin visuelle retient le dernier nouveau lot du chantier. Les attentes actives ne déclenchent plus de fondu/repositionnement collectif. Une fin remplacée expire huit secondes après son échéance ; une mission encore dans un snapshot ancien expire après max(30 secondes, deux durées de transport), avec retrait individuel de 350 ms, annulé si devenu inutile. Une interruption de plus de trente secondes reconstruit la phase actuelle ; une interruption courte conserve la progression. Le recentrage translate les raccords sans réinitialiser une attente. Les accessoires sont nettoyés avec leurs groupes. Les diagnostics DEV `data-worker-traffic` exposent rôles, phases, disposition, attentes et coût CPU borné aux 120 dernières frames ; leur publication est limitée à deux fois par seconde.

Preuves et recette courantes sont consignées dans `SESSION-HANDOFF.md`. Les tests ciblés couvrent circulation, conflits voisins, boucle peuplée, couture/recentrage, formations depuis snapshot, postes contraints, alternance, LOD, chevauchement de lots et nettoyage. La recette navigateur a confirmé les équipes bois à cinq et pierre à dix via le diagnostic de scène. Ce constat ne valide pas encore la qualité des gestes, toutes les géométries contraintes ou un budget GPU à 120 figurants. Aucun E2E n'est lancé dans cette tranche.


## Continuité des représentants — 12 octobre 2026

La formation n'est plus un batch indivisible : le premier peut se dégager au coude tandis que le suivant attend. Le passage en file ouvre d'abord l'espacement longitudinal ; le changement de côté est borné et les resserrements de largeur sont anticipés. Disques balayés, priorités et passages conservés. Les raccords de chantier quittent la fin d'approche avant une porte occupée et contournent les postes réservés.

Le calendrier absolu de `idleTourPhase` sert uniquement à la reconstruction initiale/après absence longue. En scène suivie : arrivée réelle → séjour de la maison atteinte → départ à sa porte. Un itinéraire de promenade actualisé est adopté à la porte atteinte. Un trajet scientifique changé rejoint le nouveau chemin depuis la position courante par un sommet commun ; sans sommet commun, le parcours engagé est conservé. Les raccords restent locaux, sans nouveau routage métier.

La sélection suit le même représentant sans arrêter sa position ni ses gestes. `representativeInfo` expose le rattachement cohorte mémorisé, les données disponibles, l'attente et la présence (`visible`, `inside`, `ground-unavailable`, `offscreen`). `representativePose` conserve la position actuelle, y compris la porte pendant un séjour. Suppression, remplacement de mission, changement de monde/village ou de rattachement cohorte invalident la sélection ; aucun indice équivalent ne la récupère. Noms/apparences sont décoratifs, sans identité individuelle persistante. Le futur HUD compte la population autoritaire, jamais les figurants.

Babylon installé/verrouillé : 8.56.2. Hiérarchie TransformNode/meshes, picking avec métadonnées et boucle Engine conservés ; destruction récursive sans détruire les matières partagées. `VillageWorkers` reste seul propriétaire de la position finale ; les gestes suivent le déplacement réel. AnimationGroup/blending existent, mais des clips n'amélioreraient pas la continuité de ces gestes procéduraux. NavigationPlugin V2/Recast demanderait addons, WASM et navmesh sans traiter la reconstruction applicative. Références confrontées aux déclarations installées : [animations](https://doc.babylonjs.com/features/featuresDeepDive/animation/groupAnimations/), [navigation V2](https://doc.babylonjs.com/features/featuresDeepDive/crowdNavigation/v2Intro/), [optimisation](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene/).

## Existant vérifié avant implémentation (historique)

`apps/world-web/src/scene/BabylonVillageScene.ts` construit des personnages composés de boîtes avec articulations des bras et jambes. `#createWorker` partage actuellement une matière de peau et de tunique ; les cheveux utilisent la matière de bois sombre. La marche est oscillatoire et les gestes de travail spécialisés sont absents.

`#updateExtractionPeople` crée `workerCount` figurants par lot. `#animateExtractionPeople` utilise la même `#travelPosition` pour tous, puis ajoute un décalage radial de 0,22 unité : ce décalage produit la grappe, sans espacement longitudinal ni contrôle de collision. `#animateHarvestPeople` anime séparément les Jardins ; aucune priorité n'est partagée entre ces flux. Le chargement bois devient visible au début de la phase de retour.

`#workerPath` ajoute un raccord visuel vers la porte de l'hôtel de ville, tournée vers −Z, sans changer le trajet métier. `#travelPosition` interpole la distance parcourue dans les fenêtres `startedAt → startedAt + transportMs` et `completesAt − transportMs → completesAt`. Le reste du lot correspond au travail. Les personnages sont supprimés quand le lot disparaît du snapshot actif.

`packages/contracts/src/travel-paths.ts`, notamment `buildTravelNetwork`, calcule des chemins cardinaux canoniques, avec préférence bornée pour les pistes partagées. Les chemins des lots engagés, les dates et le transport sont exposés dans `packages/contracts/src/villages.ts`. La projection locale passe par `#space`, les hauteurs par le terrain rendu. Un terrain absent désactive aujourd'hui le personnage plutôt que de le poser à une hauteur fictive.

Ces points sont l'existant relu, pas une livraison de cette nouvelle tranche. Il faut retirer le décalage radial et l'interpolation indépendante lors de l'intégration, pour éviter deux propriétaires concurrents de la position.

## Autorité et périmètre

Le serveur conserve l'affectation des cohortes, les réservations, les échéances, le débit physique, les crédits et les relèves. Les collisions locales, outils, troncs abattus, blocs et paniers sont de présentation. Ils ne déclenchent ni crédit ni destruction persistante d'un arbre individuel. Un bosquet reste une ressource agrégée.

La circulation couvre tous les personnages animés présents en vue Village : extraction bois, pierre et récolte des Jardins. Les postes de travail participent aussi aux obstacles visuels locaux. La simulation ne dépend pas du viewport pour les droits métier ; elle reste bornée aux représentants visibles. Région et Monde n'affichent pas ces détails et ne les simulent pas inutilement.

Hors scope : physique rigide, navigation libre mondiale, moteur de foule, nouveau pathfinder, individus en DB, qualifications, économie des outils, accidents, combat, transport inter-villages et refonte des routes. Aucun colis décoratif ne devient une entité métier autonome.

## Apparences et continuité

Créer une palette partagée de 3 matières de peau, 5 de tunique et 3 de cheveux, éclairées normalement. **Palette proposée à recetter** : peaux claire, intermédiaire et foncée ; tuniques vert mousse, bleu ardoise, ocre, terre cuite et écru ; cheveux brun sombre, châtain et blond. Les couleurs doivent rester discernables de jour et sous les braseros, sans émission lumineuse propre. Pantalons et accessoires peuvent conserver une matière neutre commune.

Attribuer une combinaison par une fonction déterministe de la clé du représentant. Pour un chantier : monde, village, chantier et indice visuel ; pour un lot ancien ou Jardin sans chantier : monde, village, lot et indice. Éviter les doublons parmi les dix membres d'une équipe, sans exiger l'unicité mondiale des 45 combinaisons. Déphaser marche et gestes entre représentants ; seule la scie d'un binôme exige une phase coordonnée.

Le snapshot n'expose pas d'identité individuelle stable d'habitant. Il serait donc incorrect de promettre qu'une personne donnée conserve sa couleur entre Jardin, chantier et repos. La continuité proposée est celle d'un représentant visuel, pas une preuve que la même personne simulée est revenue. Ne pas recycler un représentant simultanément entre deux missions actives.

## Formation et sorties de bâtiments

Chaque équipe possède un ordre stable, des rangs et une progression longitudinale. Un rang contient une personne en file ou deux en formation de binôme. Le premier rang sort par la porte, puis les suivants lorsque le dégagement est suffisant ; personne n'apparaît sur la route à côté de l'hôtel de ville. Le retour entre par cette même porte.

La largeur praticable provient de la géométrie de circulation existante, en retirant bordures, braseros et obstacles proches. `road-profile.ts` fixe une largeur pavée de 0,94 unité ; les chemins de terre de `village-roads.ts` atteignent environ 0,8 unité et peuvent être plus étroits localement. Une case de terrain ne représente donc pas une voie entièrement praticable.

Un binôme peut occuper la largeur libre de la voie lorsque personne ne vient en face. Ne pas lui imposer de tenir dans une demi-largeur : cela supprimerait presque partout cette formation. Détecter le flux opposé avant le croisement et passer progressivement en file à droite. Si deux personnes seules ne peuvent pas se croiser avec leurs marges, appliquer l'alternance du passage étroit. Deux binômes ne se croisent de front que sur une largeur effectivement suffisante. Un personnage impair ferme la formation.

**Réglages initiaux proposés**, en unités Babylon actuelles : rayon de collision horizontal 0,18 ; jeu de sécurité 0,08 ; entraxe longitudinal 0,48 à 0,60 ; largeur corporelle utile environ 0,36. Ces valeurs doivent être adaptées à la silhouette existante en recette. Le dégagement commande la sortie ; un décalage nominal de 0,20 à 0,35 seconde entre rangs peut amorcer la file mais ne remplace pas le contrôle d'espace.

Les rangs se resserrent en file avant les portes, angles serrés et passages étroits. Ils se redéploient progressivement après le dégagement, sans permutation instantanée ni déplacement latéral à travers une autre personne. L'espacement suit la distance du chemin, pas un décalage en X/Z fixe qui couperait les virages.

## Collisions locales

Chaque figurant mobile possède un disque horizontal et un prochain déplacement proposé. Une grille spatiale légère retrouve les voisins immédiats. Vérifier les déplacements balayés sur le pas de simulation, pour éviter que deux disques échangent leurs positions entre deux frames sans collision détectée.

Une personne suit son couloir et ralentit à l'approche de celle qui la précède, puis attend si le déplacement empiète sur la distance minimale. Pas de poussée physique ni de répulsion oscillante. Les décisions portent sur les rangs lorsque le binôme est formé : ne pas laisser une moitié avancer pendant que l'autre est arrêtée.

Le déplacement suit les segments du chemin existant ; les offsets restent dans l'espace praticable et reviennent vers le centre aux raccords étroits. Aux angles, la vitesse et le changement d'orientation sont lissés sans couper le bâtiment ou les bordures. Une attente arrête la marche ; la cadence des jambes suit la vitesse réelle pour éviter le moonwalk sur place.

La comparaison des voisins utilise des coordonnées locales déroulées cohérentes. Les clés de segments et de conflits utilisent monde et coordonnées canoniques. Traverser une couture torique ou changer l'origine de projection ne crée ni double personne ni conflit entre deux images d'une même voie.

## Priorités de passage

Les règles suivantes sont **proposées** comme première politique déterministe. Elles n'attribuent aucun droit économique sur une route.

| Situation | Règle proposée |
|---|---|
| Même sens | Garder l'ordre de la file ; aucun dépassement dans cette tranche. |
| Sens opposés sur voie assez large | Chaque flux garde sa droite. Les binômes se réduisent si les deux couloirs ne tiennent pas. |
| Passage étroit | Premier rang engagé prioritaire ; groupe opposé attend avant l'entrée. Réserver le passage et un dégagement de sortie avant d'y entrer. |
| Intersection | Réserver ensemble les zones de conflit traversées par le rang ; premier arrivé au point d'attente prioritaire. Une trajectoire compatible peut avancer en parallèle. |
| Égalité d'arrivée | Départage stable par clé de mission puis rang, jamais par ordre des meshes ou hasard par frame. |
| Porte de l'hôtel de ville | Double porte (halle-marché, 27 octobre) : deux voies à sens unique, entrée à droite et sortie à gauche vu de l'extérieur, jusqu'au raccord à la route où chaque voie rejoint le côté droit de son flux. Les voies ne sont jamais un passage réservé : les corps seuls y tiennent la distance. Une halle à porte simple garde l'ancien connecteur unique et son passage étroit. |
| Accès au poste | Libérer la sortie avant de prendre un poste ; ne pas attendre au milieu du chemin partagé. |

Ne pas réserver un itinéraire entier. Réserver un conflit seulement si une place de sortie est réservée avec lui, puis le libérer quand le dernier membre l'a quitté. Fusionner les conflits rapprochés lorsqu'aucun rang ne tient entre eux : ils deviennent un seul passage contrôlé, avec places d'attente avant ses entrées. Les rangs attendent hors de ce passage, pas sur une intersection.

Conserver une capacité d'accueil en aval avant d'admettre chaque rang. À saturation, retenir les nouveaux représentants à l'intérieur de l'hôtel de ville ou dans une aire d'attente du chantier ; cette rétention est visuelle et relève du compromis temporel ci-dessous. Ces règles empêchent les inversions locales de réservation, mais ne prouvent pas à elles seules l'absence de blocage sur toute boucle de routes. Les boucles pleines et conflits adjacents font partie des cas de validation ; ne pas annoncer une garantie globale à partir du seul contrôle de sortie libre.

**Proposition contre la famine** : alterner le sens après au plus deux rangs si une file opposée attend ; un groupe de dix ne monopolise donc pas un passage indéfiniment. L'ancienneté est conservée pendant l'attente. Un watchdog signale un blocage persistant pour le debug, mais ne débloque pas par téléportation ou collision forcée.

## Compatibilité avec le temps serveur

Le lot possède déjà une durée d'aller, de travail et de retour. Un départ échelonné, une attente à la porte et un croisement consomment du temps visuel. La proposition précédente de les faire tenir systématiquement dans la fenêtre de transport actuelle n'est **pas une garantie réalisable** : un trajet d'une seconde ne contient pas forcément la sortie de cinq binômes, et des attentes locales peuvent s'accumuler.

Invariants : distance ne rallonge que le transport ; aucun outil ne raccourcit le travail métier ; aucune animation n'antidate un départ ; le crédit survient à l'échéance serveur même si le navigateur est absent. Ne pas accélérer brutalement une file pour la recaler et ne pas supprimer des personnages chargés au milieu du chemin au crédit.

**Validé par Tristan** : préserver les dates serveur et accepter un décalage de présentation sur toute la séquence : attente de sortie → aller → installation → travail → chargement → retour → entrée. Un personnage n'effectue pas un geste de travail avant son arrivée visuelle. Le temps de geste montré peut être plus court que le travail métier lorsque l'aller a pris du retard ; ce raccourcissement visuel ne change ni énergie ni production. Le crédit peut précéder l'entrée des derniers représentants. Le panneau expose toujours l'état serveur.

Un objectif de décalage inférieur à 2 secondes reste un réglage de recette. En scène suivie, le retard se montre comme une attente : aucune reconstruction à huit secondes, aucun sprint ni collision forcée. Le retrait borné concerne seulement les missions obsolètes ; le fondu individuel retire l'ancienne présentation sans la replacer ailleurs. Une reprise après plus de trente secondes peut reconstruire une présentation actuelle.

Le représentant possède une seule incarnation. Lorsqu'un nouveau lot du même chantier est reçu avant la fin visuelle du précédent, retenir son nouveau départ visuel jusqu'à libération de ses représentants ; si la fin visuelle expire, retirer l'ancienne incarnation avant d'installer la nouvelle. Ne jamais créer une copie à la porte pendant que son prédécesseur rentre. Conserver au plus une fin de lot et le dernier état actif par chantier, sans rejouer une liste de lots historiques manqués. Le serveur peut avoir déjà réaffecté une cohorte : la présentation n'est pas une preuve d'identité individuelle.

La réduction du nombre de personnes ne constitue pas un correctif temporel par défaut. Elle ferait disparaître des rôles demandés, notamment les dix postes pierre. Le nombre visible fait l'objet d'un arbitrage séparé dans le budget de rendu.

L'intégration des attentes dans le transport serveur n'est pas retenue pour cette tranche. Elle demanderait un arbitrage métier ultérieur sur énergie, contrats et missions anciennes.

## Animation du bois

Pendant la phase de travail, placer des postes distincts près des arbres du bosquet : sciage sur arbre debout et débitage sur un tronc au sol. Les personnages rejoignent leur poste depuis un point d'arrivée dégagé, rang après rang. Les binômes se font face autour d'une scie commune ; ils tirent alternativement, avec les mains aux poignées. Une personne seule frappe avec la hache, marquant une brève préparation et un impact lisible.

**Répartition validée**, conservant au moins une personne au débitage à partir de trois :

| Effectif | Sciage ou hache | Débitage |
|---|---|---|
| 1 | 1 à la hache | Gestes alternés par cette personne |
| 2 | 1 binôme à la scie | Gestes alternés ensuite par le binôme |
| 3 | 1 binôme | 1 personne |
| 4 | 1 binôme | 2 personnes |
| 5 | 2 binômes | 1 personne |
| 6 | 2 binômes | 2 personnes |
| 7 | 2 binômes | 3 personnes |
| 8 | 3 binômes | 2 personnes |
| 9 | 3 binômes | 3 personnes |
| 10 | 3 binômes | 4 personnes |

Ces postes organisent l'animation ; ils ne changent pas la formule économique de productivité. Le nombre d'arbres du mesh n'est pas une quantité récoltable individuelle. Les petits bosquets utilisent les dispositions compactes définies ci-dessous : les binômes conservent leur rôle mais peuvent alterner sur un nombre réduit de postes, sans superposer les personnes. Une place d'attente est nécessaire pour chaque personne momentanément sans poste.

Utiliser un tronc décoratif couché et quelques sections de bois, réutilisés dans une boucle de travail. Une chute d'arbre éventuelle est un événement de présentation limité à l'enveloppe du chantier ; elle ne remplace pas la variation de végétation autoritative liée au stock. Le bosquet peut repousser après Coupe ; le reliquat disparaît selon le défrichage serveur, pas selon le nombre de coups de scie.

Avant retour, ranger les outils et prendre des bûches. Charge visible seulement pendant chargement/retour ; jamais portée pendant le sciage. Le nombre et la taille des bûches restent stylisés et ne promettent pas une conversion mesh/unité de bois. Pause et arrêt laissent finir les gestes et le lot engagé ; aucun nouveau cycle de départ n'est déclenché côté rendu.

## Animation de la pierre

À dix : cinq personnes travaillent à la pioche au front accessible, trois débitent les blocs dans une aire latérale et deux déplacent les blocs puis remplissent les paniers. Les manutentionnaires circulent sur une petite boucle interne distincte de la voie d'arrivée ; leurs déplacements utilisent la même prévention des collisions.

**Répartition validée pour les autres effectifs** :

| Effectif | Piocheurs | Débiteurs | Manutentionnaires |
|---|---|---|---|
| 1 | 1, alternant les trois tâches | 0 | 0 |
| 2 | 1 | 1, assurant aussi le transport | 0 |
| 3 | 1 | 1 | 1 |
| 4 | 2 | 1 | 1 |
| 5 | 2 | 2 | 1 |
| 6 | 3 | 2 | 1 |
| 7 | 3 | 2 | 2 |
| 8 | 4 | 2 | 2 |
| 9 | 4 | 3 | 2 |
| 10 | 5 | 3 | 2 |

Le coup de pioche arrache visuellement un petit bloc, le débitage le réduit en fragments, puis un manutentionnaire pousse ce bloc ou remplit un panier. Réutiliser un petit nombre d'accessoires pour ces boucles ; ne pas accumuler des fragments à chaque impact. Éviter une physique de gravats. Les cinq piocheurs occupent plusieurs points distincts du front, sans pénétrer le mesh. Si l'espace manque, utiliser des rotations sur des postes partagés et des places d'attente ; déphaser les gestes ne crée pas d'espace supplémentaire.

Les outils sont adaptés au rôle et ne restent pas dans les mains pendant le transport chargé. Au retour, montrer paniers ou charges stylisées. L'épuisement et la libération de la case restent déterminés par le serveur. Les figures de travail finissent leur sortie avant destruction des accessoires de présentation.

## Implantation des postes et accessoires

Prévoir trois dispositions prédéfinies par ressource : front étalé, aire latérale et disposition compacte. Les orienter depuis le dernier segment d'approche du chemin, puis essayer un nombre borné de rotations et de symétries. Chaque disposition décrit entrée, sortie, postes, places d'attente, aire de chargement et trajet interne des manutentionnaires. Aucune recherche libre de navigation n'est nécessaire.

Vérifier les emprises contre eau, bâtiments, bordures, braseros et végétation voisine. Les stations peuvent utiliser une petite aire libre contiguë au gisement, sans bloquer la route partagée et sans acquérir de droits métier sur ces cases. Les arbres et blocs travaillés restent accessibles depuis un poste extérieur à leur volume. Chaque scie, tronc, bloc poussé et panier possède un propriétaire et une emprise ; les débattements d'outil et les charges entrent dans le dégagement du poste.

La variante compacte réduit les postes simultanés, pas les personnes ni leurs rôles assignés : les autres attendent sur des places libres puis prennent leur tour. Ainsi dix personnes peuvent conserver une répartition pierre 5/3/2 sans prétendre que cinq pioches frappent simultanément un front trop petit. Deux équipes locales partageant une zone ne réservent pas la même place visuelle.

Si aucune disposition ne tient, conserver l'équipe dans une aire d'approche sûre et signaler le cas en debug ; ne pas traverser un obstacle ni refuser la mission serveur. Cette situation est un défaut de couverture des dispositions à corriger avant livraison, pas un résultat esthétique accepté. La recette doit inclure un gisement coincé entre obstacles ; une garantie d'affichage intégral ne signifie pas que toute géométrie arbitraire peut accueillir dix figures sans adaptation.

## Architecture minimale de rendu

Une seule couche locale possède les positions finales des personnages. Elle reçoit les représentants actifs, leurs chemins, phases métier, formations et postes. Les animations de membres et accessoires lisent l'état visuel résultant : marche, attente, hache, scie, pioche, débitage, manutention, chargement. Les méthodes actuelles Jardin/extraction deviennent des adaptateurs de cette couche, sans conserver leur propre écriture concurrente de position.

Extractions bornées aujourd'hui à huit chantiers ouverts et dix travailleurs par chantier : au plus 80 représentants pour ces chantiers, auxquels s'ajoutent Jardins, anciens lots indépendants et fins visuelles. Ne pas confondre cette borne avec un plafond global garanti. Le chiffre de 120 figures est un scénario de mesure, pas une capacité prouvée : le modèle actuel comporte huit meshes par personne avant outils et charges, soit jusqu'à 960 meshes pour ce scénario.

**Garantie validée par Tristan** : conserver tous les participants du chantier observé, notamment la composition pierre 5/3/2. Dégrader d'abord les accessoires secondaires, les gestes et leur fréquence à distance ; garder la cadence des contrôles de collision distincte de celle du squelette. Réutiliser géométrie et matériaux, puis mesurer le coût CPU/GPU et les appels de dessin. Réduire le nombre de figures requiert un nouvel accord produit explicite ; ce n'est pas une réponse automatique à une baisse de fluidité. Une baisse de qualité ne modifie pas les affectations serveur.

La boucle locale peut tourner à pas fixe de 1/30 s avec interpolation au rendu, grille spatiale et contrôle de voisinage. Borner le nombre de pas de rattrapage par frame. Après suspension longue d'onglet, reconstruire directement depuis le temps serveur, au lieu de simuler les minutes manquées. Les files, réservations et outils sont de courte durée et nettoyés avec la scène, le changement de monde ou le changement de LOD.

Babylon garde `TransformNode`, meshes simples, matériaux partagés et articulations existantes. Les animations peuvent employer ses primitives disponibles dans la version du projet ou des courbes procédurales ; une scie partagée doit avoir un propriétaire unique. Aucun moteur de physique, asset distant, nouveau modèle hi-poly ou nouvelle lumière par personnage n'est requis. Vérifier les API installées avant de choisir une primitive Babylon.

Les accessoires statiques identiques peuvent être instanciés. Aucun matériau par combinaison complète ou par figurant : les 11 matières de palette se partagent. Éviter allocation de tableaux/meshes et reconstruction de chemins par frame. Une extraction quittant le snapshot peut conserver uniquement sa courte fin visuelle si l'arbitrage temporel l'autorise ; ce reliquat ne reste pas un lot actif.

## Reconstruction et changements du terrain

Après F5, retrouver phase, apparence et poste à partir du lot et de l'heure serveur. Ne pas rejouer depuis la porte un aller déjà terminé, ni toutes les chutes/impacts passés. Reconstruire une formation plausible et espacée sur les chemins chargés ; un bref fondu d'apparition peut masquer cette initialisation, sans parcourir de force une file existante.

Une arrivée de snapshot ne recrée pas les figures d'un même lot ni leurs matières. Déplacement et rotation de caméra ne changent pas la priorité. Recentrage du monde projette à nouveau les mêmes coordonnées ; une couture ne remet pas l'attente à zéro.

Un changement de route ne recalcule pas l'itinéraire métier d'un lot engagé. La hauteur provient des données de terrain, indépendamment de `rendered()`. Un mesh absent ne masque plus une hauteur connue. Si les données de hauteur manquent réellement, retenir la progression à la position courante, masquer localement la figure, conserver son identifiant et reprendre à cette position quand la hauteur revient. Le Jardin conserve aussi sa progression de rangée. Un bâtiment qui recouvre un ancien trajet est un conflit visuel réel : le signaler en debug et résoudre localement par un raccord praticable si disponible, sans annuler le lot serveur ni traverser arbitrairement les murs.

## Ordre de réalisation proposé

1. Apparences partagées et états de mouvement/travail sur les figurants actuels.
2. Propriétaire commun des positions, formations et départs par la porte ; préserver les contrats existants.
3. Distances minimales, croisements à droite, conflits aux intersections et passages étroits, avec cas Jardins/extractions mélangés.
4. Postes bois à un et deux, puis répartition à trois et dix ; transport de bûches.
5. Postes pierre et boucle de manutention ; paniers au retour.
6. Reconstruction F5/LOD, nettoyage, budget de rendu et recette prolongée.

Chaque étape doit être recettable séparément. L'arbitrage temporel et les répartitions sont clos ; appliquer les garanties validées aux étapes 2, 4 et 5. Pas de refonte économique pour rendre une première animation visible.

## Vérification proportionnée et recette humaine

Tests unitaires ciblés sur les comportements : suivre sans chevauchement, collision balayée entre deux pas, croisement, priorité stable, passage étroit alterné, absence de deadlock et couture torique. Une reprise de snapshot doit conserver les apparences et ne pas dupliquer les figures. Vérifier séparation entre événements décoratifs et livraison économique. Pas de suite E2E dans cette tranche, conformément à l'instruction courante de Tristan.

Recette humaine : observer à un, deux, trois et dix travailleurs ; deux chantiers avec un Jardin sur une route commune ; entrée/sortie simultanées de l'hôtel de ville ; virage près d'un brasero ; arrêt/pause pendant travail et retour ; F5 et changement de LOD pendant chaque phase ; trajet très court et saturation de la porte. Vérifier charge, pied au sol, orientation, cadence, variété des vêtements et lisibilité de nuit. Mesurer le coût CPU/GPU avec le nombre réel de figures, sans annoncer un gain de fluidité sur simple lecture.

Critères de sortie : aucune grappe sur un parcours normal, aucun passage corporel entre figures mobiles, priorité compréhensible et files qui progressent dans les scénarios supportés, gestes lisibles par rôle, aucune disparition instantanée chargée en pleine route, aucun crédit/retrait de ressource déclenché par un geste, et coût borné après plusieurs allers/retours. Ajouter aux preuves : boucle saturée, deux intersections sans place intermédiaire, chantier contraint, nouveau lot avant dernier retour visuel et reconstruction après suspension. Les éventuels fondus de reconstitution sont évalués comme compromis temporel explicite ; aucune garantie universelle de fluidité, de place disponible ou d'absence de retard n'est affirmée sans preuve.

## Garanties arbitrées et réglages de recette

1. **Temps visuel validé, révisé le 12 octobre** : décalage accepté, attente visible sans repositionnement en scène suivie, retrait borné des fins obsolètes, économie inchangée et aucune double incarnation.
2. **Effectifs visibles validés** : conserver tous les participants du chantier observé, dégrader d'abord le détail des animations éloignées ; aucune réduction automatique de la composition 5/3/2.
3. **Répartitions des rôles validées** : les deux tables sont retenues, notamment bois à quatre = un binôme et deux débiteurs, bois à dix = trois binômes et quatre débiteurs, pierre à dix = 5/3/2. Les rotations sur les postes sont une adaptation technique proposée lorsque l'espace manque ; elles conservent les rôles et doivent rester lisibles en recette.

Les règles précises de priorité, palettes, espacements, cadence et seuils de reconstitution constituent les réglages initiaux proposés à recetter. Aucun arbitrage produit supplémentaire n'est requis dans ce périmètre ; une impossibilité de tenir les garanties doit être rapportée, pas résolue en réduisant silencieusement les effectifs ou en changeant l'économie. La rédaction initiale ne modifiait aucun code ; l'implémentation ensuite autorisée est décrite dans « Réalisation de cette tranche ».

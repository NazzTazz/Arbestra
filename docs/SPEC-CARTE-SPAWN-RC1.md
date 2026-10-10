# Carte d'arrivée et choix d'emplacement — alpha RC1

**Arbitrage du 10 octobre 2026 :** atlas stylisé, titre/slogan dynamiques et éditables, sélection libre par cercle de **8 cases**. La piste des trois propositions est remplacée par ce choix libre. Nettoyage limité aux emprises du starter-kit, bande **±2 niveaux**, arbres sous emprise retirés sans crédit de bois ; eau et rochers préservés. Les territoires tracés interdisent également l'installation. Voir le [cadrage atlas](CADRAGE-CARTE-ATLAS-RC1.md) et le [suivi atlas](IMPLEMENTATION-ATLAS-RC1.md) pour l'état réel.

Mise à jour : 10 octobre 2026. Base relue : `main`, commit `06837b9`.
Statut : **arbitrages produit consolidés le 10 octobre 2026 — arrivée jouable en cours**. Parcours, qualification, terrassement, voisinage, démarrage économique, présentation climatique et dotations définis ci-dessous. Les conventions d'implémentation complètent les décisions produit sans introduire de mécanique supplémentaire. Ce statut qualifie la cible, pas une livraison jouable : aucun monde opérationnel n'est ouvert. L'état réellement réalisé et ses limites sont dans [le suivi atlas](IMPLEMENTATION-ATLAS-RC1.md).

**Portée d’exploitation validée le 10 octobre 2026 : 16 cases** depuis une cellule d’emprise de bâtiment terminé (distance de Chebyshev torique historique), pour le bois et la pierre, avec trajet praticable obligatoire. Cette règle commune remplace 8 cases ; aucune exemption propre aux ressources du starter. Les gros gisements éloignés peuvent demander de développer le village vers eux. Le rayon du disque de diagnostic reste 8 cases.

## 1. Résultat joueur et périmètre

Dans cette spec, « centre-ville » désigne l'hôtel de ville du starter-kit (`town-hall`). Sa pose réussie est le fait générateur de l'installation du village et du démarrage de son économie.

Le joueur entrant explore une carte à plat du monde approuvé, comprend où son installation est possible et choisit son emplacement. Il voit les villages, le relief, l'eau, les arbres et les roches. Un disque discret suit son curseur ; les arêtes incompatibles en rouge lui permettent de repérer les surfaces gênantes et de rechercher une implantation valide. Le disque est une zone de diagnostic : il n'a pas à être entièrement dépourvu de rouge.

La première tranche technique livre la carte, les informations de survol, le diagnostic d'admissibilité, le panneau de zone et la confirmation serveur du choix, sur copie de recette. Elle reste interne tant que la préparation du village n'est pas raccordée. Le parcours joueur livré doit enchaîner « Choisir cet emplacement » avec la vue locale vide et le kit transparent ; la pose du centre-ville crée le village et engage l'installation. La préparation ne réserve pas de zone et permet un retour libre à la carte. La pose du starter-kit et le terrassement constituent la tranche technique suivante, cadrée en section 7.

## 2. Décisions produit et conventions d'implémentation

### Validé dans la session

- Conserver la géographie alpha 512 × 256 RC1.
- Présenter une carte du monde à plat avec villages, relief, eau, arbres et roches.
- Au survol d'un village : nom du joueur et population, sans cartouche ni toast.
- Une zone libre exige une distance euclidienne torique strictement supérieure à 50 cases entre centres-villes. La position finale du centre-ville est recontrôlée à la pose. Le disque de rayon 8 cases est une zone de diagnostic : il peut contenir de l'eau, des roches et du relief incompatible hors des emprises choisies par le joueur. Les disques peuvent se chevaucher et ne réservent aucun territoire.
- Afficher sous le curseur ce disque en surbrillance discrète, au-dessus du terrain, avec les arêtes de grille incompatibles en rouge ; changer le curseur lorsque l'emplacement est admissible.
- Le premier clic sur la carte ouvre un panneau de zone avec bouton « Choisir cet emplacement ». L'ensoleillement prend la forme d'une courbe de luminosité sur 24 h, avec un soleil dessiné sur le premier sommet et une lune sur le premier creux. Humidité, température, vent et précipitations portent « En attente d'instrumentation ». Toutes ces informations sont descriptives et ne bloquent pas le choix d'emplacement.
- Après choix, cible du parcours complet : vue Village vide et starter-kit transparent, manipulé comme un méta-bâtiment. Clic gauche pose l'ensemble ; clic droit passe en pose manuelle ; R tourne l'ensemble de 90° par pression. Échap passe également en manuel, selon la demande initiale.
- « Choisir cet emplacement » ouvre la préparation ; retour libre à la carte avant pose. Aucune réservation pendant cette préparation. La pose du centre-ville crée le village et engage l'installation ; le mode manuel impose de poser le centre-ville en premier, puis conserve les éléments restant à poser après déconnexion.
- La pose réussie de l'hôtel de ville démarre l'économie avec les habitants et stocks initiaux validés. Seuls les bâtiments effectivement posés fonctionnent ; les éléments encore dans le kit ne produisent aucun effet. L'économie n'attend pas la fin de la pose manuelle et le kit restant est conservé jusqu'à sa pose.
- Le serveur recontrôle la disponibilité à la pose. Si un voisin s'est installé entre-temps, il refuse la pose sans consommer le kit et permet au joueur de déplacer son projet.
- L'altitude du terrain au point de pose du centre-ville est la référence commune du terrassement initial, et non celle du centre du disque de diagnostic. Elle est conservée pour la pose manuelle des autres éléments du kit.
- Les irrégularités de maximum ±2 niveaux autour de cette référence peuvent être terrassées gratuitement, uniquement dans les emprises des éléments effectivement posés. Un niveau vaut ¼ de case en hauteur. Aucun aplanissement de tout le disque.
- Cette bande ±2 suffit pour la qualification du relief des emprises : aucun seuil supplémentaire de pente ou de rupture locale n'est ajouté. La praticabilité des accès piétons est contrôlée séparément, sans assimiler une emprise terrassable à un passage franchissable.
- Accès piétons RC1 : seuil validé pendant l’implémentation, au maximum un niveau (¼ de case verticale) par case horizontale parcourue, contrôlé le long du passage sec. Ce seuil ne s’applique pas aux emprises terrassables et ne modifie pas la règle historique des autres mondes (altitude identique ou escalier explicite).
- Les arbres sous ces emprises sont retirés gratuitement lors de la pose, sans crédit de bois. Les arbres hors emprise sont conservés.
- Roches et eau interdisent la pose sur leurs surfaces ; le joueur ajuste le kit pour les éviter. Ni suppression des roches ni remblai de l'eau ne sont autorisés.
- Afficher « Zone pauvre en ressources » s'il manque du bois exploitable à moins de 15 cases de trajet depuis l'hôtel de ville candidat **ou** de la pierre naturelle exploitable à 40 cases maximum de trajet. Évaluer avant ajout de la dotation. Cet avertissement ne bloque ni le choix ni le spawn à lui seul.
- Au spawn effectif (pose réussie de l'hôtel de ville), placer deux mini-gisements de 150 pierres brutes chacun à proximité : au moins 10 cases du bord des emprises du starter-kit, avec un trajet piéton depuis l'hôtel de ville de 20 cases maximum. Placer aussi deux gros gisements de 2 000 pierres brutes chacun, à plus de 20 et jusqu'à 40 cases de trajet depuis l'hôtel de ville. Ce mécanisme intervient à l'installation, pas pendant l'inspection.
- Si aucun arbre exploitable n'est accessible à moins de 15 cases de trajet piéton depuis l'hôtel de ville, ajouter quelques arbres exploitables dans cette portée pour permettre le développement vers les ressources naturelles. Vérifier cette condition sur l'état après dégagement des emprises effectivement posées.
- Le complément bois, uniquement si nécessaire, est composé de deux bosquets de trois arbres chacun. Un arbre représente 500 bois bruts : chaque bosquet porte 1 500 bois, soit 3 000 bois au total, à exploiter.
- Si tous les compléments requis ne peuvent pas être placés dans les limites prévues sur des emplacements sûrs et accessibles, signaler le manque de place pour la dotation et laisser déplacer le projet. Aucun village créé, aucun kit consommé, aucun arbre retiré et aucun terrain modifié. La pauvreté naturelle reste non bloquante ; l'impossibilité d'aménager la dotation impose d'ajuster l'implantation.
- En mode manuel, la référence pour placer les compléments est l'emprise du starter-kit complet dans son orientation au passage en manuel, ancrée sur la position finale de l'hôtel de ville. Elle sert à mesurer les marges et à éviter les compléments dans l'espace prévu pour les éléments restants ; elle ne réserve pas de terrain.

### Conventions d'implémentation et preuves attendues

Territoires, arbitrage validé le 10 octobre : un contour simple par village, contenant son HDV et intégralement compris dans le disque torique de rayon **30 cases** autour de celui-ci. Aucun chevauchement avec un autre territoire ; le contour inclut sa frontière. Seul le propriétaire peut le remplacer ou l'effacer. Ces tracés interdisent un nouvel HDV à l'intérieur, sans réserver ressources ni constructions. La distance historique **strictement supérieure à 50 cases** entre HDV reste conservée ; le territoire n'en réduit jamais la marge. La portée 30 est actuellement incluse dans cette exclusion de voisinage, mais les deux règles restent explicites et vérifiées séparément.

- Reprendre les emprises réelles du modèle figé et des règles de pose : bâtiments, surfaces de chaussée et équipements. Une boîte englobante du kit ne devient pas une surface intégralement terrassée. Les raccords restent dans les emprises autorisées ; toute emprise ou mission voisine est préservée.
- Évaluer le relief sous-cellulaire avec une méthode partagée, déterministe et versionnée. Sa résolution et ses tolérances numériques doivent être documentées et éprouvées sur RC1, notamment les affleurements fins, berges et coutures ; elles ne créent pas un nouveau seuil de gameplay.
- **Validé le 10 octobre 2026 : chaque gisement naturel RC1 possède 2 000 pierres**, par formation (`stoneSite`), indépendamment du nombre de blocs décoratifs qui la composent. Ce barème concerne sa première projection économique ; aucune redotation aux connexions ou aux poses suivantes. Les compléments restent à 150, 150, 2 000 et 2 000 pierres.
- Une ressource visible n'est exploitable que si elle possède une projection économique et un accès serveur valides. La qualification de cette projection naturelle est une dépendance de la recette jouable, pas une autorisation de réécrire les stocks des mondes existants. Le rapport de couverture de preview ne remplace ni ces dépôts ni leur accès.
- Les conventions de sélection, navigation, accessibilité et états asynchrones sont définies en section 4. Les noms de types, endpoints et structures de cache relèvent de l'implémentation bornée ; ils ne demandent pas de nouvel arbitrage produit.

## 3. Référence immuable et existant vérifié

Référence : [terrain témoin T1](TERRAIN-TEMOIN-T1.md), `apps/world-web/public/studies/t1-alpha512-rc1.json`, manifeste et rapport de couverture associés. SHA256 du fichier : `de165c395c26eb70572a4370d9a537661e9eaf78b477e1694cfda283418702a4`. Domaine 512 × 256, chunks 32 × 32, 15 029 arbres, 28 groupes / 177 rochers. Eau approuvée de preview au niveau zéro.

Constats de l'étude préalable, obtenus par lecture du code et inspection du JSON :

- `TerrainStudy.tsx` charge un artefact public ; l'URL `world=t1-alpha512` désigne la variante de travail, pas un alias explicite RC1. L'eau zéro est ajoutée par la preview, absente du descripteur RC1 brut.
- Les tableaux `terrainCodes` et `walkable` de RC1 sont entièrement à zéro. Ils ne permettent pas d'en déduire un sol jouable.
- `writeV3Chunks()` dans `apps/api/src/modules/world-generator/artifact.ts` persiste uniquement les tableaux de compatibilité, pas le champ géographique complet ni les dépôts économiques.
- Le protocole terrain et le rendu Village utilisent encore les conventions historiques : échelle 0,025 et eau à −0,75 dans `terrain-unit.ts`. Copier les tableaux dans ce chemin ne conserverait pas la géographie approuvée.
- `joinWorld()` dans `apps/api/src/modules/onboarding/service.ts` attribue automatiquement une clairière protégée libre et initialise le modèle figé. Ce chemin ne permet ni le choix cartographique du joueur ni la pose interactive du kit.
- Le garde d'ouverture dans `world-generator/service.ts` refuse v3. Inscription, sessions, lobby et initialisation atomique existent déjà ; voir [onboarding](SPEC-ONBOARDING-JOUEUR.md).

Ces limites demandent un raccord explicite ; aucun contournement du garde d'ouverture n'appartient à cette tranche.

## 4. Carte et interactions

### Carte à plat

Utiliser le champ géographique et les formations de RC1, avec l'eau statique approuvée à zéro. Conserver positions, relief, forêt et pierre ; ne pas régénérer depuis une seed ni remplacer les arbres par une distribution nouvelle. La carte reste périodique : les voisins de l'autre bord comptent dans les distances, diagnostics et accès.

Les villages sont représentés à leurs positions canoniques. Au survol ou focus, afficher uniquement le nom du joueur et la population, en texte discret près du pointeur ou du village ciblé, sans fond de cartouche ni toast. Prévoir un contraste lisible sur les différentes surfaces. Garder le texte lisible pendant son survol ou le focus et permettre de le masquer ; le retirer lorsque la cible et le texte ne sont plus survolés ou ciblés. Aucun autre détail de compte ou économique n'est exposé.

### Navigation, sélection et accessibilité

Un clic sans glissement inspecte ; un glissement déplace la carte sans déclencher de sélection à son relâchement. Conserver la vue à plat et fournir zoom au pointeur, boutons de zoom et retour au cadrage global. Les villages ont priorité sur le sol au picking ; le disque, les textes et les éléments décoratifs ne capturent pas les clics de terrain.

Le clic fige le point inspecté et un marqueur persistant. Le panneau et son bouton restent liés à cette sélection ; le disque mobile peut continuer à montrer un autre point sans remplacer la sélection. Un nouveau clic sur le terrain remplace celle-ci. Fermer le panneau rend le focus à la carte. Les interactions avec le panneau ne traversent pas vers le terrain.

La couleur rouge est accompagnée d'une différence de trait et d'un état textuel discret indiquant le motif principal de refus, sans attendre un clic pour le comprendre. Prévoir les états chargement, calcul en cours, admissible, inadmissible, vérification serveur et erreur réessayable. Le calcul en cours n'est jamais présenté comme une autorisation acquise. Les annonces accessibles suivent les changements d'état significatifs, pas chaque mouvement du pointeur.

Clavier : carte focalisable, déplacement du centre d'inspection aux flèches, Entrée pour inspecter, accès aux commandes du panneau par Tab ; les raccourcis de carte ne s'exécutent pas depuis un champ de saisie. Tactile : tap pour inspecter, glissement pour déplacer la carte et commandes de zoom visibles. Pour la préparation, fournir des boutons équivalents à Tourner, Pose manuelle et Retour à la carte. R ne tourne qu'à chaque pression, hors saisie et hors répétition automatique. Les commandes Échap et clic droit de passage en manuel restent celles du mode préparation ; elles ne s'appliquent pas globalement aux panneaux ou à la carte.

### Disque de diagnostic

Le centre suit le point de terrain sous le pointeur. Le disque a un rayon de 8 cases dans la grille canonique ; sa projection à plat ne change pas les distances métier. Aux coutures, montrer ses portions correspondantes sur les bords opposés et calculer un seul disque torique.

Le disque révèle les contraintes du voisinage ; il ne constitue ni une emprise à terrasser ni une réserve de territoire. Une berge, un rocher ou un relief incompatible à l'intérieur n'interdit pas à lui seul le choix de la zone. **Le joueur trouve son emplacement et choisit l'orientation du kit.** Le diagnostic contrôle ce projet précis aux coordonnées et dans l'orientation demandées, selon la section 5 ; il ne recherche pas d'autre implantation dans le disque et ne déplace ni ne tourne le kit à sa place. Le joueur ajuste son projet à partir des contraintes affichées. Le diagnostic ne supprime rien ; seule la pose effective retire les arbres sous ses emprises, sans toucher aux roches ni à l'eau.

Le placement automatique concerne uniquement les compléments de ressources validés en section 8, autour de l'hôtel de ville choisi par le joueur. Un calcul interrompu de cette dotation ne prouve pas une absence de place. La bande de terrassement validée est de ±2 niveaux, uniquement sur les emprises du kit.

La surbrillance laisse lire le relief, les arbres, l'eau et les formations rocheuses. Le diagnostic est un overlay, sans modification du terrain ni création d'entités décoratives persistantes.

Les arêtes rouges matérialisent les limites des surfaces incompatibles : terrain hors bande ±2 par rapport à l'hôtel de ville candidat, eau, roche ou occupation protégée. Pendant l'inspection, le centre du disque est l'ancre proposée de l'hôtel de ville ; une sélection fige son propre point tandis que le survol peut inspecter un autre projet. La référence du diagnostic correspond toujours au projet évalué, dont l'ancre est visible. Une pente douce cumulée devient incompatible lorsqu'elle dépasse cette bande ; une rupture restant dans la bande ne reçoit pas un veto supplémentaire de terrassement. Le rouge ne repose pas sur la normale du mesh ou sur une appréciation visuelle. La franchissabilité des trajets est un diagnostic distinct.

Le rouge localise les surfaces incompatibles, sans condamner automatiquement tout le disque. Le curseur indique l'admissibilité complète du projet du joueur à ce point et dans l'orientation choisie, en tenant compte des voisins, occupations, de l'eau et de la possibilité d'aménager la dotation requise. Le panneau explique les refus non représentables par une arête de relief, notamment un voisin trop proche ou l'absence de place pour les compléments. La rareté naturelle des ressources est signalée séparément par « Zone pauvre en ressources » : elle ne produit ni curseur d'interdiction ni désactivation du bouton à elle seule.

### Inspection et choix

Le premier clic inspecte la zone ; il ne crée aucun village. Le panneau comporte :

| Information | Présentation attendue |
|---|---|
| Ensoleillement | Courbe de luminosité locale sur 24 h ; soleil au premier sommet, lune au premier creux |
| Humidité | En attente d'instrumentation |
| Température | En attente d'instrumentation |
| Vent | En attente d'instrumentation |
| Précipitations | En attente d'instrumentation |

Ces informations sont descriptives : aucun seuil de luminosité, humidité, température, vent ou précipitations ne participe à l'admissibilité. Ne pas afficher l'indice procédural d'humidité comme une mesure instrumentée ; les quatre rubriques en attente ne reçoivent ni valeur estimée ni unité physique fictive. L'instrumentation future et la production de statistiques de température restent hors de cette tranche.

La courbe représente le cycle solaire local canonique de 24 h, et non une prévision météorologique. Réutiliser `illumination()` et le cycle combiné de `packages/contracts/src/cosmology.ts` : le code actuel combine trois rotations du tore de 8 h et deux parcours solaires de 12 h, soit 24 h. `buildExposureField()` fournit une moyenne, insuffisante à elle seule pour tracer la courbe ; échantillonner le cycle local complet. Conserver les variations et occultations réelles du modèle, sans les remplacer par une sinusoïde illustrative.

Convention de présentation : abscisse de 0 à 24 h sur un cycle de référence stable, commun aux emplacements, avec libellé « Heure du cycle » ; ne pas dépendre de l'heure du navigateur ou de la date d'ouverture du panneau. Ordonnée « Luminosité relative », sur une échelle commune de 0 à 1 issue de `illumination().direct`, pour permettre la comparaison des lieux. Calculer pour le point inspecté et garder le graphe lié à la sélection du panneau, pas au seul survol du pointeur.

Placer les pictogrammes dans l'ordre chronologique de gauche à droite : soleil au premier maximum local, lune au premier minimum local. Un plateau d'extrême reçoit un seul marqueur, au milieu de sa portion affichée ; les autres sommets et creux restent visibles sans répétition de ces pictogrammes. Si la courbe est constante, ne pas inventer d'extrêmes : indiquer une luminosité constante. Prévoir une description textuelle accessible du cycle et de ses phases lumineuses/sombres. Les pictogrammes servent de repères de lecture de la courbe.

Le bouton « Choisir cet emplacement » est désactivé tant que le diagnostic n'est pas admissible ou que la validation est en cours. À l'activation, le serveur recontrôle la zone sélectionnée. Un refus actualise le diagnostic et garde le joueur sur la carte. Une réussite ouvre la préparation locale avec le kit transparent, sans créer le village ni garantir la disponibilité future. La première tranche technique teste cette confirmation sur copie interne ; elle ne constitue pas un parcours joueur livrable tant que la transition vers la préparation manque.

## 5. Qualification autoritaire

Partager les règles géométriques déterministes dans `packages/contracts`. Le client peut prévisualiser une décision à partir des données reçues ; le serveur décide de l'admissibilité sur l'état courant du monde.

La qualification couvre :

1. Coordonnées canoniques et disque torique de rayon 8.
2. Distance euclidienne torique entre le centre-ville candidat et chaque centre-ville existant, y compris aux coutures ; exactement 50 cases est refusé. Le centre du disque ne remplace pas la position finale à ce contrôle.
3. Sol sec et bande globale de ±2 niveaux autour de l'altitude du centre-ville candidat sur les emprises à poser, sans autre seuil de pente. Contrôler le terrain effectif, pas les tableaux de compatibilité nuls de RC1. Une incompatibilité ailleurs dans le disque ne suffit pas à rejeter la zone ; contrôler séparément les accès piétons nécessaires, sur sol sec avec une pente maximale de ¼ de case verticale par case horizontale parcourue, y compris entre les points du trajet.
4. Occupations et formations naturelles : roches et eau bloquent les emprises ; arbres retirables gratuitement sous les seules emprises posées, sans crédit de bois. Le diagnostic n'exécute pas ce retrait.
5. Compatibilité avec les emprises du modèle initial et possibilité de placer tous les compléments requis aux distances validées. L'admissibilité du centre ne préjuge pas de toutes les orientations et translations futures du kit. Le diagnostic de richesse naturelle produit un avertissement non bloquant ; l'impossibilité de placer la dotation produit un refus distinct, avec projet à déplacer.

Le diagnostic du projet et le calcul des compléments ne réservent aucune zone et ne modifient ni terrain, ni dépôts, ni économie. À la pose effective future, refaire les contrôles sous les verrous spatiaux appropriés : deux joueurs peuvent avoir inspecté la même zone.

Le diagnostic de pauvreté utilise les ressources naturelles exploitables et accessibles avant ajout de la dotation, en tenant compte des retraits d'arbres prévus sous les emprises effectivement posées. Avertissement si `absenceBoisTrajetStrictementInferieurA15 OU absencePierreNaturelleTrajetInferieurOuEgalA40`. Un gisement épuisé ou sans stock disponible ne constitue pas une ressource exploitable. Ne pas compter les compléments envisagés pour masquer l'avertissement ; ne pas imposer un nouveau seuil de quantité non validé. Recalculer pour la position finale de l'hôtel de ville.

Le contrôle du voisinage et la création doivent partager la transaction et la sérialisation spatiale, afin que deux poses concurrentes ne puissent toutes deux valider un voisinage devenu incompatible. Réessayer une commande réussie retrouve le même village ; un refus n'entame pas le kit. Les poses manuelles suivantes consomment chacune uniquement l'élément correspondant du kit persistant, dans leur transaction de pose.

## 6. Contrats et changements minimums envisagés

Réutiliser sessions, sélection du monde, géométrie torique et rendu de carte existants. Prévoir des contrats bornés pour :

- l'identité de la carte RC1 et son état de référence, incluant la convention d'eau ;
- les villages visibles, leur nom de joueur, population et date de lecture ;
- le diagnostic d'un centre : coordonnées normalisées, admissibilité, motifs, arêtes incompatibles, version des règles et identité/révision des données utilisées ;
- la série de luminosité locale sur le cycle canonique de 24 h, sa référence temporelle, son échelle commune et l'état « En attente d'instrumentation » des quatre autres rubriques ;
- la confirmation serveur du choix, sans promesse de réservation.

Les chemins d'API et types exacts seront fixés après vérification des contrats existants. Ne pas exposer les tables directement, ni charger un snapshot économique de chaque village au mouvement du pointeur. Borner fréquence, volume et calcul des diagnostics ; écarter toute réponse correspondant à un ancien centre ou à une ancienne carte. L'identité RC1 immuable et la révision d'un monde effectivement aménagé restent distinctes.

Prévoir une lecture authentifiée de la carte avant adhésion, avec un contrat minimal propre au parcours d'arrivée. Adapter le lobby : l'absence des anciennes clairières ne signifie pas qu'un monde RC1 est complet. Les endpoints Village continuent d'exiger leurs droits ; la preview opérateur conserve son autorisation spécifique. Un compte sans village peut consulter le parcours d'arrivée d'un monde accessible, pas utiliser les commandes de jeu comme s'il en possédait déjà un. La copie de recette doit rendre ce parcours accessible aux comptes de test sans ouvrir le candidat source.

Garder la scène et la géographie stables pendant le survol ; mettre à jour un overlay séparé. Séparer les calculs géographiques immuables du voisinage et des occupations dynamiques, limiter le picking au terrain et aux villages, borner les requêtes et annuler ou ignorer les travaux périmés. Le résultat serveur et le diagnostic client partagent la version des règles, l'ancre, l'orientation et les révisions pertinentes. Mesurer latence et fluidité sur RC1 ; ne pas annoncer un gain à partir du seul choix de cache ou de worker.

Première réalisation et recette sur copie isolée de test, avec le monde source conservé fermé. Pas d'écriture dans la base de développement, d'ouverture publique ou de migration appliquée au développement au titre de cette spec.

## 7. Parcours suivant : starter-kit et terrassement

Cette section conserve la cible décidée, sans l'inclure dans la première tranche.

Après confirmation du choix sur la carte, ouvrir la **vue village existante**, en LOD village et HUD **Construire**, sans village persistant à ce stade. Réutiliser sa scène, ses gestes, ses aperçus et sa plomberie de collision ; ne pas créer un écran Babylon de pose indépendant. Avant HDV, seuls **Village initial** et **Hôtel de ville** sont disponibles dans Construire. **Exploitation** et **Population** deviennent accessibles uniquement après la pose effective de l’hôtel de ville, groupée ou manuelle. Les éléments restants du kit sont ensuite proposés dans Construire. Présenter le modèle de départ figé en transparence, comme un ensemble déplaçable et orientable : clic gauche pose l'ensemble, R tourne de 90° par pression sans répétition automatique, clic droit ou Échap passe à la pose individuelle. En manuel, le centre-ville est le premier élément à poser. Sa pose crée le village et engage l'installation ; la pose groupée crée le village et l'ensemble dans une même transaction. Avant cette pose, le joueur peut revenir librement à la carte. Le placement de chaque élément reste soumis aux règles serveur.

La pose réussie de l'hôtel de ville crée le village et active son économie dans la même transaction, avec une borne serveur lue après acquisition des verrous requis. Conserver les stocks et la population initiale validés dans la spec d'onboarding : 15 habitants, 2 000 bois brut, 50 carottes et zéro autre ressource ; coffre non ouvert de l'hôtel de ville avec 2 000 carottes. Ne pas les recalculer depuis le compte de conception.

Seuls les bâtiments effectivement posés fonctionnent selon les règles existantes. Les maisons ou jardins encore dans le kit ne fournissent ni capacité ni production ; leur fonctionnement commence à leur pose, sans activité rétroactive depuis la création du village. Le Jardin conserve sa dotation initiale validée au tiers de la capacité de chaque parcelle lors de sa pose. Le démarrage de l'économie n'attend pas l'achèvement du kit ; aucune suspension spéciale n'est ajoutée pendant la pose manuelle.

Le kit restant à poser est conservé côté serveur après création du village, notamment après déconnexion, jusqu'à la pose de ses éléments. Aucun abandon, retry ou rechargement ne doit dupliquer le kit, réinitialiser les stocks ou redémarrer l'économie. Avant la pose réussie de l'hôtel de ville, la préparation ne crée ni village ni économie active. Une erreur de pose annule ensemble création, activation économique, stocks, occupations et modifications locales.

Si un voisin s'installe pendant la préparation, le serveur recontrôle la distance à la position finale du centre-ville et refuse au besoin la pose. Afficher le motif et conserver le projet déplaçable ; aucun kit n'est consommé et aucune modification de terrain ne subsiste après refus.

Le terrassement gratuit reste limité à ±2 niveaux (±½ case en hauteur) autour de l'altitude de terrain du centre-ville avant terrassement, sur les seules emprises des éléments réellement posés. La référence initiale est conservée pour la pose manuelle, sans recalcul depuis un terrain déjà terrassé. Les arbres sous emprise sont retirés gratuitement, sans gain de bois ; roches et eau bloquent la pose et restent conservées. Préserver RC1 comme socle immuable, avec modifications locales persistantes et bornées. Utiliser les emprises réelles définies en section 2 ; les raccords n'élargissent pas la zone autorisée de terrassement. Pose, occupations, retrait d'arbres, terrassement et initialisation doivent être atomiques, idempotents et sûrs en concurrence. Les mises à jour du sol, halos et caches devront être visibles aux clients déjà connectés, conformément à la [spec du générateur](SPEC-WORLD-GENERATOR-ALPHA.md).

Les formations rocheuses naturelles RC1 portent chacune **2 000 pierres**, selon l’arbitrage du 10 octobre. Une formation correspond à un `stoneSite`, pas à chaque rocher décoratif de son maillage.

### Compléments de ressources au spawn effectif

La richesse naturelle n'est pas une condition d'installation. Le panneau avertit « Zone pauvre en ressources » selon le diagnostic local ; le joueur peut poursuivre. La pose effective de l'hôtel de ville déclenche une dotation spatiale limitée pour permettre de développer la cité vers les ressources naturelles :

- **Pierre proche :** deux mini-gisements de 150 pierres brutes chacun, à au moins 10 cases du bord des emprises du starter-kit, et à 20 cases maximum de trajet piéton depuis l'hôtel de ville. Total proche : 300 pierres brutes.
- **Pierre plus éloignée :** deux gros gisements exploitables de 2 000 pierres brutes chacun, à plus de 20 et jusqu'à 40 cases de trajet piéton depuis l'hôtel de ville. Total éloigné : 4 000 pierres ; total pierre de la dotation : 4 300. Le mécanisme de placement des quatre gisements est validé au spawn ; il n'est pas implicitement conditionné à l'absence de pierre naturelle.
- **Bois :** après prise en compte des arbres retirés sous les emprises posées, rechercher au moins un arbre exploitable réellement accessible à moins de 15 cases de trajet piéton depuis l'hôtel de ville. À défaut, ajouter deux bosquets de trois arbres, chacun à moins de 15 cases de trajet. Un arbre représente 500 bois bruts : stock de 1 500 par bosquet, soit 3 000 au total. Un arbre inaccessible derrière l'eau ou une falaise ne satisfait pas la condition de présence préalable.

La distance minimale pierre/kit est une séparation géométrique torique mesurée entre les bords des emprises, pas entre leurs centres. Les limites de portée depuis l'hôtel de ville utilisent la longueur du trajet praticable vers un accès d'exploitation valide, en cases, et non un rayon à vol d'oiseau ou un coût de déplacement pondéré. Coutures du tore, obstacles et accès du bâtiment doivent être pris en compte. Bornes : 10 et 20 sont inclus pour les mini-gisements ; pour les gros, trajet strictement supérieur à 20 et inférieur ou égal à 40 ; 15 est exclu pour le bois.

Ces compléments sont des ajouts locaux persistants distincts du socle RC1, jamais une régénération de la forêt ou de la géologie approuvées. Ils portent de vraies ressources exploitables ; ils ne créditent pas directement les stocks du village. Réutiliser les agrégats économiques de dépôts/bosquets, sans transformer chaque arbre décoratif en entité persistante individuelle.

Le barème de 500 bois par arbre représenté est matérialisé par le stock agrégé du bosquet de trois arbres, désormais 1 500 pour cette dotation. Il remplace la proposition de 300 bois par bosquet de spawn. Le code historique v2 initialise encore ses bosquets à 300 ; l'implémentation devra distinguer cette valeur existante de la cible. Aucun réapprovisionnement rétroactif des dépôts déjà exploités n'est défini par cette spec.

Les positions doivent être sèches, accessibles à pied et hors des emprises posées, occupations et passages à préserver. Ne pas déplacer ou supprimer une ressource d'un voisin ou une mission engagée pour faire tenir un complément.

En mode manuel, conserver l'orientation de l'ensemble au moment de passer en manuel. Translater le modèle complet figé vers la position finale de l'hôtel de ville, avec cette orientation, pour obtenir les emprises de référence de tous les éléments, même encore non posés. Mesurer les 10 cases des mini-gisements depuis le bord de ces emprises et exclure ces emprises du placement de tous les compléments. Recalculer la translation si l'hôtel de ville est déplacé avant sa pose ; ne pas remplacer la référence par la seule emprise de l'hôtel de ville.

Cette référence est une aide au placement de la dotation, pas une réservation, une occupation persistante des éléments absents ou une obligation de suivre ensuite le plan groupé. Chaque pose manuelle ultérieure valide sa véritable emprise sur l'état courant. Elle ne déplace pas les compléments déjà créés et ne déclenche aucune nouvelle dotation. Conserver l'identité/version du modèle, son orientation de référence et l'ancre finale avec l'installation pour rendre le placement reproductible.

Si tous les compléments requis ne peuvent pas être placés dans ces limites, refuser cette implantation avec un motif explicite, par exemple « Pas assez de place pour installer les ressources de départ. Déplacez votre projet. » Conserver le projet déplaçable et le kit intact. Ne pas réduire la dotation, étendre silencieusement les distances ou altérer le terrain pour la faire tenir. Distinguer ce cas de « Zone pauvre en ressources », avertissement qui n'interdit pas à lui seul l'installation.

Vérifier cette possibilité dès le diagnostic afin de ne pas présenter comme admissible une implantation déjà impossible. Refaire le contrôle sur la position finale de l'hôtel de ville, après rotation/translation du kit et sous les verrous de la transaction de pose. L'échec laisse l'état persistant inchangé, y compris si des écritures provisoires ont précédé le refus : village, kit, économie, terrain, arbres, dépôts et occupations sont annulés ensemble.

Création des compléments, village, activation économique et pose de l'hôtel de ville appartiennent à la même transaction autoritaire, avec verrous spatiaux et ordre des verrous métier préservés. Retry, reconnexion ou pose d'un élément restant du kit ne créent pas une nouvelle dotation. Un échec annule aussi les compléments et leurs occupations. Les lectures et rendus voient l'état après commit ; aucun complément n'est créé par un simple survol, diagnostic ou choix sur la carte.

## 8. Vérification et critères d'acceptation

### Tests des règles figées

- Plaine admissible ; bande ±2 aux bornes autour de l'altitude du centre-ville ; dépassement refusé. Vérifier explicitement la conversion d'un niveau en ¼ de case et l'indépendance du centre du disque.
- Longue pente aux petits écarts locaux refusée si les emprises dépassent la bande globale ; terrain extérieur aux emprises conservé.
- Arbres sous emprise retirés uniquement à la pose réussie, sans crédit de bois ; arbres extérieurs conservés. Roche ou eau sous emprise : pose refusée.
- Pose manuelle : même référence de hauteur pour tous les éléments ; aucune dérive cumulative du terrassement.
- Relief restant dans la bande ±2 : aucun refus supplémentaire fondé sur la pente ; trajet coupé par une falaise identifié séparément. Même décision serveur/client.
- Accès RC1 : pente de ¼ par case incluse, dépassement refusé ; rupture ou eau entre deux points secs détectée sur le passage. Longueurs physiques des trajets, détours et coutures, sans substitution d’un coût pondéré ou d’un rayon.
- Distance entre centres-villes : 50 refusé, plus de 50 admissible si les autres conditions passent ; coutures X, Y et coin. Un déplacement du centre-ville dans la préparation déclenche le contrôle sur sa nouvelle position. Le chevauchement des disques de diagnostic n'est pas à lui seul un refus.
- Disque traversant plusieurs chunks, relief sous-cellulaire et eau zéro : aucune fausse admissibilité due au seul centre des cellules.
- Zone pauvre : tester les quatre combinaisons de présence/absence bois et pierre ; avertissement si bois absent à trajet <15 ou pierre naturelle absente à trajet ≤40, avant dotation. Tester 15 exclu, 40 inclus, ressource épuisée et accès impossible. Choix possible si l'emprise, le voisinage et le placement de la dotation sont admissibles ; aucune assimilation du rapport pierre de preview à une preuve de pathfinding.
- Disque contenant une berge ou un rocher : projet accepté si ses emprises choisies sont compatibles, refus si elles recouvrent l'obstacle. Aucun déplacement ni rotation automatique vers un autre emplacement, aucun terrassement ou dégagement sur le reste du disque.

### API et données

- Monde fermé inaccessible au joueur ordinaire ; aucune ouverture implicite.
- Isolation par `world_id`, coordonnées canoniques et diagnostics bornés.
- Inspection et confirmation de cette tranche sans écriture de village, ressources ou relief.
- Changement de voisinage entre inspection et confirmation : refus explicite et nouveau diagnostic.
- Tranche de pose : changement de voisinage après « Choisir » et avant pose, refus sans consommation ni terrassement ; projet encore déplaçable.
- Tranche de pose : entrelacement forcé de deux créations trop proches, une seule admise ; retry après succès sans double village/kit. En manuel, reprise après déconnexion avec centre-ville déjà posé et liste exacte des éléments restants.
- Tranche de pose : aucune économie avant l'hôtel de ville ; sa pose initialise une seule fois habitants, stocks, coffre et borne économique. Installation manuelle partielle : seuls les éléments posés fonctionnent, économie active même si le kit reste incomplet. Pose tardive du Jardin : dotation initiale au tiers, aucune production rétroactive avant sa pose.
- Tranche de pose : échec injecté après activation économique et écritures attestées, puis rollback complet ; reconnexion ou retry sans réinitialisation des stocks, de l'horloge économique ou du kit.
- Tranche de pose : mini-gisements pierre à au moins 10 cases du bord du kit et à 20 cases maximum de trajet depuis l'hôtel de ville ; gros gisements à plus de 20 et jusqu'à 40 cases de trajet. Tester bornes incluses/exclues, limites dépassées, détours et coutures.
- Tranche de pose : exactement deux mini-gisements de 150 pierres et deux gros de 2 000 chacun, soit 4 300 pierres avec accès réels ; complément bois conditionnel composé de deux bosquets de trois arbres, stock initial de 1 500 chacun. Aucun crédit immédiat au village et aucun stock persistant séparé par arbre décoratif.
- Tranche de pose : arbre exploitable accessible à moins de 15 cases de trajet => pas de complément bois ; absence, arbre inaccessible, trajet de 15 cases ou plus, ou arbre retiré sous l'emprise => complément bois dans la portée stricte de 15. Tester détours et coutures, sans confusion avec une distance à vol d'oiseau.
- Tranche de pose : compléments présents avant une erreur injectée identifiée, puis rollback de leurs dépôts/occupations avec le village ; retry ou pose manuelle ultérieure sans nouvelle dotation. Source RC1 et données voisines inchangées.
- Absence de place pour un seul des compléments requis : motif de dotation distinct de la pauvreté naturelle, projet déplaçable, aucune consommation ni mutation persistante. Tester une zone déjà impossible au diagnostic et une zone devenue impossible entre inspection et pose ; aucune réduction de dotation ou extension des distances en repli.
- Kit manuel : orientation conservée au passage en manuel, modèle complet translaté à l'hôtel de ville final, marges calculées depuis toutes ses emprises, y compris aux coutures ; déplacement de l'hôtel de ville avant pose correctement pris en compte. Aucun complément sur une emprise de référence, aucune réservation de ces emprises et aucune nouvelle dotation lors de la pose des éléments restants.
- Réponse ancienne écartée ; humidité, température, vent et précipitations affichent exactement « En attente d'instrumentation », sans valeur numérique de remplacement.
- Courbe locale cohérente avec `illumination()` sur 24 h : période et échelle identiques entre lieux, invariance à l'heure du navigateur, coutures canoniques et plateau de nuit avec un seul marqueur. Soleil au premier sommet, lune au premier creux ; aucun extrême inventé sur une courbe constante.
- Les données du graphe suivent le point sélectionné ; une réponse tardive d'un autre point ne remplace pas la courbe courante. Aucun champ climatique ne peut rendre l'emplacement inadmissible.
- Source RC1 intacte avant/après recette ; identité du fichier et signature canonique éventuelle distinguées.

### Navigateur obligatoire

Parcours réel sur copie de test : carte RC1, survol des villages sans cartouche/toast, déplacement du disque, lecture des surfaces incompatibles, passages aux coutures, clic ouvrant le panneau, changement de centre, bouton désactivé puis confirmation d'un centre admissible. Examiner la courbe sur 24 h, la position des deux pictogrammes et les quatre mentions d'instrumentation en attente, y compris après changement de sélection. Examiner des captures à cadrage comparable à la preview approuvée. Vérifier picking et lisibilité du diagnostic, sans erreurs navigateur ni interactions bloquées par l'overlay.

Vérifier sélection A puis survol B (panneau et confirmation restent sur A), glisser sans sélectionner, accès clavier et tactile, refus explicite dès le survol, calcul en cours non présenté comme admissible, erreur réseau réessayable et réponse périmée ignorée. Vérifier que déplacer le curseur ne reconstruit pas la scène. La recette de la seconde tranche couvre en plus préparation, pose groupée/manuelle, démarrage économique, compléments, reprise après déconnexion et actualisation du sol pour un autre client connecté.

La tranche est livrée seulement lorsque ces critères sont vérifiés. Elle ne vaut pas validation de la pose du kit, des ressources économiques ni ouverture du monde.

## 9. Ordre d'exécution

1. Préparer la projection géographique autoritaire, les contrats et les fonctions partagées de qualification selon les règles figées ; documenter les choix numériques et vérifier les dépendances de terrain/accès/ressources naturelles.
2. Raccorder RC1 explicitement à la carte d'arrivée sur copie fermée, sans changer sa géographie.
3. Partager la qualification et brancher disque, rouge, survols, panneau et confirmation serveur.
4. Exécuter les tests et la recette navigateur de cette tranche, puis documenter la capacité et les limites observées.
5. Réaliser ensuite le starter-kit, les ressources et le terrassement transactionnel selon la section 7 ; recetter le parcours complet avant ouverture explicite. Le découpage technique n'autorise pas à présenter la seule carte comme une arrivée jouable complète.

Hors scope : régénération géographique, marées nouvelles, simulation météorologique nouvelle, terraformation joueur, transports, combat, système général de méta-bâtiments et ouverture publique.

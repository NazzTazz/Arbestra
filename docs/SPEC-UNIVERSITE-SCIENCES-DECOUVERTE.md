# Université, sciences et découverte du monde

Date : 3 octobre 2026. Cadrage initial sur 0a0873a ; base d’implémentation : main, 6360bc4. État de consolidation et publication : voir le handoff courant.

Statut : **socle scientifique implémenté, recette humaine en cours**. Autorisation d’implémenter donnée par Tristan après consolidation ; réglages de première passe validés ci-dessous. Migration 025 appliquée en test et développement. La première représentation du campus 5 × 6, conçue pas à pas, est acceptée dans l’atelier et intégrée au jeu. Son instance de recette à Aube a été retirée à la demande de Tristan : cette implantation perturbait les chemins. La réimplantation et le parcours visuel en jeu restent à valider.

## 1. Intention et périmètre

La civilisation construit progressivement une représentation intellectuelle d'un monde qui existe indépendamment d'elle. La recherche ouvre des actions, professions, informations, représentations et capacités de décision ; elle ne se réduit pas à des bonus de production.

Première tranche jouable validée : Université, Mathématiques 1–3, Géographie 1–2, formation des cartographes, relevés, exploration, Astronomie 1, carte et caméra conditionnées par la connaissance. L'Arbre des connaissances et l'adaptation de la cinématique de connexion/V font partie de ce parcours.

Extensions cadrées, sans réalisation dans cette tranche : Médecine, Météorologie, Ballistique, Topologie, espionnage et conséquences militaires/agricoles. L'intégration architecturale détaillée de l'Université à la building factory fera l'objet d'une passe visuelle dédiée ; ses principes sont fixés ici, pas ses dimensions ni ses recettes finales.

## 2. Existant vérifié lors du cadrage et frontière de cette spec

Lecture ciblée, sans exécution ni validation navigateur :

- `apps/world-web/src/scene/BabylonVillageScene.ts` contient `startFlyover()`, le raccourci V et le raccourci C vers le regard du Chat. Ils constituent des points d'entrée à soumettre aux futures autorisations de représentation ; leur existence ne prouve aucun système de connaissance.
- Les modules de cosmologie, de caméra torique et de transitions existent. La recherche ne remplace pas cette simulation.
- `apps/world-web/src/scene/building-plan.ts`, notamment `recipeFor()`, résout actuellement des recettes hôtel/maison et leurs états de travaux ; aucune recette Université n'est déduite de cette lecture.
- La [spec factory](SPEC-FACTORY-BATIMENTS.md) porte les plans modulaires et états intermédiaires ; la [spec des vues](SPEC-VUES-TERRAIN-REGION-MONDE-TORIQUE.md) et la [spec cosmologique](SPEC-COSMOLOGIE-TORE-SOLEIL-CHAT.md) restent les références des représentations existantes. Le présent document définit leur futur conditionnement scientifique.

La spécification reste fonctionnelle : pas de schéma SQL, de nouveaux services ni de moteur orbital proposés ici. Les autorisations et acquis relèvent du serveur ; React présente les connaissances, Babylon les représente. Les cohortes qualifiées suffisent ; aucun PNJ individuel persistant n'est requis.

## 3. Réalité, connaissance et représentation

| Couche | Contenu | Règle |
|---|---|---|
| Réalité | Terrain, tore, soleil, occultations, ressources, météo, villages | Existe avant sa découverte et indépendamment de l'observation du joueur. |
| Connaissance | Témoignages, relevés, rapports datés, qualifications, modèles et paliers acquis | Les connaissances communes appartiennent au joueur dans un monde ; les qualifications appartiennent aux habitants formés. |
| Représentation | Carte, informations, zoom, arbre, cinématique | Ne révèle que ce qu'autorisent les acquis ; l'ignorance ne modifie pas le monde réel. |

Les villages d'un même joueur sur un même monde partagent les connaissances. Aucun transfert automatique entre mondes ou joueurs. Les moyens humains et universitaires restent locaux.

Une observation empirique peut précéder sa compréhension. Un habitant peut rapporter un village rencontré avant Géographie 2 ; ce palier ouvre l'exploration organisée de l'inconnu, pas l'existence des autres villages.

Astronomie 1 révèle la forme générale du monde, pas toute sa géographie. Une région inconnue reste indéterminée : ni côtes exactes, ni gisements, ni implantations dévoilés par une texture décorative, un survol ou un niveau de détail.

## 4. Université et capacité de travail

L'Université est un bâtiment réel et le point d'entrée du système scientifique. Sa construction achevée rend accessibles les premiers programmes de Mathématiques et de Géographie.

Deux progressions distinctes :

- **Niveau du bâtiment** : capacité matérielle, nombre de centres et effectifs mobilisables.
- **Niveau de discipline** : palier de maîtrise scientifique acquis pour le joueur/monde.

Un centre accueille une activité et son équipe : recherche ou formation. Plusieurs centres peuvent contribuer à un programme commun ou travailler sur des disciplines différentes. Formation et recherche partagent la capacité, sans double affectation d'un même centre ou habitant.

Le joueur choisit le programme et le plafond d'effectif simultané. Le travail est réel : disponibilité, énergie, repos et relève. Une qualification préalable de chercheur n'est pas requise pour ce premier noyau. L'effectif accélère le travail dans la limite propre au programme ; il ne remplace pas les observations manquantes.

Un seul programme actif par discipline et par joueur/monde. Des disciplines différentes peuvent progresser en parallèle. Plusieurs Universités peuvent contribuer au même programme avec leurs équipes locales, dans un plafond global ; elles ne produisent pas des copies concurrentes du même acquis.

Les valeurs de capacité, coûts et durées restent à équilibrer. Ne pas assimiler automatiquement un niveau métier à un étage ou à un niveau scientifique.

## 5. Départements, programmes et preuves

Un département organise une discipline. Son niveau exprime une capacité intellectuelle concrète. Les programmes explicites permettent de franchir ces paliers ; des connaissances empiriques peuvent être acquises en dehors de ces programmes.

Un programme comporte fonctionnellement : objectif, prérequis, travail à accomplir, plafond humain, observations/essais nécessaires, acquis et capacités résultantes. Les besoins d'observation peuvent émerger pendant la recherche et doivent alors être expliqués au joueur.

### Boucle de recherche validée

1. Étudier les informations disponibles.
2. Formuler un modèle ou une prédiction.
3. Faire apparaître un besoin d'observations empiriques.
4. Recueillir les mesures adéquates et confronter le modèle.
5. Acquérir le palier quand le travail et les preuves sont réunis.

Toutes les données ne sont pas exigées avant le début. Les observations et les essais sont conservés, réutilisables et non consommés. Les données antérieures sont recevables si elles contiennent effectivement les mesures requises. Une validation prédictive exige des mesures indépendantes de celles utilisées pour établir cette prédiction ; une ancienne visite n'est pas une preuve universelle.

Lorsque toute la théorie actuellement possible a été étudiée et que des observations manquent, le programme conserve son progrès et libère centres et habitants. À réception des données, il reprend automatiquement quand des moyens sont disponibles, dans le plafond choisi. Il ne préempte aucune activité. Une pause manuelle interdit la reprise automatique jusqu'à une commande de reprise.

L'exact ordonnancement de plusieurs reprises simultanées et les frais éventuels d'un programme spontané ne sont pas implicitement fixés par cette règle ; voir section 15.

## 6. Premier noyau de disciplines

| Palier | Maîtrise | Effet fonctionnel |
|---|---|---|
| Mathématiques 1 — Quantifier | Nombres, rapports, unités communes | Comparer distances, durées et relevés. |
| Mathématiques 2 — Mesurer l'espace | Géométrie, angles, triangulation | Assembler des relevés cohérents ; prérequis de Géographie 2 et de la future Ballistique. |
| Mathématiques 3 — Modéliser les cycles | Périodicité et relations entre mesures | Construire et confronter des modèles ; prérequis d'Astronomie. |
| Géographie 1 | Relevés ciblés et accès reconnus | Formation de cartographes ; exploitation distante sur un itinéraire reconnu. |
| Géographie 2 | Carte cohérente et exploration organisée | Expéditions vers l'inconnu, cartographie éloignée et découverte d'implantations. |
| Astronomie 1 | Modèle astronomique du monde torique | Représentation globale, nouveaux itinéraires compris et cinématique adaptée. |

Les niveaux d'une discipline sont successifs. Géographie 1 n'exige pas de palier mathématique : une connaissance pratique peut précéder la géométrie formalisée. Géographie 2 exige Géographie 1, Mathématiques 2 et des relevés effectivement rapportés.

**Mathématiques 3 nécessite des observations de deux lieux distincts.** Un lieu extérieur accessible via Géographie 1 suffit ; aucune expédition de Géographie 2 n'est obligatoire. La recherche précise les mesures attendues. Elle valide les outils de modélisation, sans déjà livrer le modèle torique réservé à Astronomie 1. Les seuils de durée/contraste entre lieux restent à fixer ; deux coordonnées arbitrairement voisines ne sont pas automatiquement une campagne pertinente.

```mermaid
flowchart TD
  U[Université achevée] --> M1[Mathématiques 1]
  M1 --> M2[Mathématiques 2]
  M2 --> M3[Mathématiques 3]
  U --> G1[Géographie 1]
  G1 --> R[Relevés rapportés]
  G1 --> G2[Géographie 2]
  M2 --> G2
  R --> G2
  R --> D[Observations adaptées dans deux lieux]
  D --> M3
  M3 --> A[Astronomie 1]
  G2 --> A
  O[Témoignages solaires suffisants] --> A
  G2 -. futur .-> MET[Météorologie]
  M2 -. futur .-> B[Ballistique et essais pratiques]
  M3 -. branche ultérieure, seuil non fixé .-> T[Topologie]
  U -. futur .-> MED1[Médecine 1 : soins organisés]
  MED1 --> MED2[Médecine 2 : diagnostic et traitements]
```

Le graphe montre des conditions conjointes, pas des choix alternatifs. La Topologie n'a pas encore de seuil d'entrée fixé ; la flèche indique sa filiation mathématique.

## 7. Formation et missions des cartographes

Géographie 1 permet de former des habitants à l'Université, en mobilisant temps, centre et population. La qualification est durable. Entre missions, les cartographes peuvent exercer d'autres activités ; aucune double affectation. Géographie 2 étend les missions accessibles sans imposer de refaire la formation initiale.

### Missions

| Capacité | Destination | Résultat |
|---|---|---|
| Relevé ciblé — Géographie 1 | Lieu ou gisement déjà repéré empiriquement | Position relevée, observations demandées et accès reconnu. |
| Reconnaissance — Géographie 2 | Direction/secteur à explorer depuis le connu | Terrain, accès, ressources et implantations effectivement rencontrés. |

Les expéditions se définissent par **un objectif et un budget de temps**, pas uniquement par une surface à remplir. Les objectifs peuvent porter sur un relevé, un secteur ou la recherche d'une implantation. Le temps comprend déplacement, observation et retour ; le travail sur place et le transport restent distincts.

L'équipe réserve les moyens temporels et énergétiques de revenir. La règle opérationnelle proposée est un retour lorsque l'objectif est atteint ou qu'il faut repartir pour respecter ces moyens, avec résultats partiels si la progression est impossible. Le rappel anticipé et les interruptions doivent avoir un contrat précis avant leur implémentation ; aucun sauvetage, combat ou décès n'est inventé dans cette tranche.

Le cycle de référence est : former → affecter → partir physiquement → observer → revenir → intégrer les rapports au patrimoine commun. La représentation visuelle n'est jamais la preuve serveur d'un relevé. Le suivi en direct de l'expédition et l'instant exact de divulgation des observations doivent respecter le contrat de transmission à finaliser en section 15.

### Exploitation distante

Géographie 1 ouvre l'exploitation au-delà de la portée locale actuelle de huit cases : un gisement doit être repéré puis son accès reconnu. On ne remplace pas huit par un nouveau rayon arbitraire. Les limites opérationnelles dépendent de la route et des moyens, à préciser lors du raccordement aux chantiers.

La connaissance ne crée pas de passage à travers un obstacle, ne révèle pas le stock actuel d'un gisement éloigné et n'élargit pas le périmètre historique de construction du village. Les missions d'exploitation continuent d'appliquer leurs règles métier de disponibilité, transport, réservation et concurrence.

## 8. Carte, rapports et fraîcheur

| État | Connaissance disponible |
|---|---|
| Inconnu | Pas de rapport ; surface indéterminée. |
| Repéré | Témoignage, localisation approximative et caractéristiques réellement observées. |
| Relevé | Mesures cartographiques précises ; accès reconnu lorsque le trajet a été étudié. |

La connaissance précise ne signifie pas une surveillance permanente. Une implantation découverte est une observation datée ; ses changements ne sont pas transmis automatiquement. De futures missions d'espionnage permettront d'obtenir des informations fraîches. Une revisite peut enrichir les observations. Les champs exacts visibles sur un village étranger restent à définir, sans exposition implicite de sa population ou de ses stocks.

Les relevés de terrain et les rapports sur les entités évolutives ont des fraîcheurs distinctes. Une carte ancienne ne doit pas être effacée simplement parce qu'un village a changé, ni devenir une source de vérité économique actuelle.

## 9. Astronomie 1 : première campagne spontanée

Les habitants constatent les phénomènes solaires, en parlent aux chercheurs et suscitent une recherche d'explication. Les témoignages peuvent précéder Mathématiques 3 et Géographie 2.

Dès qu'une Université existe, les observations locales se constituent sans exiger que le joueur regarde le ciel ou reste connecté. Les contrastes rapportés pendant la session — éclairement très bref près du grand équateur, plusieurs cycles près du petit équateur — sont une motivation narrative et des indices, pas une table de valeurs à imposer à la simulation. Les données proviennent des phénomènes réellement calculés et identifient leur intervalle d'observation.

**Les observations locales peuvent suffire**, quelle que soit la région. Les expéditions peuvent compléter les preuves ; ni double lever obligatoire ni voyage obligatoire pour ce déclenchement. La durée et la définition de « témoignages suffisants » restent à calibrer explicitement.

Lorsque Mathématiques 3, Géographie 2 et les témoignages nécessaires sont réunis :

1. L'intention de recherche est signalée au joueur.
2. Le programme attend un centre libre et un habitant disponible.
3. Il démarre automatiquement avec un habitant, sans interrompre d'activité et sans clic obligatoire de lancement.
4. Le joueur peut renforcer l'effectif, le modifier ou mettre la recherche en pause.
5. La recherche suit la boucle normale de travail, modèle et validation ; le témoignage initial n'accorde pas immédiatement le palier.

Les habitants expriment une question sur leur ciel ; ils ne révèlent pas prématurément le tore. Aucune seconde campagne concurrente ne démarre dans une autre Université du joueur.

## 10. Effets d'Astronomie 1 : caméra et itinéraires

### Représentation

Avant le palier, le dézoom permet des indices de courbure et d'étrangeté mais pas une vue globale identifiant le tore entier. Le joueur peut soupçonner la vérité avant ses habitants. Après acquisition, la limitation est levée et la découverte peut se faire en manipulant librement le zoom, sans cinématique imposée.

Le changement ne recentre pas brutalement la caméra et ne modifie ni lieu, orientation locale ni phase cosmologique. La caméra reste attachée au lieu observé et suit la rotation du tore ; le soleil reste indépendant. Les transitions nuageuses, LOD et retours au même lieu doivent respecter les invariants des vues existantes.

Les mêmes règles couvrent molette, boutons, chargement initial, cinématique V et raccourcis comme C. Un éventuel contournement de développement doit être explicite et absent du parcours joueur normal. La position exacte de la limite pré-Astronomie se règlera en recette ; elle ne doit pas dépendre d'une simple dissimulation par les nuages contournable par la rotation.

### Navigation

La topologie physique ne change pas. Les itinéraires empiriquement parcourus restent utilisables avant la compréhension globale ; aucune frontière artificielle n'est créée à la couture des coordonnées.

Astronomie 1 permet de replacer les relevés dans le modèle global et de considérer plusieurs itinéraires autour du monde. Les meilleurs itinéraires **déjà reconnus et praticables** sont employés automatiquement aux prochains départs. Un passage suggéré à travers l'inconnu nécessite d'abord reconnaissance ; le pathfinding ne lit pas le terrain secret pour accorder un raccourci.

Les missions engagées conservent leur trajet et leurs échéances. Les gains portent sur le transport, pas le travail. La recherche n'impose ni ligne droite ni absence de détour.

## 11. Arbre des connaissances et cinématique

### Arbre des connaissances

Vue accessible depuis l'Université, commune aux connaissances du joueur/monde :

- un nœud par palier, groupé par discipline ;
- liens de prérequis explicites pour les nœuds révélés ;
- acquis, recherches accessibles et prochains prolongements révélés progressivement ;
- détail du programme, moyens engagés, preuves disponibles/manquantes et missions associées ;
- contributions des différentes Universités, avec affectation des moyens locaux depuis le bâtiment ouvert.

États lisibles : inaccessible, disponible, en recherche, en attente d'observations, en attente de moyens, en pause, acquis. Ne pas exposer le contenu d'un nœud lointain par infobulle, lien, monument fantôme ou texte caché. Avant Astronomie 1, une formulation telle que « Comprendre les cycles célestes » préserve la découverte ; après, le modèle et ses effets peuvent être expliqués.

### Coefficient de connaissance du monde

**Validé : coefficient propre au joueur/monde, dérivé des acquis**, et non nouvelle monnaie ou jauge à remplir séparément. Les seuils scientifiques commandent les grandes révélations ; la cartographie connue enrichit le parcours. Réglage de présentation provisoire : 80 % du coefficient vient des six paliers du socle, 20 % des relevés distincts, plafonnés à vingt. Le profil régional nécessite Géographie 1 et un coefficient de 0,15 ; sinon repli local. Astronomie 1 reste indispensable au profil global. Ces valeurs n’accordent aucune autorisation métier.

| Profil autorisé | Cinématique de connexion / V |
|---|---|
| Connaissance locale | Approche depuis les environs connus, arrivée au village. |
| Connaissance régionale | Survol des territoires cartographiés, transition nuageuse puis village. |
| Astronomie 1 acquise | Départ autour du tore, approche de la région puis arrivée au village. |

Accumuler des relevés ne permet jamais de contourner Astronomie 1 pour voir le tore entier. Après ce palier, les zones inconnues restent indéterminées pendant le survol. En l'absence d'un parcours régional suffisamment connu, utiliser le profil local autorisé plutôt que révéler du terrain réel. Ce repli est une prescription de cohérence, pas un nouveau palier.

## 12. Architecture visible et monuments

Direction validée pour la passe factory interactive : campus sur une emprise de **5 × 6 cases**, avec un bâtiment propre à chaque département, dont un bâtiment de Médecine. Chaque bâtiment sera stylisé séparément pour les trois niveaux d'Université, en commençant par les Mathématiques, puis les compositions seront assemblées. Des extensions par blocs matérialiseront les capacités supplémentaires des centres ; leur raccordement métier reste à préciser. La cour et les circulations doivent rester cohérentes avec l'entrée, l'emprise et les états de travaux existants de la factory.

Chaque transition prise en charge prévoit un état intermédiaire de travaux, conformément à la spec factory. Capacités et coûts de la première passe restent ceux de la section 15. L'atelier et la construction réservent désormais 5 × 6 cases (30 cellules). Les anciens campus peuvent être adaptés explicitement, sans frais, après revalidation de chaque nouvelle case ; aucune adaptation n'est effectuée en lecture de snapshot. La composition graphique reste provisoire et sera reprise pas à pas avec Tristan, sans tests pendant cette recette interactive.

Prévoir des emplacements pour les statues. Recette décorative validée : trois arbres dans la courette de Médecine, trois côté Géographie et un entre Médecine et Mathématiques, à gauche du grand escalier, soit sept arbres dans le campus. Ils sont présents aux trois niveaux, non exploitables et ne créent aucun gisement. Entrées, volumes construits et escalier restent dégagés ; silhouette low-poly du jeu, regroupée par matériau. Première représentation d'atelier acceptée par Tristan ; placement fin du décor encore en recette interactive.

Point de départ de la recette : **Université 1, canevas vide**, avec la grille 5 × 6 subdivisée, puis ajout de Mathématiques, Médecine et Géographie. Les trois recettes d'atelier montrent désormais ces départements, sans ancienne double-aile, cour ni monuments. La même composition est désormais utilisée en jeu. L'Université de recette d'Aube a été retirée à la demande de Tristan après agrandissement : son implantation perturbait les chemins. Le choix d'une nouvelle implantation reste ouvert.

Médecine : **emprise 2 × 3 cases, devant à gauche du campus**, validée ; deux cases en largeur, trois en profondeur. Toits plats en pierre sur le principe de Mathématiques : dalle 0,08, rebord d'une demi-pierre de large et d'une assise de haut. Niveau 1 : corps 8 × 22 sous-cases, de plain-pied. Niveau 2 : ajout de deux ailes 8 × 6 aux extrémités vers la cour (+X), formant un C ouvert sur celle-ci ; enveloppe 16 × 22. Niveau 3 : même C au sol, avec un étage supplémentaire 8 × 22 sur le corps initial. Corps aligné à gauche de la réservation, centre local X/Z = (−5 ; −3,75) ; ailes centrées à X/Z = (−2,5 ; −6,25) et (−2,5 ; −1,25). Les raccords suppriment les murs communs du rez-de-chaussée et les rebords internes, en prolongeant les pierres d'angle pour fermer les façades. Entrée centrale vers la cour et fenêtres dépolies du kit. État intermédiaire : corps conservé et ailes en travaux au niveau 2 ; ailes conservées et étage en travaux au niveau 3. Silhouette et détails d'ouvertures à recetter humainement, sans nouvelle capacité médicale ni occupation serveur.

Géographie : **3 × 1 cases à droite du campus, façade vers la cour**, validé. Toit plat comme Médecine au niveau 1 ; un chapeau central d'un bloc à toit plat au niveau 2 ; configuration en podium à toit plat au niveau 3. Première interprétation d'atelier, à recetter : corps longitudinal de 6 × 22 sous-cases, composé de trois modules contigus 6 × 8 / 6 × 6 / 6 × 8. Nombre de niveaux avant/centre/fond : 1/1/1, puis 1/2/1, puis 2/3/1. Centre local X/Z (5 ; −3,75), façade d'entrée centrale vers −X. Les murs partagés disparaissent jusqu'à la hauteur commune des volumes ; les murs des niveaux supérieurs restent fermés. Parquet continu aux raccords, rives absentes contre les parties plus hautes, fenêtres dépolies. En travaux, seuls les volumes nouveaux ou rehaussés sont partiels. Dimensions internes et choix précis des hauteurs du podium restent une recette proposée ; aucune capacité scientifique ne se déduit des étages visibles.

Premier bâtiment, Mathématiques : silhouette fine et longue validée. Convention validée : chaque case comporte **8 × 8 sous-cases**, soit 64 sous-cases. Une unité horizontale vaut 1/8 de case (0,3125 dans le rendu actuel) ; le campus mesure donc 40 × 48 sous-cases. Les longueurs de murs sont exprimées en nombres entiers de sous-cases. Le module de pierre du département vaut une sous-case en longueur et une demi-sous-case en épaisseur, joints compris ; hauteur d'assise conservée à 0,14. Aucune modification implicite des bâtiments existants.

Dimensions validées et branchées dans l'atelier :

| Niveau d'Université | Corps de Mathématiques, hors toiture | Niveaux du corps, hors pavillon central |
|---|---|---|
| 1 | 22 × 6 sous-cases, sur trois cases de longueur | Un niveau |
| 2 | 22 × 6 sous-cases, sur trois cases de longueur | Deux niveaux |
| 3 | 38 × 6 au rez-de-chaussée, sur cinq cases ; 22 × 6 aux niveaux supérieurs | Trois niveaux au total ; les deux niveaux supérieurs sont centrés |

Implantation de recette : Mathématiques est centré dans la rangée du fond du campus. Sa façade d'entrée et le chapeau sont retournés de 180° vers la cour, en conservant leur alignement. L'entrée est désormais un passage ouvert sous un préau de pierre à deux colonnes ; la porte en bois et la petite fenêtre voisine sont retirées. Le socle en pierre occupe 3 × 1 cases aux niveaux 1/2 et 5 × 1 au niveau 3. Un escalier central très large dessert le palier devant l'entrée : deux, quatre puis six marches. Réglage visuel de départ : largeur deux cases, giron une sous-case, hauteur de marche une assise (0,14). Socle, bâtiment et escalier partagent la même transformation ; les marches se développent vers la cour à l'intérieur du campus. Leur emprise décorative ne réserve pas de nouvelles cellules serveur pendant cette étape d'atelier.

Au niveau 3 achevé, six braseros bordent le grand escalier de Mathématiques : trois de chaque côté, contre la face avant du socle, au niveau du sol. Le modèle et les petites flammes désynchronisées du village sont réutilisés. Dans l'atelier sans cycle solaire, les feux sont allumés pour la recette ; aucun effet économique. Les niveaux 1/2 et l'état de travaux n'ajoutent pas ces foyers.

Le niveau 3 assemble un corps central de 22 × 6 sur trois niveaux et deux extensions de 8 × 6 de plain-pied. Les murs intérieurs aux raccords sont supprimés au rez-de-chaussée. Pierre claire, parquet et menuiseries réutilisent le kit ; ouvertures et placement définitif sur le campus restent à recetter. Les corps principal et latéraux portent désormais une toiture plate en pierre, à fleur des murs, avec un rebord périphérique d'une demi-pierre de large (une demi-sous-case, 0,15625). Hauteur du rebord : une assise (0,14), au-dessus d'une dalle de 0,08. Les pierres de rive s'assemblent sans chevauchement aux angles ; aucun rebord ne traverse les jonctions avec les corps plus hauts. Aucune nouvelle capacité métier déduite des étages visuels.

Aux raccords, les assises longitudinales autrefois arrêtées contre les retours d'angle sont prolongées jusqu'à la jonction. Supprimer un pignon intérieur ne doit pas laisser de vide dans les façades extérieures ; l'alternance des assises et les joints sont conservés. Correctif de recette appliqué au niveau 3, validation visuelle encore humaine.

Ornement commun aux trois recettes : un **niveau supplémentaire central de 10 × 6 sous-cases**, posé au sommet du corps central. Le bâtiment atteint ainsi deux, trois puis quatre niveaux au point le plus haut. Sa toiture est abaissée avec une pente de recette de 20° (au lieu de 35°), avec le faîtage perpendiculaire à l'axe long du bâtiment, et le pignon et sa ferme de charpente exposés vers la façade ; les pignons restent ouverts au-dessus des murs. Lui seul conserve toiture en bois et charpente apparente, avec un débord des pignons d'une demi-sous-case. La dalle plate inférieure est interrompue sur dix sous-cases sous ce pavillon. Ce module supérieur n'a pas de porte extérieure. En état de travaux, il repose sur la hauteur intermédiaire du corps représenté, sans flotter au-dessus. Le volume reste à recetter visuellement.

Les grands paliers scientifiques, notamment Mathématiques 3 et Astronomie 1, débloquent des monuments commémoratifs **dans toutes les Universités du joueur sur ce monde**, y compris futures. Le niveau du bâtiment exprime sa capacité ; les monuments expriment les acquis communs.

Ouvertures de Mathématiques, recette courante : le chapeau reçoit en façade une unique grande baie, large de neuf sous-cases sur les dix du mur, avec une allège d'une assise et huit assises de hauteur libre. Le rez-de-chaussée central n'a plus de petite fenêtre ni de vantail en bois ; son passage d'entrée élargi est abrité sous un préau de pierre porté par deux colonnes, dans l'axe de l'escalier ; les annexes du niveau 3 reçoivent les mêmes fenêtres hautes et fines : trois par grande façade et une sur leur extrémité extérieure, sans porte supplémentaire. Les étages de 22 subdivisions ont sept fenêtres hautes et fines régulièrement espacées par grande façade et une par extrémité : une sous-case de large, sept assises de hauteur libre. Encadrements et tablettes utilisent le kit existant. Les baies sont découpées dans les pierres, pas représentées par des rectangles opaques. Ces ouvertures restent à recetter visuellement.

Toutes les fenêtres de Mathématiques reçoivent un voile de verre dépoli légèrement bleuté, grande baie comprise. Le vitrage floute l'image réellement visible derrière la fenêtre avec un grain discret ; il ne remplace pas l'ouverture par un aplat. Une capture Babylon de 512 × 512, partagée dans l'atelier, exclut les vitrages et n'est rendue que lorsqu'ils sont présents. Les surfaces sont fusionnées par module et supprimées avec lui ; aucun vitrage sur les portes ou les ouvertures inachevées. Ce rendu est partagé par l'atelier et le campus en jeu.

Prévoir des emplacements intégrés à la composition et préservés lors des agrandissements. Le placement automatique ou personnalisable, le coût éventuel et les modèles sont ouverts. Géomètre pour Maths 3 et anneau pour Astronomie 1 sont des pistes visuelles, pas des recettes approuvées. Un monument non débloqué ne doit pas divulguer la découverte.

## 13. Extensions prévues

### Médecine — point de départ validé, révisable après usage

Le département est accessible dès l'Université, sans prérequis en Mathématiques ou Géographie. Ses premières recherches reposent sur l'observation et la pratique ; des outils de mesure pourront intervenir ultérieurement, sans dépendance supplémentaire fixée ici.

L'Université porte recherche et formation dans ses centres existants ; un bâtiment médical dédié au sein du campus matérialisera ensuite le développement du département. Sa construction n'est pas un prérequis aux premières études. Une **infirmerie distincte** accueille les patients et les soignants ; les observations issues des soins peuvent alimenter la recherche. Le bâtiment médical relève de la composition factory, sans nouvelle organisation universitaire parallèle.

| Palier | Formation débloquée | Capacité |
|---|---|---|
| Médecine 1 — Soins organisés | Infirmier·ère | Soins courants, suivi des patients et accompagnement de la récupération. |
| Médecine 2 — Diagnostic et traitements | Médecin | Diagnostic, choix du traitement et interventions complexes, avec accès également aux soins courants. |

Les formations sont **distinctes** : aucune formation infirmière préalable n'est obligatoire pour devenir médecin. Médecine 2 prolonge le palier scientifique Médecine 1, pas une carrière infirmière individuelle. Les observations des soins nourrissent cette progression ; leur contenu exact reste à définir.

Une infirmerie peut fonctionner avec des infirmier·ères seuls pour les soins courants. Les cas complexes exigent un médecin. Les médecins peuvent également assurer les soins courants ; les deux professions sont complémentaires, sans binôme obligatoire pour chaque soin.

Chaque qualification peut recevoir un **agrément militaire indépendant** :

| Profession et agrément | Affectation à l'infirmerie | Accompagnement des troupes au combat |
|---|---|---|
| Infirmier·ère civil·e | Autorisée | Interdit |
| Infirmier·ère militaire | Autorisée | Autorisé |
| Médecin civil·e | Autorisée | Interdit |
| Médecin militaire | Autorisée | Autorisé |

L'agrément ouvre une affectation, sans remplacer la qualification médicale ni réserver la personne à l'armée. Être autorisé n'implique pas un départ automatique. Les conditions d'obtention et les autres conséquences de l'agrément seront décrites plus tard.

Restent ouverts pour la tranche médicale future : coûts et durées de formation, capacités de l'infirmerie, besoins de soins et distinction concrète courant/complexe, preuves des programmes, recettes architecturales, modalités de reconversion. Aucun système de blessures, maladies, épidémies, mortalité ou combat n'est implicitement ajouté. La Médecine demeure hors de la première implémentation jusqu'à Astronomie 1.

### Autres disciplines et prolongements

- **Météorologie :** département accessible à Géographie 2. Observations empiriques locales possibles dès le début ; premier palier futur centré sur l'organisation des relevés, pas des prévisions immédiates. Mathématiques pour les modèles ultérieurs ; Astronomie/Topologie pour les circulations globales plus tard. Aucun nouveau simulateur atmosphérique ni effet agricole dans cette tranche.
- **Ballistique :** accessible après Mathématiques 2 ; essais pratiques nécessaires au premier palier futur. Applications militaires ultérieures. Le vent physique et sa connaissance restent distincts : la météorologie permettra d'anticiper et corriger le tir. Caserne/stand obligatoire, essais exacts et capacités militaires restent non arbitrés.
- **Topologie :** branche ultérieure des Mathématiques. Observer une forme étrange, construire un modèle astronomique du tore et comprendre ses propriétés topologiques sont des étapes distinctes. Aucun palier exact ni nouvel arbre lointain imposé.
- **Espionnage :** future actualisation d'informations sur des villages ; aucun système d'espionnage ou de combat créé ici.

## 14. Persistance et transitions fonctionnelles

Persistance nécessaire : acquis scientifiques du joueur/monde, observations et leur provenance/date/lieu, relevés et accès reconnus, rapports datés d'implantations, programmes/progrès/besoins de preuves/pauses, contributions locales, formations et qualifications, objectifs/équipes/parcours/rapports d'expédition. Les déblocages de monuments et les profils de présentation se déduisent des acquis ; pas de nouvelle progression indépendante implicite.

Un rechargement ou une déconnexion n'efface ni données ni travail et ne relance pas un programme spontané déjà engagé. Les échéances reposent sur le temps serveur. Le fonctionnement hors connexion ne dépend pas de Babylon ou de la fréquence des snapshots. L'application doit préserver les invariants transactionnels existants sans choisir dans cette spec une nouvelle architecture d'ordonnancement.

| Transition | Résultat attendu |
|---|---|
| Prérequis atteints | Programme accessible, ou campagne spontanée en attente de moyens. |
| Centre et habitants affectés | Travail effectif, pas de double affectation. |
| Besoin empirique découvert | Demande compréhensible, observations possibles en parallèle. |
| Travail possible épuisé, preuves manquantes | Progrès conservé, moyens libérés. |
| Preuves reçues | Reprise automatique sans préemption, sauf pause manuelle. |
| Pause manuelle | Aucun redémarrage automatique ; acquis/progrès conservés. |
| Travail et preuves complets | Palier acquis une seule fois, capacités communes actualisées. |
| Expédition revenue | Rapports conservés et intégrés selon leur contenu réel. |

Proposition de continuité à confirmer avant prise en charge de destruction/conquête : conserver les acquis malgré la perte d'une Université ; seule la capacité disponible disparaît. Aucune règle de conquête/transfert de qualifications n'est définie ici.

## 15. Réglages de première passe validés le 3 octobre

Ces barèmes sont des points de départ ajustables en recette, pas une cible d’équilibrage définitive.

| Université | Centres | Habitants simultanés, recherche et formation comprises | Bois / pierre | Durée |
|---|---:|---:|---:|---:|
| Construction niveau 1 | 1 | 5 | 500 / 300 | 10 min |
| Amélioration niveau 2 | 2 | 10 | 1 000 / 600 | 20 min |
| Amélioration niveau 3 | 3 | 15 | 2 000 / 1 200 | 40 min |

Un programme explicite par palier : Mathématiques 1/2/3 demande 10/20/40 minutes-personnes ; Géographie 1/2, 10/20 ; Astronomie 1, 30. Aucune dépense matérielle automatique de recherche. L’effectif simultané choisi est plafonné à quinze par programme partagé ; chaque Université respecte aussi sa capacité locale.

Recherche : 75 % du travail théorique peut avancer sans les preuves ; les 25 % finaux valident le modèle. Une pause laisse finir les lots engagés puis libère les moyens. La réalisation utilise des lots d’une minute, dans le maximum de dix minutes validé. Les centres libres examinent les contributions les moins récemment démarrées, sans préemption. Après traitement d’un retard, les nouveaux lots partent à la borne actuelle, sans inventer des départs passés.

Preuves : deux relevés rapportés depuis deux cases distinctes pour Mathématiques 3 et Géographie 2, réutilisables. Pour Astronomie, observations locales depuis l’achèvement de la première Université pendant vingt-quatre heures réelles, soit le cycle combiné soleil/tore ; validation après le travail de recherche. Ces observations emploient la cosmologie existante, sans modifier le soleil ou la rotation.

Cartographes : formation en dix minutes, un habitant réel et un centre. Qualification persistante lors des fragments de cohorte et des autres affectations. Relevé de soixante secondes par lieu ; trajet d’une seconde par case. Expédition avec un cartographe, objectif et budget total incluant relevé et retour. Reconnaissance partielle si le budget impose le demi-tour ; rappel possible, rapport partiel au retour, sans perte ni combat. Aucun lieu non visité n’est révélé. Une interface provisoire permet de reprendre les coordonnées du gisement sélectionné ou de saisir un objectif.

Comptes existants : aucun acquis scientifique offert. Le périmètre historique de chaque village est connu (64 × 64 dans le snapshot actuel) ; les autres cellules se découvrent par les parcours rapportés. Le bypass de présentation `?sciencePreview=1`, limité au développement, permet la recette des vues et du terrain complet sans attribuer de maîtrise ni d’autorisation d’exploitation.

Bâtiment : emprise fonctionnelle 5 × 6 cases, 30 cellules réservées et coût facturé une seule fois. Offsets autour de l'ancre : X −2..+2, Y −2..+3 ; centre graphique calculé sur l'emprise canonique. La composition Mathématiques/Médecine/Géographie, herbe et sept arbres a été acceptée dans l'atelier puis intégrée au rendu du jeu. L'ancienne double-aile est retirée. Adaptation conservatrice des anciens campus via service explicite et à leur prochaine amélioration ; aucun voisin écrasé, aucune réservation cachée dans le snapshot. L'instance de recette d'Aube a ensuite été retirée sur demande, car son implantation gênait les chemins ; placement futur à recetter. Les emplacements/monuments de Mathématiques 3 et Astronomie 1 existent comme présentation provisoire, déduite des acquis partagés.

Restent ouverts : réglage esthétique du campus et des statues, ergonomie cartographique des objectifs, valeur fine du coefficient et limite visuelle avant Astronomie. Destruction/conquête, professions médicales, météorologie, topologie, ballistique, espionnage restent hors scope.

## 16. Critères d'acceptation fonctionnels

1. Deux villages du même joueur/monde partagent un palier ; un autre joueur ou monde ne l'acquiert pas.
2. Un niveau de bâtiment accroît sa capacité sans accorder un niveau scientifique, et réciproquement.
3. Une activité ne dépasse pas les centres/effectifs autorisés et ne double pas un habitant affecté ailleurs.
4. Recherche et formation utilisent la même capacité ; plusieurs Universités contribuent sans dupliquer l'acquis.
5. Une recherche commence avec des preuves incomplètes, peut demander des mesures nouvelles et ne termine pas sans elles.
6. L'attente de données conserve le progrès et libère les moyens ; leur retour ne préempte rien et ne lève pas une pause manuelle.
7. Mathématiques 3 peut être validé avec des observations adéquates de deux lieux accessibles avant Géographie 2, sans déjà révéler le tore.
8. Géographie 2 exige Mathématiques 2, Géographie 1 et des relevés rapportés ; la formation existante reste valable.
9. Un gisement distant ne devient exploitable qu'avec la capacité scientifique et l'accès reconnu ; la constructibilité n'est pas élargie.
10. Une expédition respecte objectif, budget et retour ; un rapport partiel ne cartographie pas des lieux non visités.
11. Un village découvert reste un rapport daté, sans mise à jour omnisciente de ses données changeantes.
12. Astronomie 1 démarre spontanément une seule fois après ses conditions, avec un centre libre et un habitant disponible ; une région à régime solaire simple n'est pas bloquée.
13. Déconnexion/reconnexion préserve travail, observations et pauses ; aucune progression ne dépend des figurants ou du rendu du ciel.
14. Avant Astronomie 1, aucune entrée normale — V/C compris — ne révèle le tore entier ; des indices restent perceptibles.
15. Après Astronomie 1, le dézoom global est libre sans cinématique forcée ; les zones non relevées restent indéterminées.
16. L'acquisition ne provoque ni saut de lieu/orientation/phase lumineuse, ni modification rétroactive de mission ; les futurs départs utilisent les meilleurs accès connus.
17. L'Arbre des connaissances est progressivement révélé et ne divulgue pas le tore via ses textes, liens ou monuments verrouillés.
18. Le coefficient dérivé adapte connexion/V ; beaucoup de cartographie ne remplace jamais le seuil Astronomie 1.
19. Les monuments des grands acquis sont disponibles dans toutes les Universités, anciennes et nouvelles, du bon joueur/monde.
20. La passe architecturale respecte emprise, entrée, cour, composition par niveau et état intermédiaire de travaux, sans mêler statue et capacité de recherche.

## 17. Réalisation et suite

Le socle métier, le panneau des connaissances, les relevés/explorations et les restrictions de représentation sont branchés. Voir [l’architecture scientifique](architecture/science.md) et la tête du [handoff](../SESSION-HANDOFF.md) pour les preuves actuelles et les réserves de recette. Une spec décrit les résultats attendus ; chaque critère n’a pas encore fait l’objet d’un contrôle humain complet.

Suite : recette interactive du fonctionnement scientifique et conception du campus pas à pas avec Tristan, sans tests pendant cette passe visuelle. Aucun développement des extensions de la section 13 dans cette tranche.

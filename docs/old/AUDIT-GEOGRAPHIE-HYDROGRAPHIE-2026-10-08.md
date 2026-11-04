# Géographie indépendante et hydrographie organique

8 octobre 2026. **Phase 1 auditée ; option hybride et prototype validés par Tristan après cet audit.** Base : main, f9fc28d, avec le worktree de session non commité. Cette étude porte sur le code courant, pas seulement sur ce commit. Aucune modification applicative, dépendance installée ou donnée régénérée pendant l'audit.

La recommandation est un modèle hybride : relief échantillonnable et réseau hydrographique vectoriel déterminés avant la fabrication des chunks ; projection métier séparée ; meshes Babylon construits à partir de cette géographie. Les cellules restent la référence des actions du joueur. Leur découpage cesse de définir les berges, affleurements et triangles.

## Existant et causes du résultat actuel

Trois systèmes distincts coexistent ; les améliorations de l'un ne prouvent pas une intégration dans les autres.

| Système | Preuve dans le code | Conséquence |
| --- | --- | --- |
| Monde v2 jouable | `apps/api/src/modules/worlds/generation.ts`, `terrainAt`, bruit périodique puis classification par cellule ; chunks persistants | Le déterminisme et la périodicité existent déjà, mais le relief transmis au rendu est discrétisé par cellule. |
| Village | `apps/world-web/src/scene/terrain-unit.ts`, `buildTerrainUnit` ; `shore-profile.ts` | Dessus quadrangulaire par case, parois selon quatre voisins, eau par case. La berge irrégulière est mesurée depuis une frontière d'eau carrée. Les corrections diagonales réparent cette représentation sans en changer la nature. |
| Générateur alpha v3 r5 | `packages/contracts/src/world-landscape.ts`, `world-landscape-recipe.ts`, `world-hydrology.ts`, `world-hydrology-meanders.ts` | Plateaux rasterisés ; rivière composée de sections de cellules entières. La recherche de méandres conserve un axe principal cardinal et une progression monotone sur cet axe. La largeur varie par nombres entiers de cases. Pas de réseau général de confluences. |
| Aperçu alpha | `apps/world-web/src/world-generator/PreviewScene.tsx`, `hydrology-view.ts` | Terrain, surface d'eau et fronts de cascade suivent encore les cellules. Les animations de courant n'améliorent pas la géométrie du lit. |
| Atelier rocheux | `apps/world-web/src/scene/rock-surface.ts`, `/terrain-kit` | Surface déterministe avec microgrille perturbée et diagonales variables, affleurements de démonstration. Ce n'est pas une triangulation libre contrainte par la géographie. Aucun branchement au terrain du Village ou du World generator. |

Le dernier atelier établit une méthode de partage des positions mondiales, mais ne résout pas le modèle commun terrain/eau/métier. Perturber davantage cette microgrille ne suffirait pas.

Le Village regroupe déjà le terrain en unités de **4 × 4 cellules**, avec un mesh de sol et éventuellement un mesh d'eau par unité. Il ne crée donc pas un draw call par cellule. L'absence de gain de draw calls ne serait pas un échec de cette refonte artistique ; les coûts de géométrie et de génération devront être mesurés séparément.

La végétation exploitable dépend des `NaturalFeature` serveur : `BabylonVillageScene.ts` place plusieurs arbres autour de la cellule de la ressource, les partage en thin instances et conserve la correspondance des instances avec les UUID. Les gisements rocheux utilisent des groupes visuels associés à leur état d'exploitation ; les petits galets décoratifs sont regroupés par `scenery-batch.ts`. Les positions verticales consultent aujourd'hui la hauteur de cellule. Conserver ces identités, stocks, empreintes et mécanismes de partage ; remplacer ultérieurement l'échantillonnage du support. Un gros rocher bloquant ne peut pas apparaître comme simple décoration sur un trajet déclaré libre.

À conserver également : `WorldSpace`, normalisation torique et origine mobile, streamer et cache, admission progressive des unités de rendu, matériaux partagés, climat/exposition périodiques, contrôles d'accessibilité, worker des candidats, révisions et checksums des artefacts. Le halo actuel d'une cellule ne garantit pas la couverture d'un futur corridor fluvial : l'étendue d'influence devra être explicite.

Attention aux unités : le rendu v2 utilise `elevation * 0.025` avec une case de 2,5 unités Babylon ; l'alpha définit une unité d'altitude égale à un quart de case. Ne jamais réinterpréter silencieusement les anciennes sauvegardes. Les univers v3 restent non ouvrables (`V3_NOT_OPENABLE`).

## Babylon installé et outils disponibles

Le manifeste demande `@babylonjs/core ^8.26.0` ; le lock et l'installation examinés utilisent **8.56.2**. Les signatures locales de `math.path.d.ts`, `groundBuilder.d.ts` et `polygonMesh.d.ts` ont été confrontées à la documentation. Aucun changement de majeure ou de backend n'est nécessaire.

| Mécanisme | Usage pertinent et limite |
| --- | --- |
| `VertexData` et `Mesh` | Cible recommandée : positions, indices, normales, couleurs et attributs de courant produits depuis des données ordinaires. Un matériau commun peut porter plusieurs teintes de sol. Les normales plates peuvent nécessiter de dupliquer les sommets. |
| `MeshBuilder.CreateRibbon` | Pratique pour un tronçon d'eau à sections successives. Ne creuse pas le lit et ne résout ni les confluences ni les auto-intersections. Des buffers fusionnés évitent un mesh par segment. [Documentation](https://doc.babylonjs.com/features/featuresDeepDive/mesh/creation/param/ribbon/). |
| `GroundMesh` et heightmap | Bon outil pour un relief à grille d'échantillonnage régulière. Cette grille peut être indépendante du gameplay, mais ne contraint pas finement les berges. La requête de hauteur sur un mesh client ne doit pas devenir l'autorité serveur. [Documentation](https://doc.babylonjs.com/features/featuresDeepDive/mesh/creation/set/ground_hmap/). |
| `Curve3` | Bézier, Hermite et Catmull–Rom existent en 8.56.2. Utile pour comparer des tracés dans le prototype. Catmull–Rom peut déborder de son corridor ; sa signature ne propose pas de paramètre de centripétalité. Le graphe hydrologique et le profil vertical restent à fournir. |
| `PolygonMeshBuilder` | Accepte une injection d'Earcut pour des contours polygonaux. Ne remplace pas un solveur de réseau fluvial ou une triangulation générale avec points intérieurs et lignes imposées. |
| `NodeGeometry` | Graphe de construction géométrique intéressant pour des accessoires ou recettes rocheuses. N'apporte pas le modèle hydrologique partagé et compliquerait ici le contrat serveur. [Documentation](https://doc.babylonjs.com/features/featuresDeepDive/mesh/nodeGeometry). |
| `WaterMaterial` | Bibliothèque officielle séparée, `@babylonjs/materials`, non installée ici. Réflexion/réfraction ajoutent des rendus ; aucune simulation du réseau ou excavation. Réutiliser d'abord le shader d'eau de l'aperçu. [Documentation](https://doc.babylonjs.com/toolsAndResources/assetLibraries/materialsLibrary/waterMat/). |
| DynamicTerrain | Extension du dépôt Babylon Extensions, pas une primitive du core. Terrain dynamique suivant la caméra ; pas un générateur géographique. Remplacer notre streamer par cette stratégie serait hors de la première tranche. [Source](https://github.com/BabylonJS/Extensions/blob/master/DynamicTerrain/documentation/dynamicTerrainDocumentation.md). |

## Bibliothèques candidates

Versions, licences et publications vérifiées le 8 octobre 2026 dans les métadonnées publiques du registre npm. Une publication récente ne garantit pas l'absence de défauts ; une ancienne publication ne démontre pas l'abandon. Les performances annoncées par les auteurs ne sont pas des mesures Arbestra. Aucun poids npm décompressé n'est présenté comme un coût de bundle navigateur.

| Bibliothèque | Maintenance observée et licence | Pertinence et décision proposée |
| --- | --- | --- |
| [Delaunator](https://github.com/mapbox/delaunator) | 5.1.0, 23/03/2026, ISC ; `robust-predicates` | Triangulation 2D compacte, tableaux d'indices, intégration Node/navigateur sans dépendance à Babylon. Retenir pour les points irréguliers. Seul, ne garantit ni les berges ni les frontières de chunks. |
| [Constrainautor](https://github.com/kninnug/Constrainautor) | 4.1.0, 20/03/2026, ISC ; `robust-predicates` | Ajoute des arêtes contraintes à Delaunator. Retenir pour qualification dans le prototype. Points uniques, contraintes sans intersection ni point intermédiaire non découpé ; triangulation initiale convexe sans trous. Préparer les intersections puis filtrer les domaines après contrainte. Risque principal : robustesse sur cas dégénérés, à tester avant intégration. |
| [Earcut](https://github.com/mapbox/earcut) | 3.2.4, 28/09/2026, ISC, sans dépendance | Bon choix pour polygones avec trous, notamment eau et jonctions. La branche 3.2 propose aussi `refine` pour améliorer une triangulation en conservant les frontières ; cela n'en fait pas une API générale de triangulation d'un nuage avec contraintes arbitraires. Alternative ciblée, pas nécessairement à installer en plus du couple précédent. |
| [simplex-noise](https://github.com/jwagner/simplex-noise.js) | 4.0.3, 26/07/2024, MIT, sans dépendance | API 2D/3D/4D et PRNG injectable ; le défaut `Math.random` serait interdit ici. Le 4D permet une paramétrisation périodique des deux axes. Candidat si notre bruit périodique existant limite réellement le résultat ; inutile de le remplacer avant cette preuve. |
| [polygon-clipping](https://github.com/mfogel/polygon-clipping) | 0.15.7, 18/12/2023, MIT ; `robust-predicates`, `splaytree` | Union/intersection des corridors, découpe de lacs et confluences. Utile pour éviter de coder nous-mêmes les opérations polygonales. Qualification nécessaire sur précision, petits segments et consommation CPU ; l'ajouter si la jonction du prototype l'exige. |
| [Martini](https://github.com/mapbox/martini) | 0.2.0, 31/01/2020, ISC, sans dépendance | LOD RTIN d'un champ d'altitude sur grille de taille adaptée. Intéressant pour du relief lointain ; contraintes de berges et raccords entre résolutions à traiter. Différer : ce n'est ni l'hydrologie ni la triangulation artistique recherchée ici. |

Les dates exactes proviennent des champs `time` des registres [delaunator](https://registry.npmjs.org/delaunator), [constrainautor](https://registry.npmjs.org/@kninnug/constrainautor), [earcut](https://registry.npmjs.org/earcut), [simplex-noise](https://registry.npmjs.org/simplex-noise), [polygon-clipping](https://registry.npmjs.org/polygon-clipping) et [martini](https://registry.npmjs.org/@mapbox/martini).

[Mapgen4](https://www.redblobgames.com/maps/mapgen4/) et les [expériences de bassins](https://www.redblobgames.com/x/1723-procedural-river-growing/) de Red Blob Games donnent des références utiles pour articuler drainage et relief ; ce sont des démonstrations et explications, pas un composant Babylon prêt à intégrer. [Priority-Flood](https://arxiv.org/abs/1511.04463) fournit une base éprouvée pour traiter les dépressions ; les implémentations scientifiques examinées ne constituent pas une bibliothèque TypeScript prête à brancher au tore. Une petite couche de logique géographique Arbestra restera nécessaire. Aucun moteur complet répondant directement à toutes nos contraintes n'a été identifié dans cette sélection.

## Trois architectures possibles

| Option | Avantage | Limite et coût relatif |
| --- | --- | --- |
| Adaptateur visuel des cellules actuelles | Migration minimale, données existantes intactes ; interpolation et contours extraits peuvent améliorer les anciens mondes. | Coût faible à moyen, mais rivière déjà quantifiée et relief déjà classé : impossible de retrouver l'information perdue. Bon pont de compatibilité, cible insuffisante. |
| **Relief échantillonnable et réseau vectoriel** | Indépendance des résolutions géographique, métier et graphique ; lit réel, banques de données compactes, génération locale du détail. | Coût moyen : bassins globaux, contrats de projection et triangulation contrainte. **Recommandé.** |
| Géographie entièrement portée par un maillage irrégulier global | Topologie commune pour relief, drainage et surfaces ; contrôle fort des lignes de rupture. | Coût élevé : stockage, requêtes, index spatial, tuilage périodique, édition et migration. Risque de construire un moteur géographique complet trop tôt. |

Un modèle échantillonnable peut utiliser un raster interpolé dont la résolution n'a aucun rapport avec les cases métier. L'indépendance ne nécessite pas une formule analytique pour chaque montagne. Les lacs, cours d'eau, ruptures et affleurements deviennent des objets géographiques superposés à ce fond.

## Pipeline recommandé

1. **Préparer le monde à résolution géographique bornée.** Relief périodique, exposition et humidité ; plateaux à contours irréguliers et zones rocheuses. Calcul dans le worker du candidat avant ouverture, pas pendant un survol ou une frame.
2. **Établir bassins et exutoires globalement.** Graphe de drainage déterministe, accumulation approximative, lacs et sorties marines. Traiter les dépressions et les plats explicitement. Sur un tore il n'existe aucun bord extérieur servant automatiquement d'exutoire : un monde sans mer doit garder des bassins terminaux identifiés. Les courants marins peuvent boucler, le drainage d'une rivière ne doit pas boucler.
3. **Construire les corridors.** Extraire des axes depuis ce graphe, puis les affiner à l'intérieur de leur bassin. Une marche aléatoire seule ne garantit ni arrivée ni pente ; une spline seule ne garantit ni bassin ni absence de croisement. Comparer dans le prototype une polyligne adaptative et son ajustement par les courbes natives. Le tracé canonique finalement retenu est échantillonné en données ordinaires ; cette même ligne sert au creusement et à l'eau. Aucun lissage réservé au seul mesh bleu.
4. **Définir le profil puis creuser.** Largeur, profondeur, niveau de surface, distance aux berges et raccords varient le long de l'axe. Le fond reste sous l'eau ; niveaux non croissants vers l'aval, lacs à surface commune, chutes explicites. Carver le terrain autour du lit et des berges, avec bornes d'excavation ; rejeter une route incompatible plutôt que traverser une crête arbitrairement. La marée module les zones concernées sans inverser une cascade permanente.
5. **Raccorder les domaines d'eau.** Union des corridors et contour du lac, niveau commun aux confluences, triangles sans chevauchement de nappes transparentes. Si le corridor s'auto-intersecte, corriger ou rejeter le tracé. Une largeur de 5 à 8 cases reste une unité de mesure artistique, sans imposer des contours de cases.
6. **Projeter les propriétés métier**, avec une politique séparée et versionnée ; valider accès, emprises et ressources avant publication du candidat.
7. **Construire localement les buffers graphiques.** Points irréguliers déterministes, densification près des berges et ruptures, contraintes de frontières ; `VertexData`, couleurs par sommet et facettes. Roche et herbe utilisent le même support géographique. Les affleurements émergent progressivement avec des profils asymétriques ; surplombs et grottes restent hors scope d'un champ de hauteur. Une falaise réellement discontinue demande une ligne de rupture et des faces latérales dédiées.

Les grandes structures sont calculées et figées avant les chunks. Les détails locaux ne modifient pas a posteriori le bassin d'un voisin. Les formes fines du rivage dépendent du même objet géographique, quel que soit le chunk qui le consulte.

## Contrats et frontières de responsabilité

Contrats proposés, à spécifier avant intégration :

- `GeographyDescriptor` : `worldId`, seed, dimensions, unités, version de recette, révision et checksum ; fond géographique, roches, bassins, axes/profils fluviaux et index spatial.
- `sampleGeography(x, y)` : altitude du sol ou du fond, niveau d'eau éventuel, profondeur, courant, distance à la berge, proportions de matières et paramètres de biome. Fonction de données sans accès au mesh Babylon ; coordonnées fractionnaires acceptées.
- `queryGeography(bounds)` : structures dont l'influence intersecte une emprise, y compris au-delà de ses limites et à travers une couture torique.
- `projectCell(footprint, policyVersion)` : fraction mouillée, enveloppe des plus hautes eaux, intervalle d'altitude et planéité, accès possibles. Ne pas décider la constructibilité en échantillonnant seulement le centre. La précision d'intégration fait partie de la politique.

Les valeurs géographiques sont des faits ; les seuils autorisant construction, passage ou exploitation sont des décisions métier serveur. Les tableaux actuels peuvent rester une projection de compatibilité. Ni le changement de matériau, ni le LOD, ni l'affichage de la grille ne modifient cette projection. Le client peut exécuter les mêmes calculs pour l'aperçu ; aucune autorisation économique n'en découle.

Décision complémentaire de Tristan pendant cet audit : conserver des plateaux pour implanter les joueurs, tout en autorisant un relief adouci à créer de nouveaux passages. Cela remplace la restriction antérieure aux seuls plats et escaliers. La projection métier devra reconnaître les pentes praticables à partir du sol géographique autoritaire, avec une largeur utile et une pente maximale à arbitrer après le prototype ; le mesh ou son LOD ne décide jamais du passage. Les trajets restent secs aux plus hautes eaux. Les escaliers restent possibles avec leurs limites propres (2 cases de long, 5 de large, 1 unité de dénivelé, soit un quart de case) ; ces limites ne sont pas celles des futures pentes. Le seuil constructible d'une case partiellement mouillée reste également ouvert avant intégration. Pas de terraformation livrée dans ce prototype. Tristan a ensuite validé son principe futur : énergie dépensée, pierre produite par excavation et consommée par remblai. Voir le [suivi](PROTOTYPE-GEOGRAPHIE-2026-10-08.md).

## Continuité, déterminisme et coût

Toutes les perturbations partent de coordonnées mondiales canoniques et de sous-seeds stables, jamais de l'origine caméra ou d'un PRNG consommé dans l'ordre des chargements. Une courbe traversant le tore est déroulée dans un repère local continu avant ses opérations géométriques ; les identifiants et profils restent communs aux copies périodiques.

Deux triangulations Delaunator indépendantes avec un petit halo ne garantissent pas un raccord. Il faut des sommets de bord et intersections définis canoniquement, les mêmes altitudes, un ordre stable et des arêtes de frontière imposées. Découper les contraintes à leurs intersections et supprimer les doublons avant Constrainautor. Les sous-segments de frontière doivent coïncider sans jonctions en T. Éviter également les coutures de normales, de couleurs et d'UV de courant. Un futur LOD devra préserver ces frontières ou prévoir un raccord explicite ; une jupe qui cache une fissure n'en est pas la preuve.

La seed seule ne suffit pas à préserver un monde après changement de bibliothèque : versionner algorithmes, précision et dépendances ; conserver les artefacts autoritaires. Les fonctions trigonométriques et flottants doivent être vérifiés entre Node et navigateur sur des jeux de référence ; ne pas promettre une égalité binaire universelle sans cette preuve.

Conserver le découpage de streaming 32 × 32. Pour le prototype, viser un lot de sol et un lot d'eau par chunk et matériau, pas un mesh par triangle, pierre ou portion de rivière. L'intégration comparera cette granularité avec les unités 4 × 4 existantes pour ne pas sacrifier le culling. Les facettes augmentent potentiellement les sommets résidents sans augmenter les triangles ; mesurer les deux. Génération hors boucle de rendu, cache borné par révision, libération des buffers en sortie. Première version à une densité de maillage ; LOD seulement après mesure de son besoin.

## Prototype vertical proposé

Une scène isolée dans l'atelier existant, sans écriture de monde ni branchement au village jouable. Un domaine périodique d'essai, avec deux chunks adjacents de 32 × 32 visibles et une pose examinant la couture du tore. Un corridor sinueux de largeur variable 5 à 8 cases, deux berges creusées, une confluence simple et un raccord de lac ; un affleurement rocheux irrégulier rejoignant un terrain végétalisé. Le réseau d'essai peut être borné et prédéfini en topologie : il doit être explicitement présenté comme une fixture, pas comme la génération globale achevée.

Contrôles : seed, amplitude visuelle, largeur et irrégularité des berges ; affichages indépendants de la grille métier, des triangles, des frontières de chunks, de l'axe et du courant. La géographie exposée par le sampler doit rester identique lorsque l'on masque la grille ou change la densité graphique. Qualification initiale de Delaunator/Constrainautor ; réutilisation du bruit périodique et du shader actuels. Bibliothèque de clipping seulement pour les opérations effectivement nécessaires ; aucune nouvelle bibliothèque de bruit ou de LOD par défaut. Inclure une liaison douce entre deux plateaux pour examiner sa lisibilité et mesurer son profil ; ne pas présenter son franchissement comme une règle déjà implémentée dans le jeu.

Preuves attendues : mêmes données et frontières en ordres A/B et B/A ; coordonnées négatives et coutures sur les deux axes ; lit sous l'eau et profils orientés vers l'aval ; jonction sans double nappe ; requêtes fractionnaires et projection métier indépendantes de Babylon ; intersections dégénérées traitées explicitement. Recette navigateur sur plusieurs seeds, vue rasante et dézoom, maillage et grille séparés. Mesurer temps de génération, volume des buffers, triangles, sommets résidents, draw calls et frame médiane/p95, avec build, caméra, résolution et matériel consignés. Temps GPU seulement s'il est effectivement exposé. Aucun gain chiffré annoncé par cet audit.

Arrêter et corriger le prototype si ses berges gardent l'aspect de cases, si ses coutures sont seulement masquées ou si le lit n'influence pas le relief. La validation visuelle précède toute migration.

## Intégration ultérieure et décision

Après validation : version géographique nouvelle conservant les anciennes recettes et artefacts ; stockage des structures géographiques au niveau candidat/monde ; export local indexé vers les chunks ; projection serveur versionnée ; branchement progressif au terrain du Village, ancrages, picking, routes et ressources. Un adaptateur de lecture préserve les mondes existants. Aucune régénération des sauvegardes et aucun remplacement silencieux de la v3 r5. Le détail des nouvelles migrations et du protocole de streaming sera borné après mesure du prototype.

**Validé après cet audit : l'option hybride et ce prototype isolé.** Le principe des pentes créant des passages et le maintien de plateaux pour les joueurs sont validés. Les seuils de franchissement et règles de cellules partiellement inondées seront soumis séparément avant intégration métier. Cette phase ne vaut pas réalisation des tranches D/E du générateur alpha.

Audit fondé sur lecture du code et des sources primaires ; pas de campagne applicative ou de recette navigateur exécutée, puisqu'aucun rendu n'est modifié. Les comptes de tests des précédents handoffs restent historiques. État Git : main/f9fc28d, travail antérieur conservé, documentation de cet audit non commitée ; aucun commit ou push.

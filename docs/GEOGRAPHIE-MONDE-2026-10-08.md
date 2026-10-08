## Géologie r9 — substrat et formations intégrées (8 octobre)

Nouvelle recette de génération, sans réécriture des artefacts r8. Pour la voir : recharger `/world-generator`, **générer un nouvel aperçu r9**, puis « Voir un site de pierre ». Les univers jouables restent sur leur génération actuelle et les candidats v3 restent fermés.

### Modèle

`world-geology.ts` définit une stratigraphie de base échantillonnable sans Babylon. Une analyse périodique à pas 2 mesure pente, convexité et rupture de pente avec la métrique locale du tore ; une province bruitée module la couverture de sol. Le sol s'amincit sur les versants raides et les épaules convexes, tandis que les intérieurs plats restent couverts. Ce sont des heuristiques géomorphologiques stylisées, pas une simulation d'érosion ou de tectonique.

- **Substrat** : altitude du toit rocheux sous la couverture de sol, présente partout, y compris hors des sites de pierre.
- **Affleurements** : exposition continue du substrat. Fractures et strates érodées modifient directement l'altitude du terrain unique ; aucune coque superposée, socle ou mesh d'affleurement séparé. Incisions bornées à 0,38 largeur de case et 65% de la garde à l'eau ; niveaux fluviaux/lacustres et caractère sec/inondé préservés.
- **Blocs détachés** : sources sélectionnées dans des formations sèches exposées, puis transport descendant borné. Deux propositions de blocs principaux par source, tailles 0,65–1,30 largeur de case avant proportions.
- **Éboulis** : sept propositions plus petites (0,18–0,60), dispersion en éventail, arrêt au pied d'une pente ou avant l'eau/remontée ; refus des superpositions trop proches. Les propositions peuvent être refusées. Source, altitude d'origine et catégorie sont persistées pour chaque débris. Les formations existent même sans débris.

Le profil partagé de l'atelier est conservé pour ces seuls débris, fusionnés dans un lot. La forêt est exclue sur roche fortement exposée et autour des débris effectifs, sans clairière circulaire imposée autour de chaque source. Le bouton d'inspection ordonne les formations par pente/convexité pour montrer les plus lisibles d'abord.

### Rendu et contrats

`sampleWorldGeography` est la référence de l'altitude finale, utilisée avant la projection des cellules et le placement forestier. `sampleWorldGeology` expose pente, convexité, épaisseur de sol, altitude du substrat, exposition et direction descendante. `geologyMaterialAt` distingue air/sol/substrat dans ce modèle de base, sans crédit de pierre. La future excavation devra intersecter ce substrat **immuable** avec une surface d'édition ; recalculer le toit du substrat à partir du terrain déjà excavé le ferait descendre artificiellement. Remblai, volumes, rendements et droits restent à implémenter côté serveur.

Le maillage Babylon existant, `VertexData`, couleurs par sommet et normales de facettes sont réutilisés ; aucune dépendance ajoutée. Pas spatial de rendu r9 : 1 case sur le tore, 0,5 en local (r8 reste 2/1). Une seule surface sol/roche, un lot de débris, les deux lots d'arbres et l'eau. La densité géométrique augmente, sans un draw call par cellule ou formation. Le terrain reçoit/projette les ombres existantes. Picking sur le terrain unique ; débris non pickables.

Cache d'analyse paresseux limité aux nœuds du descripteur, attaché par WeakMap ; aucune dépendance à l'ordre des chunks, pas d'allocation géologique par frame. Les règles, occupation, stocks, sauvegardes et coordonnées canoniques des mondes existants sont préservés. Le relief r8 ±16 et ses plateaux constituent toujours le socle ; la roche n'est plus un assortiment d'amas ajoutés à cette surface.

### Vérification de cette passe

22 tests distincts ciblés passés : géologie (3), relief (2), anciens sites pierre (1), géographie (4), forêt (5), maillage (2), ancrage/anciens affleurements (4), publication API (1 ; cinq autres cas hors filtre). Déterminisme après sérialisation et changement d'ordre, limites et équivalences périodiques, profil sol/substrat, préférence pour pentes/crêtes, débris secs descendants, ordre de génération indépendant et compatibilité r8 couverts. Le test de publication a d'abord détecté le dispatch serveur refusant r9 ; entrée corrigée et test repassé vert sur `127.0.0.1/arbestra_test`, avec nettoyage de ses fixtures. Aucun reset ni écriture en base de développement.

Builds contracts/world-web et lint ciblé passés. Premier passage navigateur interrompu au changement de seed pendant les reconstructions ; ne constitue pas une recette verte. Recette finale, captures et mesures : voir le handoff courant.

Limites : formations heuristiques, pas de bilan de masse érodée ni simulation sédimentaire. Pas de surplomb/caverne (surface 2,5D), stocks et terraformation non implémentés, grandes tailles non qualifiées. Les débris restent visuels ; leur provenance prépare une future intégration, sans certifier le rendement d'excavation. Calibration d'eau historique et qualification des accès/spawn restent ouvertes.

---

# Géographie globale et tore 3D — 8 octobre 2026

## Correction visuelle r8 : retour aux affleurements triangulés

Les amas d'icosphères ont été remplacés par le **profil saillant de l'atelier rocheux** : sommets inclinés, contours perturbés, épaules progressives et union des reliefs qui se recouvrent. `rockOutcropElevation` extrait le profil de `rockPreviewElevation` ; `createRockSurface` fournit les mêmes triangles irréguliers et teintes de facettes. L'atelier conserve son profil et sa résolution par défaut.

`world-outcrops.ts` adapte ce champ aux positions et dimensions des pierres déjà persistées dans r8. Les données, leurs checksums, les sites, le relief ±16, l'eau et la forêt restent inchangés. **Recharger un aperçu r8 existant suffit** : aucune régénération ni migration nécessaire.

Les pieds suivent par interpolation barycentrique les triangles réellement rendus du sol ; une bordure enterrée ferme le raccord visuel. Les faces entièrement enterrées sont omises. Les sommets sont identifiés en coordonnées mondiales périodiques, indépendamment du cadrage ; les champs des affleurements voisins sont fusionnés par maximum. Une seule géométrie regroupée par scène, sans mesh par pierre. Résolution4 par case en inspection locale, 1 sur le tore pour borner le coût. Aucun calcul par frame ; une reconstruction accompagne les changements de représentation comme le terrain existant.

Preuves de cette correction : 14 tests pertinents passés au cours de deux exécutions (raccords terrain2, atelier roche5, kit3, affleurements4). Ils couvrent les vrais plans triangulaires, une couture contenant effectivement un relief rocheux, le déterminisme, le retour de zone, les ressources du kit et la non-mutation des données. Build world-web et lint ciblé passés. Navigateur : mêmes artefacts seed42/7, tore/local, lumière diurne et ombres, couture, cycles et retour, zéro erreur ; captures `test-results/relief-r8-*`, script `tests/browser/world-relief.mjs --reuse`. Fichiers temporaires supprimés, session de recette fermée.

Coût observé (dev, Intel Iris Plus / ANGLE D3D11 / WebGL2, canvas1100×640) : toujours5draws normaux, seed42 tore222993indices actifs et84645sommets résidents, contre68952 précédemment. Sur le site inspecté :137280indices et59456sommets,17draws avec ombres. Le nouveau mesh consomme davantage de géométrie résidente ; aucun gain FPS revendiqué. Les compteurs reviennent au niveau initial après les cycles. Temps GPU absent, échantillons CPU perturbés par build/tests concurrents. Rendu des stocks exploitables et gameplay restent hors de cette correction.

## Relief et pierre r8 — convention corrigée

Décision de Tristan : la valeur de relief représente une borne positive **et** une borne négative. La nouvelle recette utilise par défaut **−16 à +16 unités**, soit −4 à +4 largeurs de case par rapport à la mer 0. Le curseur propose ±8 à ±16 ; 16 ne désigne plus un écart total de 16. L'écart total attendu est 32. La valeur JSON `amplitude` conserve son ancien sens pour les recettes r0–r7 et porte cette nouvelle convention à partir de r8 ; les anciens artefacts ne sont pas réécrits.

Les deux côtés du relief sont normalisés séparément. Des exposants ajustent la distribution des altitudes pour approcher la moyenne demandée, en conservant les bornes ; les épaules et intérieurs de plateaux restent présents. Les bassins et forêts sont recalculés à partir de ce relief. Le modèle garde une moyenne mesurée et ses avertissements : il ne certifie pas encore les accès ou l'implantation de villages. Les amplifications visuelles incompatibles avec le rayon du petit tore sont désactivées ; 1× reste la vraie échelle.

Les `stoneSites` persistés dans l'artefact sont des **sites géologiques de prévisualisation**, sans stock économique attribué. Distribution déterministe favorisant les surfaces rocheuses, avec des sites de basse altitude aussi ; exclusion de l'eau et des pentes excessives. Chaque amas contient plusieurs volumes facettés aux tailles et orientations variées, partiellement enterrés ; dégagement de la forêt autour des amas. Le rendu actuel utilise la surface triangulée fusionnée décrite ci-dessus ; les premières icosphères ont été remplacées. Orientation suivant la normale du tore, même ancrage en local, ombres lorsque l'éclairage solaire est activé.

Accès : générer un nouvel aperçu **r8** dans `/world-generator`, puis **Voir un site de pierre**. Les métriques distinguent bornes demandées, min/max mesurés et écart total. Légende d'altitude étendue à −16/+16. L'intégration aux dépôts exploitables et leurs quantités restent une tranche métier séparée ; aucun crédit ou changement d'occupation ajouté.

Vérifications : régression initialement rouge (sommet à +6,85 au lieu de +16 avec amplitude16, seed42 128×64), puis corrigée. Quinze tests contrats/géométrie/forêt/ancrage passent, dont bornes ±8/±16/fractionnaires/nulles, compatibilité r7, sites secs déterministes, absence de stocks et raccords périodiques. Lint ciblé passé. Derniers builds, publication API et recette navigateur : statut dans le handoff courant.

Mesures de génération seed42/seed7 à 256×128 : min−16/max+16 pour les deux ; respectivement 53 sites/313 rochers et 38 sites/226 rochers, 1 922 et 1 018 arbres. Environ 9–13 s sous charge pour ces exécutions. La cible d'eau à 25% donne encore 31,22% et 28,05% : **calibration imparfaite, avertissement conservé**, aucun taux exact revendiqué. Le relief plus fort modifie donc la répartition des bassins et des forêts.

## Forêts r7 — adoptées et implémentées le 8 octobre

Les nouveaux candidats utilisent **r7**. Les artefacts r6 restent inchangés et régénérables avec leur ancienne recette. Dans `/world-generator`, générer un nouvel aperçu pour obtenir les massifs ; sélectionner un ancien candidat ne le transforme pas.

`world-forest.ts` sépare un habitat forestier continu (bruit périodique existant à deux échelles, humidité, exposition moyenne) des positions décoratives. Le seuil calibre la surface d'habitat selon l'aire du tore. Des noyaux dispersent des graines pendant sept cohortes bornées ; pente, eau, concurrence spatiale et ombre des arbres précédents limitent les implantations. Les lisières se raréfient progressivement. La métrique locale et les propositions sont corrigées du rayon du tore, y compris à ses coutures. Ce modèle géométrique simplifié ne prétend pas simuler un écosystème complet.

Les arbres possèdent des coordonnées continues, hauteur d'ancrage, taille, largeur de houppier et nuance persistées. Aucun calcul biologique par frame, aucune dépendance supplémentaire. Deux lots Babylon natifs de thin instances restent partagés. Même population dans le tore et les fenêtres locales, y compris quand une fenêtre traverse la couture. La couverture d'habitat et le nombre d'arbres sont affichés séparément : le pourcentage ne mesure pas la projection réelle des houppiers. La projection `woodland` n'accorde aucune ressource ni autorisation de déplacement ; le monde reste fermé.

**Recette actuelle :** 10 tests forêt/géographie/ancrage passés après finitions. La suite API de six cas a passé sur r7, puis le cas de publication a repassé avec assertion du descripteur forestier final. Build contrats et world-web, lint ciblé. Recette navigateur via `node --import tsx tests/browser/world-forest.mjs` avec world-web en développement sur 5174 : composant `PreviewScene` réel, artefacts purs, aucune écriture DB. Deux seeds, bosquet local, couture, trois cycles couche/navigation/rotation, retour et compteurs de ressources ; aucune erreur navigateur. Les entrées HTML/TSX temporaires sont supprimées par le script. Captures et rapport dans `test-results/forest-r7-*` (hors Git).

256×128, couverture 30% : seed42 **4 088 arbres**, descripteur forêt 613 071 octets JSON ; seed7 **3 096 arbres**, 474 673 octets. Deux lots ajoutent environ 0,56 Mio de buffers matrice/couleur pour seed42, hors overhead moteur et copie GPU. Ce sont des tailles de données, pas une mesure VRAM.

Navigateur : WebGL2, ANGLE Intel Iris Plus / D3D11, canvas1100×640, dev. Vue globale seed42 : 4 draws, 363 150 indices actifs, 68 850 sommets résidents ; rendu JS médiane/p95 1,6/3,1 ms sous charge, 0,8/1,5 ms au retour ; ressources identiques au retour. Temps GPU absent. La génération complète des deux mondes a varié de 6–8 s à 26–31 s avec les builds/tests concurrents ; ce n'est pas un benchmark isolé ni un gain de génération revendiqué. Aucune borne de timeout augmentée. Les grandes tailles restent à qualifier.

Limites visuelles conservées : essences encore représentées par les cônes low-poly existants, relief/eau r6 inchangés. La recette présente ne force pas de perte/restauration WebGL ; elle ne clôt pas l'incident historique de restauration de contexte. L'intégration au monde jouable, l'exploitation et le spawn restent séparés.

## Livraison et accès (socle r6)

Recette **v3 r6** dans `/world-generator` : créer un candidat, parcourir le tore, inspecter localement et conserver le monde avant tout spawn. Les candidats restent fermés. Le prototype `/geography-preview` reste distinct. Les anciennes recettes r0–r5 gardent leurs générateurs et lecteurs ; aucune migration ou réécriture des mondes existants.

Le relief et les surfaces d’eau déplacent réellement les sommets suivant la normale du tore. **1× représente les hauteurs physiques**, avec une unité de hauteur égale à un quart de largeur de case (référence : petit cercle du tore). 2×/4× amplifient le relief pour l’inspection. Les arbres occupent les mêmes positions géographiques dans les deux vues ; leur axe suit la normale locale. Deux lots de thin instances partagent leurs géométries, simplifiées dans la vue globale.

## Modèle et génération

`packages/contracts/src/world-geography.ts` contient le descripteur JSON versionné, le générateur et `sampleWorldGeography(x,y)`, sans Babylon ni dépendance au chargement des cellules.

1. Bruit périodique existant, déformation du domaine, plateaux à intérieurs plats et épaules adoucies. Répartition des hauteurs positives/négatives ajustée à l’amplitude et à la moyenne demandées.
2. Analyse globale à pas 4, indépendante de l’occupation : remplissage des dépressions par file de priorité, parents acycliques, accumulation des bassins, lacs et tronçons fluviaux. Exutoires marins ou endoréiques en absence de mer ; aucune frontière de chunk ne sert d’exutoire.
3. Axes déroulés aux coutures, deux passes de lissage de coins, profils descendants, confluences partagées. Largeurs 5–8 cases. Le lit est excavé par la requête géographique ; index spatial des segments en cache faible par descripteur.
4. Quatre essais maximum de calibration de l’eau totale. Aire pondérée par le rayon local du tore, puis mesure aux centres des cellules. Les écarts restent affichés : les cibles ne sont pas garanties exactement.
5. Quota de forêt pondéré par l’aire, répartition influencée par l’exposition solaire. Le rendu exclut un arbre dont le point précis tombe dans l’eau.

Le descripteur, les métriques et la projection entière de compatibilité sont persistés dans l’artefact avec son checksum. Les chunks DB restent entiers et **ne constituent pas la géographie**. `walkable=0`, composantes non qualifiées : aucune autorisation de déplacement ou de construction n’est déduite du rendu.

## Rendu et inspection

`world-geography-mesh.ts` utilise le même descripteur pour le tore (pas 2) et quatre chunks locaux (64 × 64, pas 1). Sommets intérieurs perturbés périodiquement, diagonales déterministes variées, couleurs de sommet et normales de facettes. Les frontières conservent leurs échantillons canoniques. L’eau est découpée dans les triangles au passage du niveau d’eau, sans quads bleus par cellule.

Ce maillage échantillonné borné ne généralise pas encore la triangulation contrainte du prototype à toute la planète. Les berges sont approchées à la résolution du maillage. Une vue plus fine pourra réutiliser le modèle sans modifier les occupations.

Contrôles : Tore / Inspection locale, picking et coordonnées, Voir une rivière / Voir un lac, terrain / altitude / eau / climat, maillage et grille/chunks séparés, atmosphère désactivée par défaut, éclairage solaire, amplification. La caméra ne regénère pas le modèle. Les scènes remplacées libèrent meshes, matériaux, instruments et effets. `world-tree-transform.ts` place et oriente les instances sur les faces extérieure, intérieure et inférieure, avec une échelle physique constante même quand le relief est amplifié.

## Limites

- Aucun spawn ou ouverture v3 ; conserver un candidat ne l’ouvre pas.
- Marées, cascades et chenaux maritimes r5 restent à réintégrer dans cette nouvelle géographie. Le curseur des chenaux est désactivé et expliqué dans l’interface.
- Réseau géométrique déterministe, pas simulation hydrodynamique. Le pas 4 et le routage à huit voisins peuvent encore influencer les formes. Méandres et extrémités arrondies restent des points de recette artistique.
- Plateaux géographiques, sans réservation ni certification de villages. Pentes, constructibilité partielle et trajets secs restent à qualifier avant intégration au jeu.
- Terraformation future : principe énergie/pierre validé, aucune commande ou économie ajoutée.
- Plafond inchangé : 131 072 cellules par défaut. Le monde 2048 × 1024 du jeu n’est pas qualifié ici.
- Coût GPU non mesuré. Les indices actifs incluent lignes et passes ; les sommets résidents ne comptent pas une copie par thin instance. Aucune estimation de VRAM à partir de ces compteurs.

## Vérification

Recette reproductible : `tests/browser/world-geography.mjs`, serveur isolé `tests/browser/world-generator-server.mjs` sur `arbestra_test`, Vite preview 5285 proxy vers 3180. Aucun reset de développement. Captures et relevés : `test-results/worldgeo-*`, exclus de Git.

Tests ciblés : déterminisme/sérialisation, continuité périodique, drainage acyclique et descendant, incision, absence d’autorisations métier, raccords de chunks et du tore, invariance des couches, normales ascendantes, ancrage/orientation des arbres. Intégration serveur : publication atomique, checksum, conservation, refus d’ouverture/join v3, reprise/timeout de worker et ancienne ouverture v2. Les suites historiques relief/hydrologie et le prototype précédent ont aussi été exécutés.

Les mesures finales et le statut de recette sont repris dans le handoff courant.

## Recherche préalable au placement forestier (proposition désormais adoptée en r7)

Tristan rejette la répartition r6, trop uniforme et encore liée aux cellules. La projection 3D des arbres est fonctionnelle ; **la distribution forestière actuelle n’est pas validée artistiquement**.

Recommandation : colonisation bornée par dispersion de graines et compétition, guidée par une carte périodique de favorabilité. Quelques noyaux colonisent leur voisinage ; les contraintes de place et d’ombre éliminent les conflits ; âges et tailles variés produisent des peuplements et lisières. Le calcul aurait lieu une fois à la génération, sans simulation biologique permanente ni nouvelle règle économique.

Bases vérifiées : [EcoSys, Deussen et al.](https://graphics.stanford.edu/papers/ecosys/) modélise les interactions végétation/environnement ; [Unreal Procedural Foliage](https://dev.epicgames.com/documentation/en-us/unreal-engine/open-world-tools-property-reference-in-unreal-engine) expose dispersion, âge, collision et tolérance à l’ombre. Ce sont des références algorithmiques, pas des dépendances Babylon à importer.

[Poisson disk, Bridson](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf) convient à l’espacement initial ; seul, il ne définit pas la forme des forêts. Alternative alpha plus simple : carte de massifs + Poisson à densité variable. La bibliothèque JS [poisson-disk-sampling](https://github.com/kchapelier/poisson-disk-sampling) fournit densité variable et RNG injectable, licence MIT ; son historique affiche 2.3.1 en juin 2022. Compatibilité torique et performances restent à qualifier avant adoption. Aucune dépendance ajoutée.

Points spécifiques Arbestra : positions continues indépendantes des cellules ; éclairement moyen, humidité et relief ; clairières et lisières irrégulières ; distances et densités tenant compte de l’aire réelle du tore, pour éviter de surcharger sa face intérieure. Le taux de terrain boisé et la densité à l’intérieur d’un massif doivent être distingués. La future projection des ressources reste un contrat séparé.

### Recette visuelle finale r9

`node --import tsx tests/browser/world-relief.mjs --geology` terminé avec succès sur les deux seeds, après la première interruption. Captures inspectées : formations locales, soleil/ombres, tore seed7 et couture ; grille et wireframe exercés séparément, trois cycles couche/navigation/rotation et retour. Zéro erreur navigateur. Entrées temporaires supprimées et session de recette fermée. Artefacts `test-results/geology-r9-*` hors Git. Ce sont des fixtures pures, sans création de candidat en base.

Seed42/7, 256×128 : 7/17 points d'inspection de formations (l'exposition du substrat existe aussi ailleurs), 9/23 blocs et 31/45 débris d'éboulis, 2 347/1 246 arbres. Génération complète : 11,46/8,70 s. Les fractures enlèvent localement de la matière : extrema échantillonnés −16/+15,81 et −16/+15,62 pour les bornes ±16. Cible eau encore imparfaite à 31,22%/28,05% pour 25% demandé ; avertissements conservés.

Dev, WebGL2, Intel Iris Plus / ANGLE D3D11, canvas1100×640. Tore seed42 : 5 draws, 433 719 indices actifs (passes incluses), 264 771 sommets résidents ; retour aux mêmes ressources après navigation. Rendu CPU médiane/p95 0,3/0,5 ms puis 0,8/1,7 ms au retour. Local roche : 111 320 sommets, 5 draws ; soleil/ombres 17 draws et CPU4,8/10,8 ms. Temps GPU absent. La géométrie résidente augmente par rapport aux 84 645 sommets de r8 ; cette tranche améliore la géologie, elle ne revendique pas un gain de performances.

## Inspection fiable et carte rectangulaire — 8 octobre

Tranche autorisée après l'audit navigateur : fiabiliser l'identité du résultat, clarifier ses indicateurs et ajouter une carte complète non projetée sur le tore. Aucun changement de recette, de génération, de géologie, de stocks ou de sauvegarde ; les candidats du corpus utilisateur sont conservés.

Le bouton **Carte complète**, à côté de Tore et Inspection locale, déploie tout le domaine `[0, largeur] × [0, hauteur]` dans un plan. Caméra orthographique de dessus, relief conservé selon la même convention ¼ case et amplification choisie, mêmes meshes/données et couches altitude/eau/exposition/humidité. Les arbres sont verticaux dans ce repère, sans courbure torique ni rotation du monde ; éclairage neutre et atmosphère désactivée pour cette vue. La grille y montre les frontières de chunks. Cliquer sur la carte ouvre l'inspection locale aux coordonnées choisies. Les bords opposés restent périodiques dans les données : le rectangle est une représentation paramétrique, dont les aires ne sont pas celles du tore.

L'artefact chargé est associé à l'ID, la révision et l'empreinte du candidat. Une sélection différente masque immédiatement l'ancien artefact ; les réponses annulées/tardives sont ignorées. Les paramètres enregistrés du candidat restent affichés séparément du formulaire de création. **Reprendre ces paramètres** copie ses valeurs, sans modifier le candidat ; créer ensuite utilise la recette courante. L'aide ±A est dynamique. L'habitat forestier sans terre mesurée affiche « Non applicable », même pour un ancien artefact dont l'indicateur historique est trompeur ; l'artefact et son checksum ne sont pas réécrits. La canopée est explicitement indiquée comme non mesurée.

La construction Babylon est différée hors du commit React et annulée si la demande devient obsolète. Le canvas précédent est masqué dès que l'identité demandée change. L'état building/ready/error et la clé du rendu sont exposés sur `.generator-render`, et la phase réellement rendue sur le canvas. Le statut « affiché » n'est publié qu'après une frame du bon rendu. Les statistiques portent la même clé et sont masquées en cas de divergence. Les exceptions de construction/frame deviennent un état d'erreur explicite ; une autre sélection de couche/vue permet de reconstruire.

Fichiers : `WorldGenerator.tsx`, `PreviewScene.tsx`, `preview-inspection.ts`, CSS et tests associés, recette `tests/browser/world-inspection.mjs`. Pas de nouvelle dépendance. Les tests de projection, identité et indicateur forestier complètent les régressions de raccords et d'ancrage (9 tests passés). La recette navigateur utilise le vrai panneau et Babylon en React StrictMode, avec artefacts purs et HTTP simulé, sans mutation DB ; état final et preuves dans le handoff.

Limites de cette tranche : l'erreur React « Should not already be working » signalée par l'audit n'est pas encore attribuée à une cause reproduite. Ces changements empêchent les mélanges d'identité observables et isolent la reconstruction, sans prétendre prouver la disparition de toute cause de gel. Reconstruction synchrone du mesh une fois la tâche lancée : elle peut encore occuper le thread principal. La calibration d'eau, la lisibilité solaire nocturne, les berges et la hiérarchie des facettes restent les tranches suivantes. Les avertissements du candidat continuent d'exposer les écarts eau/altitude.


## Berges et lecture des affleurements — 8 octobre, passe de rendu

**Implémenté et vérifié techniquement ; amélioration artistique partielle, défauts géographiques non clos.** Suite au « ouep on part là dessus », tranche bornée sur le rendu des candidats r9 existants. Recharger `/world-generator` suffit. Aucune nouvelle recette, aucun artefact recalculé ou modifié, aucune écriture API/DB. Les hauteurs, les lits creusés, les récifs, les blocs, les plateaux et la forêt enregistrés restent inchangés. Les échantillons ajoutés interrogent le même champ géographique. Les comportements de rendu r8 sans géologie restent conservés.

### Ce qui change

- `terrain-shore.ts` et `world-geography-mesh.ts` : raffinement uniquement des arêtes traversant le niveau d'eau. Recherche bornée de leur intersection avec le champ géographique, sens canonique d'arête, triangulation conforme partagée par les deux voisins. Un niveau, sans allocation par frame. En présence d'une discontinuité de niveau dans l'ancien champ, repli au milieu de l'arête ; le rendu n'invente pas une nouvelle hydrologie. L'échantillonneur barycentrique des blocs/éboulis utilise exactement ces triangles.
- `terrain-surface.ts` : bande humide progressive liée à la pente au lieu du seuil uniforme de 0,055 case qui colorait de larges plaines basses. Eau opaque teintée selon sa profondeur réelle pour lire le bord et le lit ; couleurs par sommet dans le matériau Babylon existant, sans texture ou passe supplémentaire.
- Affleurements : variation de gris par facette réduite de 18 à 6 points de pourcentage ; variations périodiques plus larges et assombrissement des incisions du terrain. Les silhouettes et volumes géologiques ne sont pas reconstruits dans cette passe. Un retrait complet du contraste donnait un aplat gris : essai écarté après comparaison visuelle.
- `PreviewScene.tsx` : branchement des couleurs d'eau. Aucun nouveau mesh ou matériau. `tests/browser/world-banks.mjs` : poses fixes, captures avant/après, retour après cycles de navigation avec égalité des ressources.

### Vérification et mesures

**11 tests distincts passés** : raffinement partagé/aire/orientation2, matériaux et profondeur3, maillage/raccords/ancrage r9/couches2, ancrage et conservation r8/outcrops4. Les deux tests maillage ont été repassés après le dernier réglage de facettes. Typecheck, build world-web et lint ciblé réussis. Avertissement Vite historique sur les gros bundles. Le premier test de précision du bord échouait à 14 itérations (écart 0,000056 case) : solveur passé à16, puis vert. Pas de test DB nécessaire ni exécuté.

Recette navigateur finale terminée avec succès, en React StrictMode, vrai composant PreviewScene/Babylon et fixture r9 seed42 256×128. Soleil/fumée désactivés, amplification1, viewport1440×1000, canvas1100×640, même build dev avant/après. Local : caméra initiale alpha−π/2, beta0,78, rayon23, cible (0, altitude locale+0,4, 0). Centres rivière(159,5;56,5), roche(103,68;1,36), lac(136;0), couture(0;64). Tore alpha−π/2, beta1,05, rayon8 ; carte orthographique par défaut. Aucun déplacement manuel de caméra entre captures. Ces poses et la fixture sont reprises dans le script.

Grille, maillage et deux cycles tore→carte→local exercés ; retour rivière aux mêmes indices/sommets/meshes/draws/matériaux/textures. Zéro exception navigateur rapportée. Captures rivière, roche, lac et tore inspectées. Une exécution de recette intermédiaire a échoué parce qu'une attente CLI renvoyait un élément DOM (erreur CDP de sérialisation) au lieu d'un booléen ; corrigée et recette complète repassée. L'interruption initiale du serveur avait laissé les captures avant sans rapport final ; référence complète reprise avant les modifications du rendu.

Backend réellement relevé : WebGL2, ANGLE / Intel Iris Plus / D3D11. Rapports `test-results/banks-before.json` et `banks-after.json`, captures `banks-{before,after}-{river,stone,lake,seam,torus,map}.png`, hors Git. Les temps ci-dessous sont le rendu CPU JS médiane/p95, pas le GPU ni la durée totale de génération. Charge machine variable ; aucune amélioration FPS revendiquée. Une capture grille a enregistré2,38FPS et un p95CPU12,9ms ; retour à60FPS ensuite, cause non attribuée.

| Pose | Draws avant → après | Sommets résidents avant → après | Indices actifs avant → après | CPU médiane/p95 ms avant → après |
|---|---:|---:|---:|---:|
| river | 2 → 2 | 153,905 → 156,149 | 153,849 → 156,093 | 0.5/1.1 → 0.3/0.6 |
| stone | 5 → 5 | 111,320 → 115,931 | 138,588 → 143,199 | 1.1/2.8 → 1.0/2.4 |
| lake | 5 → 5 | 125,915 → 133,646 | 188,559 → 196,290 | 0.9/1.5 → 0.7/1.3 |
| torus | 5 → 5 | 264,771 → 291,450 | 433,719 → 460,398 | 0.9/2.2 → 1.8/3.3 |
| map | 5 → 5 | 264,771 → 291,450 | 433,719 → 460,398 | 1.8/3.7 → 1.6/3.5 |

Les indices actifs Babylon incluent les instances/passes ; ils ne représentent pas un compte de sommets uniques. Mesure pure des seuls buffers terrain+eau : tore88 080→96 973 triangles. Charge théorique positions/normales/couleurs Float32 + indices Uint32 :10 544 448→12 800 436 octets (+2,15MiB), hors objets JS, caches temporaires et coûts du pilote. Ce n'est pas une mesure VRAM. Les caches de tessellation sont locaux à une reconstruction et ne créent pas un cache persistant de variantes. La comparaison pure a aussi vérifié que la fixture JSON restait identique après construction. Mesures dans `test-results/bank-buffers.json`.

### Limites et prochaine décision technique

Cette passe améliore la transition des matériaux, le bord échantillonné et la lisibilité du lit. **Elle ne clôt ni la crédibilité des berges ni la structure géologique des grandes masses.** Des décrochements demeurent, notamment autour des surfaces hydrologiques activées par seuil dans `sampleWorldTopography` (lac interpolé et rayon d'influence des tronçons). Ces discontinuités existent dans le modèle ; subdiviser davantage ne les résout pas. Une prochaine recette doit rendre les domaines/niveaux d'eau continus et donner aux affleurements des formes dominantes plus marquées, en conservant les récifs appréciés. Les captures proches restent plus plates que la référence artistique ; ne pas présenter la réduction du bruit de couleur comme une nouvelle géologie.

Calibration eau/altitude, connectivité hydrologique complète, lisibilité nocturne, autre seed visuelle, grande taille, profil GPU et terraformation restent non qualifiés par cette passe. Le corpus utilisateur est intact, aucun univers ouvert. Git main/f9fc28d, modifications antérieures conservées, aucun commit/push.

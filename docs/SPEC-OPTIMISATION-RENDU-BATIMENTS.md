# Optimisation du rendu des bâtiments

Date : 6 octobre 2026, mise à jour le 7 octobre. Statut : **optimisations ciblées et LOD du campus implémentés/vérifiés ; budgets et fluidité globale non atteints**.

Source : [audit mesuré](AUDIT-RENDU-3D-2026-10-06.md). Demande de Tristan : simplifier le verre dépoli en acceptant une perte de qualité de reflets, spécifier la réduction des sommets et le regroupement des meshes.

## Décisions et périmètre

**Validé par la demande** : perte de qualité des reflets du dépoli autorisée ; simplification géométrique et regroupement autorisés par « commit push puis fais les optimisations ». L'introduction automatique à la connexion est retirée à la demande suivante.

**Proposé, restant** : budgets numériques ci-dessous, représentation des microdétails par texture/normales, extension des variantes aux autres familles et regroupements statiques supplémentaires. Ces cibles ne sont ni une livraison ni des gains démontrés.

**Implémenté dans cette première tranche** : verre transparent à léger voile StandardMaterial (alpha .22, correction du 7 octobre), reflet ciel/sol statique 32 × 16 partagé et modulé par les lumières, sans capture ni émission permanente ; blocs droits à 24 sommets conservant joints/ouvertures, bois chanfreiné à 48 sommets sans petit chanfrein axial ; instances natives des recettes précompilées et des ombres de contact. Les instances gardent transformations, culling et UUID individuels ; aucune fusion globale du village. Vitrine et exposition transparentes restent séparées. Modèles et miniatures régénérés. Aucun LOD nouveau ni remplacement des joints par une normal map dans cette tranche. Les budgets proposés ci-dessous restent des objectifs, pas des résultats acquis ; mesures et limites dans le [rapport](AUDIT-RENDU-3D-2026-10-06.md).

**Validé le 7 octobre** : le verre transparent à léger voile (alpha .22) est accepté. Tristan autorise ensuite des optimisations ciblées et mesurées. La tranche conserve ce rendu, la géométrie et la résolution : instances natives pour les sols, surfaces par stade et marqueurs des jardins ; regroupement des pièces statiques de chaque scierie par matériau. Chaque parcelle et bâtiment conserve son identité, sa sélection et son cycle de vie. Aucun gel global de scène/matériaux, nouveau LOD ni changement de moteur. [Mesures et preuves](AUDIT-RENDU-3D-2026-10-07.md#optimisations-ciblées-implémentées-après-le-profil).

**Nouvelle tranche autorisée le 7 octobre : LOD du campus en Village.** Deux représentations pour les niveaux 1–3, achevés/travaux ; détail existant conservé, maçonnerie distante simplifiée et pièces regroupées par matériau. Critère de bascule : diamètre projeté de la sphère du campus sous 320 pixels de rendu. Voir le choix technique ci-dessous et le [rapport de mesures](AUDIT-RENDU-3D-2026-10-07.md#lod-du-campus-dans-la-vue-village).

**Ouvert** : extension du LOD aux autres familles et objectifs globaux de fluidité ; ils ne sont pas atteints par cette seule tranche.

**Hors scope** : économie, gameplay, migrations, changement d'emprises/ouvertures, réduction de la couverture terrain, nouvelle mécanique, refonte du streamer, modification des effets du tore.

## 1. Dépoli sans capture de scène

Remplacer le chemin partagé de `frosted-glass.ts` par un matériau de verre dépoli simple : teinte légèrement bleutée, grain fixe réutilisable, spéculaire doux et éventuellement Fresnel/reflet d'environnement statique. Aucun flou du fond réellement rendu. Les reflets de bâtiments voisins et la restitution exacte du décor derrière le verre peuvent disparaître.

Exigences :

- **Zéro render target, ReflectionProbe ou passe de scène supplémentaire pour le dépoli**, en village, région, factory et miniatures. Retirer `campus-glass-background` et la gestion de sa liste globale.
- Matériau et éventuelle petite texture partagés à l'échelle d'une scène ; pas une allocation par vitre. Transparence alpha demandée le 7 octobre pour retrouver la lisibilité des ouvertures : voile léger à alpha .22. Le surcoût du mélange alpha est accepté pour ce rendu ; aucun retour aux captures de scène.
- Conserver les fenêtres et leur géométrie existante. La perte de qualité porte sur le traitement du verre, pas sur la fermeture d'une ouverture architecturale.
- Conserver les contrastes jour/nuit sans calcul de capture ; pas de vitre brillante en permanence dans un bâtiment nocturne.
- La vitrine transparente du rez-de-chaussée et la grande vitre d'exposition de l'hôtel restent des cas distincts : préserver la visibilité des six stocks exposés. Leur reflet statique existant ne nécessite pas de nouvelle capture.
- Détruire les ressources propres avec la scène ; nettoyer les anciens observateurs de capture. Invalider les miniatures concernées si l'apparence change.

Critère structurel : tous les parcours utilisant du dépoli ont zéro capture de décor imputable au verre. Sur la scène de l'audit, retrouver au plus les quelque 559 draws de la mesure sans capture avant la tranche de regroupement ; ce nombre est une référence de cadrage, pas une constante valable dans toutes les vues.

## 2. Réduction des sommets

Le dessin approuvé reste la référence : silhouette, dimensions, entrées, fenêtres, arrondi de l'hôtel, toiture, terrasses, vitrines et exposition doivent être conservés. Le détail des joints et chanfreins doit être proportionné à sa taille à l'écran.

Méthode proposée :

1. Remplacer la maçonnerie des grands murs par des surfaces continues, découpées autour des vraies ouvertures. Reporter les joints, variations de pierre et petits chanfreins dans une texture/normal map partagée lorsque leur relief n'affecte pas la silhouette.
2. Garder de la géométrie sur les contours visibles : coins, grandes courbes, appuis, jambages, arches et silhouettes de charpente. Supprimer les faces seulement lorsqu'elles sont réellement cachées ; les intérieurs visibles derrière une baie ou vitrine restent présents.
3. Préparer une variante simplifiée pour les distances où les petits reliefs deviennent sous-pixel. Choisir les seuils par taille projetée ; ajouter une hystérésis seulement si une oscillation est observée, conformément à la demande du 7 octobre. Éviter les changements visibles. Compter les variantes retenues dans la mémoire résidente.
4. Conserver des références séparées pour les parties animées. L'horloge et les flammes ne doivent pas imposer de régénérer toute la maçonnerie statique de l'hôtel.

Budgets initiaux **proposés**, à démontrer sur le même cadrage et la même population de bâtiments que l'audit :

| Mesure | Référence mesurée | Cible proposée |
| --- | ---: | ---: |
| Compte logique de sommets de la scène village | 3 371 161 | ≤ 1 350 000, réduction d'au moins 60 % |
| Maçonnerie salle haute de l'hôtel | 435 069 | ≤ 90 000, réduction d'environ 79 % |
| Maçonnerie RDC de l'hôtel | 147 855 | ≤ 45 000 |
| Maçonnerie centrale Mathématiques | 178 640 | ≤ 55 000 |
| Maçonnerie Médecine | 140 672 | ≤ 45 000 |
| Maçonnerie d'une recette de maison à 52 192 sommets | 52 192 | ≤ 16 000 |

Les objectifs par partie ne sont pas cumulables avec le total comme des allocations supplémentaires. Publier également triangles effectivement soumis, octets de géométrie uniques et instances : le compteur logique Babylon seul ne démontre pas une réduction de mémoire ou de travail GPU. Une variante conservée mais masquée ne doit pas fausser la mesure du détail effectivement rendu.

La proximité conserve le dessin architectural, mais n'exige pas une pierre géométrique complète à 224 sommets pour chaque petit module. Si un budget impose une dégradation visible hors perte de reflets déjà autorisée, signaler précisément cette dégradation avant de la considérer validée.

## 3. Regroupement et instances

Objectif : réduire les soumissions de dessin, et pas seulement le nombre de nœuds. Les modèles précompilés partagent déjà les géométries ; leurs clones ne regroupent pas automatiquement les draws.

- Fusionner les pièces **statiques d'un bâtiment** par matériau/palette et régime de rendu. Conserver séparément opaque, alpha et éléments animés ; un mesh multi-matériaux conserve plusieurs draws et ne suffit pas à atteindre le budget.
- Pour les recettes identiques, préparer des groupes d'instances partageant géométrie et matériau, bornés spatialement. Éviter un lot unique de tout le village qui empêcherait le culling et les mises à jour locales.
- Clé de groupe : recette, variante/niveau/état travaux, palette, matériau et cellule spatiale de regroupement. Les transformations portent orientation et implantation sans dupliquer la géométrie.
- Préserver une correspondance stable et testable entre mesh/instance et UUID du bâtiment. Un indice d'instance n'est pas une identité métier ; sa correspondance doit être actualisée lors d'un retrait ou regroupement.
- Maintenir sélection, hover, fiche, amélioration et ghost sur le bon bâtiment, y compris après changement de niveau ou chantier. Le client ne décide pas des autorisations ni de l'occupation ; aucune identité décorative persistante nouvelle.
- Mise à jour bornée aux bâtiments/groupes affectés ; matériaux partagés non détruits par la suppression d'une seule instance. Factory, village et bake réutilisent la même représentation statique et les mêmes attaches animées.

Budgets proposés sur le cadrage stabilisé de l'audit, après retrait de la capture du dépoli : **≤ 220 appels de dessin**, contre 559 sans capture (réduction d'au moins 60 %), et **≤ 400 meshes actifs**, contre 641. Le nombre de draws doit être mesuré sur toutes les passes de la frame ; regrouper en sous-meshes sans réduire les soumissions ne satisfait pas le critère.

## 4. Effets du tore et vue active : état actuel à préserver

Le code actuel appelle `scene.render()` soit sur le village/région, soit sur le tore. `#torusOverview.updateCosmology()` ne s'exécute qu'en mode `world`. Les effets lourds propres à la scène du tore — ombres ponctuelles, profondeur, raymarching du brouillard, postprocess et halo solaire — **ne sont donc pas dessinés en vue village/région stabilisée**. Ils restent alloués tant que cette scène existe.

En village, le calcul local d'éclairage cosmologique reste utile et borné à une mise à jour toutes les 200 ms ; météo, pluie locale, eau, feux et brouillard natif du village appartiennent à son propre rendu. La transition nuageuse possède une scène partagée séparée, rendue seulement si son alpha est positif. Le voyage d'arrivée peut momentanément montrer le tore avant de basculer sur le village.

Preuves : [`BabylonVillageScene.ts`](../apps/world-web/src/scene/BabylonVillageScene.ts), branches de rendu et garde dans `#updateCosmology` ; [`terrain-overview-view.ts`](../apps/world-web/src/scene/terrain-overview-view.ts), scène et cosmologie du tore ; audit : aucun rendu de la scène du tore dans les échantillons village stabilisés. Les métriques `worldRenderMs` peuvent conserver une ancienne valeur après changement de vue : présence de cette valeur ou d'un postprocess en mémoire ne prouve pas son exécution.

Cette tranche préserve ce cloisonnement. Optimiser le tore reste une tranche distincte ; cela ne résoudra pas la capture du dépoli ou les draws du village.

## 5. Découpage et validation

Ordre proposé : dépoli sans capture → géométrie hôtel/campus → regroupement des maisons répétées → autres lots significatifs. Mesurer après chaque étape pour attribuer les gains. Précompiler les parties statiques de l'hôtel si leur fabrication/upload est confirmée coûteuse ; conserver les attaches dynamiques, sans imposer une infrastructure générale.

Validation requise lors de l'implémentation :

1. Même village et même caméra, contrôle de la fin de cinématique et des files d'intégration, même résolution et qualité, GPU matériel identifié. Exclure SwiftShader et le mode automatique 5 FPS. Comparer également un build de production.
2. Plusieurs fenêtres stabilisées par variante, puis navigation/rotation/zoom. Publier moyenne et P95 des frames, draws de toutes les passes, CPU de préparation, timings GPU si disponibles, sommets/triangles et mémoire unique. Ne pas publier un facteur de gain unique si les séries restent variables.
3. Captures de près et de loin, jour/nuit, achevé/travaux, factory/village/miniatures : ouvertures réelles, façade courbe, exposition visible, détail cohérent et changements de LOD discrets. Tests géométriques existants concernés et régressions ciblées de picking/lifecycle lorsque les lots changent.
4. Vérifier sélection et actions sur plusieurs maisons identiques, disparition/remplacement d'une instance, chantier, rotations, changements de palette, ressources libérées. Vérifier que zéro passe du tore s'exécute en village stabilisé et zéro capture de scène pour le dépoli.

Critère de fluidité conservé : plafond normal 45 FPS et objectif de P95 ≤ 40 ms du parcours stabilisé sur matériel de référence. Les budgets de sommets/draws sont des objectifs techniques intermédiaires ; ils ne suffisent pas à annoncer cet objectif atteint. Si un critère manque, statut **à valider** avec mesure et cause identifiées.

## 6. LOD du campus en Village — tranche du 7 octobre

Babylon installé/verrouillé : **8.56.2**. Les factories, `.abmesh.gz`, `AssetContainer.instantiateModelsToScene()` et instances classiques sont conservés. Le LOD natif `Mesh.addLODLevel()` accepte la couverture écran (`useLODScreenCoverage`) et les instances délèguent au mesh source avec leur sphère propre. Cette unité ne correspond pas au campus : ses 39 sources au niveau 3 couvrent chacune une pièce différente. Des seuils identiques par pièce produiraient des bascules incohérentes ; des seuils individuels imposeraient une correspondance fragile entre 39 pièces détaillées et 8 lots distants.

**Choix implémenté : sélection coordonnée de deux variantes de la recette.** Un observateur local par campus, avant l'évaluation des meshes actifs, choisit tous les nœuds d'une même représentation. Les sources, géométries et matériaux de chaque recette restent partagés entre ses exemplaires. Les monuments scientifiques communs restent sous le parent logique. Aucun remplacement de l'UUID, des métadonnées de site, de l'ancrage React ni du marqueur de sélection.

- Proche : asset existant inchangé. Distant : joints de mortier adjacents réunis en bandes/panneaux, sans franchir les baies ni les jonctions de modules ; charpentes, ouvertures, menuiseries, arbres et silhouette conservés. Fusion locale par matériau, vitrage séparé et toujours à alpha .22. Aucune fusion entre bâtiments.
- Critère : diamètre projeté de la sphère englobant la recette, en pixels de rendu. Perspective : `rayon × |projection[5]| × hauteurViewport / profondeurCaméra`. La position relative à la caméra, la focale, le viewport et l'échelle du parent interviennent ; orthographique : même expression sans division par profondeur. Une sphère traversant le plan caméra conserve le détail. Le recentrage déplace ensemble parent et caméra.
- Un seul seuil, **320 pixels** : en dessous, distant ; sinon, détaillé. Le niveau 3 mesuré occupe environ 791 / 374 / 244 pixels aux trois poses du protocole. Le cadrage de gestion reste détaillé ; la réduction cible le dézoom important encore en Village. Pas de fondu ni d'hystérésis préventive.
- Précompilation : `node scripts/bake-buildings.mjs university --lod` régénère uniquement les six assets distants ; la compilation normale de l'université régénère les deux variantes. Le manifeste reste adressé par hash. Les miniatures et assets proches n'ont pas été modifiés pour cette tranche.
- Chargement : modèle proche disponible en premier, variante optionnelle chargée une fois par recette/scène. Aucun chargement ni fabrication au seuil. Échec de variante : détail conservé. Suppression pendant chargement : aucune instance tardive attachée ; cache libéré avec la scène, observateur avec le bâtiment.
- Picking : les prédicats personnalisés réappliquent `isEnabled()` et `isVisible`, car Babylon remplace son filtre par défaut lorsqu'un prédicat est fourni. Vitrage non pickable même après actualisation de snapshot. Le zoom en Village conserve la sélection du bâtiment.
- Coût assumé : assets distants conservés en plus du détail ; 4 497 400 octets de buffers géométriques pour le niveau 3 achevé, 15 956 088 octets si les six variantes sont rencontrées, hors textures, objets JS et allocations du pilote. Cache borné par ces six recettes, sans accumulation par zoom.

Hôtel de ville niveau 2, maisons, thin instances de végétation, terrain, streamer, backend et gameplay hors de cette tranche. L'hôtel reste plus lourd isolément mais possède des éléments courbes/dynamiques spécifiques ; les maisons partagent déjà leurs draws entre exemplaires. Le campus permet un gain attribuable avec une famille statique et identifiable. [Mesures, captures et limites](AUDIT-RENDU-3D-2026-10-07.md#lod-du-campus-dans-la-vue-village).


## 7. Généralisation à trois niveaux en Village — 7 octobre 2026

Cette extension, autorisée par Tristan, remplace le seuil propre au campus de la section 6. Les réglages restent **dans le Laboratoire DEV**, avec sauvegarde locale, conformément à sa réponse explicite.

- **Proche** : recette existante intacte, miniatures et atelier inchangés.
- **Périphérie** : joints de maçonnerie réunis sans fermer les réservations, petits clous/chevilles supprimés, sections rondes moins tessellées ; pierre arrondie des ateliers et de la mairie simplifiée.
- **Lointain** : suppression des chanfreins de bois devenus minuscules, toiture/plancher continu, suppression des chevrons/liteaux secondaires et sections rondes réduites. Charpente principale, silhouette, portes, baies, vitres et différences de niveau/chantier restent présentes.

`building-lod.ts` sélectionne une représentation entière, sous le même parent logique. Les seuils par défaut sont **45 puis 28 pixels de rendu par mètre de recette**. C'est le diamètre projeté de la sphère englobant le modèle détaillé, divisé par son diamètre local ; une instance agrandie conserve donc le détail plus longtemps. La projection tient compte de la focale, du viewport, de la résolution, de la profondeur dans le repère caméra, du mode orthographique et de l'échelle. Normaliser par la taille de recette évite de garder longtemps les minuscules joints d'un campus uniquement parce que son emprise est grande. Deux bâtiments de tailles différentes avec les mêmes modules de maçonnerie suivent une lisibilité comparable. Une caméra dans la sphère conserve le détail.

Le choix coordonné reste préférable au LOD natif par mesh : la hiérarchie et le découpage en matériaux des variantes diffèrent. Désactivation de l'ancienne variante avant activation de la nouvelle ; ni fondu ni allocation/génération au seuil. Les deux seuils peuvent changer à chaud via `building-lod-settings.ts` et les contrôles de `DevDrawer.tsx`. Validation : `5 <= lointain < proche <= 200`. Le stockage `arbestra.building-lod.v1` n'est lu qu'en DEV ; en production, les défauts du code s'appliquent.

### Recettes et ressources

| Famille | Préparation et réemploi |
| --- | --- |
| Campus 1–3, maisons pierre/troncs/madriers 1–2, mairie 1 standard | Deux variantes `.abmesh.gz` (`-lod1`, `-lod2`) en plus du proche ; `AssetContainer` par scène/recette, instances natives partagées. Les 40 variantes sont produites par `corepack pnpm factory:bake --lod`. |
| Scieries 1–3, tailleur de pierre, caserne DEV | Trois templates statiques créés une fois par scène/recette et réutilisés via instances natives. Le feu du tailleur reste unique et commun. |
| Mairie 2 animée, plans particuliers avec accès/murets | Trois hiérarchies préparées à la création/reconstruction du parent ; conservées lors des zooms. Les horloges/reflets masqués ne s'actualisent pas. Les braseros de mairie restent uniques et communs. Pas de cache universel d'animations ajouté. |
| Jardins, anciens bâtiments et chantiers à quelques primitives | Représentation minimale existante conservée ; pas de triple copie sans simplification utile. |

Les caches statiques sont bornés par les recettes de la scène et libérés à sa destruction. Supprimer un exemplaire libère ses instances et son observateur, pas les sources partagées. Les variantes précompilées restent optionnelles : une erreur conserve le proche, un chargement tardif ne rattache rien à un bâtiment supprimé. Les variantes masquées sont exclues du picking existant. UUID, parent, panneaux, sélection et état serveur restent communs.

Les variantes augmentent les ressources résidentes ; les templates partagés des scieries compensent une partie du coût. La mairie animée reste une limite du chargement initial : ses variantes sont procédurales, même si aucun coût de génération n'est reporté sur le zoom. Les mesures complètes et le statut de validation sont consignés dans [l'audit du 7 octobre](AUDIT-RENDU-3D-2026-10-07.md#lod-de-toutes-les-familles-en-village).

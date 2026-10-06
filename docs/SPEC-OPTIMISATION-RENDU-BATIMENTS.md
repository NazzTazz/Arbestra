# Optimisation du rendu des bâtiments

Date : 6 octobre 2026. Statut : **spec, non implémentée**.

Source : [audit mesuré](AUDIT-RENDU-3D-2026-10-06.md). Demande de Tristan : simplifier le verre dépoli en acceptant une perte de qualité de reflets, spécifier la réduction des sommets et le regroupement des meshes.

## Décisions et périmètre

**Validé par la demande** : perte de qualité des reflets du dépoli autorisée ; objectif de simplification géométrique et de regroupement à spécifier. Remplacer la capture de scène du dépoli par un matériau économique est la direction retenue de cette spec.

**Proposé** : budgets numériques ci-dessous, représentation des microdétails par texture/normales, instanciation des recettes répétées et séparation des parties statiques/animées. Ces choix ne sont ni une livraison ni des gains démontrés.

**Ouvert** : niveau exact de lisibilité à travers le dépoli et seuils des variantes par taille projetée, à régler en factory et dans le village. Ces réglages ne bloquent pas les mesures isolées ni la préparation des lots statiques.

**Hors scope** : économie, gameplay, migrations, changement d'emprises/ouvertures, réduction de la couverture terrain, nouvelle mécanique, refonte du streamer, modification des effets du tore. Cette demande porte sur la spécification ; aucun correctif graphique n'est implémenté ici.

## 1. Dépoli sans capture de scène

Remplacer le chemin partagé de `frosted-glass.ts` par un matériau de verre dépoli simple : teinte légèrement bleutée, grain fixe réutilisable, spéculaire doux et éventuellement Fresnel/reflet d'environnement statique. Aucun flou du fond réellement rendu. Les reflets de bâtiments voisins et la restitution exacte du décor derrière le verre peuvent disparaître.

Exigences :

- **Zéro render target, ReflectionProbe ou passe de scène supplémentaire pour le dépoli**, en village, région, factory et miniatures. Retirer `campus-glass-background` et la gestion de sa liste globale.
- Matériau et éventuelle petite texture partagés à l'échelle d'une scène ; pas une allocation par vitre. Préférer un dépoli opaque ou peu transparent ; une transparence alpha doit justifier son coût et sa lisibilité.
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
3. Préparer une variante simplifiée pour les distances où les petits reliefs deviennent sous-pixel. Choisir les seuils par taille projetée avec hystérésis ; éviter les changements visibles et les oscillations. Compter les variantes retenues dans la mémoire résidente.
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

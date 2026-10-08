# Kit de terrain — surface rocheuse organique

La référence du 8 octobre remplace les essais de pavés, cubes, joints et rochers par case. La grille reste logique ; elle ne définit plus le contour visuel des roches.

## Livré dans l'atelier

Route /terrain-kit, ouverte sur Roche → Affleurements. Deux représentations : Sol rocheux et Affleurements, sur une zone de 8 × 6 cases. Trois seeds visuelles, rotation, zoom, cadrage conservé entre variantes. Les recettes terre et le profil explicite des marches restent disponibles. Aucun changement du générateur persistant, de l'occupation, des routes ou des ressources.

- Triangulation irrégulière : treillis de support subdivisé quatre fois par case, sommets déplacés en X/Z de façon déterministe, diagonales alternées selon un hash mondial.
- Facettes planes à teintes grises, sans texture et sans joint/cadre de cellule.
- Altitude visuelle locale, contours irréguliers et sommets inclinés ; affleurements asymétriques raccordés progressivement au sol. Leur champ de hauteur est un dispositif de recette, pas une modification des altitudes métier.
- Pas de murs verticaux ou plateformes carrées générés automatiquement aux limites des cases.

## Contrat d'intégration

scene/rock-surface.ts expose createRockSurface et rockSurfaceVertex. Fournir des coordonnées canoniques mondiales entières, une seed commune et, éventuellement, une fonction globale et continue de hauteur visuelle. Cette fonction doit être identique pour tous les morceaux ; aucune seed ni closure dépendant du chunk. La géométrie retournée est en coordonnées mondiales : le recentrage WorldSpace intervient ensuite, sans changer le bruit.

Chaque sommet est identifié par ses coordonnées globales de subdivision. Deux morceaux adjacents partagent exactement sa position. Le même résultat découpé en cases ou généré en bloc donne exactement les mêmes triangles, normales et couleurs. Les périodes optionnelles du tore appliquent un hash et un bruit périodiques ; une fonction de hauteur fournie doit elle aussi respecter ces périodes.

Le cache de recettes instanciées de terrain-kit est uniquement celui de l'atelier. Pour intégrer le terrain mondial, générer les morceaux depuis leurs vraies coordonnées ; ne pas répéter la même recette locale sur chaque case. L'intégration au streamer/village reste en tranche D. Le picking métier et les accès continuent de consulter le terrain canonique.

## Vérifications et limites

Dix tests ciblés : déterminisme, seed, identité exacte des morceaux assemblés avec coordonnées négatives, bords partagés, coutures toriques, facettes non inversées, variations d'altitude, recettes terre/marches et partage/libération de scène. Navigateur de développement : affleurements, sol rocheux, variantes/rotation et retour aux recettes existantes, aucune erreur observée. Captures terrain-organic-*.png sous test-results.

La zone 8 × 6 utilise 1 536 triangles, indépendamment du découpage logique. Aucun gain de performance revendiqué. Géométrie produite à la création, pas à chaque frame. La résolution est fixe ; LOD, ancrages sur terrain réel et adaptation du relief visuel aux emprises construites restent à traiter lors de l'intégration. Pas de simulation d'érosion.

## Réutilisation dans le World Generator r8

Le profil `rockOutcropElevation` est partagé avec le rendu des sites r8 via `world-generator/world-outcrops.ts`. `createRockSurface` conserve quatre subdivisions par défaut ; une subdivision suffit à la représentation globale. L'amplitude des micro-variations est optionnelle : le World Generator utilise directement le profil et l'ancrage sur les vrais triangles de son terrain, sans seconde perturbation verticale. Les sites persistés ne sont pas modifiés. Cette intégration concerne le preview opérateur ; le streamer Village et les stocks exploitables restent séparés.

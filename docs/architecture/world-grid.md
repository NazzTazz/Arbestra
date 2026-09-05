# Monde et grille

Chaque monde est une grille rectangulaire finie et torique. La configuration initiale est `2048 × 1024` cellules, découpable en chunks `32 × 32`.

Une cellule métier est identifiée par `(world_id, cell_x, cell_y)`, avec coordonnées entières canoniques :

- `0 <= cell_x < width_cells`
- `0 <= cell_y < height_cells`
- tout déplacement passe par modulo sur les deux axes.

Babylon affiche une fenêtre locale détaillée autour d’un point d’ancrage et utilise la distance enveloppée la plus courte. La caméra se réenveloppe aux dimensions du monde et un sous-sol continu masque toute frontière artificielle. `CELL_SIZE = 2.5` est une échelle de rendu, jamais une coordonnée métier.

Le tore 3D futur est une représentation de dézoom. Les règles, collisions et déplacements restent calculés sur la grille plate. L’occupation et la génération sont définies séparément ; streaming et rendu planète-donut restent reportés.

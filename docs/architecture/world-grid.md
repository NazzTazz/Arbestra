# Monde et grille

Chaque monde est une grille rectangulaire finie et torique. La configuration initiale est `2048 × 1024` cellules, découpable en chunks `32 × 32`.

Une cellule métier est identifiée par `(world_id, cell_x, cell_y)`, avec coordonnées entières canoniques :

- `0 <= cell_x < width_cells`
- `0 <= cell_y < height_cells`
- tout déplacement passe par modulo sur les deux axes.

Babylon affiche une fenêtre locale détaillée autour d’un point d’ancrage et utilise la distance enveloppée la plus courte. La caméra se réenveloppe aux dimensions du monde et un sous-sol continu masque toute frontière artificielle. `CELL_SIZE = 2.5` est une échelle de rendu, jamais une coordonnée métier.

Le rendu local regroupe les cases en meshes de chunks. Des couleurs déterministes par coordonnée distinguent les prairies, les rivages, l'eau et le sol rocheux ; les différences d'élévation forment des flancs visibles. Ces variations sont uniquement graphiques : codes de terrain, occupation et constructibilité restent ceux du serveur. Le sous-sol est placé sous la surface de l'eau pour ne pas la masquer. Les shaders Babylon `default` des matériaux et `color` des lignes sont importés explicitement dans le graphe Vite afin qu'un chargement ou rechargement à chaud ne tente pas de récupérer des fichiers `.fx` inexistants.

La [première passe de textures](../SPEC-TUILES-TERRAIN-JARDIN.md) affecte à chaque case d'herbe une des huit images d'un atlas ; l'eau et la roche gardent les teintes associées à leurs codes de terrain. La [côte en faux relief](../SPEC-COTE-EN-RELIEF.md) remplace les overlays transparents : une bande de sol aux bords irréguliers et un flanc texturé rejoignent l'eau abaissée. Le Jardin choisit une image par état de chantier ou tranche de stock, sans modifier l'économie.

Une couche transparente unique couvre les seules faces d'eau visibles. Sa texture de fines rides est générée localement une fois et ses coordonnées UV dérivent lentement ; les sommets de l'eau et les côtes restent fixes. Cette animation est purement graphique.

La grille suit les élévations du snapshot, légèrement au-dessus des surfaces. Le mode Construire dessine les seules cellules `canBuild` avec des contours blancs continus (opacité 22 %) et un léger voile bleuté (16 %) qui laisse les textures visibles. Les bords partagés gardent la hauteur du voisin le plus haut. Le test de profondeur reste actif pour que les bâtiments et features masquent les éléments derrière eux. Hors construction, le voile disparaît et seul le contour très discret demeure. Les lignes et le remplissage sont regroupés dans deux meshes non sélectionnables ; ils ne décident aucune autorisation métier : la [zone autorisée](./world-space-and-occupancy.md) vient du serveur. Les shaders GLSL des lignes sont importés explicitement avant création de la scène pour éviter un repli vers des fichiers `.fx` absents du serveur web.

Les bosquets et gisements rocheux visibles proviennent des features serveur. Babylon agrandit et espace les conifères d'une feature `woodland`, et rend les gisements `stone_outcrop` plus lisibles. Les petits cailloux sont un décor déterministe sur herbe, plus fréquent sur les rives ; ils ne bloquent pas la construction et disparaissent lorsqu'une case reçoit un bâtiment. Tous ces meshes statiques sont fusionnés par matériau après création.

Le tore 3D futur est une représentation de dézoom. Les règles, collisions et déplacements restent calculés sur la grille plate. L’occupation et la génération sont définies séparément ; streaming et rendu planète-donut restent reportés.

Les habitants affectés à une récolte ou à une extraction sont des silhouettes low-poly construites avec des volumes Babylon simples. Le client anime bras et jambes pendant le déplacement sur le chemin serveur et les immobilise pendant le travail sur place. Leur hauteur reste fixe sur le trajet, légèrement au-dessus du terrain et des Jardins pour dégager les pieds. Ces figurants ne déclenchent aucune transition économique.

Le mode « Chemins · debug » dessine les tronçons du réseau serveur comme des bandes de terre aux deux lisières irrégulières, calculées de façon déterministe. Les tronçons partagés sont dessinés une seule fois, dans la région visible et sous les bâtiments/Jardins. Cette apparence ne change ni les cellules du trajet, ni les déplacements, ni les durées de transport.

Au zoom rapproché, la limite d'inclinaison de la caméra augmente progressivement pour permettre une vue plus rasante ; la valeur choisie manuellement par le joueur est conservée lors du zoom.

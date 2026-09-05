Elles figent notamment :

- occupation mondiale clairsemée et atomique ;
- suppression progressive des cellules libres persistées ;
- rayon constructible de Chebyshev 5 depuis toute l’emprise terminée ;
- terrain persistant par chunks 32×32 ;
- génération déterministe, transactionnelle et versionnée ;
- prairie, eau et terrain rocheux ;
- 600 clairières protégées ;
- cellules boisées et affleurements rocheux ;
- distinction stricte entre features serveur et décor cosmétique ;
- compatibilité avec le monde de développement existant.

Aucun test, build ou navigateur n’a été lancé. Ta modification manuelle de grille est restée intacte et distincte des deux specs.

## Travail idéal pour TristanGPT

Je te réserverais ces mini-tranches, après que Terra a posé les structures :

1. Configuration du générateur v1

   Ajuster visuellement les seuils d’eau, terrain rocheux, densité des woodlands, taille des clairières et transition. Terra doit te livrer un fichier de constantes central, lisible et commenté.

2. Palette des terrains

   Choisir précisément les couleurs, différences d’élévation et réaction à la lumière de grassland, water et rocky_ground. C’est du jugement visuel pur.

3. Recette procédurale Woodland

   Composer une cellule boisée avec 2–4 arbres : tailles, positions, rotations et variantes. Le serveur fournit la cellule et variantSeed; toi, tu fabriques sa silhouette.

4. Recette Stone Outcrop

   Même exercice avec quelques icosphères/cylindres : silhouette rocheuse lisible, sans toucher à la collision métier.

5. Décor cosmétique déterministe

   Herbes, fleurs et petits cailloux. Terra prépare une fonction recevant seed, coordonnées et terrain ; tu règles les formes et densités.

6. Lisibilité de la constructibilité

   Couleur de la grille, cellules candidates, obstacles, clairières protégées et feedback de sélection.

7. Sélection de la seed d’Aube

   Générer plusieurs mondes candidats et choisir celui qui ressemble le plus à un véritable premier univers Arbestra.

Je laisserais à Terra les migrations, contraintes SQL, transactions, normalisation torique, sérialisation des chunks et contrats API. C’est là que TristanGPT risquerait de perdre une soirée à combattre un CHECK
exactly_one_occupant au lieu de fabriquer une jolie forêt.
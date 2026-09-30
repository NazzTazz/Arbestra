# Tuiles terrain et Jardin — première passe

Date : 23 septembre 2026. Direction : planche JMP fournie par Tristan, sans objectif de reproduction fidèle en une passe. Statut : **implémenté ; appréciation visuelle en jeu à recueillir**.

> Suite du 23 septembre : Tristan et Marie valident l'herbe ; Tristan juge le Jardin suffisant. Les huit overlays de bordure décrits ci-dessous ont été écartés et remplacés par la [côte en faux relief](SPEC-COTE-EN-RELIEF.md). La description des 24 images conserve le contrat et la livraison initiale, pas l'état courant des assets.

## Contrat graphique

24 images sources carrées de 128 × 128 pixels dans `apps/world-web/public/tiles/` :

- `grass-0..7.png` : huit prairies en camaïeu de verts, choisies par coordonnées canoniques ;
- `shore-0..7.png` : huit bordures transparentes eau/sol, orientées par quarts de tour selon les voisins du terrain serveur ;
- `garden-0..7.png` : chantier, semis, jeunes pousses, quatre remplissages intermédiaires, puis parcelle pleine / récolte requise.

Les huit bordures sources sont : deux variantes droites, deux variantes de coin adjacent, deux côtés opposés, trois côtés, quatre côtés et un coin diagonal. Leurs rotations donnent jusqu'à 32 apparences orientées. Elles couvrent les 16 masques cardinaux ; la huitième sert aux contacts diagonaux isolés. Ce n'est pas une promesse de traiter chaque configuration de huit voisins avec un dessin unique. La logique de sélection est dans `tile-appearance.ts`.

Un script reproductible `scripts/generate-terrain-tiles.mjs` produit ces 24 PNG et `atlas.png`, emballage technique utilisé pour les huit prairies et les surfaces neutres. La première proposition imagegen a servi de référence de palette, puis a été écartée des assets finaux : ses motifs et ses bords ne raccordaient pas correctement. Les PNG livrés sont dessinés par le script pour maîtriser les jonctions. Les petites textures restent délibérément sobres et sans photoréalisme.

## Intégration

Babylon conserve un mesh par chunk de terrain : UV par case vers l'atlas, couleur serveur pour eau et roche, texture pour l'herbe. Une fine surface transparente sur les cases terrestres adjacentes à l'eau montre la bordure appropriée. L'eau, les élévations, les cases bloquées et la constructibilité restent celles du snapshot serveur.

Chaque parcelle de Jardin utilise son stock et sa capacité exposés par le snapshot pour choisir une des sept images actives. Les cases réservées et les chantiers initiaux utilisent l'image de construction. Une nouvelle lecture du snapshot fait changer l'image quand le remplissage franchit un seuil ; aucun crédit économique n'est déclenché par le rendu. Le Jardin garde sa géométrie et sa sélection existantes.

## Limites et contrôle

La bordure est un liseré topologique simple : largeur, raccords aux coins et couleur demandent encore un regard humain. Les textures de Jardin décrivent le stock, pas le temps écoulé depuis le semis. Les trois régressions métier connues de la recette Jardins restent hors de cette passe.

Contrôle demandé : ouvrir Clairière sur desktop et mobile, observer lac, terre et Jardin, ouvrir Construire, puis vérifier que les parcelles restent sélectionnables. Le contrôle navigateur automatisé vérifie le rendu et l'absence d'erreur JavaScript ; l'appréciation artistique reste à confirmer par Tristan et Marie.

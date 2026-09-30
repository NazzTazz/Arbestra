# Côte en faux relief — première passe

Date : 23 septembre 2026. Direction validée dans la discussion avec Tristan : la planche JMP est l'idéal graphique futur ; cette passe assume des textures simples et garde les primitives Babylon. Statut : **implémenté / profil corrigé après retour de Tristan / appréciation humaine à recueillir**.

## Principe

- Les cases d'eau du serveur restent carrées et non constructibles. Leur surface est abaissée à `-0.75` unité de rendu par rapport au zéro local.
- Une case terrestre adjacente à l'eau reçoit une bande de sol sur son bord supérieur. Sa limite côté eau reste carrée ; sa limite côté herbe varie en quatre segments par côté. Les extrémités gardent une largeur fixe pour raccorder les angles.
- Sous cette limite visible, un flanc texturé descend jusqu'au plan d'eau. Le flanc droit ancien au contact de l'eau est retiré ; les autres flancs d'élévation sont conservés.
- Les faces du flanc sont orientées vers l'eau. Aux angles où deux côtés d'une même case terrestre bordent l'eau, une pièce supérieure raccorde les deux bandes sans laisser le coin nu.
- Quand une case d'herbe touche l'eau seulement en diagonale, et que ses deux voisines orthogonales sont terrestres, un petit triangle de rive est ajouté à son coin. Il rejoint les bandes portées par ces deux voisines sans déborder sur la case d'eau.
- Deux textures 128 × 128 sont utilisées : `shore-top.png` pour le dessus et `shore-face.png` pour la terre stratifiée, avec des strates contrastées. Elles sont packées dans l'atlas avec les huit herbes et les huit états de Jardin. Les huit anciens overlays transparents de rive sont retirés.

La variation du contour dépend des coordonnées canoniques et d'un hash stable. La bande et le flanc sont regroupés dans les meshes de chunks existants. Aucun objet de rive persistant ou mesh individuel par case n'est créé. La géométrie ne modifie ni le terrain serveur ni l'occupation ni la sélection des cases.

## Limites

Le découpage reste une silhouette de cases et de segments droits ; il évoque un plateau plutôt qu'une plage naturelle. La couleur et l'épaisseur de la bande demandent encore un verdict humain sur le village. Blender et une véritable modélisation des falaises restent ultérieurs. Les herbes et Jardins de la passe précédente ne changent pas.

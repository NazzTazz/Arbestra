# Catalogue de bâtiments

Université, migration 025 : type vertical sans production, emprise fixe de **5 × 6 cases**, trois niveaux de capacités 1/2/3 centres et 5/10/15 habitants. Construction facturée une seule fois pour les 30 cases ; améliorations sans nouvel agrandissement une fois cette emprise réservée. Ancre : offsets X −2..+2 et Y −2..+3 ; centre graphique +1/2 case en profondeur. Anciennes Universités 3 × 3 : adaptation explicite `adaptUniversityCampus`, également vérifiée à leur prochaine amélioration, sans frais ni modification de niveau ; nouvelles cases revalidées transactionnellement, aucun voisin écrasé et aucune écriture de réservation pendant une lecture de snapshot. La [science](science.md) décrit les centres et les acquis partagés. Première représentation acceptée par Tristan : trois départements, terrain herbeux, sept arbres décoratifs et six braseros au niveau 3. Composition commune à l'atelier et au jeu ; intégration graphique sur la carte encore à recetter.

`building_types` décrit un type stable ; `building_type_levels`, ses niveaux, durées, coûts et productions. Ajouter un type connu ne nécessite pas de modifier le schéma. `CONSTRUCTION_DURATION_MS` remplace temporairement les durées du catalogue en développement/test seulement.

Stratégies fermées :

- progression : `vertical`, `spatial`, `fixed-footprint` ;
- production : `none`, `direct`, `buffered`.

`buildings` est l’instance métier. `world_cell_occupancies` porte son emprise : une cellule `anchor`, puis éventuellement des cellules `extension`. Une extension réservée pendant un chantier appartient déjà au même bâtiment.

Les limites d’instance sont validées transactionnellement. La Scierie est limitée à une instance par village et protégée aussi par un index unique partiel. Le Jardin n’est pas une entité spéciale : c’est un bâtiment `spatial + buffered`, avec une action de récolte exposée par le domaine village.

Pour un bâtiment `spatial`, le niveau et la superficie sont indépendants. Les coûts, productions et capacités catalogués au niveau courant sont interprétés par cellule active selon [Construction spatiale](./spatial-construction.md).

L'Habitation suit une progression verticale sans extension d'emprise. Son niveau 1 coûte 25 bois, dure 60 secondes et offre 5 couchages une fois terminé. Son niveau 2 coûte 300 bois, dure 120 secondes et offre 25 couchages une fois terminé. Pendant l'amélioration, l'Habitation est en chantier et ne contribue temporairement pas à la capacité. Le niveau 2 utilise une teinte de bois plus sombre dans Babylon.

Le client lit libellés, niveaux, coûts et productions depuis le catalogue renvoyé par l’API ; il peut prévisualiser un total, mais le serveur le recalcule toujours.

## Kit visuel pilote : hôtel de ville (2 octobre 2026)

La rotation des pierres sur les côtés conserve hauteur verticale et épaisseur normale au mur, au lieu de les permuter ; même correction pour jambages et linteaux. Les tests vérifient les dimensions réelles après rotation, en complément des limites des assises aux coins.

Angles de maçonnerie : emprise extérieure locale commune ±1,245 en X et ±1,135 en Z, murs d'épaisseur 0,16. Une assise sur deux, façades traversantes et côtés arrêtés à leur face intérieure ; assise suivante inversée. Les quatre murs partagent la même hauteur d'assise. Les ouvertures découpent les pierres localement, sans fractionner les rangées entières ni multiplier les joints près des coins. Test des quatre coins sur quatre assises : trou reproduit avec les anciennes limites, absence de trou/chevauchement après correction. Porte et toiture inchangées.

Arêtes de pierre plus saillantes : rayon d'arrondi réduit à 8 % de la plus petite dimension, chanfrein des bouts limité à 3 % par côté. Faces plus larges et coins encore légèrement adoucis ; bois inchangé.

Réglage cartoon des pierres après recette : longueur nominale 0,29, hauteur d'assise 0,14, teinte ivoire presque blanche, variations de valeur limitées à 4 %. Coins arrondis en trois segments par quart de cercle, bouts adoucis ; rayon borné par la plus petite dimension pour préserver les petits fragments autour des ouvertures. Même matériau pierre partagé. Toiture validée inchangée.

Murs courants : pierre taillée gris clair, assises à joints décalés, fines séparations et nuances discrètes par bloc (couleurs de sommets, matériau partagé). Encadrements en pierre, colombages retirés. Fenêtres toujours ouvertes, porte de bois à renfort Z conservée. Pas de piédestal. Toit, charpente, plafond plat et foin inchangés et validés par Tristan. Cette maçonnerie remplace les briques de bois historiques ci-dessous.

Correction d'emplacement : le parement ferme horizontalement le dessus du volume habité, à hauteur des murs, pas les sous-pentes. Seize bois jointifs parallèles à la panne faîtière constituent ce plafond plat ; le foin repose dessus entre les fermes. Sous-pentes et charpente du comble dégagées. Cette disposition remplace la sous-face inclinée décrite précédemment.

Sous-face côté habitation : dix bois longitudinaux chanfreinés par pan, parallèles à la panne faîtière et jointifs sous les arbalétriers. Foin illustré par une couche volumique texturée entre les fermes, au-dessus du parement intérieur et sous les liteaux/couverture. Les bois des fermes et les pignons ouverts restent apparents. Isolation de présentation uniquement, sans effet thermique/météo économique ni particules.

Socle supprimé à la demande de Tristan : racine à hauteur 0,78, murs/porte commençant à 0,02 au-dessus du plan local, sans piédestal de pierre. Coordonnées horizontales de l'entrée inchangées.

Corps du bâtiment après recette : murs en blocs de bois posés sur chant, rangées à joints alternés. La géométrie est découpée autour des fenêtres ouvertes (deux devant, deux derrière, une sur chaque côté) et de l'entrée ; aucun vitrage ni volume plein derrière les ouvertures. Porte de cinq planches verticales avec deux traverses et une diagonale en Z. Préau, poteaux du préau et ancienne poutre sombre de façade retirés. La racine Babylon est un mesh sans géométrie, portant murs/toiture/fondation ; les enfants gardent le picking par site. Point de sortie des habitants à z local −1,10 inchangé. Les blocs sont fusionnés dans le même lot bois que la charpente ; aucun bloc persistant individuel. Cette décision remplace le torchis des murs décrit historiquement ci-dessous.

Le générateur de poutres chanfreinées respecte le winding Babylon par défaut ; toutes les normales sont extérieures, y compris faces de coupe et chanfreins. La régression `timber-thatch.test.ts` a reproduit les normales intérieures du premier modèle avant correction. Le culling reste actif ; pas de matériau double face pour masquer une géométrie inversée.

UV des poutres chanfreinées : les coordonnées longitudinales suivent la longueur réelle, y compris les petites sections aux extrémités. Les faces de coupe utilisent une zone de cernes réservée dans la même texture de bois, avec marge contre les fuites du mipmapping ; aucun matériau/draw call supplémentaire.

Lisibilité de la panne faîtière : section 0,22 × 0,20, longueur 3,16, extrémités dépassant de 0,18 unité les planches de faîtage. Le nez chanfreiné reste visible sous le sommet de la couverture.

Dernier retour de recette : les deux fermes de pignon sont ouvertes, torchis retiré dans le triangle avant aussi. Arbalétriers élargis (section graphique 0,15 × 0,18) pour la lisibilité. Une panne faîtière unique continue remplace les deux pannes voisines du sommet, avec extrémités visibles. Deux fines planches de faîtage se rejoignent sur l'axe pour fermer la jonction des pans et dépassent légèrement les rives. Cette décision remplace le pignon avant fermé décrit historiquement ci-dessous.

Correction de recette : rotation supplémentaire de 90° du fil du bois de la couverture. Les appuis sont calculés le long de la normale du toit à partir des épaisseurs des fermes, pannes, chevrons et liteaux ; planches jointives à joints alternés, sans surélévation artificielle entre rangées. Faîtage fin posé sur la couverture. Contrefiches courtes, perpendiculaires aux arbalétriers, dessinant de petits triangles rectangles avec le poinçon. Cette règle remplace les offsets et le léger recouvrement de la première version ci-dessous.

Design courant apr?s recette : angle int?rieur au sommet de 110?, soit deux pans inclin?s de 35? par rapport ? l'horizontale. Fa?tage de la fa?ade vers l'arri?re, pignon avant ferm? en torchis au-dessus de la porte existante, pignon arri?re ouvert. Trois fermes ? six bois, pannes, chevrons et liteaux. Le chaume initial est remplac? par des planches clou?es ? joints d?cal?s d'une demi-largeur entre rang?es, l?ger recouvrement et fa?tage fin ? deux planches. Bois clair ? fil longitudinal discret, chanfreins longitudinaux et aux extr?mit?s. Torchis beige p?le en retrait des poutres ; corps visuel resserr? de 0,05 unit? par face, porte inchang?e.

`scene/timber-thatch.ts` (nom historique du prototype) construit ce kit Babylon et partage deux textures de bois par sc?ne. Les pi?ces sont fusionn?es en quatre meshes par mat?riau, clous compris. La hi?rarchie existante porte d?placement, picking, LOD et destruction. L'emprise m?tier et l'?conomie ne changent pas. Premi?re passe sans lucarne/clocheton, autres b?timents inchang?s. Aspect de cette r?vision ? recetter.

## Tailleur de pierres décoratif — 6 octobre 2026

Le type `stonemason` est introduit par la migration 030 : niveau 1, emprise fixe 2 × 2, production `none`, aucune ligne de coût ou de production, `buildable=false`. Une installation DEV avec ateliers activés est proposée dans Construire → Production. Le joueur choisit son emplacement ; le serveur applique les protections spatiales existantes et réserve quatre cellules pour un bâtiment immédiatement achevé. L’installation est unique par village et idempotente ; elle est refusée en production. Aucun artisan, qualification ou production de pierre ajoutés. Rendu validé dans la factory puis observé dans Clairière.

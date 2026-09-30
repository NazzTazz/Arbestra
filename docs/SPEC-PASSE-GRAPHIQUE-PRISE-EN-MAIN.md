# Passe graphique de prise en main — terrain du village

Date : 23 septembre 2026. Base relue : `main`, `20ff32b`. Statut : **implémentée / appréciation visuelle à valider**.

## Résultat visé

À l'ouverture du village, le terrain doit présenter une mosaïque de verts calme, des étendues d'eau et des berges lisibles lorsqu'elles existent dans la région, et un village assez grand à l'écran pour reconnaître ses bâtiments. La planche fournie par Tristan sert de direction de couleur et de composition, pas de promesse de reproduction fidèle.

## Périmètre de cette passe

- Utiliser uniquement `region.terrainCodes` et `region.elevations` déjà fournis par le serveur. Herbe, eau et roche restent aux mêmes coordonnées.
- Varier les couleurs des carrés de terrain de façon déterministe par coordonnées. Dessiner eau, rives et petites marches d'élévation dans les meshes de chunks existants.
- Ajuster le cadrage initial de la caméra sur desktop et mobile. Préserver zoom et déplacement libres.
- Corriger les deux défauts de premier écran révélés par le contrôle mobile : chevauchement des ressources du HUD et bouton Jardins natif superposé à Construire.
- Conserver la grille hors construction telle que corrigée par Tristan ; elle n'est pas un chantier de cette passe.
- Contrôler le rendu dans un navigateur, sur desktop et profil mobile, avec un village existant. La région de Clairière ne contient pas d'eau ; contrôler l'eau avec un snapshot modifié uniquement dans le navigateur, puis réserver la validation d'une vraie zone d'eau à une région qui en contient.

## Limites

Aucun changement de génération, de base de données, de contrat, de constructibilité ou de règle économique. Pas de nouvelle eau inventée autour de la clairière, pas d'entités décoratives persistantes, pas de refonte des bâtiments ni du contenu du HUD. Les textures de Jardins et les assets Blender restent une passe ultérieure, à décider après observation du résultat.

## Critères de contrôle

- La mosaïque garde des cases discernables sans quadrillage omniprésent ; les bâtiments restent identifiables et sélectionnables.
- L'eau suit les cases du serveur et se distingue clairement de la terre, y compris aux berges.
- Le village reste visible au premier chargement et le joueur peut toujours zoomer, déplacer la caméra et construire.
- Aucun effet visuel ne crée une case constructible ou bloquante côté client.

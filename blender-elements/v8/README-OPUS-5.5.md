# Assemblage du kit jardins V8 pour Opus 5.5

Le V8 remplace les pièces lourdes du V7 par trois niveaux de détail. Les GLB et les images sont prêts pour l'intégration, qui reste hors périmètre de cette livraison. Le V7 reste conservé dans le dossier parent. Les nombres ci-dessous proviennent des indices des GLB livrés, après triangulation.

## Budgets vérifiés

La parcelle de référence mesure 2,5 × 2,5 m : trois rangs de seize plants, trois buttes, quatre planches. En LOD0 elle comporte six mottes. Une parcelle isolée a huit segments de corde et huit piquets ; le jardin fusionné en L en a seize de chaque. Les trois parcelles en L sont (0,0), (1,0), (0,1).

| Élément | Quantité par parcelle isolée | Triangles unitaires LOD0 | Total LOD0 | Triangles unitaires LOD1 | Total LOD1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sol | 1 | 2 | 2 | 2 | 2 |
| Carottes mûres | 48 plants ou 3 rangs | 24 / plant | 1 152 | 96 / rang | 288 |
| Buttes | 3 | 96 | 288 | 32 | 96 |
| Planches | 4 | 12 | 48 | 2 | 8 |
| Mottes | 6 / 0 | 14 | 84 | absentes | 0 |
| Cordes | 8 | 44 | 352 | 8 | 64 |
| Piquets | 8 | 12 | 96 | 12 | 96 |
| Marqueur | 1 | 176 | 176 | 24 | 24 |
| **Total** | | | **2 198** | | **578** |
| Plafond | | | 2 500 | | 600 |

| Niveau | Parcelle sans marqueur | Parcelle avec marqueur | L de 3 parcelles, marqueurs inclus | 460 parcelles isolées, borne géométrique |
| --- | ---: | ---: | ---: | ---: |
| LOD0 | 2 022 | 2 198 | 6 146 | 1 011 080 |
| LOD1 | 554 | 578 | 1 574 | 265 880 |
| LOD2 | 2 | marqueur omis | 6 | 920 |

La borne de 460 parcelles suppose toutes les parcelles isolées au même niveau. Les jardins fusionnés réduisent le coût des clôtures. Ce calcul n'est ni une mesure de Catmark ni une promesse de cadence sur MX230. Le LOD2 n'a aucune géométrie supplémentaire : ni piquet, ni corde, ni marqueur, ni tranche de sol. Ajouter ces objets invaliderait son budget de deux triangles.

## Bibliothèque et matériaux

Charger de préférence `assets/garden-kit.glb`, qui partage exactement quatre matériaux entre les trois niveaux : `V8_terre`, `V8_vegetal`, `V8_bois`, `V8_corde`. Ne pas afficher toutes ses sources superposées à l'origine. Les GLB séparés par niveau sont des alternatives ; les charger en plus créerait des doublons. Si plusieurs fichiers sont utilisés, dédupliquer les matériaux et les textures par contenu, pas seulement par nom.

Les matériaux utilisent `KHR_materials_unlit`, la couleur de base et `COLOR_0`. Aucun métal, rugosité, normale, transparence ou lumière dynamique n'est nécessaire. glTF range réglementairement la texture de base dans le champ `pbrMetallicRoughness.baseColorTexture` même pour un matériau unlit : ce nom de conteneur ne signifie pas qu'un modèle PBR est utilisé. Les facteurs métal/rugosité inutiles insérés par l'exporteur sont retirés par `sources/validate_v8.py`.

Tous les matériaux sont **simple face**, y compris les fanes. En LOD0 les feuilles sont de petits volumes fermés. En LOD1 les fanes sont des triangles orientés vers le haut ; cette simplification vise la caméra aérienne du jeu. Les cordes LOD1 sont aussi des rubans orientés vers le haut. Les plans de terre et les buttes sont des surfaces ouvertes sans dessous. Ne pas activer globalement le double face pour corriger une inversion d'axe.

Le relief et le volume restent lisibles grâce aux couleurs de sommets et à la texture. L'éclairage inscrit dans ces couleurs est fixe : il ne suit pas le soleil et les matériaux unlit ne reçoivent pas d'ombres dynamiques. L'adaptation éventuelle à la nuit appartient au rendu du jeu, pas à une nouvelle mécanique.

Le bois utilise une seule texture de couleur 512 × 512 pour les six planches et les piquets. Les longueurs des planches sont 1,52 ; 0,66 ; 1,20 ; 0,98 ; 0,82 ; 1,36 m. Largeur 0,17 m, épaisseur LOD0 0,014 m. Veinage, petites marques de bout et bord éclairci simulant le chanfrein sont dans la texture. Les plaques LOD1 sont à 0,008 m au-dessus de leur origine.

## Atlas lointain et sept stades

Choix confirmé par Tristan : conserver les sept images originales de 256 × 256, mais réduire leurs vignettes dans un atlas commun de 512 × 512 pour respecter les quatre matériaux simples. L'atlas contient des cases de 128 × 128, avec 120 × 120 de contenu et quatre pixels de débord de chaque côté. Il utilise la première moitié de l'image ; la moitié restante est libre.

Ordre depuis le coin supérieur gauche de l'image, quatre colonnes : stades 1, 2, 3, 4 puis stades 5, 6, 7, terre. Les sept textures `garden-stage-XX-256.png` sont des rendus orthographiques du **LOD0**, pas des dessins de remplacement. Les clôtures et le marqueur sont exclus du calcul pour éviter de dessiner de fausses clôtures internes dans les jardins fusionnés. Les sept modèles `PARCELLE_STADE_XX_LOD2` ont déjà les UV correspondants et partagent `V8_terre` avec le sol et les buttes des autres niveaux.

Pour une case d'atlas de colonne c et de ligne r (origine image en haut), les UV Blender avant conversion par l'exporteur occupent :

```text
u = (128*c + 4 + 120*s) / 512
v = (128*(3-r) + 4 + 120*t) / 512
s,t dans [0,1], du coin bas gauche vers le coin haut droit de la parcelle
```

Ne pas retourner une deuxième fois l'image : les UV du GLB sont exportés pour sa convention. Conserver les filtres de texture et vérifier les coutures à distance ; le débord limite le mélange des cases aux premiers niveaux de mipmaps, mais ne l'élimine pas aux mipmaps extrêmes.

| Stade | Plant LOD0 | Rang LOD1 de 16 plants, chacune des 3 variantes | Plaque LOD2 |
| --- | ---: | ---: | ---: |
| 1 semis | 4 | 64 | 2 |
| 2 cotylédons | 8 | 32 | 2 |
| 3 jeune | 12 | 32 | 2 |
| 4 feuillage | 16 | 32 | 2 |
| 5 racine | 20 | 96 | 2 |
| 6 presque mûre | 22 | 96 | 2 |
| 7 mûre | 24 | 96 | 2 |

En LOD0, chaque plant reste un objet indépendant. Une récolte plant par plant reste donc possible si Tristan la confirme. Les rangs fusionnés LOD1 et les images LOD2 ne représentent pas une récolte individuelle arbitraire. Ne pas inventer cette mécanique : le mapping des sept stades doit rester celui décidé par le jeu. Dans le code consulté pour V7, le stade est lié au stock et à la capacité, pas à l'âge du plant. Le stade 0 de construction reste distinct.

## Origines et axes

Les sources du kit ont translation nulle, rotation identité et échelle 1. Les exemples ont leurs placements appliqués aux sommets ; leurs objets sont également à transformation identité. Le manifeste contient les bornes de chaque nœud exporté.

Blender : XY au sol, +Z vers le haut. glTF : XZ au sol, +Y vers le haut. Conversion des coordonnées de `reference/assembly.json` : **(x, y, z) → (x, z, -y)**. Le JSON reste en coordonnées Blender. Conserver la conversion du chargeur glTF dans une scène Babylon gauchère ; ne pas ajouter une seconde inversion manuellement.

| Source | Origine et pose en coordonnées Blender |
| --- | --- |
| `SOL_LOD0/1` | Centre XY, surface Z=0 ; carré 2,5 × 2,5. |
| `BUTTE_1..3_LOD0/1` | Centre XY au niveau de référence du sol ; X de -1,24 à +1,24. Poser à Z=0,012. |
| `CAROTTE_STADE_XX_LOD0` | Centre du plant à la jonction avec la terre ; une partie de la racine descend sous Z=0. |
| `RANG_STADE_XX_VAR_1..3_LOD1` | Centre de la butte correspondante ; altitude des 16 plants déjà inscrite dans les sommets. Poser à Z=0,012 et associer variante n à butte n. |
| `PLANCHE_1..6_LOD0/1` | Centre XY de la planche, face inférieure LOD0 à Z=0 ; grand axe X. |
| `PIQUET_LOD0/1` | Pied, hauteur 0,384 ; section environ 0,030 × 0,028. Géométrie V7 conservée. |
| `MOTTE_LOD0` | Centre au niveau de pose ; une partie descend sous le sol. 14 triangles, géométrie V7 conservée. |
| `CORDE_LOD0/1` | Sol sous la première attache ; X=0 à 1,25 ; attaches Z=0,306. |
| `MARQUEUR_LOD0/1` | Niveau Z=0 de la pointe ; petite courbure décalant la pointe en X. Exemple : translation Z=0,72 et échelle 0,52. |
| `PARCELLE_STADE_XX_LOD2` | Coin inférieur gauche XY, carré X/Y de 0 à 2,5 ; surface Z=0. |

Le marqueur LOD0 a 176 triangles ; sa variante réduite LOD1 en a 24. Les deux partagent uniquement `V8_vegetal` et sont également livrés séparément. Aucun marqueur ne s'ajoute au jardin LOD2.

## Assemblage d'un jardin quelconque

Conserver une orientation commune des rangs pour le jardin. Chaque cellule garde trois centres de rangs Y=0,43 ; 1,25 ; 2,07. L'axe long des rangs est X. Le sol se joint bord à bord ; ne pas superposer un second sol du jeu au même niveau. Les buttes s'atténuent à leurs extrémités : elles ne constituent pas une surface soudée entre cellules.

Pour chaque côté de cellule, n'émettre une clôture que si la cellule voisine n'appartient pas au même jardin. Couper chaque côté exposé de 2,5 m en deux portées de 1,25 m. Dédupliquer les piquets aux extrémités et aux milieux par position canonique, y compris sur les contours des trous. Respecter les frontières entre jardins distincts et la topologie torique d'Arbestra. Le jardin en L a un périmètre de 20 m, seize cordes et seize piquets, sans segment intérieur.

La chaînette suit `z = 0,306 + 1,8 * (cosh((x-0,625)/1,8) - cosh(0,625/1,8))`. Sa flèche centrale est d'environ 0,110 m. La corde LOD0 est un tube fermé de sept sections longitudinales et trois côtés ; le LOD1 suit la même courbe avec quatre segments. Ne pas étirer arbitrairement une corde pour franchir une pente ou une portée différente : les raccords au terrain incliné restent à adapter lors de l'intégration.

Les deux chemins sont centrés à Y=0,84 et 1,66. Deux planches par chemin, soit quatre par cellule, constituent le budget de référence. Les couples de longueurs sont (1,52 ; 0,66), (1,20 ; 0,98), (0,82 ; 1,36). Ils laissent des jeux aux joints. Les décalages latéraux et les petits angles sont présents dans la recette. Les buttes restent suffisamment étroites pour ne pas soulever les planches. Une pose différente doit rester dans l'enveloppe des chemins et respecter le compte de pièces.

En LOD0, répartir seize plants entre X=-1,11 et +1,11 sur chaque butte, avec une graine déterministe pour les légères variations. Échantillonner la hauteur de la **surface triangulée effectivement utilisée**, pas seulement une formule idéale. Le générateur de source le fait par intersection sur les triangles. En LOD1, le rang préassemblé porte déjà ces hauteurs et doit utiliser la butte de même variante. Conserver les mêmes choix de variante aux changements de stade. Six petites mottes par cellule sont prévues en LOD0, aucune en LOD1.

## Précautions de performance pour l'intégration

Les exemples conservent les objets séparés pour permettre l'inspection ; ils ne sont pas un regroupement optimal pour le moteur. Une parcelle isolée possède 79 objets mesh en LOD0, 28 en LOD1 et un en LOD2 ; le L en possède 221, 68 et trois. Les quatre matériaux ne suffisent pas à réduire automatiquement ces objets à quatre appels de dessin.

Réutiliser les géométries du kit, partager les quatre matériaux, regrouper ou instancier les décors statiques quand le moteur le permet, et n'activer qu'un niveau à la fois. Les plants LOD0 restent indépendants dans le kit sans imposer des entités métier individuelles. Les seuils de changement de niveau et l'hystérésis restent à régler à la caméra réelle ; ils ne sont pas encodés dans les GLB. Les originaux 256 × 256 et `soil-source.png` servent à l'édition ; seuls l'atlas et le bois sont nécessaires comme textures au rendu courant.

## Sources et vérification

`sources/garden-v8.blend` est autonome et contient les scènes LOD0, LOD1, LOD2, les rendus de calcul des sept stades et les galeries. Les images sont empaquetées. Ouvrir la scène `V8 L_LOD0` pour le jardin proche ; la scène `V8 kit` contient les sources superposées. La démonstration V8 est statique ; l'animation de récolte V7 reste dans l'ancienne source.

`sources/build_v8.py` construit de nouvelles scènes sans supprimer les scènes existantes. Dans un fichier Blender vide, charger le script dans un espace Python conservé, appeler `build()` puis `bake()`. Exécuter `assemble_atlas.py` avec Python et Pillow, puis appeler `finish()` dans le même espace Blender. Ce dernier exporte les GLB, rend les aperçus et écrit le fichier source. Pour rebaker strictement après modification du matériau final de terre, rendre à nouveau les scènes `bake_1` à `bake_7`, reconstruire l'atlas, recharger l'image et réexporter. Éviter d'appeler deux fois `finish()` sur les mêmes scènes déjà transformées.

Exécuter `blender -b sources/garden-v8.blend --python sources/finalize_source.py` pour finaliser le fichier éditable et son ouverture sur le jardin en L. Exécuter enfin `sources/validate_v8.py` avec Python et Pillow : il retire les facteurs PBR inutilisés de l'exporteur, normalise les suffixes de noms et régénère le manifeste depuis les octets des GLB. Les contrôles livrés vérifient les budgets unitaires et assemblés, les indices, les positions finies, l'absence de triangles dégénérés, les transformations identité, les noms, les matériaux simple face, les textures incorporées et leurs dimensions, et l'étendue correcte du L après application des placements.

Les trois GLB du L ont aussi été réimportés dans Blender et rendus : 6 146, 1 574 et 6 triangles conservés, aspect contrôlé dans `previews/GLB-roundtrip_LOD*.png`. La validation du chargeur Babylon.js, les transitions de LOD et les mesures de cadence sur MX230 restent à effectuer au moment de l'intégration. Aucun code du jeu n'est modifié par ce kit.

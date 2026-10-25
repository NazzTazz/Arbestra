# Kit de jardins Blender — passation à Opus 5.5

Date : 25 octobre 2026. Révision : V7 + marqueur carotte.
Statut : modèles et démonstration préparés dans Blender ; **aucune intégration à Arbestra livrée**.
Point d'entrée : lire cette notice et le manifeste avant de modifier le rendu.

## Fichiers

- `assets/garden-kit.glb` : 21 modèles nommés, incluant les sept stades des carottes. Images de couleur et de normales incorporées.
- `assets/harvest-carrot.glb` : carotte décorative distincte, destinée au marqueur « parcelle pleine / à récolter ».
- `sources/garden-authoring.blend` : source finale, jardin en L, kit caché, animation de croissance/récolte, galerie des stades et gros plan du marqueur.
- `manifest.json` : inventaire extrait des GLB, bornes locales, transformations, triangles, matériaux et SHA-256.
- `reference/demo-schedule.json` : positions de 144 plants et ordre de récolte du seul exemple en L. Coordonnées **Blender**, pas Babylon. Ce n'est pas un générateur de jardins quelconques.
- `previews/` : aspect final du jardin et du marqueur ; comparatif agrandi des stades. Les socles du comparatif ne sont pas des assets du kit.

Les anciennes versions et les scripts incrémentaux de fabrication sont volontairement exclus : ils dépendaient de l'état de la scène et de chemins locaux. Le fichier Blender est la source éditable autonome. Les images y sont empaquetées.

## Direction validée pendant la conception

- Une parcelle occupe 2,5 × 2,5 unités. Les parcelles adjacentes d'un même jardin forment un ensemble.
- Piquets et cordes uniquement sur les côtés exposés, y compris le contour des trous ; aucune clôture entre parcelles du même jardin.
- Planches rustiques de longueurs différentes, légèrement décalées, bouts modestement abîmés, chanfreins discrets. Elles doivent reposer sur la terre sans basculer sur les buttes.
- Buttes étroites, relief marqué et irrégulier, petites mottes.
- Carottes petites et nombreuses : exemple de 3 rangs de 16 plants par parcelle.
- Piquets fins et bas ; corde de chanvre sombre en chaînette.
- Les sept stades et la récolte progressive ont été appréciés. La carotte de marqueur vient d'être proposée ; son aspect n'a pas encore reçu de validation explicite distincte.

## Inventaire et conventions

Les noms hérités ne sont pas des cotes fiables : utiliser le manifeste.

| Nom du nœud | Usage et dimensions actuelles |
| --- | --- |
| `KIT_butte_2m38`, `KIT_butte_naturelle_2..4` | Quatre surfaces de buttes ; longueur réelle 2,48, largeur environ 0,42, relief environ 0,24. Surfaces ouvertes à poser sur le sol, pas volumes fermés. |
| `KIT_planche_rustique_1..6` | Six planches texturées, longueur réelle environ 0,68 à 1,69, épaisseur environ 0,020. Grand axe local X, origine au centre. |
| `KIT_piquet_64cm` | Malgré son nom : hauteur réelle **0,384**, section environ **0,030 × 0,028**. Origine au pied. |
| `KIT_corde_1m25` | Extrémités nominales X=0 et X=1,25 ; points d'attache à hauteur 0,306 ; flèche centrale 0,110 ; rayon 0,0084. Origine au sol sous le départ, pas au centre de la corde. |
| `KIT_motte` | Petite motte irrégulière à instancier sur les flancs. |
| `CAROTTE_01_semis` | Petite marque de semis dans la terre. |
| `CAROTTE_02_cotyledons` | Deux premières feuilles. |
| `CAROTTE_03_jeune` | Jeune pousse à quatre feuilles. |
| `CAROTTE_04_feuillage` | Fanes développées, sans racine orange visible. |
| `CAROTTE_05_racine` | Début de racine visible. |
| `CAROTTE_06_presque_mure` | Croissance intermédiaire avancée. |
| `CAROTTE_07_mure` | Plant mature, 222 triangles. |
| `KIT_carotte_mature` | Ancienne source mature, redondante avec le stade 7. Ne pas les afficher ensemble. |
| `KIT_marqueur_carotte` | Dans l'autre GLB : 2 382 triangles, quatre primitives/matériaux, hauteur 1,421 à échelle 1. Origine à la pointe. Exemple : échelle 0,52 et pointe à 0,72 au-dessus du sol. |

Blender : X/Y au sol, Z vers le haut. GLB exporté : X/Z au sol, Y vers le haut.
Conversion des coordonnées du JSON de démonstration : **(x, y, z) Blender → (x, z, -y) glTF**.
Babylon peut ajouter une racine de conversion lors du chargement glTF dans une scène gauchère. Conserver cette conversion ou la traiter explicitement ; ne pas appliquer deux fois une inversion d'axe. Vérifier avec une parcelle asymétrique et les cordes.

Les objets du kit sont superposés à l'origine par conception. Charger un conteneur de sources, ne pas afficher le conteneur entier comme un jardin.

## Assemblage d'une géométrie quelconque

### 1. Sol et regroupement

Partir des cellules canoniques et de l'identité du jardin fournies par le jeu. Respecter les frontières entre jardins différents et la topologie torique existante. Une identité de jardin peut contenir plusieurs composantes : traiter chaque composante sans inventer de liaison.

Le kit ne contient pas de socle universel. Générer la surface du sol à partir de l'union des cellules. Le socle en L visible dans Blender est un exemple, pas un asset à étirer. Ne pas créer de parois internes ou de faces coplanaires superposées aux jonctions. Réutiliser les hauteurs du terrain existant.

### 2. Clôture périphérique

Algorithme de référence, à adapter aux coordonnées canoniques du dépôt :

```text
pour chaque cellule c du jardin :
    pour chacun des quatre côtés de c :
        si la cellule voisine n'appartient pas au même jardin :
            émettre ce côté exposé

pour chaque côté exposé de longueur 2,5 :
    créer deux segments de corde de longueur 1,25
    demander les piquets aux deux extrémités et au milieu
dédupliquer les piquets par position canonique du sommet
```

On obtient naturellement coins convexes, coins rentrants et trous, sans module d'angle spécifique.
Exemple en L : cellules (0,0), (1,0), (0,1), aire 18,75, périmètre 20, 8 côtés de cellule exposés, 16 cordes et 16 piquets.
Orienter chaque corde par son axe X vers l'extrémité, en conservant sa hauteur locale déjà incluse.

Le segment actuel est une chaînette horizontale : y = 0,306 + a × [cosh((x-L/2)/a) - cosh(L/(2a))], avec L=1,25 et a=1,80, en coordonnées glTF locales.
Pour une portée ou des hauteurs différentes, recalculer la courbe et les attaches ; un étirement arbitraire peut déformer son épaisseur. Les raccords sur terrain en pente **restent à réaliser et à vérifier**.

### 3. Rangs, passages et mottes

Orientation unique par jardin pour aligner les rangs entre parcelles. Dans le prototype Blender, les rangs suivent X ; leurs centres dans une parcelle sont Y=0,43, 1,25 et 2,07. Les passages sont centrés vers Y=0,84 et 1,66.

Instancier une des quatre buttes par rang avec un choix déterministe basé sur la cellule et le rang. Les extrémités s'atténuent vers le sol. Une meilleure jonction continue entre segments reste possible à l'intégration ; ne pas prétendre que les extrémités actuelles sont une surface soudée.

Remplir les passages avec un mélange de longueurs de planches. Les joints peuvent traverser les frontières de parcelles, sans imposer une coupure tous les 2,5. Clipper les passages à la forme du jardin et aux trous.
Conserver les variations discrètes de translation latérale et de rotation ; les planches doivent rester dans le passage. Placer leur face inférieure au sol (démonstration : marge 0,001) et contrôler leur appui sur terrain réel. Ne pas laisser de porte-à-faux ni de chevauchement coplanaire.

Placer les carottes sur le **profil réel de la butte**, pas toutes à une altitude constante. Conserver la même position et la même variation d'échelle/orientation aux changements de stade. Utiliser une graine stable pour éviter les déplacements après rechargement.
Les mottes suivent aussi la surface des buttes ; ne pas les laisser flotter après redimensionnement.

### 4. États visuels et récolte

Dans le code existant, `tile-appearance.ts: gardenTileStage()` mesure le **stock**, pas l'âge biologique :
- pleine ou stock >= capacité : stade 7 ;
- stock vide / capacité nulle : stade 1 ;
- sinon : min(6, 2 + floor(stock/capacité × 5)).
Le stade 0 est réservé au chantier dans le renderer. Aucun modèle de chantier complet n'est livré ici.

Associer les modèles 1 à 7 à ces valeurs est une possibilité de rendu, pas une nouvelle mécanique validée.
Ne pas inventer des dates de semis, une croissance autonome côté client ou une consommation supplémentaire.

La démonstration Blender fait grandir toutes les parcelles, puis retire un plant par image à partir de l'image 241 :
- 1–32 : semis ; puis un stade toutes les 32 images ; maturité à 193 ;
- parcelle A à 241, B à 289, C à 337 ; tous les plants retirés à 384 ;
- timeline 1–408 à 24 images/s. **Durées purement illustratives**.

Dans le jeu, relier le retrait progressif aux données réelles de récolte et au stock autoritaire. Vérifier quand le stock est réservé/décrémenté et quels champs décrivent le travail en cours ; un stock réservé instantanément ne doit pas obliger à effacer tout le jardin à l'instant du clic.
Le choix exact entre représentation du stock et progression visuelle doit être documenté et validé s'il modifie le sens de l'indicateur.
Ne jamais créditer de ressources depuis une animation.

Le fichier Blender contient 7 apparences par plant avec échelles animées pour faciliter la revue (1 008 objets). **Ne pas reproduire cette organisation en production.** N'instancier que le stade visible, en partageant géométries et matériaux. Le JSON décrit l'ordre en serpentin à l'intérieur de chaque parcelle.

### 5. Marqueur de récolte

Le code actuel affiche un disque et une tige par parcelle pleine. Conserver cette portée par parcelle pendant la première intégration ; un marqueur unique par jardin serait une décision différente.
Remplacer les deux éléments par la carotte indépendante, sans en faire une carotte récoltable.
Conserver le comportement non sélectionnable du marqueur.

Dans la démo : marqueurs visibles à 193 ; disparition aux premières récoltes de leurs parcelles (241/289/337). En production, utiliser la condition réelle de disponibilité/plein, pas les numéros d'images.
Les trois marqueurs partagent la même géométrie. Éviter une lumière ou un matériau unique par marqueur.
Le modèle détaillé peut nécessiter une variante distante : aucune performance en grand village n'a encore été mesurée.

## Points d'entrée du dépôt

- `apps/world-web/src/scene/garden-plots.ts` : sources instanciées, sol/surface et disque actuel.
- `apps/world-web/src/scene/BabylonVillageScene.ts` : création des parcelles et actualisation des états.
- `apps/world-web/src/scene/tile-appearance.ts` : état visuel depuis le stock.
- `apps/world-web/src/scene/resource-factory.ts` : ancienne carotte du marché, palette de référence.
- `apps/world-web/src/scene/building-assets.ts` et `building-asset-format.ts` : chaîne des bâtiments .abmesh.gz.
- `apps/world-web/src/scene/garden-plots.test.ts` et `tests/e2e/garden-plots.spec.ts` : tests existants.
- `docs/SPEC-TUILES-TERRAIN-JARDIN.md` : sens des images et séparation économie/rendu.

Les GLB ne sont **pas** des .abmesh.gz. Le package world-web examiné ne déclare pas `@babylonjs/loaders`. Vérifier l'état courant et choisir explicitement un chargeur glTF aligné sur la version Babylon installée, ou une conversion vers la chaîne existante. Ne pas renommer simplement l'extension.
Les fichiers sous blender-elements ne sont pas servis automatiquement par Vite : publier les seuls assets nécessaires dans un emplacement public adapté lors de l'intégration.

## Validation attendue d'Opus

1. Lire les instructions du dépôt, le handoff et l'état Git réel avant modification.
2. Charger les sources une seule fois ; vérifier axes, noms, PBR, faces de feuillage et textures embarquées.
3. Tester cellule seule, rectangle, L, trou, jardin disjoint, frontière entre deux jardins et raccord torique.
4. Vérifier qu'aucun côté interne n'a de corde, que les piquets ne doublonnent pas, et que le sol ne scintille pas.
5. Tester croissance/stock et récolte indépendants par parcelle, rechargement en cours de récolte, changement de caméra et sélection.
6. Vérifier appui des planches, racines et mottes sur le relief, notamment aux frontières de parcelles.
7. Mesurer appels de dessin, mémoire et cadence sur grand jardin ; prévoir simplification/LOD si nécessaire. Les primitives de plusieurs matériaux peuvent produire plusieurs appels par modèle.
8. Faire une revue visuelle dans Babylon avant toute affirmation de parité avec Blender.

## Preuves et limites de cette livraison

- Rendus Blender inspectés au fil des corrections.
- Comptages de la démo vérifiés : 144 plants jusqu'à maturité, 96 à l'image 288, 48 à 336, 0 à 408.
- Marqueurs vérifiés : 0 à 144, 3 à 208, 2 à 241, 1 à 289, 0 à 337.
- Faces inférieures des 12 planches au niveau 0,001 dans le prototype final.
- GLB analysés pour les noms, primitives, triangles, bornes et images incorporées ; empreintes dans manifest.json.
- Pas de validation de chargement Babylon, pas d'intégration, pas de benchmark, pas de déploiement.

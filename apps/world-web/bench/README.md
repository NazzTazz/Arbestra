# Banc chevaux : squelettes classiques ou animation précalculée en texture

Page de développement, absente du build : `vite.config.ts` ne déclare que `index.html` et `factory-preview.html` comme entrées. Elle sert à décider comment animer de nombreux chevaux, puis demain des chevaliers montés et des armées.

## Lancer

```bash
corepack pnpm --filter @arbestra/world-web dev
```

Puis ouvrir `http://localhost:5174/bench/chevaux.html` dans Chrome, **onglet au premier plan et fenêtre visible pendant toute la passe** (environ 10 minutes). Un onglet masqué est ralenti à une image par seconde, et le GPU baisse alors sa fréquence.

Paramètres d'URL :
- `?gpu=low` : préférer la puce intégrée (par défaut : haute performance) ;
- `?modes=texture` ou `?modes=squelette` : ne mesurer qu'une méthode ;
- `?rapide` : sous-ensemble court ;
- `?mesure=8` et `?chauffe=5` : durées en secondes ;
- `?voir=texture,lod1,300,moyen` : affiche une configuration sans mesurer ;
- `?voir=brut,lod0,Walk` : le modèle tel que chargé, pour diagnostic.

Résultats : tableau affiché sous la vue, et `window.__banc` (JSON).

## Méthodes comparées

- **Squelette** : chaque cheval a son squelette (50 os) et son groupe d'animation glTF (`instantiateModelsToScene`).
- **Texture** : un seul exemplaire du modèle. Les matrices d'os du pas et de l'attente sont précalculées dans une texture, à 30 images par seconde. Chaque cheval est une *thin instance*, avec son début, sa fin, son décalage et sa cadence d'animation (`BakedVertexAnimationManager` de Babylon 8.56).
  - Le précalculateur intégré de Babylon ne pilote que des animations portées par le squelette. Le banc pilote donc lui-même les groupes d'animation glTF, image par image, et copie `skeleton.getTransformMatrices()`.
- **Niveaux de détail** : lod0 (2 182 triangles), lod1 (500), lod2 (150), simplifiés dans Blender.

Mesures par essai, après la chauffe :
- temps processeur de `scene.render()` ;
- temps GPU, par la requête de minutage WebGL2 (disponible dans Chrome sur cette machine) ;
- intervalle entre images (plafonné à 60 i/s par la synchronisation verticale) ;
- temps complet d'une salve de 40 rendus synchronisés par lecture d'un pixel ;
- appels de dessin ;
- triangles, en comptant les *thin instances*.

## Résultats : MX230, Chrome, 25 octobre 2026

Machine : Intel Core i7-1065G7, NVIDIA GeForce MX230 (Direct3D 11 via ANGLE). Passe 1, mesures de 8 s. Données brutes : `resultats/passe-1-mx230.json`.

### Processeur par image, la mesure la plus robuste

| Chevaux | Squelette (lod0) | Texture lod0 | Texture lod1 | Texture lod2 |
|---:|---:|---:|---:|---:|
| 50 | 28 ms | 2,3 à 2,8 ms | voir ci-dessous | voir ci-dessous |
| 100 | 64 à 76 ms | 2,6 ms | 0,9 à 1,7 ms | 1,7 à 3,2 ms |
| 300 | **125 à 282 ms** | **3,1 à 3,7 ms** | **1,1 à 1,3 ms** | 2,3 à 4 ms |
| 600 | **201 à 323 ms** | 3,0 à 4,2 ms | 2,8 à 7,5 ms | 4,5 à 5 ms |

### GPU par image et images par seconde

| | Squelette (lod0) | Texture lod0 | Texture lod1 |
|---|---|---|---|
| 300 chevaux | 26 à 70 ms GPU, **3 à 8 i/s** | 4 à 12 ms GPU | **1,4 à 1,6 ms GPU, 60 i/s** |
| 600 chevaux | 53 ms GPU, 3 à 5 i/s | 11 ms GPU | 2,4 à 7,5 ms GPU, 30 à 60 i/s |

- **Appels de dessin** : 7 par cheval en squelette, soit 2 089 pour 300 chevaux (un maillage par matériau). En texture, 7 au total, plus le sol, quel que soit le nombre de chevaux.
- **Préparation** : le précalcul prend environ 0,1 à 0,6 s par modèle ; la texture pèse 439 Ko (50 os, pas et attente).

### Fiabilité

- **Les temps processeur sont fiables**, et ils suffisent à trancher. Avec des squelettes, 100 chevaux saturent déjà le processeur de cette machine.
- **Les temps GPU de la passe 1 sont plausibles mais à confirmer.** Quelques lignes sont perturbées :
  - le premier chargement d'un niveau de détail tombait dans la chauffe (lod1 et lod2 à 50 chevaux) ; c'est corrigé, tous les modèles sont désormais préchargés ;
  - des pics isolés (texture lod0 à 300 en vue moyenne, lod2 à 600).
- **La passe 2 (texture seule) est invalide** et n'a pas été conservée : l'onglet est passé en arrière-plan, et les images arrivaient toutes les 1 014 ms.
- Les variantes texture lod1 et lod2 ont des trous de simplification. Le temps mesuré est juste, l'aspect non : une simplification soignée reste à faire avant le jeu.

## Conclusion

À 300 chevaux, avec le même modèle complet, l'animation précalculée en texture est **35 à 90 fois moins coûteuse en processeur** que les squelettes classiques : 3,1 à 3,7 ms contre 125 à 282 ms. Elle ramène les appels de dessin d'environ 7 par cheval à 7 au total. Avec le niveau de 500 triangles, **300 chevaux tiennent à 60 i/s sur la MX230** avec environ 1,5 ms de GPU.

Le squelette classique n'est pas viable au-delà de quelques dizaines d'unités sur cette machine. **Recommandation** : animation précalculée en texture avec *thin instances* pour toute unité animée nombreuse, et niveaux de détail selon le zoom.

## Points relevés en route

- **Le fichier d'origine de Quaternius**, exporté par FBX2glTF, a un squelette **mal lu par Babylon** : le maillage est déformé même au repos. Réexporté par Blender (`assets/cheval-lod0.glb`), il s'affiche correctement. Tous les modèles animés devront donc passer par l'exporteur glTF de Blender.
- **Le modèle a 7 matériaux**, donc 7 maillages chez Babylon. Pour le jeu, il faudra les fusionner en un seul matériau à couleurs de sommets, ce qui donnera un appel de dessin par niveau de détail.

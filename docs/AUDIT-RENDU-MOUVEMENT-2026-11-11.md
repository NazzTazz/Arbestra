# Audit du rendu en mouvement — 11 novembre 2026

Audit en lecture seule (Fable), base `0d9ca9e`, `@babylonjs/core` 8.56.2. Complète l'[audit des mécanismes natifs de Babylon](AUDIT-BABYLON-NATIF-2026-10-31.md). Les passages **[Inférence]** sont des déductions ; le reste a été lu dans le code. Trois constats revérifiés après coup : `engine.maxFPS = 45` (`BabylonVillageScene.ts:1355`), dégel de tous les matériaux au premier brasero sans regel (`village-braziers.ts:464`), rebasage de l'origine à chaque changement de chunk (`world-space.ts:35-42`).

## Symptôme mesuré (11 novembre, dev local, Bressuire, MX230, fenêtre visible)

- Caméra immobile : 45 images par seconde (plafond `maxFPS`), rendu natif environ 4 ms.
- Petits déplacements : 35 à 47 images par seconde, ressenti fluide.
- Grand déplacement ou rotation : moins de 20 images par seconde ; sur 60 s, p95 90,7 ms, 11 images au-delà de 100 ms, pire 208 ms.
- Image en mouvement (moyenne / maximum, ms) : rendu principal CPU 47,4 / 80,2, dont sélection des meshes 13,7 / 22, dessin Babylon 23,7 / 44,6, particules 4,2 / 11 ; visibilité / vue régionale 4,6 / 8,2 ; création des meshes du terrain 0 / 0,5 ; GPU 41,2 / 66,5. 317 draw calls, 463 meshes actifs, 3 696 résidents.
- Familles (actifs / total, sommets) : factory 425/1 058, 791 k ; university 64/125, 228 k ; infrastructure-border 32/32, 221 k ; regional-village-silhouette 119/119, 122 k ; stonemason 11/25, 80 k ; brazier-masonry 117/117, 22 k ; rc1-ground-unit 79/79, 8 k.

Le terrain n'est pas en cause. Le sondage des chunks visibles toutes les 5 s (`freshnessMs`) coûte environ 5 ms ; son effet de bord sur `featureVersion` est corrigé par `0d9ca9e`.

## Résumé

1. Rien n'est sauté à l'arrêt : `scene.render()` tourne à chaque image (`:1844`), sans `freezeActiveMeshes` ni rendu à la demande ; la scène est plafonnée à 45 i/s (`:1355`).
2. Aucun chemin GPU ne dépend de la vitesse de la caméra : les 41 ms GPU sont **[Inférence]** probablement aussi présentes à l'arrêt au même point de vue. Première cause du « moins de 20 i/s » : 1,4 M sommets actifs, 317 draw calls dont environ 117 systèmes de particules la nuit, éclairage clusterisé, rendu à 1/1,2 de la résolution. Les 23,7 ms de « dessin Babylon CPU » sont **[Inférence]** surtout de l'attente de la file GPU.
3. Les images au-delà de 100 ms viennent de pics CPU déclenchés par le déplacement : rebasage de l'origine à chaque frontière de chunk, reconstruction de la nappe régionale tous les 16 cases, bascules de LOD sans hystérésis.
4. Un travail proportionnel au nombre de meshes est fait à chaque image : boucle de visibilité avec `getChildMeshes()` sur tous les bâtiments et leurs trois variantes LOD, `renderer.meshes()` reconstruit, 117 `ParticleSystem` CPU, matrices d'instances renvoyées à chaque image, matériaux dégelés depuis le premier brasero.
5. Les LOD existent mais sont à peine plus légers : `dwelling-1-finished` 324 ko, `-lod1` 289 ko, `-lod2` 270 ko (−17 %).

## Causes classées par gain attendu

### 1. Charge GPU structurelle (environ 41 ms par image)

- **Preuve** : GPU 41,2 / 66,5 ms ; familles lourdes ci-dessus ; `setHardwareScalingLevel(max(1.2, dpr / 1.5))` (`:1356`) ; éclairage clusterisé (`village-braziers.ts:64`) dont le passage de masque de tuiles est rendu à chaque image et dont `_updateLightData` trie les 117 lumières par image ; un draw par `ParticleSystem` (`village-braziers.ts:424`) ; jusqu'à 119 meshes de villages régionaux non instanciés (`regional-villages.ts:147-176`).
- **Correction bornée** : (a) résolution dynamique, `setHardwareScalingLevel(1.5)` pendant le mouvement, retour à 1,2 après environ 300 ms d'immobilité ; (b) un seul `ParticleSystem` avec `CustomParticleEmitter` pour toutes les flammes (déjà n° 1 de l'audit du 31 octobre) ; (c) `Mesh.MergeMeshes` par village régional.
- **Gain attendu** : **[Inférence]** −10 à −15 ms GPU pour (a), −116 draws pour (b), environ −100 draws pour (c).
- **Risque visuel** : léger flou en mouvement seulement ; flammes synchrones si l'émetteur n'est pas randomisé ; aucun pour (c).
- **À vérifier d'abord** : GPU à l'arrêt au même point de vue ; A/B par familles et sans particules dans le laboratoire DEV (`render-lab.ts:78`).

### 2. Rebasage de l'origine à chaque frontière de chunk (pics au-delà de 100 ms)

- **Preuve** : `#wrapCamera` (`:4529-4577`) appelé à chaque image (`:1704`) ; il déplace puis regèle tous les `#villageMeshes` (`refreshStaticHierarchy`), tous les chunks de terrain (`terrain-renderer.ts:514-521`), la nappe régionale, puis relance voirie, braseros (117 maçonneries regelées), jardins (40 parcelles), villages régionaux et infrastructure, via `space.version`.
- **Coût** : **[Inférence]** 50 à 200 ms par traversée, cohérent avec le pire relevé (208 ms).
- **Correction bornée** : une racine commune déplacée seule au rebasage, sans regel de chaque hiérarchie ; ou relance voirie, braseros et jardins étalée sur plusieurs images ; ou pas de rebasage plus grand.

### 3. Nappe régionale reconstruite et réajustée pendant le déplacement

- **Preuve** : `RegionalOverview.update` (`terrain-overview-view.ts:184-301`) reconstruit 81 × 81 sommets dès que la cible change de bloc de 16 cases, puis réajuste jusqu'à 4 000 sondes `store.ground()` par image (`:41`, `:449-476`) et renvoie toutes les positions à chaque image tant que la file n'est pas vide (`:479`) ; recoloration de 6 561 sommets toutes les 400 ms (`:507-550`).
- **Correction bornée** : budget de sondes plus petit ou différé tant que la caméra bouge ; envoi de la seule sous-plage touchée.

### 4. LOD des bâtiments sans hystérésis et presque aussi lourds

- **Preuve** : un observateur `onBeforeActiveMeshesEvaluationObservable` par bâtiment (`building-lod.ts:52-86`) ; seuils uniques `near 45 / far 28` (`building-lod-settings.ts:6`) sans marge ; variantes à 83 % du poids de la plus détaillée.
- **Correction bornée** : hystérésis (par exemple entrer en lointain sous 28, revenir au-dessus de 34) ; un observateur unique ; un vrai `lod2` décimé au bake (murs pleins, toit en deux pans), hors client.
- **Gain attendu** : **[Inférence]** GPU −30 à −50 % sur la famille `factory` avec un vrai LOD lointain.

### 5. Taxes CPU par image proportionnelles au nombre de meshes

- Boucle de visibilité (`:1758-1767`) avec `getChildMeshes()` sur chaque racine et `renderer.meshes()` reconstruit (`:1769`) : mesurée 4,6 / 8,2 ms ; à piloter par événement (déjà signalé le 31 octobre, §7).
- 117 `ParticleSystem` CPU : 4,2 / 11 ms la nuit (voir 1 b).
- Matrices d'instances renvoyées à chaque image (aucun `freezeActiveMeshes`, `mesh.js:1720-1723`) : **[Inférence]** 3 à 8 ms ; `freezeActiveMeshes` avec culling conservé, ou `manualUpdateOfWorldMatrixInstancedBuffer` par source, à mesurer avant.
- Matériaux dégelés par le premier brasero (`village-braziers.ts:464`), jamais regelés : `isReadyForSubMesh` complet par sous-mesh et par image ; regeler une image après la compilation du type de lumière. **[Inférence]** 1 à 3 ms.
- Sélection des meshes 13,7 / 22 ms : inclut les 70 observateurs LOD et les `getLOD` des bosquets ; à comparer avec la valeur à l'arrêt.

### 6. Demande de terrain et chaîne voirie relancées toutes les 100 ms en mouvement

- **Preuve** : signature caméra (`:5347-5357`) → `renderer.demand()` ; `version++` à tout changement de masque relance `#updateTravelPaths` (`:3733`), et `InfrastructureRenderer.update` sérialise le plan à chaque appel avant son retour anticipé (`infrastructure-renderer.ts:230-249`).
- **Correction bornée** : ne pas relancer `#updateTravelPaths` sur le seul masque caméra ; mettre la clé du plan en cache.

Non retenus après lecture : `fogStart/fogEnd` réécrits à chaque image, animation de l'eau, picking au survol (déjà court-circuité), `GlowLayer` (scène monde seulement).

## Plan proposé (tranches de performance P1 à P4)

| Tranche | Contenu | Mesure de validation |
|---|---|---|
| P1 — Taxes par image et mesure | Visibilité par événement, cache de `renderer.meshes()`, voirie découplée du masque caméra ; GPU et sélection à l'arrêt, rebasages et bascules LOD par minute dans l'overlay | Visibilité < 0,5 ms ; voirie ≈ 0 en mouvement sans terraformation ; GPU à l'arrêt relevé |
| P2 — GPU | Résolution dynamique en mouvement, flammes en un seul système, villages régionaux fusionnés | GPU en mouvement < 22 ms p95, draw calls < 200 la nuit, ≥ 30 i/s en rotation |
| P3 — Pics de déplacement | Racine commune au rebasage, relances étalées, réajustement de la nappe différé | 4 frontières de chunk traversées en 60 s : aucune image > 100 ms |
| P4 — LOD des bâtiments | Hystérésis, observateur unique, `lod2` décimé au bake | Sommets `factory` actifs ≤ 30 % à grande distance ; recette visuelle à 3 distances |

Optionnel, après P1 à P4 et seulement si la sélection reste au-delà de 5 ms : `freezeActiveMeshes` avec regel différé, ou pièces de bâtiments en thin instances.

## Limites de ce matériel

- **[Inférence]** Même corrigée, la MX230 restera vers 25 à 35 ms GPU tant que le LOD lointain n'est pas décimé et la résolution abaissée : viser 30 i/s stables en mouvement, pas 60.
- Le plafond `maxFPS = 45` borne la fluidité à l'arrêt ; le relever sans P2 alourdirait la charge GPU.
- Les 117 lumières de nuit restent un coût par fragment ; réduire les feux proches simultanés est un levier de dernier recours, avec effet visuel.

Vérifications manuelles restantes : GPU à l'arrêt au même point de vue ; A/B par familles dans le laboratoire DEV ; nombre réel de rebasages lors d'un grand déplacement (`canvas.dataset.terrainStreaming.origin`).

## Mesures après P1 et P2 (11 novembre, Tristan, MX230, Bressuire de nuit)

Commits : `2c4e98a` (P1), `704be7b` (P2 : flammes en un seul système de particules, résolution réduite pendant le mouvement), `15f230a` (LOD mesuré à la résolution du repos : la résolution réduite faisait basculer les bâtiments, 14 274 bascules par minute et l'HDV qui clignotait), `5834d00` puis `4408365` (variantes moyenne et lointaine de l'HDV 2 : matériaux du marché perdus à la fusion, puis textures vides des copies ; rebake), `61f14f9` (feux de bâtiment qui suivent leur bâtiment : les « braseros fantômes »).

| Mesure (overlay, 60 s après « Réinitialiser ») | Avant | Après |
|---|---|---|
| Cadence en rotation (second passage) | < 20 i/s | ≥ 30 i/s |
| Images > 100 ms / > 200 ms | 11 / 1 | 14 / 0 |
| Pire image | 208 ms | 146 ms |
| Appels de dessin | 317 | 159 |
| GPU moteur, moyenne | 41,2 ms | 18,2 ms |
| Rendu principal CPU, moyenne | 47,4 ms | 31,4 ms |
| Particules CPU | 4,2 ms | 0,3 ms |
| Visibilité / vue régionale | 4,6 ms | 0,1 ms |
| Bascules LOD / rebasages | — | 282 / 0 |

Restent : la première rotation (8 i/s pendant que le terrain s'intègre et que les bâtiments rendent leurs variantes pour la première fois), et 282 bascules LOD en une minute sans rebasage (oscillation autour des seuils, hystérésis de P4). Le budget d'AGENTS.md (aucune image au-delà de 100 ms une fois le village prêt) n'est pas encore tenu.

## P4, première partie : hystérésis du LOD et observateur unique (`3f42e67`)

Mesure navigateur du 11 novembre, faite par l'agent dans son propre onglet Chrome (fenêtre au premier plan), Bressuire, `rc1-dev`. La rotation est un glisser scripté : événements de pointeur à chaque image, 4 px par image pendant 8 s. Les conditions ne sont pas celles des relevés manuels de Tristan, donc à comparer entre elles seulement.

| Passage (8 s) | i/s | p95 | Pire image | > 100 ms | Bascules LOD |
|---|---|---|---|---|---|
| Au repos (5 s) | 60 | 17 ms | 36 ms | 0 | 0 |
| Première rotation après chargement, essai 1 | 27 | 67 ms | 100 ms | 0 | 87 |
| Première rotation après chargement, essai 2 | 33 | 50 ms | 68 ms | 0 | 97 |
| Seconde rotation (après 10 s de pause) | 60 | 17 ms | 33 ms | 0 | — |
| Troisième rotation | 54 | 33 ms | 50 ms | 0 | 158 |
| Zoom à la molette, avant puis arrière (6 s) | — | 19 ms | 28 ms | 0 | 55 |

**Première rotation.** Ventilation de l'overlay, moyenne / maximum sur des fenêtres de 2 s :

| Poste | Moyenne | Maximum |
|---|---|---|
| Rendu principal CPU | 19 ms | 31 à 36 ms |
| Sélection des meshes | 8,6 ms | 18 ms |
| Dessin Babylon | 9,4 ms | 22 ms |
| Création des meshes de terrain | 3 à 4 ms | 16 à 24 ms |
| Chemins automatiques de la voirie | 2,6 ms | 11 à 24 ms |
| Sélection et requêtes du terrain | 1 à 2 ms | 8 à 11 ms |
| Caméra et transitions | — | 12 ms |

Compilations de shaders : 0. Meshes actifs : 400 à 520, contre 370 au repos. Appels de dessin : 180 à 234.

La première rotation n'a donc pas de coupable unique : un rendu plus chargé, car la caméra découvre des meshes, auquel s'ajoutent les images où le terrain crée des chunks et où la voirie recalcule ses chemins automatiques. Les longues images de plus de 50 ms viennent toutes de la boucle de rendu de Babylon. La première apparition des variantes LOD ne coûte rien de visible : aucune compilation de shader. Pistes pour la suite :
- étaler la création des meshes de terrain et le calcul des chemins automatiques, avec un budget par image ;
- réduire les meshes actifs : fusion des bâtiments lointains, P3.

**Bascules LOD.** La profondeur utilisée est celle de l'axe de visée. En rotation, chaque bâtiment change donc de profondeur, et les bascules restantes sont pour l'essentiel de vrais franchissements de seuil, pas des oscillations. La marge de 10 % supprime les allers-retours (test de régression). Pour aller plus loin, il faudrait mesurer la distance à la caméra plutôt que la profondeur, ce qui changerait le choix au repos. À décider si ces bascules restent visibles.

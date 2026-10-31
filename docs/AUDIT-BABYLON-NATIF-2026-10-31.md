# Audit : mécanismes natifs de Babylon à préférer au code maison — 31 octobre 2026

Étude en lecture seule (commit `2c6f9cc`). Versions : `@babylonjs/core` et `@babylonjs/loaders` 8.56.2 ; ni `@babylonjs/addons`, ni inspector, ni Recast installés (`@babylonjs/addons@8.56.2` et `@recast-navigation/core` 0.44.0 publiés). Les passages **[Inférence]** ne sont pas mesurés ; « à vérifier » signale un point non confirmé.

## 0. Constat général

La pile native est déjà largement utilisée : thin instances (11 fichiers), `InstancedMesh` (bâtiments, braseros, ombres de contact, `BabylonVillageScene.ts:4476`), `AssetContainer.instantiateModelsToScene` (`building-assets.ts:32`), `ClusteredLightContainer` (`village-braziers.ts:64`), `MaterialPluginBase` (halos, fondu du terrain, météo), `material.freeze()` et `freezeWorldMatrix`, brouillard linéaire, `SceneInstrumentation`/`EngineInstrumentation` avec minutage GPU, `skipPointerMovePicking`, `GlowLayer`, `CreateDecal`, `addLODLevel` sur les bosquets. Les écarts sont ciblés : feux, villageois, sol, teinte de démolition, contours ; la navigation est un cas à part (pertinent côté serveur).

Mesures déjà documentées : GPU limitant sur la MX230 (70 à 120 ms par image au repos, ~620 appels de dessin, ~300 `bufferSubData`, `HANDOFF-ARCHIVE-2026-10-30.md:302`) ; retirer les lumières faisait passer le GPU de 52-68 ms à 28 ms le 7 octobre (`AUDIT-RENDU-3D-2026-10-07.md:49`) ; villageois ~2,2 ms CPU par image (budget 2 ms).

## 1. Navigation et déplacement

**Code maison.** A* sur grille de 0,2 m pour les connecteurs de chantier (`worksite-layout.ts:17-60`, `village-workers.ts:1437-1467`), ligne droite « fantôme » après 4 échecs (`:1464`) ; connecteurs de porte géométriques (`building-plan.ts:661+`) ; évitement `WorkerTraffic` par réservation de passages (`worker-motion.ts:219+`) ; `WorkerObstacles` sans pente ni eau. Position asservie à l'horloge serveur (`village-workers.ts:843-853`).

**Natif.** `RecastJSPlugin` du cœur (paquet `recast-detour` non maintenu : à exclure) ; navigation V2 de `@babylonjs/addons` (`CreateNavigationPluginAsync`, `RecastNavigationJSPluginV2`, sur `@recast-navigation/*` en WASM) avec tile cache et obstacles dynamiques, coûts par zone (`QueryFilter`), fonctionnement serveur documenté avec `NullEngine`. Hors Babylon : `recast-navigation-js` (Web et Node, DetourCrowd) ; `navcat` (JavaScript pur, tuiles ; support Node à vérifier).

**Ce qui conviendrait.**
- Serveur : navmesh tuilé comme représentation physique unique (Recast/Detour sous Node, sans Babylon), directions 4 et 5 du [diagnostic](DIAGNOSTIC-NAVIGATION-2026-10-31.md). Pente 0,25 → `walkableSlopeAngle` ≈ 14° ; eau → aire nulle ; routes et jardins → coûts d'aire ; troncs → aire nulle ou obstacles cylindriques ; charrettes et convois → un navmesh par profil. « Inaccessible » y a un sens physique (graphe de polygones), au lieu de « hors budget ».
- Client : requêtes Detour pour les seuls connecteurs de chantier (petit navmesh local), à la place de l'A* et de la ligne fantôme.

**Ce qui ne conviendrait pas.**
- DetourCrowd pour les trajets : il pilote des vitesses alors que le client doit arriver à l'échéance serveur ; **[Inférence]** positions divergentes entre clients, tests déterministes cassés. Acceptable pour la flânerie (`idle-tour.ts`) ; `WorkerTraffic` reste adapté au contrat temporel.
- Tore : Detour ne raccorde pas les bords ; repère local déroulé à l'échelle du village, hiérarchie par chunks au-dessus pour le commerce ; tuiles de couture dupliquées **non prouvées**.
- Échelle : demi-largeur 1/16 de case → voxel ≤ 1/16, ~32 768 voxels de côté sur 2 048 cases ; **[Inférence]** ~16 000 tuiles, limite des `dtPolyRef` 32 bits (à vérifier) → navmesh par région ou par village.
- Déterminisme : **[Inférence]** WASM reproductible à entrée et ordre identiques ; les chemins futurs changeraient (les chemins persistés restent figés).
- Chemins à angle libre contre primitive cardinale et durée en Manhattan (`travel-paths.ts:586-601`) : décision de game design ouverte.
- Coût et risque élevés : prototype avant toute décision.

## 2. Rendu de nombreuses instances

- **Villageois** : chaque pièce est un `clone()` (`village-workers.ts:711`, `:729`), donc un appel de dessin distinct ; 7 à 8 pièces par personne (`worker-figure.ts:75-91`), 6 à 9 `TransformNode` animés par image, contours `enableEdgesRendering`. Natif : (A) `createInstance` par pièce avec couleur par instance (`registerInstancedBuffer('color', 4)`) → ~15 appels de dessin au total ; visibilité partagée par la source, fondu par alpha d'instance ; coût faible à moyen, gain CPU nul. (B) VAT (`BakedVertexAnimationManager`, `VertexAnimationBaker`) + thin instances → 1 à 3 appels de dessin, seule voie qui règle aussi les 2,2 ms CPU ; exige un villageois skinné et des clips (Blender), sans mélange ; coût élevé.
- **Feux de braseros** (écart le plus net) : un `ParticleSystem` CPU par brasero (`village-braziers.ts:424`, ~250 feux), chacun avec appel de dessin, mise à jour CPU et `bufferSubData` par image la nuit, sans culling ; `emitRate` réécrit à chaque image (`:549`). **[Inférence]** une bonne part des ~300 `bufferSubData`. Natif : (a) un seul `ParticleSystem` avec `CustomParticleEmitter` (un appel, un tampon) ; (b) flamme en quad billboard en thin instances avec feuille de sprites dans un shader (zéro CPU par image). `GPUParticleSystem` ne réduit pas les appels. Coût faible.
- **Sol** : un `Mesh` par unité de 4 × 4 cases (`rc1-terrain.ts:137-159`), jusqu'à ~576 maillages avant culling ; **[Inférence]** grosse source d'appels de dessin, non mesurée par couche. Natif : `Mesh.MergeMeshes` par chunk, refait au chunk modifié, ou mise à jour de sous-plage (`VertexBuffer.updateDirectly`). Coût moyen.
- **LOD des bâtiments** : maison à trois niveaux (`building-lod.ts:19-91`) ; `addLODLevel` est par maillage, sans hiérarchie ni identité stable pour le picking : **à garder**.
- **Bosquets** : thin instances par pièce et par bosquet (`BabylonVillageScene.ts:3103`) ; regrouper par chunk réduirait les appels (optimisation interne).
- **Octree, `freezeActiveMeshes`** : conflit avec la surcharge `getActiveMeshCandidates` et le streaming ; gain incertain, pas à prioriser.

## 3. Terrain

`CreateGroundFromHeightMap`, DynamicTerrain et CDLOD **ne conviennent pas** (RC1 : terrasses verticales, triangles d'eau, découpage irrégulier, `rc1-terrain.ts:90-136`). Picking du sol par `pickWithRay` (`BabylonVillageScene.ts:2423`), au clic seulement. Seule action native utile : la fusion par chunk (§2).

## 4. Matériaux, effets et contours

- **Teinte de démolition** (`demolition-tint.ts:56-157`) : clones de maillages et de matériaux, dégel, originaux masqués. Natif : `renderOverlay` + `overlayColor`/`overlayAlpha` (pulse en O(1)), `HighlightLayer` (stencil déjà actif, `:1338`) ou `SelectionOutlineLayer`. ~170 lignes en moins ; aspect différent (rouge superposé et non multiplié) ; `renderOverlay` sur `InstancedMesh` à vérifier ; recette visuelle requise.
- **Contours** : `enableEdgesRendering` (`BabylonVillageScene.ts:1614`, `:3447`, `:3506`, `village-workers.ts:2473`) construit des lignes par maillage côté CPU ; `SelectionOutlineLayer` fait une passe en espace écran pour tous.
- **Lumières** : clustering natif, mais par contournements d'API privées (`_resyncMeshes` neutralisé, `village-braziers.ts:91` ; `scene.addLight` remplacé, `:97-106`), fragiles aux montées de version ; `scene.blockMaterialDirtyMechanism` réduit cette dette ; essayer `horizontalTiles`/`depthSlices`.
- Déjà au bon niveau : halos, brouillard du village, décalques ; `torus-fog.ts` ne sert que la cosmologie ; `NodeMaterial` n'apporte rien de plus.

## 5. Outils de performance

- Inspector (`@babylonjs/inspector`) absent : import dynamique en dev, coût quasi nul.
- `scene.performancePriority` (Intermediate) à essayer et mesurer (options à vérifier) ; `SceneOptimizer` peu adapté.
- WebGPU et `SnapshotRenderingHelper` : coût élevé (shaders GLSL maison, objets animés) ; plus tard.

## 6. Interaction

- Picking CPU par `scene.pick` avec prédicats, dont un survol à chaque `pointermove` en mode amélioration (`BabylonVillageScene.ts:988`). `GPUPicker` (`pickAsync`, `thinInstanceIndex`) utile pour le survol et les arbres en thin instances ; réponse asynchrone ; gain modéré.
- Gizmos : **ne conviennent pas** (placement à la case, rotation de 90°, validation serveur, tore).
- `useFloatingOrigin` règle la précision, pas l'enroulement du tore : le recentrage maison (`world-space.ts:35`) reste nécessaire.

## 7. Autres

- Assets : format AB01 maison (JSON `.babylon` + tampons gzip, 11,1 Mo pour 40 variantes) ; glTF avec `EXT_meshopt_compression` ou Draco (**[Inférence]** octets ÷ 3 à 5) ; coût moyen.
- Chemin chaud contraire à la règle AGENTS : `BabylonVillageScene.ts:1733-1745` parcourt chaque image tous les `#villageMeshes` avec `getChildMeshes()` (allocations) pour réécrire la visibilité ; à piloter par événement.
- AudioV2 disponible, pas d'audio ; Babylon GUI inutile (HUD React).

## Liste classée (impact × coût)

1. **Feux : un seul système de particules** (`CustomParticleEmitter`) ou flamme en thin instances avec shader. Impact élevé la nuit, coût faible. **À prototyper en premier**, mesure de nuit avant/après avec la sonde existante.
2. **Villageois en `InstancedMesh`** avec couleur et alpha par instance ; VAT ensuite pour le CPU.
3. **Fusion du sol par chunk** ; mesurer d'abord la part des unités de sol dans les appels de dessin.
4. **Teinte de démolition et contours** via `renderOverlay`, `HighlightLayer` ou `SelectionOutlineLayer` ; recette visuelle.
5. **Navigation : prototype serveur Recast/Detour** (ou navcat) sur un village, après les décisions ouvertes du diagnostic (§7) ; côté client, connecteurs de chantier seulement, pas de foule sur les trajets.
6. **Inspector en dev** et réduction des contournements d'API privées des lumières.
7. **VAT des villageois** : gain fort, coût élevé.
8. Plus tard : glTF compressé ; WebGPU et rendu par instantané.

Sources : [navigation V2](https://doc.babylonjs.com/features/featuresDeepDive/crowdNavigation/v2Intro), [tile cache](https://doc.babylonjs.com/features/featuresDeepDive/crowdNavigation/v2Intro/v2WhatsNew/v2TileCache), [paramètres](https://doc.babylonjs.com/features/featuresDeepDive/crowdNavigation/v2Intro/v2WhatsNew/v2NavParameters), [annonce](https://forum.babylonjs.com/t/navigation-plugin-v2-is-here/60751), [recast-navigation](https://npmjs.com/package/recast-navigation), [navcat](https://gittrend.io/repo/isaac-mason/navcat), [VAT](https://doc.babylonjs.com/features/featuresDeepDive/animation/baked_texture_animations) ; déclarations locales de `@babylonjs/core@8.56.2`.

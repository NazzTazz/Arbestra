# Kit jardins V8 pour Arbestra

Kit modulaire allégé, 25 octobre 2026. Aucune intégration au jeu.

Lire [la notice pour Opus 5.5](README-OPUS-5.5.md), puis [le manifeste](manifest.json).

| Triangles | Parcelle mûre isolée | Jardin en L de 3 parcelles |
| --- | ---: | ---: |
| LOD0 | 2 198 / 2 500 | 6 146 |
| LOD1 | 578 / 600 | 1 574 |
| LOD2 | 2 / 2 | 6 |

Clôture et marqueur compris en LOD0 et LOD1. LOD2 : cultures et chemins uniquement, conformément à sa représentation sur une plaque.

- `assets/garden-kit.glb` : bibliothèque complète, **quatre matériaux partagés**. Les modèles sources se superposent à l'origine ; instancier les pièces choisies.
- `assets/garden-kit_LOD*.glb` : mêmes sources séparées par niveau, alternatives au fichier complet.
- `assets/example-L_LOD*.glb` et `example-parcel_LOD*.glb` : assemblages de vérification statiques.
- `assets/harvest-carrot_LOD*.glb` : marqueurs séparés, 176 et 24 triangles.
- `sources/garden-v8.blend` : source autonome, textures empaquetées, scènes des trois niveaux et des sept stades.
- `textures/` : sept vues de dessus 256 × 256, atlas commun 512 × 512 et texture commune de bois 512 × 512.
- `reference/assembly.json` : placements de référence ; `reference/validation.json` : contrôles structurels réussis.
- `previews/comparison.png` : comparaison après réimport des GLB dans Blender.

Les budgets ont été vérifiés sur les fichiers exportés. La fluidité sur MX230 et le rendu dans Babylon.js restent à mesurer lors de l'intégration.

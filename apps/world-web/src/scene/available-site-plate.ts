import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';

/**
 * The picking plate of a free construction site. Its material is fully
 * transparent (alpha 0): it never showed anything, but in construction and
 * terraforming modes each visible plate was one more sorted transparent draw
 * call (≈ 250 in the Bressuire view, twice the draw calls of the free view,
 * docs/SPEC-TERRAFORMATION-OUTIL.md §7.14). With visibility 0 Babylon leaves it
 * out of the active meshes; `isVisible` and `isPickable` still let construction
 * picking find it. `baseVisibility` is what the LOD fade of the village meshes
 * multiplies: it keeps the plate at 0.
 */
export function createAvailableSitePlate(
  scene: Scene,
  name: string,
  highlighted: boolean,
  material: Material,
  visible: boolean,
): Mesh {
  const marker = MeshBuilder.CreateBox(
    name,
    { height: highlighted ? 0.045 : 0.018, width: highlighted ? 2.3 : 2.15, depth: highlighted ? 2.3 : 2.15 },
    scene,
  );
  marker.material = material;
  // Picking/preview plates belong only to construction. The LOD fade must
  // neither reveal them outside that mode nor replace their base opacity.
  marker.isVisible = visible;
  marker.metadata = { baseVisibility: 0 };
  marker.visibility = 0;
  return marker;
}

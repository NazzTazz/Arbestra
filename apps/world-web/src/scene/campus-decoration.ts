import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TimberThatch } from './timber-thatch';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { CELL_UNITS } from './world-space';

export function buildCampusGrass(root: Mesh, kit: TimberThatch) {
  const material = new StandardMaterial('campus-grass', kit.scene);
  material.specularColor = Color3.Black();
  const texture = new DynamicTexture('campus-grass-blades', { width: 128, height: 128 }, kit.scene, true);
  const context = texture.getContext(); context.fillStyle = '#627b43'; context.fillRect(0, 0, 128, 128);
  for (let index = 0; index < 1800; index++) {
    context.fillStyle = index % 3 ? 'rgba(164,184,105,.18)' : 'rgba(37,66,28,.15)';
    context.fillRect((index * 43 + Math.floor(index / 128) * 19) % 128, (index * 71 + Math.floor(index / 128) * 11) % 128, 1, 1 + index % 3);
  }
  texture.uScale = 5; texture.vScale = 6; texture.update(false); material.diffuseTexture = texture;
  const grass = MeshBuilder.CreateGround('campus-grass-ground', { width: 5 * CELL_UNITS, height: 6 * CELL_UNITS }, kit.scene);
  grass.position.y = .012; grass.parent = root; grass.material = material;
  grass.receiveShadows = true; grass.isPickable = false; material.zOffset = -1;
  root.onDisposeObservable.add(() => { material.dispose(); texture.dispose(); });
}

/** Campus scenery only: no natural feature, deposit, occupancy or harvesting target. */
export function buildCampusTrees(root: Mesh, kit: TimberThatch) {
  const leaves = ['#446b38', '#668344'].map((colour, index) => {
    const material = new StandardMaterial(`campus-leaves-${index}`, kit.scene);
    material.diffuseColor = Color3.FromHexString(colour); material.specularColor = Color3.Black(); return material;
  });
  const positions = [
    // Three in Medicine's C, leaving the entrance's central approach clear.
    [-2.65, -4.65, .68], [-1.85, -3.15, .62], [-1.85, -4.45, .74],
    // Three on Geography's courtyard-facing side, away from its central door.
    [2.8, -4.7, .7], [3.45, -2.8, .64], [2.65, -2.3, .76],
    // One between Medicine and Mathematics, outside the wide staircase.
    [-4.6, 2.5, .8],
  ] as const;
  const trunks: Mesh[] = [], lower: Mesh[] = [], upper: Mesh[] = [];
  for (const [index, [x, z, scale]] of positions.entries()) {
    const trunk = MeshBuilder.CreateCylinder('campus-tree-trunk', { height: 1.1 * scale, diameterTop: .22 * scale,
      diameterBottom: .38 * scale, tessellation: 6 }, kit.scene);
    trunk.position.set(x, .02 + .5 * scale, z); trunk.material = kit.wood; trunks.push(trunk);
    for (const [layer, meshes] of [lower, upper].entries()) {
      const canopy = MeshBuilder.CreateCylinder('campus-tree-crown', { height: (layer ? 1.25 : 1.55) * scale,
        diameterTop: (layer ? .04 : .16) * scale, diameterBottom: (layer ? 1.15 : 1.55) * scale, tessellation: 7 }, kit.scene);
      canopy.position.set(x, .02 + (layer ? 2.22 : 1.48) * scale, z);
      canopy.rotation.y = index * .73; canopy.material = leaves[layer]!; meshes.push(canopy);
    }
  }
  for (const [index, meshes] of [trunks, lower, upper].entries()) {
    const merged = Mesh.MergeMeshes(meshes, true, true);
    if (!merged) continue;
    merged.name = `campus-decorative-trees-${index}`; merged.parent = root;
    merged.material = index ? leaves[index - 1]! : kit.wood; merged.receiveShadows = true; merged.isPickable = false;
  }
  root.onDisposeObservable.add(() => leaves.forEach(material => material.dispose()));
}

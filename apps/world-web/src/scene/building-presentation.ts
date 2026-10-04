import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TimberThatch } from './timber-thatch';
import { buildingPlan, HALL_RECIPE, HOUSE_RECIPE } from './building-plan';
import { buildUniversity } from './university-factory';
import { buildBarracks } from './barracks-factory';
import { buildSawmill } from './sawmill-factory';

/** Uses the same generators as the village. The result is centred on its footprint. */
export function buildPresentation(kit: TimberThatch, code: string, level = 1): Mesh {
  const root = new Mesh(`presentation-${code}-${level}`, kit.scene);
  if (code === 'university') buildUniversity(root, kit, level, 'finished', 0, { mathematics: false, astronomy: false });
  else if (code === 'barracks') buildBarracks(root, kit);
  else if (code === 'dwelling' || code === 'town-hall') {
    const recipe = code === 'dwelling' ? { ...HOUSE_RECIPE, levels: level >= 2 ? 2 : 1 } : HALL_RECIPE;
    const cells = code === 'town-hall' ? [{ cellX: 0, cellY: 0 }, { cellX: 0, cellY: 1 }] : [{ cellX: 0, cellY: 0 }];
    const plan = buildingPlan({ id: root.name, anchor: cells[0]!, cells, world: { widthCells: 2048, heightCells: 1024 }, recipe });
    kit.build(root, plan);
    root.position.y = plan.base;
  } else if (code === 'sawmill') {
    const material = (name: string, colour: string) => {
      const m = new StandardMaterial(`preview-${name}`, kit.scene); m.diffuseColor = Color3.FromHexString(colour); m.specularColor = Color3.Black(); return m;
    };
    const sawmill = buildSawmill(kit.scene, { stone: material('stone', '#686a5f'), timber: material('timber', '#794521'), lightTimber: material('light-timber', '#a8672f'),
      darkTimber: material('dark-timber', '#402718'), roof: material('roof', '#5d3226'),
      trunk: material('trunk', '#523620'), packedEarth: material('earth', '#4f5839'), sawdust: material('sawdust', '#806b3d') }, root.name, level);
    sawmill.parent = root;
  } else if (code === 'garden') {
    const surface = MeshBuilder.CreateGround('preview-garden', { width: 2.5, height: 2.5 }, kit.scene);
    surface.parent = root; surface.position.y = .16;
    const material = new StandardMaterial('preview-garden', kit.scene);
    material.diffuseTexture = new Texture('/tiles/garden-4.png', kit.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
    material.specularColor = Color3.Black(); surface.material = material;
  } else { root.dispose(); throw new Error(`Unknown building presentation: ${code}`); }
  for (const child of root.getChildMeshes()) child.isPickable = false;
  root.isPickable = false;
  return root;
}

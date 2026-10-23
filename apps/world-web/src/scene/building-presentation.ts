import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TimberThatch } from './timber-thatch';
import { buildingPlan, HALL_RECIPE, HOUSE_RECIPE, LOG_HOUSE_RECIPE, BEAM_HOUSE_RECIPE } from './building-plan';
import { buildUniversity } from './university-factory';
import { buildBarracks } from './barracks-factory';
import { buildStonemason } from './stonemason-factory';
import { buildSawmill } from './sawmill-factory';
import { buildTownHallMarket } from './town-hall-market-factory';
import { brazierBlocks } from './village-braziers';
import { buildInfrastructurePresentation } from './infrastructure-factory';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { createRockSurface, rockOutcropElevation } from './rock-surface';
import { buildResourcePresentation, isResourceRecipe } from './resource-factory';
import { buildWorkerPresentation } from './worker-figure';

/** Uses the same generators as the village. The result is centred on its footprint. */
export function buildPresentation(
  kit: TimberThatch,
  code: string,
  level = 1,
  phase: 'finished' | 'works' = 'finished',
): Mesh {
  if (/^workers:[1-3]$/.test(code)) return buildWorkerPresentation(kit.scene, Number(code.slice(-1)));
  const resource = code.startsWith('resource:') ? code.slice(9) : '';
  if (isResourceRecipe(resource)) return buildResourcePresentation(kit, resource);
  if (code.startsWith('infra:')) {
    const kind = code.slice(6);
    return buildInfrastructurePresentation(kit.scene, {
      fixture: kind === 'brazier' ? 'brazier' : kind === 'workshop' ? 'crossing' : 'elbow',
      width: 4,
      length: 1,
      material: ['border', 'workshop', 'brazier'].includes(kind) ? 'earth' : kind,
      border: kind === 'border',
      quarterTurns: 0,
      preview: kind === 'none',
    });
  }
  const root = new Mesh(`presentation-${code}-${level}`, kit.scene);
  if (code === 'infrastructure-symbol') {
    for (let x = -4; x <= 4; x++)
      for (let z = -4; z <= 4; z++) {
        if (Math.abs(x) > 1 && Math.abs(z) > 1) continue;
        const slab = MeshBuilder.CreateBox('icon-paving', { width: 0.32, depth: 0.32, height: 0.07 }, kit.scene);
        slab.position.set(x * 0.35, 0, z * 0.35);
        slab.material = kit.stone;
        slab.parent = root;
      }
    for (const block of brazierBlocks()) {
      const stone = MeshBuilder.CreateBox('icon-brazier', { width: 0.3, height: 0.1, depth: 0.1 }, kit.scene);
      stone.position.set(0.85 + block.x * 0.1, 0.05 + block.y * 0.1, 0.85 + block.z * 0.1);
      stone.rotation.y = block.angle;
      stone.material = kit.stone;
      stone.parent = root;
    }
    const fire = new StandardMaterial('icon-fire', kit.scene);
    fire.diffuseColor = Color3.FromHexString('#ffaf35');
    fire.emissiveColor = Color3.FromHexString('#ff7620');
    const flame = MeshBuilder.CreateCylinder(
      'icon-flame',
      { diameterBottom: 0.21, diameterTop: 0, height: 0.65, tessellation: 5 },
      kit.scene,
    );
    flame.position.set(0.85, 0.5, 0.85);
    flame.material = fire;
    flame.parent = root;
  } else if (code === 'university')
    buildUniversity(root, kit, level, phase, 0, { mathematics: false, astronomy: false });
  else if (code === 'stonemason') buildStonemason(root, kit, phase, false);
  else if (code === 'barracks') buildBarracks(root, kit);
  else if (code === 'town-hall' && level >= 2) buildTownHallMarket(root, kit, phase, kit.lod ? null : root);
  else if (code.startsWith('dwelling') || code === 'town-hall') {
    const recipe = code.startsWith('dwelling')
      ? {
          ...(code === 'dwelling-logs'
            ? LOG_HOUSE_RECIPE
            : code === 'dwelling-beams'
              ? BEAM_HOUSE_RECIPE
              : HOUSE_RECIPE),
          levels: level >= 2 ? 2 : 1,
        }
      : HALL_RECIPE;
    const cells =
      code === 'town-hall'
        ? [
            { cellX: 0, cellY: 0 },
            { cellX: 0, cellY: 1 },
          ]
        : [{ cellX: 0, cellY: 0 }];
    const plan = buildingPlan({
      id: root.name,
      anchor: cells[0]!,
      cells,
      world: { widthCells: 2048, heightCells: 1024 },
      recipe,
      phase,
    });
    kit.build(root, plan);
    root.position.y = plan.base;
  } else if (code === 'sawmill') {
    const material = (name: string, colour: string) => {
      const m = new StandardMaterial(`preview-${name}`, kit.scene);
      m.diffuseColor = Color3.FromHexString(colour);
      m.specularColor = Color3.Black();
      return m;
    };
    const sawmill = buildSawmill(
      kit.scene,
      {
        stone: material('stone', '#686a5f'),
        timber: material('timber', '#794521'),
        lightTimber: material('light-timber', '#a8672f'),
        darkTimber: material('dark-timber', '#402718'),
        roof: material('roof', '#5d3226'),
        trunk: material('trunk', '#523620'),
        packedEarth: material('earth', '#4f5839'),
        sawdust: material('sawdust', '#806b3d'),
      },
      root.name,
      level,
      0,
      0,
      kit.lod,
    );
    sawmill.parent = root;
  } else if (code === 'woodland') {
    const leaves = new StandardMaterial('preview-grove-leaves', kit.scene);
    leaves.diffuseColor = Color3.FromHexString('#365425');
    leaves.specularColor = Color3.Black();
    for (const [x, z, size] of [
      [-0.8, 0.5, 1],
      [0.7, 0.4, 0.85],
      [0, -0.6, 1.1],
    ]) {
      const trunk = MeshBuilder.CreateCylinder(
        'preview-grove-trunk',
        { height: 1, diameter: 0.22, tessellation: 6 },
        kit.scene,
      );
      trunk.parent = root;
      trunk.position.set(x!, size! * 0.5, z!);
      trunk.scaling.setAll(size!);
      trunk.material = kit.wood;
      for (const [y, diameter] of [
        [1.3, 1.3],
        [1.9, 0.9],
      ]) {
        const crown = MeshBuilder.CreateCylinder(
          'preview-grove-crown',
          { height: 1.35, diameterBottom: diameter!, diameterTop: 0, tessellation: 6 },
          kit.scene,
        );
        crown.parent = root;
        crown.position.set(x!, y! * size!, z!);
        crown.scaling.setAll(size!);
        crown.material = leaves;
      }
    }
  } else if (code === 'stone_outcrop') {
    const rock = new Mesh('preview-deposit', kit.scene),
      data = new VertexData();
    Object.assign(
      data,
      createRockSurface({
        x: -2,
        z: -2,
        width: 4,
        depth: 4,
        seed: 42,
        elevation: (x, z) =>
          rockOutcropElevation(
            x,
            z,
            42,
            { x: 0, z: 0, radiusX: 1.5, radiusZ: 1.25, height: 1, angle: 0.2, scaleX: 1 },
            512,
            256,
          ),
      }),
    );
    data.applyToMesh(rock);
    rock.material = kit.stone;
    rock.parent = root;
  } else if (code === 'garden') {
    const surface = MeshBuilder.CreateGround('preview-garden', { width: 2.5, height: 2.5 }, kit.scene);
    surface.parent = root;
    surface.position.y = 0.16;
    const material = new StandardMaterial('preview-garden', kit.scene);
    material.diffuseTexture = new Texture(
      '/tiles/garden-4.png',
      kit.scene,
      false,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    material.specularColor = Color3.Black();
    surface.material = material;
  } else {
    root.dispose();
    throw new Error(`Unknown building presentation: ${code}`);
  }
  for (const child of root.getChildMeshes()) child.isPickable = false;
  root.isPickable = false;
  return root;
}

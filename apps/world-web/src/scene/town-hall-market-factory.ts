import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { buildingPlan, HALL_DOUBLE_DOOR_WIDTH, HALL_RECIPE, type BuildingRecipe } from './building-plan';
import { TimberThatch, timberBeamGeometry } from './timber-thatch';
import { glazeWindows } from './frosted-glass';
import { buildMarketRoof } from './town-hall-market-roof';
import { sceneNight, VillageBraziers } from './village-braziers';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { buildTownHallClock } from './town-hall-clock';
import { prepareRoundedCorner, finishRoundedCorner } from './town-hall-rounded-corner';
import { buildTownHallStorefront } from './town-hall-storefront';

/**
 * The static shell is baked by the factory (`town-hall-2-*`); the live parts
 * (clock hands, braziers, reflective storefront) are always built in the scene.
 */
export type MarketParts = 'all' | 'shell' | 'live';

/** Workshop proposal: a long covered wooden balcony beside a small-stone room. */
export function buildTownHallMarket(
  root: Mesh,
  kit: TimberThatch,
  phase: 'finished' | 'works',
  fireOwner: Mesh | null = root,
  oppositeEntrance = false,
  parts: MarketParts = 'all',
) {
  const shell = parts !== 'live',
    live = parts !== 'shell';
  // Canonical market entrance is -X. RC1 starter halls use +X; turn the
  // whole rectangular model before world-space effects (including braziers).
  if (oppositeEntrance) root.rotation.y += Math.PI;
  const originalProfile = kit.stoneProfile;
  kit.stoneProfile = { segments: 3, radiusRatio: 0.12 };
  try {
    const input = {
      id: 'hall-market',
      anchor: { cellX: 0, cellY: 0 },
      cells: [
        { cellX: 0, cellY: 0 },
        { cellX: 0, cellY: 1 },
      ],
      world: { widthCells: 32, heightCells: 32 },
    };
    const lowerBays: NonNullable<BuildingRecipe['windowOpenings']> = [];
    for (const centre of [-10, 10]) lowerBays.push({ face: '-x', level: 0, centre, width: 2, sill: 3, courses: 5 });
    lowerBays.push({ face: '+x', level: 0, centre: 2, width: 13, sill: 2, courses: 8 });
    for (const face of ['-z', '+z'] as const)
      lowerBays.push({ face, level: 0, centre: 0, width: 2, sill: 3, courses: 5 });
    const lower = buildingPlan({
      ...input,
      recipe: {
        ...HALL_RECIPE,
        entrance: { ...HALL_RECIPE.entrance, open: true, width: HALL_DOUBLE_DOOR_WIDTH },
        windows: {},
        windowOpenings: lowerBays,
        roof: { ...HALL_RECIPE.roof, style: 'flat-stone', overhang: 0, sideOverhang: 0, lengthExtraRatio: 0 },
      },
    });
    const niches = lower.openings.filter((opening) => opening.face === '-x' && !opening.door);
    // Reuse the stone opening frames, omitting wooden window trim and glass.
    for (const niche of niches) niche.door = true;
    const storefront = lower.openings.find((o) => o.face === '+x')!;
    storefront.door = true;
    storefront.omitLeftJamb = true;
    const lowerCorner = prepareRoundedCorner(lower);
    const base = new Mesh('hall-market-ground-floor', kit.scene);
    base.parent = root;
    base.position.y = lower.base;
    if (shell) {
      kit.build(base, lower);
      finishRoundedCorner(base, kit, lower, lowerCorner, false, false, true);
      // Double door: a stone pier splits the wide opening into the entry and
      // exit lanes (entering on the right, seen from outside).
      const door = lower.openings.find((o) => o.face === '-x' && o.left < 0 && o.right > 0)!,
        thickness = lower.recipe.module.thickness;
      const pier = new Mesh('market-door-pier', kit.scene);
      timberBeamGeometry(door.top - door.bottom - 0.01, thickness, thickness, true, 3, 0.1, 0.12).applyToMesh(pier);
      pier.position.set(-lower.width / 2 + thickness / 2, (door.top + door.bottom) / 2, (door.left + door.right) / 2);
      pier.parent = base;
      pier.material = kit.stone;
      pier.receiveShadows = true;
    }
    if (phase === 'finished' && live) buildTownHallStorefront(base, kit, lower, lowerCorner, storefront);
    for (const niche of shell ? niches : []) {
      const z = (niche.left + niche.right) / 2,
        width = niche.right - niche.left,
        height = niche.top - niche.bottom;
      for (const [name, x, y, d, w, h, depth] of [
        ['back', -0.8, (niche.bottom + niche.top) / 2, z, 0.04, height, width],
        ['sill', -0.96, niche.bottom + 0.015, z, 0.32, 0.03, width],
        ['left', -0.96, (niche.bottom + niche.top) / 2, niche.left + 0.015, 0.32, height, 0.03],
        ['right', -0.96, (niche.bottom + niche.top) / 2, niche.right - 0.015, 0.32, height, 0.03],
        ['top', -0.96, niche.top - 0.015, z, 0.32, 0.03, width],
      ] as const) {
        const mesh = new Mesh(`market-niche-${name}`, kit.scene);
        timberBeamGeometry(h, w, depth, true, 3, 0.1, 0.12).applyToMesh(mesh);
        mesh.position.set(x, y, d);
        mesh.parent = base;
        mesh.material = kit.stone;
        mesh.receiveShadows = true;
      }
    }
    if (shell) glazeWindows(base, lower);
    const upperBays: NonNullable<BuildingRecipe['windowOpenings']> = [];
    for (const face of ['-x', '+x'] as const)
      for (const centre of face === '+x' ? [-18, -10, 0, 10, 20] : [-20, -10, 0, 10, 20])
        upperBays.push({ face, level: 0, centre, width: 2, sill: 2, courses: 14 });
    for (const face of ['-z', '+z'] as const)
      upperBays.push({ face, level: 0, centre: -5, width: 4, sill: 6, courses: 10 });
    const upper = buildingPlan({
      ...input,
      phase,
      recipe: {
        ...HALL_RECIPE,
        modules: [11, 32],
        courses: 18,
        module: { length: 0.14, height: 0.07, thickness: 0.07, joint: 0.003 },
        entrance: { ...HALL_RECIPE.entrance, enabled: false },
        windows: {},
        windowOpenings: upperBays,
        roof: { ...HALL_RECIPE.roof, style: 'flat-stone', overhang: 0, sideOverhang: 0, lengthExtraRatio: 0 },
      },
    });
    const corner = prepareRoundedCorner(upper);
    const room = new Mesh('hall-market-upper-room', kit.scene);
    room.parent = root;
    room.position.set((lower.width - upper.width) / 2, lower.base + lower.height + 0.08, 0);
    if (shell) {
      kit.build(room, upper);
      finishRoundedCorner(room, kit, upper, corner);
      glazeWindows(room, upper);
    }
    buildTownHallClock(room, kit, phase, upper.height + 0.08, upper.width, parts);
    const eave = upper.height;
    if (shell) {
      const roof = new Mesh('hall-market-shared-roof', kit.scene);
      roof.parent = root;
      roof.position.y = room.position.y;
      buildMarketRoof(roof, kit, eave, phase === 'finished');
    }
    if (shell) {
      const pieces: Mesh[] = [],
        y = room.position.y,
        half = lower.width / 2 - 0.07,
        front = -lower.depth / 2 + 0.07;
      const box = (name: string, x: number, z: number, width: number, height: number, depth: number, dy: number) => {
        const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, kit.scene);
        mesh.position.set(x, y + dy, z);
        pieces.push(mesh);
      };
      const inner = room.position.x - upper.width / 2,
        balconyWidth = inner + half,
        balconyCentre = (inner - half) / 2;
      const supportHeight = eave - 0.12;
      for (const z of [front, 0, -front])
        box('hall-market-canopy-post', -half, z, 0.09, supportHeight, 0.09, supportHeight / 2);
      if (phase === 'finished') {
        for (const h of [0.3, 0.6]) {
          box('hall-market-balcony-side', -half, 0, 0.055, 0.055, -front * 2, h);
          for (const z of [front, -front])
            box('hall-market-balcony-end', balconyCentre, z, balconyWidth, 0.055, 0.055, h);
        }
      }
      const boards = kit.lod === 2 ? 1 : Math.ceil((-front * 2) / 0.14);
      for (let i = 0; i < boards; i++)
        box(
          'hall-market-balcony-floor',
          balconyCentre,
          front + (i + 0.5) * ((-front * 2) / boards),
          balconyWidth - 0.02,
          0.035,
          (-front * 2) / boards - 0.003,
          0.0175,
        );
      const rails = Mesh.MergeMeshes(pieces, true, true);
      if (rails) {
        rails.parent = root;
        rails.material = kit.wood;
        rails.receiveShadows = true;
      }
    }
    if (phase === 'finished' && fireOwner && live) {
      const braziers = new VillageBraziers(kit.scene);
      const points = niches.map((niche, index) => {
        const p = Vector3.TransformCoordinates(
          new Vector3(-0.99, lower.base + niche.bottom + 0.03, (niche.left + niche.right) / 2),
          root.computeWorldMatrix(true),
        );
        return { x: p.x, y: p.y, z: p.z, seed: 0.3 + index * 0.4 };
      });
      braziers.updatePoints(points, fireOwner);
      const observer = kit.scene.onBeforeRenderObservable.add(() =>
        braziers.animate(performance.now(), sceneNight(kit.scene), fireOwner.isEnabled() ? 1 : 0),
      );
      fireOwner.onDisposeObservable.addOnce(() => {
        kit.scene.onBeforeRenderObservable.remove(observer);
        braziers.dispose();
      });
    }
    for (const mesh of root.getChildMeshes()) {
      mesh.isPickable = false;
      if (mesh.material === kit.stone) {
        const colors = mesh.getVerticesData('color') ?? new Array(mesh.getTotalVertices() * 4).fill(1);
        for (let i = 0; i < colors.length; i += 4) {
          colors[i]! *= 0.94;
          colors[i + 1]! *= 0.9;
          colors[i + 2]! *= 0.82;
        }
        mesh.setVerticesData('color', colors);
      }
    }
    return root;
  } finally {
    kit.stoneProfile = originalProfile;
  }
}

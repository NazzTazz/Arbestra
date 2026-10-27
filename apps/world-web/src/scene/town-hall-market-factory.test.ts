import { expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { buildingPlan, recipeFor, HALL_DOUBLE_DOOR_WIDTH, HALL_RECIPE, type BuildingPlan } from './building-plan';
import { buildTownHallMarket } from './town-hall-market-factory';
import { TimberThatch } from './timber-thatch';

it('keeps the market physical entrance on the planned access face through all four village rotations', () => {
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return {
          fillRect() {},
          beginPath() {},
          moveTo() {},
          lineTo() {},
          stroke() {},
          bezierCurveTo() {},
          ellipse() {},
          clearRect() {},
          drawImage() {},
          canvas: this,
        };
      }
    },
  );
  const engine = new NullEngine(),
    scene = new Scene(engine),
    kit = new TimberThatch(scene);
  kit.lod = 2;
  const build = vi.spyOn(kit, 'build');
  try {
    for (const face of ['-x', '+x'] as const) {
      const parent = new Mesh('village-hall', scene),
        root = new Mesh('market-lod', scene);
      root.parent = parent;
      // The factory itself builds the real ground-floor plan, not a test copy of its entry.
      build.mockClear();
      if (face === '-x') buildTownHallMarket(root, kit, 'works', null);
      else buildTownHallMarket(root, kit, 'works', null, true);
      const lower = build.mock.calls.find(([mesh]) => mesh.name === 'hall-market-ground-floor')![1] as BuildingPlan;
      for (const quarterTurns of [0, 1, 2, 3]) {
        parent.rotation.y = (quarterTurns * Math.PI) / 2;
        const plan = buildingPlan({
          id: 'hall',
          anchor: { cellX: 0, cellY: 0 },
          cells: [{ cellX: 0, cellY: 0 }, quarterTurns % 2 ? { cellX: 1, cellY: 0 } : { cellX: 0, cellY: 1 }],
          world: { widthCells: 512, heightCells: 256 },
          recipe: { ...HALL_RECIPE, entrance: { ...HALL_RECIPE.entrance, face } },
          quarterTurns,
        });
        const physical = Vector3.TransformCoordinates(
          new Vector3(lower.entry.threshold.x, 0, lower.entry.threshold.z),
          root.computeWorldMatrix(true),
        );
        const access = Vector3.TransformCoordinates(
          new Vector3(plan.entry.threshold.x, 0, plan.entry.threshold.z),
          parent.computeWorldMatrix(true),
        );
        expect(physical.x, face + '/' + quarterTurns).toBeCloseTo(access.x);
        expect(physical.z, face + '/' + quarterTurns).toBeCloseTo(access.z);
        const physicalNormal = Vector3.TransformNormal(
          new Vector3(lower.entry.normal.x, 0, lower.entry.normal.z),
          root.getWorldMatrix(),
        );
        const accessNormal = Vector3.TransformNormal(
          new Vector3(plan.entry.normal.x, 0, plan.entry.normal.z),
          parent.getWorldMatrix(),
        );
        expect(physicalNormal.x).toBeCloseTo(accessNormal.x);
        expect(physicalNormal.z).toBeCloseTo(accessNormal.z);
      }
      // The double door: one opening six modules wide, matching the scene's
      // plan for a market hall, split by a stone pier between the two lanes.
      const door = lower.openings.find((o) => o.face === '-x' && o.left < 0 && o.right > 0)!;
      expect(door.right - door.left).toBeCloseTo(HALL_DOUBLE_DOOR_WIDTH * HALL_RECIPE.module.length);
      expect(door.right - door.left).toBeCloseTo(
        recipeFor({
          visualLayout: { recipe: 'town-hall', version: 1, quarterTurns: 0, entranceFace: face, offset: [0, 0] },
          status: 'completed',
          targetLevel: null,
          level: 2,
        })!.recipe.entrance.width * HALL_RECIPE.module.length,
      );
      const pier = root.getChildMeshes().find((m) => m.name === 'market-door-pier')!;
      expect(pier).toBeDefined();
      expect(pier.position.z).toBeCloseTo((door.left + door.right) / 2);
      expect(Math.abs(pier.position.x)).toBeCloseTo(lower.width / 2 - HALL_RECIPE.module.thickness / 2);
      parent.dispose(false, false);
    }
  } finally {
    scene.dispose();
    engine.dispose();
    vi.unstubAllGlobals();
  }
});

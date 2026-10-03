import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { buildingPlan, HALL_RECIPE, type BuildingPlan, type BuildingRecipe } from './building-plan';
import { TimberThatch } from './timber-thatch';
import { CAMPUS_SUBCELL_UNITS } from './mathematics-factory';
import { glazeWindows } from './frosted-glass';
import { CELL_UNITS } from './world-space';

function medicinePlan(id: string, depth: number, levels: number, phase: 'finished' | 'works', courtyard: boolean, extended: boolean) {
  const bays: NonNullable<BuildingRecipe['windowOpenings']> = [];
  for (let level = 0; level < levels; level++) {
    for (const face of ['-x', '+x'] as const) {
      const centres = courtyard ? [-3, 3] : face === '+x' && level === 0
        ? extended ? [-7, 7] : [-16, -7, 7, 16] : [-16, -8, 0, 8, 16];
      for (const centre of centres) bays.push({ face, level, centre, width: 2, sill: 3, courses: 5 });
    }
    for (const face of ['-z', '+z'] as const) bays.push({ face, level, centre: 0, width: 2, sill: 3, courses: 5 });
  }
  return buildingPlan({
    id, anchor: { cellX: 0, cellY: 0 },
    cells: Array.from({ length: Math.ceil(depth / 8) }, (_, cellY) => ({ cellX: 0, cellY })),
    world: { widthCells: 32, heightCells: 32 }, phase, sourceLevels: levels > 1 ? 1 : 0,
    recipe: {
      ...HALL_RECIPE, id, modules: [8, depth], levels,
      module: { ...HALL_RECIPE.module, length: CAMPUS_SUBCELL_UNITS, thickness: CAMPUS_SUBCELL_UNITS / 2 },
      entrance: { ...HALL_RECIPE.entrance, face: '+x', width: 4, courses: 8, enabled: !courtyard },
      windows: {}, windowOpenings: bays,
      roof: { ...HALL_RECIPE.roof, style: 'flat-stone', overhang: 0, sideOverhang: 0, lengthExtraRatio: 0,
        maxSpan: 8 * CAMPUS_SUBCELL_UNITS, allowOutsideFootprint: false },
    },
  });
}

/** Remove shared ground-floor walls, retaining upper walls and modular corner returns. */
function openJoin(plan: BuildingPlan, face: '-x' | '+x', low: number, high: number) {
  const sign = face === '-x' ? -1 : 1, module = plan.recipe.module;
  const fixed = sign * (plan.width / 2 - module.thickness / 2);
  const height = plan.recipe.courses * module.height;
  plan.stones = plan.stones.flatMap(stone => {
    if (stone.axis !== 'z' || stone.y >= height || Math.abs(stone.x - fixed) > 1e-8) return [stone];
    const a = stone.z - (stone.length + module.joint) / 2, b = stone.z + (stone.length + module.joint) / 2;
    if (b <= low + 1e-8 || a >= high - 1e-8) return [stone];
    return [[a, Math.min(b, low)], [Math.max(a, high), b]].filter(([lo, hi]) => hi! - lo! > module.joint)
      .map(([lo, hi]) => ({ ...stone, z: (lo! + hi!) / 2, length: hi! - lo! - module.joint }));
  });
  const stoppedEnd = sign * (plan.width / 2 - module.thickness - module.joint / 2);
  for (const stone of plan.stones) {
    if (stone.axis !== 'x' || stone.y >= height || stone.z < low - 1e-8 || stone.z > high + 1e-8) continue;
    if (Math.abs(stone.x + sign * stone.length / 2 - stoppedEnd) > 1e-8) continue;
    stone.length += module.thickness; stone.x += sign * module.thickness / 2;
  }
  plan.openings = plan.openings.filter(opening => opening.face !== face || opening.bottom >= height || opening.right <= low || opening.left >= high);
}

/** Workshop campus only: scientific capacity remains independent of the visible floors. */
export function buildMedicine(root: Mesh, kit: TimberThatch, level: number, phase: 'finished' | 'works') {
  const site = new Mesh('medicine-campus-site', kit.scene); site.parent = root;
  site.position.set(-2 * CELL_UNITS, 0, -1.5 * CELL_UNITS);
  const main = medicinePlan('medicine-main', 22, level === 3 ? 2 : 1, level === 2 ? 'finished' : phase, false, level >= 2);
  const parts: Array<{ plan: BuildingPlan; x: number; z: number }> = [{ plan: main, x: 0, z: 0 }];
  if (level >= 2) for (const sign of [-1, 1]) {
    const wing = medicinePlan(`medicine-wing-${sign}`, 6, 1, level === 3 ? 'finished' : phase, true, false);
    openJoin(main, '+x', (sign < 0 ? -11 : 5) * CAMPUS_SUBCELL_UNITS, (sign < 0 ? -5 : 11) * CAMPUS_SUBCELL_UNITS);
    openJoin(wing, '-x', -3 * CAMPUS_SUBCELL_UNITS, 3 * CAMPUS_SUBCELL_UNITS);
    parts.push({ plan: wing, x: 8 * CAMPUS_SUBCELL_UNITS, z: sign * 8 * CAMPUS_SUBCELL_UNITS });
  }
  for (const { plan, x, z } of parts) {
    const building = new Mesh(plan.id, kit.scene); building.parent = site;
    building.position.set(x, plan.base, z);
    kit.build(building, plan); glazeWindows(building, plan);
    for (const mesh of building.getChildMeshes()) mesh.isPickable = false;
  }
  return site;
}

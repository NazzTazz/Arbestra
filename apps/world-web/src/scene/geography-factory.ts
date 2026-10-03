import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { buildingPlan, HALL_RECIPE, type BuildingRecipe } from './building-plan';
import { TimberThatch, timberBeamGeometry } from './timber-thatch';
import { CAMPUS_SUBCELL_UNITS, openLongitudinalJoin } from './mathematics-factory';
import { glazeWindows } from './frosted-glass';
import { CELL_UNITS } from './world-space';

function geographyPlan(id: string, depth: number, levels: number, sourceLevels: number, phase: 'finished' | 'works', entrance: boolean) {
  const bays: NonNullable<BuildingRecipe['windowOpenings']> = [];
  for (let level = 0; level < levels; level++) {
    for (const face of ['-x', '+x'] as const) {
      if (entrance && face === '-x' && level === 0) continue;
      bays.push({ face, level, centre: 0, width: 2, sill: 3, courses: 5 });
    }
    for (const face of ['-z', '+z'] as const) bays.push({ face, level, centre: 0, width: 2, sill: 3, courses: 5 });
  }
  return buildingPlan({ id, anchor: { cellX: 0, cellY: 0 },
    cells: [{ cellX: 0, cellY: 0 }], world: { widthCells: 32, heightCells: 32 }, phase, sourceLevels,
    recipe: { ...HALL_RECIPE, id, modules: [6, depth], courses: 10, levels,
      module: { ...HALL_RECIPE.module, length: CAMPUS_SUBCELL_UNITS, thickness: CAMPUS_SUBCELL_UNITS / 2 },
      entrance: { ...HALL_RECIPE.entrance, face: '-x', width: 4, courses: 8, enabled: entrance },
      windows: {}, windowOpenings: bays,
      roof: { ...HALL_RECIPE.roof, style: 'flat-stone', overhang: 0, sideOverhang: 0, lengthExtraRatio: 0,
        maxSpan: 6 * CAMPUS_SUBCELL_UNITS, allowOutsideFootprint: false } } });
}

/** Three joined modules preserve a continuous ground floor beneath the podium. */
export function buildGeography(root: Mesh, kit: TimberThatch, level: number, phase: 'finished' | 'works') {
  const site = new Mesh('geography-campus-site', kit.scene); site.parent = root;
  site.position.set(2 * CELL_UNITS, 0, -1.5 * CELL_UNITS);
  // Front / middle / rear: 1-1-1, then 1-2-1, then 2-3-1.
  const heights = level === 3 ? [2, 3, 1] : [1, level === 2 ? 2 : 1, 1];
  const previous = level === 3 ? [1, 2, 1] : level === 2 ? [1, 1, 1] : [0, 0, 0];
  const parts = heights.map((floors, index) => ({
    z: (index - 1) * 7 * CAMPUS_SUBCELL_UNITS,
    plan: geographyPlan(`geography-module-${index}`, index === 1 ? 6 : 8, floors, previous[index]!,
      floors === previous[index] ? 'finished' : phase, index === 1),
  }));
  const decks: Mesh[] = [];
  for (let index = 0; index < parts.length - 1; index++) {
    const a = parts[index]!, b = parts[index + 1]!, sharedHeight = Math.min(a.plan.height, b.plan.height);
    openLongitudinalJoin(a.plan, '+z', sharedHeight);
    openLongitudinalJoin(b.plan, '-z', sharedHeight);
    // Parquet formerly stopped short of both removed walls; bridge the seam.
    for (let floor = 0; floor < Math.min(heights[index]!, heights[index + 1]!); floor++) {
      const deck = new Mesh('geography-parquet-join', kit.scene);
      timberBeamGeometry(CAMPUS_SUBCELL_UNITS, a.plan.width - 2 * a.plan.recipe.module.thickness, .035).applyToMesh(deck);
      deck.rotation.x = Math.PI / 2;
      deck.position.set(0, a.plan.base + floor * (10 * a.plan.recipe.module.height + a.plan.recipe.floorThickness) + .0175,
        a.z + a.plan.depth / 2);
      deck.material = kit.wood; decks.push(deck);
    }
  }
  for (const { plan, z } of parts) {
    const building = new Mesh(plan.id, kit.scene); building.parent = site; building.position.set(0, plan.base, z);
    kit.build(building, plan); glazeWindows(building, plan);
    for (const mesh of building.getChildMeshes()) mesh.isPickable = false;
  }
  const parquet = Mesh.MergeMeshes(decks, true, true);
  if (parquet) { parquet.parent = site; parquet.material = kit.wood; parquet.isPickable = false; }
  return site;
}

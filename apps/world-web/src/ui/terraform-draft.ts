import {
  fixedBuildingFootprint,
  footprintVertices,
  predictTerrainEdits,
  terrainEditCells,
  vertexLeveling,
  triangleHeight,
  type TerrainEditGesture,
  type TerrainVertex,
  type TerraformRequest,
  type VillageState,
} from '@arbestra/contracts';
import type { TerraformVisual } from '../scene/terraform-preview';
import { terraformObstacles, unitRefusal, type TerraformRefusal } from './terraform-refusals';
export function villageVertexHeight(state: VillageState, x: number, y: number) {
  const r = state.region,
    world = state.world,
    dx = (x - r.originCellX + world.widthCells) % world.widthCells,
    dy = (y - r.originCellY + world.heightCells) % world.heightCells;
  return r.vertexHeights && dx <= r.width && dy <= r.height ? (r.vertexHeights[dy * (r.width + 1) + dx] ?? NaN) : NaN;
}
export function terrainBrushHeight(
  state: VillageState,
  x: number,
  y: number,
  heightAt = (x: number, y: number) => villageVertexHeight(state, x, y),
) {
  const ix = Math.floor(x + 0.5),
    iy = Math.floor(y + 0.5),
    height = (dx: number, dy: number) =>
      heightAt((ix + dx) % state.world.widthCells, (iy + dy) % state.world.heightCells);
  return (
    Math.round(triangleHeight(height(0, 0), height(1, 0), height(1, 1), height(0, 1), x + 0.5 - ix, y + 0.5 - iy) * 4) /
    4
  );
}
/** Immediate brush feedback uses only painted corners; never waits for a quote or its ring. */
export function terraformSelectionVisual(
  request: TerraformRequest,
  world: VillageState['world'],
  heightAt: (x: number, y: number) => number,
): TerraformVisual {
  const sourceHeights = footprintVertices(request.cells, world).map((v) => ({
    ...v,
    height: heightAt(v.vertexX, v.vertexY),
  }));
  const vertices = sourceHeights.map((v) => ({ ...v, height: request.height }));
  return {
    origin: request.anchor,
    invalidCells: [],
    sourceHeights,
    quote: {
      model: 'vertices',
      height: request.height,
      cells: request.cells,
      affectedCells: request.cells,
      vertices,
      workMs: 1,
      transportMs: 0,
      durationMs: 1,
      stoneDebit: 0,
      stoneCredit: 0,
      signature: '',
    },
  };
}
/** A released stroke, checked locally and ready to send (docs/SPEC-TERRAFORMATION-OUTIL.md §7). */
export interface LocalStroke {
  /** The gesture to send: the painted cells whose 3 × 3 the client sees free; null when none. */
  gesture: TerrainEditGesture | null;
  /** Its predicted vertex heights: the server's own calculation (predictTerrainEdits). */
  vertices: TerrainVertex[];
  /** The painted cells refused locally, one each, with the obstacle in cause. */
  refusals: TerraformRefusal[];
  /** A short hint (« already at this height »), or null. */
  hint: string | null;
}
/**
 * The client's part of a stroke: each painted cell whose 3 × 3 meets an
 * obstacle the client sees is withdrawn (the Oracle tells why), the rest is
 * sent at once and predicted. A height at or under 0 is water: the whole
 * stroke is refused, one error. Throws when a height is unknown (ground not
 * loaded) or the selection is invalid, as the server's calculation would.
 */
export function localStroke(
  state: VillageState,
  draft: {
    anchor: { cellX: number; cellY: number };
    cells: readonly { cellX: number; cellY: number }[];
    height: number;
  },
  heightAt: (x: number, y: number) => number,
): LocalStroke {
  const cells = terrainEditCells(draft, state.world);
  if (draft.height <= 0)
    return { gesture: null, vertices: [], refusals: [{ reason: 'water', cell: draft.anchor }], hint: null };
  const obstacles = terraformObstacles(state),
    accepted: Array<{ cellX: number; cellY: number }> = [],
    refusals: TerraformRefusal[] = [];
  for (const cell of cells) {
    const refusal = unitRefusal(obstacles, cell, state.world);
    if (refusal) refusals.push(refusal);
    else accepted.push(cell);
  }
  if (!accepted.length) return { gesture: null, vertices: [], refusals, hint: null };
  const anchor = accepted.find((c) => c.cellX === draft.anchor.cellX && c.cellY === draft.anchor.cellY) ?? accepted[0]!;
  const gesture: TerrainEditGesture = { buildingType: 'terrain', anchor, cells: accepted, height: draft.height };
  const vertices = [...predictTerrainEdits([gesture], state.world, heightAt).values()];
  // Nothing would change: no command, a short hint (none beside an Oracle's page).
  if (!vertices.length)
    return { gesture: null, vertices, refusals, hint: refusals.length ? null : 'Le terrain est déjà à cette hauteur.' };
  return { gesture, vertices, refusals, hint: null };
}
/** Preview of an instant footprint leveling (university, stonemason). */
export function footprintTerraformVisual(
  buildingType: 'university' | 'stonemason',
  anchor: { cellX: number; cellY: number },
  quarterTurns: number,
  world: { widthCells: number; heightCells: number },
  heightAt: (x: number, y: number) => number,
): TerraformVisual {
  const cells = fixedBuildingFootprint(buildingType, anchor, quarterTurns, world);
  const plan = vertexLeveling(cells, world, heightAt, 1);
  return {
    origin: anchor,
    invalidCells: [],
    sourceHeights: footprintVertices(plan.affectedCells, world).map((v) => ({
      ...v,
      height: heightAt(v.vertexX, v.vertexY),
    })),
    quote: {
      model: 'vertices',
      height: plan.height,
      cells,
      affectedCells: plan.affectedCells,
      vertices: plan.vertices,
      workMs: 1,
      transportMs: 0,
      durationMs: 1,
      stoneDebit: 0,
      stoneCredit: 0,
      signature: '',
    },
  };
}

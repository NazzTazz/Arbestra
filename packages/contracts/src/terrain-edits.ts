import './formats.js';
import { Type, type Static } from '@sinclair/typebox';
import type { SpatialDimensions } from './building-footprint.js';
import { MAX_TERRAFORM_CELLS, terraformCells } from './terraforming.js';
import { vertexKey, vertexLeveling, type TerrainVertex } from './terrain-vertices.js';

/** Instant terrain edits (docs/SPEC-TERRAFORMATION-INSTANTANEE.md): one batch
 * of gestures, applied in order at admission; free, without workers or
 * duration. Since 2 November (docs/SPEC-TERRAFORMATION-OUTIL.md §7) a refusal
 * no longer voids the batch: each painted cell of a free gesture (with its
 * 3 × 3) and each footprint leveling is accepted or refused on its own. */
export const TERRAIN_EDIT_GESTURES_PER_COMMAND = 32;
export const TERRAIN_EDIT_CELLS_PER_COMMAND = 1024;
const coordinate = Type.Integer({ minimum: 0, maximum: 1_000_000 });
const Cell = Type.Object({ cellX: coordinate, cellY: coordinate }, { additionalProperties: false });
export const TerrainEditGestureSchema = Type.Union([
  /** Free terraforming: every vertex of the cells to one height. */
  Type.Object(
    {
      buildingType: Type.Literal('terrain'),
      anchor: Cell,
      cells: Type.Array(Cell, { minItems: 1, maxItems: 256 }),
      height: Type.Number({ multipleOf: 0.25 }),
    },
    { additionalProperties: false },
  ),
  /** Footprint leveling before a building that needs flat ground. */
  Type.Object(
    {
      buildingType: Type.Union([Type.Literal('university'), Type.Literal('stonemason')]),
      anchor: Cell,
      quarterTurns: Type.Integer({ minimum: 0, maximum: 3 }),
    },
    { additionalProperties: false },
  ),
]);
export type TerrainEditGesture = Static<typeof TerrainEditGestureSchema>;
export type FreeTerrainEditGesture = Extract<TerrainEditGesture, { buildingType: 'terrain' }>;
export const TerrainEditsRequestSchema = Type.Object(
  {
    commandId: Type.String({ format: 'uuid' }),
    gestures: Type.Array(TerrainEditGestureSchema, { minItems: 1, maxItems: TERRAIN_EDIT_GESTURES_PER_COMMAND }),
  },
  { additionalProperties: false },
);
export type TerrainEditsRequest = Static<typeof TerrainEditsRequestSchema>;
/** Codes of a refused unit (one painted cell of a free gesture, or a whole
 * footprint leveling); the other refusals (coordinates, size, world) stay global. */
export const TERRAIN_EDIT_REFUSAL_CODES = [
  'INFRASTRUCTURE_OCCUPIED',
  'ENGAGED_PASSAGE',
  'TERRAIN_NOT_BUILDABLE',
  'CELL_OCCUPIED',
  'CLEARING_PROTECTED',
  'OUTSIDE_VILLAGE_REACH',
  'LEVELING_WATER',
  'LEVELING_FOUNDATION',
  'LEVELING_UNAVAILABLE',
  'INVALID_TERRAFORM_SELECTION',
  'BUILDING_LIMIT_REACHED',
] as const;
export type TerrainEditRefusalCode = (typeof TERRAIN_EDIT_REFUSAL_CODES)[number];
/** One refused unit: its gesture (0-based, batch order), the painted cell (a
 * footprint's anchor), the code, and `at`, the cell whose obstacle refused it
 * (a road, a building, a foundation, a wet corner…). */
export const TerrainEditRefusalSchema = Type.Object(
  {
    gesture: Type.Integer({ minimum: 0 }),
    cell: Cell,
    code: Type.Union(TERRAIN_EDIT_REFUSAL_CODES.map((value) => Type.Literal(value))),
    at: Cell,
  },
  { additionalProperties: false },
);
export type TerrainEditRefusal = Static<typeof TerrainEditRefusalSchema>;
/** Compact receipt: gestures that wrote heights, gestures without effect nor
 * refusal, vertices written; `refused` lists the refused units in processing
 * order, absent when none was refused. A batch where nothing is written and
 * something is refused answers 409 (code of the first refusal, `gesture` and
 * the same `refused` list in the body), as the all-or-nothing version did. */
export const TerrainEditsResultSchema = Type.Object(
  {
    gestures: Type.Integer({ minimum: 0 }),
    unchanged: Type.Integer({ minimum: 0 }),
    vertices: Type.Integer({ minimum: 0 }),
    refused: Type.Optional(Type.Array(TerrainEditRefusalSchema, { maxItems: TERRAIN_EDIT_CELLS_PER_COMMAND })),
  },
  { additionalProperties: false },
);
export type TerrainEditsResult = Static<typeof TerrainEditsResultSchema>;

type EditCell = { cellX: number; cellY: number };
/** The painted cells of a free gesture, in processing order (the canonical
 * order of `terraformCells`): each one is a unit, accepted or refused alone.
 * Throws on an invalid selection or height, as `terraformCells`. */
export function terrainEditCells(
  gesture: { anchor: EditCell; cells: readonly EditCell[]; height: number },
  world: SpatialDimensions,
): EditCell[] {
  return terraformCells(
    {
      buildingType: 'terrain',
      anchor: gesture.anchor,
      quarterTurns: 0,
      cells: [...gesture.cells],
      height: gesture.height,
      workerCount: 1,
    },
    world,
  );
}
/** What one painted cell writes: its four corners at the height
 * (`vertexLeveling` of that cell alone), the 3 × 3 cells it touches
 * (`affectedCells`) and its volume (below 1e-9: no effect). Shared by the
 * server's admission and the client's prediction. */
export function terrainEditUnit(
  cell: EditCell,
  world: SpatialDimensions,
  heightAt: (x: number, y: number) => number,
  height: number,
) {
  return vertexLeveling([cell], world, heightAt, 1, height);
}
/** One painted cell of a live stroke, at the height it was painted with. */
export interface TerrainEditPaint {
  cell: EditCell;
  height: number;
}
/**
 * The gestures that make the server apply painted cells in exactly the order
 * they were painted (docs/SPEC-TERRAFORMATION-OUTIL.md §7.9): the server
 * applies the gestures in batch order and the cells of one gesture in the
 * canonical order of `terrainEditCells` (x, then y), so a gesture is a run of
 * one height whose cells increase strictly in that order, at most
 * MAX_TERRAFORM_CELLS. Continues `previous` (the gestures already built for
 * the same command) when its last gesture can take the next cell.
 */
export function orderedTerrainEditGestures(
  paints: readonly TerrainEditPaint[],
  previous: FreeTerrainEditGesture[] = [],
): FreeTerrainEditGesture[] {
  const gestures = previous;
  for (const { cell, height } of paints) {
    const last = gestures.at(-1);
    const tail = last?.cells.at(-1);
    if (
      last &&
      tail &&
      last.height === height &&
      last.cells.length < MAX_TERRAFORM_CELLS &&
      (cell.cellX > tail.cellX || (cell.cellX === tail.cellX && cell.cellY > tail.cellY))
    )
      last.cells.push({ cellX: cell.cellX, cellY: cell.cellY });
    else
      gestures.push({
        buildingType: 'terrain',
        anchor: { cellX: cell.cellX, cellY: cell.cellY },
        cells: [{ cellX: cell.cellX, cellY: cell.cellY }],
        height,
      });
  }
  return gestures;
}
/**
 * The client's prediction of free gestures (docs/SPEC-TERRAFORMATION-OUTIL.md
 * §7): unit after unit in the server's order, each on the heights the previous
 * ones leave, exactly as the server applies the units it accepts. Returns the
 * written vertices by `vertexKey`; refusals are the server's to tell.
 */
export function predictTerrainEdits(
  gestures: readonly { anchor: EditCell; cells: readonly EditCell[]; height: number }[],
  world: SpatialDimensions,
  heightAt: (x: number, y: number) => number,
): Map<string, TerrainVertex> {
  const written = new Map<string, TerrainVertex>();
  const at = (x: number, y: number) => written.get(`${x}:${y}`)?.height ?? heightAt(x, y);
  for (const gesture of gestures)
    for (const cell of terrainEditCells(gesture, world)) {
      const plan = terrainEditUnit(cell, world, at, gesture.height);
      if (plan.volume < 1e-9) continue;
      for (const v of plan.vertices) written.set(vertexKey(v), v);
    }
  return written;
}

import './formats.js';
import { Type, type Static } from '@sinclair/typebox';
import type { SpatialDimensions } from './building-footprint.js';
import { MAX_TERRAFORM_CELLS, terraformCells } from './terraforming.js';
import {
  absoluteTriangleVolume,
  cellVertices,
  terrainHeightPrecision,
  vertexCells,
  vertexKey,
  vertexLeveling,
  type TerrainVertex,
} from './terrain-vertices.js';

/** Instant terrain edits (docs/SPEC-TERRAFORMATION-INSTANTANEE.md): one batch
 * of gestures, applied in order at admission; free, without workers or
 * duration. Since 2 November (docs/SPEC-TERRAFORMATION-OUTIL.md §7) a refusal
 * no longer voids the batch: each painted cell of a free gesture (with its
 * 3 × 3) and each footprint leveling is accepted or refused on its own. */
export const TERRAIN_EDIT_GESTURES_PER_COMMAND = 32;
export const TERRAIN_EDIT_CELLS_PER_COMMAND = 1024;
const coordinate = Type.Integer({ minimum: 0, maximum: 1_000_000 });
const Cell = Type.Object({ cellX: coordinate, cellY: coordinate }, { additionalProperties: false });
/** Bound of a restored corner height: far beyond any relief, a guard against absurd values. */
export const TERRAIN_RESTORE_HEIGHT_LIMIT = 1024;
const restoreHeights = () =>
  Type.Array(Type.Number({ minimum: -TERRAIN_RESTORE_HEIGHT_LIMIT, maximum: TERRAIN_RESTORE_HEIGHT_LIMIT }), {
    minItems: 4,
    maxItems: 4,
  });
const RestoreCell = Type.Object(
  {
    cellX: coordinate,
    cellY: coordinate,
    /** Corner heights in `cellVertices` order: (0,0), (1,0), (1,1), (0,1). */
    corners: restoreHeights(),
    /** The heights the undone stroke left at these corners (same order): a
     * corner is restored only while it is still at that height (§7.10). */
    expected: restoreHeights(),
  },
  { additionalProperties: false },
);
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
  /** Restoration (docs/SPEC-TERRAFORMATION-OUTIL.md §7.10, the undo of a
   * stroke): the corners of each cell still at the height the stroke left
   * (`expected`) back to the given heights, the others untouched. Each
   * cell is one unit, admitted under the rules of a painted cell; the cells
   * are processed in the given order, without duplicates. */
  Type.Object(
    {
      buildingType: Type.Literal('terrain-restore'),
      cells: Type.Array(RestoreCell, { minItems: 1, maxItems: 256 }),
    },
    { additionalProperties: false },
  ),
]);
export type TerrainEditGesture = Static<typeof TerrainEditGestureSchema>;
export type FreeTerrainEditGesture = Extract<TerrainEditGesture, { buildingType: 'terrain' }>;
export type RestoreTerrainEditGesture = Extract<TerrainEditGesture, { buildingType: 'terrain-restore' }>;
/** The gestures a live stroke sends: painted cells, or restored ones. */
export type LiveTerrainEditGesture = FreeTerrainEditGesture | RestoreTerrainEditGesture;
/** Cells a gesture counts against TERRAIN_EDIT_CELLS_PER_COMMAND (a footprint: 9). */
export const terrainEditCellCount = (gesture: TerrainEditGesture) =>
  gesture.buildingType === 'terrain' || gesture.buildingType === 'terrain-restore' ? gesture.cells.length : 9;
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
type RestoredCell = EditCell & { corners: readonly number[]; expected: readonly number[] };
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
/** The restored cells of a gesture, in processing order (the given order).
 * Throws on a coordinate outside the world, a duplicate cell or a corner that
 * is not a finite height within the bound. */
export function terrainRestoreCells(
  gesture: { cells: readonly RestoredCell[] },
  world: SpatialDimensions,
): RestoredCell[] {
  const seen = new Set<string>();
  for (const c of gesture.cells) {
    const k = `${c.cellX}:${c.cellY}`;
    if (
      !Number.isInteger(c.cellX) ||
      !Number.isInteger(c.cellY) ||
      c.cellX < 0 ||
      c.cellY < 0 ||
      c.cellX >= world.widthCells ||
      c.cellY >= world.heightCells ||
      seen.has(k) ||
      c.corners.length !== 4 ||
      c.expected.length !== 4 ||
      [...c.corners, ...c.expected].some((h) => !Number.isFinite(h) || Math.abs(h) > TERRAIN_RESTORE_HEIGHT_LIMIT)
    )
      throw Error('Invalid terrain restoration');
    seen.add(k);
  }
  return [...gesture.cells];
}
/** Whether a corner is still at the height the undone stroke left: equal at
 * the precision of the stored heights (1e-6). */
export const terrainCornerIntact = (current: number, expected: number) =>
  Math.abs(terrainHeightPrecision(current) - terrainHeightPrecision(expected)) < 1e-9;
/** What one restored cell writes (docs/SPEC-TERRAFORMATION-OUTIL.md §7.10,
 * « restaure seulement les sommets intacts »): each corner (`cellVertices`
 * order) still at its `expected` height goes back to its `corners` height; a
 * corner changed since keeps its current height. Also the 3 × 3 cells it
 * touches and its volume (below 1e-9: no effect, e.g. no corner intact),
 * measured as `terrainEditUnit` measures a painted cell. Shared by the
 * server's admission and the client's prediction. */
export function terrainRestoreUnit(
  cell: EditCell,
  world: SpatialDimensions,
  heightAt: (x: number, y: number) => number,
  corners: readonly number[],
  expected: readonly number[],
) {
  const vertices = cellVertices(cell, world).map((v, i) => {
    const current = heightAt(v.vertexX, v.vertexY);
    return {
      ...v,
      height: terrainHeightPrecision(terrainCornerIntact(current, expected[i]!) ? corners[i]! : current),
    };
  });
  if (vertices.some((v) => !Number.isFinite(v.height))) throw Error('Invalid terrain restoration');
  const next = new Map(vertices.map((v) => [vertexKey(v), v.height])),
    affectedCells = vertexCells(vertices, world);
  let volume = 0;
  for (const c of affectedCells) {
    const vs = cellVertices(c, world);
    for (const triangle of [
      [vs[0]!, vs[1]!, vs[2]!],
      [vs[0]!, vs[2]!, vs[3]!],
    ]) {
      const delta = triangle.map((v) => {
        const target = next.get(vertexKey(v));
        return target === undefined ? 0 : target - heightAt(v.vertexX, v.vertexY);
      }) as [number, number, number];
      if (delta.some((d) => !Number.isFinite(d))) throw Error('Terrain heights unavailable');
      volume += absoluteTriangleVolume(delta);
    }
  }
  return { vertices, affectedCells, volume };
}
/** One painted cell of a live stroke, at the height it was painted with. */
export interface TerrainEditPaint {
  cell: EditCell;
  height: number;
}
/** One restored cell of an undo: its four corner heights (`cellVertices` order)
 * and the heights the stroke left there (restored only while intact). */
export interface TerrainEditRestore {
  cell: EditCell;
  corners: readonly number[];
  expected: readonly number[];
}
/** One unit of a live stroke: a painted cell, or a restored one. */
export type TerrainEditStep = TerrainEditPaint | TerrainEditRestore;
export const isTerrainEditRestore = (step: TerrainEditStep): step is TerrainEditRestore => 'corners' in step;
/**
 * The gestures that make the server apply painted cells in exactly the order
 * they were painted (docs/SPEC-TERRAFORMATION-OUTIL.md §7.9): the server
 * applies the gestures in batch order and the cells of one gesture in the
 * canonical order of `terrainEditCells` (x, then y), so a gesture is a run of
 * one height whose cells increase strictly in that order, at most
 * MAX_TERRAFORM_CELLS. Restored cells (§7.10) keep the given order in
 * restoration gestures. Continues `previous` (the gestures already built for
 * the same command) when its last gesture can take the next cell.
 */
export function orderedTerrainEditGestures(
  steps: readonly TerrainEditStep[],
  previous: LiveTerrainEditGesture[] = [],
): LiveTerrainEditGesture[] {
  const gestures = previous;
  for (const step of steps) {
    const last = gestures.at(-1);
    if (isTerrainEditRestore(step)) {
      // A cell already restored by the gesture starts another one (no duplicates).
      const { cell, corners, expected } = step;
      if (
        last?.buildingType === 'terrain-restore' &&
        last.cells.length < MAX_TERRAFORM_CELLS &&
        !last.cells.some((c) => c.cellX === cell.cellX && c.cellY === cell.cellY)
      )
        last.cells.push({ cellX: cell.cellX, cellY: cell.cellY, corners: [...corners], expected: [...expected] });
      else
        gestures.push({
          buildingType: 'terrain-restore',
          cells: [{ cellX: cell.cellX, cellY: cell.cellY, corners: [...corners], expected: [...expected] }],
        });
      continue;
    }
    const { cell, height } = step;
    const tail = last?.buildingType === 'terrain' ? last.cells.at(-1) : undefined;
    if (
      last?.buildingType === 'terrain' &&
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
 * The client's prediction of free and restoration gestures
 * (docs/SPEC-TERRAFORMATION-OUTIL.md §7): unit after unit in the server's
 * order, each on the heights the previous ones leave, exactly as the server
 * applies the units it accepts. Returns the written vertices by `vertexKey`;
 * refusals are the server's to tell.
 */
export function predictTerrainEdits(
  gestures: readonly (
    | { anchor: EditCell; cells: readonly EditCell[]; height: number }
    | { buildingType: 'terrain-restore'; cells: readonly RestoredCell[] }
  )[],
  world: SpatialDimensions,
  heightAt: (x: number, y: number) => number,
): Map<string, TerrainVertex> {
  const written = new Map<string, TerrainVertex>();
  const at = (x: number, y: number) => written.get(`${x}:${y}`)?.height ?? heightAt(x, y);
  const write = (plan: { volume: number; vertices: TerrainVertex[] }) => {
    if (plan.volume < 1e-9) return;
    for (const v of plan.vertices) written.set(vertexKey(v), v);
  };
  for (const gesture of gestures)
    if ('height' in gesture)
      for (const cell of terrainEditCells(gesture, world)) write(terrainEditUnit(cell, world, at, gesture.height));
    else
      for (const cell of terrainRestoreCells(gesture, world))
        write(terrainRestoreUnit(cell, world, at, cell.corners, cell.expected));
  return written;
}

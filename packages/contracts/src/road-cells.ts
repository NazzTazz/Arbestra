import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

/** Road cells (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §4): the cell is the
 * unit of placement, the road is centred in it; elbows, T and crossings are
 * inferred from the neighbours. One row per cell server-side (road_cells). */
export const ROAD_CELL_SURFACES = ['earth', 'rubble', 'stone-1', 'stone-2'] as const;
export const RoadCellSurfaceSchema = Type.Union(ROAD_CELL_SURFACES.map((value) => Type.Literal(value)));
export type RoadCellSurface = (typeof ROAD_CELL_SURFACES)[number];
/** `charretiere` (two cells wide) is reserved for the harnessed transport and
 * refused until it is specified: S1 places single-cell `chemin` only. */
export const RoadCellGaugeSchema = Type.Union([Type.Literal('chemin'), Type.Literal('charretiere')]);
export type RoadCellGauge = Static<typeof RoadCellGaugeSchema>;
/** Most cells one gesture may name (one V2 command per gesture). */
export const ROAD_CELLS_PER_COMMAND = 256;
/** Stones per cell, the validated barème of the manual roads brought to the
 * cell: a stone surface 4 (4 units × 256 sixteenths), a sidewalk 1 per side. */
export const ROAD_CELL_STONE_SURFACE = 4;
export const ROAD_CELL_SIDEWALKS = 2;

export const RoadCellStyleSchema = Type.Object(
  {
    surface: RoadCellSurfaceSchema,
    sidewalks: Type.Boolean(),
    gauge: Type.Optional(RoadCellGaugeSchema),
  },
  { additionalProperties: false },
);
export type RoadCellStyle = Static<typeof RoadCellStyleSchema>;
const coordinate = Type.Integer({ minimum: 0, maximum: 1_000_000 });
export const RoadCellPositionSchema = Type.Object(
  { cellX: coordinate, cellY: coordinate },
  { additionalProperties: false },
);
export type RoadCellPosition = Static<typeof RoadCellPositionSchema>;
const cells = Type.Array(RoadCellPositionSchema, { minItems: 1, maxItems: ROAD_CELLS_PER_COMMAND });
export const RoadCellsQuoteSchema = Type.Object(
  { stone: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);
export type RoadCellsQuote = Static<typeof RoadCellsQuoteSchema>;
/** A gesture: place (or restyle) cells with one style, or remove them. */
export const RoadCellsRequestSchema = Type.Union([
  Type.Object(
    {
      commandId: Type.String({ format: 'uuid' }),
      action: Type.Literal('place'),
      cells,
      style: RoadCellStyleSchema,
      expectedQuote: RoadCellsQuoteSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { commandId: Type.String({ format: 'uuid' }), action: Type.Literal('remove'), cells },
    { additionalProperties: false },
  ),
]);
export type RoadCellsRequest = Static<typeof RoadCellsRequestSchema>;
/** Read-only quote of a gesture: the same body without identifier or quote. */
export const RoadCellsPreviewRequestSchema = Type.Union([
  Type.Object({ action: Type.Literal('place'), cells, style: RoadCellStyleSchema }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('remove'), cells }, { additionalProperties: false }),
]);
export type RoadCellsPreviewRequest = Static<typeof RoadCellsPreviewRequestSchema>;
/** Per-cell refusals of a placement (Tristan, 30 October): such a cell is
 * skipped, the valid cells of the gesture are placed. Refusals of the whole
 * gesture (resources, stale quote, gauge, reused identifier) stay global. */
export const ROAD_CELL_SKIP_CODES = [
  'OUTSIDE_INFRASTRUCTURE_REACH',
  'FOREIGN_INFRASTRUCTURE',
  'CELL_OCCUPIED',
  'INCOMPATIBLE_TERRAIN',
] as const;
export type RoadCellSkipCode = (typeof ROAD_CELL_SKIP_CODES)[number];
export const RoadCellSkipSchema = Type.Object(
  {
    cellX: coordinate,
    cellY: coordinate,
    code: Type.Union(ROAD_CELL_SKIP_CODES.map((value) => Type.Literal(value))),
  },
  { additionalProperties: false },
);
export type RoadCellSkip = Static<typeof RoadCellSkipSchema>;
/** Compact receipt: counts and the stone debited, never the placed cells
 * themselves (their values travel as V2 effects). `skipped` lists the cells a
 * placement skipped, in gesture order; absent when none was skipped. */
export const RoadCellsResultSchema = Type.Object(
  {
    placed: Type.Integer({ minimum: 0 }),
    restyled: Type.Integer({ minimum: 0 }),
    removed: Type.Integer({ minimum: 0 }),
    unchanged: Type.Integer({ minimum: 0 }),
    stone: Type.Integer({ minimum: 0 }),
    skipped: Type.Optional(Type.Array(RoadCellSkipSchema, { maxItems: ROAD_CELLS_PER_COMMAND })),
  },
  { additionalProperties: false },
);
export type RoadCellsResult = Static<typeof RoadCellsResultSchema>;
/** Quote of a gesture. A placement with at least one valid cell is valid and
 * quotes those cells; `result.skipped` names the others. When every cell is
 * skipped, it is invalid with the code of the first one, and still lists them. */
export const RoadCellsPreviewSchema = Type.Object(
  {
    valid: Type.Boolean(),
    code: Type.Union([Type.String(), Type.Null()]),
    message: Type.Union([Type.String(), Type.Null()]),
    quote: RoadCellsQuoteSchema,
    result: RoadCellsResultSchema,
  },
  { additionalProperties: false },
);
export type RoadCellsPreview = Static<typeof RoadCellsPreviewSchema>;
/** One road cell of the private V2 stream, keyed `x,y` like garden plots. */
export const RoadCellSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[0-9]+,[0-9]+$' }),
    cellX: Type.Integer({ minimum: 0 }),
    cellY: Type.Integer({ minimum: 0 }),
    surface: RoadCellSurfaceSchema,
    sidewalks: Type.Boolean(),
    gauge: RoadCellGaugeSchema,
    revision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type RoadCell = Static<typeof RoadCellSchema>;
/** A gesture may pass over the same cell twice (Tristan, 30 October: not a
 * refusal). Each cell counts once, in first-seen order; command, quote and the
 * idempotent content of a `commandId` all use this list. */
export function uniqueRoadCells<T extends RoadCellPosition>(cells: readonly T[]): T[] {
  const seen = new Set<string>();
  return cells.filter((cell) => {
    const key = cell.cellX + ':' + cell.cellY;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export const roadCellsRequestIsValid = (value: unknown): value is RoadCellsRequest =>
  Value.Check(RoadCellsRequestSchema, value);

const styleCost = (style: Pick<RoadCellStyle, 'surface' | 'sidewalks'>) =>
  (style.surface === 'stone-1' || style.surface === 'stone-2' ? ROAD_CELL_STONE_SURFACE : 0) +
  (style.sidewalks ? ROAD_CELL_SIDEWALKS : 0);
/** Stones a style costs on a cell that holds `current` (null: no road).
 * Validated by Tristan (30 October), the default rule of the game: a dearer
 * style pays the difference, a cheaper one or a removal refunds nothing.
 * Stone surface 4, sidewalks 2 (1 per side), earth and rubble free. */
export function roadCellStoneCost(
  current: Pick<RoadCell, 'surface' | 'sidewalks'> | null,
  style: Pick<RoadCellStyle, 'surface' | 'sidewalks'>,
): number {
  return Math.max(0, styleCost(style) - (current ? styleCost(current) : 0));
}

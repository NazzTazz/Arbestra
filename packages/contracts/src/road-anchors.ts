import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

/** Anchors and accessories of the road cells (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §5,
 * O4 decided by Tristan on 30 October).
 *
 * An anchor is a **vertex of the cell grid**: the corner shared by up to four
 * cells. Vertex `(vertexX, vertexY)` is the top-left corner of cell
 * `(vertexX, vertexY)`; it touches cells `(vertexX-1|vertexX, vertexY-1|vertexY)`
 * (on the torus) and lies at cell coordinates `(vertexX-0.5, vertexY-0.5)`,
 * cell centres being integers. Coordinates are canonical: `0 <= vertexX < width`.
 *
 * For a village, an anchor exists while one of **its** road cells touches the
 * vertex. Accessories live only on anchors (no brazier elsewhere), and block
 * passage: their footprint is the same ±1/8 cell box as a legacy equipment.
 *
 * - **Automatic brazier**: a re-entrant (concave) corner of the village's road
 *   cells, i.e. a vertex with exactly three of its four cells being road cells
 *   of that village. Derived, never stored.
 * - **Stored state** (`road_anchors`, V2 component `roadAnchors`): one row per
 *   vertex in the world (single owner). `accessory` is a manual accessory, or
 *   `none`: the village emptied the anchor, which suppresses its automatic
 *   brazier. A `none` row exists only where it suppresses something.
 * - An accessory leaves with the last road cell of its village touching the
 *   vertex (road cell removal deletes the row). */
export const ROAD_ACCESSORY_KINDS = ['brazier'] as const;
export const RoadAccessoryKindSchema = Type.Union(ROAD_ACCESSORY_KINDS.map((value) => Type.Literal(value)));
export type RoadAccessoryKind = (typeof ROAD_ACCESSORY_KINDS)[number];
/** Stored state of an anchor: an accessory, or `none` (emptied by the village). */
export const RoadAnchorAccessorySchema = Type.Union([RoadAccessoryKindSchema, Type.Literal('none')]);
export type RoadAnchorAccessory = Static<typeof RoadAnchorAccessorySchema>;
/** Most anchors one gesture may name (proposed). */
export const ROAD_ANCHORS_PER_COMMAND = 64;
/** Price of a manual accessory, the price of the legacy manual brazier
 * (2 stones, 1 wood). Restoring an automatic brazier is free; removing
 * refunds nothing (default rule of the game). */
export const ROAD_ACCESSORY_PRICES: Record<RoadAccessoryKind, { stone: number; wood: number }> = {
  brazier: { stone: 2, wood: 1 },
};

const coordinate = Type.Integer({ minimum: 0, maximum: 1_000_000 });
export const RoadAnchorPositionSchema = Type.Object(
  { vertexX: coordinate, vertexY: coordinate },
  { additionalProperties: false },
);
export type RoadAnchorPosition = Static<typeof RoadAnchorPositionSchema>;
const anchors = Type.Array(RoadAnchorPositionSchema, { minItems: 1, maxItems: ROAD_ANCHORS_PER_COMMAND });
export const RoadAnchorsQuoteSchema = Type.Object(
  { stone: Type.Integer({ minimum: 0 }), wood: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);
export type RoadAnchorsQuote = Static<typeof RoadAnchorsQuoteSchema>;
/** One gesture: put an accessory on anchors, or empty them.
 * - `place`: an empty anchor receives the accessory (price per anchor); an
 *   anchor whose automatic brazier was removed by the village gets it back for
 *   free when the accessory is a brazier (`restored`); an anchor already
 *   showing the accessory is `unchanged`.
 * - `remove`: a manual accessory is removed, an automatic brazier is
 *   suppressed (persisted); an empty anchor is `unchanged`. */
export const RoadAnchorsRequestSchema = Type.Union([
  Type.Object(
    {
      commandId: Type.String({ format: 'uuid' }),
      action: Type.Literal('place'),
      accessory: RoadAccessoryKindSchema,
      anchors,
      expectedQuote: RoadAnchorsQuoteSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { commandId: Type.String({ format: 'uuid' }), action: Type.Literal('remove'), anchors },
    { additionalProperties: false },
  ),
]);
export type RoadAnchorsRequest = Static<typeof RoadAnchorsRequestSchema>;
/** Read-only quote: the same body without identifier or quote. */
export const RoadAnchorsPreviewRequestSchema = Type.Union([
  Type.Object(
    { action: Type.Literal('place'), accessory: RoadAccessoryKindSchema, anchors },
    { additionalProperties: false },
  ),
  Type.Object({ action: Type.Literal('remove'), anchors }, { additionalProperties: false }),
]);
export type RoadAnchorsPreviewRequest = Static<typeof RoadAnchorsPreviewRequestSchema>;
/** Per-anchor refusals of a placement, first rule wins; such an anchor is
 * skipped and the others are placed (as road cells, S2d). Every anchor
 * refused: refusal of the gesture with the first code.
 * - `ANCHOR_MISSING`: no road cell of the village touches the vertex;
 * - `FOREIGN_INFRASTRUCTURE`: another village holds the vertex (stored row or
 *   its automatic brazier);
 * - `ANCHOR_OCCUPIED`: another accessory of the village is there;
 * - `ENGAGED_PASSAGE`: a trip in progress (any village) crosses the anchor. */
export const ROAD_ANCHOR_SKIP_CODES = [
  'ANCHOR_MISSING',
  'FOREIGN_INFRASTRUCTURE',
  'ANCHOR_OCCUPIED',
  'ENGAGED_PASSAGE',
] as const;
export type RoadAnchorSkipCode = (typeof ROAD_ANCHOR_SKIP_CODES)[number];
export const RoadAnchorSkipSchema = Type.Object(
  {
    vertexX: coordinate,
    vertexY: coordinate,
    code: Type.Union(ROAD_ANCHOR_SKIP_CODES.map((value) => Type.Literal(value))),
  },
  { additionalProperties: false },
);
export type RoadAnchorSkip = Static<typeof RoadAnchorSkipSchema>;
/** Compact receipt: counts and the resources debited; the anchors themselves
 * travel as V2 effects (`roadAnchors`, and `resources`). */
export const RoadAnchorsResultSchema = Type.Object(
  {
    placed: Type.Integer({ minimum: 0 }),
    restored: Type.Integer({ minimum: 0 }),
    removed: Type.Integer({ minimum: 0 }),
    unchanged: Type.Integer({ minimum: 0 }),
    stone: Type.Integer({ minimum: 0 }),
    wood: Type.Integer({ minimum: 0 }),
    skipped: Type.Optional(Type.Array(RoadAnchorSkipSchema, { maxItems: ROAD_ANCHORS_PER_COMMAND })),
  },
  { additionalProperties: false },
);
export type RoadAnchorsResult = Static<typeof RoadAnchorsResultSchema>;
export const RoadAnchorsPreviewSchema = Type.Object(
  {
    valid: Type.Boolean(),
    code: Type.Union([Type.String(), Type.Null()]),
    message: Type.Union([Type.String(), Type.Null()]),
    quote: RoadAnchorsQuoteSchema,
    result: RoadAnchorsResultSchema,
  },
  { additionalProperties: false },
);
export type RoadAnchorsPreview = Static<typeof RoadAnchorsPreviewSchema>;
/** One stored anchor of the private V2 stream, keyed `x,y` (vertex). */
export const RoadAnchorSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[0-9]+,[0-9]+$' }),
    vertexX: Type.Integer({ minimum: 0 }),
    vertexY: Type.Integer({ minimum: 0 }),
    accessory: RoadAnchorAccessorySchema,
    revision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type RoadAnchor = Static<typeof RoadAnchorSchema>;
export const roadAnchorsRequestIsValid = (value: unknown): value is RoadAnchorsRequest =>
  Value.Check(RoadAnchorsRequestSchema, value);

type World = { widthCells: number; heightCells: number };
type Cell = { cellX: number; cellY: number };
const wrap = (value: number, size: number) => ((value % size) + size) % size;
const cellKey = (x: number, y: number) => x + ':' + y;

/** The four cells around a vertex, canonical. */
export function roadAnchorCells(vertex: RoadAnchorPosition, world: World): Cell[] {
  const result: Cell[] = [];
  for (const dy of [-1, 0])
    for (const dx of [-1, 0])
      result.push({
        cellX: wrap(vertex.vertexX + dx, world.widthCells),
        cellY: wrap(vertex.vertexY + dy, world.heightCells),
      });
  return result;
}
/** The four vertices (corners) of a cell, canonical. */
export function roadCellAnchors(cell: Cell, world: World): RoadAnchorPosition[] {
  const result: RoadAnchorPosition[] = [];
  for (const dy of [0, 1])
    for (const dx of [0, 1])
      result.push({
        vertexX: wrap(cell.cellX + dx, world.widthCells),
        vertexY: wrap(cell.cellY + dy, world.heightCells),
      });
  return result;
}
/** Position of an anchor in eighths of a cell (the legacy SubPoint grid). */
export function roadAnchorSubPoint(vertex: RoadAnchorPosition, world: World): { x: number; y: number } {
  return {
    x: wrap(vertex.vertexX * 8 - 4, world.widthCells * 8),
    y: wrap(vertex.vertexY * 8 - 4, world.heightCells * 8),
  };
}
/** Re-entrant corners of one village's road cells: vertices with exactly three
 * of their four cells being road cells. Linear in the cells. */
export function automaticRoadBraziers(cells: readonly Cell[], world: World): RoadAnchorPosition[] {
  const roads = new Set(cells.map((c) => cellKey(c.cellX, c.cellY)));
  const seen = new Set<string>();
  const result: RoadAnchorPosition[] = [];
  for (const cell of cells)
    for (const vertex of roadCellAnchors(cell, world)) {
      const key = cellKey(vertex.vertexX, vertex.vertexY);
      if (seen.has(key)) continue;
      seen.add(key);
      let count = 0;
      for (const c of roadAnchorCells(vertex, world)) if (roads.has(cellKey(c.cellX, c.cellY))) count++;
      if (count === 3) result.push(vertex);
    }
  return result.sort((a, b) => a.vertexX - b.vertexX || a.vertexY - b.vertexY);
}
export interface RoadAnchorAccessoryView extends RoadAnchorPosition {
  kind: RoadAccessoryKind;
  /** An automatic brazier (re-entrant corner), not stored. */
  automatic: boolean;
}
/** Accessories one village shows: its stored accessories, plus its automatic
 * braziers where it stored nothing (a `none` row suppresses one). What S4b
 * renders and what navigation treats as obstacles. Sorted by vertex. */
export function roadAnchorAccessories(
  cells: readonly Cell[],
  stored: ReadonlyArray<Pick<RoadAnchor, 'vertexX' | 'vertexY' | 'accessory'>>,
  world: World,
): RoadAnchorAccessoryView[] {
  const rows = new Map(stored.map((row) => [cellKey(row.vertexX, row.vertexY), row]));
  const result: RoadAnchorAccessoryView[] = [];
  for (const row of stored)
    if (row.accessory !== 'none')
      result.push({ vertexX: row.vertexX, vertexY: row.vertexY, kind: row.accessory, automatic: false });
  for (const vertex of automaticRoadBraziers(cells, world))
    if (!rows.has(cellKey(vertex.vertexX, vertex.vertexY)))
      result.push({ ...vertex, kind: 'brazier', automatic: true });
  return result.sort((a, b) => a.vertexX - b.vertexX || a.vertexY - b.vertexY);
}

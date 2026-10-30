import { Type, type Static } from '@sinclair/typebox';
import type { VillageState } from './villages.js';
import { type BuildingAccess, type BuildingAccessState } from './building-access.js';
import { coarseTravelPath, type TravelRoute } from './travel-paths.js';
import { RoadCellSchema, type RoadCell } from './road-cells.js';

export const SUBDIVISIONS = 8;
export const MATERIAL_UNITS = 256;
export const SubPointSchema = Type.Object({ x: Type.Integer({ minimum: 0 }), y: Type.Integer({ minimum: 0 }) });
export const RoadMaterialSchema = Type.Union(
  ['none', 'earth', 'rubble', 'stone-1', 'stone-2'].map((value) => Type.Literal(value)),
);
export type RoadMaterial = Static<typeof RoadMaterialSchema>;
export type SubPoint = Static<typeof SubPointSchema>;
export const RoadStrokeSchema = Type.Object({
  id: Type.String(),
  points: Type.Array(SubPointSchema, { minItems: 2, maxItems: 3 }),
  width: Type.Integer({ minimum: 2, maximum: 8 }),
  material: RoadMaterialSchema,
  border: Type.Boolean(),
  operation: Type.Union([Type.Literal('paint'), Type.Literal('border'), Type.Literal('remove')]),
});
export type RoadStroke = Static<typeof RoadStrokeSchema>;
export const InfrastructureEquipmentSchema = Type.Object({
  id: Type.String(),
  x: Type.Integer({ minimum: 0 }),
  y: Type.Integer({ minimum: 0 }),
  quarterTurns: Type.Integer({ minimum: 0, maximum: 3 }),
  version: Type.Integer({ minimum: 1 }),
});
export type InfrastructureEquipment = Static<typeof InfrastructureEquipmentSchema>;
export const InfrastructurePlanSchema = Type.Object({
  revision: Type.Integer({ minimum: 0 }),
  roads: Type.Array(RoadStrokeSchema),
  equipment: Type.Array(InfrastructureEquipmentSchema),
  manualLighting: Type.Array(Type.String()),
  suppressedBraziers: Type.Array(Type.String()),
  stoneReserve: Type.Integer({ minimum: 0, maximum: 255 }),
  inheritedRoads: Type.Optional(Type.Array(RoadStrokeSchema)),
  inheritedCells: Type.Optional(Type.Array(Type.String())),
  /** Navigation input only, never stored in the JSONB plan: the road cells
   * (road_cells) of this village and its neighbours, merged by the server's
   * navigation reader and rasterized over the manual surface. */
  roadCells: Type.Optional(Type.Array(Type.Pick(RoadCellSchema, ['cellX', 'cellY', 'surface', 'sidewalks']))),
});
export type InfrastructurePlan = Static<typeof InfrastructurePlanSchema>;
export const emptyInfrastructure = (): InfrastructurePlan => ({
  revision: 0,
  roads: [],
  equipment: [],
  manualLighting: [],
  suppressedBraziers: [],
  stoneReserve: 0,
});
export const InfrastructureOperationSchema = Type.Union([
  Type.Object({ kind: Type.Literal('road'), stroke: RoadStrokeSchema }),
  Type.Object({
    kind: Type.Literal('place'),
    position: SubPointSchema,
    quarterTurns: Type.Integer({ minimum: 0, maximum: 3 }),
  }),
  Type.Object({
    kind: Type.Literal('move'),
    id: Type.String(),
    version: Type.Integer({ minimum: 0 }),
    position: SubPointSchema,
    quarterTurns: Type.Integer({ minimum: 0, maximum: 3 }),
  }),
  Type.Object({
    kind: Type.Literal('delete'),
    id: Type.String(),
    version: Type.Integer({ minimum: 0 }),
    position: Type.Optional(SubPointSchema),
  }),
  Type.Object({ kind: Type.Literal('lighting'), cell: Type.String() }),
  Type.Object({ kind: Type.Literal('undo'), target: Type.String({ format: 'uuid' }) }),
]);
export type InfrastructureOperation = Static<typeof InfrastructureOperationSchema>;
export const InfrastructureQuoteSchema = Type.Object({
  stoneUnits: Type.Integer({ minimum: 0 }),
  stoneDebit: Type.Integer({ minimum: 0 }),
  woodDebit: Type.Integer({ minimum: 0 }),
  reserveAfter: Type.Integer({ minimum: 0, maximum: 255 }),
});
export type InfrastructureQuote = Static<typeof InfrastructureQuoteSchema>;
export const InfrastructureRequestSchema = Type.Object({
  commandId: Type.String({ format: 'uuid' }),
  sessionId: Type.String({ format: 'uuid' }),
  revision: Type.Integer({ minimum: 0 }),
  operation: InfrastructureOperationSchema,
  expected: Type.Optional(InfrastructureQuoteSchema),
});
export type InfrastructureRequest = Static<typeof InfrastructureRequestSchema>;
export const InfrastructurePreviewSchema = Type.Object({
  valid: Type.Boolean(),
  message: Type.Union([Type.String(), Type.Null()]),
  quote: InfrastructureQuoteSchema,
  revision: Type.Integer({ minimum: 0 }),
});
export type InfrastructurePreview = Static<typeof InfrastructurePreviewSchema>;

export const wrapCoordinate = (n: number, size: number) => ((n % size) + size) % size;
export function wrappedDistance(n: number, origin: number, size: number) {
  const d = n - origin;
  return d > size / 2 ? d - size : d < -size / 2 ? d + size : d;
}
export const subCellKey = (p: SubPoint, world?: { widthCells: number; heightCells: number }) =>
  `${world ? wrapCoordinate(Math.floor((p.x + 4) / 8), world.widthCells) : Math.floor((p.x + 4) / 8)}:${world ? wrapCoordinate(Math.floor((p.y + 4) / 8), world.heightCells) : Math.floor((p.y + 4) / 8)}`;
export const pixelKey = (x: number, y: number) => `${x}:${y}`;
export interface RoadPixel {
  x: number;
  y: number;
  material: RoadMaterial;
  border: boolean;
  manual: boolean;
  axes: number;
  inherited?: boolean;
}
export function sameInfrastructureSurface(
  a: ReadonlyMap<string, RoadPixel>,
  b: ReadonlyMap<string, RoadPixel>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, p] of a) {
    const q = b.get(key);
    if (
      !q ||
      p.x !== q.x ||
      p.y !== q.y ||
      p.material !== q.material ||
      p.border !== q.border ||
      p.manual !== q.manual ||
      p.axes !== q.axes ||
      p.inherited !== q.inherited
    )
      return false;
  }
  return true;
}
/** Surface raster is transient: integer sixteenths, not individual persistent entities. */
export function infrastructureSurface(
  roads: readonly RoadStroke[],
  world: { widthCells: number; heightCells: number },
  base?: ReadonlyMap<string, RoadPixel>,
  history: readonly RoadStroke[] = [],
): Map<string, RoadPixel> {
  const result = new Map<string, RoadPixel>(base),
    w = world.widthCells * 16,
    h = world.heightCells * 16;
  for (const [roadIndex, road] of roads.entries()) {
    // Replacing the same centreline also retracts its old width. Cross streets survive.
    if (road.operation === 'paint')
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1]!,
          b = road.points[i]!,
          horizontal = a.y === b.y,
          axis = horizontal ? 1 : 2;
        for (const oldRoad of [...history, ...roads.slice(0, roadIndex)])
          for (let j = 1; j < oldRoad.points.length; j++) {
            const c = oldRoad.points[j - 1]!,
              d = oldRoad.points[j]!;
            if (
              oldRoad.width <= road.width ||
              oldRoad.operation !== 'paint' ||
              (horizontal ? c.y !== a.y || d.y !== a.y : c.x !== a.x || d.x !== a.x)
            )
              continue;
            const alongSize = horizontal ? w : h,
              start = (horizontal ? a.x : a.y) * 2,
              end = start + wrappedDistance(horizontal ? b.x : b.y, horizontal ? a.x : a.y, alongSize / 2) * 2;
            const oa = (horizontal ? c.x : c.y) * 2,
              ob = oa + wrappedDistance(horizontal ? d.x : d.y, horizontal ? c.x : c.y, alongSize / 2) * 2;
            for (const [key, p] of result) {
              const along = horizontal ? p.x : p.y,
                cross = horizontal ? p.y : p.x;
              const n = start + wrappedDistance(along, start, alongSize),
                o = oa + wrappedDistance(along, oa, alongSize);
              if (
                p.axes === axis &&
                n >= Math.min(start, end) &&
                n < Math.max(start, end) &&
                o >= Math.min(oa, ob) &&
                o < Math.max(oa, ob) &&
                Math.abs(wrappedDistance(cross, (horizontal ? a.y : a.x) * 2, horizontal ? h : w) + 0.5) >= road.width
              )
                result.set(key, { ...p, manual: false, border: false, material: 'none' });
            }
          }
      }
    const rects: Array<{ x0: number; y0: number; x1: number; y1: number; axes: number }> = [];
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!,
        b = road.points[i]!,
        dx = wrappedDistance(b.x, a.x, w / 2) * 2,
        dy = wrappedDistance(b.y, a.y, h / 2) * 2;
      if (dx && dy) throw new Error('Le tracé doit suivre les axes X et Y.');
      if (!dx && !dy) continue;
      const x = a.x * 2,
        y = a.y * 2,
        r = road.width;
      rects.push(
        dx
          ? { x0: Math.min(x, x + dx), x1: Math.max(x, x + dx), y0: y - r, y1: y + r, axes: 1 }
          : { x0: x - r, x1: x + r, y0: Math.min(y, y + dy), y1: Math.max(y, y + dy), axes: 2 },
      );
      if (i < road.points.length - 1)
        rects.push({ x0: b.x * 2 - r, x1: b.x * 2 + r, y0: b.y * 2 - r, y1: b.y * 2 + r, axes: 3 });
    }
    for (const r of rects)
      for (let y = r.y0; y < r.y1; y++)
        for (let x = r.x0; x < r.x1; x++) {
          const xx = wrapCoordinate(x, w),
            yy = wrapCoordinate(y, h),
            key = pixelKey(xx, yy),
            old = result.get(key);
          if (road.operation === 'border' && !old?.manual) continue;
          if (road.operation === 'remove' && !old?.manual) continue;
          result.set(key, {
            x: xx,
            y: yy,
            material: road.operation === 'border' ? old!.material : road.material,
            border: road.operation === 'remove' ? false : road.border,
            manual: road.operation !== 'remove',
            axes: (old?.axes ?? 0) | r.axes,
            ...(road.operation === 'border' && old?.inherited ? { inherited: true } : {}),
          });
        }
  }
  return result;
}
export function infrastructurePlanSurface(
  plan: InfrastructurePlan,
  world: { widthCells: number; heightCells: number },
): Map<string, RoadPixel> {
  const captured = new Set(plan.inheritedCells),
    base = infrastructureSurface(plan.inheritedRoads ?? [], world);
  for (const [key, p] of base) {
    const cell = `${Math.floor((p.x + 8) / 16) % world.widthCells}:${Math.floor((p.y + 8) / 16) % world.heightCells}`;
    if (!captured.has(cell)) base.delete(key);
    else p.inherited = true;
  }
  const surface = infrastructureSurface(plan.roads, world, base);
  if (plan.roadCells?.length) overlayRoadCells(surface, plan.roadCells, world);
  return surface;
}
/** Road cells drawn as a centred chemin over the manual surface, as manual
 * pixels: navigation prefers them exactly as it prefers a manual road. Each
 * cell paints its centre square (half a cell wide, the automatic road width)
 * and one arm towards each neighbouring road cell; isolated, only the centre.
 * Linear in the cells: no stroke history to replay. */
export function overlayRoadCells(
  surface: Map<string, RoadPixel>,
  cells: readonly Pick<RoadCell, 'cellX' | 'cellY' | 'surface' | 'sidewalks'>[],
  world: { widthCells: number; heightCells: number },
): void {
  const present = new Set(cells.map((c) => c.cellX + ':' + c.cellY)),
    w = world.widthCells * 16,
    h = world.heightCells * 16;
  const paint = (x0: number, y0: number, x1: number, y1: number, axes: number, cell: (typeof cells)[number]) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const xx = wrapCoordinate(x, w),
          yy = wrapCoordinate(y, h),
          key = pixelKey(xx, yy),
          old = surface.get(key);
        surface.set(key, {
          x: xx,
          y: yy,
          material: cell.surface,
          border: cell.sidewalks,
          manual: true,
          axes: (old?.manual ? old.axes : 0) | axes,
        });
      }
  };
  for (const cell of cells) {
    const cx = cell.cellX * 16,
      cy = cell.cellY * 16,
      at = (dx: number, dy: number) =>
        present.has(
          wrapCoordinate(cell.cellX + dx, world.widthCells) + ':' + wrapCoordinate(cell.cellY + dy, world.heightCells),
        );
    const east = at(1, 0),
      west = at(-1, 0),
      south = at(0, 1),
      north = at(0, -1);
    const horizontal = east || west,
      vertical = south || north;
    paint(cx - 4, cy - 4, cx + 4, cy + 4, (horizontal ? 1 : 0) | (vertical ? 2 : 0) || 1, cell);
    if (east) paint(cx + 4, cy - 4, cx + 8, cy + 4, 1, cell);
    if (west) paint(cx - 8, cy - 4, cx - 4, cy + 4, 1, cell);
    if (south) paint(cx - 4, cy + 4, cx + 4, cy + 8, 2, cell);
    if (north) paint(cx - 4, cy - 8, cx + 4, cy - 4, 2, cell);
  }
}
/** Shared presentation recipe for every automatic route, including resource branches. */
export const AUTOMATIC_ROAD_STYLE = Object.freeze({
  width: 4,
  material: 'earth' as const,
  border: false,
  operation: 'paint' as const,
});
export function automaticRoadStrokes(
  routes: readonly VillageState['travelRoutes'][number][],
  world: { widthCells: number; heightCells: number },
  allowedCells?: ReadonlySet<string>,
): RoadStroke[] {
  const nodes = new Map<string, { x: number; y: number; arms: Set<number> }>();
  for (const route of routes) {
    const points = coarseTravelPath(route.cells, world);
    for (let i = 1; i < points.length; i++)
      for (const [a, b] of [
        [points[i - 1]!, points[i]!],
        [points[i]!, points[i - 1]!],
      ]) {
        const cell = a!.cellX + ':' + a!.cellY,
          dx = wrappedDistance(b!.cellX, a!.cellX, world.widthCells),
          dy = wrappedDistance(b!.cellY, a!.cellY, world.heightCells);
        if ((allowedCells && !allowedCells.has(cell)) || Math.abs(dx) + Math.abs(dy) !== 1) continue;
        const node = nodes.get(cell) ?? { x: a!.cellX, y: a!.cellY, arms: new Set<number>() };
        node.arms.add(dx > 0 ? 0 : dy > 0 ? 1 : dx < 0 ? 2 : 3);
        nodes.set(cell, node);
      }
  }
  const roads: RoadStroke[] = [];
  for (const [cell, node] of nodes) {
    const at = (d: number) => ({
        x: wrapCoordinate(node.x * 8 + [4, 0, -4, 0][d]!, world.widthCells * 8),
        y: wrapCoordinate(node.y * 8 + [0, 4, 0, -4][d]!, world.heightCells * 8),
      }),
      centre = { x: node.x * 8, y: node.y * 8 };
    for (const arm of node.arms)
      roads.push({ id: 'auto:' + cell + ':' + arm, points: [centre, at(arm)], ...AUTOMATIC_ROAD_STYLE });
    const arms = [...node.arms];
    for (let i = 0; i < arms.length; i++)
      for (let j = i + 1; j < arms.length; j++)
        if ((arms[i]! - arms[j]! + 4) % 2)
          roads.push({
            id: 'auto:' + cell + ':joint:' + i + ':' + j,
            points: [at(arms[i]!), centre, at(arms[j]!)],
            ...AUTOMATIC_ROAD_STYLE,
          });
  }
  return roads;
}
export type InfrastructureEditState = BuildingAccessState & {
  travelRoutes: readonly TravelRoute[];
  infrastructure?: InfrastructurePlan;
};
/** Immutable command/gesture baseline; discard when its spatial inputs change. */
export function createInfrastructureEditContext(state: InfrastructureEditState) {
  const original = state.infrastructure ?? emptyInfrastructure(),
    surface = infrastructurePlanSurface(original, state.world);
  const automatic = new Map<string, RoadStroke[]>(),
    automaticOrder = new Map<string, number>();
  for (const road of automaticRoadStrokes(state.travelRoutes, state.world)) {
    const cell = road.id.split(':').slice(1, 3).join(':'),
      list = automatic.get(cell) ?? [];
    const inherited = { ...road, id: road.id.replace(/^auto:/, 'inherited:') };
    automaticOrder.set(inherited.id, automaticOrder.size);
    list.push(inherited);
    automatic.set(cell, list);
  }
  return {
    state: { ...state },
    original,
    surface,
    borders: infrastructureBorders(surface, state.world),
    captured: new Set(original.inheritedCells),
    occupied: new Set(state.cells.filter((c) => c.footprint).map((c) => c.cellX + ':' + c.cellY)),
    automatic,
    automaticOrder,
  };
}
export type InfrastructureEditContext = ReturnType<typeof createInfrastructureEditContext>;
/** Freeze only automatic geometry touched by an edit; it cannot be resurrected by a later snapshot. */
export function prepareInfrastructureEdit(
  state: InfrastructureEditState,
  op: InfrastructureOperation,
  id: string,
  context = createInfrastructureEditContext(state),
): {
  next: InfrastructurePlan;
  quote: InfrastructureQuote;
  surface: ReadonlyMap<string, RoadPixel>;
  beforeSurface: ReadonlyMap<string, RoadPixel>;
} {
  if (
    context.state.world !== state.world ||
    context.state.cells !== state.cells ||
    context.state.travelRoutes !== state.travelRoutes ||
    context.state.infrastructure !== state.infrastructure
  )
    throw new Error('Contexte spatial périmé.');
  const { original } = context;
  let base = original,
    before = context.surface;
  if (op.kind === 'road') {
    const selection = infrastructureSurface([{ ...op.stroke, operation: 'paint' }], state.world);
    const cells = new Set(
      [...selection.values()].map(
        (p) =>
          (Math.floor((p.x + 8) / 16) % state.world.widthCells) +
          ':' +
          (Math.floor((p.y + 8) / 16) % state.world.heightCells),
      ),
    );
    for (const c of context.captured) cells.delete(c);
    if (cells.size) {
      const additions = [...cells]
        .filter((cell) => !context.occupied.has(cell))
        .flatMap((cell) => context.automatic.get(cell) ?? [])
        .sort((a, b) => context.automaticOrder.get(a.id)! - context.automaticOrder.get(b.id)!);
      base = {
        ...original,
        inheritedCells: [...(original.inheritedCells ?? []), ...cells],
        inheritedRoads: [...(original.inheritedRoads ?? []), ...additions],
      };
      // New inherited geometry precedes all manual strokes. Replay only when
      // something was actually captured, so existing paint keeps its precedence.
      if (additions.length) before = infrastructurePlanSurface(base, state.world);
    }
  }
  const next = applyInfrastructure(base, op, id, op.kind === 'road' ? undefined : state.world);
  // Append against the existing raster, retaining preceding centreline widths
  // so a narrow repaint retracts its old width without damaging cross streets.
  const after =
    op.kind === 'road' ? infrastructureSurface([next.roads.at(-1)!], state.world, before, base.roads) : before;
  const quote = infrastructureQuote(base, next, state.world, op.kind === 'place' ? 1 : 0, op.kind === 'place', [], {
    before,
    after,
    ...(before === context.surface ? { beforeBorders: context.borders } : {}),
  });
  if (
    sameInfrastructureSurface(before, after) &&
    JSON.stringify(base.equipment) === JSON.stringify(next.equipment) &&
    JSON.stringify(base.manualLighting) === JSON.stringify(next.manualLighting) &&
    JSON.stringify(base.suppressedBraziers) === JSON.stringify(next.suppressedBraziers)
  )
    return { next: original, quote, surface: context.surface, beforeSurface: context.surface };
  return { next, quote, surface: after, beforeSurface: context.surface };
}
export interface BorderEdge {
  x: number;
  y: number;
  dx: number;
  dy: number;
  key: string;
}
export function infrastructureBorders(
  surface: ReadonlyMap<string, RoadPixel>,
  world: { widthCells: number; heightCells: number },
  _accesses: readonly BuildingAccess[] = [],
): Map<string, BorderEdge> {
  void _accesses;
  const edges = new Map<string, BorderEdge>(),
    w = world.widthCells * 16,
    h = world.heightCells * 16;
  for (const p of surface.values())
    if (p.manual && p.border)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        // End caps stay open. Only exposed sides are edged; junctions suppress inner edges.
        if ((dx && (p.axes & 2) === 0) || (dy && (p.axes & 1) === 0)) continue;
        if (surface.get(pixelKey(wrapCoordinate(p.x + dx!, w), wrapCoordinate(p.y + dy!, h)))?.manual) continue;
        const key = `${p.x}:${p.y}:${dx}:${dy}`;
        edges.set(key, { x: p.x, y: p.y, dx: dx!, dy: dy!, key });
      }
  return edges;
}
/** Two subdivisions per side, united at corners without covering the roadway. */
export function infrastructureSidewalkSurface(
  surface: ReadonlyMap<string, RoadPixel>,
  world: { widthCells: number; heightCells: number },
): Map<string, { x: number; y: number }> {
  const pixels = new Map<string, { x: number; y: number }>(),
    corners = new Map<string, { x: number; y: number; axes: number }>();
  for (const edge of infrastructureBorders(surface, world).values())
    for (let step = 1; step <= 4; step++)
      for (let along = -4; along <= 4; along++) {
        const x = wrapCoordinate(edge.x + edge.dx * step + edge.dy * along, world.widthCells * 16),
          y = wrapCoordinate(edge.y + edge.dy * step + edge.dx * along, world.heightCells * 16),
          key = pixelKey(x, y);
        if (surface.get(key)?.manual) continue;
        if (Math.abs(along) <= 3) pixels.set(key, { x, y });
        const corner = corners.get(key) ?? { x, y, axes: 0 };
        corner.axes |= edge.dy ? 1 : 2;
        corners.set(key, corner);
      }
  // Complete the fourth diagonal pixel only where perpendicular sidewalks meet.
  // Straight end caps retain their existing extent; never cover the roadway.
  for (const [key, p] of corners) if (p.axes === 3) pixels.set(key, { x: p.x, y: p.y });
  return pixels;
}
/** Sidewalks are traversable everywhere; legacy border plans create no barriers. */
export function infrastructureBlockedPixels(
  _plan: InfrastructurePlan,
  _world: { widthCells: number; heightCells: number },
  _accesses: readonly BuildingAccess[] = [],
): Set<string> {
  void _accesses;
  return new Set();
}
export function infrastructureBarrierAt(
  blocked: ReadonlySet<string>,
  p: { cellX: number; cellY: number },
  world: { widthCells: number; heightCells: number },
): boolean {
  if (!blocked.size) return false;
  for (const dx of [-1e-6, 1e-6])
    for (const dy of [-1e-6, 1e-6])
      if (
        blocked.has(
          pixelKey(
            wrapCoordinate(Math.floor(p.cellX * 16 + dx), world.widthCells * 16),
            wrapCoordinate(Math.floor(p.cellY * 16 + dy), world.heightCells * 16),
          ),
        )
      )
        return true;
  return false;
}
export function infrastructureQuote(
  before: InfrastructurePlan,
  after: InfrastructurePlan,
  world: { widthCells: number; heightCells: number },
  woodDebit = 0,
  equipmentCost = true,
  accesses: readonly BuildingAccess[] = [],
  surfaces?: {
    before: ReadonlyMap<string, RoadPixel>;
    after: ReadonlyMap<string, RoadPixel>;
    beforeBorders?: ReadonlyMap<string, BorderEdge>;
  },
): InfrastructureQuote {
  const a = surfaces?.before ?? infrastructurePlanSurface(before, world),
    b = surfaces?.after ?? infrastructurePlanSurface(after, world);
  let units = 0;
  for (const [key, p] of b)
    if (
      p.manual &&
      !p.inherited &&
      (p.material === 'stone-1' || p.material === 'stone-2') &&
      (!a.get(key)?.manual || a.get(key)?.inherited || a.get(key)?.material !== p.material)
    )
      units += 4;
  const ae = surfaces?.beforeBorders ?? infrastructureBorders(a, world, accesses);
  for (const key of infrastructureBorders(b, world, accesses).keys()) if (!ae.has(key)) units += 16;
  if (equipmentCost && after.equipment.length > before.equipment.length) units += 2 * MATERIAL_UNITS;
  const debit = Math.max(0, Math.ceil((units - before.stoneReserve) / MATERIAL_UNITS));
  return {
    stoneUnits: units,
    stoneDebit: debit,
    woodDebit,
    reserveAfter: before.stoneReserve + debit * MATERIAL_UNITS - units,
  };
}
export function applyInfrastructure(
  plan: InfrastructurePlan,
  op: InfrastructureOperation,
  id: string,
  world?: { widthCells: number; heightCells: number },
): InfrastructurePlan {
  const next: InfrastructurePlan = structuredClone(plan);
  if (op.kind === 'road') {
    next.roads.push({ ...op.stroke, id });
    if (
      world &&
      sameInfrastructureSurface(infrastructurePlanSurface(plan, world), infrastructurePlanSurface(next, world))
    )
      return structuredClone(plan);
  }
  if (op.kind === 'place') {
    next.equipment.push({ id, ...op.position, quarterTurns: op.quarterTurns, version: 1 });
    const key = subCellKey(op.position, world);
    if (!next.manualLighting.includes(key)) next.manualLighting.push(key);
  }
  if (op.kind === 'move' || op.kind === 'delete') {
    const item = next.equipment.find((e) => e.id === op.id);
    if (!item && op.id.startsWith('auto:') && op.version === 0) {
      if (!next.suppressedBraziers.includes(op.id)) next.suppressedBraziers.push(op.id);
      if (op.kind === 'move') {
        next.equipment.push({ id, ...op.position, quarterTurns: op.quarterTurns, version: 1 });
        const cell = subCellKey(op.position, world);
        if (!next.manualLighting.includes(cell)) next.manualLighting.push(cell);
      }
    } else if (!item || item.version !== op.version) throw new Error('Cet équipement a changé ou a été supprimé.');
    else if (op.kind === 'delete') next.equipment = next.equipment.filter((e) => e.id !== op.id);
    else {
      Object.assign(item, op.position, { quarterTurns: op.quarterTurns, version: item.version + 1 });
      const key = subCellKey(op.position, world);
      if (!next.manualLighting.includes(key)) next.manualLighting.push(key);
    }
  }
  if (op.kind === 'lighting') {
    if (next.equipment.some((e) => subCellKey(e, world) === op.cell))
      throw new Error('Déplacez les braseros manuels avant de rétablir l’éclairage automatique.');
    next.manualLighting = next.manualLighting.filter((key) => key !== op.cell);
    next.suppressedBraziers = next.suppressedBraziers.filter((key) => !key.startsWith(`auto:${op.cell}:`));
  }
  return next;
}

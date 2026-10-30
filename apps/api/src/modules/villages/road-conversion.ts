import { sql, type Transaction } from 'kysely';
import {
  infrastructurePlanSurface,
  infrastructureSurface,
  pixelKey,
  roadAnchorCells,
  wrapCoordinate,
  wrappedDistance,
  type InfrastructurePlan,
  type RoadCellSkipCode,
  type RoadCellSurface,
  type RoadStroke,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { readRc1Source } from '../worlds/rc1-source.js';
import { worldActivePaths } from './infrastructure.js';
import { anchorBlocksPath, cleanRoadAnchors } from './road-anchors.js';
import { roadCellRefusals } from './road-cells.js';
import type { OwnedVillage } from './service.js';

/** Conversion of the legacy JSONB plan of 028 into road cells and road anchors
 * (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §7, S3). Run once by migration
 * 076 inside its transaction; the read-only count (road-conversion-count.ts)
 * runs the same planning without writing. */

type World = { widthCells: number; heightCells: number };
type Cell = { cellX: number; cellY: number };
type Vertex = { vertexX: number; vertexY: number };
export interface LegacyRoadCell extends Cell {
  surface: RoadCellSurface;
  sidewalks: boolean;
}
const cellKey = (c: Cell) => `${c.cellX}:${c.cellY}`;
const vertexKey = (v: Vertex) => `${v.vertexX}:${v.vertexY}`;
const SURFACES = new Set<string>(['earth', 'rubble', 'stone-1', 'stone-2']);
const PIXELS_PER_CELL = 256;
/** Search radius of a manual brazier for a free anchor, in cells. */
export const BRAZIER_MOVE_RADIUS = 1;

/** Cell of a pixel at 1/16 of a cell (a cell spans [16c-8, 16c+8)). */
const pixelCell = (x: number, y: number, world: World): Cell => ({
  cellX: Math.floor((x + 8) / 16) % world.widthCells,
  cellY: Math.floor((y + 8) / 16) % world.heightCells,
});

/** Pure: the road cells a legacy plan converts to. A cell becomes a chemin
 * when the roadway of the plan (manual and inherited strokes, after `remove`
 * strokes, as rasterized by the legacy surface) covers its centre point —
 * edge included: one of the four pixels around it is paved, so a stroke that
 * ends at a cell centre, as the legacy tool drew them, converts its end
 * cell — or at least half of its surface. Surface from the most
 * recent paint stroke drawn on its remaining roadway, sidewalks from the most
 * recent paint or border stroke there. `lost` counts the manual paint strokes
 * that give no cell at all. */
export function legacyRoadCells(
  plan: InfrastructurePlan,
  world: World,
): { cells: LegacyRoadCell[]; strokes: { manual: number; removed: number; inherited: number; lost: number } } {
  // Only the legacy plan: road cells are never stored in it.
  const { roadCells: _ignored, ...legacyPlan } = plan;
  void _ignored;
  const surface = infrastructurePlanSurface(legacyPlan, world);
  const w = world.widthCells * 16,
    h = world.heightCells * 16;
  const paved = (p: { manual: boolean; material: string } | undefined) =>
    Boolean(p?.manual && SURFACES.has(p.material));
  const byCell = new Map<string, { cell: Cell; pixels: string[] }>();
  for (const [key, p] of surface) {
    if (!paved(p)) continue;
    const cell = pixelCell(p.x, p.y, world),
      entry = byCell.get(cellKey(cell)) ?? { cell, pixels: [] };
    entry.pixels.push(key);
    byCell.set(cellKey(cell), entry);
  }
  const strokes: Array<{ stroke: RoadStroke; manual: boolean; pixels: Set<string> }> = [];
  for (const [list, manual] of [
    [plan.inheritedRoads ?? [], false],
    [plan.roads, true],
  ] as const)
    for (const stroke of list)
      if (stroke.operation !== 'remove')
        strokes.push({
          stroke,
          manual,
          pixels: new Set(infrastructureSurface([{ ...stroke, operation: 'paint' }], world).keys()),
        });
  const cells: LegacyRoadCell[] = [];
  for (const { cell, pixels } of byCell.values()) {
    const cx = cell.cellX * 16,
      cy = cell.cellY * 16;
    const centre = [
      [cx - 1, cy - 1],
      [cx, cy - 1],
      [cx - 1, cy],
      [cx, cy],
    ].some(([x, y]) => paved(surface.get(pixelKey(wrapCoordinate(x!, w), wrapCoordinate(y!, h)))));
    if (!centre && pixels.length * 2 < PIXELS_PER_CELL) continue;
    let material: RoadCellSurface | null = null,
      sidewalks: boolean | null = null;
    for (let i = strokes.length - 1; i >= 0 && (material === null || sidewalks === null); i--) {
      const { stroke, pixels: own } = strokes[i]!;
      if (!pixels.some((key) => own.has(key))) continue;
      if (stroke.operation === 'paint' && !SURFACES.has(stroke.material)) continue;
      sidewalks ??= stroke.border;
      if (stroke.operation === 'paint') material ??= stroke.material as RoadCellSurface;
    }
    // Unreachable in practice (a paved pixel comes from a paint stroke): the
    // material of the cell's own pixels.
    material ??= surface.get(pixels[0]!)!.material as RoadCellSurface;
    cells.push({ ...cell, surface: material, sidewalks: sidewalks ?? false });
  }
  // A manual paint stroke is kept when one of its cells converts.
  const kept = new Set(cells.map(cellKey));
  let lost = 0;
  for (const { stroke, manual, pixels } of strokes) {
    if (!manual || stroke.operation !== 'paint' || !SURFACES.has(stroke.material)) continue;
    let any = false;
    for (const key of pixels) {
      const [x, y] = key.split(':').map(Number);
      if (kept.has(cellKey(pixelCell(x!, y!, world)))) {
        any = true;
        break;
      }
    }
    if (!any) lost++;
  }
  cells.sort((a, b) => a.cellX - b.cellX || a.cellY - b.cellY);
  return {
    cells,
    strokes: {
      manual: plan.roads.filter((r) => r.operation !== 'remove').length,
      removed: plan.roads.filter((r) => r.operation === 'remove').length,
      inherited: plan.inheritedRoads?.length ?? 0,
      lost,
    },
  };
}

/** One legacy suppression of automatic lighting: a suppressed automatic
 * brazier (`suppressedBraziers`) or a manually lit cell (`manualLighting`).
 * Each candidate is the corner of the junction cell `cell` towards the
 * diagonal `missing` cell, where a new automatic brazier would stand. */
export interface LegacySuppression {
  source: 'suppressed' | 'lighting';
  key: string;
  candidates: Array<{ vertex: Vertex; missing: Cell }>;
}
export function legacySuppressions(plan: InfrastructurePlan, world: World): LegacySuppression[] {
  const corner = (cell: Cell, sx: number, sy: number) => ({
    vertex: {
      vertexX: wrapCoordinate(cell.cellX + (sx > 0 ? 1 : 0), world.widthCells),
      vertexY: wrapCoordinate(cell.cellY + (sy > 0 ? 1 : 0), world.heightCells),
    },
    missing: {
      cellX: wrapCoordinate(cell.cellX + sx, world.widthCells),
      cellY: wrapCoordinate(cell.cellY + sy, world.heightCells),
    },
  });
  const result: LegacySuppression[] = [];
  for (const id of plan.suppressedBraziers) {
    const parts = id.split(':');
    // auto:X:Y:sx:sy (fires of automatic roads, node at the cell centre) or
    // auto:cx:cy:sub:px:py:sx:sy (fires of strokes, in the cell cx,cy).
    const numbers = parts
      .slice(1)
      .filter((p) => p !== 'sub')
      .map(Number);
    const ok =
      parts[0] === 'auto' &&
      ((parts.length === 5 && numbers.length === 4) || (parts.length === 8 && parts[3] === 'sub')) &&
      numbers.every(Number.isInteger);
    if (!ok) {
      result.push({ source: 'suppressed', key: id, candidates: [] });
      continue;
    }
    const sx = numbers.at(-2)!,
      sy = numbers.at(-1)!;
    const cell = {
      cellX: wrapCoordinate(numbers[0]!, world.widthCells),
      cellY: wrapCoordinate(numbers[1]!, world.heightCells),
    };
    result.push({ source: 'suppressed', key: id, candidates: [corner(cell, sx, sy)] });
  }
  for (const key of plan.manualLighting) {
    const [x, y] = key.split(':').map(Number);
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      result.push({ source: 'lighting', key, candidates: [] });
      continue;
    }
    const cell = { cellX: wrapCoordinate(x!, world.widthCells), cellY: wrapCoordinate(y!, world.heightCells) };
    result.push({
      source: 'lighting',
      key,
      candidates: [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sy]) => corner(cell, sx!, sy!)),
    });
  }
  return result;
}

export type RefusalCounts = Partial<Record<RoadCellSkipCode, number>>;
export interface RoadConversionReport {
  worldId: string;
  worldSlug: string;
  villageId: string;
  villageName: string;
  strokes: { manual: number; removed: number; inherited: number; lost: number };
  cells: { candidates: number; created: number; kept: number; refused: RefusalCounts };
  braziers: { manual: number; moved: number; deleted: number };
  suppressions: { entries: number; translated: number; abandoned: number; anchors: number };
  stone: { reserve: number; credited: number };
}
interface PlannedVillage {
  village: OwnedVillage;
  plan: InfrastructurePlan;
  report: RoadConversionReport;
  create: LegacyRoadCell[];
  /** Final accessory per written vertex, with the row it replaces. */
  anchors: Array<Vertex & { accessory: 'brazier' | 'none'; before: 'brazier' | 'none' | null }>;
  credit: number;
}
/** Cells and vertices claimed earlier in the same run, by village: the count
 * sees what the conversion of a previous village would have written. */
interface Claims {
  cells: Map<string, string>;
}

async function planVillage(
  tx: Transaction<Database>,
  village: OwnedVillage,
  plan: InfrastructurePlan,
  claims: Claims,
  activePaths: () => Promise<ReadonlyArray<Parameters<typeof anchorBlocksPath>[0]>>,
): Promise<PlannedVillage> {
  const world = { widthCells: village.widthCells, heightCells: village.heightCells };
  const { worldId, villageId } = village;
  const legacy = legacyRoadCells(plan, world);
  if (village.generationVersion === 3) await readRc1Source(tx, worldId);
  const { refused, own } = await roadCellRefusals(tx, village, legacy.cells, true);
  for (const cell of legacy.cells) {
    const claimed = claims.cells.get(worldId + ':' + cellKey(cell));
    if (claimed && claimed !== villageId && !refused.has(cellKey(cell)))
      refused.set(cellKey(cell), 'FOREIGN_INFRASTRUCTURE');
  }
  const refusedCounts: RefusalCounts = {};
  const create: LegacyRoadCell[] = [];
  let kept = 0;
  for (const cell of legacy.cells) {
    // A cell already in road_cells is kept as it is.
    if (own.has(cellKey(cell))) kept++;
    else if (refused.has(cellKey(cell))) {
      const code = refused.get(cellKey(cell))!;
      refusedCounts[code] = (refusedCounts[code] ?? 0) + 1;
    } else create.push(cell);
  }
  // The village's road cells after the conversion, and every road cell (any
  // village, read or claimed) around the vertices the conversion may write.
  const ownRows = await tx
    .selectFrom('roadCells')
    .select(['cellX', 'cellY'])
    .where('worldId', '=', worldId)
    .where('villageId', '=', villageId)
    .execute();
  const ownCells = new Set([...ownRows.map(cellKey), ...create.map(cellKey)]);
  const vertices = new Map<string, Vertex>();
  const consider = (v: Vertex) => vertices.set(vertexKey(v), v);
  const suppressions = legacySuppressions(plan, world);
  for (const s of suppressions) for (const c of s.candidates) consider(c.vertex);
  const braziers = plan.equipment.map((e) => {
    const x = e.x / 8,
      y = e.y / 8,
      candidates: Array<Vertex & { distance: number }> = [];
    for (let vy = Math.floor(y) - 1; vy <= Math.floor(y) + 2; vy++)
      for (let vx = Math.floor(x) - 1; vx <= Math.floor(x) + 2; vx++) {
        const vertex = {
          vertexX: wrapCoordinate(vx, world.widthCells),
          vertexY: wrapCoordinate(vy, world.heightCells),
        };
        const dx = wrappedDistance(vertex.vertexX - 0.5, x, world.widthCells),
          dy = wrappedDistance(vertex.vertexY - 0.5, y, world.heightCells),
          distance = Math.hypot(dx, dy);
        if (distance <= BRAZIER_MOVE_RADIUS + 1e-9) candidates.push({ ...vertex, distance });
      }
    candidates.sort((a, b) => a.distance - b.distance || a.vertexX - b.vertexX || a.vertexY - b.vertexY);
    for (const c of candidates) consider(c);
    return candidates;
  });
  const around = new Map<string, Cell>();
  for (const v of vertices.values()) for (const c of roadAnchorCells(v, world)) around.set(cellKey(c), c);
  const foreignCells = new Set<string>();
  if (around.size) {
    const list = [...around.values()];
    const rows = await tx
      .selectFrom('roadCells')
      .select(['villageId', 'cellX', 'cellY'])
      .where('worldId', '=', worldId)
      .where('villageId', '<>', villageId)
      .where(
        sql<boolean>`(cell_x,cell_y) in (select * from unnest(${list.map((c) => c.cellX)}::int[],${list.map((c) => c.cellY)}::int[]))`,
      )
      .execute();
    for (const row of rows) foreignCells.add(cellKey(row));
    for (const c of list) {
      const claimed = claims.cells.get(worldId + ':' + cellKey(c));
      if (claimed && claimed !== villageId) foreignCells.add(cellKey(c));
    }
  }
  const rows = new Map<string, { villageId: string; accessory: 'brazier' | 'none' }>();
  if (vertices.size) {
    const list = [...vertices.values()];
    for (const row of await tx
      .selectFrom('roadAnchors')
      .select(['villageId', 'vertexX', 'vertexY', 'accessory'])
      .where('worldId', '=', worldId)
      .where(
        sql<boolean>`(vertex_x,vertex_y) in (select * from unnest(${list.map((v) => v.vertexX)}::int[],${list.map((v) => v.vertexY)}::int[]))`,
      )
      .execute())
      rows.set(vertexKey(row), row);
  }
  const inspect = (v: Vertex) => {
    let own = 0,
      foreign = false;
    for (const c of roadAnchorCells(v, world)) {
      if (ownCells.has(cellKey(c))) own++;
      if (foreignCells.has(cellKey(c))) foreign = true;
    }
    const row = rows.get(vertexKey(v));
    return { own, foreign: foreign || (row !== undefined && row.villageId !== villageId), row };
  };
  const writes = new Map<string, PlannedVillage['anchors'][number]>();
  const shown = (v: Vertex): 'brazier' | 'none' => {
    const planned = writes.get(vertexKey(v));
    if (planned) return planned.accessory;
    const { own, row } = inspect(v);
    return row && row.villageId === villageId ? row.accessory : own === 3 ? 'brazier' : 'none';
  };
  const write = (v: Vertex, accessory: 'brazier' | 'none') => {
    const row = rows.get(vertexKey(v));
    writes.set(vertexKey(v), { ...v, accessory, before: row && row.villageId === villageId ? row.accessory : null });
  };
  // Suppressions of automatic lighting become `none` on the matching anchor:
  // a new automatic brazier of the village (three own cells) whose missing
  // cell is the diagonal of the legacy junction. Otherwise abandoned.
  let translated = 0,
    abandoned = 0;
  for (const s of suppressions) {
    let matched = false;
    for (const { vertex, missing } of s.candidates) {
      const { own, foreign, row } = inspect(vertex);
      if (own !== 3 || foreign || ownCells.has(cellKey(missing))) continue;
      // A manual accessory already on the anchor (S4) is left alone.
      if (row && row.accessory !== 'none') continue;
      matched = true;
      if (!row && !writes.has(vertexKey(vertex))) write(vertex, 'none');
    }
    if (matched) translated++;
    else abandoned++;
  }
  // Manual braziers move to the nearest free anchor of the village within
  // BRAZIER_MOVE_RADIUS: a vertex touched by its road cells, by no other
  // village's, showing no accessory, not crossed by a trip in progress.
  let moved = 0,
    deleted = 0;
  for (const candidates of braziers) {
    let target: Vertex | null = null;
    for (const v of candidates) {
      const { own, foreign } = inspect(v);
      if (own === 0 || foreign || shown(v) !== 'none') continue;
      if ((await activePaths()).some((path) => anchorBlocksPath(path, v, world))) continue;
      target = v;
      break;
    }
    if (target) {
      write(target, 'brazier');
      moved++;
    } else deleted++;
  }
  const credit = Math.ceil(plan.stoneReserve / 256);
  for (const cell of create) claims.cells.set(worldId + ':' + cellKey(cell), villageId);
  return {
    village,
    plan,
    create,
    anchors: [...writes.values()],
    credit,
    report: {
      worldId,
      worldSlug: village.worldSlug,
      villageId,
      villageName: village.villageName,
      strokes: legacy.strokes,
      cells: { candidates: legacy.cells.length, created: create.length, kept, refused: refusedCounts },
      braziers: { manual: plan.equipment.length, moved, deleted },
      suppressions: {
        entries: suppressions.length,
        translated,
        abandoned,
        anchors: [...writes.values()].filter((w) => w.accessory === 'none').length,
      },
      stone: { reserve: plan.stoneReserve, credited: credit },
    },
  };
}

/** A plan holding anything the conversion reads. */
const hasContent = sql<boolean>`(jsonb_array_length(coalesce(vi.plan->'roads','[]'))>0
  or jsonb_array_length(coalesce(vi.plan->'equipment','[]'))>0
  or jsonb_array_length(coalesce(vi.plan->'manualLighting','[]'))>0
  or jsonb_array_length(coalesce(vi.plan->'suppressedBraziers','[]'))>0
  or jsonb_array_length(coalesce(vi.plan->'inheritedRoads','[]'))>0
  or jsonb_array_length(coalesce(vi.plan->'inheritedCells','[]'))>0
  or coalesce((vi.plan->>'stoneReserve')::integer,0)>0)`;

async function candidates(tx: Transaction<Database>, worldId?: string) {
  // Before 076 (read-only count on a database not yet migrated), no village
  // has been converted.
  const migrated = (
    await sql<{ name: string | null }>`select to_regclass('road_conversion_backups')::text as name`.execute(tx)
  ).rows[0]!.name;
  const converted = migrated
    ? sql<boolean>`exists(select 1 from road_conversion_backups b where b.world_id=vi.world_id and b.village_id=vi.village_id)`
    : sql<boolean>`false`;
  const rows = await sql<
    Omit<OwnedVillage, 'topology'> & { topology: string; plan: InfrastructurePlan }
  >`select w.id as "worldId",w.slug as "worldSlug",w.name as "worldName",w.topology,w.width_cells as "widthCells",
      w.height_cells as "heightCells",w.chunk_size as "chunkSize",w.seed,w.generation_version as "generationVersion",
      v.id as "villageId",v.name as "villageName",v.anchor_cell_x as "anchorCellX",v.anchor_cell_y as "anchorCellY",vi.plan
    from village_infrastructure vi
    join villages v on v.world_id=vi.world_id and v.id=vi.village_id
    join worlds w on w.id=vi.world_id
    where ${hasContent}
      and not ${converted}
      and (${worldId ?? null}::uuid is null or vi.world_id=${worldId ?? null}::uuid)
    order by vi.world_id,vi.village_id`.execute(tx);
  return rows.rows.map(({ plan, ...village }) => ({
    village: { ...village, seed: String(village.seed) } as OwnedVillage,
    plan,
  }));
}

async function planAll(tx: Transaction<Database>, list: Awaited<ReturnType<typeof candidates>>) {
  const claims: Claims = { cells: new Map() };
  const paths = new Map<string, Promise<ReadonlyArray<Parameters<typeof anchorBlocksPath>[0]>>>();
  const planned: PlannedVillage[] = [];
  for (const { village, plan } of list) {
    const activePaths = () => {
      if (!paths.has(village.worldId)) paths.set(village.worldId, worldActivePaths(tx, village.worldId));
      return paths.get(village.worldId)!;
    };
    planned.push(await planVillage(tx, village, plan, claims, activePaths));
  }
  return planned;
}

/** Read-only: what the conversion would do, village by village. */
export async function countLegacyRoadConversion(
  tx: Transaction<Database>,
  worldId?: string,
): Promise<RoadConversionReport[]> {
  return (await planAll(tx, await candidates(tx, worldId))).map((p) => p.report);
}

/** Converts every legacy plan not yet converted, inside the caller's
 * transaction (migration 076). Villages are locked in canonical order, then
 * each world's exclusive navigation lock (as every infrastructure writer),
 * then the plans. Writes go through the V2 triggers of 073/074/053, published
 * at commit. Idempotent: a converted village has its backup row and an empty
 * plan. */
export async function convertLegacyRoads(tx: Transaction<Database>, worldId?: string): Promise<RoadConversionReport[]> {
  const first = await candidates(tx, worldId);
  if (!first.length) return [];
  await sql`select v.id from villages v
    where (v.world_id,v.id) in (select * from unnest(${first.map((c) => c.village.worldId)}::uuid[],${first.map((c) => c.village.villageId)}::uuid[]))
    order by v.world_id,v.id for update`.execute(tx);
  for (const id of [...new Set(first.map((c) => c.village.worldId))].sort())
    await sql`select pg_advisory_xact_lock(hashtextextended(${`infrastructure:${id}`},0))`.execute(tx);
  // Read again under the locks.
  const list = (await candidates(tx, worldId)).filter((c) =>
    first.some((f) => f.village.worldId === c.village.worldId && f.village.villageId === c.village.villageId),
  );
  const planned = await planAll(tx, list);
  for (const p of planned) {
    const { worldId: wid, villageId } = p.village;
    const world = { widthCells: p.village.widthCells, heightCells: p.village.heightCells };
    if (p.create.length)
      await tx
        .insertInto('roadCells')
        .values(
          p.create.map((c) => ({
            worldId: wid,
            villageId,
            cellX: c.cellX,
            cellY: c.cellY,
            surface: c.surface,
            sidewalks: c.sidewalks,
          })),
        )
        .execute();
    for (const a of p.anchors)
      await tx
        .insertInto('roadAnchors')
        .values({ worldId: wid, villageId, vertexX: a.vertexX, vertexY: a.vertexY, accessory: a.accessory })
        .onConflict((c) =>
          c.columns(['worldId', 'vertexX', 'vertexY']).doUpdateSet({
            accessory: a.accessory,
            revision: sql`road_anchors.revision + 1`,
            updatedAt: sql`statement_timestamp()`,
          }),
        )
        .execute();
    // An own `none` that stopped being a re-entrant corner leaves (S4a rule).
    const before = await tx
      .selectFrom('roadAnchors')
      .select(['vertexX', 'vertexY', 'accessory'])
      .where('worldId', '=', wid)
      .where('villageId', '=', villageId)
      .execute();
    await cleanRoadAnchors(tx, wid, villageId, p.create, world);
    const after = new Set(
      (
        await tx
          .selectFrom('roadAnchors')
          .select(['vertexX', 'vertexY'])
          .where('worldId', '=', wid)
          .where('villageId', '=', villageId)
          .execute()
      ).map(vertexKey),
    );
    const written = new Set(p.anchors.map(vertexKey));
    const cleaned = before.filter((row) => !after.has(vertexKey(row)) && !written.has(vertexKey(row)));
    if (p.credit)
      await tx
        .insertInto('villageResources')
        .values({ worldId: wid, villageId, resourceCode: 'stone', amount: p.credit })
        .onConflict((c) =>
          c
            .columns(['worldId', 'villageId', 'resourceCode'])
            .doUpdateSet({ amount: sql`village_resources.amount + ${p.credit}::bigint` }),
        )
        .execute();
    const emptied: InfrastructurePlan = {
      revision: p.plan.revision + 1,
      roads: [],
      equipment: [],
      manualLighting: [],
      suppressedBraziers: [],
      stoneReserve: 0,
    };
    await tx
      .updateTable('villageInfrastructure')
      .set({ plan: JSON.stringify(emptied) })
      .where('worldId', '=', wid)
      .where('villageId', '=', villageId)
      .execute();
    await tx
      .insertInto('roadConversionBackups')
      .values({
        worldId: wid,
        villageId,
        plan: JSON.stringify(p.plan),
        createdCells: JSON.stringify(p.create.map(({ cellX, cellY }) => ({ cellX, cellY }))),
        anchors: JSON.stringify([
          ...p.anchors.map(({ vertexX, vertexY, before }) => ({ vertexX, vertexY, before })),
          ...cleaned.map(({ vertexX, vertexY, accessory }) => ({ vertexX, vertexY, before: accessory })),
        ]),
        stoneCredit: p.credit,
        report: JSON.stringify(p.report),
      })
      .execute();
  }
  return planned.map((p) => p.report);
}

/** Reverts the conversion (migration 076 down): removes the cells it created
 * (still owned by the village), restores the anchors it wrote or cleaned,
 * debits the credited stone (down to zero), and restores the legacy plan with
 * a new revision. Everything goes through the V2 triggers. */
export async function revertLegacyRoadConversion(tx: Transaction<Database>): Promise<number> {
  const backups = await tx
    .selectFrom('roadConversionBackups')
    .selectAll()
    .orderBy('worldId')
    .orderBy('villageId')
    .execute();
  if (!backups.length) return 0;
  await sql`select v.id from villages v
    where (v.world_id,v.id) in (select * from unnest(${backups.map((b) => b.worldId)}::uuid[],${backups.map((b) => b.villageId)}::uuid[]))
    order by v.world_id,v.id for update`.execute(tx);
  for (const id of [...new Set(backups.map((b) => b.worldId))].sort())
    await sql`select pg_advisory_xact_lock(hashtextextended(${`infrastructure:${id}`},0))`.execute(tx);
  for (const b of backups) {
    const world = await tx
      .selectFrom('worlds')
      .select(['widthCells', 'heightCells'])
      .where('id', '=', b.worldId)
      .executeTakeFirstOrThrow();
    const created = b.createdCells as Cell[];
    if (created.length)
      await tx
        .deleteFrom('roadCells')
        .where('worldId', '=', b.worldId)
        .where('villageId', '=', b.villageId)
        .where(
          sql<boolean>`(cell_x,cell_y) in (select * from unnest(${created.map((c) => c.cellX)}::int[],${created.map((c) => c.cellY)}::int[]))`,
        )
        .execute();
    for (const a of b.anchors as Array<Vertex & { before: 'brazier' | 'none' | null }>) {
      if (a.before === null)
        await tx
          .deleteFrom('roadAnchors')
          .where('worldId', '=', b.worldId)
          .where('villageId', '=', b.villageId)
          .where('vertexX', '=', a.vertexX)
          .where('vertexY', '=', a.vertexY)
          .execute();
      else
        await tx
          .insertInto('roadAnchors')
          .values({
            worldId: b.worldId,
            villageId: b.villageId,
            vertexX: a.vertexX,
            vertexY: a.vertexY,
            accessory: a.before,
          })
          .onConflict((c) =>
            c
              .columns(['worldId', 'vertexX', 'vertexY'])
              .doUpdateSet({ accessory: a.before!, revision: sql`road_anchors.revision + 1` })
              .where('roadAnchors.villageId', '=', b.villageId),
          )
          .execute();
    }
    // Accessories the player put on the removed cells leave with them.
    await cleanRoadAnchors(tx, b.worldId, b.villageId, created, world);
    if (b.stoneCredit)
      await tx
        .updateTable('villageResources')
        .set({ amount: sql`amount - least(amount, ${b.stoneCredit}::bigint)` })
        .where('worldId', '=', b.worldId)
        .where('villageId', '=', b.villageId)
        .where('resourceCode', '=', 'stone')
        .execute();
    const current = await tx
      .selectFrom('villageInfrastructure')
      .select('plan')
      .where('worldId', '=', b.worldId)
      .where('villageId', '=', b.villageId)
      .executeTakeFirst();
    const restored = { ...(b.plan as InfrastructurePlan), revision: (current?.plan.revision ?? 0) + 1 };
    await tx
      .updateTable('villageInfrastructure')
      .set({ plan: JSON.stringify(restored) })
      .where('worldId', '=', b.worldId)
      .where('villageId', '=', b.villageId)
      .execute();
  }
  await tx.deleteFrom('roadConversionBackups').execute();
  return backups.length;
}

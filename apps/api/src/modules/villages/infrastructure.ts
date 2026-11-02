import { sql, type Kysely, type Transaction } from 'kysely';
import {
  pathPassageIntersectsBox,
  emptyInfrastructure,
  infrastructurePlanSurface,
  infrastructureSidewalkSurface,
  subCellKey,
  roadAnchorAccessories,
  roadAnchorSubPoint,
  type RoadAnchorAccessory,
  type InfrastructurePlan,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
export async function readInfrastructure(
  tx: Kysely<Database>,
  worldId: string,
  villageId: string,
): Promise<InfrastructurePlan> {
  return (
    (
      await tx
        .selectFrom('villageInfrastructure')
        .select('plan')
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .executeTakeFirst()
    )?.plan ?? emptyInfrastructure()
  );
}
export async function factoryCapability(db: Kysely<Database>, worldId: string) {
  return (
    (await db.selectFrom('worldFactorySettings').select('enabled').where('worldId', '=', worldId).executeTakeFirst())
      ?.enabled ?? false
  );
}
/** Persisted paths of every trip in progress of the world (one read per trip
 * table, filtered by status; no `state()`). */
export async function worldActivePaths(tx: Transaction<Database>, worldId: string) {
  // Read persisted trips without locking another village after the local one.
  const paths = await tx
    .selectFrom('depositExtractions')
    .select('pathCells')
    .where('worldId', '=', worldId)
    .where('status', '=', 'in-progress')
    .execute();
  const harvests = await tx
    .selectFrom('gardenHarvests')
    .select(['pathCells', 'returnPathCells', 'stops'])
    .where('worldId', '=', worldId)
    .where('status', '=', 'in-progress')
    .execute();
  const science = await tx
    .selectFrom('scienceActivities')
    .select('pathCells')
    .where('worldId', '=', worldId)
    .where('status', '=', 'in-progress')
    .execute();
  const trades = await tx
    .selectFrom('tradeJourneys')
    .select('path')
    .where('worldId', '=', worldId)
    .where('returnsAt', '>', sql<Date>`statement_timestamp()`)
    .execute();
  return [
    ...paths.map((p) => p.pathCells ?? []),
    ...harvests.flatMap((p) => [p.pathCells ?? [], p.returnPathCells ?? [], ...(p.stops?.map((s) => s.path) ?? [])]),
    ...science.map((p) => p.pathCells),
    ...trades.map((p) => p.path),
  ];
}
/** Accessories shown on the anchors of each village's road cells (stored, and
 * automatic braziers not suppressed), as legacy equipment at their vertex.
 * Linear in the cells and rows; ids `anchor:x:y` keep the order stable. */
type AnchorCell = { villageId: string; cellX: number; cellY: number };
type AnchorRow = { villageId: string; vertexX: number; vertexY: number; accessory: RoadAnchorAccessory };
function roadAnchorEquipment(
  cells: readonly AnchorCell[],
  rows: readonly AnchorRow[],
  world: { widthCells: number; heightCells: number },
): InfrastructurePlan['equipment'] {
  const byVillage = new Map<string, { cells: AnchorCell[]; rows: AnchorRow[] }>();
  const entry = (villageId: string) => {
    let value = byVillage.get(villageId);
    if (!value) byVillage.set(villageId, (value = { cells: [], rows: [] }));
    return value;
  };
  for (const cell of cells) entry(cell.villageId).cells.push(cell);
  for (const row of rows) entry(row.villageId).rows.push(row);
  const equipment: InfrastructurePlan['equipment'] = [];
  for (const [, value] of [...byVillage].sort(([a], [b]) => a.localeCompare(b)))
    for (const accessory of roadAnchorAccessories(value.cells, value.rows, world))
      equipment.push({
        id: `anchor:${accessory.vertexX}:${accessory.vertexY}`,
        ...roadAnchorSubPoint(accessory, world),
        quarterTurns: 0,
        version: 1,
      });
  return equipment;
}
/** Nearby physical obstacles participate in routing without granting edit rights. */
export async function readNavigationInfrastructure(
  tx: Kysely<Database>,
  village: {
    worldId: string;
    villageId: string;
    anchorCellX: number;
    anchorCellY: number;
    widthCells: number;
    heightCells: number;
  },
  local?: InfrastructurePlan,
): Promise<InfrastructurePlan> {
  const rows = await tx
    .selectFrom('villageInfrastructure')
    .innerJoin('villages', (join) =>
      join
        .onRef('villages.id', '=', 'villageInfrastructure.villageId')
        .onRef('villages.worldId', '=', 'villageInfrastructure.worldId'),
    )
    .select(['villageInfrastructure.villageId', 'plan'])
    .where('villageInfrastructure.worldId', '=', village.worldId)
    .where(
      sql<boolean>`least(abs(anchor_cell_x-${village.anchorCellX}),${village.widthCells}-abs(anchor_cell_x-${village.anchorCellX})) <= 64`,
    )
    .where(
      sql<boolean>`least(abs(anchor_cell_y-${village.anchorCellY}),${village.heightCells}-abs(anchor_cell_y-${village.anchorCellY})) <= 64`,
    )
    .orderBy('villageInfrastructure.villageId')
    .execute();
  const own = local ?? rows.find((r) => r.villageId === village.villageId)?.plan ?? emptyInfrastructure(),
    foreign = rows.filter((r) => r.villageId !== village.villageId).map((r) => r.plan);
  // Road cells of the same villages, whoever owns them, drawn over the plans
  // (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §4.5). Without any, the plan
  // is unchanged and so is every network fingerprint.
  const roadCells = await tx
    .selectFrom('roadCells')
    .innerJoin('villages', (join) =>
      join.onRef('villages.id', '=', 'roadCells.villageId').onRef('villages.worldId', '=', 'roadCells.worldId'),
    )
    .select(['roadCells.villageId', 'roadCells.cellX', 'roadCells.cellY', 'roadCells.surface', 'roadCells.sidewalks'])
    .where('roadCells.worldId', '=', village.worldId)
    .where(
      sql<boolean>`least(abs(anchor_cell_x-${village.anchorCellX}),${village.widthCells}-abs(anchor_cell_x-${village.anchorCellX})) <= 64`,
    )
    .where(
      sql<boolean>`least(abs(anchor_cell_y-${village.anchorCellY}),${village.heightCells}-abs(anchor_cell_y-${village.anchorCellY})) <= 64`,
    )
    .orderBy('roadCells.cellX')
    .orderBy('roadCells.cellY')
    .execute();
  // Accessories on the anchors of these road cells block passage (Tristan,
  // 30 October): each one joins the plan as an equipment of the legacy ±1/8
  // cell footprint at its vertex. Without accessories, nothing is added and
  // every network fingerprint is unchanged (S4a, §5.1).
  const anchorRows = roadCells.length
    ? await tx
        .selectFrom('roadAnchors')
        .innerJoin('villages', (join) =>
          join.onRef('villages.id', '=', 'roadAnchors.villageId').onRef('villages.worldId', '=', 'roadAnchors.worldId'),
        )
        .select(['roadAnchors.villageId', 'roadAnchors.vertexX', 'roadAnchors.vertexY', 'roadAnchors.accessory'])
        .where('roadAnchors.worldId', '=', village.worldId)
        .where(
          sql<boolean>`least(abs(anchor_cell_x-${village.anchorCellX}),${village.widthCells}-abs(anchor_cell_x-${village.anchorCellX})) <= 64`,
        )
        .where(
          sql<boolean>`least(abs(anchor_cell_y-${village.anchorCellY}),${village.heightCells}-abs(anchor_cell_y-${village.anchorCellY})) <= 64`,
        )
        .execute()
    : [];
  const anchorEquipment = roadAnchorEquipment(roadCells, anchorRows, village);
  return {
    ...own,
    ...(roadCells.length
      ? { roadCells: roadCells.map(({ cellX, cellY, surface, sidewalks }) => ({ cellX, cellY, surface, sidewalks })) }
      : {}),
    roads: [...own.roads, ...foreign.flatMap((p) => p.roads)],
    equipment: [...own.equipment, ...foreign.flatMap((p) => p.equipment), ...anchorEquipment],
    manualLighting: [...own.manualLighting, ...foreign.flatMap((p) => p.manualLighting)],
    suppressedBraziers: [...own.suppressedBraziers, ...foreign.flatMap((p) => p.suppressedBraziers)],
  };
}
export async function assertNoInfrastructure(
  tx: Transaction<Database>,
  worldId: string,
  cells: readonly { cellX: number; cellY: number }[],
  world: { widthCells: number; heightCells: number },
) {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`infrastructure:${worldId}`},0))`.execute(tx);
  const wanted = new Set(cells.map((c) => `${c.cellX}:${c.cellY}`));
  // Road cells of any village (073), read under the same lock as their writer.
  if (
    cells.length &&
    (await tx
      .selectFrom('roadCells')
      .select('cellX')
      .where('worldId', '=', worldId)
      .where(
        sql<boolean>`(cell_x,cell_y) in (select * from unnest(${cells.map((c) => c.cellX)}::int[],${cells.map((c) => c.cellY)}::int[]))`,
      )
      .executeTakeFirst())
  )
    throw new HttpError(409, 'INFRASTRUCTURE_OCCUPIED', 'Retirez la route de cette case avant de construire.');
  // Neighbor-owned plans remain protected even where historical perimeters overlap.
  const plans = await tx.selectFrom('villageInfrastructure').select('plan').where('worldId', '=', worldId).execute();
  for (const { plan } of plans) {
    if (plan.equipment.some((e) => wanted.has(subCellKey(e, world))))
      throw new HttpError(409, 'INFRASTRUCTURE_OCCUPIED', 'Déplacez l’équipement avant de construire.');
    const surface = infrastructurePlanSurface(plan, world),
      sidewalk = infrastructureSidewalkSurface(surface, world);
    if (
      [...surface.values()].some(
        (p) =>
          p.manual &&
          wanted.has(
            `${Math.floor((p.x + 8) / 16) % world.widthCells}:${Math.floor((p.y + 8) / 16) % world.heightCells}`,
          ),
      ) ||
      [...sidewalk.values()].some((p) =>
        wanted.has(
          `${Math.floor((p.x + 8) / 16) % world.widthCells}:${Math.floor((p.y + 8) / 16) % world.heightCells}`,
        ),
      )
    )
      throw new HttpError(
        409,
        'INFRASTRUCTURE_OCCUPIED',
        'Déplacez ou retirez la voie ou le trottoir avant de construire.',
      );
  }
  const all = await worldActivePaths(tx, worldId);
  if (all.some((path) => cells.some((c) => pathPassageIntersectsBox(path, c, 0.5, 0.5, world))))
    throw new HttpError(409, 'ENGAGED_PASSAGE', 'Une équipe utilise encore cette emprise.');
}
/**
 * Per-cell form of `assertNoInfrastructure`, read once for many cells (terrain
 * edits refuse cell by cell, docs/SPEC-TERRAFORMATION-OUTIL.md §7): the refusal
 * `assertNoInfrastructure([cell])` would throw for each refused cell, keyed
 * `x:y`, under the same advisory lock and in the same order of checks.
 */
export async function infrastructureCellRefusals(
  tx: Transaction<Database>,
  worldId: string,
  cells: readonly { cellX: number; cellY: number }[],
  world: { widthCells: number; heightCells: number },
): Promise<Map<string, HttpError>> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`infrastructure:${worldId}`},0))`.execute(tx);
  const refusals = new Map<string, HttpError>();
  if (!cells.length) return refusals;
  const wanted = new Set(cells.map((c) => `${c.cellX}:${c.cellY}`));
  const refuse = (key: string, code: string, message: string) => {
    if (wanted.has(key) && !refusals.has(key)) refusals.set(key, new HttpError(409, code, message));
  };
  for (const road of await tx
    .selectFrom('roadCells')
    .select(['cellX', 'cellY'])
    .where('worldId', '=', worldId)
    .where(
      sql<boolean>`(cell_x,cell_y) in (select * from unnest(${cells.map((c) => c.cellX)}::int[],${cells.map((c) => c.cellY)}::int[]))`,
    )
    .execute())
    refuse(
      `${road.cellX}:${road.cellY}`,
      'INFRASTRUCTURE_OCCUPIED',
      'Retirez la route de cette case avant de construire.',
    );
  const plans = await tx.selectFrom('villageInfrastructure').select('plan').where('worldId', '=', worldId).execute();
  const surfaceKey = (p: { x: number; y: number }) =>
    `${Math.floor((p.x + 8) / 16) % world.widthCells}:${Math.floor((p.y + 8) / 16) % world.heightCells}`;
  for (const { plan } of plans) {
    for (const e of plan.equipment)
      refuse(subCellKey(e, world), 'INFRASTRUCTURE_OCCUPIED', 'Déplacez l’équipement avant de construire.');
    const surface = infrastructurePlanSurface(plan, world),
      sidewalk = infrastructureSidewalkSurface(surface, world);
    for (const p of [...[...surface.values()].filter((p) => p.manual), ...sidewalk.values()])
      refuse(
        surfaceKey(p),
        'INFRASTRUCTURE_OCCUPIED',
        'Déplacez ou retirez la voie ou le trottoir avant de construire.',
      );
  }
  const paths = await worldActivePaths(tx, worldId);
  if (paths.length)
    for (const c of cells)
      if (paths.some((path) => pathPassageIntersectsBox(path, c, 0.5, 0.5, world)))
        refuse(`${c.cellX}:${c.cellY}`, 'ENGAGED_PASSAGE', 'Une équipe utilise encore cette emprise.');
  return refusals;
}

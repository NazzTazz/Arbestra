import { isDeepStrictEqual } from 'node:util';
import { sql, type Kysely, type Transaction } from 'kysely';
import {
  uniqueRoadCells,
  type DemolitionConfirmationV2,
  type DemolitionRequest,
  type DemolitionResult,
  type SyncV2Batch,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { readRc1Source } from '../worlds/rc1-source.js';
import { advancePopulationGrowth } from '../population/growth.js';
import { HOUSING_BUILDING_TYPES } from '../population/housing.js';
import { materializeCohorts, releaseWorkers } from '../population/work.js';
import { abandonScienceAt } from '../science/service.js';
import { beginVillageEconomy, type VillageEconomy } from './reconcile-economy.js';
import { publishPrivateEffects } from './sync-v2-effects.js';
import { cleanRoadAnchors, removeRoadAnchors } from './road-anchors.js';
import { roadCellsToRemove } from './road-cells.js';
import { ownedVillage, villageCommandResult, type OwnedVillage } from './service.js';

/** Demolition (docs/SPEC-DEMOLITION.md §9): immediate at admission, without
 * duration, workers or refund. One V2 command per designation. */
type Cell = { cellX: number; cellY: number };
const cellKey = (c: Cell) => `${c.cellX}:${c.cellY}`;
const unnest = (cells: readonly Cell[], x = 'cell_x', y = 'cell_y') =>
  sql<boolean>`(${sql.ref(x)},${sql.ref(y)}) in (select * from unnest(${cells.map((c) => c.cellX)}::int[],${cells.map((c) => c.cellY)}::int[]))`;

/** Canonical content of a designation: what one command identifier names.
 * Each target counts once; buildings in UUID order, cells in first-seen order. */
function canonical(request: DemolitionRequest) {
  const braziers = new Map(request.braziers.map((v) => [v.vertexX + ':' + v.vertexY, v]));
  return {
    buildings: [...new Set(request.buildings.map((b) => b.id.toLowerCase()))].sort(),
    gardenCells: uniqueRoadCells(request.gardenCells).map(({ cellX, cellY }) => ({ cellX, cellY })),
    roadCells: uniqueRoadCells(request.roadCells).map(({ cellX, cellY }) => ({ cellX, cellY })),
    braziers: [...braziers.values()].map(({ vertexX, vertexY }) => ({ vertexX, vertexY })),
  };
}
type Content = ReturnType<typeof canonical>;

interface Prepared {
  /** Buildings deleted whole: named buildings, and garden rows left without a cell. */
  buildings: Array<{ id: string; buildingType: string }>;
  /** Garden cells removed, with the row they leave. */
  gardenCells: Array<Cell & { buildingId: string; pendingExpansionId: string | null }>;
  /** Garden rows that keep cells and lose their anchor: the new anchor. */
  newAnchors: Array<Cell & { buildingId: string }>;
  roadCells: Cell[];
  unchanged: number;
}

/** Bounded reads; every refusal is thrown before any write. Locks the touched
 * buildings in canonical UUID order, after the village. */
async function prepareDemolition(
  tx: Transaction<Database>,
  village: OwnedVillage,
  content: Content,
): Promise<Prepared> {
  const { worldId, villageId } = village;
  let unchanged = 0;
  const named = content.buildings.length
    ? await tx
        .selectFrom('buildings')
        .select(['id', 'buildingType'])
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where('id', 'in', content.buildings)
        .execute()
    : [];
  // A building already gone (a concurrent sweep) is unchanged, not refused.
  unchanged += content.buildings.length - named.length;
  if (named.some((b) => b.buildingType === 'town-hall'))
    throw new HttpError(409, 'TOWN_HALL', 'L’hôtel de ville ne se démolit pas.');
  if (named.some((b) => b.buildingType === 'garden'))
    throw new HttpError(422, 'GARDEN_BY_CELL', 'Un jardin se démolit case par case.');

  const occupied = content.gardenCells.length
    ? await tx
        .selectFrom('worldCellOccupancies')
        .innerJoin('buildings', (join) =>
          join
            .onRef('buildings.worldId', '=', 'worldCellOccupancies.worldId')
            .onRef('buildings.id', '=', 'worldCellOccupancies.buildingId'),
        )
        .select([
          'worldCellOccupancies.cellX',
          'worldCellOccupancies.cellY',
          'worldCellOccupancies.buildingId',
          'worldCellOccupancies.pendingExpansionId',
          'buildings.villageId',
          'buildings.buildingType',
        ])
        .where('worldCellOccupancies.worldId', '=', worldId)
        .where(unnest(content.gardenCells, 'world_cell_occupancies.cell_x', 'world_cell_occupancies.cell_y'))
        .execute()
    : [];
  if (occupied.some((o) => o.villageId !== villageId))
    throw new HttpError(409, 'FOREIGN_INFRASTRUCTURE', 'Un aménagement d’un autre village occupe cet emplacement.');
  const gardenCells = occupied
    .filter((o) => o.buildingType === 'garden')
    .map((o) => ({
      cellX: o.cellX,
      cellY: o.cellY,
      buildingId: o.buildingId!,
      pendingExpansionId: o.pendingExpansionId,
    }));
  unchanged += content.gardenCells.length - gardenCells.length;

  const roadCells = await roadCellsToRemove(tx, village, content.roadCells);
  unchanged += content.roadCells.length - roadCells.length;

  const gardenRows = [...new Set(gardenCells.map((c) => c.buildingId))];
  const locked = [...new Set([...named.map((b) => b.id), ...gardenRows])].sort();
  if (locked.length)
    await tx
      .selectFrom('buildings')
      .select('id')
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('id', 'in', locked)
      .orderBy('id')
      .forUpdate()
      .execute();

  // A garden row keeps its other active cells; without one it leaves whole.
  const buildings = [...named];
  const newAnchors: Prepared['newAnchors'] = [];
  if (gardenRows.length) {
    const removed = new Set(gardenCells.map(cellKey));
    const rest = await tx
      .selectFrom('worldCellOccupancies')
      .select(['buildingId', 'cellX', 'cellY', 'role', 'pendingExpansionId'])
      .where('worldId', '=', worldId)
      .where('buildingId', 'in', gardenRows)
      .orderBy('cellX')
      .orderBy('cellY')
      .execute();
    for (const id of gardenRows) {
      const kept = rest.filter((o) => o.buildingId === id && !removed.has(cellKey(o)) && !o.pendingExpansionId);
      if (!kept.length) buildings.push({ id, buildingType: 'garden' });
      else if (!kept.some((o) => o.role === 'anchor'))
        newAnchors.push({ buildingId: id, cellX: kept[0]!.cellX, cellY: kept[0]!.cellY });
    }
  }
  return { buildings, gardenCells, newAnchors, roadCells, unchanged };
}

/** Workers busy at a target are released before the rows leave: a running
 * workshop lot (lost), a garden harvest on a deleted row or passing through a
 * removed cell (deleted, reserved carrots lost). Sleepers lose their bed and
 * stay at rest: the bed allocation at the end of the command rehouses them. */
async function releaseOccupants(tx: Transaction<Database>, economy: VillageEconomy, prepared: Prepared) {
  const { worldId, villageId, through } = economy;
  const deleted = prepared.buildings.map((b) => b.id);
  const lots = deleted.length
    ? await tx
        .selectFrom('processingLots')
        .innerJoin('processingOrders', (join) =>
          join
            .onRef('processingOrders.worldId', '=', 'processingLots.worldId')
            .onRef('processingOrders.id', '=', 'processingLots.orderId'),
        )
        .select(['processingLots.id', 'processingLots.workerCount'])
        .where('processingLots.worldId', '=', worldId)
        .where('processingLots.villageId', '=', villageId)
        .where('processingOrders.buildingId', 'in', deleted)
        .where('processingLots.completedAt', 'is', null)
        .execute()
    : [];
  const rows = new Set([...deleted, ...prepared.gardenCells.map((c) => c.buildingId)]);
  const removed = new Set(prepared.gardenCells.map(cellKey));
  const harvests = rows.size
    ? (
        await tx
          .selectFrom('gardenHarvests')
          .select(['id', 'buildingId', 'workerCount', 'plotCellX', 'plotCellY', 'stops'])
          .where('worldId', '=', worldId)
          .where('villageId', '=', villageId)
          .where('status', '=', 'in-progress')
          .execute()
      ).filter(
        (h) =>
          deleted.includes(h.buildingId) ||
          (h.plotCellX === null && rows.has(h.buildingId)) ||
          (h.plotCellX !== null && removed.has(`${h.plotCellX}:${h.plotCellY}`)) ||
          h.stops.some((s) => removed.has(cellKey(s))),
      )
    : [];
  if (lots.length || harvests.length) {
    const cohorts = await materializeCohorts(tx, worldId, villageId, through);
    for (const lot of lots)
      await releaseWorkers(
        tx,
        cohorts.filter((c) => c.processingLotId === lot.id),
        lot.workerCount,
        through,
      );
    for (const harvest of harvests)
      await releaseWorkers(
        tx,
        cohorts.filter((c) => c.harvestId === harvest.id),
        harvest.workerCount,
        through,
      );
    if (harvests.length)
      await tx
        .deleteFrom('gardenHarvests')
        .where('worldId', '=', worldId)
        .where(
          'id',
          'in',
          harvests.map((h) => h.id),
        )
        .execute();
  }
  await abandonScienceAt(tx, economy, deleted);
  if (deleted.length)
    await tx
      .updateTable('populationCohorts')
      .set({ restBuildingId: null })
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('restBuildingId', 'in', deleted)
      .execute();
}

/** Test seam: runs after every deletion, before the receipt and the
 * publication (rollback proof); `afterLock` once the village is held. */
export const demolitionTestHooks: {
  afterLock?: () => Promise<void>;
  afterWrites?: (tx: Transaction<Database>) => Promise<void>;
} = {};

/** V2-native demolition: village lock (beginVillageEconomy, with the world's
 * exclusive navigation lock: footprints and roads change), bounded reads,
 * refusal without writes, deletions, receipt, then terminal publication of
 * the private effects. Idempotent by `commandId`. */
export async function demolitionCommandV2(
  db: Kysely<Database>,
  accountId: string,
  slug: string,
  villageId: string,
  request: DemolitionRequest,
  generation: number,
): Promise<DemolitionConfirmationV2> {
  if (!Number.isSafeInteger(generation) || generation < 0) throw Error('Invalid synchronization generation');
  const content = canonical(request);
  if (!content.buildings.length && !content.gardenCells.length && !content.roadCells.length && !content.braziers.length)
    throw new HttpError(400, 'EMPTY_DEMOLITION', 'Aucune cible à démolir.');
  const replay = async (tx: Kysely<Database>, village: OwnedVillage) => {
    const receipt = await tx
      .selectFrom('demolitionReceipts')
      .selectAll()
      .where('worldId', '=', village.worldId)
      .where('villageId', '=', village.villageId)
      .where('commandId', '=', request.commandId)
      .executeTakeFirst();
    if (!receipt) return null;
    if (!isDeepStrictEqual(receipt.request, content))
      throw new HttpError(409, 'COMMAND_REUSED', 'Identifiant de commande déjà utilisé.');
    return {
      protocol: 2 as const,
      worldId: village.worldId,
      villageId: village.villageId,
      commandId: request.commandId,
      status: 'applied' as const,
      commandTime: new Date(receipt.createdAt).toISOString(),
      result: receipt.result,
    };
  };
  // An exact replay answers from its receipt, without lock or reconciliation.
  const known = await replay(db, await ownedVillage(db, accountId, slug, villageId));
  if (known) return known;
  return db.transaction().execute(async (tx) => {
    const village = await ownedVillage(tx, accountId, slug, villageId);
    const { worldId } = village;
    for (const c of [...content.gardenCells, ...content.roadCells])
      if (c.cellX >= village.widthCells || c.cellY >= village.heightCells)
        throw new HttpError(400, 'INVALID_COORDINATES', 'Coordonnées non canoniques.');
    if (village.generationVersion === 3) await readRc1Source(tx, worldId);
    const economy = await beginVillageEconomy(tx, worldId, villageId, undefined, [], [], true);
    await demolitionTestHooks.afterLock?.();
    // A concurrent first attempt of the same identifier committed meanwhile.
    const raced = await replay(tx, village);
    if (raced) return raced;
    const prepared = await prepareDemolition(tx, village, content);
    await releaseOccupants(tx, economy, prepared);
    // Garden cells: a pending extension leaves with its reservation; an active
    // cell with its plot and its occupancy.
    const pending = [...new Set(prepared.gardenCells.flatMap((c) => c.pendingExpansionId ?? []))];
    if (pending.length)
      await tx.deleteFrom('buildingExpansions').where('worldId', '=', worldId).where('id', 'in', pending).execute();
    const active = prepared.gardenCells.filter((c) => !c.pendingExpansionId);
    if (active.length) {
      await tx
        .deleteFrom('gardenPlots')
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where(unnest(active))
        .execute();
      await tx.deleteFrom('worldCellOccupancies').where('worldId', '=', worldId).where(unnest(active)).execute();
    }
    for (const anchor of prepared.newAnchors)
      await tx
        .updateTable('worldCellOccupancies')
        .set({ role: 'anchor' })
        .where('worldId', '=', worldId)
        .where('buildingId', '=', anchor.buildingId)
        .where('cellX', '=', anchor.cellX)
        .where('cellY', '=', anchor.cellY)
        .execute();
    if (prepared.buildings.length)
      await tx
        .deleteFrom('buildings')
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where(
          'id',
          'in',
          prepared.buildings.map((b) => b.id),
        )
        .execute();
    // Fewer beds: the growth target drops; no inhabitant is removed.
    if (prepared.buildings.some((b) => (HOUSING_BUILDING_TYPES as readonly string[]).includes(b.buildingType)))
      await advancePopulationGrowth(tx, worldId, villageId, economy.through, true);
    if (prepared.roadCells.length) {
      await tx
        .deleteFrom('roadCells')
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .where(unnest(prepared.roadCells))
        .execute();
      await cleanRoadAnchors(tx, worldId, villageId, prepared.roadCells, village);
    }
    // Braziers after the roads: removing cells can make a vertex an automatic
    // corner, or leave it without any road.
    const anchors = await removeRoadAnchors(tx, village, economy, content.braziers);
    await demolitionTestHooks.afterWrites?.(tx);
    const result: DemolitionResult = {
      buildings: prepared.buildings.filter((b) => b.buildingType !== 'garden').length,
      gardenCells: prepared.gardenCells.length,
      roadCells: prepared.roadCells.length,
      braziers: anchors.removed,
      unchanged: prepared.unchanged + anchors.unchanged,
    };
    await tx
      .insertInto('demolitionReceipts')
      .values({
        worldId,
        villageId,
        commandId: request.commandId,
        request: JSON.stringify(content),
        result: JSON.stringify(result),
        createdAt: economy.through,
      })
      .execute();
    let effects: SyncV2Batch | undefined;
    await villageCommandResult(tx, accountId, slug, village, economy, 'commit', request.commandId, async (t, e) => {
      effects = await publishPrivateEffects(t, e, generation);
    });
    return {
      protocol: 2,
      worldId,
      villageId,
      commandId: request.commandId,
      status: 'applied',
      commandTime: economy.through.toISOString(),
      result,
      ...(effects ? { effects } : {}),
    };
  });
}

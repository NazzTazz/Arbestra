import { infrastructurePlanSurface, spawnPathSurfaces, type SpawnSurface, type TravelCell } from '@arbestra/contracts';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/schema.js';

/** Private server snapshot. Never serialize routes or resource reservations into
 * the arrival map. No economy reconciliation, locking or writes. */
export async function spawnProtectedSurfaces(db: Kysely<Database>, worldId: string): Promise<SpawnSurface[]> {
  return (await spawnSpatialState(db, worldId)).protectedSurfaces;
}
export async function spawnSpatialState(db: Kysely<Database>, worldId: string) {
  const result: SpawnSurface[] = [];
  const walkBlockedSurfaces: SpawnSurface[] = [];
  const occupants = await db.selectFrom('worldCellOccupancies').leftJoin('worldFeatures', join => join
    .onRef('worldFeatures.worldId', '=', 'worldCellOccupancies.worldId').onRef('worldFeatures.id', '=', 'worldCellOccupancies.featureId'))
    .select(['cellX', 'cellY', 'buildingId', 'pendingExpansionId', 'worldFeatures.featureTypeCode', 'worldFeatures.state'])
    .where('worldCellOccupancies.worldId', '=', worldId).execute();
  for (const c of occupants) if (c.buildingId || c.pendingExpansionId || c.featureTypeCode !== 'woodland' || c.state === 'reserved') {
    const surface = { x: c.cellX, y: c.cellY, halfWidth: .5, halfHeight: .5 };
    result.push(surface); walkBlockedSurfaces.push(surface);
  }
  const plans = await db.selectFrom('villageInfrastructure').select('plan').where('worldId', '=', worldId).execute();
  for (const { plan } of plans) {
    for (const p of infrastructurePlanSurface(plan, { widthCells: 512, heightCells: 256 }).values()) if (p.material !== 'none' || p.border)
      result.push({ x: p.x / 16, y: p.y / 16, halfWidth: 1 / 32, halfHeight: 1 / 32 });
    for (const e of plan.equipment) {
      const surface = { x: e.x / 8, y: e.y / 8, halfWidth: .125, halfHeight: .125 };
      result.push(surface); walkBlockedSurfaces.push(surface);
    }
  }
  const protect = (path: readonly TravelCell[] | null) => {
    if (path) result.push(...spawnPathSurfaces(path.map(p => ({ x: p.cellX, y: p.cellY })), 512, 256));
  };
  const extractions = await db.selectFrom('depositExtractions').select('pathCells').where('worldId', '=', worldId).where('status', '=', 'in-progress').execute();
  for (const row of extractions) protect(row.pathCells);
  const harvests = await db.selectFrom('gardenHarvests').select(['pathCells', 'returnPathCells', 'stops']).where('worldId', '=', worldId).where('status', '=', 'in-progress').execute();
  for (const row of harvests) { protect(row.pathCells); protect(row.returnPathCells); for (const stop of row.stops) protect(stop.path); }
  const orders = await db.selectFrom('exploitationOrders').select('gardenPlan').where('worldId', '=', worldId).where('gardenStatus', 'in', ['pending', 'active']).execute();
  for (const row of orders) if (row.gardenPlan) { protect(row.gardenPlan.returnPath); for (const stop of row.gardenPlan.stops) protect(stop.path); }
  const activities = await db.selectFrom('scienceActivities').select('pathCells').where('worldId', '=', worldId).where('status', '=', 'in-progress').execute();
  for (const row of activities) protect(row.pathCells);
  // Reserved wood can still have feature.state=available while workers are away.
  const reserved = await db.selectFrom('woodlandDeposits').select(['cellX', 'cellY']).where('worldId', '=', worldId).where('reservedAmount', '>', '0').execute();
  for (const c of reserved) {
    const surface = { x: c.cellX, y: c.cellY, halfWidth: .5, halfHeight: .5 };
    result.push(surface); walkBlockedSurfaces.push(surface);
  }
  // Shared roads and mission passages forbid placing a building/deposit on top;
  // their presence does not by itself close that ground to pedestrian traffic.
  return { protectedSurfaces: result, walkBlockedSurfaces };
}

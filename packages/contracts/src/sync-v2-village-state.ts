import type { VillageState } from './villages.js';
import type { ProcessingOrder } from './processing.js';
import type { MarketJourney, TradeOffer } from './market.js';
import type { ResolvedVillagePresentation } from './village-presentation.js';
import { visibleSyncV2Scope, type SyncV2Change, type SyncV2State } from './sync-v2.js';
import { emptyInfrastructure } from './infrastructure.js';

const CELL_SIZE = 2.5;
type Entity<C extends SyncV2Change['component']> = Extract<SyncV2Change, { component: C }>['upsert'][number];
type Village = VillageState['village'];
type MarketExchange = NonNullable<Village['market']>['exchanges'][number];
type Garden = NonNullable<NonNullable<VillageState['cells'][number]['building']>['garden']>;

function wrappedDelta(value: number, origin: number, size: number): number {
  const direct = value - origin;
  return direct > size / 2 ? direct - size : direct < -size / 2 ? direct + size : direct;
}
const byTime = (a: string, b: string) => Date.parse(a) - Date.parse(b);

/** Historical VillageState rebuilt from applied V2 streams and the versioned
 * presentation, with the presence rules of the historical snapshot (recent
 * terminal history, in-progress missions). Returns null while a required
 * stream is not loaded: the caller keeps its previous state. */
export function villageStateFromSyncV2(
  sync: SyncV2State,
  presentation: ResolvedVillagePresentation,
  observedAt: string,
): VillageState | null {
  const scope = (kind: string) => [...sync.scopes].find(([key]) => key.startsWith(kind + ':'))?.[1];
  const village = sync.scopes.get(`village:${sync.villageId}`),
    knowledge = scope('knowledge'),
    manifest = scope('manifest'),
    traffic = scope('traffic');
  if (
    !village ||
    !knowledge ||
    !manifest ||
    presentation.worldId !== sync.worldId ||
    presentation.villageId !== sync.villageId
  )
    return null;
  const values = [
    visibleSyncV2Scope(village),
    visibleSyncV2Scope(knowledge),
    visibleSyncV2Scope(manifest),
    ...(traffic ? [visibleSyncV2Scope(traffic)] : []),
  ];
  const list = <C extends SyncV2Change['component']>(component: C): Entity<C>[] => {
    const rows: Entity<C>[] = [];
    for (const map of values)
      for (const [key, value] of map) if (key.startsWith(component + ':')) rows.push(value as Entity<C>);
    return rows;
  };
  const identity = list('identity')[0],
    summary = list('populationSummary')[0],
    game = list('gameManifest')[0],
    science = list('knowledgeScience')[0];
  if (!identity || !summary || !game || !science) return null;
  const world = game.world,
    resources = list('resources').sort((a, b) => a.code.localeCompare(b.code));
  const wood = resources.find((row) => row.code === 'wood'),
    carrot = resources.find((row) => row.code === 'carrot');
  if (!wood || !carrot || !wood.productionUpdatedAt) return null;
  const buildings = new Map(list('buildings').map((row) => [row.id, row]));
  const plots = list('gardenPlots').sort((a, b) => a.cellX - b.cellX || a.cellY - b.cellY);
  const harvests = list('gardenHarvests'),
    expansions = list('buildingExpansions');
  const footprintOf = new Map<string, ResolvedVillagePresentation['cells']>();
  const ownerAt = new Map<string, string>();
  for (const cell of presentation.cells)
    if (cell.footprint) {
      const rows = footprintOf.get(cell.footprint.buildingId) ?? [];
      rows.push(cell);
      footprintOf.set(cell.footprint.buildingId, rows);
      ownerAt.set(`${cell.cellX}:${cell.cellY}`, cell.footprint.buildingId);
    }
  const harvestAt = new Map<string, Entity<'gardenHarvests'>>();
  for (const harvest of harvests)
    if (harvest.plotCellX !== null && harvest.plotCellY !== null)
      for (const stop of harvest.stops.length
        ? harvest.stops
        : [{ cellX: harvest.plotCellX, cellY: harvest.plotCellY }])
        harvestAt.set(`${stop.cellX}:${stop.cellY}`, harvest);
  const garden = (logicalId: string, status: string): Garden | null => {
    const component = plots.filter((plot) => ownerAt.get(`${plot.cellX}:${plot.cellY}`) === logicalId);
    if (!component.length) return null;
    const members = new Set([logicalId, ...component.map((plot) => plot.buildingId)]);
    const footprint = footprintOf.get(logicalId) ?? [];
    const pending = footprint.filter((cell) => cell.footprint!.state === 'reserved').length;
    const ownExpansions = expansions
      .filter((expansion) => expansion.cells.some((cell) => ownerAt.get(`${cell.cellX}:${cell.cellY}`) === logicalId))
      .map(({ id, startedAt, completesAt, cells }) => ({ id, startedAt, completesAt, cells }))
      .sort((a, b) => a.completesAt.localeCompare(b.completesAt) || a.id.localeCompare(b.id));
    const legacy = harvests.find((harvest) => harvest.plotCellX === null && members.has(harvest.buildingId));
    return {
      storedCarrots: component.reduce((sum, plot) => sum + plot.amount, 0),
      capacity: component.reduce((sum, plot) => sum + plot.capacity, 0),
      productionPerHour: component.reduce((sum, plot) => sum + plot.productionPerHour, 0),
      productionUpdatedAt: observedAt,
      activeCellCount: status === 'completed' ? footprint.length - pending : 0,
      pendingCellCount: status === 'completed' ? pending : footprint.length,
      plots: component.map((plot) => {
        const harvest = harvestAt.get(`${plot.cellX}:${plot.cellY}`);
        return {
          cellX: plot.cellX,
          cellY: plot.cellY,
          storedCarrots: plot.amount,
          capacity: plot.capacity,
          productionPerHour: plot.productionPerHour,
          productionUpdatedAt: plot.productionUpdatedAt,
          full: plot.amount >= plot.capacity,
          harvest: harvest
            ? {
                id: harvest.id,
                startedAt: harvest.startedAt,
                completesAt: harvest.completesAt,
                reservedCarrots:
                  harvest.stops.find((stop) => stop.cellX === plot.cellX && stop.cellY === plot.cellY)
                    ?.reservedCarrots ?? harvest.reservedCarrots,
                transportMs: harvest.transportMs,
                path: harvest.path,
                stops: harvest.stops,
                returnPath: harvest.returnPath,
              }
            : null,
        };
      }),
      expansion: ownExpansions[0] ?? null,
      expansions: ownExpansions,
      harvest: legacy
        ? {
            id: legacy.id,
            startedAt: legacy.startedAt,
            completesAt: legacy.completesAt,
            workerCount: legacy.workerCount,
            reservedCarrots: legacy.reservedCarrots,
            transportMs: legacy.transportMs,
            path: legacy.path,
          }
        : null,
    };
  };
  const cells: VillageState['cells'] = presentation.cells.map((cell) => {
    const logical = cell.footprint?.buildingId,
      row = cell.displaysBuilding && logical ? buildings.get(logical) : undefined;
    return {
      id: `${cell.cellX}:${cell.cellY}`,
      cellX: cell.cellX,
      cellY: cell.cellY,
      x: wrappedDelta(cell.cellX, identity.anchorCellX, world.widthCells) * CELL_SIZE,
      z: wrappedDelta(cell.cellY, identity.anchorCellY, world.heightCells) * CELL_SIZE,
      building: row ? { ...row, garden: row.type === 'garden' ? garden(row.id, row.status) : null } : null,
      footprint: cell.footprint,
      canBuild: cell.canBuild,
    };
  });
  const recent = <T>(rows: T[], terminal: (row: T) => boolean, order: (a: T, b: T) => number, limit: number) =>
    [...rows.filter((row) => !terminal(row)), ...rows.filter(terminal).sort(order).slice(0, limit)].sort(order);
  const processing = recent<ProcessingOrder>(
    list('processingOrders'),
    (order) => ['completed', 'cancelled'].includes(order.status),
    (a, b) => byTime(b.createdAt, a.createdAt) || a.id.localeCompare(b.id),
    20,
  );
  const exchanges = recent<MarketExchange>(
    list('marketExchanges'),
    (exchange) => exchange.completedAt !== null,
    (a, b) => byTime(b.startedAt, a.startedAt) || a.id.localeCompare(b.id),
    20,
  );
  const townHall = [...buildings.values()].find((row) => row.type === 'town-hall');
  const villageState: Village = {
    id: identity.id,
    name: identity.name,
    anchorCellX: identity.anchorCellX,
    anchorCellY: identity.anchorCellY,
    ...(townHall ? { townHallBuildingId: townHall.id } : {}),
    resources,
    wood: wood.amount,
    carrots: carrot.amount,
    woodProductionPerHour: wood.productionPerHour,
    woodProductionUpdatedAt: wood.productionUpdatedAt,
    population: {
      ...omit(summary, ['id']),
      cohorts: list('cohorts')
        .map((cohort) => omit(cohort, ['clock']))
        .sort((a, b) => a.id.localeCompare(b.id)),
      restHousing: list('restHousing').sort((a, b) => a.buildingId.localeCompare(b.buildingId)),
    },
    accomplishments: list('accomplishments').sort(
      (a, b) => a.completedAt.localeCompare(b.completedAt) || a.code.localeCompare(b.code),
    ),
    extractions: list('extractions')
      .filter((row) => row.status === 'in-progress')
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id)),
    worksites: list('worksites')
      .sort((a, b) => byTime(b.createdAt, a.createdAt) || a.id.localeCompare(b.id))
      .slice(0, 32),
    extractionPools: list('extractionPools').sort((a, b) => b.resource.localeCompare(a.resource)),
    exploitationOrders: list('exploitationOrders')
      .sort((a, b) => byTime(b.confirmedAt, a.confirmedAt))
      .slice(0, 32),
    levelingJobs: list('levelingJobs').sort((a, b) => a.id.localeCompare(b.id)),
    processingOrders: processing,
    market: {
      ...presentation.market,
      exchanges,
      offers: list('tradeOffers').sort((a: TradeOffer, b: TradeOffer) => byTime(b.createdAt, a.createdAt)),
      // Convoys are public: the world traffic stream when subscribed, else
      // only the village's own and incoming convoys from its private stream.
      journeys: (traffic ? list('convoys') : list('tradeJourneys')).filter(
        (row: MarketJourney) => Date.parse(row.returnsAt) > Date.parse(observedAt),
      ),
    },
  };
  // No stored plan means the empty plan, as for the historical reader.
  return {
    infrastructure: list('infrastructure')[0]?.plan ?? emptyInfrastructure(),
    factoryEnabled: game.factoryEnabled,
    science: science.state,
    serverTime: observedAt,
    world,
    village: villageState,
    buildingTypes: game.buildingTypes,
    travelRoutes: presentation.travelRoutes,
    region: presentation.region,
    cells,
  };
}

/** Wire-only fields absent from the historical shapes (entity key, clock). */
function omit<T extends object, K extends keyof T>(row: T, keys: readonly K[]): Omit<T, K> {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !(keys as readonly PropertyKey[]).includes(key)),
  ) as Omit<T, K>;
}

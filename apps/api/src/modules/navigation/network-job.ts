import type {GeneratedLandscape, TravelNetworkState, TravelRoute} from '@arbestra/contracts';
import {RC1_CANONICAL_CHECKSUM} from '../onboarding/spawn-compute-protocol.js';
import type {Rc1NetworkEdits} from './rc1-network-ground.js';

export interface NetworkJob {
  state: TravelNetworkState;
  ground?: {sourceId: string; artifact?: string; edits: Rc1NetworkEdits};
}
export type NetworkLoader = (known: {sources: ReadonlySet<string>}) => Promise<NetworkJob>;
export interface TravelNetworkExecutor { network(load: NetworkLoader): Promise<TravelRoute[]> }

const encoded = new WeakMap<GeneratedLandscape, string>();
/** Copy only the geometry consumed by the planner, never accounts or economy. */
export function networkState(s: TravelNetworkState): TravelNetworkState {
  return {world: {id: s.world.id, widthCells: s.world.widthCells, heightCells: s.world.heightCells},
    village: {anchorCellX: s.village.anchorCellX, anchorCellY: s.village.anchorCellY,
      ...(s.village.townHallBuildingId === undefined ? {} : {townHallBuildingId: s.village.townHallBuildingId})},
    region: {originCellX: s.region.originCellX, originCellY: s.region.originCellY, width: s.region.width, height: s.region.height,
      terrainCodes: s.region.terrainCodes, features: s.region.features.map(f => ({id: f.id, type: f.type, cellX: f.cellX, cellY: f.cellY,
        deposit: f.deposit ? {state: f.deposit.state,
          ...(f.deposit.blocksCell === undefined ? {} : {blocksCell: f.deposit.blocksCell}),
          ...(f.deposit.cleared === undefined ? {} : {cleared: f.deposit.cleared})} : null}))},
    cells: s.cells.map(c => ({cellX: c.cellX, cellY: c.cellY, footprint: c.footprint ? {buildingId: c.footprint.buildingId} : null,
      building: c.building ? {id: c.building.id, type: c.building.type,
        ...(c.building.quarterTurns === undefined ? {} : {quarterTurns: c.building.quarterTurns}),
        ...(c.building.visualLayout === undefined ? {} : {visualLayout: c.building.visualLayout}),
        ...(c.building.accesses === undefined ? {} : {accesses: c.building.accesses}),
        ...(c.building.garden ? {garden: {plots: c.building.garden.plots.map(p => ({cellX: p.cellX, cellY: p.cellY}))}} : {})} : null})),
    ...(s.infrastructure ? {infrastructure: s.infrastructure} : {})};
}

/** Called after the read transaction committed. A worker caches only verified geography. */
export function networkJob(state: TravelNetworkState, ground: {data: GeneratedLandscape; navigationEdits: Rc1NetworkEdits} | undefined,
  known: {sources: ReadonlySet<string>}): NetworkJob {
  if (!ground) return {state};
  const sourceId = RC1_CANONICAL_CHECKSUM + ':' + ground.data.seed + ':village-network';
  let artifact: string | undefined;
  if (!known.sources.has(sourceId)) {
    artifact = encoded.get(ground.data);
    if (!artifact) { artifact = JSON.stringify(ground.data); encoded.set(ground.data, artifact); }
  }
  return {state, ground: {sourceId, edits: ground.navigationEdits, ...(artifact === undefined ? {} : {artifact})}};
}

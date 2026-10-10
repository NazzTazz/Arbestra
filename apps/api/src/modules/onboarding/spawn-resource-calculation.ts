import { buildingAccesses, buildSpawnAccessNetwork, createSpawnSurfaceIndex, createSpawnTerrainField,
  createSpawnTerrainInspector, planSpawnCleaning, planSpawnResources, rotateSpawnPoint, SPAWN_ACCESS_REVISION, spawnDelta, spawnSurfacesAt,
  type SpawnInspectionRequest, type SpawnResourcePreflight, type SpawnPoint, type SpawnSurface,
  type SpawnAccessRoute, type SpawnResourceCandidate, type SpawnResourcePlan } from '@arbestra/contracts';
import type { SpawnMap } from '@arbestra/contracts';
import type { SpawnSnapshot } from './spawn-compute-protocol.js';
import { STARTER_VILLAGE } from './starter-village.js';

export function starterTownHallExits(point: SpawnPoint, turns: number): SpawnPoint[][] {
  const hall = STARTER_VILLAGE.buildings.find(b => b.type === 'town-hall')!;
  const accesses = buildingAccesses({ world: { widthCells: 512, heightCells: 256 }, cells: hall.cells.map(c => ({
    cellX: (c.x + 512) % 512, cellY: (c.y + 256) % 256, footprint: { buildingId: 'starter-hall' },
    building: c.role === 'anchor' ? { ...hall, id: 'starter-hall' } : null,
  })) }, 'starter-hall');
  // The frozen hall spans (0,0)/(0,1), with its real +X entrance.
  // Reuse recipe-derived door/outside, then rotate the whole kit consistently.
  return accesses.map(access => {
    const outside = { x: spawnDelta(access.outside.cellX, 0, 512), y: spawnDelta(access.outside.cellY, 0, 256) };
    const bend = access.normal.x ? { x: 0, y: outside.y } : { x: outside.x, y: 0 };
    return [{ x: 0, y: 0 }, bend, outside].map(p => {
      const rotated = rotateSpawnPoint(p, turns); return { x: (rotated.x + point.x + 512) % 512, y: (rotated.y + point.y + 256) % 256 };
    });
  });
}
export function computeSpawnResources(map: SpawnMap, input: SpawnInspectionRequest, spatial: SpawnSnapshot['spatial'], immutable: ReturnType<typeof createSpawnTerrainField>): SpawnResourcePreflight {
    const protectedSurfaces = spatial.protectedSurfaces;
    const terrain = createSpawnTerrainInspector(map.landscape, immutable)(input.point, map.surfaces, input.quarterTurns, map.villages, false, protectedSurfaces, map.territories);
    const base = { terrain, readiness: 'terrain-only' as const, accessRevision: SPAWN_ACCESS_REVISION,
      naturalProjection: 'pending' as const, woodAssumption: 'required-until-projected' as const };
    if (!terrain.terrainCompatible) return { ...base, planningStatus: 'terrain-blocked', visited: 0, plannedStone: 0, plannedWood: 0 };
    const referenceSurfaces = spawnSurfacesAt(map.surfaces, input.point, input.quarterTurns);
    const buildings = spawnSurfacesAt(STARTER_VILLAGE.buildings.flatMap(b => b.cells.map(c => ({ ...c, halfWidth: .5, halfHeight: .5 }))), input.point, input.quarterTurns);
    const equipment = spawnSurfacesAt(STARTER_VILLAGE.infrastructure.equipment.map(e => ({ x: e.x / 8, y: e.y / 8, halfWidth: .125, halfHeight: .125 })), input.point, input.quarterTurns);
    const blocked = createSpawnSurfaceIndex([...spatial.walkBlockedSurfaces, ...buildings, ...equipment], 512, 256);
    const underPose = createSpawnSurfaceIndex(referenceSurfaces, 512, 256);
    const exclusions = createSpawnSurfaceIndex([...protectedSurfaces, ...referenceSurfaces], 512, 256);
    const candidate = (route: SpawnAccessRoute): SpawnResourceCandidate[] => {
      const surface: SpawnSurface = { ...route.point, halfWidth: .5, halfHeight: .5 };
      if (exclusions(surface) || immutable.surfaceReason(surface, null, .125)) return [];
      // Supplements cannot overwrite approved natural trees outside posed surfaces.
      if (immutable.intersectsTree(surface)) return [];
      // A route to the future aggregate's centre is not an exploitation access.
      // Stop outside its edge; the cardinal last leg provides a valid approach.
      const last = route.path.at(-2); if (!last) return [];
      const dx = spawnDelta(route.point.x, last.x, 512), dy = spawnDelta(route.point.y, last.y, 256);
      if (Math.abs(dx) + Math.abs(dy) < .5625) return [];
      const outside = { x: route.point.x - Math.sign(dx) * .5625, y: route.point.y - Math.sign(dy) * .5625 };
      return [{ surface, access: { path: [...route.path.slice(0, -1), outside] } }];
    };
    // Until RC1 natural aggregates are projected, require the worst-case wood
    // supplement. Do not issue a poverty warning from decorative visibility.
    const candidates: SpawnResourceCandidate[] = [];
    let processed = 0, plan: SpawnResourcePlan | undefined;
    const pack = (routes: readonly SpawnAccessRoute[]) => {
      for (; processed < routes.length; processed++) candidates.push(...candidate(routes[processed]!));
      plan = planSpawnResources({ width: 512, height: 256, townHall: input.point, referenceSurfaces,
        posedSurfaces: referenceSurfaces, protectedSurfaces, naturalResources: [], candidates,
        candidatesComplete: false, maxVisited: 10_000 });
      return plan.status === 'planned';
    };
    const walkSamples = new Map<string, { elevation: number; dry: boolean; blocked: boolean }>();
    const network = buildSpawnAccessNetwork({ width: 512, height: 256, sample: (x, y) => {
      const key = `${x}:${y}`, cached = walkSamples.get(key); if (cached) return cached;
      const p = { x, y, halfWidth: 0, halfHeight: 0 }, sample = immutable.sample(x, y);
      const result = { elevation: underPose(p) ? terrain.referenceHeight : sample.elevation,
        dry: sample.elevation > Math.max(0, sample.surface) + 1e-6, blocked: blocked(p) || immutable.intersectsRock(p) };
      walkSamples.set(key, result); return result;
    } }, starterTownHallExits(input.point, input.quarterTurns), 40.5625, 4000,
      routes => routes.length % 512 === 0 && routes.at(-1)!.length > 20 && pack(routes));
    if (plan?.status !== 'planned') pack(network.routes);
    const result = plan!;
    const cleaning=planSpawnCleaning(map.landscape,input.point,map.surfaces,input.quarterTurns,immutable);
    return { ...base, planningStatus: result.status === 'planned' ? 'planned' : 'incomplete', visited: network.visited,
      cleaning:{referenceHeight:cleaning.referenceHeight,treesToRemove:cleaning.removedTreeIndices.length,woodCredit:0},
      plannedStone: result.supplements.filter(s => s.kind !== 'wood').reduce((n, s) => n + s.amount, 0),
      plannedWood: result.supplements.filter(s => s.kind === 'wood').reduce((n, s) => n + s.amount, 0) };
}

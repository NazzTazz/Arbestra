import { sql, type Kysely, type Transaction } from 'kysely';
import {
  preserveTerrainCentres,
  convertTerraces,
  footprintVertices,
  vertexCells,
  vertexKey,
  terrainHeightPrecision,
  editedRc1Field,
  infrastructurePlanSurface,
  spawnSurfacesOverlap,
  buildingAccesses,
  canWalkSpawnSegment,
  type BuildingAccessState,
  type TravelCell,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { readRc1Ground } from './rc1-ground.js';
import { readRc1Source } from './rc1-source.js';
import { spawnSpatialState } from '../onboarding/spawn-state.js';
import { rc1NetworkGround } from '../navigation/rc1-network-ground.js';

/** Conservative command boundary shared by initial installation and subsequent starter poses. */
export async function flattenVertexTerrain(
  tx: Transaction<Database>,
  worldId: string,
  cells: readonly { cellX: number; cellY: number }[],
  height: number,
) {
  const world = await tx
    .selectFrom('worlds')
    .select(['terrainModel', 'widthCells', 'heightCells'])
    .where('id', '=', worldId)
    .executeTakeFirstOrThrow();
  if (world.terrainModel !== 'vertices') return false;
  const ground = await readRc1Ground(tx, worldId),
    vertices = footprintVertices(cells, world).map((p) => ({ ...p, height: terrainHeightPrecision(height) }));
  const changed = vertices.filter(
    (p) => Math.abs(ground.field.geometry!.height(p.vertexX, p.vertexY) - p.height) > 1e-6,
  );
  const affected = vertexCells(changed, world),
    keys = new Set(affected.map((c) => `${c.cellX}:${c.cellY}`));
  const protection = await spawnSpatialState(tx, worldId);
  if (
    affected.some((c) =>
      protection.protectedSurfaces.some((p) =>
        spawnSurfacesOverlap(
          { x: c.cellX, y: c.cellY, halfWidth: 0.5, halfHeight: 0.5 },
          p,
          world.widthCells,
          world.heightCells,
        ),
      ),
    )
  )
    throw new HttpError(409, 'SPAWN_BLOCKED', 'Le raccord toucherait une emprise ou un passage protégé.');
  const occupied = await tx
    .selectFrom('worldCellOccupancies')
    .select(['cellX', 'cellY'])
    .where('worldId', '=', worldId)
    .execute();
  if (occupied.some((c) => keys.has(`${c.cellX}:${c.cellY}`)))
    throw new HttpError(409, 'SPAWN_BLOCKED', 'Le raccord du terrain toucherait une emprise occupée.');
  const plans = await tx.selectFrom('villageInfrastructure').select('plan').where('worldId', '=', worldId).execute();
  for (const { plan } of plans)
    for (const p of infrastructurePlanSurface(plan, world).values()) {
      const x = (Math.floor(p.x / 16 + 0.5) + world.widthCells) % world.widthCells,
        y = (Math.floor(p.y / 16 + 0.5) + world.heightCells) % world.heightCells;
      if (keys.has(`${x}:${y}`))
        throw new HttpError(409, 'SPAWN_BLOCKED', 'Le raccord du terrain toucherait un accès aménagé.');
    }
  const source = await readRc1Source(tx, worldId),
    changedKeys = new Set(vertices.map(vertexKey));
  const future = editedRc1Field(
    source.data,
    source.field,
    [],
    [],
    [...(ground.navigationEdits.vertices ?? []).filter((p) => !changedKeys.has(vertexKey(p))), ...vertices],
  );
  for (const c of affected) {
    const surface = { x: c.cellX, y: c.cellY, halfWidth: 0.5, halfHeight: 0.5 };
    if (future.surfaceReason(surface, null, 0.125))
      throw new HttpError(409, 'SPAWN_BLOCKED', 'Le raccord rencontre de l’eau ou un rocher.');
  }
  if (vertices.length)
    await tx
      .insertInto('worldTerrainVertices')
      .values(vertices.map((v) => ({ ...v, worldId })))
      .onConflict((c) =>
        c.columns(['worldId', 'vertexX', 'vertexY']).doUpdateSet((e) => ({ height: e.ref('excluded.height') })),
      )
      .execute();
  return true;
}

/** Preserve structural support heights; gardens and roads follow the new
 * surface, with dryness and walkability checked before any activation. */
export async function auditTerrainVertices(db: Kysely<Database>, worldId: string) {
  const source = await readRc1Source(db, worldId),
    ground = await readRc1Ground(db, worldId);
  const stats = {
    buildings: 0,
    accesses: 0,
    roadSamples: 0,
    extractions: 0,
    maxBuildingBaseChange: 0,
    maxRoadHeightChange: 0,
  };
  if (source.world.terrainModel === 'vertices')
    return {
      vertices: ground.navigationEdits.vertices ?? [],
      conflicts: [],
      issues: [],
      model: source.world.terrainModel,
      stats,
    };
  const issues: string[] = [];
  const buildings = await db
    .selectFrom('worldCellOccupancies as o')
    .innerJoin('buildings as b', (j) => j.onRef('b.worldId', '=', 'o.worldId').onRef('b.id', '=', 'o.buildingId'))
    .select(['o.cellX', 'o.cellY', 'o.role', 'b.id', 'b.buildingType', 'b.visualLayout', 'b.quarterTurns'])
    .where('o.worldId', '=', worldId)
    .execute();
  const bases = new Map<string, number>();
  for (const c of buildings)
    bases.set(c.id, Math.max(bases.get(c.id) ?? -Infinity, ground.field.sample(c.cellX, c.cellY).elevation));
  const isPlatform = (type: string) => type === 'university' || type === 'stonemason';
  const platforms = buildings
    .filter((c) => isPlatform(c.buildingType))
    .map((c) => ({ ...c, height: bases.get(c.id)! }));
  const terraces = convertTerraces([...ground.terraces, ...platforms], source.world);
  const structural = buildings.filter((c) => c.buildingType !== 'garden');
  const result = preserveTerrainCentres(
    structural.map((c) => ({
      ...c,
      height: isPlatform(c.buildingType) ? bases.get(c.id)! : ground.field.sample(c.cellX, c.cellY).elevation,
    })),
    source.world,
    terraces.vertices,
    (x, y) => source.field.sample(x - 0.5, y - 0.5).elevation,
  );
  const conflicts = [...new Set([...terraces.conflicts, ...result.conflicts])];
  if (conflicts.length) issues.push(`${conflicts.length} sommets contraints à plusieurs hauteurs`);
  const future = editedRc1Field(source.data, source.field, [], [], result.vertices);
  const futureBases = new Map<string, number>();
  for (const c of buildings) {
    futureBases.set(c.id, Math.max(futureBases.get(c.id) ?? -Infinity, future.sample(c.cellX, c.cellY).elevation));
    if (
      footprintVertices([c], source.world).some((p) => {
        const s = future.sample(p.vertexX - 0.5, p.vertexY - 0.5);
        return s.elevation <= Math.max(0, s.surface) + 1e-6;
      })
    )
      issues.push(`Emprise inondée en ${c.cellX},${c.cellY}`);
  }
  for (const id of new Set(structural.map((c) => c.id))) {
    stats.buildings++;
    const difference = Math.abs(bases.get(id)! - futureBases.get(id)!);
    stats.maxBuildingBaseChange = Math.max(stats.maxBuildingBaseChange, difference);
    if (difference > 1e-6) issues.push(`Hauteur d’appui modifiée : ${id}`);
  }
  const state: BuildingAccessState = {
    world: source.world,
    cells: buildings.map((b) => ({
      ...b,
      footprint: { buildingId: b.id },
      building:
        b.role === 'anchor'
          ? { id: b.id, type: b.buildingType, visualLayout: b.visualLayout, quarterTurns: b.quarterTurns }
          : null,
    })),
  };
  const futureNavigation = rc1NetworkGround(
    source.data,
    source.field,
    { ...ground.navigationEdits, vertices: result.vertices },
    future,
  );
  const losesPassage = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    canWalkSpawnSegment(ground.navigation, a, b) && !canWalkSpawnSegment(futureNavigation, a, b);
  for (const id of new Set(buildings.map((b) => b.id)))
    for (const access of buildingAccesses(state, id)) {
      stats.accesses++;
      const a = { x: access.position.cellX, y: access.position.cellY },
        b = { x: access.outside.cellX, y: access.outside.cellY };
      if (losesPassage(a, b)) issues.push(`Accès impraticable : ${id}/${access.id}`);
    }
  const plans = await db.selectFrom('villageInfrastructure').select('plan').where('worldId', '=', worldId).execute();
  for (const { plan } of plans) {
    const surface = infrastructurePlanSurface(plan, source.world),
      points = new Map([...surface.values()].map((p) => [`${p.x}:${p.y}`, p]));
    for (const p of points.values()) {
      stats.roadSamples++;
      const a = { x: p.x / 16, y: p.y / 16 },
        after = future.sample(a.x, a.y);
      stats.maxRoadHeightChange = Math.max(
        stats.maxRoadHeightChange,
        Math.abs(ground.field.sample(a.x, a.y).elevation - after.elevation),
      );
      if (after.elevation <= Math.max(0, after.surface) + 1e-6) {
        issues.push('Accès aménagé inondé');
        break;
      }
      // The shared navigation graph admits cardinal edges only.
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ]) {
        const x = (p.x + dx! + source.world.widthCells * 16) % (source.world.widthCells * 16),
          y = (p.y + dy! + source.world.heightCells * 16) % (source.world.heightCells * 16);
        if (points.has(`${x}:${y}`) && losesPassage(a, { x: x / 16, y: y / 16 }))
          issues.push('Accès aménagé devenu impraticable');
      }
    }
  }
  // Extraction clocks depend on horizontal distance. Keep their contracts and
  // deadlines unchanged, provided the complete outward/return corridor survives.
  const extractions = await db
    .selectFrom('depositExtractions')
    .select(['id', 'pathCells'])
    .where('worldId', '=', worldId)
    .where('completedAt', 'is', null)
    .execute();
  const lostPath = (path: TravelCell[]) =>
    path.some(
      (p, i) => i > 0 && losesPassage({ x: path[i - 1]!.cellX, y: path[i - 1]!.cellY }, { x: p.cellX, y: p.cellY }),
    );
  for (const extraction of extractions) {
    stats.extractions++;
    if (!extraction.pathCells?.length || lostPath(extraction.pathCells))
      issues.push(`Trajet d’extraction à préserver : ${extraction.id}`);
  }
  // Other persisted contracts must finish under the model which quoted them.
  for (const table of ['levelingJobs', 'tradeDeliveries', 'gardenHarvests', 'scienceActivities'] as const) {
    const active = await db
      .selectFrom(table)
      .select('id')
      .where('worldId', '=', worldId)
      .where('completedAt', 'is', null)
      .limit(1)
      .executeTakeFirst();
    if (active) issues.push(`Activité en cours : ${table}`);
  }
  if (
    await db
      .selectFrom('exploitationOrders')
      .select('id')
      .where('worldId', '=', worldId)
      .where('gardenStatus', 'in', ['pending', 'active'])
      .limit(1)
      .executeTakeFirst()
  )
    issues.push('Tournée de jardins engagée');
  return { ...result, conflicts, issues: [...new Set(issues)], model: source.world.terrainModel, stats };
}

/** Operator-only activation, all village locks precede the shared spatial lock. */
export async function activateTerrainVertices(db: Kysely<Database>, worldId: string) {
  return db.transaction().execute((tx) => activateTerrainVerticesInTransaction(tx, worldId));
}

/** Allows the operator to verify business fingerprints before committing. */
export async function activateTerrainVerticesInTransaction(tx: Transaction<Database>, worldId: string) {
  await tx.selectFrom('villages').select('id').where('worldId', '=', worldId).orderBy('id').forUpdate().execute();
  await sql`select pg_advisory_xact_lock(hashtextextended(${'infrastructure:' + worldId},0))`.execute(tx);
  await tx.selectFrom('worlds').select('id').where('id', '=', worldId).forNoKeyUpdate().executeTakeFirstOrThrow();
  const audit = await auditTerrainVertices(tx, worldId);
  if (audit.model === 'vertices') return audit;
  if (audit.issues.length) throw new HttpError(409, 'TERRAIN_CONVERSION_BLOCKED', audit.issues.join('; '));
  if (audit.vertices.length)
    await tx
      .insertInto('worldTerrainVertices')
      .values(audit.vertices.map((v) => ({ ...v, worldId })))
      .execute();
  await tx.updateTable('worlds').set({ terrainModel: 'vertices' }).where('id', '=', worldId).execute();
  return audit;
}

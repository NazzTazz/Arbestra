import { sql, type Kysely } from 'kysely';
import type { TerrainResponse, TerrainUpdatesResponse } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { normalizeCell } from './coordinates.js';
import { safeAmount } from '../deposits/stone-extractions.js';

export function parseTerrainChunks(raw: string): Array<{ chunkX: number; chunkY: number }> {
  const entries = raw.split(';');
  if (entries.length < 1 || entries.length > 16) throw new HttpError(400, 'INVALID_CHUNKS', 'Entre 1 et 16 chunks attendus.');
  return entries.map((entry) => {
    if (!/^-?\d+,-?\d+$/.test(entry)) throw new HttpError(400, 'INVALID_CHUNKS', 'Coordonnées de chunk invalides.');
    const [chunkX, chunkY] = entry.split(',').map(Number);
    if (!Number.isSafeInteger(chunkX) || !Number.isSafeInteger(chunkY)) throw new HttpError(400, 'INVALID_CHUNKS', 'Coordonnées de chunk invalides.');
    return { chunkX: chunkX!, chunkY: chunkY! };
  });
}

export async function getTerrain(db: Kysely<Database>, accountId: string, slug: string, raw: string): Promise<TerrainResponse> {
  return readTerrain(db, accountId, slug, raw, true);
}

export async function getTerrainUpdates(db: Kysely<Database>, accountId: string, slug: string, raw: string): Promise<TerrainUpdatesResponse> {
  const data = await readTerrain(db, accountId, slug, raw, false);
  return { world: data.world, chunks: data.chunks.map(c => ({ chunkX: c.chunkX, chunkY: c.chunkY,
    originCellX: c.originCellX, originCellY: c.originCellY, features: c.features, occupiedCells: c.occupiedCells })) };
}

async function readTerrain(db: Kysely<Database>, accountId: string, slug: string, raw: string, includeGround: boolean): Promise<TerrainResponse> {
  const requested = parseTerrainChunks(raw);
  return db.transaction().setIsolationLevel('repeatable read').execute(async (tx) => {
    await sql`set transaction read only`.execute(tx);
    const world = await tx.selectFrom('worlds').innerJoin('villages', 'villages.worldId', 'worlds.id')
      .innerJoin('worldMemberships', (join) => join.onRef('worldMemberships.worldId', '=', 'worlds.id').on('worldMemberships.accountId', '=', accountId))
      .select(['worlds.id', 'worlds.generationVersion', 'worlds.generationStatus', 'worlds.widthCells', 'worlds.heightCells', 'worlds.chunkSize'])
      .where('worlds.slug', '=', slug).where('villages.ownerAccountId', '=', accountId).executeTakeFirst();
    if (!world) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable dans ce monde.');
    const { id: worldId, chunkSize: size, widthCells: width, heightCells: height } = world;
    if (world.generationStatus !== 'ready' || width % size || height % size) throw new HttpError(409, 'WORLD_NOT_READY', 'Terrain indisponible.');
    const wanted = [...new Map(requested.map((c) => {
      const chunkX = normalizeCell(c.chunkX, width / size), chunkY = normalizeCell(c.chunkY, height / size);
      return [`${chunkX}:${chunkY}`, { chunkX, chunkY }] as const;
    })).values()];
    const halo = new Map<string, { chunkX: number; chunkY: number }>();
    if (includeGround) for (const c of wanted) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const chunkX = normalizeCell(c.chunkX + dx, width / size), chunkY = normalizeCell(c.chunkY + dy, height / size);
      halo.set(`${chunkX}:${chunkY}`, { chunkX, chunkY });
    }
    const rows = includeGround ? await tx.selectFrom('worldChunks').selectAll().where('worldId', '=', worldId)
      .where((eb) => eb.or([...halo.values()].map((c) => eb.and([eb('chunkX', '=', c.chunkX), eb('chunkY', '=', c.chunkY)])))).execute() : [];
    if (rows.length !== halo.size || rows.some((r) => r.generationVersion !== world.generationVersion || r.terrainCodes.length !== size * size || r.elevations.length !== size * size))
      throw new HttpError(409, 'WORLD_NOT_READY', 'Terrain incomplet.');
    const byChunk = new Map(rows.map((r) => [`${r.chunkX}:${r.chunkY}`, r]));
    const occupancies = await tx.selectFrom('worldCellOccupancies').select(['cellX', 'cellY', 'featureId']).where('worldId', '=', worldId)
      .where((eb) => eb.or(wanted.map((c) => eb.and([
        eb('cellX', '>=', c.chunkX * size), eb('cellX', '<', (c.chunkX + 1) * size),
        eb('cellY', '>=', c.chunkY * size), eb('cellY', '<', (c.chunkY + 1) * size),
      ])))).execute();
    // The deposit retains its canonical coordinates after its occupancy disappears.
    const x = sql<number>`feature_locations.cell_x`;
    const y = sql<number>`feature_locations.cell_y`;
    const features = await tx.with('featureLocations', eb => eb.selectFrom('worldCellOccupancies')
      .select(['worldId', 'featureId', 'cellX', 'cellY']).where('featureId', 'is not', null)
      .union(eb.selectFrom('resourceDeposits').select(['worldId', 'featureId', 'cellX', 'cellY'])))
      .selectFrom('featureLocations')
      .innerJoin('worldFeatures', join => join.onRef('worldFeatures.worldId', '=', 'featureLocations.worldId')
        .onRef('worldFeatures.id', '=', 'featureLocations.featureId'))
      .leftJoin('resourceDeposits', (join) => join.onRef('resourceDeposits.worldId', '=', 'worldFeatures.worldId').onRef('resourceDeposits.featureId', '=', 'worldFeatures.id'))
      .select(['worldFeatures.id', 'worldFeatures.featureTypeCode', 'worldFeatures.variantSeed', x.as('cellX'), y.as('cellY'),
        'resourceDeposits.initialAmount', 'resourceDeposits.remainingAmount', 'resourceDeposits.reservedAmount', 'resourceDeposits.revision', 'resourceDeposits.updatedAt', 'resourceDeposits.resourceCode', 'resourceDeposits.cleared', 'resourceDeposits.blocksCell'])
      .where('worldFeatures.worldId', '=', worldId).where((eb) => eb.or(wanted.map((c) => eb.and([
        eb(x, '>=', c.chunkX * size), eb(x, '<', (c.chunkX + 1) * size), eb(y, '>=', c.chunkY * size), eb(y, '<', (c.chunkY + 1) * size),
      ])))).execute();
    return { world: { id: worldId, generationVersion: world.generationVersion, widthCells: width, heightCells: height, chunkSize: size }, chunks: wanted.map((c) => {
      const originCellX = c.chunkX * size, originCellY = c.chunkY * size;
      const terrainCodes: number[] = [], elevations: number[] = [];
      if (includeGround) for (let dy = -1; dy <= size; dy++) for (let dx = -1; dx <= size; dx++) {
        const cx = normalizeCell(originCellX + dx, width), cy = normalizeCell(originCellY + dy, height);
        const row = byChunk.get(`${Math.floor(cx / size)}:${Math.floor(cy / size)}`)!;
        const index = (cy % size) * size + cx % size;
        terrainCodes.push(row.terrainCodes[index]!); elevations.push(row.elevations[index]!);
      }
      const inside = (p: { cellX: number; cellY: number }) => p.cellX >= originCellX && p.cellX < originCellX + size && p.cellY >= originCellY && p.cellY < originCellY + size;
      const woods = features.filter(f => f.resourceCode === 'wood');
      const occupiedCells = occupancies.filter(inside).filter(o => {
        const wood = woods.find(w => w.id === o.featureId);
        return !wood || wood.blocksCell;
      }).map(({ cellX, cellY }) => ({ cellX, cellY }));
      for (const wood of woods.filter(inside)) if (wood.blocksCell
        && !occupiedCells.some(o => o.cellX === wood.cellX && o.cellY === wood.cellY))
        occupiedCells.push({ cellX: wood.cellX, cellY: wood.cellY });
      return { ...c, originCellX, originCellY, terrainCodes, elevations, occupiedCells,
        features: [...new Map(features.filter(inside).map((f) => {
          const remainingAmount = f.remainingAmount === null ? null : safeAmount(f.remainingAmount);
          const reservedAmount = f.reservedAmount === null ? 0 : safeAmount(f.reservedAmount);
          return [f.id, { id: f.id, type: f.featureTypeCode, cellX: f.cellX, cellY: f.cellY, variantSeed: f.variantSeed,
            deposit: remainingAmount === null ? null : { featureId: f.id, resourceCode: f.resourceCode!, blocksCell: f.blocksCell!, cleared: f.cleared ?? false, cellX: f.cellX, cellY: f.cellY,
              initialAmount: safeAmount(f.initialAmount!), remainingAmount, reservedAmount, availableAmount: remainingAmount - reservedAmount,
              state: f.cleared || remainingAmount === 0 ? 'depleted' as const : 'available' as const, revision: safeAmount(f.revision!), updatedAt: f.updatedAt!.toISOString() } }] as const;
        })).values()] };
    }) };
  });
}

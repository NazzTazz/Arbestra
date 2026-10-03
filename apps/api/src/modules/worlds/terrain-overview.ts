import { sql, type Kysely } from 'kysely';
import type { TerrainOverview, TerrainVegetationOverview } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';

const OVERVIEW_VERSION = 1;
const MAX_SAMPLES = 512;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const VEGETATION_AGE_MS = 30_000;
type World = TerrainOverview['world'];

const geography = new Map<string, { value: TerrainOverview; bytes: number }>();
const pendingGeography = new Map<string, Promise<TerrainOverview>>();
let cachedBytes = 0;
const vegetation = new Map<string, { value: TerrainVegetationOverview; expires: number }>();
const pendingVegetation = new Map<string, Promise<TerrainVegetationOverview>>();

function grid(world: World): { gridWidth: number; gridHeight: number } {
  const scale = Math.min(1, MAX_SAMPLES / Math.max(world.widthCells, world.heightCells));
  return { gridWidth: Math.max(1, Math.floor(world.widthCells * scale)), gridHeight: Math.max(1, Math.floor(world.heightCells * scale)) };
}

function bucketSize(index: number, source: number, count: number): number {
  return Math.floor((index + 1) * source / count) - Math.floor(index * source / count);
}

export async function authorizedOverviewWorld(db: Kysely<Database>, accountId: string, slug: string): Promise<World> {
  const row = await db.selectFrom('worlds').innerJoin('villages', 'villages.worldId', 'worlds.id')
    .innerJoin('worldMemberships', (join) => join.onRef('worldMemberships.worldId', '=', 'worlds.id')
      .on('worldMemberships.accountId', '=', accountId))
    .select(['worlds.id', 'worlds.generationVersion', 'worlds.generationStatus',
      'worlds.widthCells', 'worlds.heightCells', 'worlds.chunkSize'])
    .where('worlds.slug', '=', slug).where('villages.ownerAccountId', '=', accountId).executeTakeFirst();
  if (!row) throw new HttpError(404, 'VILLAGE_NOT_FOUND', 'Village introuvable dans ce monde.');
  if (row.generationStatus !== 'ready' || row.widthCells % row.chunkSize || row.heightCells % row.chunkSize)
    throw new HttpError(409, 'WORLD_NOT_READY', 'Terrain indisponible.');
  return { id: row.id, generationVersion: row.generationVersion, widthCells: row.widthCells,
    heightCells: row.heightCells, chunkSize: row.chunkSize };
}

export function overviewEtag(world: World): string {
  return `"terrain-${world.id}-${world.generationVersion}-${OVERVIEW_VERSION}"`;
}

function key(world: World): string { return `${world.id}:${world.generationVersion}:${OVERVIEW_VERSION}`; }

async function computeGeography(db: Kysely<Database>, world: World): Promise<TerrainOverview> {
  const { gridWidth, gridHeight } = grid(world), length = gridWidth * gridHeight;
  return db.transaction().setIsolationLevel('repeatable read').execute(async (tx) => {
    await sql`set transaction read only`.execute(tx);
    await sql`set local statement_timeout = '15s'`.execute(tx);
    const current = await tx.selectFrom('worlds').select(['generationVersion', 'generationStatus'])
      .where('id', '=', world.id).executeTakeFirstOrThrow();
    if (current.generationStatus !== 'ready' || current.generationVersion !== world.generationVersion)
      throw new HttpError(409, 'WORLD_NOT_READY', 'Terrain modifié pendant la lecture.');
    const sum = new Float64Array(length), minimum = new Float64Array(length), maximum = new Float64Array(length);
    const counts = new Uint32Array(length), water = new Uint32Array(length), rock = new Uint32Array(length);
    minimum.fill(Infinity); maximum.fill(-Infinity);
    let seen = 0;
    const chunkRows = world.heightCells / world.chunkSize;
    for (let chunkY = 0; chunkY < chunkRows; chunkY++) {
      const rows = await tx.selectFrom('worldChunks')
        .select(['chunkX', 'generationVersion', 'terrainCodes', 'elevations'])
        .where('worldId', '=', world.id).where('chunkY', '=', chunkY).orderBy('chunkX').execute();
      if (rows.length !== world.widthCells / world.chunkSize) throw new HttpError(409, 'WORLD_NOT_READY', 'Terrain incomplet.');
      for (let chunkX = 0; chunkX < rows.length; chunkX++) {
        const row = rows[chunkX]!;
        if (row.chunkX !== chunkX || row.generationVersion !== world.generationVersion
          || row.terrainCodes.length !== world.chunkSize ** 2 || row.elevations.length !== world.chunkSize ** 2)
          throw new HttpError(409, 'WORLD_NOT_READY', 'Terrain incomplet.');
        seen++;
        for (let localY = 0; localY < world.chunkSize; localY++) {
          const cellY = chunkY * world.chunkSize + localY;
          const bucketY = Math.floor(cellY * gridHeight / world.heightCells);
          for (let localX = 0; localX < world.chunkSize; localX++) {
            const cellX = chunkX * world.chunkSize + localX;
            const index = bucketY * gridWidth + Math.floor(cellX * gridWidth / world.widthCells);
            const source = localY * world.chunkSize + localX;
            const elevation = row.elevations[source]!;
            if (!Number.isFinite(elevation)) throw new HttpError(409, 'WORLD_NOT_READY', 'Élévation invalide.');
            sum[index]! += elevation; counts[index]!++;
            minimum[index] = Math.min(minimum[index]!, elevation);
            maximum[index] = Math.max(maximum[index]!, elevation);
            if (row.terrainCodes[source] === 2) water[index]!++;
            else if (row.terrainCodes[source] === 3) rock[index]!++;
            else if (row.terrainCodes[source] !== 1) throw new HttpError(409, 'WORLD_NOT_READY', 'Type de terrain invalide.');
          }
        }
      }
    }
    if (seen !== world.widthCells / world.chunkSize * chunkRows || counts.some((count) => count === 0))
      throw new HttpError(409, 'WORLD_NOT_READY', 'Terrain incomplet.');
    const quantizedWater = Array.from(water, (count, index) => Math.round(count * 255 / counts[index]!));
    const quantizedRock = Array.from(rock, (count, index) => Math.min(255 - quantizedWater[index]!, Math.round(count * 255 / counts[index]!)));
    return { world, overviewVersion: OVERVIEW_VERSION, gridWidth, gridHeight,
      meanElevations: Array.from(sum, (value, index) => value / counts[index]!),
      minElevations: Array.from(minimum), maxElevations: Array.from(maximum),
      waterCoverage: quantizedWater, rockCoverage: quantizedRock };
  });
}

export async function getTerrainOverview(db: Kysely<Database>, world: World): Promise<TerrainOverview> {
  const cacheKey = key(world), cached = geography.get(cacheKey);
  if (cached) { geography.delete(cacheKey); geography.set(cacheKey, cached); return cached.value; }
  const active = pendingGeography.get(cacheKey);
  if (active) return active;
  if (pendingGeography.size >= 1) throw new HttpError(503, 'OVERVIEW_BUSY', 'Aperçu occupé, réessayez.');
  const build = computeGeography(db, world);
  pendingGeography.set(cacheKey, build);
  try {
    const value = await build, bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > 8 * 1024 * 1024) throw new HttpError(503, 'OVERVIEW_TOO_LARGE', 'Aperçu trop volumineux.');
    while (cachedBytes + bytes > MAX_CACHE_BYTES && geography.size) {
      const oldest = geography.keys().next().value!;
      cachedBytes -= geography.get(oldest)!.bytes; geography.delete(oldest);
    }
    geography.set(cacheKey, { value, bytes }); cachedBytes += bytes;
    return value;
  } finally { pendingGeography.delete(cacheKey); }
}

async function computeVegetation(db: Kysely<Database>, world: World): Promise<TerrainVegetationOverview> {
  const { gridWidth, gridHeight } = grid(world);
  return db.transaction().setIsolationLevel('repeatable read').execute(async (tx) => {
    await sql`set transaction read only`.execute(tx);
    await sql`set local statement_timeout = '15s'`.execute(tx);
    const current = await tx.selectFrom('worlds').select(['generationVersion', 'generationStatus'])
      .where('id', '=', world.id).executeTakeFirstOrThrow();
    if (current.generationStatus !== 'ready' || current.generationVersion !== world.generationVersion)
      throw new HttpError(409, 'WORLD_NOT_READY', 'Terrain modifié pendant la lecture.');
    const sampledAt = new Date().toISOString();
    const rows = await sql<{ bucketX: number; bucketY: number; occupied: string }>`
      select floor(w.cell_x * ${gridWidth}::numeric / ${world.widthCells})::int as bucket_x,
        floor(w.cell_y * ${gridHeight}::numeric / ${world.heightCells})::int as bucket_y,
        sum(w.remaining_amount::numeric/w.initial_amount)::text as occupied
      from resource_deposits w
      where w.world_id = ${world.id} and w.resource_code='wood' and not w.cleared
      group by 1, 2`.execute(tx);
    const woodlandCoverage = Array<number>(gridWidth * gridHeight).fill(0);
    for (const row of rows.rows) {
      const area = bucketSize(row.bucketX, world.widthCells, gridWidth) * bucketSize(row.bucketY, world.heightCells, gridHeight);
      if (area > 0) woodlandCoverage[row.bucketY * gridWidth + row.bucketX] = Math.min(255, Math.round(Number(row.occupied) * 255 / area));
    }
    return { world, overviewVersion: OVERVIEW_VERSION, gridWidth, gridHeight, woodlandCoverage,
      sampledAt, ageMs: 0, maxAgeMs: VEGETATION_AGE_MS };
  });
}

export async function getTerrainVegetationOverview(db: Kysely<Database>, world: World): Promise<TerrainVegetationOverview> {
  const cacheKey = key(world), now = Date.now(), cached = vegetation.get(cacheKey);
  if (cached && cached.expires > now) return { ...cached.value, ageMs: Math.max(0, now - Date.parse(cached.value.sampledAt)) };
  const active = pendingVegetation.get(cacheKey);
  if (active) return active;
  if (pendingVegetation.size >= 1) throw new HttpError(503, 'OVERVIEW_BUSY', 'Aperçu occupé, réessayez.');
  const build = computeVegetation(db, world);
  pendingVegetation.set(cacheKey, build);
  try {
    const value = await build;
    if (Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024)
      throw new HttpError(503, 'OVERVIEW_TOO_LARGE', 'Aperçu trop volumineux.');
    vegetation.set(cacheKey, { value, expires: Date.parse(value.sampledAt) + VEGETATION_AGE_MS });
    if (vegetation.size > 4) vegetation.delete(vegetation.keys().next().value!);
    return { ...value, ageMs: Math.max(0, Date.now() - Date.parse(value.sampledAt)) };
  } finally { pendingVegetation.delete(cacheKey); }
}

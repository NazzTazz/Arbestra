import type { Kysely } from 'kysely';
import type { TerrainOverview, TerrainVegetationOverview, TravelCell } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { normalizeCell, wrappedDelta } from '../worlds/coordinates.js';

export async function knownGeography(db: Kysely<Database>, worldId: string, accountId: string, width: number, height: number) {
  const [places, villages] = await Promise.all([
    db.selectFrom('sciencePlaces').select(['cellX', 'cellY', 'surveyed', 'terrainCode', 'elevation']).where('worldId', '=', worldId).where('accountId', '=', accountId).execute(),
    db.selectFrom('villages').select(['id', 'anchorCellX', 'anchorCellY']).where('worldId', '=', worldId).where('ownerAccountId', '=', accountId).execute(),
  ]);
  const cells = new Set(places.map(p => `${p.cellX}:${p.cellY}`));
  // Read-only fallback allows the streamer to race the first village snapshot.
  const initial = (p: TravelCell) => villages.some(v => {
    const dx = wrappedDelta(p.cellX, v.anchorCellX, width), dy = wrappedDelta(p.cellY, v.anchorCellY, height);
    return dx >= -32 && dx < 32 && dy >= -32 && dy < 32;
  });
  return { places, villages, cells, known: (p: TravelCell) => cells.has(`${p.cellX}:${p.cellY}`) || initial(p) };
}

/** Clone the shared cached geography. Never cache a player's mask under the world key. */
export async function knownOverview(db: Kysely<Database>, data: TerrainOverview, accountId: string): Promise<TerrainOverview> {
  const { places, villages } = await knownGeography(db, data.world.id, accountId, data.world.widthCells, data.world.heightCells);
  const known = new Set(places.map(p => `${p.cellX}:${p.cellY}`));
  for (const v of villages) for (let y = -32; y < 32; y++) for (let x = -32; x < 32; x++)
    known.add(`${normalizeCell(v.anchorCellX + x, data.world.widthCells)}:${normalizeCell(v.anchorCellY + y, data.world.heightCells)}`);
  const counts = new Uint32Array(data.gridWidth * data.gridHeight);
  for (const cell of known) {
    const [x, y] = cell.split(':').map(Number);
    counts[Math.floor(y! * data.gridHeight / data.world.heightCells) * data.gridWidth + Math.floor(x! * data.gridWidth / data.world.widthCells)]!++;
  }
  const knowledgeCoverage = Array.from(counts, (count, i) => {
    const x = i % data.gridWidth, y = Math.floor(i / data.gridWidth);
    const area = (Math.floor((x + 1) * data.world.widthCells / data.gridWidth) - Math.floor(x * data.world.widthCells / data.gridWidth))
      * (Math.floor((y + 1) * data.world.heightCells / data.gridHeight) - Math.floor(y * data.world.heightCells / data.gridHeight));
    // A partly known aggregate must not disclose the rest of that bucket.
    return count >= area ? 255 : 0;
  });
  const masked = (values: number[]) => values.map((n, i) => knowledgeCoverage[i] ? n : 0);
  return { ...data, knowledgeCoverage, meanElevations: masked(data.meanElevations), minElevations: masked(data.minElevations),
    maxElevations: masked(data.maxElevations), waterCoverage: masked(data.waterCoverage), rockCoverage: masked(data.rockCoverage) };
}

export async function knownVegetation(db: Kysely<Database>, data: TerrainVegetationOverview, accountId: string) {
  const length = data.gridWidth * data.gridHeight, empty = new Array<number>(length).fill(0);
  const mask = await knownOverview(db, { ...data, meanElevations: empty, minElevations: empty, maxElevations: empty, waterCoverage: empty, rockCoverage: empty }, accountId);
  return { ...data, woodlandCoverage: data.woodlandCoverage.map((n, i) => mask.knowledgeCoverage![i] ? n : 0) };
}

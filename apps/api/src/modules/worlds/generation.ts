import { randomUUID } from 'node:crypto';

import { sql, type Transaction } from 'kysely';

import type { Database } from '../../database/schema.js';
import {
  normalizeCell,
  toroidalChebyshev,
  worldCellKey,
} from './coordinates.js';
import { planClearingFeatures } from './clearing-features.js';
import { STONE_DEPOSIT_INITIAL_AMOUNT, WORLD_GENERATION_V2 } from './generation-config.js';

export const TERRAIN = {
  grassland: 1,
  water: 2,
  rockyGround: 3,
} as const;

const {
  clearing: CLEARING,
  terrain: TERRAIN_CONFIG,
  features: FEATURE_CONFIG,
} = WORLD_GENERATION_V2;

function stoneDepositAmount(variantSeed: number): number {
  const span = STONE_DEPOSIT_INITIAL_AMOUNT.max - STONE_DEPOSIT_INITIAL_AMOUNT.min + 1;
  return STONE_DEPOSIT_INITIAL_AMOUNT.min + (Math.abs(variantSeed) % span);
}

interface ClearingPlan {
  centerCellX: number;
  centerCellY: number;
  status: 'protected' | 'claimed';
  claimedVillageId: string | null;
}

// Small, explicit integer hash: stable across Node/browser versions and adequate
// for deterministic world decoration. It is not used for security.
function hash(seed: number, x: number, y: number, salt = 0): number {
  let value =
    (seed ^ Math.imul(x, 0x45d9f3b) ^ Math.imul(y, 0x27d4eb2d) ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

function fraction(seed: number, x: number, y: number, salt = 0): number {
  return hash(seed, x, y, salt) / 0x1_0000_0000;
}

function smooth(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicNoise(
  seed: number,
  cellX: number,
  cellY: number,
  width: number,
  height: number,
  scale: number,
  salt: number,
): number {
  const gridWidth = width / scale;
  const gridHeight = height / scale;
  const gridX = Math.floor(cellX / scale);
  const gridY = Math.floor(cellY / scale);
  const blendX = smooth((cellX % scale) / scale);
  const blendY = smooth((cellY % scale) / scale);
  const sample = (x: number, y: number) =>
    fraction(
      seed,
      normalizeCell(x, gridWidth),
      normalizeCell(y, gridHeight),
      salt,
    );
  const top =
    sample(gridX, gridY) * (1 - blendX) + sample(gridX + 1, gridY) * blendX;
  const bottom =
    sample(gridX, gridY + 1) * (1 - blendX) +
    sample(gridX + 1, gridY + 1) * blendX;
  return top * (1 - blendY) + bottom * blendY;
}

function terrainAt(
  seed: number,
  cellX: number,
  cellY: number,
  width: number,
  height: number,
): { terrain: number; elevation: number } {
  const broad = periodicNoise(
    seed,
    cellX,
    cellY,
    width,
    height,
    TERRAIN_CONFIG.broadScale,
    17,
  );
  const detail = periodicNoise(
    seed,
    cellX,
    cellY,
    width,
    height,
    TERRAIN_CONFIG.detailScale,
    31,
  );
  const moisture = periodicNoise(
    seed,
    cellX,
    cellY,
    width,
    height,
    TERRAIN_CONFIG.broadScale,
    47,
  );
  const elevationRatio = broad * 0.72 + detail * 0.28;
  const elevation = Math.round(
    elevationRatio * TERRAIN_CONFIG.maximumElevation,
  );
  if (elevationRatio < TERRAIN_CONFIG.waterThreshold)
    return { terrain: TERRAIN.water, elevation: 0 };
  if (
    elevationRatio > TERRAIN_CONFIG.rockyElevationThreshold &&
    moisture < TERRAIN_CONFIG.rockyMoistureThreshold
  ) {
    return { terrain: TERRAIN.rockyGround, elevation };
  }
  return { terrain: TERRAIN.grassland, elevation };
}

function chooseClearings(
  seed: number,
  width: number,
  height: number,
  villages: Array<{ id: string; anchorCellX: number; anchorCellY: number }>,
): ClearingPlan[] {
  const plans: ClearingPlan[] = villages.map((village) => ({
    centerCellX: village.anchorCellX,
    centerCellY: village.anchorCellY,
    status: 'claimed',
    claimedVillageId: village.id,
  }));
  const columns = Math.floor(width / CLEARING.minimumCenterDistance);
  const rows = Math.floor(height / CLEARING.minimumCenterDistance);
  const desiredCount = Math.min(CLEARING.targetCount, columns * rows);
  const candidates = Array.from({ length: columns * rows }, (_, index) => {
    const x = index % columns;
    const y = Math.floor(index / columns);
    return { x, y, order: hash(seed, x, y, 97) };
  }).sort((a, b) => a.order - b.order);

  for (const candidate of candidates) {
    if (plans.length >= desiredCount) break;
    const centerCellX = normalizeCell(
      candidate.x * CLEARING.minimumCenterDistance +
        CLEARING.minimumCenterDistance / 2,
      width,
    );
    const centerCellY = normalizeCell(
      candidate.y * CLEARING.minimumCenterDistance +
        CLEARING.minimumCenterDistance / 2,
      height,
    );
    if (
      plans.some(
        (plan) =>
          toroidalChebyshev(
            centerCellX,
            centerCellY,
            plan.centerCellX,
            plan.centerCellY,
            width,
            height,
          ) < CLEARING.minimumCenterDistance,
      )
    )
      continue;
    plans.push({
      centerCellX,
      centerCellY,
      status: 'protected',
      claimedVillageId: null,
    });
  }
  if (plans.length < desiredCount) {
    throw new Error(
      `Unable to place ${desiredCount} clearings in world ${width}x${height}`,
    );
  }
  return plans;
}

/**
 * Generates a world exactly once. The transaction advisory lock makes concurrent
 * callers harmless; a failed transaction leaves the world pending and writable.
 */
export async function generateWorld(
  transaction: Transaction<Database>,
  worldId: string,
): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`world-generation:${worldId}`}, 0))`.execute(
    transaction,
  );
  const world = await transaction
    .selectFrom('worlds')
    .selectAll()
    .where('id', '=', worldId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (world.generationStatus === 'ready') return;

  await transaction
    .updateTable('worlds')
    .set({ generationStatus: 'generating' })
    .where('id', '=', worldId)
    .execute();
  const seed = Number(world.seed);
  const villages = await transaction
    .selectFrom('villages')
    .select(['id', 'anchorCellX', 'anchorCellY'])
    .where('worldId', '=', worldId)
    .execute();
  const clearings = chooseClearings(
    seed,
    world.widthCells,
    world.heightCells,
    villages,
  );
  const clearingCells = new Set<string>();
  const transitionDensity = new Map<string, number>();
  for (const clearing of clearings) {
    const outerRadius = CLEARING.innerRadius + CLEARING.transitionRadius;
    for (let dy = -outerRadius; dy <= outerRadius; dy += 1) {
      for (let dx = -outerRadius; dx <= outerRadius; dx += 1) {
        const key = worldCellKey(
          normalizeCell(clearing.centerCellX + dx, world.widthCells),
          normalizeCell(clearing.centerCellY + dy, world.heightCells),
        );
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        if (distance <= CLEARING.innerRadius) clearingCells.add(key);
        else {
          const density =
            (distance - CLEARING.innerRadius) / CLEARING.transitionRadius;
          transitionDensity.set(
            key,
            Math.min(transitionDensity.get(key) ?? 1, density),
          );
        }
      }
    }
  }
  const existingOccupancies = new Set(
    (
      await transaction
        .selectFrom('worldCellOccupancies')
        .select(['cellX', 'cellY'])
        .where('worldId', '=', worldId)
        .execute()
    ).map((occupancy) => worldCellKey(occupancy.cellX, occupancy.cellY)),
  );
  const chunksX = world.widthCells / world.chunkSize;
  const chunksY = world.heightCells / world.chunkSize;
  const chunkRows: Array<{
    worldId: string;
    chunkX: number;
    chunkY: number;
    generationVersion: number;
    terrainCodes: number[];
    elevations: number[];
  }> = [];

  for (let chunkY = 0; chunkY < chunksY; chunkY += 1) {
    for (let chunkX = 0; chunkX < chunksX; chunkX += 1) {
      const terrainCodes: number[] = [];
      const elevations: number[] = [];
      for (let localY = 0; localY < world.chunkSize; localY += 1) {
        for (let localX = 0; localX < world.chunkSize; localX += 1) {
          const cellX = chunkX * world.chunkSize + localX;
          const cellY = chunkY * world.chunkSize + localY;
          const base = terrainAt(
            seed,
            cellX,
            cellY,
            world.widthCells,
            world.heightCells,
          );
          const clearing = clearingCells.has(worldCellKey(cellX, cellY));
          terrainCodes.push(clearing ? TERRAIN.grassland : base.terrain);
          elevations.push(clearing ? 0 : base.elevation);
        }
      }
      chunkRows.push({
        worldId,
        chunkX,
        chunkY,
        generationVersion: world.generationVersion,
        terrainCodes,
        elevations,
      });
    }
  }
  await transaction.insertInto('worldChunks').values(chunkRows).execute();
  await transaction
    .insertInto('worldClearings')
    .values(
      clearings.map((clearing) => ({
        id: randomUUID(),
        worldId,
        innerRadius: CLEARING.innerRadius,
        transitionRadius: CLEARING.transitionRadius,
        ...clearing,
      })),
    )
    .execute();

  const features: Array<{
    id: string;
    worldId: string;
    featureTypeCode: string;
    state: 'available';
    variantSeed: number;
    cellX: number;
    cellY: number;
  }> = [];
  for (let cellY = 0; cellY < world.heightCells; cellY += 1) {
    for (let cellX = 0; cellX < world.widthCells; cellX += 1) {
      if (
        clearingCells.has(worldCellKey(cellX, cellY)) ||
        existingOccupancies.has(worldCellKey(cellX, cellY))
      )
        continue;
      const base = terrainAt(
        seed,
        cellX,
        cellY,
        world.widthCells,
        world.heightCells,
      );
      if (base.terrain !== TERRAIN.grassland) continue;
      const roll = fraction(seed, cellX, cellY, 211);
      const density = transitionDensity.get(worldCellKey(cellX, cellY)) ?? 1;
      const woodlandLimit = FEATURE_CONFIG.woodlandDensity * density;
      const type =
        roll < woodlandLimit
          ? 'woodland'
          : roll < woodlandLimit + FEATURE_CONFIG.stoneOutcropDensity * density
            ? 'stone_outcrop'
            : null;
      if (!type) continue;
      features.push({
        id: randomUUID(),
        worldId,
        featureTypeCode: type,
        state: 'available',
        variantSeed: hash(seed, cellX, cellY, 223) | 0,
        cellX,
        cellY,
      });
    }
  }
  if (world.generationVersion >= 2) {
    for (const deposit of planClearingFeatures(
      seed,
      world.widthCells,
      world.heightCells,
      clearings,
      existingOccupancies,
    )) {
      features.push({
        id: randomUUID(),
        worldId,
        state: 'available',
        ...deposit,
      });
    }
  }
  // PostgreSQL parameter limits make bounded batches important even for v2 worlds.
  for (let offset = 0; offset < features.length; offset += 1_000) {
    const batch = features.slice(offset, offset + 1_000);
    await transaction
      .insertInto('worldFeatures')
      .values(
        batch.map((feature) => ({
          id: feature.id,
          worldId: feature.worldId,
          featureTypeCode: feature.featureTypeCode,
          state: feature.state,
          variantSeed: feature.variantSeed,
        })),
      )
      .execute();
    await transaction
      .insertInto('worldCellOccupancies')
      .values(
        batch.map((feature) => ({
          worldId,
          cellX: feature.cellX,
          cellY: feature.cellY,
          buildingId: null,
          featureId: feature.id,
          role: 'body',
        })),
      )
      .onConflict((conflict) =>
        conflict.columns(['worldId', 'cellX', 'cellY']).doNothing(),
      )
      .execute();
    const stones = batch.filter((feature) => feature.featureTypeCode === 'stone_outcrop');
    if (stones.length) await transaction.insertInto('stoneDeposits').values(stones.map((feature) => ({
      worldId, featureId: feature.id, cellX: feature.cellX, cellY: feature.cellY,
      initialAmount: stoneDepositAmount(feature.variantSeed), remainingAmount: stoneDepositAmount(feature.variantSeed),
      reservedAmount: 0, revision: 1, updatedAt: sql`transaction_timestamp()`,
    }))).execute();
  }
  await transaction
    .updateTable('worlds')
    .set({
      generationStatus: 'ready',
      generatedAt: sql`transaction_timestamp()`,
    })
    .where('id', '=', worldId)
    .execute();
}

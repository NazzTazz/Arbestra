import { normalizeCell, toroidalChebyshev, worldCellKey } from './coordinates.js';
import { WORLD_GENERATION_V2 } from './generation-config.js';

export interface ClearingCenter {
  centerCellX: number;
  centerCellY: number;
}

export interface ClearingFeaturePlan {
  featureTypeCode: 'woodland' | 'stone_outcrop';
  variantSeed: number;
  cellX: number;
  cellY: number;
}

const { clearing: clearingConfig, features } = WORLD_GENERATION_V2;

function hash(seed: number, x: number, y: number, salt: number): number {
  let value =
    (seed ^ Math.imul(x, 0x45d9f3b) ^ Math.imul(y, 0x27d4eb2d) ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

/**
 * Four sparse, deterministic deposits invite exploitation without obstructing
 * the 5x5 spawn core. An internal reservation set makes this safe for both new
 * and already inhabited clearings without mutating the caller's snapshot.
 */
export function planClearingFeatures(
  seed: number,
  width: number,
  height: number,
  clearings: ClearingCenter[],
  occupiedCells: Set<string>,
): ClearingFeaturePlan[] {
  const plans: ClearingFeaturePlan[] = [];
  const reservedCells = new Set(occupiedCells);
  for (const clearing of clearings) {
    const candidates: Array<{ cellX: number; cellY: number; order: number }> = [];
    for (
      let dy = -clearingConfig.depositOuterRadius;
      dy <= clearingConfig.depositOuterRadius;
      dy += 1
    ) {
      for (
        let dx = -clearingConfig.depositOuterRadius;
        dx <= clearingConfig.depositOuterRadius;
        dx += 1
      ) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        if (
          distance <= clearingConfig.spawnCoreRadius ||
          distance > clearingConfig.depositOuterRadius
        )
          continue;
        const cellX = normalizeCell(clearing.centerCellX + dx, width);
        const cellY = normalizeCell(clearing.centerCellY + dy, height);
        candidates.push({
          cellX,
          cellY,
          order: hash(seed, cellX, cellY, 307),
        });
      }
    }
    candidates.sort((left, right) => left.order - right.order);

    const selected: ClearingFeaturePlan[] = [];
    for (const featureTypeCode of features.clearingDeposits) {
      const candidate = candidates.find(({ cellX, cellY }) => {
        if (reservedCells.has(worldCellKey(cellX, cellY))) return false;
        return selected.every(
          (feature) =>
            toroidalChebyshev(
              cellX,
              cellY,
              feature.cellX,
              feature.cellY,
              width,
              height,
            ) >= 2,
        );
      });
      if (!candidate) break;
      const plan: ClearingFeaturePlan = {
        featureTypeCode,
        variantSeed: hash(seed, candidate.cellX, candidate.cellY, 331) | 0,
        cellX: candidate.cellX,
        cellY: candidate.cellY,
      };
      selected.push(plan);
      reservedCells.add(worldCellKey(plan.cellX, plan.cellY));
    }
    plans.push(...selected);
  }
  return plans;
}

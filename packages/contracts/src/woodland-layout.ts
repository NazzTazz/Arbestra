import type { NaturalFeature } from './villages.js';
import { createSpawnSurfaceIndex, spawnDelta } from './spawn-map.js';
import { proceduralTreeCount, STARTER_TREE_COUNT } from './woodland-trees.js';
/** Positions and trunk scales of the existing woodland thin instances, in cells. */
export interface WoodlandTree {
  x: number;
  y: number;
  scale: number;
  heightScale: number;
  rotation: number;
  elevation?: number;
}
const hash = (x: number, y: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
};
export type WoodlandLayoutInput = Pick<NaturalFeature, 'cellX' | 'cellY' | 'variantSeed' | 'rc1'> & {
  deposit: Pick<NonNullable<NaturalFeature['deposit']>, 'remainingAmount' | 'initialAmount' | 'cleared'> | null;
};
export function woodlandTrees(feature: WoodlandLayoutInput): WoodlandTree[] {
  if (feature.deposit?.cleared) return [];
  if (feature.rc1?.trees.length) {
    const stock = feature.deposit ? Math.max(0.2, feature.deposit.remainingAmount / feature.deposit.initialAmount) : 1;
    return feature.rc1.trees.map((t) => ({
      x: t.x,
      y: t.y,
      scale: t.crown * t.size * stock,
      heightScale: t.size * stock,
      rotation: 0,
      elevation: t.elevation,
    }));
  }
  // The same trees as the economy (woodlandTreeIndices): three for a starter
  // supplement, 2 to 5 in a world without RC1 forest (500 of wood per tree).
  const seed = Math.abs(feature.variantSeed),
    count = feature.rc1
      ? STARTER_TREE_COUNT
      : proceduralTreeCount({
          variantSeed: feature.variantSeed,
          initialAmount: feature.deposit?.initialAmount ?? null,
        });
  const stock = feature.deposit ? 0.2 + (0.8 * feature.deposit.remainingAmount) / feature.deposit.initialAmount : 1;
  return Array.from({ length: count }, (_, i) => {
    const angle = ((i + hash(seed, 401)) / count) * Math.PI * 2,
      radius = (0.42 + hash(seed, i + 419) * 0.48) / 2.5,
      scale = (0.76 + hash(seed, i + 431) * 0.26) * stock;
    return {
      x: feature.cellX + Math.cos(angle) * radius,
      y: feature.cellY + Math.sin(angle) * radius,
      scale,
      heightScale: scale,
      rotation: hash(feature.cellX * 10 + i, feature.cellY * 10 + i) * Math.PI,
    };
  });
}
/** Trunks, not foliage. Half a sampling step protects against stepping over a thin trunk. */
export function woodlandPassage(trees: readonly WoodlandTree[], world: { widthCells: number; heightCells: number }) {
  const { widthCells: w, heightCells: h } = world;
  const surfaces = trees.map((t) => ({
    x: t.x,
    y: t.y,
    halfWidth: (0.19 / 2.5) * t.scale + 1 / 16,
    halfHeight: (0.19 / 2.5) * t.scale + 1 / 16,
  }));
  const blocked = createSpawnSurfaceIndex(
    surfaces,
    w,
    h,
    (p, t) => Math.hypot(spawnDelta(p.x, t.x, w), spawnDelta(p.y, t.y, h)) <= t.halfWidth,
  );
  const cells = new Map<string, { cellX: number; cellY: number }>();
  for (const t of surfaces)
    for (let y = Math.floor(t.y - t.halfHeight + 0.5); y <= Math.floor(t.y + t.halfHeight + 0.5); y++)
      for (let x = Math.floor(t.x - t.halfWidth + 0.5); x <= Math.floor(t.x + t.halfWidth + 0.5); x++) {
        const p = { cellX: ((x % w) + w) % w, cellY: ((y % h) + h) % h };
        cells.set(p.cellX + ':' + p.cellY, p);
      }
  return {
    blocked: (x: number, y: number) => blocked({ x, y, halfWidth: 0, halfHeight: 0 }),
    cells: [...cells.values()],
  };
}

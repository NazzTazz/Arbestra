import { expect, it } from 'vitest';
import type { NaturalFeature, WoodlandTreeState } from '@arbestra/contracts';
import { GroveTrunkIndex } from './grove-trunks';

const grove = (id: string, cellX: number, trees: WoodlandTreeState[] = []): NaturalFeature => ({
  id,
  type: 'woodland',
  cellX,
  cellY: 4,
  variantSeed: 3,
  rc1: {
    trees: [
      { x: cellX - 0.2, y: 4.1, elevation: 1, size: 1, crown: 1, index: 10 },
      { x: cellX + 0.2, y: 3.9, elevation: 1, size: 1, crown: 1, index: 11 },
      { x: cellX, y: 4.3, elevation: 1, size: 1, crown: 1, index: 12 },
    ],
    rocks: [],
  },
  deposit: {
    featureId: id,
    resourceCode: 'wood',
    cellX,
    cellY: 4,
    initialAmount: 1500,
    remainingAmount: 1500,
    reservedAmount: 0,
    availableAmount: 1500,
    state: 'available',
    revision: 1,
    updatedAt: '2026-10-29T10:00:00.000Z',
    ...(trees.length ? { trees } : {}),
  },
});
const tree = (treeIndex: number, remainingAmount: number, stumpRemoved = false): WoodlandTreeState => ({
  treeIndex,
  remainingAmount,
  reservedAmount: 0,
  felledAt: '2026-10-29T10:00:00.000Z',
  stumpRemoved,
});

function source(features: NaturalFeature[]) {
  const s = {
    features,
    version: 1,
    chunkReads: 0,
    world: { chunkSize: 32 },
    key: () => '0:0',
    chunk: () => {
      s.chunkReads++;
      return { features: s.features };
    },
    featureVersion: () => s.version,
    ground: () => ({ height: 0 }),
  };
  return s;
}

it('answers the felling test thousands of times without recomputing a grove', () => {
  const s = source([grove('a', 5), grove('b', 8)]),
    index = new GroveTrunkIndex(s, (_feature, slot) => ({ x: slot.tree.x, z: slot.tree.y }));
  for (let i = 0; i < 5000; i++) index.trunksAt({ cellX: 5, cellY: 4 }, 1);
  expect(index.computed).toBe(2);
  expect(s.chunkReads).toBe(1);
  expect(index.trunksAt({ cellX: 5, cellY: 4 }, 1)).toHaveLength(3);
  expect(index.trunksAt({ cellX: 6, cellY: 4 }, 1)).toEqual([]);
});

it('takes a trunk out of the way when its stump is removed, recomputing that grove only', () => {
  const s = source([grove('a', 5), grove('b', 8)]),
    index = new GroveTrunkIndex(s, (_feature, slot) => ({ x: slot.tree.x, z: slot.tree.y }));
  index.trunksAt({ cellX: 5, cellY: 4 }, 1);
  // A felled tree and a stump still block, as on the server: nothing to recompute.
  s.features = [grove('a', 5, [tree(10, 300), tree(11, 0)]), grove('b', 8)];
  s.version++;
  expect(index.trunksAt({ cellX: 5, cellY: 4 }, 1)).toHaveLength(3);
  expect(index.computed).toBe(2);
  // The stump of tree 11 removed: its trunk leaves; grove b is not recomputed.
  s.features = [grove('a', 5, [tree(10, 300), tree(11, 0, true)]), grove('b', 8)];
  s.version++;
  expect(index.trunksAt({ cellX: 5, cellY: 4 }, 1).map((t) => t.index)).toEqual([0, 2]);
  expect(index.trunksAt({ cellX: 8, cellY: 4 }, 1)).toHaveLength(3);
  expect(index.computed).toBe(3);
  expect(s.chunkReads).toBe(3);
  // A toric rebase moves every trunk: all groves are placed again.
  index.trunksAt({ cellX: 5, cellY: 4 }, 2);
  expect(index.computed).toBe(5);
});

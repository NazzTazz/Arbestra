import { Value } from '@sinclair/typebox/value';
import { expect, it } from 'vitest';
import { HarvestCancelReceiptSchema, HarvestIntentSchema } from './exploitation.js';
import { ExtractionSchema, StoneDepositSchema } from './villages.js';
import {
  addedTrees,
  canonicalWoodTrees,
  cellTreeIndices,
  convertCutGrove,
  designatedQueue,
  designatedTrees,
  mergedTrees,
  generatedTreeCount,
  nextStump,
  nextWoodLot,
  proceduralTreeCount,
  queueContribution,
  targetDesignations,
  treeWood,
  withdrawGesture,
  woodlandTreeIndices,
  WOOD_LOT,
  WOOD_PER_TREE,
  type QueueDesignation,
  type TreeRecord,
} from './woodland-trees.js';

const record = (treeIndex: number, remainingAmount: number, reservedAmount = 0, stumpRemoved = false): TreeRecord => ({
  treeIndex,
  remainingAmount,
  reservedAmount,
  stumpRemoved,
});

it('makes a standing tree five lots, then a trunk on the ground, then a stump', () => {
  expect(WOOD_PER_TREE / WOOD_LOT).toBe(5);
  expect(treeWood(undefined)).toEqual({ state: 'standing', remaining: 500, reserved: 0, available: 500 });
  expect(treeWood(record(3, 400, 100))).toEqual({ state: 'felled', remaining: 400, reserved: 100, available: 300 });
  expect(treeWood(record(3, 0)).state).toBe('stump');
  expect(treeWood(record(3, 0, 0, true)).state).toBe('removed');
});

it('takes lots from the designated trees in their order, one tree per lot', () => {
  const records = new Map([
    [7, record(7, 0)],
    [2, record(2, 150, 100)],
  ]);
  // The stump gives nothing; the trunk has 50 free; the untouched tree a full lot.
  expect(nextWoodLot([7, 2, 9], records)).toEqual({ treeIndex: 2, amount: 50 });
  records.set(2, record(2, 150, 150));
  expect(nextWoodLot([7, 2, 9], records)).toEqual({ treeIndex: 9, amount: 100 });
  expect(nextWoodLot([7], records)).toBeNull();
});

it('keeps the RC1 order of a cell without the trees removed at installation', () => {
  expect(cellTreeIndices([40, 12, 33, 8], [33])).toEqual([40, 12, 8]);
});

it('designates every tree of a cell by default: RC1 trees, three starter trees, generated trees', () => {
  const rc1 = (sourceKey: string, treeIndices: number[], removedIndices: number[] = []) => ({
    rc1: { sourceKey, treeIndices, removedIndices },
    variantSeed: 3,
  });
  expect(woodlandTreeIndices(rc1('forest:12', [40, 12, 33], [12]))).toEqual([40, 33]);
  expect(woodlandTreeIndices(rc1('starter:village:4', []))).toEqual([0, 1, 2]);
  // An RC1 cell left without any tree has nothing to harvest.
  expect(woodlandTreeIndices(rc1('forest:12', [40], [40]))).toEqual([]);
  expect(woodlandTreeIndices(rc1('forest:13', []))).toEqual([]);
  expect(woodlandTreeIndices({ rc1: null, variantSeed: 7 })).toEqual([0, 1, 2, 3, 4]);
  expect(woodlandTreeIndices({ rc1: null, variantSeed: 4 })).toEqual([0, 1]);
  // Its stored wood counts once converted: 500 per tree.
  expect(woodlandTreeIndices({ rc1: null, variantSeed: 7, initialAmount: 1500 })).toEqual([0, 1, 2]);
  expect(proceduralTreeCount({ variantSeed: 7, initialAmount: null })).toBe(generatedTreeCount(7));
});

it('removes stumps one by one in the designated order, never one already being removed', () => {
  const records = new Map([
    [4, record(4, 0)],
    [6, record(6, 0, 0, true)],
    [8, record(8, 0)],
    [9, record(9, 200)],
  ]);
  expect(nextStump([6, 4, 8, 9], records, new Set())).toBe(4);
  expect(nextStump([6, 4, 8, 9], records, new Set([4]))).toBe(8);
  // A standing tree or a trunk with wood is not a stump.
  expect(nextStump([9, 1], records, new Set())).toBeNull();
});

it('gives 2 to 5 trees to a generated wood cell, stable per cell', () => {
  const counts = new Set(Array.from({ length: 40 }, (_, seed) => generatedTreeCount(seed - 20)));
  expect([...counts].sort()).toEqual([2, 3, 4, 5]);
  expect(generatedTreeCount(-7)).toBe(generatedTreeCount(-7));
});

it('converts a half-cut cell into half its trees as stumps or trunk, in tree order', () => {
  const trees = [11, 12, 13, 14];
  expect(convertCutGrove({ initialAmount: 2000, cutAmount: 0, trees })).toEqual({ records: [], cutAmount: 0 });
  // Half of four trees: two stumps.
  expect(convertCutGrove({ initialAmount: 2000, cutAmount: 1000, trees })).toEqual({
    records: [record(11, 0), record(12, 0)],
    cutAmount: 1000,
  });
  // A quarter and a half of a tree: one stump, the second tree half on the ground.
  expect(convertCutGrove({ initialAmount: 2000, cutAmount: 750, trees })).toEqual({
    records: [record(11, 0), record(12, 250)],
    cutAmount: 750,
  });
  // Former procedural cell of 300 for three trees: the share, not the units.
  expect(convertCutGrove({ initialAmount: 300, cutAmount: 100, trees: [0, 1, 2] })).toEqual({
    records: [record(0, 0)],
    cutAmount: 500,
  });
  // Regrowth recut beyond the initial amount: every tree is a stump.
  expect(convertCutGrove({ initialAmount: 1500, cutAmount: 1800, trees: [0, 1, 2] }).records).toEqual([
    record(0, 0),
    record(1, 0),
    record(2, 0),
  ]);
  expect(convertCutGrove({ initialAmount: 1500, cutAmount: 600, trees: [] })).toEqual({ records: [], cutAmount: 0 });
});

it('canonicalizes a designation: one entry per case, trees deduplicated in their designated order', () => {
  expect(canonicalWoodTrees(undefined)).toBeUndefined();
  expect(canonicalWoodTrees([])).toBeUndefined();
  const a = 'B0000000-0000-4000-8000-000000000002',
    b = 'a0000000-0000-4000-8000-000000000001';
  expect(
    canonicalWoodTrees([
      { featureId: a, treeIndices: [9, 3, 9] },
      { featureId: b, treeIndices: [40, 12] },
      { featureId: a.toLowerCase(), treeIndices: [3, 1] },
    ]),
  ).toEqual([
    { featureId: b, treeIndices: [40, 12] },
    // Never sorted: the order of the trees is the order of the lots.
    { featureId: a.toLowerCase(), treeIndices: [9, 3, 1] },
  ]);
});

it('checks a designation against its case: unknown trees refused, nothing-left trees left out', () => {
  const records = new Map([
    [12, record(12, 0)],
    [33, record(33, 0, 0, true)],
    [8, record(8, 200, 100)],
  ]);
  // Tree 7 is not in the case (or was removed at installation).
  expect(designatedTrees([8, 7, 12, 40, 33], [40, 12, 33, 8], records, 'cut')).toEqual({
    kept: [8, 40],
    unknown: [7],
  });
  // Clearing keeps the stump to remove, never a stump already removed.
  expect(designatedTrees([8, 7, 12, 40, 33], [40, 12, 33, 8], records, 'clear')).toEqual({
    kept: [8, 12, 40],
    unknown: [7],
  });
  expect(designatedTrees([12, 33], [40, 12, 33, 8], records, 'cut')).toEqual({ kept: [], unknown: [] });
});

it('adds to a queued case only the trees it does not hold, the whole case absorbing any designation', () => {
  expect(addedTrees([3, 5], [5, 7, 3, 9])).toEqual([7, 9]);
  expect(addedTrees([3, 5], [5])).toEqual([]);
  expect(addedTrees(null, [5])).toEqual([]);
  expect(addedTrees([3], null)).toBeNull();
  expect(mergedTrees([3, 5], [5, 7, 3, 9])).toEqual([3, 5, 7, 9]);
  expect(mergedTrees([3, 5], null)).toBeNull();
  expect(mergedTrees(null, [4])).toBeNull();
});

it('accepts designated trees and per-tree states in the contracts, and old payloads without them', () => {
  const featureId = 'a0000000-0000-4000-8000-000000000001',
    commandId = 'c0000000-0000-4000-8000-000000000003';
  expect(Value.Check(HarvestIntentSchema, { commandId, gardens: [], wood: [featureId], stone: [] })).toBe(true);
  expect(
    Value.Check(HarvestIntentSchema, {
      commandId,
      gardens: [],
      wood: [featureId],
      woodTrees: [{ featureId, treeIndices: [4, 1] }],
      stone: [],
    }),
  ).toBe(true);
  expect(
    Value.Check(HarvestIntentSchema, {
      commandId,
      gardens: [],
      wood: [featureId],
      woodTrees: [{ featureId, treeIndices: [] }],
      stone: [],
    }),
  ).toBe(false);
  const deposit = {
    featureId,
    resourceCode: 'wood',
    cleared: false,
    blocksCell: true,
    cutAmount: 500,
    cellX: 3,
    cellY: 4,
    initialAmount: 1500,
    remainingAmount: 1000,
    reservedAmount: 100,
    availableAmount: 900,
    state: 'available',
    revision: 3,
    updatedAt: '2026-10-29T10:00:00.000Z',
  };
  expect(Value.Check(StoneDepositSchema, deposit)).toBe(true);
  const trees = [
    { treeIndex: 4, remainingAmount: 0, reservedAmount: 0, felledAt: '2026-10-29T09:00:00.000Z', stumpRemoved: false },
    { treeIndex: 1, remainingAmount: 400, reservedAmount: 100, felledAt: deposit.updatedAt, stumpRemoved: false },
  ];
  expect(Value.Check(StoneDepositSchema, { ...deposit, trees })).toBe(true);
  // The record of a tree state is the one the shared rules read.
  expect(treeWood(trees[1]).state).toBe('felled');
  // A stump removal is a lot without wood: its extraction carries 0.
  expect(
    Value.Check(ExtractionSchema, {
      resourceCode: 'wood',
      cellX: 3,
      cellY: 4,
      id: commandId,
      featureId,
      treeIndex: 4,
      workerCount: 1,
      reservedAmount: 0,
      status: 'in-progress',
      startedAt: deposit.updatedAt,
      completesAt: deposit.updatedAt,
      completedAt: null,
      transportMs: 0,
      path: [],
    }),
  ).toBe(true);
});

// Slice 2e: the wood queue in cut or clear mode, a share per gesture.
const share = (commandId: string | null, mode: 'cut' | 'clear', treeIndices: number[] | null): QueueDesignation => ({
  commandId,
  mode,
  treeIndices,
});

it('derives a queued case from its shares: trees in order, clearing including cutting', () => {
  expect(designatedQueue([share('a', 'cut', [2, 0]), share('b', 'clear', [1, 2])], [0, 1, 2, 3])).toEqual({
    treeIndices: [2, 0, 1],
    clearTreeIndices: [1, 2],
  });
  // A share of the whole case makes every tree queued; clearing it whole clears them all.
  expect(designatedQueue([share('a', 'cut', [2]), share('b', 'clear', null)], [0, 1, 2])).toEqual({
    treeIndices: null,
    clearTreeIndices: [0, 1, 2],
  });
  // A target queued before shares were recorded is one share without gesture.
  expect(targetDesignations({ designations: null, treeIndices: [3], clearTreeIndices: null })).toEqual([
    share(null, 'cut', [3]),
  ]);
  expect(targetDesignations({ treeIndices: null, clearTreeIndices: [1] })).toEqual([
    share(null, 'cut', null),
    share(null, 'clear', [1]),
  ]);
});

it('adds to a queued case what is not there yet: a clearing takes a cut tree further, a cut adds nothing to a clearing', () => {
  const queue = { treeIndices: [2, 0], clearTreeIndices: [0] };
  expect(queueContribution(queue, 'cut', [0, 2, 5], [])).toEqual([5]);
  expect(queueContribution(queue, 'cut', [0], [])).toEqual([]);
  expect(queueContribution(queue, 'clear', [0, 2], [])).toEqual([2]);
  // Clearing the whole case: the trees not cleared yet, or the whole case when none is.
  expect(queueContribution(queue, 'clear', null, [0, 1, 2])).toEqual([1, 2]);
  expect(queueContribution({ treeIndices: [2], clearTreeIndices: null }, 'clear', null, [0, 1, 2])).toBeNull();
  expect(queueContribution({ treeIndices: null, clearTreeIndices: null }, 'cut', [1], [])).toEqual([]);
});

it('withdraws a gesture from a case: its trees not taken leave, the other shares stay', () => {
  const shares = [share(null, 'cut', [4]), share('a', 'cut', [2, 0]), share('b', 'clear', [0, 1])];
  expect(withdrawGesture(shares, 'b', new Set([1]), [0, 1, 2, 4])).toEqual({
    designations: [share(null, 'cut', [4]), share('a', 'cut', [2, 0]), share('b', 'clear', [1])],
    found: true,
  });
  expect(withdrawGesture(shares, 'a', new Set(), [0, 1, 2, 4])).toEqual({
    designations: [share(null, 'cut', [4]), share('b', 'clear', [0, 1])],
    found: true,
  });
  // A share of the whole case keeps only its taken trees.
  expect(withdrawGesture([share('c', 'cut', null)], 'c', new Set([3]), [1, 3])).toEqual({
    designations: [share('c', 'cut', [3])],
    found: true,
  });
  // Another gesture, or none recorded: nothing changes.
  expect(withdrawGesture(shares, 'z', new Set(), [0]).found).toBe(false);
  expect(withdrawGesture(shares, 'z', new Set(), [0]).designations).toEqual(shares);
});

it('accepts a clearing intent and checks the receipt of a cancellation', () => {
  const commandId = '00000000-0000-4000-8000-000000000001',
    featureId = '00000000-0000-4000-8000-000000000002';
  expect(
    Value.Check(HarvestIntentSchema, { commandId, gardens: [], wood: [featureId], woodMode: 'clear', stone: [] }),
  ).toBe(true);
  expect(
    Value.Check(HarvestIntentSchema, { commandId, gardens: [], wood: [featureId], woodMode: 'burn', stone: [] }),
  ).toBe(false);
  expect(
    Value.Check(HarvestCancelReceiptSchema, {
      commandId,
      trees: [
        { featureId, treeIndex: 0, outcome: 'removed' },
        { featureId, treeIndex: 1, outcome: 'in-progress', mode: 'clear' },
        { featureId, treeIndex: 2, outcome: 'queued', mode: 'cut' },
        { featureId, treeIndex: 3, outcome: 'not-queued' },
      ],
    }),
  ).toBe(true);
  expect(Value.Check(HarvestCancelReceiptSchema, { commandId, beforeQueue: true, trees: [] })).toBe(true);
  expect(
    Value.Check(HarvestCancelReceiptSchema, { commandId, trees: [{ featureId, treeIndex: 0, outcome: 'gone' }] }),
  ).toBe(false);
});

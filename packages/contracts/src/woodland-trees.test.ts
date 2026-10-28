import { expect, it } from 'vitest';
import {
  cellTreeIndices,
  convertCutGrove,
  generatedTreeCount,
  nextWoodLot,
  treeWood,
  WOOD_LOT,
  WOOD_PER_TREE,
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

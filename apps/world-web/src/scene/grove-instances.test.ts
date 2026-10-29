import { expect, it } from 'vitest';
import type { NaturalFeature, WoodlandTreeState } from '@arbestra/contracts';
import { CLEAR_TINT, GroveInstances, type TreeLook } from './grove-instances';
import { groveSlots, type GroveSlot } from './grove-trees';

const felled = '2026-10-29T10:00:00.000Z';
const state = (treeIndex: number, remainingAmount: number, stumpRemoved = false): WoodlandTreeState => ({
  treeIndex,
  remainingAmount,
  reservedAmount: 0,
  felledAt: felled,
  stumpRemoved,
});
const grove = (trees: WoodlandTreeState[] = []): NaturalFeature => ({
  id: 'grove',
  type: 'woodland',
  cellX: 10,
  cellY: 20,
  variantSeed: 7,
  rc1: {
    trees: [
      { x: 10.1, y: 20.2, elevation: 1, size: 1, crown: 1, index: 40 },
      { x: 10.4, y: 19.9, elevation: 1, size: 1, crown: 1, index: 41 },
      { x: 9.8, y: 20.3, elevation: 1, size: 1, crown: 1, index: 45 },
    ],
    rocks: [],
  },
  deposit: {
    featureId: 'grove',
    resourceCode: 'wood',
    cellX: 10,
    cellY: 20,
    initialAmount: 1500,
    remainingAmount: 1500,
    reservedAmount: 0,
    availableAmount: 1500,
    state: 'available',
    revision: 1,
    updatedAt: felled,
    ...(trees.length ? { trees } : {}),
  },
});
const place = (slot: GroveSlot) => ({ x: slot.index * 2, y: 1, z: 0, yaw: 0.3 });
const plain: TreeLook = { masked: false, tint: false };
/** Whether an instance draws anything: a hidden one is scaled to nothing. */
const shown = (instances: GroveInstances, piece: string, i: number) => {
  const m = instances.pieces.get(piece as never)!.matrices;
  return Math.hypot(m[i * 16]!, m[i * 16 + 1]!, m[i * 16 + 2]!) > 1e-6;
};
const refsOf = (instances: GroveInstances, slot: GroveSlot) =>
  [`${slot.variant}-fut`, `${slot.variant}-feuillage`, slot.stumpPiece].map((piece) => ({
    piece,
    i: instances.pieces.get(piece as never)!.slots.indexOf(slot.index),
  }));

it('gives each tree its trunk, foliage and stump, and names its server tree for picking', () => {
  const slots = groveSlots(grove()),
    instances = new GroveInstances(slots, place);
  expect(slots.map((s) => s.treeIndex)).toEqual([40, 41, 45]);
  instances.apply(() => plain);
  expect(instances.writes).toBe(3);
  for (const slot of slots) {
    const [fut, foliage, stump] = refsOf(instances, slot);
    expect([shown(instances, fut!.piece, fut!.i), shown(instances, foliage!.piece, foliage!.i)]).toEqual([true, true]);
    expect(shown(instances, stump!.piece, stump!.i)).toBe(false);
    expect(instances.pieces.get(fut!.piece as never)!.trees[fut!.i]).toBe(slot.treeIndex);
  }
  // Every instance is accounted for: three per tree.
  expect([...instances.pieces.values()].reduce((n, p) => n + p.slots.length, 0)).toBe(9);
  // No stump shows in an untouched grove: its stump pieces cost no draw call.
  for (const [piece, data] of instances.pieces) expect(data.shown > 0).toBe(!piece.startsWith('souche'));
});

it('rewrites only the tree whose state changed, from felled to its last trunk, its stump and its removal', () => {
  const instances = new GroveInstances(groveSlots(grove()), place);
  instances.apply(() => plain);
  // Nothing changed: no write at all.
  expect(instances.apply(() => plain, groveSlots(grove()))).toEqual([]);
  expect(instances.writes).toBe(3);
  const steps: Array<[WoodlandTreeState, [boolean, boolean, boolean]]> = [
    [state(41, 400), [true, false, true]], // Felled: trunk on the ground, stump, no foliage.
    [state(41, 100), [true, false, true]],
    [state(41, 0), [false, false, true]], // A stump only.
    [state(41, 0, true), [false, false, false]], // Removed: nothing left.
  ];
  let lying = Infinity;
  for (const [tree, expected] of steps) {
    const slots = groveSlots(grove([tree])),
      touched = instances.apply(() => plain, slots);
    // One tree, its three instances: O(changed trees), never the grove.
    expect(touched).toHaveLength(3);
    const [fut, foliage, stump] = refsOf(instances, slots[1]!);
    expect([
      shown(instances, fut!.piece, fut!.i),
      shown(instances, foliage!.piece, foliage!.i),
      shown(instances, stump!.piece, stump!.i),
    ]).toEqual(expected);
    if (tree.remainingAmount > 0) {
      // The trunk lying on the ground shortens with its wood.
      const m = instances.pieces.get(fut!.piece as never)!.matrices,
        length = Math.hypot(m[fut!.i * 16 + 4]!, m[fut!.i * 16 + 5]!, m[fut!.i * 16 + 6]!);
      expect(length).toBeLessThan(lying);
      expect(Math.abs(m[fut!.i * 16 + 5]!)).toBeLessThan(1e-6); // On its side, not upright.
      lying = length;
    }
  }
  expect(instances.writes).toBe(3 + steps.length);
  // Everything of tree 41 is hidden again: its stump piece counts no instance shown.
  const stump = instances.pieces.get(groveSlots(grove())[1]!.stumpPiece)!;
  expect(stump.shown).toBe(0);
});

it('tints the trees queued for clearing and hides the one a worksite fells, writing only those', () => {
  const slots = groveSlots(grove([state(45, 0)])),
    instances = new GroveInstances(slots, place);
  instances.apply(() => plain);
  const tinted = instances.apply((slot) => ({ masked: false, tint: slot.treeIndex === 45 }));
  expect(tinted).toHaveLength(3);
  for (const ref of refsOf(instances, slots[2]!))
    expect([...instances.pieces.get(ref.piece as never)!.colours.slice(ref.i * 4, ref.i * 4 + 4)]).toEqual(
      CLEAR_TINT.map((v) => Math.fround(v)),
    );
  for (const ref of refsOf(instances, slots[0]!))
    expect([...instances.pieces.get(ref.piece as never)!.colours.slice(ref.i * 4, ref.i * 4 + 4)]).toEqual([
      1, 1, 1, 1,
    ]);
  // The tree a worksite fells is drawn by the worksite: hidden in the grove, its stump left to the server state.
  expect(instances.apply((slot) => ({ masked: slot.index === 0, tint: slot.treeIndex === 45 }))).toHaveLength(3);
  const [fut, foliage] = refsOf(instances, slots[0]!);
  expect([shown(instances, fut!.piece, fut!.i), shown(instances, foliage!.piece, foliage!.i)]).toEqual([false, false]);
});

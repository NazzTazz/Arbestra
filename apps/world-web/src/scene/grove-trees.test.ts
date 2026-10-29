import { describe, expect, it } from 'vitest';
import type { NaturalFeature, WoodlandTreeState } from '@arbestra/contracts';
import { groveSlots, treePieceData, treeVariant, woodlandSignature } from './grove-trees';

const tree = (
  treeIndex: number,
  remainingAmount: number,
  stumpRemoved = false,
  reservedAmount = 0,
): WoodlandTreeState => ({
  treeIndex,
  remainingAmount,
  reservedAmount,
  felledAt: '2026-10-29T10:00:00.000Z',
  stumpRemoved,
});
const grove = (
  trees: WoodlandTreeState[] = [],
  cleared = false,
  indices: Array<number | undefined> = [40, 41, 45],
) => ({
  cellX: 10,
  cellY: 20,
  variantSeed: 7,
  rc1: {
    trees: [
      { x: 10.1, y: 20.2, elevation: 1, size: 1, crown: 1 },
      { x: 10.4, y: 19.9, elevation: 1, size: 1, crown: 1 },
      { x: 9.8, y: 20.3, elevation: 1, size: 1, crown: 1 },
    ].map((t, i) => (indices[i] === undefined ? t : { ...t, index: indices[i] })),
    rocks: [],
  },
  deposit: { initialAmount: 1500, remainingAmount: 1500, cleared, ...(trees.length ? { trees } : {}) },
});

describe('grove slots, tree by tree, from the server', () => {
  it('shows every tree standing in an untouched grove, each named by its RC1 index', () => {
    const slots = groveSlots(grove());
    expect(slots.map((s) => [s.treeIndex, s.state, s.standing, s.stump, s.lying, s.available])).toEqual([
      [40, 'standing', true, null, 0, 500],
      [41, 'standing', true, null, 0, 500],
      [45, 'standing', true, null, 0, 500],
    ]);
    // Full size: a tree is cut down, never shrunk.
    expect(slots[0]!.tree.heightScale).toBe(1);
  });

  it('draws a felled tree as a trunk on the ground as long as its wood, then a stump, then nothing', () => {
    const slots = groveSlots(grove([tree(41, 400, false, 100), tree(45, 0), tree(40, 0, true)]));
    expect(slots.map((s) => s.state)).toEqual(['removed', 'felled', 'stump']);
    expect(slots[1]).toMatchObject({ standing: false, lying: 0.8, remaining: 400, available: 300 });
    expect(slots[1]!.stump).toMatch(/^souche-/);
    expect(slots[2]).toMatchObject({ lying: 0, available: 0 });
    expect(slots[2]!.stump).toBe(slots[2]!.stumpPiece);
    // A removed stump leaves nothing, and no young tree grows any more.
    expect(slots[0]).toMatchObject({ stump: null, lying: 0, standing: false });
    expect(groveSlots(grove([], true))).toEqual([]);
  });

  it('numbers the trees of a world without RC1 forest in their drawn order', () => {
    const procedural = {
      cellX: 3,
      cellY: 4,
      variantSeed: 9,
      deposit: { initialAmount: 1000, remainingAmount: 600, trees: [tree(1, 100)] },
    };
    const slots = groveSlots(procedural);
    expect(slots.map((s) => [s.treeIndex, s.state])).toEqual([
      [0, 'standing'],
      [1, 'felled'],
    ]);
  });

  it('cannot name a tree an older server did not index: it stays standing and undesignatable alone', () => {
    const slots = groveSlots(grove([tree(41, 0)], false, [40, undefined, 45]));
    expect(slots.map((s) => [s.treeIndex, s.state])).toEqual([
      [40, 'standing'],
      [null, 'standing'],
      [45, 'standing'],
    ]);
  });

  it('keeps the meshes of a grove while its trees change, and rebuilds them only for new geometry', () => {
    const feature = (trees: WoodlandTreeState[] = [], cleared = false) =>
      ({
        id: 'g',
        type: 'woodland',
        ...grove(trees, cleared),
        deposit: { ...grove(trees, cleared).deposit },
      }) as unknown as NaturalFeature;
    expect(woodlandSignature(feature([tree(41, 300)]))).toBe(woodlandSignature(feature()));
    expect(woodlandSignature(feature([], true))).not.toBe(woodlandSignature(feature()));
  });

  it('is the same for every reader and draws one broadleaf for four firs', () => {
    expect(groveSlots(grove([tree(41, 300)]))).toEqual(groveSlots(grove([tree(41, 300)])));
    const variants = Array.from({ length: 2000 }, (_, i) => treeVariant(3, i));
    const broadleaf = variants.filter((v) => v === 'feuillu-a').length / variants.length;
    expect(broadleaf).toBeGreaterThan(0.15);
    expect(broadleaf).toBeLessThan(0.25);
  });

  it('decodes kit pieces as unindexed coloured triangles', () => {
    const stump = treePieceData('souche-a');
    expect(stump.positions!.length).toBe(stump.indices!.length * 3);
    expect(stump.colors!.length).toBe((stump.positions!.length / 3) * 4);
  });
});

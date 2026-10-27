import { describe, expect, it } from 'vitest';
import { groveSlots, treePieceData, treeVariant } from './grove-trees';

const grove = (remainingAmount: number, cutAmount: number, cleared = false) => ({
  cellX: 10,
  cellY: 20,
  variantSeed: 7,
  rc1: {
    trees: [
      { x: 10.1, y: 20.2, elevation: 1, size: 1, crown: 1 },
      { x: 10.4, y: 19.9, elevation: 1, size: 1, crown: 1 },
      { x: 9.8, y: 20.3, elevation: 1, size: 1, crown: 1 },
    ],
    rocks: [],
  },
  deposit: { initialAmount: 300, remainingAmount, cutAmount, cleared },
});

describe('grove slots from the server stock', () => {
  it('shows three full-grown originals in an untouched grove', () => {
    const slots = groveSlots(grove(300, 0));
    expect(slots.map((s) => [s.standing, s.stump, s.lying, s.young])).toEqual([
      [true, null, 0, null],
      [true, null, 0, null],
      [true, null, 0, null],
    ]);
    // Full size whatever the stock: the stock removes trees, it no longer shrinks them.
    expect(slots[0]!.tree.heightScale).toBe(1);
  });

  it('leaves a stump and starts a young tree once a third of a three-tree grove is cut', () => {
    // 100 cut, then some regrowth: the first slot is a stump, the others stand.
    const slots = groveSlots(grove(230, 100));
    expect(slots.map((s) => s.standing)).toEqual([false, true, true]);
    expect(slots[0]!.stump).toMatch(/^souche-/);
    expect(slots[0]!.lying).toBe(0);
    expect(slots[0]!.young?.piece).toBe('pousse-plant');
  });

  it('lays down the trunk of the slot being cut, shorter as it is consumed', () => {
    const slots = groveSlots(grove(240, 60));
    expect(slots[0]!.standing).toBe(false);
    expect(slots[0]!.lying).toBeCloseTo(0.4);
    expect(slots[0]!.young).toBeNull();
    expect(slots.slice(1).every((s) => s.standing)).toBe(true);
  });

  it('shows only stumps and the first shoots in a harvested grove, nothing once cleared', () => {
    const harvested = groveSlots(grove(20, 300));
    expect(harvested.every((s) => s.stump && !s.standing && !s.lying)).toBe(true);
    expect(harvested.filter((s) => s.young).length).toBeLessThanOrEqual(1);
    expect(groveSlots(grove(20, 300, true))).toEqual([]);
  });

  it('grows the young trees back to adults beside their stumps, which stay', () => {
    const slots = groveSlots(grove(300, 300));
    expect(slots.every((s) => s.stump && s.young?.piece === s.variant && s.young.scale === 1)).toBe(true);
  });

  it('is the same for every reader and draws one broadleaf for four firs', () => {
    expect(groveSlots(grove(240, 60))).toEqual(groveSlots(grove(240, 60)));
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

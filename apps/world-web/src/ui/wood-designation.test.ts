import { expect, it } from 'vitest';
import type { HarvestIntent } from '@arbestra/contracts';
import { designateTree, type DesignatedTree } from './wood-designation';

const a = '00000000-0000-4000-8000-00000000000a',
  b = '00000000-0000-4000-8000-00000000000b';
const draft = (): { intent: HarvestIntent; trees?: DesignatedTree[] } => ({
  intent: { commandId: '00000000-0000-4000-8000-000000000001', gardens: [], wood: [], stone: [], woodMode: 'clear' },
});
const tree = (featureId: string, treeIndex: number | null): DesignatedTree => ({
  featureId,
  treeIndex,
  cellX: 1,
  cellY: 2,
});

it('designates trees one by one, each once, in the order the gesture met them', () => {
  const d = draft();
  expect(designateTree(d, tree(a, 40))).toBe(true);
  expect(designateTree(d, tree(b, 7))).toBe(true);
  expect(designateTree(d, tree(a, 12))).toBe(true);
  expect(designateTree(d, tree(a, 40))).toBe(false);
  expect(d.intent).toMatchObject({
    wood: [a, b],
    woodTrees: [
      { featureId: a, treeIndices: [40, 12] },
      { featureId: b, treeIndices: [7] },
    ],
    woodMode: 'clear',
  });
  expect(d.trees!.map((t) => [t.featureId, t.treeIndex])).toEqual([
    [a, 40],
    [b, 7],
    [a, 12],
  ]);
});

it('takes a whole case for a tree the server cannot name, and nothing more of that case', () => {
  const d = draft();
  designateTree(d, tree(a, 40));
  designateTree(d, tree(b, 3));
  expect(designateTree(d, tree(a, null))).toBe(true);
  expect(designateTree(d, tree(a, 41))).toBe(false);
  expect(d.intent.wood).toEqual([a, b]);
  expect(d.intent.woodTrees).toEqual([{ featureId: b, treeIndices: [3] }]);
  const whole = draft();
  designateTree(whole, tree(a, null));
  expect(whole.intent).not.toHaveProperty('woodTrees');
});

it('stays within the contract: 64 cases and 256 trees a case', () => {
  const d = draft();
  for (let i = 0; i < 300; i++) designateTree(d, tree(a, i));
  expect(d.intent.woodTrees![0]!.treeIndices).toHaveLength(256);
  const many = draft();
  for (let i = 0; i < 70; i++) designateTree(many, tree(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, 0));
  expect(many.intent.wood).toHaveLength(64);
});

import { expect, it } from 'vitest';
import type { VillageState } from '@arbestra/contracts';
import { changedCases, queuedMode, woodQueue, woodQueueCounts } from './wood-queue';

type Site = VillageState['village']['worksites'][number];
const target = (featureId: string, over: Partial<Site['targets'][number]> = {}): Site['targets'][number] => ({
  featureId,
  cellX: 1,
  cellY: 2,
  status: 'pending',
  reason: null,
  ...over,
});
const site = (over: Partial<Site>): Site =>
  ({
    id: 'site',
    poolResource: 'wood',
    resourceCode: 'wood',
    mode: 'cut',
    status: 'running',
    targets: [],
    ...over,
  }) as Site;

it('reads the queue from the pending targets of the wood pool: trees to cut and trees to clear', () => {
  const queue = woodQueue([
    site({
      targets: [
        target('a', { treeIndices: [4, 1, 7], clearTreeIndices: [7] }),
        target('b', { treeIndices: null }),
        target('c', { treeIndices: [2], status: 'completed' }),
      ],
    }),
    site({ id: 'stone', resourceCode: 'stone', poolResource: 'stone', targets: [target('d')] }),
  ]);
  expect([...queue.keys()]).toEqual(['a', 'b']);
  expect(queuedMode(queue, 'a', 4)).toBe('cut');
  expect(queuedMode(queue, 'a', 7)).toBe('clear');
  expect(queuedMode(queue, 'a', 3)).toBeNull();
  expect(queuedMode(queue, 'b', 9)).toBe('cut'); // The whole case, for its wood.
  expect(queuedMode(queue, 'c', 2)).toBeNull();
  expect(queuedMode(queue, 'd', 0)).toBeNull();
});

it('clears every designated tree of a worksite in clear mode, and drops a stopped worksite of its own', () => {
  const queue = woodQueue([
    site({ id: 'own', poolResource: null, mode: 'clear', targets: [target('a', { treeIndices: [0, 2] })] }),
    site({ id: 'whole', poolResource: null, mode: 'clear', targets: [target('b', { treeIndices: null })] }),
    site({ id: 'gone', poolResource: null, status: 'stopping', targets: [target('c', { treeIndices: [1] })] }),
  ]);
  expect(queuedMode(queue, 'a', 2)).toBe('clear');
  expect(queuedMode(queue, 'b', 5)).toBe('clear');
  expect(queuedMode(queue, 'b', null)).toBe('clear');
  expect(queue.has('c')).toBe(false);
});

it('names only the cases whose queue changed, so that only their groves are redrawn', () => {
  const before = woodQueue([site({ targets: [target('a', { treeIndices: [1] }), target('b', { treeIndices: [2] })] })]);
  const after = woodQueue([
    site({
      targets: [
        target('a', { treeIndices: [1] }),
        target('b', { treeIndices: [2], clearTreeIndices: [2] }),
        target('c'),
      ],
    }),
  ]);
  expect(changedCases(before, after).sort()).toEqual(['b', 'c']);
  expect(changedCases(after, before).sort()).toEqual(['b', 'c']);
  expect(changedCases(after, woodQueue([site({ targets: [] })])).sort()).toEqual(['a', 'b', 'c']);
});

it('counts a worksite queue for the Chantier panel: trees to cut, to clear, and whole cases', () => {
  expect(
    woodQueueCounts(
      site({
        targets: [
          target('a', { treeIndices: [4, 1, 7], clearTreeIndices: [7] }),
          target('b', { treeIndices: null }),
          target('c', { treeIndices: [3], status: 'completed' }),
        ],
      }),
    ),
  ).toEqual({ cut: 2, clear: 1, wholeCases: 1 });
  expect(
    woodQueueCounts(site({ mode: 'clear', poolResource: null, targets: [target('a', { treeIndices: [0, 1] })] })),
  ).toEqual({
    cut: 0,
    clear: 2,
    wholeCases: 0,
  });
});

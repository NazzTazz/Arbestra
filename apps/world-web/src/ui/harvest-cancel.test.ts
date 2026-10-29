import { expect, it } from 'vitest';
import { CANCEL_WINDOW_MS, cancelSecondsLeft, cancelSummary } from './harvest-cancel';

const commandId = '00000000-0000-4000-8000-000000000001',
  featureId = '00000000-0000-4000-8000-000000000002';

it('counts 15 seconds down after a gesture, then hides the button', () => {
  expect(CANCEL_WINDOW_MS).toBe(15_000);
  expect(cancelSecondsLeft(1000, 1000)).toBe(15);
  expect(cancelSecondsLeft(1000, 1001)).toBe(15);
  expect(cancelSecondsLeft(1000, 6000)).toBe(10);
  expect(cancelSecondsLeft(1000, 15_999)).toBe(1);
  expect(cancelSecondsLeft(1000, 16_000)).toBe(0);
  expect(cancelSecondsLeft(1000, 60_000)).toBe(0);
});

it('tells what a cancellation did: withdrawn, the lot that still ends, kept by another gesture, done', () => {
  const tree = (treeIndex: number, outcome: 'removed' | 'in-progress' | 'queued' | 'not-queued') => ({
    featureId,
    treeIndex,
    outcome,
  });
  expect(
    cancelSummary({
      commandId,
      trees: [
        tree(0, 'removed'),
        tree(1, 'removed'),
        tree(2, 'in-progress'),
        { ...tree(3, 'queued'), mode: 'cut' },
        tree(4, 'not-queued'),
      ],
    }),
  ).toBe(
    'Annulé : 2 arbres retirés de la file · 1 lot en cours se termine, sans plus · 1 déjà prévu par un autre geste · 1 déjà fait.',
  );
  expect(cancelSummary({ commandId, trees: [tree(0, 'removed')] })).toBe('Annulé : 1 arbre retiré de la file.');
  expect(cancelSummary({ commandId, beforeQueue: true, trees: [tree(0, 'removed'), tree(1, 'removed')] })).toBe(
    'Geste annulé avant son traitement : 2 arbres retirés.',
  );
  expect(cancelSummary({ commandId, trees: [] })).toBe('Rien à annuler.');
});

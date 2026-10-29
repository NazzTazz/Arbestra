import { expect, it } from 'vitest';
import { woodFeedbackAmounts } from './use-harvest-tool';

it('gives each designated tree its own « + » feedback, adding up to the receipt', () => {
  // Three intact trees: one « +500 » each, not one « +1500 » for the grove.
  expect(woodFeedbackAmounts(1500, [2, 0, 1], () => 500)).toEqual([
    { treeIndex: 2, amount: 500 },
    { treeIndex: 0, amount: 500 },
    { treeIndex: 1, amount: 500 },
  ]);
  // A tree already half cut takes what it still holds.
  const remaining = new Map([
    [4, 300],
    [5, 500],
  ]);
  expect(woodFeedbackAmounts(800, [4, 5], (i) => remaining.get(i) ?? null)).toEqual([
    { treeIndex: 4, amount: 300 },
    { treeIndex: 5, amount: 500 },
  ]);
  // Unknown to the scene: the rest is shared, and the sum still matches.
  const shared = woodFeedbackAmounts(1000, [7, 8], () => null);
  expect(shared.reduce((s, t) => s + t.amount, 0)).toBe(1000);
});

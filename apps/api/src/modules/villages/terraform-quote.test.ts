import { expect, it } from 'vitest';
import type { LevelingQuote } from '@arbestra/contracts';
import { terraformQuoteMatchesExpected } from './leveling.js';

const expected: LevelingQuote = {
  model: 'vertices', height: .5, cells: [{ cellX: 1, cellY: 1 }],
  vertices: [{ vertexX: 1, vertexY: 1, height: .5 }], affectedCells: [{ cellX: 1, cellY: 1 }],
  workMs: 10000, transportMs: 5000, durationMs: 20000,
  stoneDebit: 0, stoneCredit: 0, signature: 'source-terrain',
};

it.each([18000, 19000, 20000, 21000, 22000])('accepts a server duration of %i ms for a 20-second estimate', durationMs => {
  expect(terraformQuoteMatchesExpected({ ...expected, durationMs, transportMs: (durationMs - expected.workMs) / 2 }, expected)).toBe(true);
});

it.each([17999, 22001])('requires confirmation outside 10%%: %i ms for a 20-second estimate', durationMs => {
  expect(terraformQuoteMatchesExpected({ ...expected, durationMs, transportMs: (durationMs - expected.workMs) / 2 }, expected)).toBe(false);
});

it.each<Partial<LevelingQuote>>([
  { stoneDebit: 1 }, { stoneCredit: 1 }, { signature: 'changed-terrain' }, { height: .75 },
  { cells: [{ cellX: 2, cellY: 1 }] }, { affectedCells: [{ cellX: 2, cellY: 1 }] },
  { vertices: [{ vertexX: 1, vertexY: 1, height: .75 }] }, { workMs: 10001 },
])('requires confirmation for a non-travel change: %j', change => {
  expect(terraformQuoteMatchesExpected({ ...expected, durationMs: 21000, transportMs: 5500, ...change }, expected)).toBe(false);
});

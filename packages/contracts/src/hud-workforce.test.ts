import { expect, it } from 'vitest';
import { extractionPoolCaps } from './hud-workforce.js';
it('balances a global workforce into real teams without exceeding ten people each', () => {
  expect(extractionPoolCaps(3, 25)).toEqual([9, 8, 8]);
  expect(extractionPoolCaps(2, 5)).toEqual([3, 2]);
  expect(extractionPoolCaps(0, 5)).toEqual([]);
  for (const [sites, people] of [
    [2, 1],
    [1, 11],
    [9, 45],
    [-1, 5],
  ])
    expect(() => extractionPoolCaps(sites!, people!)).toThrow();
});

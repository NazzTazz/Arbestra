import { expect, it } from 'vitest';
import { oracleAmount } from './market.js';
it('quotes exact whole quantities for all approved tariffs, including carrots', () => {
  expect(oracleAmount(100, 4, 4)).toBe(70);
  expect(oracleAmount(100, 4, 6)).toBe(46);
  expect(oracleAmount(100, 6, 4)).toBe(105);
  expect(oracleAmount(40, 1, 4)).toBe(7);
  expect(oracleAmount(10, 4, 1)).toBe(28);
  expect(oracleAmount(1, 1, 6)).toBe(0);
});
it('cannot profit through any two or three-resource cycle', () => {
  for (const a of [1,4,6]) for (const b of [1,4,6]) for (const c of [1,4,6]) {
    const q=10000, ab=oracleAmount(q,a,b);
    expect(oracleAmount(ab,b,a)).toBeLessThan(q);
    expect(oracleAmount(oracleAmount(ab,b,c),c,a)).toBeLessThan(q);
  }
});

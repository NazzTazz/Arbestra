import { describe, expect, it } from 'vitest';
import { recognizableCatEye } from './cat-observation';

describe('cat discovery readability', () => {
  it('does not discover a faint, tiny or peripheral pair of eyes', () => {
    expect(recognizableCatEye(.13, .5, .5, 20, 26)).toBe(false);
    expect(recognizableCatEye(.5, .5, .5, 4, 6)).toBe(false);
    expect(recognizableCatEye(.5, .2, .5, 20, 26)).toBe(false);
    expect(recognizableCatEye(.5, .5, .5, 20, 26)).toBe(true);
  });
});

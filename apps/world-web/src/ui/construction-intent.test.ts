import { expect, it } from 'vitest';
import { sameUpgradeQuote, type UpgradePreview } from './construction-intent';

const quote: UpgradePreview = { siteId: 'cell', buildingId: 'house', code: 'dwelling', name: 'Maison',
  level: 1, nextLevel: 2, costs: [{ resourceCode: 'wood', amount: 80 }], durationSeconds: 60, error: null };
it('requires the displayed target, level and costs before upgrading', () => {
  expect(sameUpgradeQuote(null, quote)).toBe(false);
  expect(sameUpgradeQuote(quote, { ...quote, buildingId: 'other-house' })).toBe(false);
  expect(sameUpgradeQuote(quote, { ...quote, nextLevel: 3 })).toBe(false);
  expect(sameUpgradeQuote(quote, { ...quote, costs: [{ resourceCode: 'wood', amount: 90 }] })).toBe(false);
  expect(sameUpgradeQuote(quote, { ...quote, error: 'En travaux' })).toBe(false);
  expect(sameUpgradeQuote(quote, structuredClone(quote))).toBe(true);
});

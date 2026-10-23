import { expect, it } from 'vitest';
import { formatResourceAmount, projectedWood } from './resource-counter';

it('projects the wood counter from the accepted snapshot, including fractional production', () => {
  const at = '2026-10-19T12:00:00Z',
    epoch = Date.parse(at);
  const village = { wood: 100.5, woodProductionPerHour: 1800 };
  expect(projectedWood(village, at, epoch)).toBe(100);
  expect(projectedWood(village, at, epoch + 1000)).toBe(101);
  expect(projectedWood(village, at, epoch + 3000)).toBe(102);
  expect(village.wood).toBe(100.5);
});

it('never extrapolates backwards and adopts a newer debit or stopped production', () => {
  const epoch = Date.parse('2026-10-19T12:00:00Z');
  expect(projectedWood({ wood: 25, woodProductionPerHour: 3600 }, new Date(epoch).toISOString(), epoch - 1000)).toBe(
    25,
  );
  expect(
    projectedWood({ wood: 5, woodProductionPerHour: 3600 }, new Date(epoch + 2000).toISOString(), epoch + 3000),
  ).toBe(6);
  expect(projectedWood({ wood: 5, woodProductionPerHour: 0 }, new Date(epoch).toISOString(), epoch + 3000)).toBe(5);
});

it('keeps French integer formatting for counters and floating resource deltas', () => {
  for (const amount of [0, 1.99, 1000, 1234567.89])
    expect(formatResourceAmount(amount)).toBe(Math.floor(amount).toLocaleString('fr-FR'));
});

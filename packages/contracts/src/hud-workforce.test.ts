import { expect, it } from 'vitest';
import { extractionPoolCaps, hudWorkforceConfirmationIsValid } from './hud-workforce.js';
import { hudWorkforceConfirmationV2IsValid } from './sync-v2.js';
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

it('confirms a HUD gesture on V2 with its result alone: no scoped state, no COUNT revision', () => {
  const ack = {
    protocol: 2,
    worldId: '11111111-1111-4111-8111-111111111111',
    villageId: '22222222-2222-4222-8222-222222222222',
    commandId: '33333333-3333-4333-8333-333333333333',
    status: 'applied',
    commandTime: '2026-11-01T12:00:00.000Z',
    result: { affected: 10, carrots: 0 },
  };
  expect(hudWorkforceConfirmationV2IsValid(ack)).toBe(true);
  expect(hudWorkforceConfirmationV2IsValid({ ...ack, effects: undefined })).toBe(true);
  // The historical answer's fields are not part of the V2 one.
  expect(hudWorkforceConfirmationV2IsValid({ ...ack, minimumRevision: 4 })).toBe(false);
  expect(hudWorkforceConfirmationV2IsValid({ ...ack, hud: {} })).toBe(false);
  expect(hudWorkforceConfirmationV2IsValid({ ...ack, result: { affected: -1, carrots: 0 } })).toBe(false);
  expect(hudWorkforceConfirmationV2IsValid({ ...ack, result: undefined })).toBe(false);
  expect(hudWorkforceConfirmationIsValid(ack)).toBe(false);
});

import { expect, it } from 'vitest';
import { emptyInfrastructure, type InfrastructurePlan, type RoadStroke } from './infrastructure.js';
import {
  infrastructureConfirmation,
  infrastructureConfirmationIsValid,
  applyInfrastructureConfirmation,
} from './infrastructure-confirmation.js';
const metadata = {
  worldId: '10000000-0000-4000-8000-000000000001',
  villageId: '10000000-0000-4000-8000-000000000002',
  commandId: '10000000-0000-4000-8000-000000000003',
  commandTime: '2026-10-11T18:00:00.000Z',
};
const quote = { stoneUnits: 0, stoneDebit: 0, woodDebit: 0, reserveAfter: 0 };
const road = (id: string): RoadStroke => ({
  id,
  points: [
    { x: 80, y: 80 },
    { x: 96, y: 80 },
  ],
  width: 4,
  material: 'earth',
  border: false,
  operation: 'paint',
});
function plans() {
  const before: InfrastructurePlan = {
    ...emptyInfrastructure(),
    revision: 20,
    roads: Array.from({ length: 20 }, (_, i) => road('previous-' + i)),
    inheritedRoads: [road('automatic-captured')],
    inheritedCells: ['10:10'],
  };
  const after = {
    ...before,
    revision: 21,
    roads: [...before.roads, road(metadata.commandId)],
    inheritedCells: [...before.inheritedCells!, '11:10'],
  };
  return { before, after };
}
it('confirms only committed road changes without a village snapshot or a global revision', () => {
  const { before, after } = plans(),
    confirmation = infrastructureConfirmation(metadata, before, after, quote);
  expect(infrastructureConfirmationIsValid(confirmation)).toBe(true);
  expect(confirmation.changes.find((c) => c.kind === 'entities' && c.path[0] === 'roads')).toMatchObject({
    upsert: [road(metadata.commandId)],
    remove: [],
  });
  expect(JSON.stringify(confirmation).length).toBeLessThan(JSON.stringify(after).length / 2);
  expect(confirmation).not.toHaveProperty('syncRevision');
  expect(confirmation).not.toHaveProperty('state');
  const result = applyInfrastructureConfirmation(before, confirmation);
  expect(result.kind).toBe('applied');
  if (result.kind !== 'applied') throw Error('Expected accepted road');
  expect(result.plan).toEqual(after);
  expect(result.plan.equipment).toBe(before.equipment);
  expect(result.plan.inheritedRoads).toBe(before.inheritedRoads);
  expect(before.roads).toHaveLength(20);
  expect(before.revision).toBe(20);
  expect(applyInfrastructureConfirmation(result.plan, confirmation).kind).toBe('ignored');
});
it('ignores a no-op and covered retry but requests recovery for an infrastructure gap', () => {
  const { before, after } = plans(),
    confirmation = infrastructureConfirmation(metadata, before, after, quote);
  const noop = infrastructureConfirmation(metadata, before, before, quote);
  expect(noop.changes).toEqual([]);
  expect(applyInfrastructureConfirmation(before, noop).kind).toBe('ignored');
  expect(applyInfrastructureConfirmation({ ...after, revision: 22 }, confirmation).kind).toBe('ignored');
  expect(applyInfrastructureConfirmation({ ...before, revision: 19 }, confirmation).kind).toBe('resync');
  expect(() => infrastructureConfirmation(metadata, before, { ...after, revision: 20 }, quote)).toThrow(
    'Invalid infrastructure confirmation revisions',
  );
});
it('rejects malformed partial confirmations without changing the plan or its revision', () => {
  const { before, after } = plans(),
    original = structuredClone(before),
    confirmation = infrastructureConfirmation(metadata, before, after, quote);
  expect(
    applyInfrastructureConfirmation(before, {
      ...confirmation,
      changes: [...confirmation.changes, { kind: 'set', path: ['stoneReserve'], value: -1 }],
    }).kind,
  ).toBe('resync');
  expect(applyInfrastructureConfirmation(before, { ...confirmation, toRevision: 22 }).kind).toBe('resync');
  expect(
    applyInfrastructureConfirmation(before, {
      ...confirmation,
      changes: [...confirmation.changes, { kind: 'set', path: ['__proto__'], value: {} }],
    }).kind,
  ).toBe('resync');
  expect(before).toEqual(original);
});
it('applies a confirmed undo including removals and restored inherited capture', () => {
  const { before, after } = plans(),
    restored = { ...before, revision: 22 };
  const confirmation = infrastructureConfirmation(metadata, after, restored, quote),
    result = applyInfrastructureConfirmation(after, confirmation);
  expect(result.kind).toBe('applied');
  if (result.kind === 'applied') expect(result.plan).toEqual(restored);
  expect(confirmation.changes.find((c) => c.kind === 'entities' && c.path[0] === 'roads')).toMatchObject({
    upsert: [],
    remove: ['id:' + metadata.commandId],
  });
});

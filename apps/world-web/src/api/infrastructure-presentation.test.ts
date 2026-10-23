import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  emptyInfrastructure,
  infrastructureConfirmation,
  prepareInfrastructureEdit,
  type VillageState,
} from '@arbestra/contracts';
import {
  acceptInfrastructurePresentation,
  currentInfrastructurePresentation,
  infrastructurePresentationState,
} from './infrastructure-presentation';

it('keeps a confirmed infrastructure plan through older SSE state without advancing the village revision', () => {
  const state = JSON.parse(
    readFileSync(new URL('../../../../tests/fixtures/village-sync-state.json', import.meta.url), 'utf8'),
  ) as VillageState;
  state.infrastructure = { ...emptyInfrastructure(), revision: 12 };
  const before = structuredClone(state),
    road = {
      id: '00000000-0000-4000-8000-000000000010',
      operation: 'paint' as const,
      material: 'earth' as const,
      width: 4,
      border: false,
      points: [
        { x: 512, y: 528 },
        { x: 528, y: 528 },
      ],
    };
  const after = { ...state.infrastructure, roads: [road], revision: 13 },
    quote = { stoneUnits: 0, stoneDebit: 0, woodDebit: 0, reserveAfter: 0 };
  const confirmation = infrastructureConfirmation(
    { worldId: state.world.id, villageId: state.village.id, commandId: road.id, commandTime: state.serverTime },
    state.infrastructure,
    after,
    quote,
  );
  const accepted = acceptInfrastructurePresentation(state, null, confirmation, 3, 3);
  expect(accepted.kind).toBe('applied');
  if (accepted.kind !== 'applied') throw Error('Rejected confirmation');
  expect(state).toEqual(before);
  const shown = infrastructurePresentationState(state, accepted.presentation);
  expect(shown.infrastructure).toEqual(after);
  expect(shown.syncRevision).toBe(state.syncRevision);
  expect(shown.serverTime).toBe(state.serverTime);
  expect(shown.village).toBe(state.village);
  expect(
    currentInfrastructurePresentation({ ...state, serverTime: '2026-10-10T19:00:00.000Z' }, accepted.presentation),
  ).toBe(accepted.presentation);
  // The next real Tools preparation reads the displayed confirmed component, before SSE arrives.
  const next = {
    kind: 'road' as const,
    stroke: {
      ...road,
      id: 'preview',
      points: [
        { x: 528, y: 528 },
        { x: 544, y: 528 },
      ],
    },
  };
  const prepared = prepareInfrastructureEdit(shown, next, 'next-command');
  expect(prepared.next.roads).toHaveLength(2);
  expect(shown.infrastructure!.revision).toBe(confirmation.toRevision);
  expect(acceptInfrastructurePresentation(state, accepted.presentation, confirmation, 3, 3).kind).toBe('ignored');
  expect(currentInfrastructurePresentation({ ...state, infrastructure: after }, accepted.presentation)).toBeNull();
  expect(
    infrastructurePresentationState({ ...state, infrastructure: after }, accepted.presentation).infrastructure,
  ).toBe(after);
  expect(
    currentInfrastructurePresentation({ ...state, infrastructure: { ...after, revision: 14 } }, accepted.presentation),
  ).toBeNull();
  expect(acceptInfrastructurePresentation(state, null, confirmation, 2, 3).kind).toBe('ignored');
  expect(
    acceptInfrastructurePresentation(
      { ...state, village: { ...state.village, id: 'another-village' } },
      null,
      confirmation,
      3,
      3,
    ).kind,
  ).toBe('ignored');
  expect(
    currentInfrastructurePresentation(
      { ...state, world: { ...state.world, id: 'another-world' } },
      accepted.presentation,
    ),
  ).toBeNull();
  const later = infrastructureConfirmation(
    { ...confirmation, commandId: '00000000-0000-4000-8000-000000000012' },
    after,
    { ...after, revision: 14, roads: [...after.roads, { ...road, id: 'later' }] },
    quote,
  );
  expect(acceptInfrastructurePresentation(state, null, later, 3, 3).kind).toBe('resync');
});

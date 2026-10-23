import { expect, it } from 'vitest';
import {
  applySyncV2Batch,
  SYNC_V2_PRIVATE_COMPONENTS,
  type ProcessingOrder,
  type SyncV2State,
} from '@arbestra/contracts';
import {
  footprintsKnown,
  presentationReadNeeded,
  presentationWithPlacement,
  processingCommandBuilding,
  processingOrdersV2,
} from './processing-v2';
import type { ResolvedVillagePresentation } from '@arbestra/contracts';

const worldId = '11111111-1111-4111-8111-111111111111',
  villageId = '22222222-2222-4222-8222-222222222222';
const epoch = '33333333-3333-4333-8333-333333333333',
  building = '44444444-4444-4444-8444-444444444444';
const order = (id: string, createdAt: string, status: ProcessingOrder['status']): ProcessingOrder => ({
  id,
  buildingId: building,
  status,
  blockedReason: null,
  requestedLots: 2,
  completedLots: 0,
  workerCount: 1,
  createdAt,
  finishedAt: null,
  currentLot: null,
});
const older = order('55555555-5555-4555-8555-555555555555', '2026-10-22T00:00:00.000Z', 'completed');
const newer = order('66666666-6666-4666-8666-666666666666', '2026-10-22T00:05:00.000Z', 'running');

it('projects visible workshop orders newest first, with acknowledged effects over the base', () => {
  const empty: SyncV2State = { worldId, villageId, generation: 1, scopes: new Map() };
  const snapshot = applySyncV2Batch(empty, {
    protocol: 2,
    worldId,
    villageId,
    generation: 1,
    observedAt: '2026-10-22T00:06:00Z',
    coverage: 'scope-snapshot',
    groups: [
      {
        stream: { kind: 'village', key: villageId, epoch },
        fromRevision: '0',
        toRevision: '3',
        changes: SYNC_V2_PRIVATE_COMPONENTS.map((component) => ({
          component,
          upsert: component === 'processingOrders' ? [older, newer] : [],
          remove: [],
        })),
      },
    ],
  } as never);
  expect(snapshot.kind).toBe('applied');
  expect(processingOrdersV2(snapshot.state)).toEqual([newer, older]);
  const paused = { ...newer, status: 'pause-requested' as const };
  const acknowledged = applySyncV2Batch(snapshot.state, {
    protocol: 2,
    worldId,
    villageId,
    generation: 1,
    observedAt: '2026-10-22T00:06:01Z',
    coverage: 'effects',
    groups: [
      {
        stream: { kind: 'village', key: villageId, epoch },
        fromRevision: '4',
        toRevision: '4',
        changes: [{ component: 'processingOrders', upsert: [paused], remove: [] }],
      },
    ],
  });
  expect(acknowledged.kind).toBe('applied');
  const orders = processingOrdersV2(acknowledged.state);
  expect(orders).toEqual([paused, older]);
  expect(orders[1]).toBe(processingOrdersV2(snapshot.state)[1]);
  expect(processingOrdersV2(empty)).toEqual([]);
});

it('locates the workshop of a command through its order', () => {
  expect(
    processingCommandBuilding(
      { commandId: epoch, action: 'start', buildingId: building, durationSeconds: 3600, workerCount: 1 },
      [],
    ),
  ).toBe(building);
  expect(processingCommandBuilding({ commandId: epoch, action: 'pause', orderId: newer.id }, [older, newer])).toBe(
    building,
  );
  expect(processingCommandBuilding({ commandId: epoch, action: 'pause', orderId: epoch }, [older])).toBeNull();
});

it('shows a confirmed placement with the server roles and leaves gardens and unknown cells to the presentation read', () => {
  const cell = (cellX: number, cellY: number) => ({
    cellX,
    cellY,
    canBuild: true,
    footprint: null,
    displaysBuilding: false,
  });
  const presentation = {
    cells: [cell(1, 1), cell(2, 1), cell(3, 1)],
    version: 'v',
  } as unknown as ResolvedVillagePresentation;
  const buildingId = '00000000-0000-4000-8000-000000000001';
  const placed = presentationWithPlacement(presentation, {
    buildingId,
    buildingType: 'stonemason',
    anchor: { cellX: 1, cellY: 1 },
    cells: [
      { cellX: 1, cellY: 1 },
      { cellX: 2, cellY: 1 },
    ],
  })!;
  expect(placed.cells).toEqual([
    {
      cellX: 1,
      cellY: 1,
      canBuild: false,
      displaysBuilding: true,
      footprint: { buildingId, buildingType: 'stonemason', role: 'anchor', state: 'reserved' },
    },
    {
      cellX: 2,
      cellY: 1,
      canBuild: false,
      displaysBuilding: false,
      footprint: { buildingId, buildingType: 'stonemason', role: 'extension', state: 'reserved' },
    },
    cell(3, 1),
  ]);
  expect(placed.version).toBe('v');
  expect(presentation.cells[0]).toEqual(cell(1, 1));
  expect(
    presentationWithPlacement(presentation, {
      buildingId,
      buildingType: 'garden',
      anchor: { cellX: 1, cellY: 1 },
      cells: [{ cellX: 1, cellY: 1 }],
    }),
  ).toBeNull();
  expect(
    presentationWithPlacement(presentation, {
      buildingId,
      buildingType: 'dwelling',
      anchor: { cellX: 9, cellY: 9 },
      cells: [{ cellX: 9, cellY: 9 }],
    }),
  ).toBeNull();
});

it('rereads the presentation once per structural revision, not again for the stream echo of an acknowledged command', () => {
  const group = (component: string, toRevision: string) => ({
    stream: { kind: 'village', key: 'v', epoch: 'e' },
    fromRevision: toRevision,
    toRevision,
    changes: [{ component, upsert: [{ id: 'x' }], remove: [] }],
  });
  const batch = (coverage: string, ...groups: unknown[]) =>
    ({ coverage, groups }) as unknown as Parameters<typeof presentationReadNeeded>[0];
  // The ACK of a placement at revision 7 triggers a read covering 7.
  expect(presentationReadNeeded(batch('effects', group('buildings', '7')), null)).toEqual({
    needed: true,
    through: 7n,
  });
  // The same commit delivered by the stream needs no second read.
  expect(presentationReadNeeded(batch('delta', group('buildings', '7')), 7n)).toEqual({ needed: false, through: null });
  // A later structural change does; economic changes never do.
  expect(presentationReadNeeded(batch('delta', group('buildings', '8')), 7n)).toEqual({ needed: true, through: 8n });
  expect(presentationReadNeeded(batch('delta', group('resources', '9')), 7n)).toEqual({ needed: false, through: null });
  // A scope snapshot always rereads and restarts the coverage.
  expect(presentationReadNeeded(batch('scope-snapshot'), 7n)).toEqual({ needed: true, through: null });
});

it('shows a state at once only when every building already has its footprint', () => {
  const village = '22222222-2222-4222-8222-222222222222',
    known = '00000000-0000-4000-8000-0000000000aa',
    fresh = '00000000-0000-4000-8000-0000000000bb';
  const state = (ids: string[]) =>
    ({
      scopes: new Map([
        [
          `village:${village}`,
          {
            epoch: 'e',
            revision: '1',
            base: new Map(ids.map((id) => [`buildings:${id}`, { id }])),
            effects: new Map(),
          },
        ],
      ]),
    }) as unknown as Parameters<typeof footprintsKnown>[0];
  const presentation = {
    cells: [
      {
        cellX: 1,
        cellY: 1,
        canBuild: false,
        displaysBuilding: true,
        footprint: { buildingId: known, buildingType: 'dwelling', role: 'anchor', state: 'active' },
      },
    ],
  } as unknown as ResolvedVillagePresentation;
  // An upgrade of a placed building: shown before the reread.
  expect(footprintsKnown(state([known]), village, presentation)).toBe(true);
  // A new building without its footprint yet: wait for the presentation.
  expect(footprintsKnown(state([known, fresh]), village, presentation)).toBe(false);
});

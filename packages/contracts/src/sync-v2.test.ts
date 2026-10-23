import { expect, it } from 'vitest';
import { applySyncV2Batch, visibleSyncV2Scope, type SyncV2Batch, type SyncV2State } from './sync-v2.js';
import { SYNC_V2_SPATIAL_COMPONENTS } from './sync-v2-spatial.js';

const worldId = '11111111-1111-4111-8111-111111111111',
  villageId = '22222222-2222-4222-8222-222222222222';
const epoch = '33333333-3333-4333-8333-333333333333';
const key = `village:${villageId}`;
const empty = (): SyncV2State => ({ worldId, villageId, generation: 1, scopes: new Map() });
const resource = (amount: number) => ({
  code: 'wood',
  displayName: 'Bois',
  iconKey: 'wood',
  amount,
  productionPerHour: 0,
  productionUpdatedAt: '2026-10-21T12:00:00.000Z',
});
function batch(coverage: SyncV2Batch['coverage'], from: string, to: string, amount = 100): SyncV2Batch {
  return {
    protocol: 2,
    worldId,
    villageId,
    generation: 1,
    observedAt: '2026-10-21T12:00:00.000Z',
    coverage,
    groups: [
      {
        stream: { kind: 'village', key: villageId, epoch },
        fromRevision: from,
        toRevision: to,
        changes: [
          { component: 'resources', upsert: [resource(amount)], remove: [] },
          ...(coverage === 'scope-snapshot'
            ? [
                { component: 'processingOrders' as const, upsert: [], remove: [] },
                { component: 'cohorts' as const, upsert: [], remove: [] },
                { component: 'populationSummary' as const, upsert: [], remove: [] },
                { component: 'restHousing' as const, upsert: [], remove: [] },
                { component: 'buildings' as const, upsert: [], remove: [] },
                { component: 'accomplishments' as const, upsert: [], remove: [] },
                { component: 'extractionPools' as const, upsert: [], remove: [] },
                { component: 'gardenPlots' as const, upsert: [], remove: [] },
                { component: 'gardenHarvests' as const, upsert: [], remove: [] },
                { component: 'buildingExpansions' as const, upsert: [], remove: [] },
                { component: 'extractions' as const, upsert: [], remove: [] },
                { component: 'worksites' as const, upsert: [], remove: [] },
                { component: 'exploitationOrders' as const, upsert: [], remove: [] },
                { component: 'levelingJobs' as const, upsert: [], remove: [] },
                { component: 'marketExchanges' as const, upsert: [], remove: [] },
                { component: 'tradeOffers' as const, upsert: [], remove: [] },
                { component: 'tradeJourneys' as const, upsert: [], remove: [] },
                { component: 'scienceActivities' as const, upsert: [], remove: [] },
                { component: 'scienceContributions' as const, upsert: [], remove: [] },
                { component: 'identity' as const, upsert: [], remove: [] },
                { component: 'infrastructure' as const, upsert: [], remove: [] },
                { component: 'installation' as const, upsert: [], remove: [] },
              ]
            : []),
        ],
      },
    ],
  };
}
function apply(state: SyncV2State, value: SyncV2Batch) {
  const result = applySyncV2Batch(state, value);
  expect(['applied', 'ignored']).toContain(result.kind);
  return result.state;
}
const initial = () => apply(empty(), batch('scope-snapshot', '0', '40'));
const amount = (state: SyncV2State) =>
  (visibleSyncV2Scope(state.scopes.get(key)!).get('resources:wood') as { amount: number }).amount;

it('keeps ACK effects above a complete base without skipping intervening deltas', () => {
  let state = initial();
  state = apply(state, batch('effects', '40', '43', 75));
  expect(state.scopes.get(key)!.revision).toBe('40');
  state = apply(state, batch('delta', '40', '42', 90));
  expect(amount(state)).toBe(75);
  expect(state.scopes.get(key)!.revision).toBe('42');
  state = apply(state, batch('delta', '42', '43', 75));
  expect(state.scopes.get(key)!.effects.size).toBe(0);
  expect(amount(state)).toBe(75);
});
it('ignores delayed ACKs after SSE and two inverted ACKs, including bigint revisions', () => {
  let state = apply(empty(), batch('scope-snapshot', '0', '9007199254740992'));
  state = apply(state, batch('effects', '9007199254740992', '9007199254740994', 50));
  state = apply(state, batch('effects', '9007199254740992', '9007199254740993', 75));
  expect(amount(state)).toBe(50);
  state = apply(state, batch('delta', '9007199254740992', '9007199254740994', 50));
  state = apply(state, batch('effects', '9007199254740992', '9007199254740993', 75));
  expect(amount(state)).toBe(50);
  expect(state.scopes.get(key)!.revision).toBe('9007199254740994');
});
it('rejects a hole, a new epoch without snapshot and a partial snapshot without changing anything', () => {
  const state = initial();
  for (const message of [
    batch('delta', '41', '42'),
    batch('effects', '40', '41'),
    batch('scope-snapshot', '0', '42'),
  ]) {
    if (message.coverage === 'effects') message.groups[0]!.stream.epoch = worldId;
    if (message.coverage === 'scope-snapshot') message.groups[0]!.changes.pop();
    expect(applySyncV2Batch(state, message)).toEqual({ kind: 'resync', state });
  }
  expect(amount(state)).toBe(100);
});
it('validates the entire batch before publication, including duplicated entity keys', () => {
  const state = initial(),
    message = batch('delta', '40', '41', 75);
  message.groups[0]!.changes.push({ component: 'resources', upsert: [], remove: ['wood'] });
  expect(applySyncV2Batch(state, message)).toEqual({ kind: 'resync', state });
  expect(amount(state)).toBe(100);
});
it('keeps deletion tombstones over an older delta and accepts reappearance', () => {
  let state = initial();
  const removed = batch('effects', '40', '42');
  removed.groups[0]!.changes = [{ component: 'resources', upsert: [], remove: ['wood'] }];
  state = apply(state, removed);
  state = apply(state, batch('delta', '40', '41', 80));
  expect(visibleSyncV2Scope(state.scopes.get(key)!).has('resources:wood')).toBe(false);
  state = apply(state, batch('delta', '41', '43', 20));
  expect(amount(state)).toBe(20);
});
it('ignores old subscription generations and other contexts', () => {
  const state = initial();
  expect(applySyncV2Batch(state, { ...batch('delta', '40', '41'), generation: 0 })).toEqual({ kind: 'ignored', state });
  expect(applySyncV2Batch(state, { ...batch('delta', '40', '41'), worldId: villageId })).toEqual({
    kind: 'ignored',
    state,
  });
});
it('rejects malformed covered data, out-of-range bigint and an unsolicited epoch replacement', () => {
  const state = initial();
  const duplicate = batch('delta', '38', '39');
  duplicate.groups[0]!.changes.push({ component: 'resources', upsert: [], remove: ['wood'] });
  const epochReplacement = batch('scope-snapshot', '0', '1');
  epochReplacement.groups[0]!.stream.epoch = worldId;
  for (const message of [duplicate, epochReplacement, batch('effects', '40', '9223372036854775808')])
    expect(applySyncV2Batch(state, message)).toEqual({ kind: 'resync', state });
});
it('applies private and subscribed spatial groups atomically, including a covered companion group', () => {
  const snapshot = batch('scope-snapshot', '0', '40');
  const spatial = {
    stream: { kind: 'spatial' as const, key: '0,0', epoch },
    fromRevision: '0',
    toRevision: '10',
    changes: SYNC_V2_SPATIAL_COMPONENTS.map((component) => ({ component, upsert: [], remove: [] })),
  };
  snapshot.groups.push(spatial);
  let state = apply({ ...empty(), subscribedScopes: new Set(['spatial:0,0']) }, snapshot);
  const delta = batch('delta', '40', '41', 75);
  delta.groups.push({
    ...spatial,
    fromRevision: '10',
    toRevision: '11',
    changes: [{ component: 'spatialCells', upsert: [{ id: '1,2', cellX: 1, cellY: 2, occupied: true }], remove: [] }],
  });
  state = apply(state, delta);
  expect(state.scopes.get('spatial:0,0')!.revision).toBe('11');
  expect(amount(state)).toBe(75);
  const covered = batch('delta', '40', '41', 75);
  covered.groups.push({
    ...delta.groups[1]!,
    fromRevision: '11',
    toRevision: '12',
    changes: [{ component: 'spatialCells', upsert: [], remove: ['1,2'] }],
  });
  state = apply(state, covered);
  expect(state.scopes.get(key)!.revision).toBe('41');
  expect(state.scopes.get('spatial:0,0')!.revision).toBe('12');
  expect(visibleSyncV2Scope(state.scopes.get('spatial:0,0')!).has('spatialCells:1,2')).toBe(false);
  const hole = batch('delta', '41', '42', 50);
  hole.groups.push({ ...delta.groups[1]!, fromRevision: '13', toRevision: '14' });
  expect(applySyncV2Batch(state, hole)).toEqual({ kind: 'resync', state });
  expect(amount(state)).toBe(75);
  const incompatible = batch('delta', '39', '40', 90);
  incompatible.groups.push({ ...delta.groups[1]!, fromRevision: '12', toRevision: '13' });
  expect(applySyncV2Batch(state, incompatible)).toEqual({ kind: 'resync', state });
});
it('rejects components in the wrong stream and spatial scopes outside the subscription', () => {
  const state = initial(),
    message = batch('delta', '40', '41');
  message.groups[0]!.changes = [{ component: 'spatialCells', upsert: [], remove: [] }];
  expect(applySyncV2Batch(state, message)).toEqual({ kind: 'resync', state });
  message.groups[0]!.stream = { kind: 'spatial', key: '0,0', epoch };
  expect(applySyncV2Batch(state, message)).toEqual({ kind: 'resync', state });
});

import { expect, it } from 'vitest';
import {
  SYNC_V2_PRIVATE_COMPONENTS,
  visibleSyncV2Scope,
  type SyncV2Batch,
  type SyncV2State,
} from '@arbestra/contracts';
import { SyncV2Session, SyncV2ResyncRequired, SyncV2SessionExpired } from './sync-v2-session';

const worldId = '11111111-1111-4111-8111-111111111111',
  villageId = '22222222-2222-4222-8222-222222222222';
const epoch = '33333333-3333-4333-8333-333333333333',
  scope = `village:${villageId}`;
function batch(coverage: SyncV2Batch['coverage'], from: string, to: string, amount = 100): SyncV2Batch {
  const changes: SyncV2Batch['groups'][number]['changes'] = [
    {
      component: 'resources',
      upsert: [
        { code: 'wood', displayName: 'Bois', iconKey: 'wood', amount, productionPerHour: 0, productionUpdatedAt: null },
      ],
      remove: [],
    },
  ];
  if (coverage === 'scope-snapshot')
    for (const component of SYNC_V2_PRIVATE_COMPONENTS)
      if (component !== 'resources') changes.push({ component, upsert: [], remove: [] });
  return {
    protocol: 2,
    worldId,
    villageId,
    generation: 1,
    observedAt: '2026-10-21T12:00:00Z',
    coverage,
    groups: [{ stream: { kind: 'village', key: villageId, epoch }, fromRevision: from, toRevision: to, changes }],
  };
}
const initial = (): SyncV2State => ({ worldId, villageId, generation: 1, scopes: new Map() });
function response(wire: string) {
  return new Response(new TextEncoder().encode(wire), { headers: { 'content-type': 'text/event-stream' } });
}
const frame = (value: SyncV2Batch) => `event: batch\nid: not-an-applied-cursor\ndata: ${JSON.stringify(value)}\n\n`;

it('reconnects from applied complete state after an ACK, SSE and a truncated event', async () => {
  const requests: unknown[] = [];
  const responses = [
    response(frame(batch('delta', '40', '41', 90)) + frame(batch('delta', '41', '42', 80)).slice(0, -1)),
    response(frame(batch('delta', '41', '43', 75))),
  ];
  const session = new SyncV2Session(
    initial(),
    () => undefined,
    async (_url, options) => {
      requests.push(JSON.parse(String(options?.body)));
      return responses.shift()!;
    },
  );
  session.apply(batch('scope-snapshot', '0', '40'));
  session.apply(batch('effects', '40', '43', 75));
  await session.connect('/sync/stream');
  expect(session.cursors[0]?.revision).toBe('41');
  expect(visibleSyncV2Scope(session.snapshot.scopes.get(scope)!).get('resources:wood')).toMatchObject({ amount: 75 });
  await session.connect('/sync/stream');
  expect(requests).toMatchObject([{ cursors: [{ revision: '40' }] }, { cursors: [{ revision: '41' }] }]);
  expect(session.cursors[0]?.revision).toBe('43');
  expect(session.snapshot.scopes.get(scope)!.effects.size).toBe(0);
});
it('keeps canonical state unchanged after an invalid delta and requests recovery', async () => {
  const session = new SyncV2Session(
    initial(),
    () => undefined,
    async () => response(frame(batch('delta', '41', '42'))),
  );
  session.apply(batch('scope-snapshot', '0', '40'));
  const before = session.snapshot;
  await expect(session.connect('/sync/stream')).rejects.toBeInstanceOf(SyncV2ResyncRequired);
  expect(session.snapshot).toBe(before);
});
it.each(['http', 'event'])(
  'reports expired authorization through %s without changing applied cursors',
  async (transport) => {
    const session = new SyncV2Session(
      initial(),
      () => undefined,
      async () =>
        transport === 'http' ? new Response(null, { status: 401 }) : response('event: expired\ndata: {}\n\n'),
    );
    session.apply(batch('scope-snapshot', '0', '40'));
    const before = session.snapshot;
    await expect(session.connect('/sync/stream')).rejects.toBeInstanceOf(SyncV2SessionExpired);
    expect(session.snapshot).toBe(before);
    expect(session.cursors[0]?.revision).toBe('40');
  },
);
it('aborts a pending socket and rejects callbacks from a closed generation', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const session = new SyncV2Session(
    initial(),
    () => undefined,
    async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
  );
  session.apply(batch('scope-snapshot', '0', '40'));
  const pending = session.connect('/sync/stream');
  await Promise.resolve();
  session.close();
  await pending;
  expect(cancelled).toBe(true);
  expect(session.apply(batch('delta', '40', '41'))).toBe('ignored');
  expect(session.cursors[0]?.revision).toBe('40');
});

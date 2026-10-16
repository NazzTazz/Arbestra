import { setImmediate } from 'node:timers/promises';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, expect, it, vi } from 'vitest';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/schema.js';
import type { AppConfig } from '../../config.js';
import type { ExpeditionWakeups } from '../science/expedition-wakeups.js';
import { registerVillageSync } from './sync.js';

const calls = vi.hoisted(() => ({
  authenticate: vi.fn(), ownedVillage: vi.fn(), readVillageProjection: vi.fn(),
  readExpeditionReceipts: vi.fn(), reconcileVillageForRead: vi.fn(),
}));
vi.mock('../auth/service.js', () => ({ authenticate: calls.authenticate }));
vi.mock('./service.js', () => ({ ownedVillage: calls.ownedVillage,
  readVillageProjection: calls.readVillageProjection, reconcileVillageForRead: calls.reconcileVillageForRead }));
vi.mock('../science/expeditions.js', () => ({ readExpeditionReceipts: calls.readExpeditionReceipts }));

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const account = { id: '10000000-0000-4000-8000-000000000001' };
const village = { worldId: '20000000-0000-4000-8000-000000000001', villageId: '30000000-0000-4000-8000-000000000001' };
afterEach(() => vi.resetAllMocks());

it.each(['authentication', 'ownership', 'receipt authentication', 'receipts', 'projection'] as const)(
  'does not start work for a client disconnected during %s', async phase => {
    const entered = barrier(), release = barrier(), disconnected = barrier(), handled = barrier();
    calls.authenticate.mockResolvedValue(account);
    calls.ownedVillage.mockResolvedValue(village);
    calls.readExpeditionReceipts.mockResolvedValue([]);
    const snapshot = { world: { id: village.worldId }, village: { id: village.villageId },
      syncRevision: 0, serverTime: new Date().toISOString(), cells: [] };
    calls.readVillageProjection.mockResolvedValue(snapshot);
    const blocked = async (value: unknown) => { entered.resolve(); await release.promise; return value; };
    if (phase === 'authentication') calls.authenticate.mockImplementationOnce(() => blocked(account));
    if (phase === 'ownership') calls.ownedVillage.mockImplementationOnce(() => blocked(village));
    if (phase === 'receipt authentication') calls.authenticate.mockResolvedValueOnce(account)
      .mockImplementationOnce(() => blocked(account));
    if (phase === 'receipts') calls.readExpeditionReceipts.mockImplementationOnce(() => blocked([]));
    if (phase === 'projection') calls.readVillageProjection.mockImplementationOnce(() => blocked(snapshot));
    const db = { transaction: () => ({ execute: (run: (tx: unknown) => unknown) => run(db) }) } as unknown as Kysely<Database>;
    const unsubscribe = vi.fn(), subscribe = vi.fn(() => unsubscribe);
    const app = Fastify();
    app.addHook('onRequest', async (_request, reply) => { reply.raw.once('close', disconnected.resolve); });
    app.addHook('onRoute', route => {
      const handler = route.handler;
      route.handler = async function(request, reply) {
        try { return await handler.call(this, request, reply); } finally { handled.resolve(); }
      };
    });
    await app.register(cookie);
    await registerVillageSync(app, db, { cookieName: 'test_session' } as AppConfig,
      {network:vi.fn()},
      { subscribe } as unknown as ExpeditionWakeups);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    let expire!: (error: Error) => void;
    const expired = new Promise<never>((_, reject) => { expire = reject; });
    const bounded = <T>(promise: Promise<T>) => Promise.race([promise, expired]);
    const deadline = setTimeout(() => {
      controller.abort(); release.resolve(); expire(Error('SSE lifecycle barrier timed out'));
    }, 5_000);
    const response = fetch(`${base}/api/worlds/test/villages/${village.villageId}/events`, { signal: controller.signal })
      .catch(error => { if (error.name !== 'AbortError') throw error; });
    try {
      await bounded(entered.promise);
      controller.abort();
      // Observe the actual server socket close before releasing the SQL stand-in.
      await bounded(disconnected.promise);
      release.resolve();
      await bounded(handled.promise);
      await setImmediate();
      expect(calls.readVillageProjection).toHaveBeenCalledTimes(phase === 'projection' ? 1 : 0);
      expect(calls.readExpeditionReceipts).toHaveBeenCalledTimes(['receipts', 'projection'].includes(phase) ? 1 : 0);
      if (phase === 'authentication') expect(calls.ownedVillage).not.toHaveBeenCalled();
      if (phase === 'authentication' || phase === 'ownership') expect(subscribe).not.toHaveBeenCalled();
      else expect(unsubscribe).toHaveBeenCalledOnce();
    } finally {
      clearTimeout(deadline); controller.abort(); release.resolve();
      await response; await app.close();
    }
  }, 10_000,
);

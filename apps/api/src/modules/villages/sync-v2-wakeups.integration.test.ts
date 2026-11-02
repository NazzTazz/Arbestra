import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { readServerEvents, type SyncV2Batch, type SyncV2ReadRequest } from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { DEVELOPMENT_IDS as ids } from '../../database/seed.js';
import { hashSessionToken } from '../../security/sessions.js';
import type { TravelNetworkExecutor } from '../navigation/network-job.js';
import { captureSyncV2 } from './sync-v2-capture.js';
import { registerSyncV2Routes } from './sync-v2-routes.js';
import { serveSyncV2Stream } from './sync-v2-stream.js';
import { SYNC_V2_WAKE_CHANNEL, SyncV2Wakeups, type SyncWakeSubscription } from './sync-v2-wakeups.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected wakeup test database');
const db = createDatabase(url),
  hub = new SyncV2Wakeups(url),
  token = randomUUID();
/** Far beyond every bound below: a delivery within them is not a periodic read. */
const NO_BACKSTOP = 60_000;
let probe: SyncWakeSubscription;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(check: () => boolean, ms: number, label: string) {
  const deadline = performance.now() + ms;
  while (!check()) {
    if (performance.now() > deadline) throw Error(`Timed out: ${label}`);
    await sleep(5);
  }
}
async function bounded<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(Error(`Timed out: ${label}`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function barrier() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

async function villageCursor() {
  return (
    await sql<{ epoch: string; revision: string }>`select epoch::text,revision::text from game_sync_streams
      where world_id=${ids.world} and stream_kind='village' and scope_key=${ids.village}`.execute(db)
  ).rows[0]!;
}
/** An empty business change of each named stream, published and committed
 * by another connection than the listener's. Returns the private stream's
 * revision afterwards. */
async function publish(worldId: string, scopes: Array<[kind: string, key: string]>, entity = 'wood') {
  await db.transaction().execute(async (tx) => {
    for (const [kind, key] of scopes)
      await sql`select game_sync_touch(${worldId}::uuid,${kind},${key},'resources',${entity})`.execute(tx);
    await sql`select game_sync_publish()`.execute(tx);
  });
  return (await villageCursor()).revision;
}
const publishVillage = () => publish(ids.world, [['village', ids.village]]);
/** Fake streams published by a test, with their stored vectors unless a kept
 * row (the private stream's) still references one. */
async function forget(worldId: string, keys: readonly string[]) {
  const batches = (
    await sql<{ batchId: string }>`select distinct dependencies_batch_id::text as "batchId" from game_sync_changes
      where world_id=${worldId} and scope_key=any(${keys}::text[]) and dependencies_batch_id is not null`.execute(db)
  ).rows.map((row) => row.batchId);
  await sql`delete from game_sync_streams where world_id=${worldId} and scope_key=any(${keys}::text[])`.execute(db);
  if (batches.length)
    await sql`delete from game_sync_batches b where world_id=${worldId} and batch_id=any(${batches}::uuid[])
      and not exists(select 1 from game_sync_changes c where c.world_id=b.world_id and c.dependencies_batch_id=b.batch_id)`.execute(
      db,
    );
}

interface Received {
  event: string;
  data: string;
  at: number;
}
/** A real HTTP client of one SSE stream. */
async function client(address: string, path: string, headers: Record<string, string> = {}) {
  const cursor = await villageCursor();
  const abort = new AbortController();
  const events: Received[] = [];
  const body: SyncV2ReadRequest = {
    protocol: 2,
    generation: 1,
    scopes: [{ kind: 'village', key: ids.village }],
    cursors: [{ kind: 'village', key: ids.village, ...cursor }],
  };
  const opening = fetch(address + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: abort.signal,
  });
  let pump: Promise<void> | undefined;
  const opened = opening.then((response) => {
    expect(response.status).toBe(200);
    pump = readServerEvents(response.body!, {
      signal: abort.signal,
      current: () => !abort.signal.aborted,
      onEvent: (event) => events.push({ ...event, at: performance.now() }),
    }).catch((error) => {
      if (!abort.signal.aborted) throw error;
    });
  });
  opened.catch(() => undefined);
  const batches = () =>
    events.filter((event) => event.event === 'batch').map((event) => JSON.parse(event.data) as SyncV2Batch);
  return {
    cursor,
    events,
    opened,
    batches,
    /** Arrival time of the batch reaching this private revision. */
    delivered: (revision: string) =>
      events.find(
        (event) =>
          event.event === 'batch' &&
          (JSON.parse(event.data) as SyncV2Batch).groups.some(
            (group) => group.stream.kind === 'village' && group.toRevision === revision,
          ),
      )?.at,
    close: async () => {
      abort.abort();
      await opened.catch(() => undefined);
      await pump;
    },
  };
}

/** serveSyncV2Stream over the real capture, with a counted and holdable read. */
async function streamServer(
  wakeups: SyncV2Wakeups | undefined,
  pollMs: number,
  hold?: (read: number) => Promise<void> | undefined,
) {
  const app = Fastify(),
    state = { reads: 0 };
  app.post('/stream', async (request, reply) =>
    serveSyncV2Stream(
      reply,
      request.body as SyncV2ReadRequest,
      async (next) => {
        const read = ++state.reads;
        const batch = await captureSyncV2(db, ids.account, 'aube', ids.village, next, { deltaOnly: true });
        // Held after the capture: its snapshot is taken, the read still in flight.
        await hold?.(read);
        return batch;
      },
      { wakeups, pollMs },
    ),
  );
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, address, state };
}

beforeAll(async () => {
  await sql`insert into game_sync_streams(world_id,stream_kind,scope_key) values(${ids.world},'village',${ids.village})
    on conflict do nothing`.execute(db);
  await db
    .insertInto('sessions')
    .values({ accountId: ids.account, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) })
    .execute();
  await hub.start();
  await eventually(() => hub.observation.connected, 10_000, 'listener connected');
  // Wakes the same index entry as the streams under test: once it is dirty,
  // the hub has dispatched that notification to them as well.
  probe = hub.subscribe();
  probe.watch(ids.world, [{ kind: 'village', key: ids.village }]);
}, 30_000);
afterAll(async () => {
  probe?.close();
  await hub.close();
  await db.deleteFrom('sessions').where('tokenHash', '=', hashSessionToken(token)).execute();
  await db.destroy();
});

it('queues one identifier-only notification per world, delivered at commit and never on rollback', async () => {
  const listener = new pg.Client({ connectionString: url }),
    received: string[] = [];
  const otherWorld = randomUUID(),
    neighbour = randomUUID(),
    many = Array.from({ length: 200 }, () => randomUUID());
  listener.on('notification', (message) => {
    if (message.channel === SYNC_V2_WAKE_CHANNEL) received.push(message.payload!);
  });
  await listener.connect();
  try {
    await listener.query(`listen ${SYNC_V2_WAKE_CHANNEL}`);
    await expect(
      db.transaction().execute(async (tx) => {
        await sql`select game_sync_touch(${ids.world}::uuid,'village',${ids.village},'resources','wood')`.execute(tx);
        await sql`select game_sync_publish()`.execute(tx);
        throw Error('rolled back on purpose');
      }),
    ).rejects.toThrow('rolled back on purpose');
    // Two worlds, two entities of the same stream, one neighbour stream.
    await db.transaction().execute(async (tx) => {
      for (const [world, key, entity] of [
        [ids.world, ids.village, 'wood'],
        [ids.world, ids.village, 'stone'],
        [ids.world, neighbour, 'wood'],
        [otherWorld, ids.village, 'wood'],
      ] as const)
        await sql`select game_sync_touch(${world}::uuid,'village',${key},'resources',${entity})`.execute(tx);
      await sql`select game_sync_publish()`.execute(tx);
    });
    await eventually(() => received.length >= 2, 5000, 'committed notifications');
    await sleep(100);
    expect(received).toHaveLength(2);
    const byWorld = new Map(received.map((payload) => [JSON.parse(payload).w as string, JSON.parse(payload)]));
    expect(byWorld.get(ids.world)).toEqual({
      w: ids.world,
      // The vector's canonical order (bytewise keys).
      s: [ids.village, neighbour].sort().map((key) => ['village', key]),
    });
    expect(byWorld.get(otherWorld)).toEqual({ w: otherWorld, s: [['village', ids.village]] });
    // Identifiers only: no component, entity, epoch or revision.
    expect(received.join('\n')).not.toMatch(/resources|wood|stone|epoch|revision/);
    // Beyond the payload bound, the whole world.
    received.length = 0;
    await publish(
      ids.world,
      many.map((key) => ['village', key]),
    );
    await eventually(() => received.length >= 1, 5000, 'world-wide notification');
    expect(received.map((payload) => JSON.parse(payload))).toEqual([{ w: ids.world }]);
  } finally {
    await listener.end();
    await forget(ids.world, [neighbour, ...many]);
    await forget(otherWorld, [ids.village]);
  }
});

it('wakes a stream of the real route on a publication by another connection, long before its backstop', async () => {
  const unusedNavigation: TravelNetworkExecutor = {
    network: async () => {
      throw Error('Presentation is not exercised here');
    },
  };
  const app: FastifyInstance = Fastify();
  await app.register(cookie);
  // The route's own backstop (30 s): not shortened here.
  await registerSyncV2Routes(app, db, { cookieName: 'session' }, unusedNavigation, { wakeups: hub });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const stream = await client(address, `/api/worlds/aube/villages/${ids.village}/sync/stream`, {
    'x-arbestra-protocol': '2',
    cookie: `session=${token}`,
  });
  try {
    await stream.opened;
    await eventually(() => stream.events.length >= 1, 5000, 'opening event');
    const latencies: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const revision = await publishVillage();
      const committed = performance.now();
      await eventually(() => stream.delivered(revision) !== undefined, 5000, `delivery ${attempt}`);
      latencies.push(stream.delivered(revision)! - committed);
    }
    console.info(`sync-v2 wake: commit → SSE batch ${latencies.map((ms) => ms.toFixed(1)).join(', ')} ms`);
    expect(Math.max(...latencies)).toBeLessThan(500);
    expect(stream.events.every((event) => event.event === 'batch' || event.event === 'heartbeat')).toBe(true);
  } finally {
    await stream.close();
    await app.close();
  }
});

it('reads again when a publication commits while a read is in flight', async () => {
  const inRead = barrier(),
    release = barrier();
  const server = await streamServer(hub, NO_BACKSTOP, async (read) => {
    if (read !== 2) return;
    inRead.open();
    await release.opened;
  });
  const stream = await client(server.address, '/stream');
  try {
    await stream.opened;
    await eventually(() => stream.events.length >= 1, 5000, 'opening event');
    const first = await publishVillage();
    await bounded(inRead.opened, 5000, 'second read holding');
    probe.clear();
    const second = await publishVillage();
    await eventually(() => probe.dirty, 5000, 'second publication dispatched during the read');
    release.open();
    await eventually(() => stream.delivered(second) !== undefined, 2000, 'second publication reread');
    // The held read carried the first publication only; the next one, the second.
    expect(stream.batches().map((batch) => batch.groups[0]!.toRevision)).toEqual([first, second]);
    expect(server.state.reads).toBe(3);
  } finally {
    release.open();
    await stream.close();
    await server.app.close();
  }
});

it('keeps a publication committed between the first capture and the subscription index', async () => {
  const inRead = barrier(),
    release = barrier();
  const server = await streamServer(hub, NO_BACKSTOP, async (read) => {
    if (read !== 1) return;
    inRead.open();
    await release.opened;
  });
  const stream = await client(server.address, '/stream');
  try {
    // The opening capture is done (snapshot taken); headers are not sent yet.
    await bounded(inRead.opened, 5000, 'opening capture holding');
    probe.clear();
    const revision = await publishVillage();
    await eventually(() => probe.dirty, 5000, 'publication dispatched before watch()');
    release.open();
    await stream.opened;
    await eventually(() => stream.delivered(revision) !== undefined, 2000, 'publication after the opening capture');
    expect(stream.events[0]!.event).toBe('heartbeat');
    expect(server.state.reads).toBe(2);
  } finally {
    release.open();
    await stream.close();
    await server.app.close();
  }
});

it('wakes only the streams of the published world and scope keys; a world-wide wake sends nothing private', async () => {
  const server = await streamServer(hub, NO_BACKSTOP);
  const stream = await client(server.address, '/stream');
  const otherWorld = randomUUID(),
    neighbour = randomUUID(),
    many = Array.from({ length: 200 }, () => randomUUID());
  const elsewhere = hub.subscribe(),
    nextDoor = hub.subscribe();
  elsewhere.watch(otherWorld, [{ kind: 'village', key: ids.village }]);
  nextDoor.watch(ids.world, [{ kind: 'village', key: neighbour }]);
  try {
    await stream.opened;
    await eventually(() => stream.events.length >= 1, 5000, 'opening event');
    expect(server.state.reads).toBe(1);
    // The same village key in another world, then a neighbour in this world.
    await publish(otherWorld, [['village', ids.village]]);
    await publish(ids.world, [['village', neighbour]]);
    await eventually(() => elsewhere.dirty && nextDoor.dirty, 5000, 'both notifications dispatched');
    await sleep(200);
    expect(server.state.reads).toBe(1);
    expect(stream.events).toHaveLength(1);
    // A transaction beyond the payload bound wakes the whole world: the
    // stream reads, finds no change of its own and sends a heartbeat.
    await publish(
      ids.world,
      many.map((key) => ['village', key]),
    );
    await eventually(() => stream.events.length >= 2, 5000, 'world-wide wake');
    expect(server.state.reads).toBe(2);
    expect(stream.events[1]!.event).toBe('heartbeat');
    const revision = await publishVillage();
    await eventually(() => stream.delivered(revision) !== undefined, 2000, 'own publication');
  } finally {
    elsewhere.close();
    nextDoor.close();
    await stream.close();
    await server.app.close();
    await forget(ids.world, [neighbour, ...many]);
    await forget(otherWorld, [ids.village]);
  }
});

it('reconnects a lost listener and wakes every stream; meanwhile the backstop alone covers the lost notification', async () => {
  const retrying = barrier(),
    release = barrier(),
    errors: unknown[] = [];
  const lossy = new SyncV2Wakeups(url, (error) => errors.push(error), {
    retryDelay: () => {
      retrying.open();
      return release.opened;
    },
  });
  await lossy.start();
  await eventually(() => lossy.observation.connected, 10_000, 'listener connected');
  const slow = await streamServer(lossy, NO_BACKSTOP),
    quick = await streamServer(lossy, 400);
  const waiting = await client(slow.address, '/stream'),
    polling = await client(quick.address, '/stream');
  try {
    await Promise.all([waiting.opened, polling.opened]);
    await eventually(() => waiting.events.length >= 1 && polling.events.length >= 1, 5000, 'opening events');
    const pid = lossy.observation.backendPid!;
    await sql`select pg_terminate_backend(${pid})`.execute(db);
    await bounded(retrying.opened, 5000, 'listener loss detected');
    expect(lossy.observation.connected).toBe(false);
    // Nobody listens in this process: this notification is lost.
    const revision = await publishVillage();
    await eventually(() => polling.delivered(revision) !== undefined, 3000, 'backstop read');
    expect(waiting.delivered(revision)).toBeUndefined();
    expect(slow.state.reads).toBe(1);
    const released = performance.now();
    release.open();
    await eventually(() => waiting.delivered(revision) !== undefined, 2000, 'catch-up wake after reconnection');
    expect(waiting.delivered(revision)! - released).toBeLessThan(1000);
    expect(lossy.observation.connected).toBe(true);
    expect(lossy.observation.backendPid).not.toBe(pid);
    expect(errors.length).toBeGreaterThan(0);
    // The new connection listens: a publication wakes the slow stream again.
    const next = await publishVillage();
    await eventually(() => waiting.delivered(next) !== undefined, 2000, 'wake after reconnection');
  } finally {
    release.open();
    await waiting.close();
    await polling.close();
    await slow.app.close();
    await quick.app.close();
    await lossy.close();
  }
});

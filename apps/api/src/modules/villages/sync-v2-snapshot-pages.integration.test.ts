import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Transaction } from 'kysely';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import {
  applySyncV2Batch,
  applySyncV2SnapshotPages,
  syncV2SnapshotPageIsValid,
  visibleSyncV2Scope,
  SYNC_V2_COMPONENT_LIMITS,
  SYNC_V2_PAGES_HEADER,
  SYNC_V2_SNAPSHOT_PAGE_REFERENCES,
  type SyncV2Batch,
  type SyncV2Change,
  type SyncV2SnapshotPage,
  type SyncV2State,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS as ids } from '../../database/seed.js';
import { hashSessionToken } from '../../security/sessions.js';
import { HttpError } from '../../errors.js';
import { captureSyncV2 } from './sync-v2-capture.js';
import {
  readPrivateScopeReferences,
  readPrivateScopeSnapshot,
  readPrivateScopeSnapshotPage,
  readRegisteredPrivateChanges,
  type SyncSnapshotPosition,
} from './sync-v2-readers.js';
import { registerSyncV2Routes } from './sync-v2-routes.js';
import type { TravelNetworkExecutor } from '../navigation/network-job.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected snapshot pages test database');
const db = createDatabase(url),
  app = Fastify(),
  token = randomUUID(),
  // Readers projected at one fixed instant compare exactly across captures.
  through = new Date('2026-10-21T12:00:00Z'),
  include = ['knowledge', 'manifest', 'traffic'] as const;
const navigation: TravelNetworkExecutor = {
  network: async () => {
    throw Error('Presentation is not exercised here');
  },
};
beforeAll(async () => {
  // The global reset alone takes 26–31 s with the sync triggers active.
  await resetE2eState(url);
  await sql`insert into game_sync_streams(world_id,stream_kind,scope_key) values(${ids.world},'village',${ids.village}),
    (${ids.world},'knowledge',${ids.account}),(${ids.world},'manifest',${ids.world}),(${ids.world},'traffic',${ids.world})
    on conflict do nothing`.execute(db);
  await db
    .insertInto('sessions')
    .values({ accountId: ids.account, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) })
    .execute();
  await app.register(cookie);
  app.setErrorHandler((error, _request, reply) =>
    error instanceof HttpError
      ? reply.status(error.statusCode).send({ code: error.code })
      : reply.status(500).send({ code: 'UNEXPECTED', message: String(error) }),
  );
  await registerSyncV2Routes(app, db, { cookieName: 'session' }, navigation);
  await app.ready();
}, 180000);
afterAll(async () => {
  await app.close();
  await db.deleteFrom('sessions').where('tokenHash', '=', hashSessionToken(token)).execute();
  await db.destroy();
});

const context = { worldId: ids.world, villageId: ids.village, through };
/** One read-only capture at the fixed instant, as each page is. */
const capture = <T>(run: (tx: Transaction<Database>) => Promise<T>) =>
  db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (tx) => {
      await sql`set transaction read only`.execute(tx);
      await sql`select set_config('arbestra.economy_through',${through.toISOString()},true)`.execute(tx);
      return run(tx);
    });
type Entity = SyncV2Change['upsert'][number];
const entityKey = (component: string, entity: Entity) =>
  `${component}:${
    component === 'resources' || component === 'accomplishments'
      ? (entity as { code: string }).code
      : component === 'extractionPools'
        ? (entity as { resource: string }).resource
        : component === 'restHousing'
          ? (entity as { buildingId: string }).buildingId
          : (entity as { id: string }).id
  }`;
const entities = (changes: readonly SyncV2Change[], into = new Map<string, Entity>()) => {
  for (const change of changes)
    for (const entity of change.upsert) {
      const key = entityKey(change.component, entity);
      if (into.has(key)) throw Error(`Duplicate entity ${key}`);
      into.set(key, entity);
    }
  return into;
};
/** The single unbounded read the pages must equal: every reference in one
 * capture, read in slices no reader bound refuses. */
const unboundedRead = () =>
  capture(async (tx) => {
    const byComponent = new Map<string, string[]>();
    for (const reference of await readPrivateScopeReferences(tx, context))
      byComponent.set(reference.component, [...(byComponent.get(reference.component) ?? []), reference.key]);
    const values = new Map<string, Entity>();
    for (const [component, keys] of byComponent)
      for (let index = 0; index < keys.length; index += 128)
        entities(
          await readRegisteredPrivateChanges(
            tx,
            context,
            keys.slice(index, index + 128).map((key) => ({ component, key })),
          ),
          values,
        );
    return { values, references: [...byComponent.values()].reduce((sum, keys) => sum + keys.length, 0) };
  });
const stateFor = (generation: number, groups: SyncV2Batch['groups']): SyncV2State => ({
  worldId: ids.world,
  villageId: ids.village,
  generation,
  scopes: new Map(),
  subscribedScopes: new Set(groups.map((group) => `${group.stream.kind}:${group.stream.key}`)),
});
const pageRequest = (generation: number, after: string) => ({
  protocol: 2 as const,
  generation,
  scopes: [{ kind: 'village' as const, key: ids.village }],
  cursors: [],
  page: { after },
});
/** What a paging client does: first page with the shared scopes, later
 * pages of the private scope, then one catch-up delta from the anchors.
 * `between(n)` runs after page n has been read, before the next request. */
async function pagedLoad(generation: number, between?: (read: number) => Promise<void>) {
  const first = await captureSyncV2(
    db,
    ids.account,
    'aube',
    ids.village,
    { protocol: 2, generation, scopes: [], cursors: [] },
    { include, pages: true },
  );
  if (first.coverage !== 'scope-snapshot-page') throw Error(`Expected a paged snapshot, got ${first.coverage}`);
  const pages: SyncV2SnapshotPage[] = [first];
  for (let next = first.next; next; next = pages.at(-1)!.next) {
    await between?.(pages.length);
    const page = await captureSyncV2(db, ids.account, 'aube', ids.village, pageRequest(generation, next), {
      pages: true,
    });
    if (page.coverage !== 'scope-snapshot-page') throw Error('Expected a snapshot page');
    pages.push(page);
  }
  await between?.(pages.length);
  const delta = await captureSyncV2(
    db,
    ids.account,
    'aube',
    ids.village,
    {
      protocol: 2,
      generation,
      scopes: first.groups.map((group) => ({ kind: group.stream.kind, key: group.stream.key })),
      cursors: first.groups.map((group) => ({ ...group.stream, revision: group.toRevision })),
    },
    { pages: true },
  );
  const applied = applySyncV2SnapshotPages(stateFor(generation, first.groups), pages, delta);
  if (applied.kind !== 'applied') throw Error(`Pages not applied: ${applied.kind}`);
  const village = visibleSyncV2Scope(applied.state.scopes.get(`village:${ids.village}`)!);
  return { pages, delta, state: applied.state, village };
}
const privateGroup = (page: SyncV2SnapshotPage | SyncV2Batch) =>
  page.groups.find((group) => group.stream.kind === 'village')!;
const inject = (path: string, payload?: object, pages = true) =>
  app.inject({
    method: payload ? 'POST' : 'GET',
    url: `/api/worlds/aube/villages/${ids.village}${path}`,
    headers: { 'x-arbestra-protocol': '2', ...(pages ? { [SYNC_V2_PAGES_HEADER]: '1' } : {}) },
    cookies: { session: token },
    ...(payload ? { payload } : {}),
  });

describe('a village within one page', () => {
  it('reads the same complete snapshot, with or without paging', async () => {
    const [legacy, page] = await capture(async (tx) => [
      await readPrivateScopeSnapshot(tx, context),
      await readPrivateScopeSnapshotPage(tx, context, null),
    ]);
    expect(page.last).toBeNull();
    const sorted = (changes: SyncV2Change[]) => changes.toSorted((a, b) => a.component.localeCompare(b.component));
    expect(sorted(page.changes)).toEqual(sorted(legacy));
    // Over HTTP: one complete scope snapshot, no page, either way.
    const [withPages, without] = await Promise.all([
      inject('/bootstrap?generation=1&include=knowledge,manifest,traffic'),
      inject('/bootstrap?generation=1&include=knowledge,manifest,traffic', undefined, false),
    ]);
    for (const response of [withPages, without]) {
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ coverage: 'scope-snapshot' });
      expect(response.json()).not.toHaveProperty('next');
    }
    const [a, b] = [withPages.json() as SyncV2Batch, without.json() as SyncV2Batch];
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    const keys = (batch: SyncV2Batch) => [...entities(privateGroup(batch).changes).keys()].sort();
    expect(keys(a)).toEqual(keys(b));
    expect(applySyncV2Batch(stateFor(1, a.groups), a).kind).toBe('applied');
  }, 60000);
});

describe('a village beyond 4096 references', () => {
  let shrink: () => Promise<void> = async () => undefined;
  beforeAll(async () => {
    // Sawmills (one reference each) and the cells of one garden far away.
    await sql`insert into buildings(world_id,village_id,building_type,level,status,completed_at)
      select ${ids.world},${ids.village},'sawmill',1,'completed',${through} from generate_series(1,3000)`.execute(db);
    const garden = await db
      .insertInto('buildings')
      .values({
        worldId: ids.world,
        villageId: ids.village,
        buildingType: 'garden',
        level: 1,
        status: 'completed',
        completedAt: through,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await sql`insert into garden_plots(world_id,village_id,building_id,cell_x,cell_y,stored_amount,production_updated_at)
      select ${ids.world},${ids.village},${garden.id},1500+(i%100),900+(i/100),i%7,${through}
      from generate_series(0,1499) i`.execute(db);
    shrink = async () => {
      await sql`delete from buildings where world_id=${ids.world} and village_id=${ids.village}
        and (building_type='sawmill' or id=${garden.id})`.execute(db);
    };
  }, 180000);
  afterAll(() => shrink(), 180000);

  it('is refused as a single read, as before', async () => {
    await expect(
      captureSyncV2(db, ids.account, 'aube', ids.village, { protocol: 2, generation: 1, scopes: [], cursors: [] }),
    ).rejects.toThrow(new RangeError('Private scope snapshot requires pagination'));
  });

  it('reads bounded pages whose union equals one unbounded read', async () => {
    const reference = await unboundedRead();
    expect(reference.references).toBeGreaterThan(SYNC_V2_SNAPSHOT_PAGE_REFERENCES);
    const paged = new Map<string, Entity>();
    let after: SyncSnapshotPosition | null = null,
      pages = 0;
    do {
      const position: SyncSnapshotPosition | null = after;
      const page: Awaited<ReturnType<typeof readPrivateScopeSnapshotPage>> = await capture((tx) =>
        readPrivateScopeSnapshotPage(tx, context, position),
      );
      pages++;
      const counts = page.changes.map((change) => change.upsert.length);
      expect(counts.reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(SYNC_V2_SNAPSHOT_PAGE_REFERENCES);
      for (const change of page.changes) {
        expect(change.upsert.length).toBeLessThanOrEqual(SYNC_V2_COMPONENT_LIMITS[change.component]!);
        expect(change.remove).toEqual([]);
      }
      entities(page.changes, paged);
      after = page.last;
    } while (after);
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(paged.size).toBe(reference.values.size);
    expect(paged).toEqual(reference.values);
  }, 120000);

  it('loads through paged captures into one state with every entity', async () => {
    const { pages, delta, village } = await pagedLoad(2);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    for (const page of pages) expect(syncV2SnapshotPageIsValid(page)).toBe(true);
    // The first page carries the shared scopes, complete; later ones only
    // the private stream, never behind the anchor.
    expect(pages[0]!.groups.map((group) => group.stream.kind).sort()).toEqual([
      'knowledge',
      'manifest',
      'traffic',
      'village',
    ]);
    for (const page of pages.slice(1)) expect(page.groups.map((group) => group.stream.kind)).toEqual(['village']);
    expect(delta.coverage).toBe('delta');
    const reference = await unboundedRead();
    expect([...village.keys()].sort()).toEqual([...reference.values.keys()].sort());
    for (const [key, value] of reference.values)
      if (key.startsWith('buildings:')) expect(village.get(key)).toEqual(value);
  }, 120000);

  it('ends with a change committed between two pages, and one still open during a page', async () => {
    const sawmills = (
      await db
        .selectFrom('buildings')
        .select('id')
        .where('villageId', '=', ids.village)
        .where('buildingType', '=', 'sawmill')
        .orderBy('id')
        .limit(2)
        .execute()
    ).map((row) => row.id);
    const [upgraded, demolished] = sawmills as [string, string];
    const { name } = await db
      .selectFrom('villages')
      .select('name')
      .where('id', '=', ids.village)
      .executeTakeFirstOrThrow();
    let added: string | null = null;
    // Writer B renames the village (a page 2 entity) and waits, uncommitted,
    // while page 2 is read; then it commits before the catch-up delta.
    let ready!: () => void, release!: () => void;
    const opened = new Promise<void>((resolve) => (ready = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    let renaming: Promise<void> | null = null,
      waiting: Promise<void> | null = null,
      settled = false;
    const seen: Array<{
      read: number;
      name: string | undefined;
      level: number | undefined;
      added: boolean;
      demolished: boolean;
    }> = [];
    try {
      const result = await pagedLoad(3, async (read) => {
        if (read === 1) {
          // Writer A, committed between page 1 and page 2: page 1 entities.
          await db.transaction().execute(async (tx) => {
            await tx.updateTable('buildings').set({ level: 2 }).where('id', '=', upgraded).execute();
            await tx.deleteFrom('buildings').where('id', '=', demolished).execute();
            added = (
              await tx
                .insertInto('buildings')
                .values({
                  worldId: ids.world,
                  villageId: ids.village,
                  buildingType: 'sawmill',
                  level: 1,
                  status: 'completed',
                  completedAt: through,
                })
                .returning('id')
                .executeTakeFirstOrThrow()
            ).id;
          });
          renaming = db
            .transaction()
            .execute(async (tx) => {
              await tx.updateTable('villages').set({ name: 'Pages B' }).where('id', '=', ids.village).execute();
              ready();
              // Bounded: a stuck test still releases its transaction.
              await Promise.race([released, new Promise((resolve) => setTimeout(resolve, 20000))]);
            })
            .finally(() => (settled = true));
          waiting = renaming;
          await opened;
        } else if (waiting) {
          // Page 2 was read while B was open: release it and wait its commit.
          const open = waiting;
          waiting = null;
          expect(settled).toBe(false);
          release();
          await open;
        }
      });
      for (const [index, page] of result.pages.entries()) {
        const values = entities(privateGroup(page).changes);
        seen.push({
          read: index + 1,
          name: (values.get(`identity:${ids.village}`) as { name?: string } | undefined)?.name,
          level: (values.get(`buildings:${upgraded}`) as { level?: number } | undefined)?.level,
          added: values.has(`buildings:${added}`),
          demolished: values.has(`buildings:${demolished}`),
        });
      }
      // The pages alone are mixed: page 1 predates A, page 2 predates B.
      expect(seen[0]).toMatchObject({ level: 1, added: false, demolished: true });
      expect(seen.find((page) => page.name !== undefined)?.name).toBe(name);
      // The published state has all of them.
      expect(result.delta.coverage).toBe('delta');
      expect(result.village.get(`identity:${ids.village}`)).toMatchObject({ name: 'Pages B' });
      expect(result.village.get(`buildings:${upgraded}`)).toMatchObject({ level: 2 });
      expect(result.village.has(`buildings:${added}`)).toBe(true);
      expect(result.village.has(`buildings:${demolished}`)).toBe(false);
    } finally {
      release?.();
      await (renaming as Promise<void> | null)?.catch(() => undefined);
      await db.updateTable('villages').set({ name }).where('id', '=', ids.village).execute();
    }
  }, 120000);

  it('serves pages over HTTP to a client that accepts them, and refuses them otherwise', async () => {
    const first = await inject('/bootstrap?generation=4&include=knowledge,manifest,traffic');
    expect(first.statusCode).toBe(200);
    const page = first.json() as SyncV2SnapshotPage;
    expect(page.coverage).toBe('scope-snapshot-page');
    expect(page.next).toMatch(/^[A-Za-z0-9_-]+$/);
    const second = await inject('/sync/read', pageRequest(4, page.next!));
    expect(second.statusCode).toBe(200);
    expect(syncV2SnapshotPageIsValid(second.json())).toBe(true);
    // An older client keeps the refusal it already handles.
    const legacy = await inject('/bootstrap?generation=4', undefined, false);
    expect(legacy.statusCode).toBe(503);
    expect(legacy.json()).toEqual({ code: 'SYNC_SCOPE_TOO_LARGE' });
    expect((await inject('/sync/read', pageRequest(4, page.next!), false)).json()).toEqual({
      code: 'INVALID_SYNC_PAGE',
    });
    // A forged cursor is refused; a replaced epoch restarts from page 1.
    expect((await inject('/sync/read', pageRequest(4, 'bm90LWEtY3Vyc29y'))).json()).toEqual({
      code: 'INVALID_SYNC_PAGE',
    });
    const decoded = JSON.parse(Buffer.from(page.next!, 'base64url').toString('utf8'));
    const replaced = Buffer.from(JSON.stringify({ ...decoded, e: randomUUID() })).toString('base64url');
    const expired = await inject('/sync/read', pageRequest(4, replaced));
    expect(expired.statusCode).toBe(409);
    expect(expired.json()).toEqual({ code: 'SYNC_SNAPSHOT_PAGE_EXPIRED' });
  }, 120000);

  it('resets a stream whose cursor needs a snapshot, without reading it', async () => {
    const { revision } = (
      await sql<{ revision: string }>`select revision::text from game_sync_streams
        where world_id=${ids.world} and stream_kind='village' and scope_key=${ids.village}`.execute(db)
    ).rows[0]!;
    // A replaced epoch: the stream must reset, not answer 503 or read the village.
    const response = await inject('/sync/stream', {
      protocol: 2,
      generation: 5,
      scopes: [{ kind: 'village', key: ids.village }],
      cursors: [{ kind: 'village', key: ids.village, epoch: randomUUID(), revision }],
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(response.body).toContain('event: reset');
  }, 120000);
});

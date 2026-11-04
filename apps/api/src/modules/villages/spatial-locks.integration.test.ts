/**
 * Scope of the spatial locks (docs/VERROUS-2026-11-04.md): conflicts
 * between neighbours are still serialized and detected with their usual code;
 * unrelated commands (distant villages) no longer wait for each other.
 * Every interleaving is forced with bounded barriers and the waits observed in
 * PostgreSQL; every transaction is released and awaited, even on failure.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sql, type Transaction } from 'kysely';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { type GeneratedLandscape, type TerrainEditGesture } from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import type { Database } from '../../database/schema.js';
import { RC1_CANONICAL_CHECKSUM } from '../onboarding/spawn-map.js';
import { activateTerrainVertices } from '../worlds/terrain-vertices.js';
import { terrainEditsCommandV2, terrainEditsTestHooks } from './terrain-edits.js';
import { placeBuilding } from './construction.js';
import { beginVillageEconomy } from './reconcile-economy.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\w+)?_test$/.test(target.pathname))
  throw Error('Unexpected spatial lock test database');
const db = createDatabase(url),
  worldId = randomUUID(),
  slug = 'spatial-locks-' + worldId;
/** A and B are neighbours on one cleared pad; C is far away on the torus. */
const v = {
  a: { account: randomUUID(), village: randomUUID(), hall: { cellX: 57, cellY: 195 } },
  b: { account: randomUUID(), village: randomUUID(), hall: { cellX: 64, cellY: 195 } },
  c: { account: randomUUID(), village: randomUUID(), hall: { cellX: 300, cellY: 60 } },
};
type Key = keyof typeof v;
const artifact = JSON.parse(
  readFileSync(new URL('../../../../world-web/public/studies/t1-alpha512-rc1.json', import.meta.url), 'utf8'),
) as GeneratedLandscape;
const PAD = { x0: 49, x1: 76, y0: 186, y1: 209 };

beforeAll(async () => {
  await migrateToLatest(url);
  for (const key of Object.keys(v) as Key[])
    await db
      .insertInto('accounts')
      .values({ id: v[key].account, email: v[key].account + '@spatial-locks.test', passwordHash: 'fixture' })
      .execute();
  await db
    .insertInto('worlds')
    .values({
      id: worldId,
      slug,
      name: 'Verrous spatiaux',
      topology: 'torus',
      widthCells: 512,
      heightCells: 256,
      chunkSize: 32,
      seed: 4109,
      generationVersion: 3,
      generationStatus: 'ready',
      isOpen: false,
      generatedAt: new Date(),
    })
    .execute();
  await db
    .insertInto('worldChunks')
    .values(
      Array.from({ length: 128 }, (_, i) => ({
        worldId,
        chunkX: i % 16,
        chunkY: Math.floor(i / 16),
        generationVersion: 3,
        terrainCodes: Array(1024).fill(1),
        elevations: Array(1024).fill(25),
      })),
    )
    .execute();
  await db
    .insertInto('worldGenerationCandidates')
    .values({
      worldId,
      commandId: randomUUID(),
      ownerAccountId: v.a.account,
      parameters: artifact.geography!.parameters,
      checksum: RC1_CANONICAL_CHECKSUM,
      status: 'ready',
      artifact,
    })
    .execute();
  await activateTerrainVertices(db, worldId);
  const now = new Date();
  for (const key of Object.keys(v) as Key[]) {
    const { account, village, hall } = v[key];
    await db.insertInto('worldMemberships').values({ worldId, accountId: account, playerName: key }).execute();
    await db
      .insertInto('villages')
      .values({
        id: village,
        worldId,
        ownerAccountId: account,
        name: 'Village ' + key,
        anchorCellX: hall.cellX,
        anchorCellY: hall.cellY,
        economyActivatedAt: now,
      })
      .execute();
    const hallId = randomUUID();
    await db
      .insertInto('buildings')
      .values({
        id: hallId,
        worldId,
        villageId: village,
        buildingType: 'town-hall',
        level: 2,
        status: 'completed',
        completedAt: now,
        constructionStartedAt: null,
        constructionCompletesAt: null,
      })
      .execute();
    await db
      .insertInto('worldCellOccupancies')
      .values({ worldId, ...hall, buildingId: hallId, featureId: null, pendingExpansionId: null, role: 'anchor' })
      .execute();
    await db
      .insertInto('villageResources')
      .values(
        ['wood', 'stone', 'timber', 'cut-stone', 'carrot'].map((resourceCode) => ({
          worldId,
          villageId: village,
          resourceCode,
          amount: 100000,
        })),
      )
      .onConflict((c) => c.columns(['worldId', 'villageId', 'resourceCode']).doUpdateSet({ amount: 100000 }))
      .execute();
    await db
      .insertInto('villageResourceFlows')
      .values({
        worldId,
        villageId: village,
        resourceCode: 'wood',
        baseRatePerHour: 0,
        remainder: 0,
        productionUpdatedAt: now,
      })
      .execute();
  }
  // A dry, flat, cleared pad over the genuine RC1 source for A and B.
  const featureId = randomUUID(),
    removed = artifact.forest!.trees.flatMap((t, i) =>
      t.x >= PAD.x0 && t.x <= PAD.x1 && t.y >= PAD.y0 && t.y <= PAD.y1 ? [i] : [],
    );
  await db
    .insertInto('worldFeatures')
    .values({ id: featureId, worldId, featureTypeCode: 'woodland', state: 'available', variantSeed: 1 })
    .execute();
  await db
    .insertInto('worldRc1Resources')
    .values({
      worldId,
      featureId,
      sourceKey: 'test:spatial-pad',
      treeIndices: JSON.stringify(removed),
      removedIndices: JSON.stringify(removed),
    })
    .execute();
  const vertices = [];
  for (let vertexY = PAD.y0; vertexY <= PAD.y1 + 1; vertexY++)
    for (let vertexX = PAD.x0; vertexX <= PAD.x1 + 1; vertexX++)
      vertices.push({ worldId, vertexX, vertexY, height: 0.25 });
  await db.insertInto('worldTerrainVertices').values(vertices).execute();
}, 180000);

afterAll(async () => {
  await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).execute();
  await db.deleteFrom('worlds').where('id', '=', worldId).execute();
  await db
    .deleteFrom('accounts')
    .where(
      'id',
      'in',
      (Object.keys(v) as Key[]).map((k) => v[k].account),
    )
    .execute();
  await db.destroy();
}, 60000);

afterEach(() => {
  delete terrainEditsTestHooks.afterLock;
  delete terrainEditsTestHooks.afterWrites;
});

/** A bounded barrier: the holder waits until released, at most 20 s. */
function barrier() {
  let release!: () => void, arrive!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const arrived = new Promise<void>((resolve) => (arrive = resolve));
  return {
    arrived: Promise.race([
      arrived,
      new Promise<never>((_, reject) => setTimeout(() => reject(Error('barrier not reached')), 30000)),
    ]),
    release,
    wait: async () => {
      arrive();
      await Promise.race([gate, new Promise((_, reject) => setTimeout(() => reject(Error('barrier timeout')), 20000))]);
    },
  };
}
/** Sessions of this database waiting on an advisory lock right now. */
const advisoryWaiters = async () =>
  (
    await sql<{ n: number }>`select count(*)::int as n from pg_stat_activity
      where datname=current_database() and wait_event_type='Lock' and wait_event='advisory'`.execute(db)
  ).rows[0]!.n;
/** Bounded wait until a session waits on an advisory lock. */
async function advisoryWaiter() {
  for (let i = 0; i < 150; i++) {
    if ((await advisoryWaiters()) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('No session waited for a spatial lock');
}
/** Advisory locks held by any other session (none once everything settled). */
const advisoryHeld = async () =>
  (
    await sql<{ n: number }>`select count(*)::int as n from pg_locks l join pg_stat_activity a on a.pid=l.pid
      where l.locktype='advisory' and a.datname=current_database() and l.pid<>pg_backend_pid()`.execute(db)
  ).rows[0]!.n;
/** Settles within `ms` or reports that it was still blocked. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | 'blocked'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<'blocked'>((resolve) => (timer = setTimeout(() => resolve('blocked'), ms))),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const free = (cellX: number, cellY: number, height: number): TerrainEditGesture => ({
  buildingType: 'terrain',
  anchor: { cellX, cellY },
  cells: [{ cellX, cellY }],
  height,
});
const terraform = (key: Key, gestures: TerrainEditGesture[]) =>
  terrainEditsCommandV2(db, v[key].account, slug, v[key].village, { commandId: randomUUID(), gestures }, 1);
const place = (
  key: Key,
  buildingType: 'garden' | 'dwelling',
  cell: { cellX: number; cellY: number },
  afterWrites?: (tx: Transaction<Database>) => Promise<void>,
) =>
  placeBuilding(
    db,
    v[key].account,
    slug,
    v[key].village,
    { buildingType, anchor: cell, cells: [cell], commandId: randomUUID() },
    60000,
    afterWrites,
  );
const reader = (key: Key) =>
  db.transaction().execute(async (tx) => (await beginVillageEconomy(tx, worldId, v[key].village)).through);
const heightOf = async (vertexX: number, vertexY: number) =>
  (
    await db
      .selectFrom('worldTerrainVertices')
      .select('height')
      .where('worldId', '=', worldId)
      .where('vertexX', '=', vertexX)
      .where('vertexY', '=', vertexY)
      .executeTakeFirstOrThrow()
  ).height;
const resetPad = () =>
  db
    .updateTable('worldTerrainVertices')
    .set({ height: 0.25 })
    .where('worldId', '=', worldId)
    .where('vertexX', '>=', PAD.x0)
    .where('vertexX', '<=', PAD.x1 + 1)
    .where('vertexY', '>=', PAD.y0)
    .where('vertexY', '<=', PAD.y1 + 1)
    .execute();
const removeBuildingsAt = async (cells: Array<{ cellX: number; cellY: number }>) => {
  for (const c of cells) {
    const row = await db
      .selectFrom('worldCellOccupancies')
      .select('buildingId')
      .where('worldId', '=', worldId)
      .where('cellX', '=', c.cellX)
      .where('cellY', '=', c.cellY)
      .executeTakeFirst();
    if (!row?.buildingId) continue;
    await db
      .deleteFrom('scheduledTasks')
      .where('worldId', '=', worldId)
      .where('subjectId', '=', row.buildingId)
      .execute();
    await db
      .deleteFrom('gardenPlots')
      .where('worldId', '=', worldId)
      .where('buildingId', '=', row.buildingId)
      .execute();
    await db.deleteFrom('buildings').where('worldId', '=', worldId).where('id', '=', row.buildingId).execute();
  }
};

/** A terraformation of A held inside its transaction (after its writes). */
async function heldTerraform(gestures: TerrainEditGesture[]) {
  const gate = barrier();
  terrainEditsTestHooks.afterWrites = gate.wait;
  const run = terraform('a', gestures).catch((error: unknown) => error);
  await gate.arrived;
  delete terrainEditsTestHooks.afterWrites;
  return { gate, run };
}

it('a distant reader and a distant construction no longer wait for a held terraformation', async () => {
  const held = await heldTerraform([free(60, 190, 0.5)]);
  try {
    // Before 4 November both waited on the exclusive world key.
    const read = await within(reader('c'), 10000);
    expect(read, 'economy of a distant village').toBeInstanceOf(Date);
    const built = await within(
      place('c', 'garden', v.c.hall).catch((error: { code?: string }) => error.code),
      10000,
    );
    expect(built, 'construction refused by its own rule, without waiting').toBe('CELL_OCCUPIED');
    expect(await advisoryWaiters()).toBe(0);
  } finally {
    held.gate.release();
    await held.run;
  }
  expect(await held.run).toMatchObject({ status: 'applied' });
  await resetPad();
}, 90000);

it('a distant terraformation runs while a neighbour terraformation is held', async () => {
  const held = await heldTerraform([free(60, 190, 0.5)]);
  try {
    const other = await within(
      terraform('c', [free(v.c.hall.cellX + 3, v.c.hall.cellY, 0.5)]).catch((error: unknown) => error),
      15000,
    );
    expect(other, 'distant terraformation settled').not.toBe('blocked');
  } finally {
    held.gate.release();
    await held.run;
  }
  await resetPad();
}, 90000);

it('a neighbour still waits for the held terraformation (reader of its region)', async () => {
  const held = await heldTerraform([free(60, 190, 0.5)]);
  let read: Promise<unknown> | undefined;
  try {
    read = reader('b').catch((error: unknown) => error);
    await advisoryWaiter();
    expect(await within(read, 300)).toBe('blocked');
  } finally {
    held.gate.release();
    await held.run;
    await read;
  }
  expect(await read).toBeInstanceOf(Date);
  await resetPad();
}, 90000);

it('two constructions of neighbours on the same cell: the second waits, then is refused CELL_OCCUPIED', async () => {
  const cell = { cellX: 60, cellY: 199 };
  const gate = barrier();
  const first = place('a', 'garden', cell, gate.wait).catch((error: unknown) => error);
  let second: Promise<unknown> | undefined;
  try {
    await gate.arrived;
    second = place('b', 'garden', cell).catch((error: { code?: string }) => error.code);
    await advisoryWaiter();
    expect(await within(second, 300)).toBe('blocked');
  } finally {
    gate.release();
    await first;
    await second;
  }
  expect(await first).toMatchObject({ kind: 'construction' });
  expect(await second).toBe('CELL_OCCUPIED');
  await removeBuildingsAt([cell]);
}, 90000);

it('two terraformations of neighbours on a shared vertex: serialized, the later height wins, nothing lost', async () => {
  // A paints (60,191), B paints (61,191): vertices x=61 are shared.
  const held = await heldTerraform([free(60, 191, 0.5)]);
  let other: Promise<unknown> | undefined;
  try {
    other = terraform('b', [free(61, 191, 0.75)]).catch((error: unknown) => error);
    await advisoryWaiter();
    expect(await within(other, 300)).toBe('blocked');
  } finally {
    held.gate.release();
    await held.run;
    await other;
  }
  expect(await held.run).toMatchObject({ status: 'applied' });
  expect(await other).toMatchObject({ status: 'applied' });
  for (const y of [191, 192]) {
    expect(await heightOf(60, y), 'A alone').toBe(0.5);
    expect(await heightOf(61, y), 'shared, B is later').toBe(0.75);
    expect(await heightOf(62, y), 'B alone').toBe(0.75);
  }
  await resetPad();
}, 90000);

it('a construction against a neighbour terraformation of a shared vertex: waits, then UNEVEN_TERRAIN', async () => {
  // A raises (60,193); B's dwelling at (61,193) shares the vertices x=61.
  const cell = { cellX: 61, cellY: 193 };
  const held = await heldTerraform([free(60, 193, 0.5)]);
  let built: Promise<unknown> | undefined;
  try {
    built = place('b', 'dwelling', cell).catch((error: { code?: string }) => error.code);
    await advisoryWaiter();
    expect(await within(built, 300)).toBe('blocked');
  } finally {
    held.gate.release();
    await held.run;
    await built;
  }
  expect(await held.run).toMatchObject({ status: 'applied' });
  expect(await built).toBe('UNEVEN_TERRAIN');
  await resetPad();
  // Sequential control: on the flat pad the same dwelling is accepted.
  expect(await place('b', 'dwelling', cell)).toMatchObject({ kind: 'construction' });
  await removeBuildingsAt([cell]);
}, 90000);

it('rolls back an injected failure after the writes: nothing written, every spatial lock released', async () => {
  const before = await heightOf(61, 196);
  const receipts = await db
    .selectFrom('terrainEditReceipts')
    .select('commandId')
    .where('worldId', '=', worldId)
    .execute();
  const injected = Error('injected after terrain writes');
  let written: number | undefined;
  terrainEditsTestHooks.afterWrites = async (tx) => {
    // The writes happened in this transaction before the failure.
    written = (
      await tx
        .selectFrom('worldTerrainVertices')
        .select('height')
        .where('worldId', '=', worldId)
        .where('vertexX', '=', 61)
        .where('vertexY', '=', 196)
        .executeTakeFirstOrThrow()
    ).height;
    throw injected;
  };
  await expect(terraform('a', [free(60, 196, 0.5)])).rejects.toBe(injected);
  delete terrainEditsTestHooks.afterWrites;
  expect(written).toBe(0.5);
  expect(await heightOf(61, 196)).toBe(before);
  expect(
    await db.selectFrom('terrainEditReceipts').select('commandId').where('worldId', '=', worldId).execute(),
  ).toEqual(receipts);
  expect(await advisoryHeld(), 'no advisory lock left by any session').toBe(0);
  // The same zone is immediately free for the neighbour.
  expect(await within(terraform('b', [free(61, 196, 0.75)]), 15000)).toMatchObject({ status: 'applied' });
  await resetPad();
}, 90000);

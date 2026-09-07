import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../database/connection.js';
import { buildApp } from '../../app.js';
import { migrateToLatest } from '../../database/migrate.js';
import { up as migrateVillageAccomplishments } from '../../database/migrations/014_village_accomplishments.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import type { Database } from '../../database/schema.js';
import { DEVELOPMENT_CELLS, DEVELOPMENT_IDS } from '../../database/seed.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { discoverBuildingSupplies, discoverBuildingSuppliesInTransaction, feedPopulation, getVillageState, restPopulation } from '../villages/service.js';

const databaseUrl = testDatabaseUrl();
let db: Kysely<Database>;
const feedId = '11111111-1111-4111-8111-111111111111';

async function economicRows(executor: Kysely<Database>) {
  const tables = ['village_resources', 'village_resource_flows', 'building_resource_buffers',
    'buildings', 'population_cohorts', 'garden_harvests', 'deposit_extractions',
    'stone_deposits', 'scheduled_tasks', 'building_hidden_supplies', 'village_accomplishments'];
  return Promise.all(tables.map(async (table) => (await sql<{ rows: unknown }>`
    select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) as rows
    from ${sql.id(table)} t`.execute(executor)).rows[0]!.rows));
}

function gate() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('accomplishment barrier timeout')), 7000); })]); }
  finally { clearTimeout(timer); }
}
async function backend(tx: Transaction<Database>) {
  await sql`set local lock_timeout = '6s'`.execute(tx);
  return (await tx.selectNoFrom(sql<number>`pg_backend_pid()`.as('pid')).executeTakeFirstOrThrow()).pid;
}
async function blocked(waiter: number, blocker: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const row = await db.selectNoFrom(sql<boolean>`${blocker} = any(pg_blocking_pids(${waiter}))`.as('blocked')).executeTakeFirstOrThrow();
    if (row.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Expected PostgreSQL village lock wait was not observed');
}

describe.sequential('population with PostgreSQL', () => {
  beforeAll(async () => {
    await migrateToLatest(databaseUrl);
    await resetE2eState(databaseUrl);
    db = createDatabase(databaseUrl);
  });
  beforeEach(() => resetE2eState(databaseUrl));
  afterAll(async () => { await db?.destroy(); });

  it('rejects a bodyless harvest through HTTP without an internal error', async () => {
    const app = await buildApp({ databaseUrl, host: '127.0.0.1', port: 0, isProduction: false,
      cookieName: 'test_session', sessionTtlDays: 1, constructionDurationOverrideMs: 0,
      scheduledTaskPollIntervalMs: 250 }, db);
    try {
      const login = await app.inject({ method: 'POST', url: '/api/auth/login',
        payload: { email: 'player@arbestra.local', password: 'arbestra' } });
      expect(login.statusCode).toBe(200);
      const response = await app.inject({ method: 'POST',
        url: `/api/worlds/aube/villages/${DEVELOPMENT_IDS.village}/buildings/${DEVELOPMENT_IDS.townHall}/harvest`,
        cookies: { test_session: login.cookies[0]!.value } });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_ERROR');
      const cookies = { test_session: login.cookies[0]!.value };
      const base = `/api/worlds/aube/villages/${DEVELOPMENT_IDS.village}/buildings`;
      const built = await app.inject({ method: 'POST', url: base, cookies,
        payload: { buildingType: 'garden', ...DEVELOPMENT_CELLS.garden } });
      expect(built.statusCode, built.body).toBe(201);
      const buildingId = built.json().cells.find((cell: { building?: { type: string } }) => cell.building?.type === 'garden').building.id;
      await db.updateTable('buildingResourceBuffers').set({ storedAmount: 100 }).where('buildingId', '=', buildingId).execute();
      const harvested = await app.inject({ method: 'POST', url: `${base}/${buildingId}/harvest`, cookies,
        payload: { commandId: feedId } });
      expect(harvested.statusCode, harvested.body).toBe(200);
      expect(harvested.json().village.carrots).toBe(50);
      expect(harvested.json().cells.find((cell: { building?: { id: string } }) => cell.building?.id === buildingId).building.garden.harvest)
        .toMatchObject({ workerCount: 1, reservedCarrots: 100 });
      const nextCell = harvested.json().cells.find((cell: { canBuild: boolean }) => cell.canBuild);
      const secondGarden = await app.inject({ method: 'POST', url: base, cookies,
        payload: { buildingType: 'garden', cellX: nextCell.cellX, cellY: nextCell.cellY } });
      expect(secondGarden.statusCode, secondGarden.body).toBe(201);
      const secondId = secondGarden.json().cells.find((cell: { building?: { type: string; id: string } }) =>
        cell.building?.type === 'garden' && cell.building.id !== buildingId).building.id;
      const conflicted = await app.inject({ method: 'POST', url: `${base}/${secondId}/harvest`, cookies,
        payload: { commandId: feedId } });
      expect(conflicted.statusCode).toBe(409);
      expect(conflicted.json().code).toBe('COMMAND_ID_CONFLICT');
    } finally { await app.close(); }
  });

  it('initializes fifteen rested inhabitants and the town-hall capacity', async () => {
    const state = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    expect(state.village.population).toMatchObject({ total: 15, available: 15, working: 0, resting: 0, housingCapacity: 30 });
    expect(state.village.population.energyCounts[10]).toBe(15);
    expect(state.village.accomplishments).toEqual([]);
  });

  it('feeds exactly the requested inhabitants once and keeps the receipt idempotent', async () => {
    await db.updateTable('populationCohorts').set({ energy: 8, energyProgress: 0, foodUsedSinceRest: 0,
      energyUpdatedAt: sql`transaction_timestamp()` }).where('worldId', '=', DEVELOPMENT_IDS.world).execute();
    const fed = await feedPopulation(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, feedId, 2);
    expect(fed.village.carrots).toBe(48);
    expect(fed.village.population.energyCounts[9]).toBe(2);
    const retried = await feedPopulation(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, feedId, 2);
    expect(retried.village.carrots).toBe(48);
    await expect(feedPopulation(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, feedId, 3))
      .rejects.toMatchObject({ code: 'COMMAND_ID_CONFLICT' });
    const total = await db.selectFrom('populationCohorts').select(sql<number>`sum(member_count)::integer`.as('count'))
      .where('worldId', '=', DEVELOPMENT_IDS.world).executeTakeFirstOrThrow();
    expect(total.count).toBe(15);
  });

  it('starts a voluntary rest without changing the population total', async () => {
    const state = await restPopulation(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village,
      '22222222-2222-4222-8222-222222222222', 4);
    expect(state.village.population).toMatchObject({ total: 15, available: 11, resting: 4 });
  });

  it('makes short-rest and legacy full-energy cohorts available in the village snapshot', async () => {
    for (const energy of [9, 10]) {
      await db.updateTable('populationCohorts').set({ activity: 'resting', energy, energyProgress: 0,
        foodUsedSinceRest: 2, restingSince: sql`statement_timestamp() - interval '31 minutes'`,
        energyUpdatedAt: sql`statement_timestamp() - interval '31 minutes'` })
        .where('worldId', '=', DEVELOPMENT_IDS.world).where('villageId', '=', DEVELOPMENT_IDS.village).execute();
      const state = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
      expect(state.village.population).toMatchObject({ total: 15, available: 15, resting: 0 });
      expect(state.village.population.energyCounts[10]).toBe(15);
    }
  });

  it('serializes two discoveries on the village and returns one persistent credit to both callers', async () => {
    const before = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    expect(before.cells.find((cell) => cell.building?.id === DEVELOPMENT_IDS.townHall)?.building?.hiddenSuppliesAvailable).toBe(true);
    const held = gate(), release = gate(), opened = gate();
    let pidA = 0, pidB = 0;
    const first = db.transaction().execute(async (tx) => {
      pidA = await backend(tx);
      await tx.selectFrom('villages').select('id').where('worldId', '=', DEVELOPMENT_IDS.world)
        .where('id', '=', DEVELOPMENT_IDS.village).forUpdate().executeTakeFirstOrThrow();
      held.resolve();
      await bounded(release.promise);
      return discoverBuildingSuppliesInTransaction(tx, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, DEVELOPMENT_IDS.townHall);
    });
    void first.catch(() => undefined);
    let second: Promise<Awaited<ReturnType<typeof discoverBuildingSupplies>>> | undefined;
    try {
      await bounded(held.promise);
      second = db.transaction().execute(async (tx) => {
        pidB = await backend(tx); opened.resolve();
        return discoverBuildingSuppliesInTransaction(tx, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, DEVELOPMENT_IDS.townHall);
      });
      void second.catch(() => undefined);
      await bounded(opened.promise);
      await blocked(pidB, pidA);
      release.resolve();
      const outcomes = await Promise.all([bounded(first), bounded(second)]);
      expect(outcomes.every((result) => result.village.carrots === 2050)).toBe(true);
    } finally {
      release.resolve();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
    }
    const state = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    expect(state.village.carrots).toBe(2050);
    expect(state.village.accomplishments).toEqual([
      { code: 'town-hall-supplies', completedAt: expect.any(String) },
    ]);
    expect(state.cells.find((cell) => cell.building?.id === DEVELOPMENT_IDS.townHall)?.building?.hiddenSuppliesAvailable).toBe(false);
    const retried = await discoverBuildingSupplies(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, DEVELOPMENT_IDS.townHall);
    expect(retried.village.carrots).toBe(2050);
    expect(retried.village.accomplishments).toHaveLength(1);
  });

  it('rejects foreign village and building identifiers without changing the journal or stock', async () => {
    const cleanup = new Error('rollback foreign fixtures');
    await expect(db.transaction().execute(async (tx) => {
      const account = await tx.selectFrom('accounts').selectAll().where('id', '=', DEVELOPMENT_IDS.account).executeTakeFirstOrThrow();
      const foreignAccount = randomUUID();
      await tx.insertInto('accounts').values({ ...account, id: foreignAccount, email: `${foreignAccount}@example.test` }).execute();
      const world = await tx.selectFrom('worlds').selectAll().where('id', '=', DEVELOPMENT_IDS.world).executeTakeFirstOrThrow();
      const otherWorld = randomUUID(), otherSlug = `review-${otherWorld}`;
      await tx.insertInto('worlds').values({ ...world, id: otherWorld, slug: otherSlug }).execute();
      const village = await tx.selectFrom('villages').selectAll().where('id', '=', DEVELOPMENT_IDS.village).executeTakeFirstOrThrow();
      const building = await tx.selectFrom('buildings').selectAll().where('id', '=', DEVELOPMENT_IDS.townHall).executeTakeFirstOrThrow();
      const targets = [];
      for (const worldId of [DEVELOPMENT_IDS.world, otherWorld]) {
        const villageId = randomUUID(), buildingId = randomUUID();
        await tx.insertInto('worldMemberships').values({ worldId, accountId: foreignAccount, playerName: 'Autre chef' }).execute();
        await tx.insertInto('villages').values({ ...village, id: villageId, worldId, ownerAccountId: foreignAccount, anchorCellX: 20, anchorCellY: 20 }).execute();
        await tx.insertInto('buildings').values({ ...building, id: buildingId, worldId, villageId }).execute();
        await tx.insertInto('villageResources').values({ worldId, villageId, resourceCode: 'carrot', amount: 37 }).execute();
        await tx.insertInto('buildingHiddenSupplies').values({ worldId, villageId, buildingId, resourceCode: 'carrot', amount: 2000, claimedAt: null }).execute();
        targets.push({ villageId, buildingId });
      }
      const before = await economicRows(tx);
      for (const target of targets) {
        await expect(discoverBuildingSuppliesInTransaction(tx, DEVELOPMENT_IDS.account, 'aube', target.villageId, target.buildingId))
          .rejects.toMatchObject({ statusCode: 404, code: 'VILLAGE_NOT_FOUND' });
        await expect(discoverBuildingSuppliesInTransaction(tx, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, target.buildingId))
          .rejects.toMatchObject({ statusCode: 404, code: 'SUPPLIES_NOT_FOUND' });
      }
      await expect(discoverBuildingSuppliesInTransaction(tx, DEVELOPMENT_IDS.account, otherSlug, targets[1]!.villageId, targets[1]!.buildingId))
        .rejects.toMatchObject({ statusCode: 404, code: 'VILLAGE_NOT_FOUND' });
      expect(await economicRows(tx)).toEqual(before);
      throw cleanup;
    })).rejects.toBe(cleanup);
  });

  it('rolls back the accomplishment, claim and credit after an identified failure', async () => {
    const before = await economicRows(db);
    const failure = 'injected after observed accomplishment, claim and credit';
    await expect(db.transaction().execute(async (tx) => {
      await sql`create function fail_town_hall_credit() returns trigger language plpgsql as $$
        begin
          if new.resource_code = 'carrot'
            and new.amount = old.amount + 2000
            and exists(select 1 from village_accomplishments where world_id=new.world_id and village_id=new.village_id and code='town-hall-supplies')
            and exists(select 1 from building_hidden_supplies where world_id=new.world_id and village_id=new.village_id and claimed_at is not null)
          then raise exception 'injected after observed accomplishment, claim and credit'; end if;
          return new;
        end $$`.execute(tx);
      await sql`create trigger fail_town_hall_credit_trigger after update on village_resources
        for each row execute function fail_town_hall_credit()`.execute(tx);
      await discoverBuildingSuppliesInTransaction(tx, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, DEVELOPMENT_IDS.townHall);
    })).rejects.toThrow(failure);
    const [resource, supply, accomplishments] = await Promise.all([
      db.selectFrom('villageResources').select('amount').where('worldId', '=', DEVELOPMENT_IDS.world)
        .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'carrot').executeTakeFirstOrThrow(),
      db.selectFrom('buildingHiddenSupplies').select('claimedAt').where('worldId', '=', DEVELOPMENT_IDS.world)
        .where('buildingId', '=', DEVELOPMENT_IDS.townHall).executeTakeFirstOrThrow(),
      db.selectFrom('villageAccomplishments').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).execute(),
    ]);
    expect(Number(resource.amount)).toBe(50);
    expect(supply.claimedAt).toBeNull();
    expect(accomplishments).toEqual([]);
    expect(await economicRows(db)).toEqual(before);
  });

  it('backfills only claimed supplies in an isolated schema without changing stocks', async () => {
    const before = await db.selectFrom('villageResources').select('amount').where('worldId', '=', DEVELOPMENT_IDS.world)
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'carrot').executeTakeFirstOrThrow();
    const schema = `accomplishment_migration_${randomUUID().replaceAll('-', '')}`;
    const claimedAt = new Date('2026-09-05T12:34:56.000Z');
    const rollback = new Error('rollback isolated accomplishment migration');
    await expect(db.transaction().execute(async (tx) => {
      await sql`create schema ${sql.id(schema)}`.execute(tx);
      await sql`set local search_path to ${sql.id(schema)}, public`.execute(tx);
      await sql`create table building_hidden_supplies (
        world_id uuid not null, village_id uuid not null, building_id uuid not null,
        resource_code text not null, amount bigint not null, claimed_at timestamptz
      )`.execute(tx);
      await sql`insert into building_hidden_supplies values
        (${DEVELOPMENT_IDS.world}::uuid, ${DEVELOPMENT_IDS.village}::uuid, ${randomUUID()}::uuid, 'carrot', 2000, ${claimedAt}),
        (${DEVELOPMENT_IDS.world}::uuid, ${DEVELOPMENT_IDS.village}::uuid, ${randomUUID()}::uuid, 'carrot', 2000, null)`.execute(tx);
      await migrateVillageAccomplishments(tx as unknown as Kysely<unknown>);
      const migratedStock = await tx.selectFrom('villageResources').select('amount').where('worldId', '=', DEVELOPMENT_IDS.world)
        .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'carrot').executeTakeFirstOrThrow();
      expect(migratedStock.amount).toBe(before.amount);
      const rows = await sql<{ code: string; completedAt: Date }>`select code, completed_at as "completedAt" from village_accomplishments`.execute(tx);
      expect(rows.rows).toEqual([{ code: 'town-hall-supplies', completedAt: claimedAt }]);
      throw rollback;
    })).rejects.toBe(rollback);
    const after = await db.selectFrom('villageResources').select('amount').where('worldId', '=', DEVELOPMENT_IDS.world)
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'carrot').executeTakeFirstOrThrow();
    expect(after.amount).toBe(before.amount);
  });
});

import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS as ids } from '../../database/seed.js';
import type { Database } from '../../database/schema.js';
import { up as migrateGrowth } from '../../database/migrations/043_population_growth.js';
import { advancePopulationGrowth, POPULATION_ARRIVAL_TASK } from './growth.js';
import { reconcileVillageEconomy } from '../villages/reconcile-economy.js';

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected population growth test database');
const db = createDatabase(url),
  worldId = ids.world,
  villageId = ids.village;
beforeAll(async () => {
  await migrateToLatest(url);
  await resetE2eState(url);
}, 60000);
afterAll(() => db.destroy());
const rollback = new Error('population growth fixture rollback');
const at = (t: Date, ms: number) => new Date(t.getTime() + ms);
const total = async (tx: Transaction<Database>) =>
  (
    await tx
      .selectFrom('populationCohorts')
      .select(sql<number>`sum(member_count)::integer`.as('n'))
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .executeTakeFirstOrThrow()
  ).n;
const next = async (tx: Transaction<Database>) =>
  (
    await tx
      .selectFrom('villagePopulations')
      .select('nextArrivalAt')
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .executeTakeFirstOrThrow()
  ).nextArrivalAt;
async function home(tx: Transaction<Database>, t: Date, level = 1, completesAt: Date | null = null) {
  return (
    await tx
      .insertInto('buildings')
      .values({
        worldId,
        villageId,
        buildingType: 'dwelling',
        level,
        status: completesAt ? 'under-construction' : 'completed',
        targetLevel: null,
        constructionStartedAt: completesAt ? t : null,
        constructionCompletesAt: completesAt,
        completedAt: completesAt ? null : t,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
}
async function fixture(run: (tx: Transaction<Database>, t: Date) => Promise<void>) {
  await expect(
    db.transaction().execute(async (tx) => {
      await tx
        .selectFrom('villages')
        .select('id')
        .where('worldId', '=', worldId)
        .where('id', '=', villageId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const t = (await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('t')).executeTakeFirstOrThrow()).t;
      await tx
        .updateTable('villagePopulations')
        .set({ growthStartedAt: t, nextArrivalAt: null })
        .where('worldId', '=', worldId)
        .where('villageId', '=', villageId)
        .execute();
      await run(tx, t);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}
it('starts one minute after a finished house, preserves fractional minutes and stops at floor(50%)', async () => {
  await fixture(async (tx, t) => {
    await home(tx, t);
    const existing = await tx.selectFrom('populationCohorts').selectAll().where('villageId', '=', villageId).execute();
    await advancePopulationGrowth(tx, worldId, villageId, t, true);
    expect(await total(tx)).toBe(15);
    expect(await next(tx)).toEqual(at(t, 60000));
    await advancePopulationGrowth(tx, worldId, villageId, at(t, 59999));
    expect(await total(tx)).toBe(15);
    await advancePopulationGrowth(tx, worldId, villageId, at(t, 90000));
    expect(await total(tx)).toBe(16);
    expect(await next(tx)).toEqual(at(t, 120000));
    await advancePopulationGrowth(tx, worldId, villageId, at(t, 120000));
    expect(await total(tx)).toBe(17);
    expect(await next(tx)).toBeNull();
    await advancePopulationGrowth(tx, worldId, villageId, at(t, 86400000));
    expect(await total(tx)).toBe(17);
    for (const c of existing)
      expect(await tx.selectFrom('populationCohorts').selectAll().where('id', '=', c.id).executeTakeFirst()).toEqual(c);
  });
});
it('catches up offline with the exact arrival energy clocks and never removes excess residents', async () => {
  await fixture(async (tx, t) => {
    await home(tx, t, 2);
    await advancePopulationGrowth(tx, worldId, villageId, t, true);
    await advancePopulationGrowth(tx, worldId, villageId, at(t, 3 * 60000 + 20000));
    expect(await total(tx)).toBe(18);
    const arrivals = await tx
      .selectFrom('populationCohorts')
      .selectAll()
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('memberCount', '=', 1)
      .orderBy('energyUpdatedAt')
      .execute();
    expect(arrivals.map((c) => c.energyUpdatedAt)).toEqual([at(t, 60000), at(t, 120000), at(t, 180000)]);
    expect(
      arrivals.every(
        (c) =>
          c.activity === 'idle' &&
          c.energy === 10 &&
          c.originVillageId === villageId &&
          !c.cartographer &&
          !c.harvestId &&
          !c.extractionId,
      ),
    ).toBe(true);
    await advancePopulationGrowth(tx, worldId, villageId, at(t, 86400000));
    expect(await total(tx)).toBe(27);
    await tx
      .deleteFrom('buildings')
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('buildingType', '=', 'dwelling')
      .execute();
    await advancePopulationGrowth(tx, worldId, villageId, at(t, 86460000), true);
    expect(await total(tx)).toBe(27);
    expect(await next(tx)).toBeNull();
  });
});
it('interleaves delayed house completions with arrivals without granting time before completion', async () => {
  await fixture(async (tx, t) => {
    await home(tx, t, 1, at(t, 30000));
    await home(tx, t, 2, at(t, 100000));
    const economy = { worldId, villageId, through: at(t, 220000) };
    await reconcileVillageEconomy(tx, economy);
    expect(await total(tx)).toBe(18);
    const arrivals = await tx
      .selectFrom('populationCohorts')
      .select('energyUpdatedAt')
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .where('memberCount', '=', 1)
      .orderBy('energyUpdatedAt')
      .execute();
    expect(arrivals.map((c) => c.energyUpdatedAt)).toEqual([at(t, 90000), at(t, 150000), at(t, 210000)]);
    expect(await next(tx)).toEqual(at(t, 270000));
    await reconcileVillageEconomy(tx, economy);
    expect(await total(tx)).toBe(18);
  });
});
it('keeps the old house capacity during upgrade and starts the extra capacity at its deadline', async () => {
  await fixture(async (tx, t) => {
    const id = await home(tx, t);
    await tx
      .updateTable('populationCohorts')
      .set({ memberCount: 17 })
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .execute();
    await tx
      .updateTable('buildings')
      .set({
        status: 'under-construction',
        targetLevel: 2,
        completedAt: null,
        constructionStartedAt: t,
        constructionCompletesAt: at(t, 120000),
      })
      .where('id', '=', id)
      .execute();
    await advancePopulationGrowth(tx, worldId, villageId, t, true);
    expect(await next(tx)).toBeNull();
    await reconcileVillageEconomy(tx, { worldId, villageId, through: at(t, 179999) });
    expect(await total(tx)).toBe(17);
    await reconcileVillageEconomy(tx, { worldId, villageId, through: at(t, 180000) });
    expect(await total(tx)).toBe(18);
  });
});
it('never banks time at the target or backdates legacy arrivals before activation', async () => {
  await fixture(async (tx, t) => {
    const later = at(t, 3600000);
    await advancePopulationGrowth(tx, worldId, villageId, later, true);
    await home(tx, t);
    await advancePopulationGrowth(tx, worldId, villageId, later, true);
    await advancePopulationGrowth(tx, worldId, villageId, at(later, 59999));
    expect(await total(tx)).toBe(15);
    await advancePopulationGrowth(tx, worldId, villageId, at(later, 60000));
    expect(await total(tx)).toBe(16);
    await tx
      .updateTable('villagePopulations')
      .set({ nextArrivalAt: null })
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .execute();
    await advancePopulationGrowth(tx, worldId, villageId, at(t, -86400000), true);
    expect(await next(tx)).toEqual(at(t, 60000));
  });
});
it('schedules a distinct successor without touching existing notifications or another village', async () => {
  await fixture(async (tx, t) => {
    await home(tx, t, 2);
    await advancePopulationGrowth(tx, worldId, villageId, t, true);
    const first = await tx
      .selectFrom('scheduledTasks')
      .selectAll()
      .where('worldId', '=', worldId)
      .where('taskType', '=', POPULATION_ARRIVAL_TASK)
      .where('subjectId', '=', villageId)
      .executeTakeFirstOrThrow();
    await advancePopulationGrowth(tx, worldId, villageId, at(t, 60000));
    await advancePopulationGrowth(tx, worldId, villageId, at(t, 60000));
    expect(await total(tx)).toBe(16);
    expect(await tx.selectFrom('scheduledTasks').selectAll().where('id', '=', first.id).executeTakeFirst()).toEqual(
      first,
    );
    expect(
      await tx
        .selectFrom('scheduledTasks')
        .select('id')
        .where('worldId', '=', worldId)
        .where('taskType', '=', POPULATION_ARRIVAL_TASK)
        .where('subjectId', '=', villageId)
        .execute(),
    ).toHaveLength(2);
    const other = randomUUID();
    await advancePopulationGrowth(tx, other, villageId, at(t, 999999));
    expect(await total(tx)).toBe(16);
  });
});
it('rolls back verified arrivals, cursor and notification changes together', async () => {
  const rows = async () =>
    Promise.all([
      db.selectFrom('populationCohorts').selectAll().orderBy('id').execute(),
      db.selectFrom('villagePopulations').selectAll().orderBy('villageId').execute(),
      db.selectFrom('scheduledTasks').selectAll().orderBy('id').execute(),
    ]);
  const before = await rows();
  await fixture(async (tx, t) => {
    await home(tx, t, 2);
    await advancePopulationGrowth(tx, worldId, villageId, t, true);
    await advancePopulationGrowth(tx, worldId, villageId, at(t, 120000));
    expect(await total(tx)).toBe(17);
    expect(await next(tx)).toEqual(at(t, 180000));
  });
  expect(await rows()).toEqual(before);
});
it('backfills old villages progressively without changing their populations in the migration', async () => {
  await expect(
    db.transaction().execute(async (tx) => {
      // Temporary tables shadow only this connection; the real test schema stays intact.
      await sql`create temporary table buildings(world_id uuid,village_id uuid,building_type text,level integer,status text,target_level integer) on commit drop;
   create temporary table population_cohorts(world_id uuid,village_id uuid,member_count integer) on commit drop;
   create temporary table villages(world_id uuid,id uuid) on commit drop;
   create temporary table village_populations(world_id uuid,village_id uuid,primary key(world_id,village_id)) on commit drop;
   create temporary table scheduled_tasks(world_id uuid,task_type text,subject_id uuid,payload jsonb,due_at timestamptz,available_at timestamptz,completed_at timestamptz) on commit drop;
   create unique index scheduled_tasks_one_pending_subject on scheduled_tasks(world_id,task_type,subject_id) where completed_at is null and task_type<>'building.complete';`.execute(
        tx,
      );
      const old = randomUUID(),
        other = randomUUID(),
        full = randomUUID();
      await sql`insert into villages values(${worldId},${old}),(${worldId},${other}),(${worldId},${full})`.execute(tx);
      await sql`insert into village_populations values(${worldId},${old})`.execute(tx);
      await sql`insert into buildings values(${worldId},${old},'town-hall',1,'completed',null),(${worldId},${other},'town-hall',1,'completed',null),(${worldId},${full},'town-hall',1,'completed',null)`.execute(
        tx,
      );
      await sql`insert into population_cohorts values(${worldId},${full},15)`.execute(tx);
      await migrateGrowth<Database>(tx);
      const rows = await tx.selectFrom('villagePopulations').selectAll().execute();
      expect(rows).toHaveLength(3);
      expect(
        rows
          .filter((r) => r.villageId !== full)
          .every((r) => r.nextArrivalAt!.getTime() - r.growthStartedAt.getTime() === 60000),
      ).toBe(true);
      expect(rows.find((r) => r.villageId === full)?.nextArrivalAt).toBeNull();
      expect(await tx.selectFrom('populationCohorts').select('memberCount').execute()).toEqual([{ memberCount: 15 }]);
      expect(await tx.selectFrom('scheduledTasks').selectAll().execute()).toHaveLength(2);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});
it('serializes simultaneous wakeups with an observed PostgreSQL village-lock wait', async () => {
  const id = randomUUID(),
    t = new Date(),
    due = at(t, 60000);
  await db
    .insertInto('villages')
    .values({ id, worldId, ownerAccountId: ids.account, name: 'Concurrent arrivals', anchorCellX: 0, anchorCellY: 0 })
    .execute();
  let release!: () => void, ready!: () => void, waiterReady!: (pid: number) => void;
  const hold = new Promise<void>((r) => {
      release = r;
    }),
    locked = new Promise<void>((r) => {
      ready = r;
    }),
    waiterPid = new Promise<number>((r) => {
      waiterReady = r;
    });
  let first: Promise<void> | undefined, second: Promise<void> | undefined;
  const bounded = async <T>(promise: Promise<T>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error('arrival lock barrier timeout')), 7000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    await db
      .insertInto('villagePopulations')
      .values({ worldId, villageId: id, growthStartedAt: t, nextArrivalAt: due })
      .execute();
    await db
      .insertInto('populationCohorts')
      .values({
        worldId,
        villageId: id,
        originVillageId: id,
        memberCount: 14,
        activity: 'idle',
        energy: 10,
        energyProgress: 0,
        foodUsedSinceRest: 0,
        energyUpdatedAt: t,
      })
      .execute();
    await db
      .insertInto('buildings')
      .values({
        worldId,
        villageId: id,
        buildingType: 'town-hall',
        level: 1,
        targetLevel: null,
        status: 'completed',
        constructionStartedAt: null,
        constructionCompletesAt: null,
        completedAt: t,
      })
      .execute();
    let blocker = 0;
    first = db.transaction().execute(async (tx) => {
      await sql`set local lock_timeout='6s'`.execute(tx);
      blocker = (await tx.selectNoFrom(sql<number>`pg_backend_pid()`.as('pid')).executeTakeFirstOrThrow()).pid;
      await tx
        .selectFrom('villages')
        .select('id')
        .where('worldId', '=', worldId)
        .where('id', '=', id)
        .forUpdate()
        .execute();
      await advancePopulationGrowth(tx, worldId, id, due);
      ready();
      await hold;
    });
    await bounded(locked);
    second = db.transaction().execute(async (tx) => {
      await sql`set local lock_timeout='6s'`.execute(tx);
      waiterReady((await tx.selectNoFrom(sql<number>`pg_backend_pid()`.as('pid')).executeTakeFirstOrThrow()).pid);
      await tx
        .selectFrom('villages')
        .select('id')
        .where('worldId', '=', worldId)
        .where('id', '=', id)
        .forUpdate()
        .execute();
      await advancePopulationGrowth(tx, worldId, id, due);
    });
    const waiter = await bounded(waiterPid),
      deadline = Date.now() + 5000;
    let observed = false;
    while (Date.now() < deadline) {
      observed = (
        await db
          .selectNoFrom(sql<boolean>`${blocker}=any(pg_blocking_pids(${waiter}))`.as('waiting'))
          .executeTakeFirstOrThrow()
      ).waiting;
      if (observed) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(observed, 'the second wakeup must actually wait for the village row').toBe(true);
    release();
    await Promise.all([first, second]);
    const cohorts = await db
      .selectFrom('populationCohorts')
      .select('memberCount')
      .where('worldId', '=', worldId)
      .where('villageId', '=', id)
      .execute();
    expect(cohorts.reduce((n, c) => n + c.memberCount, 0)).toBe(15);
    expect(cohorts).toHaveLength(2);
  } finally {
    release();
    await Promise.allSettled([first, second].filter((p): p is Promise<void> => !!p));
    await db.deleteFrom('scheduledTasks').where('worldId', '=', worldId).where('subjectId', '=', id).execute();
    await db.deleteFrom('populationCohorts').where('worldId', '=', worldId).where('villageId', '=', id).execute();
    await db.deleteFrom('villages').where('worldId', '=', worldId).where('id', '=', id).execute();
  }
}, 20000);

import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../database/connection.js';
import { buildApp } from '../../app.js';
import { migrateToLatest } from '../../database/migrate.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import type { Database } from '../../database/schema.js';
import { DEVELOPMENT_CELLS, DEVELOPMENT_IDS } from '../../database/seed.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { discoverBuildingSupplies, feedPopulation, getVillageState, restPopulation } from '../villages/service.js';

const databaseUrl = testDatabaseUrl();
let db: Kysely<Database>;
const feedId = '11111111-1111-4111-8111-111111111111';

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

  it('credits the hidden supplies once when two requests race', async () => {
    const before = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    expect(before.cells.find((cell) => cell.building?.id === DEVELOPMENT_IDS.townHall)?.building?.hiddenSuppliesAvailable).toBe(true);
    const outcomes = await Promise.allSettled([
      discoverBuildingSupplies(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, DEVELOPMENT_IDS.townHall),
      discoverBuildingSupplies(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, DEVELOPMENT_IDS.townHall),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const state = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    expect(state.village.carrots).toBe(2050);
    expect(state.cells.find((cell) => cell.building?.id === DEVELOPMENT_IDS.townHall)?.building?.hiddenSuppliesAvailable).toBe(false);
  });
});

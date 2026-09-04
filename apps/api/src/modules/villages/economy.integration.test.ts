import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { VillageState } from '@arbestra/contracts';

import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import type { Database } from '../../database/schema.js';
import { DEVELOPMENT_IDS } from '../../database/seed.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { processNextScheduledTask } from '../../jobs/scheduled-tasks.js';
import { COMPLETE_CONSTRUCTION_TASK, completeConstruction } from './complete-construction.js';
import { constructBuilding, getVillageState, harvestGarden, upgradeBuilding } from './service.js';

const databaseUrl = testDatabaseUrl();
const handlers = { [COMPLETE_CONSTRUCTION_TASK]: completeConstruction };
let db: Kysely<Database>;

describe.sequential('economy with PostgreSQL', () => {
  beforeAll(async () => {
    await migrateToLatest(databaseUrl);
    await resetE2eState(databaseUrl);
    db = createDatabase(databaseUrl);
  });
  beforeEach(() => resetE2eState(databaseUrl));
  afterAll(async () => { await db?.destroy(); });

  async function build(type: 'sawmill' | 'garden' | 'dwelling', cellId: string): Promise<VillageState> {
    return constructBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, cellId, type, 10_000);
  }

  async function makeDue(buildingId: string): Promise<void> {
    await db.updateTable('buildings').set({
      constructionStartedAt: sql`transaction_timestamp() - interval '2 seconds'`,
      constructionCompletesAt: sql`transaction_timestamp() - interval '1 second'`,
    }).where('id', '=', buildingId).execute();
    await db.updateTable('scheduledTasks').set({
      dueAt: sql`transaction_timestamp() - interval '1 second'`,
      availableAt: sql`transaction_timestamp() - interval '1 second'`,
    }).where('subjectId', '=', buildingId).where('completedAt', 'is', null).execute();
    expect((await processNextScheduledTask(db, handlers))?.outcome).toBe('completed');
  }

  async function completeAt(cellId: string): Promise<string> {
    const building = await db.selectFrom('buildings').select('id').where('anchorCellId', '=', cellId).executeTakeFirstOrThrow();
    await makeDue(building.id);
    return building.id;
  }

  it('starts with whole resources and natural wood production', async () => {
    const state = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    expect(state.village.wood).toBe(2000);
    expect(state.village.carrots).toBe(50);
    expect(state.village.woodProductionPerHour).toBe(60);
    expect(Number.isInteger(state.village.wood)).toBe(true);
  });

  it('uses catalog production for sawmill levels 1, 2 and 3', async () => {
    await build('sawmill', DEVELOPMENT_IDS.sawmillCell);
    const id = await completeAt(DEVELOPMENT_IDS.sawmillCell);
    expect((await getVillageState(db, DEVELOPMENT_IDS.account, 'aube')).village.woodProductionPerHour).toBe(120);
    await upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id, undefined, 10_000);
    await makeDue(id);
    expect((await getVillageState(db, DEVELOPMENT_IDS.account, 'aube')).village.woodProductionPerHour).toBe(168);
    await upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id, undefined, 10_000);
    await makeDue(id);
    expect((await getVillageState(db, DEVELOPMENT_IDS.account, 'aube')).village.woodProductionPerHour).toBe(254.4);
  });

  it('projects long offline production without writing on ordinary reads', async () => {
    await db.updateTable('villageResourceFlows').set({
      remainder: 0, productionUpdatedAt: sql`transaction_timestamp() - interval '10 hours'`,
    }).where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').execute();
    expect((await getVillageState(db, DEVELOPMENT_IDS.account, 'aube')).village.wood).toBe(2600);
    const before = await db.selectFrom('villageResourceFlows').selectAll()
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
    await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    const after = await db.selectFrom('villageResourceFlows').selectAll()
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
    expect(after.productionUpdatedAt.getTime()).toBe(before.productionUpdatedAt.getTime());
    expect(after.remainder).toBe(before.remainder);
  });

  it('debits a concurrent duplicate construction exactly once', async () => {
    const results = await Promise.allSettled([
      build('sawmill', DEVELOPMENT_IDS.sawmillCell), build('sawmill', DEVELOPMENT_IDS.sawmillCell),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const wood = await db.selectFrom('villageResources').select('amount')
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
    expect(Number(wood.amount)).toBe(1950);
  });

  it('caps buffered production and prevents double harvest', async () => {
    await build('garden', DEVELOPMENT_IDS.gardenCell);
    const id = await completeAt(DEVELOPMENT_IDS.gardenCell);
    await db.updateTable('buildingResourceBuffers').set({
      storedAmount: 0, remainder: 0, productionUpdatedAt: sql`transaction_timestamp() - interval '20 hours'`,
    }).where('buildingId', '=', id).where('resourceCode', '=', 'carrot').execute();
    const capped = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    expect(capped.cells.find((cell) => cell.building?.id === id)?.building?.garden?.storedCarrots).toBe(600);
    await db.updateTable('buildingResourceBuffers').set({ storedAmount: 347, remainder: 0, productionUpdatedAt: sql`transaction_timestamp()` })
      .where('buildingId', '=', id).where('resourceCode', '=', 'carrot').execute();
    await Promise.all([
      harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id),
      harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id),
    ]);
    const carrots = await db.selectFrom('villageResources').select('amount')
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'carrot').executeTakeFirstOrThrow();
    expect(Number(carrots.amount)).toBe(397);
  });

  it('persists one chosen garden extension and rejects occupied cells', async () => {
    await build('dwelling', DEVELOPMENT_IDS.dwellingCell);
    await completeAt(DEVELOPMENT_IDS.dwellingCell);
    await build('garden', DEVELOPMENT_IDS.gardenCell);
    const id = await completeAt(DEVELOPMENT_IDS.gardenCell);
    await expect(upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id, DEVELOPMENT_IDS.dwellingCell, 10_000))
      .rejects.toMatchObject({ code: 'SITE_OCCUPIED' });
    const pending = await upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id, DEVELOPMENT_IDS.gardenNorthCell, 10_000);
    expect(pending.cells.find((cell) => cell.id === DEVELOPMENT_IDS.gardenNorthCell)?.footprint?.state).toBe('reserved');
    await makeDue(id);
    const completed = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    expect(completed.cells.find((cell) => cell.id === DEVELOPMENT_IDS.gardenNorthCell)?.footprint?.state).toBe('active');
    expect(completed.cells.find((cell) => cell.building?.id === id)?.building?.level).toBe(2);
  });

  it('lets only one concurrent upgrade reserve a cell', async () => {
    await build('garden', DEVELOPMENT_IDS.gardenCell);
    await build('garden', DEVELOPMENT_IDS.sawmillCell);
    const first = await completeAt(DEVELOPMENT_IDS.gardenCell);
    const second = await completeAt(DEVELOPMENT_IDS.sawmillCell);
    const results = await Promise.allSettled([
      upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, first, DEVELOPMENT_IDS.gardenNorthCell, 10_000),
      upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, second, DEVELOPMENT_IDS.gardenNorthCell, 10_000),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });
});

import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { VillageState } from '@arbestra/contracts';

import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import type { Database } from '../../database/schema.js';
import { DEVELOPMENT_CELLS, DEVELOPMENT_IDS } from '../../database/seed.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { processNextScheduledTask } from '../../jobs/scheduled-tasks.js';
import { COMPLETE_CONSTRUCTION_TASK, COMPLETE_EXPANSION_TASK, completeConstruction, completeExpansion } from './complete-construction.js';
import { constructBuilding, expandGarden, getVillageState, harvestGarden, upgradeBuilding } from './service.js';

const databaseUrl = testDatabaseUrl();
const handlers = { [COMPLETE_CONSTRUCTION_TASK]: completeConstruction, [COMPLETE_EXPANSION_TASK]: completeExpansion };
let db: Kysely<Database>;

describe.sequential('economy with PostgreSQL', () => {
  beforeAll(async () => {
    await migrateToLatest(databaseUrl);
    await resetE2eState(databaseUrl);
    db = createDatabase(databaseUrl);
  });
  beforeEach(() => resetE2eState(databaseUrl));
  afterAll(async () => { await db?.destroy(); });

  async function build(type: 'sawmill' | 'garden' | 'dwelling', cell: { cellX: number; cellY: number }): Promise<VillageState> {
    return constructBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, cell.cellX, cell.cellY, type, 10_000);
  }

  async function makeDue(buildingId: string): Promise<void> {
    await db.updateTable('buildings').set({
      constructionStartedAt: sql`transaction_timestamp() - interval '2 seconds'`,
      constructionCompletesAt: sql`transaction_timestamp() - interval '1 second'`,
    }).where('id', '=', buildingId).execute();
    await db.updateTable('buildingExpansions').set({
      startedAt: sql`transaction_timestamp() - interval '2 seconds'`,
      completesAt: sql`transaction_timestamp() - interval '1 second'`,
    }).where('buildingId', '=', buildingId).where('status', '=', 'under-construction').execute();
    const task = await db.selectFrom('scheduledTasks').leftJoin('buildingExpansions', (join) => join
      .onRef('buildingExpansions.id', '=', 'scheduledTasks.subjectId'))
      .select('scheduledTasks.id').where((eb) => eb.or([
        eb('scheduledTasks.subjectId', '=', buildingId),
        eb('buildingExpansions.buildingId', '=', buildingId),
      ])).where('scheduledTasks.completedAt', 'is', null).executeTakeFirstOrThrow();
    await db.updateTable('scheduledTasks').set({
      dueAt: sql`transaction_timestamp() - interval '1 second'`,
      availableAt: sql`transaction_timestamp() - interval '1 second'`,
    }).where('id', '=', task.id).execute();
    expect((await processNextScheduledTask(db, handlers))?.outcome).toBe('completed');
  }

  async function completeAt(cell: { cellX: number; cellY: number }): Promise<string> {
    const building = await db.selectFrom('worldCellOccupancies').innerJoin('buildings', 'buildings.id', 'worldCellOccupancies.buildingId')
      .select('buildings.id').where('worldCellOccupancies.cellX', '=', cell.cellX).where('worldCellOccupancies.cellY', '=', cell.cellY)
      .where('worldCellOccupancies.role', '=', 'anchor').executeTakeFirstOrThrow();
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
    await build('sawmill', DEVELOPMENT_CELLS.sawmill);
    const id = await completeAt(DEVELOPMENT_CELLS.sawmill);
    expect((await getVillageState(db, DEVELOPMENT_IDS.account, 'aube')).village.woodProductionPerHour).toBe(120);
    await upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id, undefined, undefined, 10_000);
    await makeDue(id);
    expect((await getVillageState(db, DEVELOPMENT_IDS.account, 'aube')).village.woodProductionPerHour).toBe(168);
    await upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id, undefined, undefined, 10_000);
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
      build('sawmill', DEVELOPMENT_CELLS.sawmill), build('sawmill', DEVELOPMENT_CELLS.sawmill),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const wood = await db.selectFrom('villageResources').select('amount')
      .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
    expect(Number(wood.amount)).toBe(1950);
  });

  it('treats a generated feature occupation as authoritative', async () => {
    const featureId = '60000000-0000-4000-8000-000000000001';
    try {
      await db.insertInto('worldFeatures').values({
        id: featureId, worldId: DEVELOPMENT_IDS.world, featureTypeCode: 'woodland',
        state: 'available', variantSeed: 1,
      }).execute();
      await db.insertInto('worldCellOccupancies').values({
        worldId: DEVELOPMENT_IDS.world, ...DEVELOPMENT_CELLS.sawmill,
        buildingId: null, featureId, role: 'body',
      }).execute();

      await expect(build('sawmill', DEVELOPMENT_CELLS.sawmill))
        .rejects.toMatchObject({ code: 'CELL_OCCUPIED' });
      const wood = await db.selectFrom('villageResources').select('amount')
        .where('villageId', '=', DEVELOPMENT_IDS.village).where('resourceCode', '=', 'wood').executeTakeFirstOrThrow();
      expect(Number(wood.amount)).toBe(2000);
    } finally {
      await db.deleteFrom('worldFeatures').where('id', '=', featureId).execute();
    }
  });

  it('caps buffered production and prevents double harvest', async () => {
    await build('garden', DEVELOPMENT_CELLS.garden);
    const id = await completeAt(DEVELOPMENT_CELLS.garden);
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
    await build('dwelling', DEVELOPMENT_CELLS.dwelling);
    await completeAt(DEVELOPMENT_CELLS.dwelling);
    await build('garden', DEVELOPMENT_CELLS.garden);
    const id = await completeAt(DEVELOPMENT_CELLS.garden);
    await expect(upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id, DEVELOPMENT_CELLS.dwelling.cellX, DEVELOPMENT_CELLS.dwelling.cellY, 10_000))
      .rejects.toMatchObject({ code: 'CELL_OCCUPIED' });
    const pending = await upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id, DEVELOPMENT_CELLS.gardenNorth.cellX, DEVELOPMENT_CELLS.gardenNorth.cellY, 10_000);
    expect(pending.cells.find((cell) => cell.cellX === DEVELOPMENT_CELLS.gardenNorth.cellX && cell.cellY === DEVELOPMENT_CELLS.gardenNorth.cellY)?.footprint?.state).toBe('reserved');
    await makeDue(id);
    const completed = await getVillageState(db, DEVELOPMENT_IDS.account, 'aube');
    expect(completed.cells.find((cell) => cell.cellX === DEVELOPMENT_CELLS.gardenNorth.cellX && cell.cellY === DEVELOPMENT_CELLS.gardenNorth.cellY)?.footprint?.state).toBe('active');
    expect(completed.cells.find((cell) => cell.building?.id === id)?.building?.garden?.activeCellCount).toBe(2);
  });

  it('lets only one concurrent upgrade reserve a cell', async () => {
    await build('garden', DEVELOPMENT_CELLS.garden);
    await build('garden', DEVELOPMENT_CELLS.sawmill);
    const first = await completeAt(DEVELOPMENT_CELLS.garden);
    const second = await completeAt(DEVELOPMENT_CELLS.sawmill);
    const results = await Promise.allSettled([
      upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, first, DEVELOPMENT_CELLS.gardenNorth.cellX, DEVELOPMENT_CELLS.gardenNorth.cellY, 10_000),
      upgradeBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, second, DEVELOPMENT_CELLS.gardenNorth.cellX, DEVELOPMENT_CELLS.gardenNorth.cellY, 10_000),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('harvests both production rates when an expansion is overdue and the worker has not run', async () => {
    await build('garden', DEVELOPMENT_CELLS.garden);
    const id = await completeAt(DEVELOPMENT_CELLS.garden);
    await expandGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village,
      id, [DEVELOPMENT_CELLS.gardenNorth], 10_000);
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('buildingResourceBuffers').set({
        storedAmount: 0, remainder: 0,
        productionUpdatedAt: sql`transaction_timestamp() - interval '2 hours'`,
      }).where('buildingId', '=', id).execute();
      await tx.updateTable('buildingExpansions').set({
        startedAt: sql`transaction_timestamp() - interval '90 minutes'`,
        completesAt: sql`transaction_timestamp() - interval '1 hour'`,
      }).where('buildingId', '=', id).execute();
    });

    // No snapshot or worker before the command: 1h at 60 + 1h at 120.
    const harvested = await harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id);
    expect(harvested.village.carrots).toBe(50 + 60 + 120);
    expect(harvested.cells.find((cell) => cell.building?.id === id)?.building?.garden)
      .toMatchObject({ activeCellCount: 2, pendingCellCount: 0, expansion: null, storedCarrots: 0, capacity: 1200 });
    const again = await harvestGarden(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village, id);
    expect(again.village.carrots).toBe(harvested.village.carrots);
  });
});

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { sql } from 'kysely';
import { SYNC_V2_PRIVATE_COMPONENTS, SyncV2BatchSchema, type ProcessingCommand } from '@arbestra/contracts';
import { Value } from '@sinclair/typebox/value';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS as ids } from '../../database/seed.js';
import { commandProcessing, completeProcessingAt, processingSnapshot } from './processing.js';
import { readPopulationProjection } from '../population/projection.js';
import { projectVillageResources } from './economy.js';
import { readRegisteredPrivateChanges, readPrivateScopeSnapshot, privateReaderComponents } from './sync-v2-readers.js';
import type { state as stateType } from './service.js';

const enabled = process.env.ARBESTRA_HISTORICAL_ORACLE === '1';
const url = testDatabaseUrl(), target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test') throw Error('Unexpected oracle database');
const db = createDatabase(url), through = new Date('2026-10-21T12:00:00Z');
afterAll(() => db.destroy());
type Processing = { commandProcessing: typeof commandProcessing; completeProcessingAt: typeof completeProcessingAt; processingSnapshot: typeof processingSnapshot };
type WithoutIdentifiers<T> = T extends unknown ? Omit<T, 'commandId' | 'buildingId' | 'orderId'> : never;

it.runIf(enabled)('matches the isolated historical processing oracle across starts, paid pauses, resumes, cancellation and shortage', async () => {
  const root = resolve('test-results/command-sync/oracle-4966379');
  const manifest = JSON.parse(readFileSync(resolve(root, 'oracle-manifest.json'), 'utf8'));
  expect(manifest.revision).toBe('496637925666b6474a04231d15c368a2d2f8c8a6');
  const reference = await import(/* @vite-ignore */ pathToFileURL(resolve(root, 'apps/api/dist/modules/villages/processing.js')).href) as Processing;
  expect(reference.commandProcessing).not.toBe(commandProcessing);
  async function run(implementation: Processing) {
    await resetE2eState(url);
    // A single eligible member removes random UUID tie-breaking between two
    // independently reset fixtures; it still exercises fatigue and release.
    await db.updateTable('populationCohorts').set({ memberCount: 1, energy: 10, energyProgress: 0, energyUpdatedAt: through }).where('worldId', '=', ids.world).execute();
    const building = await db.insertInto('buildings').values({ worldId: ids.world, villageId: ids.village,
      buildingType: 'sawmill', level: 1, targetLevel: null, status: 'completed', completedAt: through,
      constructionStartedAt: null, constructionCompletesAt: null,
    }).returning('id').executeTakeFirstOrThrow();
    const observations: unknown[] = [];
    let orderId = '', offset = 0;
    const context = () => ({ worldId: ids.world, villageId: ids.village, through: new Date(through.getTime() + offset) });
    async function command(input: WithoutIdentifiers<ProcessingCommand>) {
      const request = { ...input, commandId: randomUUID(), ...(input.action === 'start' ? { buildingId: building.id } : { orderId }) } as ProcessingCommand;
      await db.transaction().execute(async tx => {
        await tx.selectFrom('villages').select('id').where('id', '=', ids.village).forUpdate().executeTakeFirstOrThrow();
        await implementation.commandProcessing(tx, context(), request);
        await implementation.commandProcessing(tx, context(), request);
        orderId = (await implementation.processingSnapshot(tx, context()))[0]!.id;
      });
      await capture();
    }
    async function complete() {
      await db.transaction().execute(async tx => {
        await tx.selectFrom('villages').select('id').where('id', '=', ids.village).forUpdate().executeTakeFirstOrThrow();
        const order = (await implementation.processingSnapshot(tx, context())).find(order => order.id === orderId)!;
        const at = new Date(order.currentLot!.completesAt); offset = at.getTime() - through.getTime();
        await implementation.completeProcessingAt(tx, context(), order.currentLot!.id, at);
      });
      await capture();
    }
    async function capture() {
      const stocks = await db.selectFrom('villageResources').select(['resourceCode', 'amount']).where('villageId', '=', ids.village).orderBy('resourceCode').execute();
      const cohorts = await db.selectFrom('populationCohorts').select(['memberCount', 'activity', 'energy', 'energyProgress', 'energyUpdatedAt', 'processingLotId'])
        .where('villageId', '=', ids.village).execute();
      const orders = await db.selectFrom('processingOrders').select(['status', 'blockedReason', 'requestedLots', 'completedLots', 'workerCount', 'createdAt', 'finishedAt'])
        .where('villageId', '=', ids.village).orderBy('createdAt').execute();
      const lots = await db.selectFrom('processingLots').select(['lotNumber', 'inputAmount', 'outputAmount', 'startedAt', 'completesAt', 'completedAt'])
        .where('villageId', '=', ids.village).orderBy('startedAt').orderBy('lotNumber').execute();
      const tasks = await db.selectFrom('scheduledTasks').select(['taskType', 'dueAt', 'completedAt']).where('worldId', '=', ids.world)
        .where('taskType', '=', 'processing.complete').orderBy('dueAt').execute();
      observations.push({ stocks, cohorts: cohorts.map(({ processingLotId, ...cohort }) => ({ ...cohort, assigned: !!processingLotId }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), orders, lots, tasks });
    }
    await command({ action: 'start', lots: 3, workerCount: 1 });
    await command({ action: 'pause' }); await complete();
    offset += 1000; await command({ action: 'resume', workerCount: 1 });
    await command({ action: 'cancel' }); await complete();
    await db.updateTable('villageResources').set({ amount: 0 }).where('villageId', '=', ids.village).where('resourceCode', '=', 'wood').execute();
    offset += 1000; await command({ action: 'start', durationSeconds: 3600, workerCount: 1 });
    await command({ action: 'pause' }); await command({ action: 'resume', workerCount: 1 }); await command({ action: 'cancel' });
    return observations;
  }
  const historical = await run(reference);
  expect(await run({ commandProcessing, completeProcessingAt, processingSnapshot })).toEqual(historical);
}, 120000);

it.runIf(enabled)('matches selected population and resource readers against the historical full projection in one read-only view', async () => {
  const reference = await import(/* @vite-ignore */ pathToFileURL(resolve('test-results/command-sync/oracle-4966379/apps/api/dist/modules/villages/service.js')).href) as { state: typeof stateType };
  await resetE2eState(url);
  await db.updateTable('populationCohorts').set({ energy: 7, energyProgress: 12345, energyUpdatedAt: new Date(through.getTime() - 3600000) })
    .where('worldId', '=', ids.world).execute();
  await db.transaction().setIsolationLevel('repeatable read').execute(async tx => {
    await sql`set transaction read only`.execute(tx);
    const context = { worldId: ids.world, villageId: ids.village, through };
    const historical = await reference.state(tx, ids.account, 'aube', context, false, true);
    expect(await readPopulationProjection(tx, ids.world, ids.village, through)).toEqual(historical.village.population);
    const resources = await projectVillageResources(tx, ids.world, ids.village, through, ['wood']);
    expect(resources.map(row => ({ ...row, productionUpdatedAt: row.productionUpdatedAt?.toISOString() ?? null })))
      .toEqual(historical.village.resources.filter(row => row.code === 'wood'));
    const id = historical.village.population.cohorts![0]!.id;
    const selected = await readRegisteredPrivateChanges(tx, context, [{ component: 'cohorts', key: id }]);
    expect(selected).toHaveLength(1);
    if (selected[0]?.component !== 'cohorts') throw Error('Wrong selected component');
    const { clock, ...view } = selected[0].upsert[0]!;
    expect(view).toEqual(historical.village.population.cohorts![0]);
    expect(clock.progress).toBe(12345);
    const building = historical.cells.find(cell => cell.building)?.building;
    expect(building).toBeDefined();
    const selectedViews = await readRegisteredPrivateChanges(tx, context, [
      { component: 'buildings', key: building!.id }, { component: 'extractionPools', key: 'wood' },
      { component: 'gardenPlots', key: '0,0' }, { component: 'gardenHarvests', key: randomUUID() },
      { component: 'buildingExpansions', key: randomUUID() },
    ]);
    const { garden: _garden, ...buildingView } = building!;
    void _garden;
    expect(selectedViews[0]).toEqual({ component: 'buildings', upsert: [buildingView], remove: [] });
    expect(selectedViews[1]).toEqual({ component: 'extractionPools', upsert: (historical.village.extractionPools ?? []).filter(pool => pool.resource === 'wood'), remove: [] });
    expect(selectedViews[2]).toEqual({ component: 'gardenPlots', upsert: [], remove: ['0,0'] });
    expect(selectedViews.slice(3).every(change => change.upsert.length === 0 && change.remove.length === 1)).toBe(true);
    expect(await readRegisteredPrivateChanges(tx, context, [{ component: 'processingOrders', key: randomUUID() }]))
      .toMatchObject([{ component: 'processingOrders', upsert: [] }]);
    await expect(readRegisteredPrivateChanges(tx, context, [{ component: 'unregistered', key: '*' }]))
      .rejects.toThrow('Unregistered private synchronization component');
    const snapshot = await readPrivateScopeSnapshot(tx, context);
    expect(new Set(snapshot.map(change => change.component))).toEqual(new Set(SYNC_V2_PRIVATE_COMPONENTS));
    expect(privateReaderComponents).toEqual(new Set(SYNC_V2_PRIVATE_COMPONENTS));
    const payload = { protocol: 2, worldId: ids.world, villageId: ids.village, generation: 1,
      observedAt: through.toISOString(), coverage: 'scope-snapshot', groups: [{
        stream: { kind: 'village', key: ids.village, epoch: randomUUID() }, fromRevision: '0', toRevision: '0', changes: snapshot,
      }] };
    expect([...Value.Errors(SyncV2BatchSchema, payload)].map(error => ({ path: error.path, message: error.message }))).toEqual([]);
    expect(snapshot.find(change => change.component === 'extractionPools')?.upsert)
      .toEqual([...(historical.village.extractionPools ?? [])].sort((a, b) => a.resource.localeCompare(b.resource)));
  });
}, 120000);

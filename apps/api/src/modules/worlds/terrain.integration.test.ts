import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type KyselyPlugin, type QueryId } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TerrainResponse, TerrainUpdatesResponse, TerrainOverview, TerrainVegetationOverview } from '@arbestra/contracts';
import { buildApp } from '../../app.js';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS, DEVELOPMENT_CELLS } from '../../database/seed.js';
import type { Database } from '../../database/schema.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { getTerrain, getTerrainUpdates, parseTerrainChunks } from './terrain.js';
import { constructBuilding } from '../villages/service.js';

describe.sequential('read-only streamed terrain', () => {
  const databaseUrl = testDatabaseUrl();
  let db: Kysely<Database>, app: FastifyInstance, cookie: string;
  beforeAll(async () => {
    await migrateToLatest(databaseUrl); db = createDatabase(databaseUrl);
    app = await buildApp({ databaseUrl, host: '127.0.0.1', port: 0, isProduction: false, cookieName: 'arbestra_session',
      sessionTtlDays: 30, constructionDurationOverrideMs: 10000, scheduledTaskPollIntervalMs: 250 }, db);
  });
  beforeEach(async () => {
    await db.updateTable('villages').set({ anchorCellX: 1024, anchorCellY: 512 }).where('id', '=', DEVELOPMENT_IDS.village).execute();
    await resetE2eState(databaseUrl);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'player@arbestra.local', password: 'arbestra' } });
    cookie = String(login.headers['set-cookie']).split(';')[0]!;
  }, 60_000); // Bound database reset/login separately from each terrain assertion.
  afterAll(async () => { await app?.close(); await db?.deleteFrom('accounts').where('email', 'like', '%@terrain.test').execute(); await db?.destroy(); });
  // These geometry/read-only proofs deliberately inspect full generated terrain.
  // Player knowledge and the production preview guard are covered separately.
  const previewHeaders = { 'x-arbestra-science-preview': '1' };
  const request = (chunks: string, world = 'aube', auth = cookie) => app.inject({ url: `/api/worlds/${world}/terrain?chunks=${encodeURIComponent(chunks)}`, headers: { cookie: auth, ...previewHeaders } });
  const updates = (chunks: string, world = 'aube', auth = cookie) => app.inject({ url: `/api/worlds/${world}/terrain/updates?chunks=${encodeURIComponent(chunks)}`, headers: { cookie: auth, ...previewHeaders } });

  it('serves an authorized, bounded overview of persisted terrain and separate vegetation', async () => {
    const url = '/api/worlds/aube/terrain/overview';
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/worlds/other/terrain/overview', headers: { cookie } })).statusCode).toBe(404);
    const response = await app.inject({ url, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const overview = response.json<TerrainOverview>();
    expect(overview.gridWidth).toBe(512); expect(overview.gridHeight).toBe(256);
    expect(overview.waterCoverage).toHaveLength(512 * 256);
    const persisted = await db.selectFrom('worldChunks').select(['terrainCodes', 'elevations'])
      .where('worldId', '=', DEVELOPMENT_IDS.world).where('chunkX', '=', 0).where('chunkY', '=', 0).executeTakeFirstOrThrow();
    const first = [0, 1, 2, 3].flatMap(y => [0, 1, 2, 3].map(x => y * 32 + x));
    expect(overview.meanElevations[0]).toBeCloseTo(first.reduce((sum, i) => sum + persisted.elevations[i]!, 0) / 16);
    expect(overview.waterCoverage[0]).toBe(Math.round(first.filter(i => persisted.terrainCodes[i] === 2).length * 255 / 16));
    expect(overview.waterCoverage[0]! + overview.rockCoverage[0]!).toBeLessThanOrEqual(255);
    const etag = response.headers.etag;
    expect((await app.inject({ url, headers: { cookie, ...previewHeaders, 'if-none-match': etag } })).statusCode).toBe(304);
    expect((await app.inject({ url, headers: { 'if-none-match': etag } })).statusCode).toBe(401);
    const vegetation = await app.inject({ url: `${url}/vegetation`, headers: { cookie } });
    expect(vegetation.statusCode).toBe(200);
    const density = vegetation.json<TerrainVegetationOverview>();
    expect(density.woodlandCoverage).toHaveLength(512 * 256);
    expect(density.woodlandCoverage.some(value => value > 0)).toBe(true);
    expect(density.world).toEqual(overview.world);
    expect(JSON.stringify(density)).not.toMatch(/terrainCodes|elevations|featureId/);
  });

  it('serves bounded public village silhouettes across seams without business writes or private state', async () => {
    const url = '/api/worlds/aube/terrain/overview/villages?x=1024&y=512';
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url: url.replace('aube', 'other'), headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ url: url.replace('1024', '9007199254740992'), headers: { cookie } })).statusCode).toBe(400);
    const response = await app.inject({ url, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.villages).toHaveLength(1);
    expect(data.villages[0]).toMatchObject({ id: DEVELOPMENT_IDS.village, anchorCellX: 1024, anchorCellY: 512,
      blocks: [{ x: -1, y: 0, width: 1, depth: 1, garden: false }] });
    expect(JSON.stringify(data)).not.toMatch(/owner|resources|population|level|status|buildingId|production/);
    const before = await db.selectFrom('buildings').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).execute();
    const occupancies = await db.selectFrom('worldCellOccupancies').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world)
      .where(eb => eb.or([eb('buildingId', '=', DEVELOPMENT_IDS.townHall), eb.and([eb('cellX', 'in', [2047, 0]), eb('cellY', '=', 1023)])])).execute();
    try {
    await db.updateTable('villages').set({ anchorCellX: 0, anchorCellY: 0 }).where('id', '=', DEVELOPMENT_IDS.village).execute();
    await db.deleteFrom('worldCellOccupancies').where('worldId', '=', DEVELOPMENT_IDS.world).where('buildingId', '=', DEVELOPMENT_IDS.townHall).execute();
    await db.deleteFrom('worldCellOccupancies').where('worldId', '=', DEVELOPMENT_IDS.world).where('cellX', 'in', [2047, 0]).where('cellY', '=', 1023).execute();
    await db.insertInto('worldCellOccupancies').values([2047, 0].map(cellX => ({ worldId: DEVELOPMENT_IDS.world,
      cellX, cellY: 1023, buildingId: DEVELOPMENT_IDS.townHall, featureId: null, role: 'extension' as const }))).execute();
    const seam = await app.inject({ url: '/api/worlds/aube/terrain/overview/villages?x=2047&y=1023', headers: { cookie } });
    expect(seam.statusCode).toBe(200);
    expect(seam.json().villages[0].blocks).toEqual([{ x: -.5, y: -1, width: 2, depth: 1, garden: false }]);
    expect(await db.selectFrom('buildings').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).execute()).toEqual(before);
    const far = await app.inject({ url, headers: { cookie } }); expect(far.json().villages).toEqual([]);
    } finally {
      await db.updateTable('villages').set({ anchorCellX: 1024, anchorCellY: 512 }).where('id', '=', DEVELOPMENT_IDS.village).execute();
      await db.deleteFrom('worldCellOccupancies').where('worldId', '=', DEVELOPMENT_IDS.world)
        .where(eb => eb.or([eb('buildingId', '=', DEVELOPMENT_IDS.townHall), eb.and([eb('cellX', 'in', [2047, 0]), eb('cellY', '=', 1023)])])).execute();
      if (occupancies.length) await db.insertInto('worldCellOccupancies').values(occupancies).execute();
    }
  });

  it('projects anonymous foreign volumes and preserves dated reports without duplicates', async () => {
    const worldId = DEVELOPMENT_IDS.world, accountId = randomUUID(), villageId = randomUUID();
    const url = '/api/worlds/aube/terrain/overview/villages?x=1024&y=512';
    try {
      await db.insertInto('accounts').values({ id: accountId, email: `${accountId}@terrain.test`, passwordHash: 'unused' }).execute();
      await db.insertInto('worldMemberships').values({ worldId, accountId, playerName: 'Foreign silhouette' }).execute();
      await db.insertInto('villages').values({ id: villageId, worldId, ownerAccountId: accountId, name: 'Secret name', anchorCellX: 1030, anchorCellY: 520 }).execute();
      const building = await db.insertInto('buildings').values({ worldId, villageId, buildingType: 'dwelling', level: 1,
        status: 'under-construction', targetLevel: null, constructionStartedAt: new Date(), constructionCompletesAt: new Date(Date.now() + 60000), completedAt: null }).returning('id').executeTakeFirstOrThrow();
      await db.insertInto('worldCellOccupancies').values({ worldId, buildingId: building.id, featureId: null, cellX: 1030, cellY: 520, role: 'anchor' }).execute();
      const read = async () => (await app.inject({ url, headers: { cookie } })).json();
      const anonymous = (await read()).villages.find((v: { anchorCellX: number }) => v.anchorCellX === 1030);
      expect(anonymous).toEqual({ anchorCellX: 1030, anchorCellY: 520, blocks: [{ x: 0, y: 0, width: 1, depth: 1 }] });
      expect(JSON.stringify(anonymous)).not.toMatch(new RegExp(`${villageId}|${building.id}|Secret|garden|underConstruction`));
      await db.insertInto('playerScience').values({ worldId, accountId: DEVELOPMENT_IDS.account, observationsSince: null, solarReport: null }).execute();
      const observedAt = new Date('2026-01-01T00:00:00Z');
      const blocks = [{ x: -2, y: 0, width: 2, depth: 1, garden: false }];
      await db.insertInto('scienceVillageReports').values({ worldId, accountId: DEVELOPMENT_IDS.account, villageId,
        name: 'Old report name', anchorCellX: 1030, anchorCellY: 520, observedAt, blocks: JSON.stringify(blocks) }).execute();
      const reported = (await read()).villages.filter((v: { anchorCellX: number }) => v.anchorCellX === 1030);
      expect(reported).toEqual([{ id: villageId, anchorCellX: 1030, anchorCellY: 520, blocks }]);
      expect(await db.selectFrom('scienceVillageReports').select(['name', 'observedAt', 'blocks']).where('worldId', '=', worldId)
        .where('accountId', '=', DEVELOPMENT_IDS.account).where('villageId', '=', villageId).executeTakeFirstOrThrow())
        .toEqual({ name: 'Old report name', observedAt, blocks });
    } finally {
      await db.deleteFrom('scienceVillageReports').where('worldId', '=', worldId).where('villageId', '=', villageId).execute();
      await db.deleteFrom('playerScience').where('worldId', '=', worldId).where('accountId', '=', DEVELOPMENT_IDS.account).execute();
      await db.deleteFrom('worldCellOccupancies').where('worldId', '=', worldId).where('buildingId', 'in',
        db.selectFrom('buildings').select('id').where('worldId', '=', worldId).where('villageId', '=', villageId)).execute();
      await db.deleteFrom('buildings').where('worldId', '=', worldId).where('villageId', '=', villageId).execute();
      await db.deleteFrom('villages').where('worldId', '=', worldId).where('id', '=', villageId).execute();
      await db.deleteFrom('worldMemberships').where('worldId', '=', worldId).where('accountId', '=', accountId).execute();
      await db.deleteFrom('accounts').where('id', '=', accountId).execute();
    }
  });

  it('shows player landscape over HTTP but ignores the deposit preview header in production', async()=>{
    const url='/api/worlds/aube/terrain?chunks=0%2C0';
    const normal=await app.inject({url,headers:{cookie}});
    expect(normal.statusCode).toBe(200);
    expect(normal.json<TerrainResponse>().chunks[0]!.terrainCodes.every(c=>c>0)).toBe(true);
    const prod=await buildApp({databaseUrl,host:'127.0.0.1',port:0,isProduction:true,cookieName:'arbestra_session',sessionTtlDays:30,
      constructionDurationOverrideMs:null,scheduledTaskPollIntervalMs:250},db);
    try{
      const attempted=await prod.inject({url,headers:{cookie,...previewHeaders}});
      expect(attempted.statusCode).toBe(200);
      expect(attempted.json<TerrainResponse>().chunks[0]!.terrainCodes.every(c=>c>0)).toBe(true);
      const overview=await prod.inject({url:'/api/worlds/aube/terrain/overview',headers:{cookie,...previewHeaders,'if-none-match':'"old-world-cache"'}});
      expect(overview.statusCode).toBe(200);expect(overview.headers['cache-control']).toBe('private, no-store');
      expect(overview.json()).not.toHaveProperty('knowledgeCoverage');
      expect(overview.json<TerrainOverview>().meanElevations).toEqual((await app.inject({url:'/api/worlds/aube/terrain/overview',headers:{cookie}})).json<TerrainOverview>().meanElevations);
      expect(attempted.json<TerrainResponse>().chunks[0]!.features.every(f=>f.deposit===null)).toBe(true);
    }finally{await prod.close();}
  });

  it('refreshes only mutable data with the same access and batch bounds, without reading world_chunks', async () => {
    expect((await updates('0,0', 'aube', '')).statusCode).toBe(401);
    expect((await updates('0,0', 'another-world')).statusCode).toBe(404);
    expect((await updates(Array(17).fill('0,0').join(';'))).statusCode).toBe(400);
    const full = (await request('31,15;32,16')).json<TerrainResponse>();
    const response = await updates('31,15;32,16'); expect(response.statusCode).toBe(200);
    const data = response.json<TerrainUpdatesResponse>();
    expect(data.world).toEqual(full.world);
    expect(data.chunks).toEqual(full.chunks.map(c => ({ chunkX: c.chunkX, chunkY: c.chunkY,
      originCellX: c.originCellX, originCellY: c.originCellY, features: c.features, occupiedCells: c.occupiedCells })));
    expect(JSON.stringify(data)).not.toMatch(/terrainCodes|elevations/);
    expect(response.rawPayload.length).toBeLessThan(Buffer.byteLength(JSON.stringify(full)));
    let reads = 0;
    const plugin: KyselyPlugin = { transformQuery(args) {
      if (JSON.stringify(args.node).includes('world_chunks')) reads++; return args.node;
    }, transformResult: async args => args.result };
    await getTerrainUpdates(db.withPlugin(plugin), DEVELOPMENT_IDS.account, 'aube', '31,15;32,16');
    expect(reads).toBe(0);
  });

  it('bounds raw input before deduplication, rejects unsafe integers and requires world access', async () => {
    expect(() => parseTerrainChunks(Array(17).fill('0,0').join(';'))).toThrow();
    for (const raw of ['0,0;', '1.2,0', '9007199254740992,0', 'NaN,0']) expect((await request(raw)).statusCode).toBe(400);
    expect((await request('0,0', 'aube', '')).statusCode).toBe(401);
    expect((await request('0,0', 'another-world')).statusCode).toBe(404);
    const accountId = randomUUID();
    await db.insertInto('accounts').values({ id: accountId, email: `${accountId}@terrain.test`, passwordHash: 'unused' }).execute();
    try {
      await db.insertInto('worldMemberships').values({ worldId: DEVELOPMENT_IDS.world, accountId, playerName: 'Terrain reader' }).execute();
      await expect(getTerrain(db, accountId, 'aube', '0,0')).rejects.toMatchObject({ code: 'VILLAGE_NOT_FOUND' });
    } finally {
      await db.deleteFrom('worldMemberships').where('accountId', '=', accountId).execute();
      await db.deleteFrom('accounts').where('id', '=', accountId).execute();
    }
  });
  it('returns canonical complete interiors and the halo across both torus seams', async () => {
    const response = await request('-1,-1;63,31;0,0'); expect(response.statusCode).toBe(200);
    const data = response.json<TerrainResponse>(); expect(data.chunks).toHaveLength(2);
    const all = await db.selectFrom('worldChunks').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).execute();
    const rows = new Map(all.map(c => [`${c.chunkX}:${c.chunkY}`, c]));
    for (const c of data.chunks) {
      expect(c.terrainCodes).toHaveLength(34 ** 2); expect(c.elevations).toHaveLength(34 ** 2);
      for (let y = -1; y <= 32; y++) for (let x = -1; x <= 32; x++) {
        const cx = (c.originCellX + x + 2048) % 2048, cy = (c.originCellY + y + 1024) % 1024;
        const row = rows.get(`${Math.floor(cx / 32)}:${Math.floor(cy / 32)}`)!;
        expect(c.terrainCodes[(y + 1) * 34 + x + 1]).toBe(row.terrainCodes[(cy % 32) * 32 + cx % 32]);
        expect(c.elevations[(y + 1) * 34 + x + 1]).toBe(row.elevations[(cy % 32) * 32 + cx % 32]);
      }
      expect(c.features.every(f => f.cellX >= c.originCellX && f.cellX < c.originCellX + 32 && f.cellY >= c.originCellY && f.cellY < c.originCellY + 32)).toBe(true);
    }
    expect(JSON.stringify(data)).not.toMatch(/villageId|ownerAccountId|storedCarrots|productionUpdatedAt/);
  });
  it('returns depleted tombstones without occupancies and leaves all overdue business untouched', async () => {
    await db.updateTable('villageResources').set({amount:25}).where('worldId','=',DEVELOPMENT_IDS.world)
      .where('villageId','=',DEVELOPMENT_IDS.village).where('resourceCode','=','timber').execute();
    await db.updateTable('villageResources').set({amount:10}).where('worldId','=',DEVELOPMENT_IDS.world)
      .where('villageId','=',DEVELOPMENT_IDS.village).where('resourceCode','=','cut-stone').execute();
    const state = await constructBuilding(db, DEVELOPMENT_IDS.account, 'aube', DEVELOPMENT_IDS.village,
      DEVELOPMENT_CELLS.dwelling.cellX, DEVELOPMENT_CELLS.dwelling.cellY, 'dwelling', 10000);
    const building = state.cells.find(c => c.building?.type === 'dwelling')!.building!;
    await db.updateTable('buildings').set({ constructionStartedAt: sql`statement_timestamp() - interval '2 seconds'`, constructionCompletesAt: sql`statement_timestamp() - interval '1 second'` }).where('id', '=', building.id).execute();
    const stone = await db.selectFrom('stoneDeposits').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).executeTakeFirstOrThrow();
    await db.updateTable('stoneDeposits').set({ remainingAmount: 0, reservedAmount: 0, revision: 7 }).where('featureId', '=', stone.featureId).where('worldId', '=', stone.worldId).execute();
    await db.deleteFrom('worldCellOccupancies').where('featureId', '=', stone.featureId).where('worldId', '=', stone.worldId).execute();
    const before = await sql<{ data: unknown }>`select jsonb_build_object(
      'buildings', (select jsonb_agg(to_jsonb(t) order by id) from buildings t),
      'tasks', (select jsonb_agg(to_jsonb(t) order by id) from scheduled_tasks t),
      'resources', (select jsonb_agg(to_jsonb(t) order by resource_code) from village_resources t),
      'deposits', (select jsonb_agg(to_jsonb(t) order by feature_id) from stone_deposits t)) as data`.execute(db);
    const data = (await request(`${Math.floor(stone.cellX / 32)},${Math.floor(stone.cellY / 32)}`)).json<TerrainResponse>();
    expect(data.chunks[0]!.features.find(f => f.id === stone.featureId)?.deposit).toMatchObject({ state: 'depleted', revision: 7 });
    expect(data.chunks[0]!.occupiedCells).not.toContainEqual({ cellX: stone.cellX, cellY: stone.cellY });
    const refreshed = (await updates(`${Math.floor(stone.cellX / 32)},${Math.floor(stone.cellY / 32)}`)).json<TerrainUpdatesResponse>();
    expect(refreshed.chunks[0]!.features.find(f => f.id === stone.featureId)?.deposit).toMatchObject({ state: 'depleted', revision: 7 });
    expect(refreshed.chunks[0]!.occupiedCells).not.toContainEqual({ cellX: stone.cellX, cellY: stone.cellY });
    const after = await sql<{ data: unknown }>`select jsonb_build_object(
      'buildings', (select jsonb_agg(to_jsonb(t) order by id) from buildings t),
      'tasks', (select jsonb_agg(to_jsonb(t) order by id) from scheduled_tasks t),
      'resources', (select jsonb_agg(to_jsonb(t) order by resource_code) from village_resources t),
      'deposits', (select jsonb_agg(to_jsonb(t) order by feature_id) from stone_deposits t)) as data`.execute(db);
    expect(after.rows).toEqual(before.rows);
  });
  it('rejects missing halo or a world not ready instead of inventing terrain', async () => {
    const original = await db.selectFrom('worldChunks').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).where('chunkX', '=', 63).where('chunkY', '=', 31).executeTakeFirstOrThrow();
    try {
      await db.deleteFrom('worldChunks').where('worldId', '=', DEVELOPMENT_IDS.world).where('chunkX', '=', 63).where('chunkY', '=', 31).execute();
      expect((await request('0,0')).json()).toMatchObject({ code: 'WORLD_NOT_READY' });
      await db.updateTable('worlds').set({ generationStatus: 'generating' }).where('id', '=', DEVELOPMENT_IDS.world).execute();
      expect((await request('12,12')).json()).toMatchObject({ code: 'WORLD_NOT_READY' });
    } finally {
      await db.insertInto('worldChunks').values(original).onConflict(c => c.columns(['worldId', 'chunkX', 'chunkY']).doNothing()).execute();
      await db.updateTable('worlds').set({ generationStatus: 'ready' }).where('id', '=', DEVELOPMENT_IDS.world).execute();
    }
  });
  it.each(['full', 'updates'] as const)('reads %s features and occupancies from one repeatable snapshot during a concurrent depletion', async mode => {
    const stone = await db.selectFrom('stoneDeposits').selectAll().where('worldId', '=', DEVELOPMENT_IDS.world).where('remainingAmount', '>', '0').executeTakeFirstOrThrow();
    let release!: () => void, reached!: () => void;
    const blocked = new Promise<void>(r => { release = r; }), observed = new Promise<void>(r => { reached = r; });
    const ids = new Set<QueryId>();
    const plugin: KyselyPlugin = {
      transformQuery(args) { if (JSON.stringify(args.node).includes(mode === 'full' ? 'world_chunks' : 'world_cell_occupancies')) ids.add(args.queryId); return args.node; },
      async transformResult(args) { if (ids.has(args.queryId)) { reached(); await blocked; } return args.result; },
    };
    const reader = (mode === 'full' ? getTerrain : getTerrainUpdates)(db.withPlugin(plugin), DEVELOPMENT_IDS.account, 'aube', `${Math.floor(stone.cellX / 32)},${Math.floor(stone.cellY / 32)}`, true);
    let result: TerrainResponse | TerrainUpdatesResponse | undefined;
    try {
      await Promise.race([observed, new Promise((_, reject) => setTimeout(() => reject(new Error('terrain barrier not reached')), 3000))]);
      await db.transaction().execute(async tx => {
        await tx.updateTable('stoneDeposits').set({ remainingAmount: 0, reservedAmount: 0, revision: 99 }).where('worldId', '=', stone.worldId).where('featureId', '=', stone.featureId).execute();
        await tx.deleteFrom('worldCellOccupancies').where('worldId', '=', stone.worldId).where('featureId', '=', stone.featureId).execute();
      });
    } finally { release(); result = await reader; }
    expect(result.chunks[0]!.features.find(f => f.id === stone.featureId)?.deposit?.remainingAmount).toBe(Number(stone.remainingAmount));
    expect(result.chunks[0]!.occupiedCells).toContainEqual({ cellX: stone.cellX, cellY: stone.cellY });
  });
});

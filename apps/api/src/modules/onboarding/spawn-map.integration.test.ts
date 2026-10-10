import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createSpawnSurfaceIndex, type GeneratedLandscape, type TravelCell } from '@arbestra/contracts';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../database/connection.js';
import { migrateToLatest } from '../../database/migrate.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { hashSessionToken } from '../../security/sessions.js';
import { artifactChecksum } from '../world-generator/artifact.js';
import { RC1_CANONICAL_CHECKSUM, starterSpawnSurfaces } from './spawn-map.js';
import { spawnSpatialState } from './spawn-state.js';

const url = testDatabaseUrl(), target = new URL(url);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/arbestra_test') throw Error('Unexpected spawn-map test target');
const db = createDatabase(url), config = loadConfig({ ...process.env, DATABASE_URL: url, NODE_ENV: 'test' });
const accountId = randomUUID(), token = randomUUID(), worldId = randomUUID(), closedId = randomUUID(), otherId = randomUUID();
const slug = 'spawn-map-' + worldId, closedSlug = 'spawn-closed-' + closedId;
const artifact = JSON.parse(readFileSync(new URL('../../../../world-web/public/studies/t1-alpha512-rc1.json', import.meta.url), 'utf8')) as GeneratedLandscape;
const headers = { cookie: config.cookieName + '=' + token };
const guestId=randomUUID(),guestToken=randomUUID(),guestHeaders={cookie:config.cookieName+'='+guestToken};
let app: Awaited<ReturnType<typeof buildApp>>;
describe('RC1 read-only map on an isolated test copy', () => {
  beforeAll(async () => {
    await migrateToLatest(url);
    await db.insertInto('accounts').values({ id: accountId, email: accountId + '@spawn-map.test', passwordHash: 'fixture' }).execute();
    await db.insertInto('sessions').values({ accountId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) }).execute();
    await db.insertInto('accounts').values({id:guestId,email:guestId+'@spawn-map.test',passwordHash:'fixture'}).execute();
    await db.insertInto('sessions').values({accountId:guestId,tokenHash:hashSessionToken(guestToken),expiresAt:new Date(Date.now()+3600000)}).execute();
    for (const [id, name, open] of [[worldId, slug, true], [closedId, closedSlug, false], [otherId, 'other-' + otherId, true]] as const) {
      await db.insertInto('worlds').values({ id, slug: name, name: 'RC1 recette isolée', topology: 'torus', widthCells: 512, heightCells: 256, chunkSize: 32, seed: 4109, generationStatus: 'ready', generationVersion: 3, isOpen: open, generatedAt: new Date() }).execute();
      await db.insertInto('worldGenerationCandidates').values({ worldId: id, commandId: randomUUID(), ownerAccountId: accountId, parameters: artifact.geography!.parameters, status: 'ready', checksum: RC1_CANONICAL_CHECKSUM, artifact }).execute();
    }
    app = await buildApp(config, db); await app.ready();
  }, 120000);
  afterAll(async () => {
    await app?.close(); await db.deleteFrom('populationCohorts').where('worldId', 'in', [worldId, closedId, otherId]).execute();
    await db.deleteFrom('worlds').where('id', 'in', [worldId, closedId, otherId]).execute();
    await db.deleteFrom('accounts').where('id', 'in', [accountId,guestId]).execute(); await db.destroy();
  });
  it('authenticates, keeps the source closed, pins canonical identity and exposes only current world villages', async () => {
    expect(artifactChecksum(artifact)).toBe(RC1_CANONICAL_CHECKSUM);
    expect((await app.inject({ url: `/api/worlds/${slug}/spawn-map` })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/worlds/${closedSlug}/spawn-map`, headers })).statusCode).toBe(404);
    expect((await app.inject({url:`/api/worlds/${slug}/spawn-atlas`})).statusCode).toBe(401);
    expect((await app.inject({url:`/api/worlds/${closedSlug}/spawn-atlas`,headers})).statusCode).toBe(404);
    const atlas=await app.inject({url:`/api/worlds/${slug}/spawn-atlas`,headers});expect(atlas.statusCode).toBe(200);
    expect(atlas.json()).toMatchObject({worldId,readiness:'terrain-only',territories:[]});expect(atlas.json()).not.toHaveProperty('landscape');
    await db.insertInto('worldMemberships').values({ worldId: otherId, accountId, playerName: 'Invisible ailleurs' }).execute();
    await db.insertInto('villages').values({ worldId: otherId, ownerAccountId: accountId, name: 'Invisible', anchorCellX: 100, anchorCellY: 100 }).execute();
    const result = await app.inject({ url: `/api/worlds/${slug}/spawn-map`, headers });
    expect(result.statusCode).toBe(200); expect(result.headers['cache-control']).toBe('no-store');
    expect(result.json().villages).toEqual([]); expect(result.json().surfaces).toEqual(starterSpawnSurfaces());
    expect(result.json().landscape).toEqual(artifact);
  });
  it('rejects bounds and stale identity; terrain check performs no village, membership, resource or geography writes', async () => {
    const input = { point: { x: 140, y: 20 }, quarterTurns: 0, artifactChecksum: RC1_CANONICAL_CHECKSUM };
    const count = async () => ({ villages: await db.selectFrom('villages').selectAll().where('worldId', '=', worldId).execute(), memberships: await db.selectFrom('worldMemberships').selectAll().where('worldId', '=', worldId).execute(), features: await db.selectFrom('worldFeatures').selectAll().where('worldId', '=', worldId).execute(), chunks: await db.selectFrom('worldChunks').selectAll().where('worldId', '=', worldId).execute(), candidate: await db.selectFrom('worldGenerationCandidates').selectAll().where('worldId', '=', worldId).execute() });
    const before = await count();
    for (const point of [{ x: -1, y: 0 }, { x: 512, y: 0 }, { x: 0, y: 256 }, { x: .5, y: 0 }]) expect((await app.inject({ method: 'POST', url: `/api/worlds/${slug}/spawn-map/terrain-check`, headers, payload: { ...input, point } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/worlds/${slug}/spawn-map/terrain-check`, headers, payload: { ...input, artifactChecksum: '0'.repeat(64) } })).statusCode).toBe(409);
    const checked = await app.inject({ method: 'POST', url: `/api/worlds/${slug}/spawn-map/terrain-check`, headers, payload: input });
    expect(checked.statusCode).toBe(200); expect(checked.json()).toMatchObject({ readiness: 'terrain-only', point: input.point });
    expect(await count()).toEqual(before);
  });
  it('does not trust an unchanged declared checksum after the actual artifact changes', async () => {
    const check = () => app.inject({ method: 'POST', url: `/api/worlds/${slug}/spawn-map/terrain-check`, headers,
      payload: { point: { x: 140, y: 20 }, quarterTurns: 0, artifactChecksum: RC1_CANONICAL_CHECKSUM } });
    expect((await check()).statusCode).toBe(200);
    try {
      await db.updateTable('worldGenerationCandidates').set({ artifact: { ...artifact, seed: 123 } }).where('worldId', '=', worldId).execute();
      const result = await check(); expect(result.statusCode).toBe(409); expect(result.json().code).toBe('SPAWN_MAP_NOT_READY');
    } finally { await db.updateTable('worldGenerationCandidates').set({ artifact }).where('worldId', '=', worldId).execute(); }
    expect((await check()).statusCode).toBe(200);
  });
  it('privately rechecks world occupations and reserved wood without exporting operations', async () => {
    const currentFeature = randomUUID(), foreignFeature = randomUUID();
    const payload = { point: { x: 140, y: 20 }, quarterTurns: 0, artifactChecksum: RC1_CANONICAL_CHECKSUM };
    const check = () => app.inject({ method: 'POST', url: `/api/worlds/${slug}/spawn-map/terrain-check`, headers, payload });
    try {
      for (const [id, world] of [[currentFeature, worldId], [foreignFeature, otherId]]) {
        await db.insertInto('worldFeatures').values({ id: id!, worldId: world!, featureTypeCode: 'woodland', state: 'available', variantSeed: 1 }).execute();
        await db.insertInto('woodlandDeposits').values({ worldId: world!, featureId: id!, cellX: 140, cellY: 20,
          initialAmount: 1500, remainingAmount: 1500, reservedAmount: world === worldId ? 0 : 1, revision: 1,
          updatedAt: new Date(), regrowthUpdatedAt: new Date() }).execute();
        await db.insertInto('worldCellOccupancies').values({ worldId: world!, featureId: id!, cellX: 140, cellY: 20,
          buildingId: null, pendingExpansionId: null, role: 'body' }).execute();
      }
      expect((await check()).json().reasons).not.toContain('occupation');
      await db.updateTable('woodlandDeposits').set({ reservedAmount: 1 }).where('worldId', '=', worldId).where('featureId', '=', currentFeature).execute();
      const result = (await check()).json(); expect(result.reasons).toContain('occupation'); expect(result.incompatible).toEqual([]);
      const map = (await app.inject({ url: `/api/worlds/${slug}/spawn-map`, headers })).json();
      expect(map).not.toHaveProperty('protectedSurfaces'); expect(map).not.toHaveProperty('naturalResources');
      expect(JSON.stringify(map)).not.toContain(currentFeature); expect(JSON.stringify(result)).not.toContain(currentFeature);
    } finally {
      await db.deleteFrom('woodlandDeposits').where('featureId', 'in', [currentFeature, foreignFeature]).execute();
      await db.deleteFrom('worldFeatures').where('id', 'in', [currentFeature, foreignFeature]).execute();
    }
  });
  it('preflights actual RC1 access and supplements without treating decoration as natural stocks or writing resources', async () => {
    const request = { method: 'POST' as const, url: `/api/worlds/${slug}/spawn-map/resource-check`, headers,
      payload: { point: { x: 140, y: 20 }, quarterTurns: 0, artifactChecksum: RC1_CANONICAL_CHECKSUM } };
    expect((await app.inject({ ...request, headers: {} })).statusCode).toBe(401);
    expect((await app.inject({ ...request, url: `/api/worlds/${closedSlug}/spawn-map/resource-check` })).statusCode).toBe(404);
    expect((await app.inject({ ...request, payload: { ...request.payload, artifactChecksum: '0'.repeat(64) } })).statusCode).toBe(409);
    const before = await db.selectFrom('worldGenerationCandidates').selectAll().where('worldId', '=', worldId).execute();
    // The real RC1 computation must leave the API event loop available. Include
    // the delayed final tick, otherwise a synchronous freeze can go unnoticed.
    let lastTick = performance.now(), maxGap = 0, ticks = 0;
    const heartbeat = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - lastTick); lastTick = now; ticks++; }, 20);
    let result;
    try {
      result = await app.inject(request);
      await new Promise(resolve => setTimeout(resolve, 30));
    } finally { clearInterval(heartbeat); }
    expect(ticks).toBeGreaterThan(2);
    expect(maxGap, 'RC1 computation monopolized the API event loop').toBeLessThan(1500);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ readiness: 'terrain-only', accessRevision: 1, naturalProjection: 'planned',
      woodAssumption: 'evaluated', planningStatus: 'planned', plannedStone: 4300, plannedWood: 3000 });
    expect(result.json().poorInResources).toBe(true); expect(result.json()).not.toHaveProperty('paths');
    expect(await db.selectFrom('worldFeatures').selectAll().where('worldId', '=', worldId).execute()).toEqual([]);
    expect(await db.selectFrom('worldMemberships').selectAll().where('worldId', '=', worldId).execute()).toEqual([]);
    expect(await db.selectFrom('villages').selectAll().where('worldId', '=', worldId).execute()).toEqual([]);
    expect(await db.selectFrom('worldGenerationCandidates').selectAll().where('worldId', '=', worldId).execute()).toEqual(before);
  }, 120000);
  it('rechecks a newly installed neighbor at confirmation and does not expose private account data', async () => {
    await db.insertInto('worldMemberships').values({ worldId, accountId, playerName: 'Voisin neuf' }).execute();
    const village = await db.insertInto('villages').values({ worldId, ownerAccountId: accountId, name: 'Privé', anchorCellX: 141, anchorCellY: 20 }).returning('id').executeTakeFirstOrThrow();
    const result = await app.inject({ method: 'POST', url: `/api/worlds/${slug}/spawn-map/terrain-check`, headers, payload: { point: { x: 140, y: 20 }, quarterTurns: 0, artifactChecksum: RC1_CANONICAL_CHECKSUM } });
    expect(result.statusCode).toBe(200); expect(result.json().reasons).toContain('neighbor');
    const map = (await app.inject({ url: `/api/worlds/${slug}/spawn-map`, headers })).json();
    expect(map.villages).toEqual([{ id: village.id, x: 141, y: 20, playerName: 'Voisin neuf', population: 0 }]);
  });
  it('persists operator texts and owned territories, rejects invalid writes and rechecks their current world', async () => {
    const presentationUrl=`/api/worlds/${slug}/spawn-map/presentation`, territoryUrl=`/api/worlds/${slug}/spawn-map/territory`;
    const presentation={title:'Les terres du levant',slogan:'Un nouveau départ'};
    expect((await app.inject({method:'PUT',url:presentationUrl,headers,payload:presentation})).statusCode).toBe(403);
    const operator=await buildApp({...config,worldGeneratorOperatorEmails:[accountId+'@spawn-map.test']},db);
    try {
      expect((await operator.inject({method:'PUT',url:presentationUrl,headers,payload:{...presentation,title:'   '}})).statusCode).toBe(400);
      expect((await operator.inject({method:'PUT',url:presentationUrl,headers,payload:presentation})).statusCode).toBe(200);
      expect((await app.inject({url:presentationUrl,headers})).json()).toMatchObject({presentation,canEdit:false});
      expect((await app.inject({url:`/api/worlds/other-${otherId}/spawn-map/presentation`,headers})).json().presentation.title).toBe('Arbestra');
    } finally {await operator.close();}
    const points=[{x:136,y:15},{x:146,y:15},{x:146,y:25},{x:136,y:25}];
    expect((await app.inject({method:'PUT',url:territoryUrl,payload:{points}})).statusCode).toBe(401);
    expect((await app.inject({method:'PUT',url:territoryUrl,headers:guestHeaders,payload:{points}})).statusCode).toBe(403);
    expect((await app.inject({method:'DELETE',url:territoryUrl,headers:guestHeaders})).statusCode).toBe(403);
    expect((await app.inject({method:'PUT',url:`/api/worlds/${closedSlug}/spawn-map/territory`,headers,payload:{points}})).statusCode).toBe(404);
    for(const invalid of [[{x:100,y:15},...points.slice(1)],[points[0],points[2],points[1],points[3]],points.map(p=>({...p,x:p.x+15}))])
      expect((await app.inject({method:'PUT',url:territoryUrl,headers,payload:{points:invalid}})).statusCode).toBe(400);
    expect((await app.inject({method:'PUT',url:territoryUrl,headers,payload:{points}})).statusCode).toBe(200);
    const input={point:{x:140,y:20},quarterTurns:0,artifactChecksum:RC1_CANONICAL_CHECKSUM};
    const check=()=>app.inject({method:'POST',url:`/api/worlds/${slug}/spawn-map/terrain-check`,headers,payload:input});
    expect((await check()).json().reasons).toContain('territory');
    const saved=(await app.inject({url:`/api/worlds/${slug}/spawn-map`,headers})).json();expect(saved.territories).toHaveLength(1);expect(saved.territories[0].points).toEqual(points);
    expect((await app.inject({url:`/api/worlds/other-${otherId}/spawn-map`,headers})).json().territories).toEqual([]);
    expect((await app.inject({method:'DELETE',url:territoryUrl,headers})).statusCode).toBe(200);
    expect((await check()).json().reasons).not.toContain('territory');
  });
  it('preserves engaged mission passages without forbidding shared walking or leaking the itinerary', async () => {
    const id = randomUUID(), foreignId = randomUUID();
    const ensureVillage = async (world: string) => {
      await db.insertInto('worldMemberships').values({ worldId: world, accountId, playerName: 'Recette missions' })
        .onConflict(c => c.columns(['worldId', 'accountId']).doNothing()).execute();
      await db.insertInto('playerScience').values({ worldId: world, accountId, observationsSince: null, solarReport: null })
        .onConflict(c => c.columns(['worldId', 'accountId']).doNothing()).execute();
      return await db.selectFrom('villages').select('id').where('worldId', '=', world).executeTakeFirst()
        ?? await db.insertInto('villages').values({ worldId: world, ownerAccountId: accountId, name: 'Recette missions', anchorCellX: 300, anchorCellY: 200 }).returning('id').executeTakeFirstOrThrow();
    };
    const village = await ensureVillage(worldId), foreign = await ensureVillage(otherId);
    try {
      for (const [activityId, world, ownerVillage, y] of [[id, worldId, village.id, 20], [foreignId, otherId, foreign.id, 40]] as const)
        await db.insertInto('scienceActivities').values({ id: activityId, worldId: world, villageId: ownerVillage, accountId,
          buildingId: null, programCode: null, kind: 'exploration', status: 'in-progress', workerCount: 1,
          workMs: 1000, startedAt: new Date(), completesAt: new Date(Date.now() + 60000), completedAt: null,
          pathCells: sql<TravelCell[]>`${JSON.stringify([{ cellX: 134, cellY: y }, { cellX: 139, cellY: y }])}::jsonb`, surveyCells: sql<TravelCell[]>`'[]'::jsonb` }).execute();
      const state = await spawnSpatialState(db, worldId);
      const p = { x: 136, y: 20, halfWidth: .125, halfHeight: .125 };
      expect(createSpawnSurfaceIndex(state.protectedSurfaces, 512, 256)(p)).toBe(true);
      expect(createSpawnSurfaceIndex(state.walkBlockedSurfaces, 512, 256)(p)).toBe(false);
      expect(createSpawnSurfaceIndex(state.protectedSurfaces, 512, 256)({ ...p, y: 40 })).toBe(false);
      const result = await app.inject({ method: 'POST', url: `/api/worlds/${slug}/spawn-map/terrain-check`, headers,
        payload: { point: { x: 140, y: 20 }, quarterTurns: 0, artifactChecksum: RC1_CANONICAL_CHECKSUM } });
      expect(result.json().reasons).toContain('occupation'); expect(result.json().incompatible).toEqual([]);
      expect(JSON.stringify(result.json())).not.toContain(id);
    } finally { await db.deleteFrom('scienceActivities').where('id', 'in', [id, foreignId]).execute(); }
  });
});

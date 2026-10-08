import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { AvailableWorlds, JoinWorldRequest } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { placeStarterVillage } from './starter-layout.js';
import { STARTER_VILLAGE } from './starter-village.js';

export async function availableWorlds(db: Kysely<Database>, accountId: string): Promise<AvailableWorlds> {
  const worlds = await db.selectFrom('worlds').select(['id','slug','name'])
    .where('generationStatus','=','ready').where('isOpen','=',true).orderBy('name').execute();
  return Promise.all(worlds.map(async world => {
    const joined = Boolean(await db.selectFrom('villages').select('id').where('worldId','=',world.id).where('ownerAccountId','=',accountId).executeTakeFirst());
    const free = Boolean(await db.selectFrom('worldClearings').select('id').where('worldId','=',world.id)
      .where('status','=','protected').where('claimedVillageId','is',null).executeTakeFirst());
    return {slug:world.slug,name:world.name,joined,canJoin:!joined && free};
  }));
}

async function fits(tx: Transaction<Database>, world: { id: string; widthCells: number; heightCells: number }, placement: ReturnType<typeof placeStarterVillage>) {
  const chunks = new Map<string, number[]>(), keys = new Map<string, {x:number;y:number}>();
  for (const c of placement.required) keys.set(`${Math.floor(c.cellX/32)}:${Math.floor(c.cellY/32)}`, {x:Math.floor(c.cellX/32),y:Math.floor(c.cellY/32)});
  const rows = await tx.selectFrom('worldChunks').select(['chunkX','chunkY','terrainCodes']).where('worldId','=',world.id)
    .where(eb=>eb.or([...keys.values()].map(c=>eb.and([eb('chunkX','=',c.x),eb('chunkY','=',c.y)])))).execute();
  for (const row of rows) chunks.set(`${row.chunkX}:${row.chunkY}`, row.terrainCodes);
  for (const c of placement.required) if (chunks.get(`${Math.floor(c.cellX/32)}:${Math.floor(c.cellY/32)}`)?.[(c.cellY%32)*32+c.cellX%32] !== 1) return false;
  const occupied = await tx.selectFrom('worldCellOccupancies').select('cellX').where('worldId','=',world.id)
    .where(eb=>eb.or(placement.required.map(c=>eb.and([eb('cellX','=',c.cellX),eb('cellY','=',c.cellY)])))).executeTakeFirst();
  if (occupied) return false;
  for (const b of placement.buildings) {
    const heights = b.cells.map(c=>({c,key:`${Math.floor(c.cellX/32)}:${Math.floor(c.cellY/32)}`}));
    const elevations = await tx.selectFrom('worldChunks').select(['chunkX','chunkY','elevations']).where('worldId','=',world.id)
      .where(eb=>eb.or([...new Map(heights.map(h=>[h.key,h.c])).values()].map(c=>eb.and([eb('chunkX','=',Math.floor(c.cellX/32)),eb('chunkY','=',Math.floor(c.cellY/32))])))).execute();
    const values = b.cells.map(c=>elevations.find(r=>r.chunkX===Math.floor(c.cellX/32)&&r.chunkY===Math.floor(c.cellY/32))!.elevations[(c.cellY%32)*32+c.cellX%32]!);
    if (Math.max(...values)-Math.min(...values)>1) return false;
  }
  return true;
}

/** First settlement per account/world; the account lock makes retries idempotent. */
export async function joinWorld(db: Kysely<Database>, accountId: string, slug: string, request: JoinWorldRequest) {
  return db.transaction().execute(async tx => {
    await sql`set local lock_timeout = '5s'`.execute(tx);
    await tx.selectFrom('accounts').select('id').where('id','=',accountId).forUpdate().executeTakeFirstOrThrow();
    const world = await tx.selectFrom('worlds').select(['id','widthCells','heightCells','generationStatus','isOpen']).where('slug','=',slug).executeTakeFirst();
    if (!world || world.generationStatus!=='ready' || !world.isOpen) throw new HttpError(409,'WORLD_NOT_READY','Ce monde n’est pas encore ouvert.');
    const existing = await tx.selectFrom('villages').select('id').where('worldId','=',world.id).where('ownerAccountId','=',accountId).orderBy('id').executeTakeFirst();
    if (existing) return { villageId: existing.id };
    const rejected: string[] = [];
    for (let count=0; count<600; count++) {
      const clearing = await tx.selectFrom('worldClearings').selectAll().where('worldId','=',world.id)
        .where('status','=','protected').where('claimedVillageId','is',null)
        .where(eb=>rejected.length ? eb('id','not in',rejected) : sql<boolean>`true`)
        .orderBy('id').limit(1).forUpdate().skipLocked().executeTakeFirst();
      if (!clearing) break;
      const villageId = randomUUID();
      // Create the row first, then serialize spatial writes; never lock another village.
      const placement = placeStarterVillage(STARTER_VILLAGE,{x:clearing.centerCellX,y:clearing.centerCellY},world);
      // Spatial validation is under the same navigation lock used by construction.
      // A savepoint removes an unsuitable temporary village without touching any player data.
      await sql`savepoint spawn_candidate`.execute(tx);
      await tx.insertInto('worldMemberships').values({worldId:world.id,accountId,playerName:request.playerName.trim()})
        .onConflict(c=>c.columns(['accountId','worldId']).doNothing()).execute();
      await tx.insertInto('villages').values({id:villageId,worldId:world.id,ownerAccountId:accountId,name:request.villageName.trim(),
        anchorCellX:clearing.centerCellX,anchorCellY:clearing.centerCellY}).execute();
      await sql`select pg_advisory_xact_lock(hashtextextended(${'infrastructure:'+world.id},0))`.execute(tx);
      if (!await fits(tx,world,placement)) {
        await sql`rollback to savepoint spawn_candidate`.execute(tx);
        rejected.push(clearing.id); continue;
      }
      const {through} = await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('through')).executeTakeFirstOrThrow();
      await tx.updateTable('villages').set({economyActivatedAt:through}).where('worldId','=',world.id).where('id','=',villageId).execute();
      await tx.updateTable('worldClearings').set({status:'claimed',claimedVillageId:villageId}).where('worldId','=',world.id).where('id','=',clearing.id).execute();
      const resources = await tx.selectFrom('resourceTypes').select('code').execute();
      await tx.insertInto('villageResources').values(resources.map(r=>({worldId:world.id,villageId,resourceCode:r.code,amount:r.code==='wood'?2000:r.code==='carrot'?50:0})))
        .onConflict(c=>c.columns(['worldId','villageId','resourceCode']).doUpdateSet(eb=>({amount:eb.ref('excluded.amount')}))).execute();
      await tx.insertInto('villageResourceFlows').values({worldId:world.id,villageId,resourceCode:'wood',baseRatePerHour:0,remainder:0,productionUpdatedAt:through}).execute();
      for (const building of placement.buildings) {
        await tx.insertInto('buildings').values({id:building.id,worldId:world.id,villageId,buildingType:building.type,level:building.level,
          quarterTurns:building.quarterTurns,visualLayout:building.visualLayout,status:'completed',targetLevel:null,
          constructionStartedAt:null,constructionCompletesAt:null,completedAt:through}).execute();
        await tx.insertInto('worldCellOccupancies').values(building.cells.map(c=>({...c,worldId:world.id,buildingId:building.id,featureId:null}))).execute();
        if (building.type==='town-hall') await tx.insertInto('buildingHiddenSupplies').values({worldId:world.id,villageId,buildingId:building.id,
          resourceCode:'carrot',amount:2000,claimedAt:null}).execute();
        const production = await tx.selectFrom('buildingLevelProduction').select(['resourceCode','capacity'])
          .where('buildingTypeCode','=',building.type).where('level','=',building.level).execute();
        for (const p of production) if (p.capacity !== null) {
          await tx.insertInto('buildingResourceBuffers').values({worldId:world.id,villageId,buildingId:building.id,
            resourceCode:p.resourceCode,storedAmount:0,remainder:0,productionUpdatedAt:through}).execute();
          if (building.type==='garden') await tx.insertInto('gardenPlots').values(building.cells.map(c=>({worldId:world.id,villageId,
            buildingId:building.id,cellX:c.cellX,cellY:c.cellY,storedAmount:Math.floor(Number(p.capacity)/3),remainder:0,productionUpdatedAt:through}))).execute();
        }
      }
      await tx.insertInto('villageInfrastructure').values({worldId:world.id,villageId,plan:JSON.stringify(placement.infrastructure)}).execute();
      await tx.insertInto('villagePopulations').values({worldId:world.id,villageId}).execute();
      await tx.insertInto('populationCohorts').values({worldId:world.id,villageId,originVillageId:villageId,memberCount:15,activity:'idle',
        energy:10,energyProgress:0,energyUpdatedAt:through,restingSince:null,foodUsedSinceRest:0,harvestId:null,extractionId:null}).execute();
      return {villageId};
    }
    throw new HttpError(409,'NO_STARTER_LOCATION','Aucune clairière disponible ne peut accueillir votre village. Réessayez plus tard.');
  });
}

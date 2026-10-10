import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { loadConfig } from '../../config.js';
import { buildApp } from '../../app.js';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import { hashSessionToken } from '../../security/sessions.js';
import { verifyPassword } from '../../security/passwords.js';
import { getVillageState, discoverBuildingSupplies } from '../villages/service.js';
import { joinWorld } from './service.js';
import { STARTER_VILLAGE } from './starter-village.js';

const url=testDatabaseUrl(), named=new URL(url);named.searchParams.set('application_name','onboarding-regression');
const db=createDatabase(named.href), config=loadConfig({...process.env,DATABASE_URL:url,NODE_ENV:'test'});
let worldId:string,slug:string;
const accounts:string[]=[];
const input={playerName:'Pionnier neuf',villageName:'Premier village'};
let app:Awaited<ReturnType<typeof buildApp>>;
async function account() {const id=randomUUID();await db.insertInto('accounts').values({id,email:`${id}@onboarding.test`,passwordHash:'fixture'}).execute();accounts.push(id);return id;}
async function cleanup() {
  if(worldId){
    await db.updateTable('worldClearings').set({claimedVillageId:null,status:'protected'}).where('worldId','=',worldId).execute();
    await db.deleteFrom('populationCohorts').where('worldId','=',worldId).execute();
    await db.deleteFrom('worlds').where('id','=',worldId).execute();
  }
  if(accounts.length)await db.deleteFrom('accounts').where('id','in',accounts.splice(0)).execute();
}
describe('player onboarding',()=>{
  beforeAll(async()=>{await migrateToLatest(url);app=await buildApp(config,db);await app.ready();},120000);
  beforeEach(async()=>{
    await cleanup();worldId=randomUUID();slug='onboard-'+worldId;
    await db.insertInto('worlds').values({id:worldId,slug,name:'Monde onboarding',topology:'torus',widthCells:128,heightCells:128,chunkSize:32,seed:1,generationStatus:'ready',isOpen:true,generationVersion:2,generatedAt:new Date()}).execute();
    const chunks=[];
    for(let y=0;y<4;y++)for(let x=0;x<4;x++)chunks.push({worldId,chunkX:x,chunkY:y,generationVersion:2,terrainCodes:Array(1024).fill(1),elevations:Array(1024).fill(0)});
    await db.insertInto('worldChunks').values(chunks).execute();
    await db.insertInto('worldClearings').values([32,96].map(center=>({id:randomUUID(),worldId,centerCellX:center,centerCellY:center,innerRadius:12,transitionRadius:4,status:'protected' as const,claimedVillageId:null}))).execute();
  });
  afterAll(async()=>{await cleanup();await app?.close();await db.destroy();});
  it('registers with a hashed password and session, validates payloads and rejects duplicate normalized emails',async()=>{
    const email=`${randomUUID()}@onboarding.test`;
    const response=await app.inject({method:'POST',url:'/api/auth/register',payload:{email:email.toUpperCase(),password:'onboarding-password'}});
    expect(response.statusCode).toBe(201);const body=response.json();accounts.push(body.account.id);
    expect(body.account.email).toBe(email);expect(body.worlds).toEqual([]);
    const stored=await db.selectFrom('accounts').select('passwordHash').where('id','=',body.account.id).executeTakeFirstOrThrow();
    expect(stored.passwordHash).not.toBe('onboarding-password');expect(await verifyPassword('onboarding-password',stored.passwordHash)).toBe(true);
    const cookie=response.cookies[0]!;
    expect(cookie.httpOnly).toBe(true);
    expect((await db.selectFrom('sessions').select('tokenHash').where('accountId','=',body.account.id).executeTakeFirstOrThrow()).tokenHash).toBe(hashSessionToken(cookie.value));
    const duplicate=await app.inject({method:'POST',url:'/api/auth/register',payload:{email,password:'another-password'}});
    expect(duplicate.statusCode).toBe(409);
    expect((await app.inject({method:'POST',url:'/api/auth/register',payload:{email,password:'short'}})).statusCode).toBe(400);
    expect((await app.inject({method:'GET',url:'/api/worlds'})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:`/api/worlds/${slug}/join`,headers:{cookie:`${cookie.name}=${cookie.value}`},payload:{playerName:' ',villageName:'Village'}})).statusCode).toBe(400);
    const list=await app.inject({method:'GET',url:'/api/worlds',headers:{cookie:`${cookie.name}=${cookie.value}`}});
    expect(list.json().find((w:{slug:string})=>w.slug===slug)).toMatchObject({canJoin:true,joined:false});
  });
  it('creates the complete translated layout, initial economy and single-use chest, then reuses the same village on retry',async()=>{
    const id=await account(), created=await joinWorld(db,id,slug,input);

    const buildings=await db.selectFrom('buildings').selectAll().where('worldId','=',worldId).where('villageId','=',created.villageId).execute();
    expect(buildings).toHaveLength(STARTER_VILLAGE.buildings.length);
    expect(buildings.every(b=>b.status==='completed'&&b.targetLevel===null)).toBe(true);
    expect(buildings.filter(b=>b.buildingType==='dwelling').every(b=>b.visualLayout?.recipe==='log-house')).toBe(true);
    expect(await db.selectFrom('gardenPlots').select('storedAmount').where('worldId','=',worldId).execute()).toHaveLength(2);
    const capacity=await db.selectFrom('buildingLevelProduction').select('capacity').where('buildingTypeCode','=','garden').where('level','=',1).executeTakeFirstOrThrow();
    const plots=await db.selectFrom('gardenPlots').select('storedAmount').where('worldId','=',worldId).execute();
    expect(plots.every(p=>Number(p.storedAmount)===Math.floor(Number(capacity.capacity)/3))).toBe(true);
    expect((await db.selectFrom('populationCohorts').select('memberCount').where('worldId','=',worldId).execute()).map(c=>c.memberCount)).toEqual([15]);
    const plan=(await db.selectFrom('villageInfrastructure').select('plan').where('worldId','=',worldId).executeTakeFirstOrThrow()).plan;
    expect(plan.revision).toBe(0);expect(plan.stoneReserve).toBe(0);expect(plan.equipment).toHaveLength(STARTER_VILLAGE.infrastructure.equipment.length);
    expect(plan.roads).toEqual([]); expect(plan.equipment).toEqual([]);
    const stocks=await db.selectFrom('villageResources').select(['resourceCode','amount']).where('worldId','=',worldId).execute();
    expect(Object.fromEntries(stocks.map(r=>[r.resourceCode,Number(r.amount)]))).toMatchObject({wood:2000,carrot:50,stone:0,timber:0,'cut-stone':0,rings:0});
    expect(await joinWorld(db,id,slug,{playerName:'Changed',villageName:'Changed'})).toEqual(created);
    expect((await db.selectFrom('villages').select('name').where('id','=',created.villageId).executeTakeFirstOrThrow()).name).toBe(input.villageName);
    const snapshot=await getVillageState(db,id,slug);
    expect(snapshot.village.population.total).toBe(15);expect(snapshot.village.wood).toBe(2000);
    const hall=snapshot.cells.find(c=>c.building?.type==='town-hall')!.building!;
    await discoverBuildingSupplies(db,id,slug,created.villageId,hall.id);
    await discoverBuildingSupplies(db,id,slug,created.villageId,hall.id);
    expect(Number((await db.selectFrom('villageResources').select('amount').where('worldId','=',worldId).where('resourceCode','=','carrot').executeTakeFirstOrThrow()).amount)).toBe(2050);
  });
  it('skips blocked clearings and refuses unavailable worlds without partial membership',async()=>{
    const id=await account();
    await db.updateTable('worldChunks').set({terrainCodes:Array(1024).fill(2)}).where('worldId','=',worldId).execute();
    await expect(joinWorld(db,id,slug,input)).rejects.toMatchObject({code:'NO_STARTER_LOCATION'});
    expect(await db.selectFrom('villages').select('id').where('worldId','=',worldId).execute()).toEqual([]);
    expect(await db.selectFrom('worldMemberships').select('accountId').where('worldId','=',worldId).execute()).toEqual([]);
    await db.updateTable('worlds').set({generationStatus:'pending'}).where('id','=',worldId).execute();
    await expect(joinWorld(db,id,slug,input)).rejects.toMatchObject({code:'WORLD_NOT_READY'});
  });
  it('skips an occupied clearing without deleting its feature or changing its protection',async()=>{
    const first=await db.selectFrom('worldClearings').selectAll().where('worldId','=',worldId).orderBy('id').executeTakeFirstOrThrow();
    const featureId=randomUUID(),cellX=first.centerCellX,cellY=first.centerCellY;
    await db.insertInto('worldFeatures').values({id:featureId,worldId,featureTypeCode:'woodland',state:'available',variantSeed:1}).execute();
    await db.insertInto('worldCellOccupancies').values({worldId,cellX,cellY,featureId,buildingId:null,pendingExpansionId:null,role:'body'}).execute();
    const owner=await account(),created=await joinWorld(db,owner,slug,input);
    expect((await db.selectFrom('villages').select('anchorCellX').where('id','=',created.villageId).executeTakeFirstOrThrow()).anchorCellX).not.toBe(first.centerCellX);
    expect(await db.selectFrom('worldFeatures').select('id').where('worldId','=',worldId).where('id','=',featureId).executeTakeFirst()).toEqual({id:featureId});
    expect(await db.selectFrom('worldClearings').select(['status','claimedVillageId']).where('worldId','=',worldId).where('id','=',first.id).executeTakeFirst()).toEqual({status:'protected',claimedVillageId:null});
    const outsider=await account();
    await expect(getVillageState(db,outsider,slug)).rejects.toMatchObject({code:'VILLAGE_NOT_FOUND'});
  });
  it('rolls back buildings, resources and clearing after a verified late failure',async()=>{
    const id=await account();
    await sql.raw(`create function onboarding_fail() returns trigger language plpgsql as $$ begin
      if new.world_id='${worldId}' then
        raise exception 'ONBOARDING_INJECTED buildings=% resources=% claims=%',
          (select count(*) from buildings where world_id=new.world_id),
          (select count(*) from village_resources where world_id=new.world_id),
          (select count(*) from world_clearings where world_id=new.world_id and claimed_village_id is not null);
      end if; return new; end $$;
      create trigger onboarding_fail before insert on village_infrastructure for each row execute function onboarding_fail();`).execute(db);
    try {await expect(joinWorld(db,id,slug,input)).rejects.toThrow(/ONBOARDING_INJECTED buildings=5 resources=6 claims=1/);}
    finally {await sql`drop trigger onboarding_fail on village_infrastructure; drop function onboarding_fail();`.execute(db);}
    for(const table of ['villages','buildings','villageResources','worldMemberships','gardenPlots'] as const)
      expect(await db.selectFrom(table).selectAll().where('worldId','=',worldId).execute()).toEqual([]);
    expect((await db.selectFrom('worldClearings').select('claimedVillageId').where('worldId','=',worldId).execute()).every(c=>c.claimedVillageId===null)).toBe(true);
  });
  it('uses distinct clearings when two actual transactions wait behind a held spatial lock',async()=>{
    const a=await account(),b=await account();
    let release!:()=>void, entered!:()=>void;
    const gate=new Promise<void>(r=>release=r), held=new Promise<void>(r=>entered=r);
    const blocker=db.transaction().execute(async tx=>{
      await sql`select pg_advisory_xact_lock(hashtextextended(${'infrastructure:'+worldId},0))`.execute(tx);
      entered();await gate;
    });
    await held;
    const first=joinWorld(db,a,slug,input),second=joinWorld(db,b,slug,input);
    // Register rejection handlers immediately; cleanup always joins every transaction.
    const results=Promise.allSettled([first,second]);
    try {
      await expect.poll(async()=>Number((await sql<{n:string}>`select count(*)::text n from pg_stat_activity where application_name='onboarding-regression' and wait_event='advisory'`.execute(db)).rows[0]!.n),{timeout:3500,interval:50}).toBe(2);
    } finally {release();await blocker;await results;}
    const [one,two]=await Promise.all([first,second]);expect(one.villageId).not.toBe(two.villageId);
    expect((await db.selectFrom('worldClearings').select('claimedVillageId').where('worldId','=',worldId).where('status','=','claimed').execute()).map(c=>c.claimedVillageId).sort()).toEqual([one.villageId,two.villageId].sort());
  });
});

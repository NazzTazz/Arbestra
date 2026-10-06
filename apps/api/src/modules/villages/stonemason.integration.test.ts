import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDatabase} from '../../database/connection.js';
import {migrateToLatest} from '../../database/migrate.js';
import {resetE2eState} from '../../database/reset-e2e.js';
import {DEVELOPMENT_IDS as ids} from '../../database/seed.js';
import {testDatabaseUrl} from '../../database/test-environment.js';
import {buildApp} from '../../app.js';
import {constructBuilding,getVillageState} from './service.js';

const url=testDatabaseUrl(),db=createDatabase(url);
beforeAll(()=>migrateToLatest(url));
beforeEach(async()=>{await resetE2eState(url);await db.updateTable('villageResources').set({amount:100}).where('villageId','=',ids.village).where('resourceCode','=','stone').execute();});
afterAll(()=>db.destroy());
async function freeSquare(){
  const state=await getVillageState(db,ids.account,'aube',ids.village);
  const free=new Set(state.cells.filter(c=>c.canBuild).map(c=>`${c.cellX}:${c.cellY}`));
  const anchor=state.cells.find(c=>[0,1].every(dx=>[0,1].every(dy=>free.has(`${c.cellX+dx}:${c.cellY+dy}`))));
  if(!anchor)throw new Error('No free square');return {anchor,state};
}
it('constructs four occupied cells, debits the price once and preserves the instance limit',async()=>{
  const {anchor,state:before}=await freeSquare(),commandId=randomUUID();
  const after=await constructBuilding(db,ids.account,'aube',ids.village,anchor.cellX,anchor.cellY,'stonemason',0,commandId);
  const workshop=after.cells.find(c=>c.building?.type==='stonemason')!.building!;
  expect(workshop.status).toBe('completed');expect(after.cells.filter(c=>c.footprint?.buildingId===workshop.id)).toHaveLength(4);
  expect(after.village.wood).toBe(before.village.wood-50);expect(after.village.resources.find(r=>r.code==='stone')!.amount).toBe(75);
  expect(after.buildingTypes.find(b=>b.code==='stonemason')).toMatchObject({buildable:true,productionMode:'processing'});
  const replay=await constructBuilding(db,ids.account,'aube',ids.village,anchor.cellX,anchor.cellY,'stonemason',0,commandId);
  expect(replay.village.wood).toBe(after.village.wood);
  const {anchor:second}=await freeSquare();
  await expect(constructBuilding(db,ids.account,'aube',ids.village,second.cellX,second.cellY,'stonemason',0)).rejects.toMatchObject({code:'BUILDING_LIMIT_REACHED'});
});
it('allows production construction with DEV workshops disabled and never installs a free decoration',async()=>{
  const {anchor}=await freeSquare();
  await db.insertInto('worldFactorySettings').values({worldId:ids.world,enabled:false}).onConflict(c=>c.column('worldId').doUpdateSet({enabled:false})).execute();
  const app=await buildApp({databaseUrl:url,host:'127.0.0.1',port:0,isProduction:false,cookieName:'arbestra_session',sessionTtlDays:30,constructionDurationOverrideMs:null,scheduledTaskPollIntervalMs:25},db);
  try{
    const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{email:'player@arbestra.local',password:'arbestra'}});
    const header=login.headers['set-cookie'],cookie=(Array.isArray(header)?header[0]:header)!.split(';')[0]!;
    const response=await app.inject({method:'POST',url:`/api/worlds/aube/villages/${ids.village}/buildings`,headers:{cookie},payload:{buildingType:'stonemason',cellX:anchor.cellX,cellY:anchor.cellY}});
    expect(response.statusCode).toBe(201);
    expect(response.json().cells.find((c:{building?:{type:string}})=>c.building?.type==='stonemason').building.status).toBe('under-construction');
    expect(response.json().village.resources.find((r:{code:string})=>r.code==='stone').amount).toBe(75);
  }finally{await app.close();}
});

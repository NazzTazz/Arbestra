import {randomUUID} from 'node:crypto';
import {sql,type Kysely,type Transaction} from 'kysely';
import {beforeAll,beforeEach,afterEach,afterAll,describe,it,expect} from 'vitest';
import {prepareInfrastructureEdit,emptyInfrastructure,infrastructurePlanSurface,type InfrastructureOperation,type InfrastructureRequest,type VillageState} from '@arbestra/contracts';
import {testDatabaseUrl} from '../../database/test-environment.js';
import {createDatabase} from '../../database/connection.js';
import {migrateToLatest} from '../../database/migrate.js';
import {resetE2eState} from '../../database/reset-e2e.js';
import {DEVELOPMENT_IDS} from '../../database/seed.js';
import type {Database} from '../../database/schema.js';
import {getVillageState,constructBuilding,constructBuildingArea,startVillageStoneExtraction,upgradeBuilding} from './service.js';
import {infrastructureCommand,infrastructurePreview,readInfrastructure,readNavigationInfrastructure} from './infrastructure.js';
import {beginVillageEconomy} from './reconcile-economy.js';
import {buildApp} from '../../app.js';
const url=testDatabaseUrl(),db=createDatabase(url),worldId=DEVELOPMENT_IDS.world,villageId=DEVELOPMENT_IDS.village,accountId=DEVELOPMENT_IDS.account;
const sessionId=randomUUID(),snapshot=()=>getVillageState(db,accountId,'aube');
let temporaryFeatureId:string|null=null;
const stocks=()=>db.selectFrom('villageResources').select(['resourceCode','amount']).where('worldId','=',worldId).where('villageId','=',villageId).orderBy('resourceCode').execute();
function request(state:VillageState,operation:InfrastructureOperation):InfrastructureRequest{return {commandId:randomUUID(),sessionId,revision:state.infrastructure!.revision,operation,expected:prepareInfrastructureEdit(state,operation,'preview').quote};}
async function freeRoad(state:VillageState){
  for(const cell of state.cells.filter(c=>c.canBuild)){
    const operation:InfrastructureOperation={kind:'road',stroke:{id:'new',points:[{x:cell.cellX*8,y:cell.cellY*8},{x:cell.cellX*8+1,y:cell.cellY*8}],width:4,material:'stone-1',border:false,operation:'paint'}};
    const r=request(state,operation),p=await infrastructurePreview(db,accountId,'aube',villageId,r);if(p.valid&&p.quote.stoneUnits===64)return r;
  }throw new Error('No fixture road position');
}
describe.sequential('infrastructure authoritative commands',()=>{
  beforeAll(async()=>{await migrateToLatest(url);await resetE2eState(url);});
  beforeEach(async()=>{await resetE2eState(url);await db.updateTable('villageResources').set({amount:'100'}).where('worldId','=',worldId).where('villageId','=',villageId).where('resourceCode','in',['stone','wood']).execute();});afterAll(()=>db.destroy());
  afterEach(async()=>{
    if(!temporaryFeatureId)return;
    // The fast reset deliberately retains features. Remove this test's synthetic
    // deposit after clearing missions that reference it, even when assertions fail.
    await resetE2eState(url);
    await db.deleteFrom('worldCellOccupancies').where('worldId','=',worldId).where('featureId','=',temporaryFeatureId).execute();
    await db.deleteFrom('woodlandDeposits').where('worldId','=',worldId).where('featureId','=',temporaryFeatureId).execute();
    await db.deleteFrom('worldFeatures').where('worldId','=',worldId).where('id','=',temporaryFeatureId).execute();
    temporaryFeatureId=null;
  });
  it('publishes the owned hall identity and fine routes when the village anchor is offset',async()=>{
    const initial=await snapshot(),hall=initial.cells.find(c=>c.building?.type==='town-hall')!;
    await db.updateTable('villages').set({anchorCellX:(initial.village.anchorCellX+1)%initial.world.widthCells})
      .where('id','=',villageId).where('worldId','=',worldId).execute();
    const shifted=await snapshot();
    expect(shifted.village.anchorCellX).not.toBe(hall.cellX);
    expect(shifted.village.townHallBuildingId).toBe(hall.building!.id);
    expect(shifted.travelRoutes.length).toBeGreaterThan(0);
    expect(shifted.travelRoutes.every(r=>r.version===2)).toBe(true);
  });
  it('debits fractional costs once, no-ops without history, and undoes two portions exactly in reverse order',async()=>{
    const before=await stocks(),s0=await snapshot(),one=await freeRoad(s0),s1=await infrastructureCommand(db,accountId,'aube',villageId,one);
    expect(s1.infrastructure).toMatchObject({revision:1,stoneReserve:192});
    const money=await stocks(),replay=await infrastructureCommand(db,accountId,'aube',villageId,one);expect(await stocks()).toEqual(money);expect(replay.infrastructure).toEqual(s1.infrastructure);
    const repeat=request(s1,one.operation),same=await infrastructureCommand(db,accountId,'aube',villageId,repeat);expect(same.infrastructure!.revision).toBe(1);expect(await stocks()).toEqual(money);
    if(one.operation.kind!=='road')throw new Error('fixture');const last=one.operation.stroke.points[1]!;
    const two=request(s1,{kind:'road',stroke:{...one.operation.stroke,points:[last,{x:last.x+1,y:last.y}]}}),s2=await infrastructureCommand(db,accountId,'aube',villageId,two);
    expect(s2.infrastructure!.stoneReserve).toBe(128);expect(await stocks()).toEqual(money);
    const undoTwo={commandId:randomUUID(),sessionId,revision:s2.infrastructure!.revision,operation:{kind:'undo' as const,target:two.commandId}};
    const s3=await infrastructureCommand(db,accountId,'aube',villageId,undoTwo);expect(s3.infrastructure!.stoneReserve).toBe(192);
    const undoOne={commandId:randomUUID(),sessionId,revision:s3.infrastructure!.revision,operation:{kind:'undo' as const,target:one.commandId}};
    await infrastructureCommand(db,accountId,'aube',villageId,undoOne);expect(await stocks()).toEqual(before);
    await infrastructureCommand(db,accountId,'aube',villageId,undoOne);expect(await stocks()).toEqual(before);
    await expect(infrastructureCommand(db,accountId,'aube',villageId,{...undoOne,commandId:randomUUID()})).rejects.toMatchObject({code:'UNDO_UNAVAILABLE'});
  });
  it('refuses a stale quote, insufficient stock and reuse of a command identity without any partial mutation',async()=>{
    const s=await snapshot(),r=await freeRoad(s),before=await stocks();
    await expect(infrastructureCommand(db,accountId,'aube',villageId,{...r,expected:{...r.expected!,stoneDebit:0}})).rejects.toMatchObject({code:'QUOTE_CHANGED'});expect(await stocks()).toEqual(before);
    await db.updateTable('villageResources').set({amount:'0'}).where('worldId','=',worldId).where('villageId','=',villageId).where('resourceCode','=','stone').execute();
    await expect(infrastructureCommand(db,accountId,'aube',villageId,r)).rejects.toMatchObject({code:'INSUFFICIENT_RESOURCES'});
    expect((await readInfrastructure(db,worldId,villageId)).revision).toBe(0);expect(await db.selectFrom('infrastructureReceipts').select('commandId').execute()).toHaveLength(0);
    await db.updateTable('villageResources').set({amount:'10'}).where('worldId','=',worldId).where('villageId','=',villageId).where('resourceCode','=','stone').execute();
    await infrastructureCommand(db,accountId,'aube',villageId,r);const money=await stocks();
    await expect(infrastructureCommand(db,accountId,'aube',villageId,{...r,revision:1})).rejects.toMatchObject({code:'COMMAND_REUSED'});expect(await stocks()).toEqual(money);
  });
  it('forces two commands to wait for the village lock; only one stale revision can spend the reserve',async()=>{
    const s=await snapshot(),a=await freeRoad(s),b={...a,commandId:randomUUID()},before=await stocks();
    let release!:()=>void,locked!:()=>void;const signal=new Promise<void>(resolve=>locked=resolve),gate=new Promise<void>(resolve=>release=resolve);
    const holder=db.transaction().execute(async tx=>{await tx.selectFrom('villages').select('id').where('worldId','=',worldId).where('id','=',villageId).forUpdate().executeTakeFirstOrThrow();locked();await gate;});
    await signal;const commands=[infrastructureCommand(db,accountId,'aube',villageId,a),infrastructureCommand(db,accountId,'aube',villageId,b)];const settled=Promise.allSettled(commands);
    try {const deadline=Date.now()+5000;let waiters=0;while(Date.now()<deadline){const result=await sql<{n:string}>`select count(*) n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query ilike '%villages%'`.execute(db);waiters=Number(result.rows[0]!.n);if(waiters>=2)break;await new Promise(r=>setTimeout(r,25));}expect(waiters).toBeGreaterThanOrEqual(2);} finally {release();await holder;await settled;}
    const results=await settled;expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'INFRASTRUCTURE_CHANGED'}});
    const after=await stocks();expect(BigInt(before.find(r=>r.resourceCode==='stone')!.amount)-BigInt(after.find(r=>r.resourceCode==='stone')!.amount)).toBe(1n);
  });
  it('proves writes occurred before an injected failure and rolls back plan, reserve, receipt and both resources',async()=>{
    const s=await snapshot(),r=await freeRoad(s),before=await stocks(),failure=new Error('infrastructure rollback after receipt');let observed=false;
    await expect(db.transaction().execute(async tx=>{
      const inside={transaction:()=>({execute:<T>(run:(t:Transaction<Database>)=>Promise<T>)=>run(tx)})} as unknown as Kysely<Database>;
      const result=await infrastructureCommand(inside,accountId,'aube',villageId,r);expect(result.infrastructure!.revision).toBe(1);
      expect(await tx.selectFrom('infrastructureReceipts').select('commandId').where('commandId','=',r.commandId).execute()).toHaveLength(1);
      const stone=await tx.selectFrom('villageResources').select('amount').where('worldId','=',worldId).where('villageId','=',villageId).where('resourceCode','=','stone').executeTakeFirstOrThrow();
      expect(BigInt(stone.amount)).toBe(BigInt(before.find(r=>r.resourceCode==='stone')!.amount)-1n);observed=true;throw failure;
    })).rejects.toBe(failure);expect(observed).toBe(true);expect(await stocks()).toEqual(before);expect((await readInfrastructure(db,worldId,villageId)).revision).toBe(0);expect(await db.selectFrom('infrastructureReceipts').select('commandId').execute()).toHaveLength(0);
  });
  it('protects a manual corridor from a new building and rejects a forged free automatic brazier',async()=>{
    const s=await snapshot(),r=await freeRoad(s),placed=await infrastructureCommand(db,accountId,'aube',villageId,r);if(r.operation.kind!=='road')throw new Error('fixture');const p=r.operation.stroke.points[0]!,before=await stocks();
    await expect(constructBuilding(db,accountId,'aube',villageId,p.x/8,p.y/8,'dwelling',0)).rejects.toMatchObject({code:'INFRASTRUCTURE_OCCUPIED'});expect(await stocks()).toEqual(before);
    const forged=request(placed,{kind:'move',id:'auto:forged',version:0,position:{x:p.x,y:p.y+4},quarterTurns:0});
    await expect(infrastructureCommand(db,accountId,'aube',villageId,forged)).rejects.toMatchObject({code:'EQUIPMENT_CHANGED'});expect(await stocks()).toEqual(before);
  });
  it('protects the outer sidewalk from construction even when the roadway is in the neighboring cell',async()=>{
    const s=await snapshot(),cell=s.cells.find(c=>c.canBuild&&s.cells.some(a=>a.canBuild&&a.cellX===c.cellX&&a.cellY===c.cellY-1));
    expect(cell).toBeDefined();
    const x=cell!.cellX*8,y=(cell!.cellY-1)*8+3,plan=emptyInfrastructure();
    plan.roads=[{id:'sidewalk',operation:'paint',material:'stone-1',width:2,border:true,points:[{x,y},{x:x+1,y}]}];
    expect([...infrastructurePlanSurface(plan,s.world).values()].every(p=>!p.manual||Math.floor((p.y+8)/16)!==cell!.cellY)).toBe(true);
    await db.insertInto('villageInfrastructure').values({worldId,villageId,plan:JSON.stringify(plan)}).execute();
    const before=await stocks();
    await expect(constructBuilding(db,accountId,'aube',villageId,cell!.cellX,cell!.cellY,'dwelling',0)).rejects.toMatchObject({code:'INFRASTRUCTURE_OCCUPIED'});
    expect(await stocks()).toEqual(before);
  });
  it('waits for a neighboring trip admission before changing the physical network',async()=>{
    const s=await snapshot(),r=await freeRoad(s),neighbor=randomUUID();
    await db.insertInto('villages').values({id:neighbor,worldId,ownerAccountId:accountId,name:'Navigation proof',anchorCellX:s.village.anchorCellX+20,anchorCellY:s.village.anchorCellY}).execute();
    let release!:()=>void,ready!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),signal=new Promise<void>(resolve=>ready=resolve);
    const reader=db.transaction().execute(async tx=>{await beginVillageEconomy(tx,worldId,neighbor);ready();await gate;});
    let writer:Promise<VillageState>|undefined,results:PromiseSettledResult<unknown>[]=[];
    try{
      await Promise.race([signal,reader]);writer=infrastructureCommand(db,accountId,'aube',villageId,r);
      // Observe PostgreSQL's actual advisory-lock wait, not two racing promises.
      const deadline=Date.now()+5000;let waiting=false;
      while(Date.now()<deadline){const result=await sql<{n:string}>`select count(*) n from pg_stat_activity where datname=current_database() and wait_event='advisory' and query ilike '%pg_advisory_xact_lock(%'`.execute(db);if(Number(result.rows[0]!.n)>0){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,25));}
      expect(waiting).toBe(true);expect((await readInfrastructure(db,worldId,villageId)).revision).toBe(0);
    }finally{release();results=await Promise.allSettled([reader,...(writer?[writer]:[])]);await db.deleteFrom('villages').where('worldId','=',worldId).where('id','=',neighbor).execute();}
    for(const result of results)if(result.status==='rejected')throw result.reason;
    expect((await readInfrastructure(db,worldId,villageId)).revision).toBe(1);
  });
  it('merges neighboring obstacles for navigation while keeping the editable plan local',async()=>{
    const s=await snapshot(),neighbor=randomUUID(),context={worldId,villageId,anchorCellX:s.village.anchorCellX,anchorCellY:s.village.anchorCellY,...s.world};
    const plan={...emptyInfrastructure(),equipment:[{id:randomUUID(),x:(s.village.anchorCellX+2)*8,y:s.village.anchorCellY*8,quarterTurns:0,version:1}]};
    await db.insertInto('villages').values({id:neighbor,worldId,ownerAccountId:accountId,name:'Obstacle proof',anchorCellX:s.village.anchorCellX+20,anchorCellY:s.village.anchorCellY}).execute();
    try{
      await db.insertInto('villageInfrastructure').values({worldId,villageId:neighbor,plan:JSON.stringify(plan)}).execute();
      expect((await readNavigationInfrastructure(db,context)).equipment).toEqual(plan.equipment);
      expect((await readInfrastructure(db,worldId,villageId)).equipment).toEqual([]);
      await db.updateTable('villages').set({anchorCellX:s.village.anchorCellX+100}).where('id','=',neighbor).where('worldId','=',worldId).execute();
      expect((await readNavigationInfrastructure(db,context)).equipment).toEqual([]);
    }finally{await db.deleteFrom('villageInfrastructure').where('worldId','=',worldId).where('villageId','=',neighbor).execute();await db.deleteFrom('villages').where('worldId','=',worldId).where('id','=',neighbor).execute();}
  });
  it('keeps engaged transport and deadlines intact when infrastructure is edited',async()=>{
    const featureId=randomUUID(),at=new Date();
    temporaryFeatureId=featureId;
    await db.insertInto('worldFeatures').values({id:featureId,worldId,featureTypeCode:'woodland',state:'available',variantSeed:1}).execute();
    await db.insertInto('woodlandDeposits').values({worldId,featureId,cellX:1024,cellY:514,initialAmount:300,remainingAmount:300,reservedAmount:0,revision:1,updatedAt:at,regrowthUpdatedAt:at}).execute();
    await db.insertInto('worldCellOccupancies').values({worldId,cellX:1024,cellY:514,featureId,buildingId:null,role:'body'}).execute();
    await startVillageStoneExtraction(db,accountId,'aube',villageId,featureId,randomUUID(),1);
    const read=()=>db.selectFrom('depositExtractions').select(['id','pathCells','transportMs','startedAt','completesAt','reservedAmount','workerCount']).where('worldId','=',worldId).where('villageId','=',villageId).where('status','=','in-progress').execute();
    const before=await read();expect(before).toHaveLength(1);
    const current=await snapshot(),edit=await freeRoad(current);await infrastructureCommand(db,accountId,'aube',villageId,edit);
    expect(await read()).toEqual(before);
  });
  it('charges a new brazier once, moves it freely and retains manual lighting policy after deletion',async()=>{
    async function placeable(s:VillageState,kind:'place'|'move',id='',version=1){
      for(const cell of s.cells.filter(c=>c.canBuild)){
        if(kind==='move'&&s.infrastructure!.equipment.some(e=>e.id===id&&e.x===cell.cellX*8&&e.y===cell.cellY*8))continue;
        const operation:InfrastructureOperation=kind==='place'?{kind,position:{x:cell.cellX*8,y:cell.cellY*8},quarterTurns:0}:{kind,id,version,position:{x:cell.cellX*8,y:cell.cellY*8},quarterTurns:1};
        const r=request(s,operation);if((await infrastructurePreview(db,accountId,'aube',villageId,r)).valid)return r;
      }throw new Error('No fixture equipment position');
    }
    const initial=await snapshot(),money=await stocks(),place=await placeable(initial,'place'),one=await infrastructureCommand(db,accountId,'aube',villageId,place),equipment=one.infrastructure!.equipment[0]!;
    expect(one.infrastructure!.equipment).toHaveLength(1);const paid=await stocks();
    expect(BigInt(money.find(r=>r.resourceCode==='stone')!.amount)-BigInt(paid.find(r=>r.resourceCode==='stone')!.amount)).toBe(2n);
    expect(BigInt(money.find(r=>r.resourceCode==='wood')!.amount)-BigInt(paid.find(r=>r.resourceCode==='wood')!.amount)).toBe(1n);
    const move=await placeable(one,'move',equipment.id,equipment.version),two=await infrastructureCommand(db,accountId,'aube',villageId,move);
    expect(await stocks()).toEqual(paid);expect(two.infrastructure!.equipment[0]!.quarterTurns).toBe(1);
    const positioned=two.infrastructure!.equipment[0]!,three=await infrastructureCommand(db,accountId,'aube',villageId,request(two,{kind:'delete',id:positioned.id,version:positioned.version}));
    expect(three.infrastructure!.equipment).toEqual([]);expect(three.infrastructure!.manualLighting.length).toBeGreaterThan(0);expect(await stocks()).toEqual(paid);
    const cell=three.infrastructure!.manualLighting.at(-1)!;
    const restored=await infrastructureCommand(db,accountId,'aube',villageId,request(three,{kind:'lighting',cell}));
    expect(restored.infrastructure!.manualLighting).not.toContain(cell);expect(await stocks()).toEqual(paid);
  });
  it.each(['logs','beams'] as const)('persists %s through spatial construction, retry and upgrade',async variant=>{
    await db.updateTable('villageResources').set({amount:'10000'}).where('worldId','=',worldId).where('villageId','=',villageId).execute();
    const initial=await snapshot(),cell=initial.cells.find(c=>c.canBuild)!,commandId=randomUUID();
    const built=await constructBuildingArea(db,accountId,'aube',villageId,'dwelling',cell,[cell],0,commandId,undefined,1,variant);
    const house=built.cells.find(c=>c.cellX===cell.cellX&&c.cellY===cell.cellY)!.building!;
    expect(house.visualLayout?.recipe).toBe(variant==='logs'?'log-house':'beam-house');
    const paid=await stocks();
    await constructBuildingArea(db,accountId,'aube',villageId,'dwelling',cell,[cell],0,commandId,undefined,1,variant);
    expect(await stocks()).toEqual(paid);
    await expect(constructBuildingArea(db,accountId,'aube',villageId,'dwelling',cell,[cell],0,commandId,undefined,1,'stone')).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    const upgraded=await upgradeBuilding(db,accountId,'aube',villageId,house.id,undefined,undefined,0);
    const again=upgraded.cells.find(c=>c.building?.id===house.id)!.building!;
    expect(again.level).toBe(2);expect(again.visualLayout).toEqual(house.visualLayout);
  });
  it('persists a rotated building and preserves its orientation through an upgrade',async()=>{
    await db.updateTable('villageResources').set({amount:'10000'}).where('worldId','=',worldId).where('villageId','=',villageId).execute();
    const initial=await snapshot(),cell=initial.cells.find(c=>c.canBuild)!;
    const built=await constructBuilding(db,accountId,'aube',villageId,cell.cellX,cell.cellY,'dwelling',0,randomUUID(),undefined,1);
    const house=built.cells.find(c=>c.cellX===cell.cellX&&c.cellY===cell.cellY)!.building!;
    expect(house.quarterTurns).toBe(1);expect(house.visualLayout?.quarterTurns).toBe(1);
    const upgraded=await upgradeBuilding(db,accountId,'aube',villageId,house.id,undefined,undefined,0);
    const again=upgraded.cells.find(c=>c.building?.id===house.id)!.building!;expect(again.level).toBe(2);expect(again.quarterTurns).toBe(1);
    const current=await snapshot(),available=new Set(current.cells.filter(c=>c.canBuild).map(c=>`${c.cellX}:${c.cellY}`));
    const shape=(x:number,y:number)=>Array.from({length:30},(_,i)=>({cellX:x+Math.floor(i/5)-2,cellY:y-(i%5-2)}));
    const candidate=current.cells.find(c=>{
      const cells=shape(c.cellX,c.cellY);if(!cells.every(p=>available.has(`${p.cellX}:${p.cellY}`)))return false;
      const heights=cells.map(p=>current.region.elevations[(p.cellY-current.region.originCellY)*current.region.width+p.cellX-current.region.originCellX]!);
      return heights.every(Number.isFinite)&&Math.max(...heights)-Math.min(...heights)<=1;
    });expect(candidate).toBeDefined();
    const campusState=await constructBuilding(db,accountId,'aube',villageId,candidate!.cellX,candidate!.cellY,'university',0,randomUUID(),undefined,1);
    const campus=campusState.cells.find(c=>c.cellX===candidate!.cellX&&c.cellY===candidate!.cellY)!.building!;
    const footprint=campusState.cells.filter(c=>c.footprint?.buildingId===campus.id);expect(footprint).toHaveLength(30);
    expect(Math.max(...footprint.map(c=>c.cellX))-Math.min(...footprint.map(c=>c.cellX))+1).toBe(6);
    expect(Math.max(...footprint.map(c=>c.cellY))-Math.min(...footprint.map(c=>c.cellY))+1).toBe(5);
    const larger=await upgradeBuilding(db,accountId,'aube',villageId,campus.id,undefined,undefined,0);
    expect(larger.cells.filter(c=>c.footprint?.buildingId===campus.id).map(c=>[c.cellX,c.cellY])).toEqual(footprint.map(c=>[c.cellX,c.cellY]));
    expect(larger.cells.find(c=>c.building?.id===campus.id)!.building!.quarterTurns).toBe(1);

  });
  it('enables both ateliers through authenticated DEV capability scoped to the world',async()=>{
    const app=await buildApp({databaseUrl:url,host:'127.0.0.1',port:0,isProduction:false,cookieName:'arbestra_session',sessionTtlDays:30,constructionDurationOverrideMs:null,scheduledTaskPollIntervalMs:1000},db);
    try{const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{email:'player@arbestra.local',password:'arbestra'}});expect(login.statusCode).toBe(200);const header=login.headers['set-cookie'],cookie=(Array.isArray(header)?header[0]:header)!.split(';')[0]!;
      const settings='/api/worlds/aube/dev/factory-access';expect((await app.inject({method:'PUT',url:settings,payload:{enabled:true}})).statusCode).toBe(401);
      expect((await app.inject({method:'PUT',url:settings,headers:{cookie},payload:{enabled:true}})).statusCode).toBe(200);expect((await snapshot()).factoryEnabled).toBe(true);
      expect((await app.inject({method:'GET',url:'/api/worlds/aube/factory-access',headers:{cookie}})).json()).toEqual({enabled:true,canConfigure:true});
      const production=await buildApp({databaseUrl:url,host:'127.0.0.1',port:0,isProduction:true,cookieName:'arbestra_session',sessionTtlDays:30,constructionDurationOverrideMs:null,scheduledTaskPollIntervalMs:1000},db);
      try{
        expect((await production.inject({method:'GET',url:'/api/worlds/aube/factory-access',headers:{cookie}})).json()).toEqual({enabled:false,canConfigure:false});
        const denied=await production.inject({method:'PUT',url:settings,headers:{cookie},payload:{enabled:false}});
        expect(denied.statusCode).toBe(404);expect(denied.json().code).toBe('DEV_ONLY');
        expect((await snapshot()).factoryEnabled).toBe(true);
      }finally{await production.close();}
      expect((await app.inject({method:'PUT',url:settings,headers:{cookie},payload:{enabled:false}})).statusCode).toBe(200);expect((await snapshot()).factoryEnabled).toBe(false);
    }finally{await app.close();}
  });
});

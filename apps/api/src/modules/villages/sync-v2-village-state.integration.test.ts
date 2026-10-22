import {sql} from 'kysely';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {Value} from '@sinclair/typebox/value';
import {applySyncV2Batch,SyncV2ChangeSchema,villageStateFromSyncV2,type SyncV2Change,type VillageState} from '@arbestra/contracts';
import {createDatabase} from '../../database/connection.js';
import {testDatabaseUrl} from '../../database/test-environment.js';
import {resetE2eState} from '../../database/reset-e2e.js';
import {DEVELOPMENT_IDS as ids} from '../../database/seed.js';
import {randomUUID} from 'node:crypto';
import {commandVillageProcessing,constructBuilding,expandGarden,harvestGardenSelection,readVillageProjection} from './service.js';
import {villagePresentation} from './presentation.js';
import {captureSyncV2} from './sync-v2-capture.js';

const url=testDatabaseUrl(),target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.pathname!=='/arbestra_test')throw Error('Unexpected V2 village-state test database');
const db=createDatabase(url);
beforeAll(async()=>{
  // The global reset alone takes 26–31 s with the sync triggers active.
  await resetE2eState(url);
  await sql`insert into game_sync_streams(world_id,stream_kind,scope_key) values(${ids.world},'village',${ids.village}),
    (${ids.world},'knowledge',${ids.account}),(${ids.world},'manifest',${ids.world}),(${ids.world},'traffic',${ids.world}) on conflict do nothing`.execute(db);
},180000);
afterAll(async()=>{
  // resetE2eState keeps foreign villages: remove the convoy fixture's ones.
  await db.transaction().execute(async tx=>{
    await tx.deleteFrom('villages').where('worldId','=',ids.world).where('name','like','Voisin %').execute();
    await tx.deleteFrom('worldMemberships').where('worldId','=',ids.world).where('playerName','like','Voisin %').execute();
    await tx.deleteFrom('accounts').where('email','like','%@traffic.test').execute();
    await sql`select game_sync_publish()`.execute(tx);
  });
  await db.destroy();
},60000);

/** Paths whose values differ. Each side's own capture instant becomes "H":
 * two transactions cannot share one statement timestamp. */
export function differences(left:unknown,right:unknown,leftNow:string,rightNow:string,path='$'):string[]{
  const normal=(value:unknown,now:string)=>value===now?'H':value;
  left=normal(left,leftNow);right=normal(right,rightNow);
  if(Array.isArray(left)&&Array.isArray(right)){
    if(left.length!==right.length)return [`${path}.length ${left.length} != ${right.length}`];
    return left.flatMap((value,index)=>differences(value,right[index],leftNow,rightNow,`${path}[${index}]`));
  }
  if(left&&right&&typeof left==='object'&&typeof right==='object'){
    const keys=new Set([...Object.keys(left),...Object.keys(right)]);
    return [...keys].flatMap(key=>differences((left as Record<string,unknown>)[key],(right as Record<string,unknown>)[key],leftNow,rightNow,`${path}.${key}`));
  }
  return Object.is(left,right)?[]:[`${path}: ${JSON.stringify(left)?.slice(0,80)} != ${JSON.stringify(right)?.slice(0,80)}`];
}

async function project():Promise<{historical:unknown;projected:unknown;now:[string,string]}>{
  const historical=await readVillageProjection(db,ids.account,'aube',ids.village);
  const presentation=villagePresentation(historical);
  const batch=await captureSyncV2(db,ids.account,'aube',ids.village,{protocol:2,generation:1,scopes:[],cursors:[]},{include:['knowledge','manifest','traffic']});
  const applied=applySyncV2Batch({worldId:ids.world,villageId:ids.village,generation:1,scopes:new Map(),
    subscribedScopes:new Set(batch.groups.map(group=>`${group.stream.kind}:${group.stream.key}`))},batch);
  if(applied.kind!=='applied'){
    const branches=SyncV2ChangeSchema.anyOf as unknown as Array<{properties:{component:{const:string}}}>;
    const errors=batch.groups.flatMap(group=>group.changes.flatMap(change=>{
      const branch=branches.find(item=>item.properties.component.const===change.component);
      return branch?[...Value.Errors(branch as never,change)].slice(0,3).map(error=>
        `${change.component}${error.path}: ${error.message} ${JSON.stringify(error.value)?.slice(0,120)}`):[`${change.component}: no branch`];
    })).slice(0,12);
    const duplicates=batch.groups.flatMap(group=>group.changes.flatMap(change=>{
      const keys=change.upsert.map(entity=>JSON.stringify((entity as {id?:unknown;code?:unknown;resource?:unknown;buildingId?:unknown}).id
        ??(entity as {code?:unknown}).code??(entity as {resource?:unknown}).resource??(entity as {buildingId?:unknown}).buildingId));
      return keys.filter((key,index)=>keys.indexOf(key)!==index).map(key=>`${group.stream.kind}.${change.component} ${key}`);
    }));
    throw Error('V2 snapshot not applied:\n'+[...errors,...duplicates].join('\n'));
  }
  const projected=villageStateFromSyncV2(applied.state,presentation,batch.observedAt);
  if(!projected)throw Error('Incomplete V2 projection');
  // Presence without SQL order in the historical reader.
  const canonical=(state:VillageState):unknown=>({...state,syncRevision:undefined,cells:[...state.cells].sort((a,b)=>a.id.localeCompare(b.id)),
    region:{...state.region,features:[...state.region.features].sort((a,b)=>a.id.localeCompare(b.id))},
    travelRoutes:[...state.travelRoutes].sort((a,b)=>a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id)),
    village:{...state.village,resources:[...state.village.resources].sort((a,b)=>a.code.localeCompare(b.code)),extractions:[...state.village.extractions].sort((a,b)=>a.id.localeCompare(b.id)),
      worksites:[...state.village.worksites].sort((a,b)=>a.id.localeCompare(b.id))}});
  return {historical:canonical(historical),projected:canonical(projected),now:[historical.serverTime,projected.serverTime]};
}

it('rebuilds the historical village state from V2 streams and the presentation',async()=>{
  const {historical,projected,now}=await project();
  const diff=differences(historical,projected,...now);
  console.log('V2 VILLAGE DIFF',diff.length,'\n'+diff.slice(0,60).join('\n'));
  expect(diff).toEqual([]);
},120000);

it('keeps parity with harvests, construction, workshop orders and a pending garden extension',async()=>{
  const before=await readVillageProjection(db,ids.account,'aube',ids.village);
  const free=new Set(before.cells.filter(cell=>cell.canBuild).map(cell=>`${cell.cellX}:${cell.cellY}`));
  const square=(skip:Set<string>)=>before.cells.filter(cell=>[0,1].every(dx=>[0,1].every(dy=>{const key=`${cell.cellX+dx}:${cell.cellY+dy}`;return free.has(key)&&!skip.has(key);})))
    .sort((a,b)=>Math.hypot(a.cellX-1024,a.cellY-512)-Math.hypot(b.cellX-1024,b.cellY-512))[0]!;
  // Two adjacent completed gardens: one logical building with merged plots.
  const row=before.cells.filter(cell=>[0,1,2].every(dx=>free.has(`${cell.cellX+dx}:${cell.cellY}`)))
    .sort((a,b)=>Math.hypot(a.cellX-1024,a.cellY-512)-Math.hypot(b.cellX-1024,b.cellY-512))[0]!;
  const used=new Set([0,1,2].map(dx=>`${row.cellX+dx}:${row.cellY}`));
  await db.transaction().execute(async tx=>{
    await tx.selectFrom('villages').select('id').where('id','=',ids.village).forUpdate().executeTakeFirstOrThrow();
    const t=(await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('t')).executeTakeFirstOrThrow()).t;
    for(const cells of [[0,1],[2]].map(group=>group.map(dx=>({cellX:row.cellX+dx,cellY:row.cellY})))){
      const building=await tx.insertInto('buildings').values({worldId:ids.world,villageId:ids.village,buildingType:'garden',level:1,targetLevel:null,
        status:'completed',constructionStartedAt:null,constructionCompletesAt:null,completedAt:t}).returning('id').executeTakeFirstOrThrow();
      await tx.insertInto('worldCellOccupancies').values(cells.map((cell,index)=>({...cell,worldId:ids.world,buildingId:building.id,featureId:null,
        role:index===0?'anchor' as const:'body' as const}))).execute();
      await tx.insertInto('gardenPlots').values(cells.map((cell,index)=>({...cell,worldId:ids.world,villageId:ids.village,buildingId:building.id,
        storedAmount:10+index*10,remainder:.25,productionUpdatedAt:t}))).execute();
    }
    // Building costs for the stonemason and the sawmill below.
    await tx.updateTable('villageResources').set({amount:500}).where('worldId','=',ids.world).where('villageId','=',ids.village)
      .where('resourceCode','in',['stone','wood']).execute();
    await sql`select game_sync_publish()`.execute(tx);
  });
  const withGardens=await readVillageProjection(db,ids.account,'aube',ids.village);
  const garden=withGardens.cells.find(cell=>cell.building?.garden)!.building!;
  expect(garden.garden!.plots).toHaveLength(3);
  // A garden extension on a free cell next to the garden footprint.
  const gardenCells=new Set(withGardens.cells.filter(cell=>cell.footprint?.buildingId===garden.id).map(cell=>`${cell.cellX}:${cell.cellY}`));
  const extension=withGardens.cells.find(cell=>cell.canBuild&&[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>gardenCells.has(`${cell.cellX+dx!}:${cell.cellY+dy!}`)))!;
  await expandGarden(db,ids.account,'aube',ids.village,garden.id,[{cellX:extension.cellX,cellY:extension.cellY}],null);
  used.add(`${extension.cellX}:${extension.cellY}`);
  // Placement before the harvest: a committed team path blocks a footprint.
  const site=square(used);for(const dx of [0,1])for(const dy of [0,1])used.add(`${site.cellX+dx}:${site.cellY+dy}`);
  await constructBuilding(db,ids.account,'aube',ids.village,site.cellX,site.cellY,'stonemason',null);
  const workshop=square(used);
  await constructBuilding(db,ids.account,'aube',ids.village,workshop.cellX,workshop.cellY,'sawmill',0);
  const sawmill=await db.selectFrom('buildings').select('id').where('villageId','=',ids.village).where('buildingType','=','sawmill').executeTakeFirstOrThrow();
  await db.transaction().execute(async tx=>{
    await tx.selectFrom('villages').select('id').where('id','=',ids.village).forUpdate().executeTakeFirstOrThrow();
    await tx.updateTable('buildings').set({status:'completed',completedAt:new Date(),constructionCompletesAt:new Date()}).where('id','=',sawmill.id).execute();
    await sql`select game_sync_publish()`.execute(tx);
  });
  await commandVillageProcessing(db,ids.account,'aube',ids.village,{commandId:randomUUID(),action:'start',buildingId:sawmill.id,lots:2,workerCount:1});
  const ready=garden.garden!.plots.filter(plot=>plot.storedCarrots>=1).slice(0,2);
  expect(ready).toHaveLength(2);
  await harvestGardenSelection(db,ids.account,'aube',ids.village,ready.map(({cellX,cellY})=>({cellX,cellY})),randomUUID());
  // A convoy between two other villages: public, hence visible here too.
  const foreign=await db.transaction().execute(async tx=>{
    const t=(await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('t')).executeTakeFirstOrThrow()).t;
    const villages:string[]=[];
    for(const offset of [40,80]){
      const account=(await tx.insertInto('accounts').values({id:randomUUID(),email:`${randomUUID()}@traffic.test`,passwordHash:'fixture'}).returning('id').executeTakeFirstOrThrow()).id;
      await tx.insertInto('worldMemberships').values({worldId:ids.world,accountId:account,playerName:'Voisin '+offset}).execute();
      villages.push((await tx.insertInto('villages').values({id:randomUUID(),worldId:ids.world,ownerAccountId:account,name:'Voisin '+offset,
        anchorCellX:1024+offset,anchorCellY:512+offset,economyActivatedAt:t}).returning('id').executeTakeFirstOrThrow()).id);
    }
    const offer=await tx.insertInto('tradeOffers').values({worldId:ids.world,villageId:villages[1]!,requestedResource:'wood',requestedAmount:10,
      offeredResource:'stone',offeredAmount:5,maxTravelSeconds:600,status:'accepted',createdAt:t,oracleAt:t,oracleEligible:false}).returning('id').executeTakeFirstOrThrow();
    const journey=await tx.insertInto('tradeJourneys').values({worldId:ids.world,villageId:villages[0]!,destinationVillageId:villages[1]!,offerId:offer.id,
      workerCount:2,path:JSON.stringify([{cellX:1064,cellY:552},{cellX:1104.5,cellY:592}]),startedAt:t,
      arrivesAt:new Date(t.getTime()+600000),returnsAt:new Date(t.getTime()+1200000)}).returning('id').executeTakeFirstOrThrow();
    await sql`select game_sync_publish()`.execute(tx);
    return journey.id;
  });
  const {historical,projected,now}=await project();
  const state=historical as VillageState;
  expect(state.village.market?.journeys?.some(journey=>journey.id===foreign)).toBe(true);
  // The public stream never carries the offer or the cargo.
  const traffic=await captureSyncV2(db,ids.account,'aube',ids.village,{protocol:2,generation:1,scopes:[],cursors:[]},{include:['traffic']});
  const convoys=traffic.groups.find(group=>group.stream.kind==='traffic')!.changes
    .find((change):change is Extract<SyncV2Change,{component:'convoys'}>=>change.component==='convoys')!;
  const convoy=convoys.upsert.find(row=>row.id===foreign)!;
  expect(Object.keys(convoy).sort()).toEqual(['arrivesAt','destinationVillageId','id','path','returnsAt','startedAt','villageId','workerCount']);
  // Incremental path: the traffic journal reports the end of that convoy.
  await db.transaction().execute(async tx=>{
    await tx.deleteFrom('tradeJourneys').where('id','=',foreign).execute();
    await sql`select game_sync_publish()`.execute(tx);
  });
  const delta=await captureSyncV2(db,ids.account,'aube',ids.village,{protocol:2,generation:1,
    scopes:[{kind:'traffic',key:ids.world}],cursors:traffic.groups.map(group=>({...group.stream,revision:group.toRevision}))});
  expect(delta.coverage).toBe('delta');
  expect(delta.groups.find(group=>group.stream.kind==='traffic')!.changes).toEqual([{component:'convoys',upsert:[],remove:[foreign]}]);
  expect(state.village.processingOrders?.length).toBeGreaterThan(0);
  expect(state.cells.some(cell=>cell.building?.status==='under-construction')).toBe(true);
  expect(state.cells.some(cell=>cell.building?.garden?.plots.some(plot=>plot.harvest))).toBe(true);
  expect(state.cells.some(cell=>(cell.building?.garden?.expansions?.length??0)>0)).toBe(true);
  const diff=differences(historical,projected,...now);
  console.log('V2 VILLAGE ACTIVITY DIFF',diff.length,'\n'+diff.slice(0,60).join('\n'));
  expect(diff).toEqual([]);
},180000);

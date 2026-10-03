import {randomUUID} from 'node:crypto';
import {sql,type Kysely,type Transaction} from 'kysely';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {planGardenTour,type TravelRoute} from '@arbestra/contracts';
import {createDatabase} from '../../database/connection.js';
import type {Database} from '../../database/schema.js';
import {testDatabaseUrl} from '../../database/test-environment.js';
import {migrateToLatest} from '../../database/migrate.js';
import {resetE2eState} from '../../database/reset-e2e.js';
import {DEVELOPMENT_CELLS,DEVELOPMENT_IDS} from '../../database/seed.js';
import {startGardenTour} from './garden-tour.js';
import {completeGardenHarvestAt,startGardenHarvest} from './garden-harvest.js';
import {harvestGardenSelection,harvestGarden} from '../villages/service.js';
import {materializeGardenPlot} from '../villages/economy.js';
const url=testDatabaseUrl(),db=createDatabase(url),worldId=DEVELOPMENT_IDS.world,villageId=DEVELOPMENT_IDS.village;
beforeAll(async()=>{await migrateToLatest(url);await resetE2eState(url);});afterAll(()=>db.destroy());
const rollback=new Error('garden tour fixture rollback');
const cells=[DEVELOPMENT_CELLS.garden,DEVELOPMENT_CELLS.gardenNorth];
function inside(tx:Transaction<Database>):Kysely<Database>{return {transaction:()=>({execute:<T>(run:(tx:Transaction<Database>)=>Promise<T>)=>run(tx)})} as unknown as Kysely<Database>;}
async function fixture(run:(tx:Transaction<Database>,t:Date,id:string)=>Promise<void>,expectedError:Error=rollback){
  await expect(db.transaction().execute(async tx=>{
    await tx.selectFrom('villages').select('id').where('id','=',villageId).forUpdate().executeTakeFirstOrThrow();
    const t=(await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('t')).executeTakeFirstOrThrow()).t;
    const b=await tx.insertInto('buildings').values({worldId,villageId,buildingType:'garden',level:1,targetLevel:null,status:'completed',
      constructionStartedAt:null,constructionCompletesAt:null,completedAt:t}).returning('id').executeTakeFirstOrThrow();
    await tx.insertInto('worldCellOccupancies').values(cells.map((c,i)=>({...c,worldId,buildingId:b.id,featureId:null,role:i===0?'anchor' as const:'body' as const}))).execute();
    await tx.insertInto('gardenPlots').values(cells.map((c,i)=>({...c,worldId,villageId,buildingId:b.id,storedAmount:10+i*10,remainder:.25,productionUpdatedAt:t}))).execute();
    await run(tx,t,b.id);throw rollback;
  })).rejects.toBe(expectedError);
}
const stock=(tx:Transaction<Database>)=>tx.selectFrom('villageResources').select('amount').where('worldId','=',worldId).where('villageId','=',villageId).where('resourceCode','=','carrot').executeTakeFirstOrThrow();
function plan(){const route:TravelRoute={id:'garden',kind:'garden',destination:cells[1]!,cells:[DEVELOPMENT_CELLS.townHall,...cells]};return planGardenTour([route],DEVELOPMENT_CELLS.townHall,cells)!;}
it('reserves all plots with one worker and one task; credits only at the single final return, exactly once',async()=>{
  await fixture(async(tx,t)=>{
    const before=BigInt((await stock(tx)).amount),p=plan();
    const id=await startGardenTour(tx,worldId,villageId,randomUUID(),t,p);
    const h=await tx.selectFrom('gardenHarvests').selectAll().where('id','=',id).executeTakeFirstOrThrow();
    expect(h.workerCount).toBe(1);expect(h.stops.map(s=>s.reservedCarrots)).toEqual([10,20]);expect(Number(h.reservedCarrots)).toBe(30);
    const workers=await tx.selectFrom('populationCohorts').select('memberCount').where('harvestId','=',id).execute();
    expect(workers.reduce((n,c)=>n+c.memberCount,0)).toBe(1);
    expect(await tx.selectFrom('scheduledTasks').select('id').where('subjectId','=',id).execute()).toHaveLength(1);
    const plots=await tx.selectFrom('gardenPlots').selectAll().where('buildingId','=',h.buildingId).orderBy('cellY').execute();
    expect(plots.map(p=>Number(p.storedAmount))).toEqual([0,0]);expect(plots.map(p=>Number(p.remainder))).toEqual([.25,.25]);
    await completeGardenHarvestAt(tx,worldId,villageId,id,new Date(t.getTime()+p.stops[0]!.workEndsAfterMs));
    expect(BigInt((await stock(tx)).amount)).toBe(before);
    await materializeGardenPlot(tx,worldId,cells[0]!.cellX,cells[0]!.cellY,new Date(t.getTime()+120000));
    expect(Number((await tx.selectFrom('gardenPlots').select('storedAmount').where('buildingId','=',h.buildingId).where('cellY','=',cells[0]!.cellY).executeTakeFirstOrThrow()).storedAmount)).toBeGreaterThan(0);
    await completeGardenHarvestAt(tx,worldId,villageId,id,h.completesAt);await completeGardenHarvestAt(tx,worldId,villageId,id,h.completesAt);
    expect(BigInt((await stock(tx)).amount)).toBe(before+30n);
    expect(await tx.selectFrom('populationCohorts').select('id').where('harvestId','=',id).execute()).toHaveLength(0);
    // Reconciliation never acknowledges the scheduler's notification.
    expect((await tx.selectFrom('scheduledTasks').select('completedAt').where('subjectId','=',id).executeTakeFirstOrThrow()).completedAt).toBeNull();
  });
});
it('blocks overlap on a later stop through both selection and legacy single-plot commands',async()=>{
  await fixture(async(tx,t,buildingId)=>{
    await startGardenTour(tx,worldId,villageId,randomUUID(),t,plan());
    await expect(startGardenTour(tx,worldId,villageId,randomUUID(),t,plan())).rejects.toMatchObject({code:'GARDEN_HARVEST_IN_PROGRESS'});
    await expect(startGardenHarvest(tx,worldId,villageId,buildingId,cells[1]!.cellX,cells[1]!.cellY,randomUUID(),t)).rejects.toMatchObject({code:'GARDEN_HARVEST_IN_PROGRESS'});
    expect(await tx.selectFrom('gardenHarvests').select('id').where('worldId','=',worldId).execute()).toHaveLength(1);
  });
});
it('projects a single shared tour on all selected plots and retries the exact payload without another departure',async()=>{
  await fixture(async(tx,_t,buildingId)=>{
    const source=inside(tx),command=randomUUID();
    const result=await harvestGardenSelection(source,DEVELOPMENT_IDS.account,'aube',villageId,cells,command);
    const plots=result.cells.flatMap(c=>c.building?.garden?.plots??[]);
    expect(plots).toHaveLength(2);expect(new Set(plots.map(p=>p.harvest?.id)).size).toBe(1);
    expect(plots.map(p=>p.harvest?.reservedCarrots)).toEqual([10,20]);
    await harvestGardenSelection(source,DEVELOPMENT_IDS.account,'aube',villageId,cells,command);
    await expect(harvestGardenSelection(source,DEVELOPMENT_IDS.account,'aube',villageId,[cells[0]!],command)).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    await expect(harvestGarden(source,DEVELOPMENT_IDS.account,'aube',villageId,buildingId,cells[0]!.cellX,cells[0]!.cellY,command)).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    expect(await tx.selectFrom('gardenHarvests').select('id').where('worldId','=',worldId).execute()).toHaveLength(1);
    await expect(harvestGardenSelection(source,DEVELOPMENT_IDS.account,'aube',randomUUID(),cells,randomUUID())).rejects.toMatchObject({code:'VILLAGE_NOT_FOUND'});
  });
});
it('rolls back all reservations, cohorts and tasks after a proven accepted departure followed by an injected failure',async()=>{
  const tables=['gardenPlots','gardenHarvests','populationCohorts','villageResources','scheduledTasks'] as const;
  const rows=()=>Promise.all(tables.map(table=>db.selectFrom(table).selectAll().where('worldId','=',worldId).execute().then(r=>r.map(x=>JSON.stringify(x)).sort())));
  const before=await rows(),injected=new Error('abort after verified tour reservation');
  await fixture(async(tx,t)=>{
    const id=await startGardenTour(tx,worldId,villageId,randomUUID(),t,plan());
    expect(await tx.selectFrom('populationCohorts').select('id').where('harvestId','=',id).execute()).toHaveLength(1);
    expect(await tx.selectFrom('scheduledTasks').select('id').where('subjectId','=',id).execute()).toHaveLength(1);
    expect((await tx.selectFrom('gardenPlots').select('storedAmount').where('worldId','=',worldId).execute()).every(p=>Number(p.storedAmount)===0)).toBe(true);
    throw injected;
  },injected);
  expect(await rows()).toEqual(before);
});

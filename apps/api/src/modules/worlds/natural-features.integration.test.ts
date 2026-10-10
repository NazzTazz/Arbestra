import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createDatabase} from '../../database/connection.js';
import {migrateToLatest} from '../../database/migrate.js';
import {testDatabaseUrl} from '../../database/test-environment.js';
import {naturalFeaturesQuery} from './natural-features.js';
const url=testDatabaseUrl(),target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.pathname!=='/arbestra_test')throw Error('Unexpected spatial fixture DB');
const db=createDatabase(url),worlds=[randomUUID(),randomUUID()];
beforeAll(async()=>{await migrateToLatest(url);for(const id of worlds)await db.insertInto('worlds').values({id,slug:'features-'+id,name:'Feature read fixture',topology:'torus',widthCells:512,heightCells:256,chunkSize:32,seed:4109,generationStatus:'ready',generationVersion:3,isOpen:true,generatedAt:new Date()}).execute();},120000);
afterAll(async()=>{await db.deleteFrom('woodlandDeposits').where('worldId','in',worlds).execute();await db.deleteFrom('stoneDeposits').where('worldId','in',worlds).execute();await db.deleteFrom('worlds').where('id','in',worlds).execute();await db.destroy();});
it('projects only deposits inside the requested areas and preserves canonical locations across seams and worlds',async()=>{
 const ids=Array.from({length:5},()=>randomUUID()),points=[[511,255],[0,0],[20,20],[0,1],[0,0]];
 for(let i=0;i<ids.length;i++){
  const worldId=worlds[i===4?1:0]!,p=points[i]!;
  await db.insertInto('worldFeatures').values({id:ids[i]!,worldId,featureTypeCode:'stone_outcrop',state:'available',variantSeed:1}).execute();
  if(i!==3)await db.insertInto('stoneDeposits').values({worldId,featureId:ids[i]!,cellX:p[0]!,cellY:p[1]!,initialAmount:2000,remainingAmount:2000,reservedAmount:0,revision:1,updatedAt:new Date()}).execute();
  await db.insertInto('worldCellOccupancies').values({worldId,featureId:ids[i]!,buildingId:null,pendingExpansionId:null,cellX:i===2?1:p[0]!,cellY:i===2?0:p[1]!,role:'body'}).execute();
 }
 const areas=[{minX:510,maxX:512,minY:254,maxY:256},{minX:0,maxX:2,minY:0,maxY:2}];
 const query=naturalFeaturesQuery(db,worlds[0]!,areas),rows=await query.execute();
 expect(rows.map(r=>r.id).sort()).toEqual([ids[0],ids[1],ids[3]].sort());
 expect(rows.find(r=>r.id===ids[0])).toMatchObject({cellX:511,cellY:255,remainingAmount:'2000'});
 expect(rows.find(r=>r.id===ids[3])).toMatchObject({remainingAmount:null});
 const compiled=query.compile(),result=await db.executeQuery({...compiled,sql:'explain (analyze,format json) '+compiled.sql});
 const plan=(Object.values(result.rows[0]!)[0] as unknown as Array<{Plan:Record<string,unknown>}>)[0]!.Plan;
 const find=(p:Record<string,unknown>):Record<string,unknown>|undefined=>p['Subplan Name']==='CTE projected_deposits'?p:(p.Plans as Array<Record<string,unknown>>|undefined)?.map(find).find(Boolean);
 // Decisive cost boundary: the economic view evaluates two visible deposits,
 // excluding the off-window resource and the second world's deposit.
 expect(find(plan)?.['Actual Rows']).toBe(2);
});

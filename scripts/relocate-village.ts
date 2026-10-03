/** One-off, guarded relocation of local Clairi?re. Read-only unless --apply is supplied. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../apps/api/src/config.js';
import { createDatabase } from '../apps/api/src/database/connection.js';
import { beginVillageEconomy } from '../apps/api/src/modules/villages/reconcile-economy.js';
import { measureRegime, TAU } from '../apps/world-web/src/scene/cosmology.js';

const config=loadConfig(), url=new URL(config.databaseUrl);
if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || config.isProduction) throw new Error('Local development only');
const db=createDatabase(config.databaseUrl);
const villageId='30000000-0000-4000-8000-000000000001';
const worldId='20000000-0000-4000-8000-000000000001';
const clearingId='bbb1691a-fe1b-4ffc-968c-57b23245dd25';
const target={cellX:1102,cellY:21};
const apply=process.argv.includes('--apply');
try {
  if (process.argv.includes('--status')) {
    console.log(JSON.stringify(await db.selectFrom('villages').select(['id','name','anchorCellX','anchorCellY'])
      .where('worldId','=',worldId).where('id','=',villageId).executeTakeFirstOrThrow()));
  } else {
  const result=await db.transaction().execute(async tx=>{
    await beginVillageEconomy(tx,worldId,villageId);
    const village=await tx.selectFrom('villages').selectAll().where('worldId','=',worldId).where('id','=',villageId).executeTakeFirstOrThrow();
    const world=await tx.selectFrom('worlds').selectAll().where('id','=',worldId).executeTakeFirstOrThrow();
    if(world.slug!=='aube'||village.name!=='Clairière'||village.anchorCellX!==1024||village.anchorCellY!==512) throw new Error('Unexpected source, or already moved');
    const clearing=await tx.selectFrom('worldClearings').selectAll().where('worldId','=',worldId).where('id','=',clearingId).forUpdate().executeTakeFirstOrThrow();
    if(clearing.status!=='protected'||clearing.claimedVillageId) throw new Error('Destination unavailable');
    const buildings=await tx.selectFrom('buildings').selectAll().where('worldId','=',worldId).where('villageId','=',villageId).execute();
    const expansions=await tx.selectFrom('buildingExpansions').selectAll().where('worldId','=',worldId).where('villageId','=',villageId).where('status','=','under-construction').execute();
    const harvests=await tx.selectFrom('gardenHarvests').select('id').where('worldId','=',worldId).where('villageId','=',villageId).where('status','=','in-progress').execute();
    const extractions=await tx.selectFrom('depositExtractions').select('id').where('worldId','=',worldId).where('villageId','=',villageId).where('status','=','in-progress').execute();
    if(expansions.length||harvests.length||extractions.length||buildings.some(b=>b.status!=='completed')) throw new Error('Work in progress; retry after it finishes');
    const ids=buildings.map(b=>b.id);
    const occupations=await tx.selectFrom('worldCellOccupancies').selectAll().where('worldId','=',worldId).where('buildingId','in',ids).orderBy('cellX').orderBy('cellY').execute();
    const plots=await tx.selectFrom('gardenPlots').selectAll().where('worldId','=',worldId).where('villageId','=',villageId).orderBy('cellX').orderBy('cellY').execute();
    const stocks=await tx.selectFrom('villageResources').selectAll().where('worldId','=',worldId).where('villageId','=',villageId).orderBy('resourceCode').execute();
    const people=await tx.selectFrom('populationCohorts').selectAll().where('worldId','=',worldId).where('villageId','=',villageId).orderBy('id').execute();
    const oldClearings=await tx.selectFrom('worldClearings').selectAll().where('worldId','=',worldId).where('claimedVillageId','=',villageId).execute();
    const mod=(n:number,m:number)=>(n%m+m)%m;
    const move=(p:{cellX:number;cellY:number})=>({cellX:mod(p.cellX+target.cellX-village.anchorCellX,world.widthCells),cellY:mod(p.cellY+target.cellY-village.anchorCellY,world.heightCells)});
    // Recheck the entire footprint plus a one-cell buffer against current world data.
    const cells=new Map<string,{cellX:number;cellY:number}>();
    for(const o of occupations) for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++) {
      const c=move({cellX:o.cellX+dx,cellY:o.cellY+dy}); cells.set(`${c.cellX}:${c.cellY}`,c);
    }
    const collisions=await tx.selectFrom('worldCellOccupancies').select('cellX').where('worldId','=',worldId)
      .where('cellX','in',[...new Set([...cells.values()].map(c=>c.cellX))]).where('cellY','in',[...new Set([...cells.values()].map(c=>c.cellY))]).execute();
    if(collisions.length) throw new Error('Destination occupied');
    const chunkKeys=new Map([...cells.values()].map(c=>{const x=Math.floor(c.cellX/world.chunkSize),y=Math.floor(c.cellY/world.chunkSize);return [`${x}:${y}`,{x,y}] as const;}));
    const chunks=new Map<string,{terrainCodes:number[]}>();
    for(const [key,{x,y}] of chunkKeys) chunks.set(key,await tx.selectFrom('worldChunks').select('terrainCodes').where('worldId','=',worldId).where('chunkX','=',x).where('chunkY','=',y).executeTakeFirstOrThrow());
    for(const c of cells.values()) if(chunks.get(`${Math.floor(c.cellX/world.chunkSize)}:${Math.floor(c.cellY/world.chunkSize)}`)!.terrainCodes[(c.cellY%world.chunkSize)*world.chunkSize+c.cellX%world.chunkSize]!==1) throw new Error('Non-buildable terrain');
    const sunlight=measureRegime(target.cellX/world.widthCells*TAU,target.cellY/world.heightCells*TAU+Math.PI,undefined,2048);
    if(!apply) return {mode:'preview',target,buildings:buildings.length,occupiedCells:occupations.length,gardenPlots:plots.length,sunlitFraction:sunlight.dayFraction};
    const backup=`test-results/relocations/clairiere-${Date.now()}.json`;
    mkdirSync('test-results/relocations',{recursive:true});
    writeFileSync(backup,JSON.stringify({village,buildings,occupations,plots,stocks,people,oldClearings,clearing,target},null,2),{flag:'wx'});
    for(const o of occupations) await tx.updateTable('worldCellOccupancies').set(move(o)).where('worldId','=',worldId).where('cellX','=',o.cellX).where('cellY','=',o.cellY).where('buildingId','=',o.buildingId!).executeTakeFirstOrThrow();
    for(const p of plots) await tx.updateTable('gardenPlots').set(move(p)).where('worldId','=',worldId).where('villageId','=',villageId).where('cellX','=',p.cellX).where('cellY','=',p.cellY).executeTakeFirstOrThrow();
    await tx.updateTable('worldClearings').set({status:'protected',claimedVillageId:null}).where('worldId','=',worldId).where('claimedVillageId','=',villageId).execute();
    await tx.updateTable('worldClearings').set({status:'claimed',claimedVillageId:villageId}).where('worldId','=',worldId).where('id','=',clearingId).execute();
    await tx.updateTable('villages').set({anchorCellX:target.cellX,anchorCellY:target.cellY}).where('worldId','=',worldId).where('id','=',villageId).execute();
    const afterStocks=await tx.selectFrom('villageResources').selectAll().where('worldId','=',worldId).where('villageId','=',villageId).orderBy('resourceCode').execute();
    const afterPeople=await tx.selectFrom('populationCohorts').selectAll().where('worldId','=',worldId).where('villageId','=',villageId).orderBy('id').execute();
    const afterBuildings=await tx.selectFrom('buildings').selectAll().where('worldId','=',worldId).where('villageId','=',villageId).execute();
    const afterPlots=await tx.selectFrom('gardenPlots').selectAll().where('worldId','=',worldId).where('villageId','=',villageId).orderBy('cellX').orderBy('cellY').execute();
    const afterOccupations=await tx.selectFrom('worldCellOccupancies').selectAll().where('worldId','=',worldId).where('buildingId','in',ids).orderBy('cellX').orderBy('cellY').execute();
    const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
    if(!same(stocks,afterStocks)||!same(people,afterPeople)||!same(buildings.sort((a,b)=>a.id.localeCompare(b.id)),afterBuildings.sort((a,b)=>a.id.localeCompare(b.id)))
      ||!same(plots.map(p=>({...p,...move(p)})),afterPlots)||!same(occupations.map(o=>({...o,...move(o)})),afterOccupations)) throw new Error('Preservation check failed; rollback');
    return {mode:'committed',target,buildings:buildings.length,occupiedCells:occupations.length,gardenPlots:plots.length,sunlitFraction:sunlight.dayFraction,backup};
  });
  console.log(JSON.stringify(result));
  }
} finally {await db.destroy();}

import {HttpError} from '../../errors.js';
import {randomUUID} from 'node:crypto';
import {sql,type Kysely,type Transaction} from 'kysely';
import type {Database} from '../../database/schema.js';
import type {Rc1ResourceState} from './rc1-field.js';
import type {SpawnResourceSupplement,GeneratedLandscape} from '@arbestra/contracts';
export async function readRc1Resources(db:Kysely<Database>,worldId:string):Promise<Rc1ResourceState[]>{
 const metadata=await db.selectFrom('worldRc1Resources').selectAll().where('worldId','=',worldId).execute();
 if(!metadata.length)return [];
 // Keep the projected view world-filtered before joining in memory: a nested
 // loop through its UNION can otherwise evaluate woodland_stock_at millions of times.
 const deposits=await db.selectFrom('resourceDeposits').select(['featureId','resourceCode','cellX','cellY','initialAmount','remainingAmount','reservedAmount','cleared']).where('worldId','=',worldId).execute();
 const byId=new Map(deposits.map(r=>[r.featureId,r]));
 return metadata.flatMap(m=>{const r=byId.get(m.featureId);return r?[{sourceKey:m.sourceKey,featureId:m.featureId,kind:r.resourceCode,cellX:r.cellX,cellY:r.cellY,treeIndices:m.treeIndices,removedIndices:m.removedIndices,amount:Number(r.initialAmount),remainingAmount:Number(r.remainingAmount),reservedAmount:Number(r.reservedAmount),cleared:r.cleared}]:[];});

}
export async function persistRc1Resources(tx:Transaction<Database>,worldId:string,resources:Rc1ResourceState[],supplements:SpawnResourceSupplement[],villageId:string,through:Date,data:GeneratedLandscape){
 const additions=[...resources.filter(r=>!r.featureId),...supplements.map((s,i)=>({sourceKey:`starter:${villageId}:${i}`,kind:s.kind==='wood'?'wood' as const:'stone' as const,cellX:s.surface.x,cellY:s.surface.y,treeIndices:[],removedIndices:[],amount:s.amount,remainingAmount:s.amount,reservedAmount:0,cleared:false}))];
 const records=additions.map(group=>({...group,id:randomUUID()}));
 // Batch the projection; no per-tree persistent entity or thousands of DB round trips.
 for(let i=0;i<records.length;i+=200){
  const batch=records.slice(i,i+200);
  await tx.insertInto('worldFeatures').values(batch.map(g=>({id:g.id,worldId,featureTypeCode:g.kind==='wood'?'woodland':'stone_outcrop',state:'available' as const,variantSeed:g.kind==='wood'?3:2000}))).execute();
  await tx.insertInto('worldRc1Resources').values(batch.map(g=>({worldId,featureId:g.id,sourceKey:g.sourceKey,treeIndices:JSON.stringify(g.treeIndices),removedIndices:JSON.stringify(g.removedIndices)}))).execute();
  const common=(g:typeof batch[number])=>({worldId,featureId:g.id,cellX:g.cellX,cellY:g.cellY,initialAmount:g.amount,remainingAmount:g.amount,reservedAmount:0,revision:1,updatedAt:through});
  const wood=batch.filter(g=>g.kind==='wood'),stone=batch.filter(g=>g.kind==='stone');
  if(wood.length)await tx.insertInto('woodlandDeposits').values(wood.map(g=>({...common(g),regrowthUpdatedAt:through}))).execute();
  if(stone.length)await tx.insertInto('stoneDeposits').values(stone.map(common)).execute();
  const cells=(groups:typeof batch)=>groups.flatMap(g=>{
   const points=g.kind==='wood'&&g.treeIndices.length?g.treeIndices.map(j=>data.forest!.trees[j]!):[{x:g.cellX,y:g.cellY}];
   return [...new Map(points.map(p=>{const cellX=(Math.round(p.x)%512+512)%512,cellY=(Math.round(p.y)%256+256)%256;return[cellX+':'+cellY,{cellX,cellY,worldId,featureId:g.id,buildingId:null,role:'body' as const}]})).values()];
  });
  const natural=cells(batch.filter(g=>!g.sourceKey.startsWith('starter:'))),added=cells(batch.filter(g=>g.sourceKey.startsWith('starter:')));
  // Natural geometry can share a cell; its exact footprint remains authoritative.
  if(natural.length)await tx.insertInto('worldCellOccupancies').values(natural).onConflict(c=>c.columns(['worldId','cellX','cellY']).doNothing()).execute();
  // A planned supplement must obtain every cell or the whole installation rolls back.
  if(added.length)await tx.insertInto('worldCellOccupancies').values(added).execute();
 }

}
export async function removeSpawnTrees(tx:Transaction<Database>,worldId:string,removed:number[],cells:readonly {cellX:number;cellY:number}[],through:Date){
 if(!removed.length)return;
 const set=new Set(removed),groups=await readRc1Resources(tx,worldId);
 for(const group of groups.filter(g=>g.kind==='wood'&&g.treeIndices.some(i=>set.has(i))).sort((a,b)=>a.featureId!.localeCompare(b.featureId!))){
  const row=await tx.selectFrom('woodlandDeposits').selectAll().where('worldId','=',worldId).where('featureId','=',group.featureId!).forUpdate().executeTakeFirstOrThrow();
  if(Number(row.reservedAmount)>0)throw new HttpError(409,'SPAWN_BLOCKED','Ces arbres sont réservés pour une récolte.');
  const all=[...new Set([...group.removedIndices,...group.treeIndices.filter(i=>set.has(i))])],newly=all.length-group.removedIndices.length;
  const capacity=(group.treeIndices.length-all.length)*500;
  // The aggregate's access cell must not remain beneath the new building: the
  // ordinary woodland reconciliation would otherwise clear every surviving tree.
  const surviving=capacity?await tx.selectFrom('worldCellOccupancies').select(['cellX','cellY']).where('worldId','=',worldId).where('featureId','=',group.featureId!).where(eb=>eb.not(eb.or(cells.map(c=>eb.and([eb('cellX','=',c.cellX),eb('cellY','=',c.cellY)]))))).orderBy('cellX').orderBy('cellY').executeTakeFirst():undefined;
  if(capacity&&!surviving)throw new HttpError(409,'SPAWN_BLOCKED','Le bosquet ne peut pas conserver son accès.');
  await tx.updateTable('worldRc1Resources').set({removedIndices:JSON.stringify(all)}).where('worldId','=',worldId).where('featureId','=',group.featureId!).execute();
  await tx.updateTable('woodlandDeposits').set({...(surviving??{}),initialAmount:Math.max(1,capacity),remainingAmount:Math.min(capacity,Math.max(0,Number(row.remainingAmount)-newly*500)),cleared:capacity===0,regrowthUpdatedAt:through,updatedAt:through,revision:sql`revision+1`}).where('worldId','=',worldId).where('featureId','=',group.featureId!).execute();
  await tx.deleteFrom('worldCellOccupancies').where('worldId','=',worldId).where('featureId','=',group.featureId!).where(eb=>eb.or(cells.map(c=>eb.and([eb('cellX','=',c.cellX),eb('cellY','=',c.cellY)])))).execute();
 }
}

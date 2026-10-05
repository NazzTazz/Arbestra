import {isDeepStrictEqual} from 'node:util';
import {sql,type Kysely,type Transaction} from 'kysely';
import {buildTravelNetwork,prepareInfrastructureEdit,automaticBraziers,pathIntersectsBox,buildingAccesses,emptyInfrastructure,infrastructurePlanSurface,infrastructureSidewalkSurface,subCellKey,wrappedDistance,
  type InfrastructurePlan,type InfrastructureRequest,type InfrastructurePreview,type InfrastructureQuote,type VillageState,type SubPoint} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import {HttpError} from '../../errors.js';
import {beginVillageEconomy} from './reconcile-economy.js';
import {ownedVillage,state,debit} from './service.js';
export async function readInfrastructure(tx:Kysely<Database>,worldId:string,villageId:string):Promise<InfrastructurePlan>{
  return (await tx.selectFrom('villageInfrastructure').select('plan').where('worldId','=',worldId).where('villageId','=',villageId).executeTakeFirst())?.plan??emptyInfrastructure();
}
export async function factoryCapability(db:Kysely<Database>,worldId:string){return (await db.selectFrom('worldFactorySettings').select('enabled').where('worldId','=',worldId).executeTakeFirst())?.enabled??false;}
export function assertInfrastructurePosition(snapshot:VillageState,p:SubPoint,blocking=false,ignoreId?:string){
  const world=snapshot.world,cell={cellX:Math.floor((p.x+4)/8)%world.widthCells,cellY:Math.floor((p.y+4)/8)%world.heightCells};
  const dx=wrappedDistance(cell.cellX,snapshot.village.anchorCellX,world.widthCells),dy=wrappedDistance(cell.cellY,snapshot.village.anchorCellY,world.heightCells);
  if(p.x<0||p.y<0||p.x>=world.widthCells*8||p.y>=world.heightCells*8||dx< -32||dx>=32||dy< -32||dy>=32)throw new HttpError(409,'OUTSIDE_INFRASTRUCTURE_REACH','Hors du périmètre historique du village.');
  const xx=(cell.cellX-snapshot.region.originCellX+world.widthCells)%world.widthCells,yy=(cell.cellY-snapshot.region.originCellY+world.heightCells)%world.heightCells;
  if(snapshot.region.terrainCodes[yy*snapshot.region.width+xx]!==1)throw new HttpError(409,'INCOMPATIBLE_TERRAIN','Cette infrastructure nécessite un terrain praticable.');
  const footprint=snapshot.cells.find(c=>c.cellX===cell.cellX&&c.cellY===cell.cellY)?.footprint;
  if(footprint){const accesses=buildingAccesses(snapshot,footprint.buildingId);
    const pass=!blocking&&footprint.state==='active'&&accesses.some(a=>{
      const dx=wrappedDistance(p.x/8,a.position.cellX,world.widthCells),dy=wrappedDistance(p.y/8,a.position.cellY,world.heightCells);
      return Math.abs(a.normal.x?dy:dx)<a.width/2&&dx*a.normal.x+dy*a.normal.y>=0;
    });if(!pass)throw new HttpError(409,'CELL_OCCUPIED','L’emprise d’un bâtiment bloque cet emplacement.');
  }
  if(snapshot.region.features.some(f=>f.cellX===cell.cellX&&f.cellY===cell.cellY&&f.deposit?.blocksCell!==false&&!f.deposit?.cleared&&f.deposit?.state!=='depleted'))throw new HttpError(409,'CELL_OCCUPIED','Un gisement occupe cet emplacement.');
  if(snapshot.infrastructure?.equipment.some(e=>e.id!==ignoreId&&Math.abs(wrappedDistance(e.x,p.x,world.widthCells*8))<2&&Math.abs(wrappedDistance(e.y,p.y,world.heightCells*8))<2))throw new HttpError(409,'EQUIPMENT_COLLISION','Un équipement occupe cet emplacement.');
  if(blocking){
    const px=Math.floor(p.x*2),py=Math.floor(p.y*2),surface=infrastructurePlanSurface(snapshot.infrastructure??emptyInfrastructure(),world);
    if(surface.get(`${px}:${py}`)?.manual)throw new HttpError(409,'PASSAGE_BLOCKED','Placez le brasero à côté du passage.');
    const paths=[...snapshot.village.extractions.map(e=>e.path),...snapshot.cells.flatMap(c=>c.building?.garden?.plots.flatMap(plot=>plot.harvest?[plot.harvest.path,...(plot.harvest.stops?.map(s=>s.path)??[]),plot.harvest.returnPath??[]]:[])??[]),
      ...(snapshot.science?.activities.filter(a=>a.villageId===snapshot.village.id).map(a=>a.path)??[])];
    if(paths.some(path=>pathIntersectsBox(path,{cellX:p.x/8,cellY:p.y/8},.15,.15,world)))throw new HttpError(409,'ENGAGED_PASSAGE','Une équipe utilise encore ce passage.');
  }
}
function prepare(snapshot:VillageState,request:InfrastructureRequest){
  const plan=snapshot.infrastructure??emptyInfrastructure(),op=request.operation;
  if(plan.revision!==request.revision)throw new HttpError(409,'INFRASTRUCTURE_CHANGED','Les aménagements ont changé. Reprenez votre aperçu.');
  if(op.kind==='road'){
    if(op.stroke.points.some(p=>p.x>=snapshot.world.widthCells*8||p.y>=snapshot.world.heightCells*8))throw new HttpError(400,'INVALID_COORDINATES','Coordonnées non canoniques.');
    let length=0;for(let i=1;i<op.stroke.points.length;i++){
      const a=op.stroke.points[i-1]!,b=op.stroke.points[i]!,dx=wrappedDistance(b.x,a.x,snapshot.world.widthCells*8),dy=wrappedDistance(b.y,a.y,snapshot.world.heightCells*8);
      if(dx&&dy)throw new HttpError(400,'INVALID_ROAD','Un tronçon doit être orthogonal.');length+=Math.abs(dx)+Math.abs(dy);
    }if(length>512||plan.roads.length>=2048)throw new HttpError(400,'ROAD_LIMIT','Tracez une portion plus courte.');
    const prepared=prepareInfrastructureEdit(snapshot,op,request.commandId),next=prepared.next,before=infrastructurePlanSurface(plan,snapshot.world),after=infrastructurePlanSurface(next,snapshot.world);
    for(const [key,pixel]of after)if(!isDeepStrictEqual(pixel,before.get(key))&&pixel.manual){
      assertInfrastructurePosition(snapshot,{x:(pixel.x+.5)/2,y:(pixel.y+.5)/2});
    }
    return prepared;
  }
  if(op.kind==='place'||op.kind==='move')assertInfrastructurePosition(snapshot,op.position,true,op.kind==='move'?op.id:undefined);
  if((op.kind==='delete'||op.kind==='move')&&op.id.startsWith('auto:')){
    const automatic=automaticBraziers(snapshot).find(e=>e.id===op.id);
    if(!automatic||op.version!==0||op.kind==='delete'&&(!op.position||!isDeepStrictEqual(automatic.position,op.position)))throw new HttpError(409,'EQUIPMENT_CHANGED','Ce brasero automatique n’existe plus.');
  }
  if(op.kind==='lighting') {const [x,y]=op.cell.split(':').map(Number);if(!Number.isInteger(x)||!Number.isInteger(y)||op.cell!==`${x}:${y}`)throw new HttpError(400,'INVALID_CELL','Case invalide.');assertInfrastructurePosition(snapshot,{x:x!*8,y:y!*8});}
  let prepared:ReturnType<typeof prepareInfrastructureEdit>;try{prepared=prepareInfrastructureEdit(snapshot,op,request.commandId);}catch(error){throw new HttpError(409,'EQUIPMENT_CHANGED',(error as Error).message);}
  return prepared;
}
export async function infrastructurePreview(db:Kysely<Database>,accountId:string,slug:string,villageId:string,request:InfrastructureRequest):Promise<InfrastructurePreview>{
  return db.transaction().execute(async tx=>{
    const village=await ownedVillage(tx,accountId,slug,villageId),economy=await beginVillageEconomy(tx,village.worldId,villageId);
    const snapshot=await state(tx,accountId,slug,economy,false);
    try{const {quote,next}=prepare(snapshot,request);await validateTransition(tx,snapshot,snapshot.infrastructure!,next);const stone=snapshot.village.resources.find(r=>r.code==='stone')?.amount??0,wood=snapshot.village.wood;
      if(stone<quote.stoneDebit||wood<quote.woodDebit)return {valid:false,message:'Ressources insuffisantes.',quote,revision:request.revision};
      return {valid:true,message:null,quote,revision:request.revision};
    }catch(error){if(!(error instanceof HttpError))throw error;return {valid:false,message:error.message,quote:{stoneUnits:0,stoneDebit:0,woodDebit:0,reserveAfter:snapshot.infrastructure!.stoneReserve},revision:snapshot.infrastructure!.revision};}
  });
}
const samePlan=(a:InfrastructurePlan,b:InfrastructurePlan)=>isDeepStrictEqual({...a,revision:0},{...b,revision:0});
function activePaths(snapshot:VillageState){return [...snapshot.village.extractions.map(e=>e.path),...snapshot.cells.flatMap(c=>c.building?.garden?.plots.flatMap(p=>p.harvest?[p.harvest.path,p.harvest.returnPath??[],...(p.harvest.stops?.map(s=>s.path)??[])]:[])??[]),...(snapshot.science?.activities.filter(a=>a.villageId===snapshot.village.id).map(a=>a.path)??[])];}
async function worldActivePaths(tx:Transaction<Database>,worldId:string){
  // Read persisted trips without locking another village after the local one.
  const paths=await tx.selectFrom('depositExtractions').select('pathCells').where('worldId','=',worldId).where('status','=','in-progress').execute();
  const harvests=await tx.selectFrom('gardenHarvests').select(['pathCells','returnPathCells','stops']).where('worldId','=',worldId).where('status','=','in-progress').execute();
  const science=await tx.selectFrom('scienceActivities').select('pathCells').where('worldId','=',worldId).where('status','=','in-progress').execute();
  return [...paths.map(p=>p.pathCells??[]),...harvests.flatMap(p=>[p.pathCells??[],p.returnPathCells??[],...(p.stops?.map(s=>s.path)??[])]),...science.map(p=>p.pathCells)];
}
/** Nearby physical obstacles participate in routing without granting edit rights. */
export async function readNavigationInfrastructure(tx:Kysely<Database>,village:{worldId:string;villageId:string;anchorCellX:number;anchorCellY:number;widthCells:number;heightCells:number},local?:InfrastructurePlan):Promise<InfrastructurePlan>{
  const rows=await tx.selectFrom('villageInfrastructure').innerJoin('villages',join=>join.onRef('villages.id','=','villageInfrastructure.villageId').onRef('villages.worldId','=','villageInfrastructure.worldId'))
    .select(['villageInfrastructure.villageId','plan']).where('villageInfrastructure.worldId','=',village.worldId)
    .where(sql<boolean>`least(abs(anchor_cell_x-${village.anchorCellX}),${village.widthCells}-abs(anchor_cell_x-${village.anchorCellX})) <= 64`)
    .where(sql<boolean>`least(abs(anchor_cell_y-${village.anchorCellY}),${village.heightCells}-abs(anchor_cell_y-${village.anchorCellY})) <= 64`).orderBy('villageInfrastructure.villageId').execute();
  const own=local??rows.find(r=>r.villageId===village.villageId)?.plan??emptyInfrastructure(),foreign=rows.filter(r=>r.villageId!==village.villageId).map(r=>r.plan);
  return {...own,roads:[...own.roads,...foreign.flatMap(p=>p.roads)],equipment:[...own.equipment,...foreign.flatMap(p=>p.equipment)],
    manualLighting:[...own.manualLighting,...foreign.flatMap(p=>p.manualLighting)],suppressedBraziers:[...own.suppressedBraziers,...foreign.flatMap(p=>p.suppressedBraziers)]};
}
async function validateTransition(tx:Transaction<Database>,snapshot:VillageState,before:InfrastructurePlan,next:InfrastructurePlan){
  const world=snapshot.world,a=infrastructurePlanSurface(before,world),b=infrastructurePlanSurface(next,world),changed=[...b].filter(([key,p])=>!isDeepStrictEqual(p,a.get(key))&&(p.manual||a.get(key)?.manual)).map(([,p])=>p);
  const oldSidewalk=infrastructureSidewalkSurface(a,world),sidewalk=[...infrastructureSidewalkSurface(b,world)].filter(([key])=>!oldSidewalk.has(key)).map(([,p])=>({x:(p.x+.5)/2,y:(p.y+.5)/2}));
  const moved=next.equipment.filter(e=>!isDeepStrictEqual(e,before.equipment.find(old=>old.id===e.id)));
  const paths=moved.length?[...activePaths(snapshot),...await worldActivePaths(tx,world.id)]:[];
  for(const p of sidewalk)assertInfrastructurePosition(snapshot,p);
  for(const e of moved)if(paths.some(path=>pathIntersectsBox(path,{cellX:e.x/8,cellY:e.y/8},.15,.15,world)))throw new HttpError(409,'ENGAGED_PASSAGE','Une équipe utilise encore ce passage.');
  const foreign=await tx.selectFrom('villageInfrastructure').select('plan').where('worldId','=',world.id).where('villageId','!=',snapshot.village.id).execute();
  const foreignCells=await tx.selectFrom('worldCellOccupancies').innerJoin('buildings',j=>j.onRef('buildings.id','=','worldCellOccupancies.buildingId').onRef('buildings.worldId','=','worldCellOccupancies.worldId'))
    .select(['worldCellOccupancies.cellX','worldCellOccupancies.cellY']).where('worldCellOccupancies.worldId','=',world.id).where('buildings.villageId','!=',snapshot.village.id).execute();
  const cells=new Set(foreignCells.map(p=>`${p.cellX}:${p.cellY}`));
  const points=[...changed.map(p=>({x:(p.x+.5)/2,y:(p.y+.5)/2})),...sidewalk,...moved];
  for(const p of points)if(cells.has(`${Math.floor((p.x+4)/8)%world.widthCells}:${Math.floor((p.y+4)/8)%world.heightCells}`))throw new HttpError(409,'FOREIGN_INFRASTRUCTURE','Cet emplacement appartient à un autre village.');
  for(const {plan}of foreign){const occupied=infrastructurePlanSurface(plan,world),foreignSidewalk=infrastructureSidewalkSurface(occupied,world);for(const p of points)if(occupied.get(`${Math.floor(p.x*2)}:${Math.floor(p.y*2)}`)?.manual||foreignSidewalk.has(`${Math.floor(p.x*2)}:${Math.floor(p.y*2)}`)||plan.equipment.some(e=>Math.abs(wrappedDistance(e.x,p.x,world.widthCells*8))<2&&Math.abs(wrappedDistance(e.y,p.y,world.heightCells*8))<2))throw new HttpError(409,'FOREIGN_INFRASTRUCTURE','Un aménagement d’un autre village occupe cet emplacement.');}
  if(moved.length){
    const navigation=await readNavigationInfrastructure(tx,{worldId:world.id,villageId:snapshot.village.id,anchorCellX:snapshot.village.anchorCellX,anchorCellY:snapshot.village.anchorCellY,...world},next);
    const reachable=new Set(buildTravelNetwork({...snapshot,infrastructure:navigation}).filter(r=>r.kind==='building').map(r=>r.id));
    if(snapshot.travelRoutes.some(r=>r.kind==='building'&&!reachable.has(r.id)))throw new HttpError(409,'ACCESS_BLOCKED','Cet obstacle rendrait l’accès d’un bâtiment impraticable.');
  }
}
export async function infrastructureCommand(db:Kysely<Database>,accountId:string,slug:string,villageId:string,request:InfrastructureRequest):Promise<VillageState>{
  return db.transaction().execute(async tx=>{
    const village=await ownedVillage(tx,accountId,slug,villageId),economy=await beginVillageEconomy(tx,village.worldId,villageId,undefined,[],[],true);
    await sql`select pg_advisory_xact_lock(hashtextextended(${`infrastructure:${village.worldId}`},0))`.execute(tx);
    const receipt=await tx.selectFrom('infrastructureReceipts').select('request').where('worldId','=',village.worldId).where('villageId','=',villageId).where('commandId','=',request.commandId).executeTakeFirst();
    if(receipt){if(!isDeepStrictEqual(receipt.request,request))throw new HttpError(409,'COMMAND_REUSED','Identifiant de commande déjà utilisé.');return state(tx,accountId,slug,economy);}
    const snapshot=await state(tx,accountId,slug,economy,false),before=snapshot.infrastructure!;
    let next:InfrastructurePlan,quote:InfrastructureQuote;
    if(request.operation.kind==='undo'){
      const prior=await tx.selectFrom('infrastructureReceipts').selectAll().where('worldId','=',village.worldId).where('villageId','=',villageId).where('commandId','=',request.operation.target).where('sessionId','=',request.sessionId).executeTakeFirst();
      if(!prior||prior.undone||request.revision!==before.revision||!samePlan(before,prior.afterPlan))throw new HttpError(409,'UNDO_UNAVAILABLE','La dernière portion ne peut plus être annulée.');
      next=structuredClone(prior.beforePlan);quote=prior.quote;
      await validateTransition(tx,snapshot,before,next);
      // Validate restored obstacles against the current world, rather than restoring a world snapshot.
      for(const e of next.equipment)assertInfrastructurePosition({...snapshot,infrastructure:{...next,equipment:[]}},e,true);
      if(quote.stoneDebit||quote.woodDebit)for(const [code,amount]of [['stone',quote.stoneDebit],['wood',quote.woodDebit]] as const)
        await tx.updateTable('villageResources').set({amount:sql`amount + ${amount}::bigint`}).where('worldId','=',village.worldId).where('villageId','=',villageId).where('resourceCode','=',code).execute();
      await tx.updateTable('infrastructureReceipts').set({undone:true}).where('worldId','=',village.worldId).where('villageId','=',villageId).where('commandId','=',prior.commandId).execute();
    }else{
      ({next,quote}=prepare(snapshot,request));
      await validateTransition(tx,snapshot,before,next);
      if(!request.expected||!isDeepStrictEqual(request.expected,quote))throw new HttpError(409,'QUOTE_CHANGED','Le devis a changé. Aucun aménagement lancé.');
      if(samePlan(before,next)){
        await tx.insertInto('infrastructureReceipts').values({worldId:village.worldId,villageId,commandId:request.commandId,sessionId:request.sessionId,request:JSON.stringify(request),beforePlan:JSON.stringify(before),afterPlan:JSON.stringify(before),quote:JSON.stringify(quote)}).execute();
        return state(tx,accountId,slug,economy);
      }
      await debit(tx,village.worldId,villageId,[{resourceCode:'stone',amount:quote.stoneDebit},{resourceCode:'wood',amount:quote.woodDebit}],economy.through);
      next.stoneReserve=quote.reserveAfter;
    }
    next.revision=before.revision+1;
    await tx.insertInto('villageInfrastructure').values({worldId:village.worldId,villageId,plan:JSON.stringify(next)}).onConflict(c=>c.columns(['worldId','villageId']).doUpdateSet({plan:JSON.stringify(next)})).execute();
    await tx.insertInto('infrastructureReceipts').values({worldId:village.worldId,villageId,commandId:request.commandId,sessionId:request.sessionId,
      request:JSON.stringify(request),beforePlan:JSON.stringify(before),afterPlan:JSON.stringify(next),quote:JSON.stringify(quote)}).execute();
    return state(tx,accountId,slug,economy);
  });
}
export async function assertNoInfrastructure(tx:Transaction<Database>,worldId:string,cells:readonly {cellX:number;cellY:number}[],world:{widthCells:number;heightCells:number}){
  await sql`select pg_advisory_xact_lock(hashtextextended(${`infrastructure:${worldId}`},0))`.execute(tx);
  const wanted=new Set(cells.map(c=>`${c.cellX}:${c.cellY}`));
  // Neighbor-owned plans remain protected even where historical perimeters overlap.
  const plans=await tx.selectFrom('villageInfrastructure').select('plan').where('worldId','=',worldId).execute();
  for(const {plan}of plans){if(plan.equipment.some(e=>wanted.has(subCellKey(e,world))))throw new HttpError(409,'INFRASTRUCTURE_OCCUPIED','Déplacez l’équipement avant de construire.');
    const surface=infrastructurePlanSurface(plan,world),sidewalk=infrastructureSidewalkSurface(surface,world);
    if([...surface.values()].some(p=>p.manual&&wanted.has(`${Math.floor((p.x+8)/16)%world.widthCells}:${Math.floor((p.y+8)/16)%world.heightCells}`))||[...sidewalk.values()].some(p=>wanted.has(`${Math.floor((p.x+8)/16)%world.widthCells}:${Math.floor((p.y+8)/16)%world.heightCells}`)))throw new HttpError(409,'INFRASTRUCTURE_OCCUPIED','Déplacez ou retirez la voie ou le trottoir avant de construire.');}
  const all=await worldActivePaths(tx,worldId);
  if(all.some(path=>cells.some(c=>pathIntersectsBox(path,c,.499,.499,world))))throw new HttpError(409,'ENGAGED_PASSAGE','Une équipe utilise encore cette emprise.');
}

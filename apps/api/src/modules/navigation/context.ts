import {sql,type Kysely} from 'kysely';
import {buildingAccesses,type BuildingAccessState,type InfrastructurePlan,type GeneratedLandscape,type SpawnTerrace} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import {HttpError} from '../../errors.js';
import {RC1_CANONICAL_CHECKSUM} from '../onboarding/spawn-compute-protocol.js';
import {navigationVersions} from './route-cache.js';
export interface NavigationData {
 worldId:string;contextId:string;traversalConstraintsId:string;width:number;height:number;
 artifact?:string|undefined;sourceId:string;terraces:SpawnTerrace[];treeEdits:Array<{cellX:number;cellY:number;initialAmount:number;variantSeed:number;removed:number[];grove:boolean}>;
 legacy?:{chunkSize:number;chunks:Array<{chunkX:number;chunkY:number;terrainCodes:number[];elevations:number[]}>}|undefined;
 occupancies:Array<{cellX:number;cellY:number;buildingId:string|null}>;
 accesses:Array<{id:string;buildingId:string;path:Array<{cellX:number;cellY:number}>}>;
 plans:InfrastructurePlan[];
}
export async function navigationRevision(db:Kysely<Database>,worldId:string):Promise<string>{
 const r=await sql<{n:string}>`select count(*)::text n from village_sync_changes where world_id=${worldId} and navigation_changed`.execute(db);
 return r.rows[0]!.n;
}
export async function loadNavigationContext(db:Kysely<Database>,worldId:string,knownSources:ReadonlySet<string>,knownContexts:ReadonlySet<string>,persistent=false){
 return db.transaction().setIsolationLevel('repeatable read').execute(async tx=>{
  await sql`set transaction read only`.execute(tx);
  await sql`set local statement_timeout='5s'`.execute(tx);
  await sql`set local transaction_timeout='6s'`.execute(tx);
  const world=await tx.selectFrom('worlds').select(['generationVersion','generationStatus','widthCells','heightCells','chunkSize','seed']).where('id','=',worldId).executeTakeFirstOrThrow();
  if(world.generationStatus!=='ready')throw new HttpError(409,'WORLD_NOT_READY','Terrain indisponible.');
  const revision=await navigationRevision(tx,worldId);
  const manifest=persistent?await navigationVersions(tx,worldId):undefined;
  const identity=world.generationVersion===3?await tx.selectFrom('worldGenerationCandidates').select(['checksum',sql<string>`xmin::text || ':' || ctid::text`.as('version')]).where('worldId','=',worldId).executeTakeFirst():null;
  if(world.generationVersion===3&&(!identity||identity.checksum!==RC1_CANONICAL_CHECKSUM||world.widthCells!==512||world.heightCells!==256))throw new HttpError(409,'WORLD_NOT_READY','Géographie RC1 incohérente.');
  const sourceId=identity?identity.checksum+':'+world.seed+':'+identity.version:'legacy:'+worldId+':'+revision;
  const contextId=worldId+':'+revision+':'+(identity?.version??'legacy');
  if(knownContexts.has(contextId))return{contextId,revision,sourceId,manifest,data:undefined};
  const occupancies=await tx.selectFrom('worldCellOccupancies').select(['cellX','cellY','buildingId','role']).where('worldId','=',worldId).where('buildingId','is not',null).execute();
  const buildings=await tx.selectFrom('buildings').select(['id','buildingType','visualLayout','quarterTurns']).where('worldId','=',worldId).execute();
  const byId=new Map(buildings.map(b=>[b.id,b]));
  const state={world,cells:occupancies.map(c=>{const b=c.buildingId?byId.get(c.buildingId):null;return{...c,footprint:{buildingId:c.buildingId!},building:b&&c.role==='anchor'?{id:b.id,type:b.buildingType,visualLayout:b.visualLayout,quarterTurns:b.visualLayout?.quarterTurns??b.quarterTurns}:null};})} as BuildingAccessState;
  // Only one anchor per building, while every footprint remains available.
  const emitted=new Set<string>();for(const c of state.cells)if(c.building){if(emitted.has(c.building.id))c.building=null;else emitted.add(c.building.id);}
  const plans=(await tx.selectFrom('villageInfrastructure').select('plan').where('worldId','=',worldId).execute()).map(r=>r.plan);
  const accesses=buildings.flatMap(b=>buildingAccesses(state,b.id).map(a=>({id:b.id+':'+a.id,buildingId:b.id,path:[a.position,a.outside]})));
  // Site reservations block new commercial routes until the terrain change commits.
 const sites=await tx.selectFrom('worldCellOccupancies as o').innerJoin('worldFeatures as f',j=>j.onRef('f.worldId','=','o.worldId').onRef('f.id','=','o.featureId'))
  .select(['o.cellX','o.cellY','o.featureId']).where('o.worldId','=',worldId).where('f.featureTypeCode','=','leveling-site').execute();
 occupancies.push(...sites.map(c=>({cellX:c.cellX,cellY:c.cellY,buildingId:c.featureId,role:'body' as const})));
 const terraces=await tx.selectFrom('worldSpawnTerraces').select(['cellX','cellY','height']).where('worldId','=',worldId).execute();
  let artifact:string|undefined;
  let treeEdits:NavigationData['treeEdits']=[];
  let legacy:NavigationData['legacy'];
  if(identity){
   if(!knownSources.has(sourceId)){const row=await tx.selectFrom('worldGenerationCandidates').select(sql<string>`artifact::text`.as('artifact')).where('worldId','=',worldId).executeTakeFirstOrThrow();artifact=row.artifact;}
   // Compact overlays are expanded into canonical tree positions in the CPU worker.
   const edits=await tx.selectFrom('worldRc1Resources').leftJoinLateral(eb=>eb.selectFrom('woodlandDeposits').select(['cleared','initialAmount','cellX','cellY']).whereRef('woodlandDeposits.worldId','=','worldRc1Resources.worldId').whereRef('woodlandDeposits.featureId','=','worldRc1Resources.featureId').limit(1).as('woodlandDeposits'),j=>j.onTrue())
    .leftJoinLateral(eb=>eb.selectFrom('worldFeatures').select('variantSeed').whereRef('worldFeatures.worldId','=','worldRc1Resources.worldId').whereRef('worldFeatures.id','=','worldRc1Resources.featureId').limit(1).as('worldFeatures'),j=>j.onTrue())
    .select(['treeIndices','removedIndices','cleared','initialAmount','woodlandDeposits.cellX','woodlandDeposits.cellY','variantSeed']).where('worldRc1Resources.worldId','=',worldId).execute();
   treeEdits=edits.map(r=>({cellX:r.cellX??0,cellY:r.cellY??0,initialAmount:Number(r.initialAmount??0),variantSeed:r.variantSeed??3,removed:r.cleared?r.treeIndices:r.removedIndices,grove:!r.treeIndices.length&&!r.cleared}));
  }else legacy={chunkSize:world.chunkSize,chunks:await tx.selectFrom('worldChunks').select(['chunkX','chunkY','terrainCodes','elevations']).where('worldId','=',worldId).execute()};
  return{contextId,revision,sourceId,manifest,data:{worldId,contextId,sourceId,traversalConstraintsId:'none',width:world.widthCells,height:world.heightCells,artifact,legacy,terraces,treeEdits,occupancies,accesses,plans} satisfies NavigationData};
 });
}
export type NavigationArtifact=GeneratedLandscape;

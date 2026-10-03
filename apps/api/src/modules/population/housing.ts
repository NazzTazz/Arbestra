import type {Selectable,Transaction} from 'kysely';
import type {Database,PopulationCohortsTable} from '../../database/schema.js';
export const housingCapacity=(buildingType:string,level:number)=>buildingType==='town-hall'?30:buildingType==='dwelling'?(level>=2?25:5):0;
type Cohort=Selectable<PopulationCohortsTable>;

/** Caller owns the village lock; energy has already been materialized at H. */
export async function allocateRestHousing(tx:Transaction<Database>,worldId:string,villageId:string,cohorts:Cohort[]):Promise<Cohort[]>{
  const homes=await tx.selectFrom('buildings').select(['id','buildingType','level']).where('worldId','=',worldId)
    .where('villageId','=',villageId).where('status','=','completed').where('buildingType','in',['dwelling','town-hall']).orderBy('id').execute();
  homes.sort((a,b)=>(a.buildingType==='town-hall'?1:0)-(b.buildingType==='town-hall'?1:0)||a.id.localeCompare(b.id));
  const free=new Map(homes.map(h=>[h.id,housingCapacity(h.buildingType,h.level)]));
  const resting=cohorts.filter(c=>c.activity==='resting'&&c.harvestId===null&&c.extractionId===null&&!c.scienceActivityId)
    .sort((a,b)=>(a.restingSince?.getTime()??0)-(b.restingSince?.getTime()??0)||a.id.localeCompare(b.id));
  const plans=new Map<string,Array<{buildingId:string|null;memberCount:number}>>();
  // Existing placements remain stable. Only overflow and unassigned members move.
  for(const c of resting){const take=Math.min(c.memberCount,free.get(c.restBuildingId??'')??0);
    plans.set(c.id,take?[{buildingId:c.restBuildingId,memberCount:take}]:[]);
    if(take)free.set(c.restBuildingId!,free.get(c.restBuildingId!)!-take);
  }
  for(const c of resting){const parts=plans.get(c.id)!;let remaining=c.memberCount-parts.reduce((n,p)=>n+p.memberCount,0);
    for(const h of homes){if(!remaining)break;const count=Math.min(remaining,free.get(h.id)!);if(!count)continue;
      const existing=parts.find(p=>p.buildingId===h.id);if(existing)existing.memberCount+=count;else parts.push({buildingId:h.id,memberCount:count});
      free.set(h.id,free.get(h.id)!-count);remaining-=count;}
    if(remaining)parts.push({buildingId:null,memberCount:remaining});
  }
  const result:Cohort[]=[];
  for(const c of cohorts){const parts=plans.get(c.id);if(!parts){result.push(c);continue;}
    const first=parts[0]!;
    if(first.memberCount!==c.memberCount||first.buildingId!==c.restBuildingId)
      await tx.updateTable('populationCohorts').set({memberCount:first.memberCount,restBuildingId:first.buildingId}).where('worldId','=',worldId).where('villageId','=',villageId).where('id','=',c.id).execute();
    result.push({...c,memberCount:first.memberCount,restBuildingId:first.buildingId});
    for(const p of parts.slice(1)){
      const {id: _id,...values}=c;void _id;
      result.push(await tx.insertInto('populationCohorts').values({...values,memberCount:p.memberCount,restBuildingId:p.buildingId}).returningAll().executeTakeFirstOrThrow());
    }
  }
  return result;
}

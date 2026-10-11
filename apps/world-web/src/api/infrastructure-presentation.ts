import {applyInfrastructureConfirmation,emptyInfrastructure,type InfrastructureConfirmation,type InfrastructurePlan,type VillageState} from '@arbestra/contracts';

export interface InfrastructurePresentation {worldId:string;villageId:string;plan:InfrastructurePlan}
/** A confirmed component remains visible while the canonical village catches up. */
export function currentInfrastructurePresentation(state:VillageState,presentation:InfrastructurePresentation|null):InfrastructurePresentation|null{
 if(!presentation||presentation.worldId!==state.world.id||presentation.villageId!==state.village.id
  ||(state.infrastructure?.revision??0)>=presentation.plan.revision)return null;
 return presentation;
}
export function acceptInfrastructurePresentation(state:VillageState,presentation:InfrastructurePresentation|null,confirmation:InfrastructureConfirmation,
 requestGeneration:number|undefined,currentGeneration:number):{kind:'applied';presentation:InfrastructurePresentation}|{kind:'ignored'|'resync'}{
 if(requestGeneration!==undefined&&requestGeneration!==currentGeneration||confirmation.worldId!==state.world.id||confirmation.villageId!==state.village.id)return {kind:'ignored'};
 const prior=currentInfrastructurePresentation(state,presentation),result=applyInfrastructureConfirmation(prior?.plan??state.infrastructure??emptyInfrastructure(),confirmation);
 return result.kind==='applied'?{kind:'applied',presentation:{worldId:state.world.id,villageId:state.village.id,plan:result.plan}}:result;
}
export function infrastructurePresentationState(state:VillageState,presentation:InfrastructurePresentation|null):VillageState{
 const current=currentInfrastructurePresentation(state,presentation);
 return current?{...state,infrastructure:current.plan}:state;
}

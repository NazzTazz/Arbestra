import type {VillageState} from '@arbestra/contracts';

export const HUD_RESOURCES = [
  {code:'wood',label:'bois bruts',title:'Bois brut · retour de coupe',icon:'wood'},
  {code:'timber',label:'bois d’œuvre',title:'Bois d’œuvre · fabrication à la scierie',icon:'timber'},
  {code:'carrot',label:'carottes',title:'Carottes · retour de récolte',icon:'carrot'},
  {code:'stone',label:'pierres brutes',title:'Pierre brute · retour d’extraction',icon:'stone'},
  {code:'cut-stone',label:'pierres taillées',title:'Pierre taillée · fabrication au tailleur',icon:'cut-stone'},
] as const;

export type HudResourceCode = typeof HUD_RESOURCES[number]['code'];
type ResourceState = {
  world: Pick<VillageState['world'],'id'>;
  village: Pick<VillageState['village'],'id'|'wood'|'carrots'> & {resources:readonly {code:string;amount:number}[]};
};
export interface ResourceChange {resourceCode:HudResourceCode;amount:number}
export interface ResourceFeedback extends ResourceChange {id:number;lane:number;context:string}

/** Keep bursts readable without losing amounts or replaying an old label's animation. */
export function appendResourceFeedback(current:ResourceFeedback[],additions:Omit<ResourceFeedback,'lane'>[],context:string):ResourceFeedback[] {
  const retained=current.filter(item=>item.context===context);
  for(const addition of additions){
    const siblings=retained.filter(item=>item.resourceCode===addition.resourceCode);
    const oldest=siblings.length>=3?siblings[0]:undefined;
    if(oldest)retained.splice(retained.indexOf(oldest),1);
    const amount=addition.amount+(oldest?.amount??0);
    if(amount)retained.push({...addition,amount,lane:((siblings.at(-1)?.lane??-1)+1)%3});
  }
  return additions.length||retained.length!==current.length?retained:current;
}

/** Match the five visible counters, including the historical wood/carrot aliases. */
export function hudResourceAmounts(village:ResourceState['village']):Record<HudResourceCode,number> {
  return {
    wood:Math.floor(village.wood),
    carrot:Math.floor(village.carrots),
    timber:Math.floor(village.resources.find(r=>r.code==='timber')?.amount??0),
    stone:Math.floor(village.resources.find(r=>r.code==='stone')?.amount??0),
    'cut-stone':Math.floor(village.resources.find(r=>r.code==='cut-stone')?.amount??0),
  };
}

/** Presentation only, called after snapshot/frame acceptance, never from a quote. */
export function resourceChanges(previous:ResourceState|null,next:ResourceState):ResourceChange[] {
  if(!previous||previous.world.id!==next.world.id||previous.village.id!==next.village.id)return [];
  const before=hudResourceAmounts(previous.village),after=hudResourceAmounts(next.village);
  return HUD_RESOURCES.flatMap(({code})=>{
    const amount=after[code]-before[code];
    return amount?[{resourceCode:code,amount}]:[];
  });
}

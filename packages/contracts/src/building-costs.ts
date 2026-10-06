import type { BuildingTypeDefinition } from './villages.js';

/** Presentation uses server-provided prices; admission recomputes them on the server. */
export function constructionCosts(level:BuildingTypeDefinition['levels'][number]|undefined,variant:'stone'|'logs'|'beams'='stone') {
  const amounts=new Map((level?.costs??[]).map(c=>[c.resourceCode,c.amount]));
  for(const cost of level?.variantCosts??[])if(cost.variant===variant){
    if(cost.replacesResourceCode)amounts.delete(cost.replacesResourceCode);
    amounts.set(cost.resourceCode,(amounts.get(cost.resourceCode)??0)+cost.amount);
  }
  return [...amounts].map(([resourceCode,amount])=>({resourceCode,amount}));
}

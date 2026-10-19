import {describe,expect,it} from 'vitest';
import {appendResourceFeedback,hudResourceAmounts,resourceChanges,type ResourceFeedback} from './resource-feedback';

const snapshot=()=>({world:{id:'world'},village:{id:'village',wood:1000,carrots:500,resources:[
  {code:'wood',amount:1000},{code:'carrot',amount:500},{code:'timber',amount:100},{code:'stone',amount:200},{code:'cut-stone',amount:50},
]}});

describe('confirmed HUD resource movements',()=>{
  it('shows the wood actually delivered, without counting the wood/carrot aliases twice',()=>{
    const before=snapshot(),after=snapshot();after.village.wood+=652;after.village.resources[0]!.amount+=652;
    expect(resourceChanges(before,after)).toEqual([{resourceCode:'wood',amount:652}]);
  });
  it('shows the two separate debits for a stone house',()=>{
    const before=snapshot(),after=snapshot();after.village.resources[2]!.amount-=25;after.village.resources[4]!.amount-=10;
    expect(resourceChanges(before,after)).toEqual([{resourceCode:'timber',amount:-25},{resourceCode:'cut-stone',amount:-10}]);
  });
  it('covers harvesting, processing, spending and refunds for all five counters',()=>{
    const before=snapshot(),after=snapshot();after.village.wood-=25;after.village.carrots+=80;
    after.village.resources[2]!.amount+=20;after.village.resources[3]!.amount-=25;after.village.resources[4]!.amount+=20;
    expect(resourceChanges(before,after)).toEqual([
      {resourceCode:'wood',amount:-25},{resourceCode:'timber',amount:20},{resourceCode:'carrot',amount:80},
      {resourceCode:'stone',amount:-25},{resourceCode:'cut-stone',amount:20},
    ]);
  });
  it('does not animate the initial stock, a new context, or a repeated projection',()=>{
    const before=snapshot(),after=snapshot();
    expect(resourceChanges(null,after)).toEqual([]);expect(resourceChanges(before,after)).toEqual([]);
    after.village.wood+=652;after.world.id='other';expect(resourceChanges(before,after)).toEqual([]);
    after.world.id='world';after.village.id='other';expect(resourceChanges(before,after)).toEqual([]);
  });
  it('uses displayed whole units and treats a missing resource counter as zero',()=>{
    const before=snapshot(),after=snapshot();before.village.wood=1000.2;after.village.wood=1000.9;
    expect(resourceChanges(before,after)).toEqual([]);
    after.village.resources=[];
    expect(hudResourceAmounts(after.village)).toEqual({wood:1000,carrot:500,timber:0,stone:0,'cut-stone':0});
  });
  it('keeps the entire amount of rapid deliveries in three readable labels, without mutating inputs',()=>{
    const additions=Array.from({length:5},(_,id)=>({id,context:'world:village',resourceCode:'wood' as const,amount:10}));
    const before=structuredClone(additions);
    const result=appendResourceFeedback([],additions,'world:village');
    expect(result).toHaveLength(3);expect(result.reduce((sum,item)=>sum+item.amount,0)).toBe(50);
    expect(additions).toEqual(before);expect(appendResourceFeedback([],additions,'world:village')).toEqual(result);
  });
  it('clears feedback from another village and leaves unchanged projections alone',()=>{
    const items:ResourceFeedback[]=[{id:0,context:'world:village',resourceCode:'wood',amount:652,lane:0}];
    expect(appendResourceFeedback(items,[],'world:village')).toBe(items);
    expect(appendResourceFeedback(items,[],'world:other')).toEqual([]);
  });
});

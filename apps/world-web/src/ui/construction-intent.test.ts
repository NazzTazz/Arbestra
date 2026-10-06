import { expect, it } from 'vitest';
import { constructionContext, sameUpgradeQuote, upgradePreview, type UpgradePreview } from './construction-intent';
import type { VillageState } from '@arbestra/contracts';

const quote: UpgradePreview = { siteId: 'cell', buildingId: 'house', code: 'dwelling', name: 'Maison',
  level: 1, nextLevel: 2, costs: [{ resourceCode: 'wood', amount: 80 }], durationSeconds: 60, error: null };
it('quotes the existing log house upgrade against raw wood even with no timber',()=>{
  const state={cells:[{id:'cell',building:{id:'house',type:'dwelling',level:1,status:'completed',visualLayout:{recipe:'log-house'}}}],
    village:{wood:300,resources:[{code:'timber',amount:0}]},buildingTypes:[{code:'dwelling',displayName:'Maison',levels:[{
      level:2,constructionDurationSeconds:120,costs:[{resourceCode:'timber',amount:300}],
      variantCosts:[{variant:'logs',resourceCode:'wood',amount:300,replacesResourceCode:'timber'}],
    }]}]} as unknown as VillageState;
  expect(upgradePreview(state,'cell')).toMatchObject({costs:[{resourceCode:'wood',amount:300}],error:null});
  state.village.wood=299;
  expect(upgradePreview(state,'cell')?.error).toBe('Ressources insuffisantes.');
});
it('requires the displayed target, level and costs before upgrading', () => {
  expect(sameUpgradeQuote(null, quote)).toBe(false);
  expect(sameUpgradeQuote(quote, { ...quote, buildingId: 'other-house' })).toBe(false);
  expect(sameUpgradeQuote(quote, { ...quote, nextLevel: 3 })).toBe(false);
  expect(sameUpgradeQuote(quote, { ...quote, costs: [{ resourceCode: 'wood', amount: 90 }] })).toBe(false);
  expect(sameUpgradeQuote(quote, { ...quote, error: 'En travaux' })).toBe(false);
  expect(sameUpgradeQuote(quote, structuredClone(quote))).toBe(true);
});

it('derives upgrade from the same recipe on an existing footprint, never a different recipe', () => {
  const state = { cells: [
    { id:'a', cellX:0, cellY:0, building:{id:'house',type:'dwelling'} },
    { id:'b', cellX:1, cellY:0, footprint:{buildingId:'house'} },
  ] } as unknown as VillageState;
  const cell={cellX:1,cellY:0};
  expect(constructionContext(state,'dwelling',cell,cell)).toEqual({action:'upgrade',buildingId:'house',siteId:'a'});
  expect(constructionContext(state,'sawmill',cell,cell)).toEqual({action:'build'});
  expect(constructionContext(state,'dwelling',cell,{cellX:2,cellY:0})).toEqual({action:'build'});
});

it('extends the garden where the gesture starts, not a neighbouring garden or a remembered target', () => {
  const state = { cells: [
    { id:'a', cellX:0, cellY:0, building:{id:'garden-a',type:'garden'} },
    { id:'b', cellX:1, cellY:0, footprint:{buildingId:'garden-a'} },
    { id:'c', cellX:3, cellY:0, building:{id:'garden-b',type:'garden'} },
  ] } as unknown as VillageState;
  const free={cellX:2,cellY:0};
  expect(constructionContext(state,'garden',{cellX:1,cellY:0},free)).toMatchObject({action:'extend',buildingId:'garden-a'});
  expect(constructionContext(state,'garden',{cellX:3,cellY:0},free)).toMatchObject({action:'extend',buildingId:'garden-b'});
  expect(constructionContext(state,'garden',free,free)).toEqual({action:'build'});
});

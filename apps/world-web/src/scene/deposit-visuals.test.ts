import { expect, it } from 'vitest';
import type { VillageState } from '@arbestra/contracts';
import { changedStoneFeatures, extractionTravel, stoneVisualSignature, terrainSignature, type WorldFeature } from './deposit-visuals';

function feature(id: string): WorldFeature {
  return { id, type:'stone_outcrop',cellX:1,cellY:2,variantSeed:42,deposit:{featureId:id,resourceCode:'stone',cellX:1,cellY:2,
    initialAmount:1000,remainingAmount:1000,reservedAmount:0,availableAmount:1000,state:'available',revision:1,updatedAt:'2026-09-05T00:00:00Z'} };
}
it('J: one depleted feature changes one group and leaves terrain and other groups intact',()=>{
  const a=feature('a'),b=feature('b');
  const state={world:{id:'world',generationVersion:2},village:{anchorCellX:0,anchorCellY:0},region:{originCellX:0,originCellY:0,features:[a,b]}} as unknown as VillageState;
  const origin=terrainSignature(state),previous=new Map([a,b].map(row=>[row.id,stoneVisualSignature(row,origin)]));
  const depleted:WorldFeature={...a,deposit:{...a.deposit!,state:'depleted',revision:2,remainingAmount:0,availableAmount:0}};
  const next={...state,region:{...state.region,features:[depleted,b]}};
  expect(terrainSignature(next)).toBe(origin);
  expect(changedStoneFeatures(previous,next.region.features,origin)).toEqual({removed:[],changed:[depleted]});
  const acknowledged=new Map(previous);acknowledged.set(a.id,stoneVisualSignature(depleted,origin));
  expect(changedStoneFeatures(acknowledged,next.region.features,origin)).toEqual({removed:[],changed:[]});
  expect(changedStoneFeatures(acknowledged,[b],origin)).toEqual({removed:['a'],changed:[]});
});
it('reconnect reconstructs the current trip phase without triggering an economic operation',()=>{
  expect([0,125,250,500,750,875,1000,2000].map(now=>extractionTravel(now,0,1000))).toEqual([0,0.5,1,1,1,0.5,0,0]);
});

import {expect,it} from 'vitest';
import {selectEquipment} from './equipment-selection';

it('selects the brazier mesh actually clicked even when its ground projection is near another object',()=>{
  const clicked={id:'clicked',version:2,position:{x:80,y:80},quarterTurns:1};
  const other={id:'other',version:1,position:{x:85,y:80},quarterTurns:0};
  expect(selectEquipment([other,clicked],{x:85,y:80},{widthCells:64,heightCells:64},'clicked')).toBe(clicked);
  expect(selectEquipment([other],{x:85,y:80},{widthCells:64,heightCells:64},'stale')).toBeNull();
});

it('keeps ground selection toroidal when no mesh was hit',()=>{
  const item={id:'auto:corner',version:0,position:{x:511,y:80},quarterTurns:0};
  expect(selectEquipment([item],{x:0,y:80},{widthCells:64,heightCells:64})).toBe(item);
});

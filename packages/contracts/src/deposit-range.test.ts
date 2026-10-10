import {describe,it,expect} from 'vitest';
import {withinDepositRange} from './deposit-range.js';
describe('shared exploitation reach',()=>{
 for(const cell of [{cellX:140,cellY:20},{cellX:511,cellY:255},{cellX:0,cellY:0}])for(const [dx,dy] of [[16,0],[0,16],[16,16],[-16,-16],[17,0],[0,17]])it(JSON.stringify({cell,dx,dy}),()=>{
  expect(withinDepositRange([cell],{cellX:(cell.cellX+dx!+512)%512,cellY:(cell.cellY+dy!+256)%256},{widthCells:512,heightCells:256})).toBe(Math.max(Math.abs(dx!),Math.abs(dy!))<=16);
 });
});

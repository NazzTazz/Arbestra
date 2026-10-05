import {describe,expect,it} from 'vitest';
import {emptyInfrastructure,applyInfrastructure,infrastructureQuote,infrastructureSurface,infrastructureBorders,type RoadStroke} from './infrastructure.js';
const world={widthCells:64,heightCells:64};
const stroke=(x0:number,x1:number,border=false):RoadStroke=>({id:'r',points:[{x:x0,y:80},{x:x1,y:80}],width:4,material:'stone-1',border,operation:'paint'});
describe('infrastructure geometry and payment',()=>{
  it('quotes a half-cell-wide road and its two sides exactly',()=>{
    const a=emptyInfrastructure(),b=applyInfrastructure(a,{kind:'road',stroke:stroke(80,88,true)},'one');
    expect(infrastructureQuote(a,b,world)).toEqual({stoneUnits:1024,stoneDebit:4,woodDebit:0,reserveAfter:0});
    expect(infrastructureBorders(infrastructureSurface(b.roads,world),world).size).toBe(32);
  });
  it('does not pay twice for unchanged surfaces or split strokes',()=>{
    const a=emptyInfrastructure();let b=a,total=0;
    for(let i=0;i<8;i++){const c=applyInfrastructure(b,{kind:'road',stroke:stroke(80+i,81+i)},String(i));const q=infrastructureQuote(b,c,world);total+=q.stoneDebit;c.stoneReserve=q.reserveAfter;b=c;}
    expect(total).toBe(2);expect(b.stoneReserve).toBe(0);
    expect(infrastructureQuote(b,applyInfrastructure(b,{kind:'road',stroke:stroke(80,88)},'again'),world).stoneUnits).toBe(0);
  });
  it('preserves lighting control after removal of the last manual equipment',()=>{
    let p=applyInfrastructure(emptyInfrastructure(),{kind:'place',position:{x:80,y:80},quarterTurns:0},'b');
    p=applyInfrastructure(p,{kind:'delete',id:'b',version:1},'d');expect(p.manualLighting).toEqual(['10:10']);
    p=applyInfrastructure(p,{kind:'lighting',cell:'10:10'},'l');expect(p.manualLighting).toEqual([]);
  });
  it('crosses the seam locally instead of rasterizing the whole world',()=>{
    const s=stroke(511,1);expect(infrastructureSurface([s],world).size).toBe(32);
  });
});

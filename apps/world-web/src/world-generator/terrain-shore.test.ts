import {expect,it} from 'vitest';
import {refineShoreTriangle} from './terrain-shore';
const sample=(x:number,y:number)=>({x,y,z:x-.37,surface:0});
it('refines a shared shore edge identically in reverse order without T junctions',()=>{
 const a=sample(0,0),b=sample(1,0),c=sample(1,1),d=sample(0,-1);
 const first=refineShoreTriangle([a,b,c],sample),second=refineShoreTriangle([b,a,d],sample);
 const edge=(triangles:typeof first)=>[...new Set(triangles.flat().filter(v=>v.y===0).map(v=>v.x))].sort();
 expect(edge(first)).toHaveLength(3);expect(edge(first)[1]).toBeCloseTo(.37,4);expect(edge(second)).toEqual(edge(first));
 for(const triangle of [...first,...second]){const [a,b,c]=triangle;expect((b!.x-a!.x)*(c!.y-a!.y)-(b!.y-a!.y)*(c!.x-a!.x)).toBeGreaterThan(0);}
});
it('preserves area and winding for all edge refinement patterns, leaving inland triangles intact',()=>{
 for(const heights of [[1,1,1],[-1,1,1],[.01,1,1],[.01,.01,1],[.01,.01,.01]]){
  const vertices=[[0,0],[1,0],[0,1]].map(([x,y],i)=>({x:x!,y:y!,z:heights[i]!,surface:0}));
  const triangles=refineShoreTriangle(vertices,sample);
  const area=triangles.reduce((sum,[a,b,c])=>{const area=((b!.x-a!.x)*(c!.y-a!.y)-(b!.y-a!.y)*(c!.x-a!.x))/2;expect(area).toBeGreaterThan(0);return sum+area;},0);
  expect(area).toBe(.5);if(heights.every(z=>z===1))expect(triangles).toEqual([vertices]);
 }
});

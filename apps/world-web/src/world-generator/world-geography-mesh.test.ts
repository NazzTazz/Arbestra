import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { describe,expect,it } from 'vitest';
import { generateGeographicLandscape } from '@arbestra/contracts/world-geography';
import { DEFAULT_GENERATOR_PARAMETERS } from '@arbestra/contracts';
import { buildWorldGeometry, createRenderedGroundSampler } from './world-geography-mesh';
const point=(x:number,y:number,z:number)=>[x,z/4,y];
describe('world geography mesh',()=>{
 it('has matching detailed chunk borders independent of build order and torus wrapping',()=>{
  const d=generateGeographicLandscape(42,64,64,DEFAULT_GENERATOR_PARAMETERS);
  const build=(x:number)=>buildWorldGeometry(d,true,{x,y:0},'terrain',point);
  const a=build(0),b=build(32),c=build(64);
  const edge=(positions:number[],x:number,offset=0)=>{const values=new Set<string>();for(let i=0;i<positions.length;i+=3)if(Math.abs(positions[i]!-x)<1e-8)values.add([positions[i]!-offset,positions[i+1],positions[i+2]].map(v=>v!.toFixed(6)).join(':'));return [...values].sort();};
  expect(edge(a.positions,32)).toEqual(edge(b.positions,32));expect(edge(a.waterPositions,32)).toEqual(edge(b.waterPositions,32));
  expect(edge(a.positions,0)).toEqual(edge(c.positions,64,64));expect(build(0)).toEqual(a);
 });
 it('keeps geometry invariant across diagnostic layers and finite at every vertex',()=>{
  const d=generateGeographicLandscape(42,64,64,DEFAULT_GENERATOR_PARAMETERS),a=buildWorldGeometry(d,false,{x:0,y:0},'terrain',point),b=buildWorldGeometry(d,false,{x:0,y:0},'altitude',point);
  expect(a.positions).toEqual(b.positions);expect(a.positions.every(Number.isFinite)).toBe(true);expect(a.waterIndices.length).toBeGreaterThan(0);expect(b.waterIndices).toHaveLength(0);
  const local=buildWorldGeometry(d,true,{x:0,y:0},'terrain',point),normals:number[]=[];
  // Every sampled new shore triangle must also be the attachment plane of debris.
  const ground=createRenderedGroundSampler(d,true);
  for(let i=0;i<local.positions.length;i+=9*113){
   const a=local.positions.slice(i,i+3),b=local.positions.slice(i+3,i+6),c=local.positions.slice(i+6,i+9);
   const x=(a[0]!+b[0]!+c[0]!)/3,y=(a[2]!+b[2]!+c[2]!)/3,z=(a[1]!+b[1]!+c[1]!)/3;
   expect(ground(x,y).height).toBeCloseTo(z,9);
  }
  VertexData.ComputeNormals(local.positions,local.indices,normals);for(let i=1;i<normals.length;i+=3)expect(normals[i]).toBeGreaterThan(0);
 });
});

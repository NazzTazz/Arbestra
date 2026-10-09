import {buildWorldOutcrops} from './world-outcrops';
import {forestDistanceSquared} from '../../../../packages/contracts/src/world-forest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import type {GeneratedLandscape} from '@arbestra/contracts';
import {sampleWorldGeography} from '@arbestra/contracts/world-geography';
import {buildWorldGeometry} from './world-geography-mesh';
const data=JSON.parse(readFileSync(new URL('../../public/studies/t1.json',import.meta.url),'utf8')) as GeneratedLandscape;
it('renders the saved dry witness without water geometry, including negative hollows',()=>{
 const mesh=buildWorldGeometry(data,true,{x:120,y:80},'terrain',(x,y,z)=>[x,z/4,y]);
 expect(mesh.waterPositions).toHaveLength(0);expect(mesh.positions.every(Number.isFinite)).toBe(true);
 expect(mesh.positions.some((z,i)=>i%3===1&&z<0)).toBe(true);
 expect(data.terrainCodes.every(v=>v===0)).toBe(true);expect(data.walkable.every(v=>v===0)).toBe(true);
});
it('keeps saved trees on the same geography and out of the exposed steep rock',()=>{
 expect(data.forest!.trees.length).toBeGreaterThan(1000);
 for(const t of data.forest!.trees){const s=sampleWorldGeography(data.geography!,t.x,t.y);expect(t.elevation).toBeCloseTo(s.elevation,10);expect(s.rock).toBeLessThan(.45);}
});

it('renders the new plain stone groups and keeps tree trunks outside their footprints',()=>{
 const site=data.stoneSites![0]!;
 const mesh=buildWorldOutcrops(data,true,{x:site.x,y:site.y},(x,y,z)=>[x,z/4,y]);
 expect(mesh.positions.length).toBeGreaterThan(0);expect(mesh.positions.every(Number.isFinite)).toBe(true);
 const rocks=data.stoneSites!.flatMap(s=>s.rocks);
 expect(data.forest!.trees.every(t=>rocks.every(r=>forestDistanceSquared(t.x,t.y,r.x,r.y,data.width,data.height)>=Math.pow(Math.max(r.width,r.depth)*.8,2)))).toBe(true);
});

it('floods the preview at zero without resculpting terrain or submerging the C2 peak',()=>{
 const wet={...data,geography:{...data.geography!,study:{...data.geography!.study!,waterLevel:0}}};
 for(const [x,y] of [[32,64],[70,45],[0,80],[256,80],[174,100]]){
  const dry=sampleWorldGeography(data.geography!,x!,y!),s=sampleWorldGeography(wet.geography,x!,y!);
  expect(s.elevation).toBe(dry.elevation);expect(s.surface).toBe(0);expect(s.depth).toBe(Math.max(0,-s.elevation));
 }
 expect(sampleWorldGeography(wet.geography,32,64).depth).toBeGreaterThan(0);
 expect(sampleWorldGeography(wet.geography,70,45).depth).toBe(0);
 const mesh=buildWorldGeometry(wet,true,{x:0,y:80},'terrain',(x,y,z)=>[x,z/4,y]);
 expect(mesh.waterPositions.length).toBeGreaterThan(0);expect(mesh.waterPositions.every(Number.isFinite)).toBe(true);
 expect(mesh.waterPositions.filter((_,i)=>i%3===1).every(y=>Math.abs(y-.003)<1e-10)).toBe(true);
});

it('keeps the approved alpha reference pinned to its manifest',()=>{
 const raw=readFileSync(new URL('../../public/studies/t1-alpha.json',import.meta.url));
 const manifest=JSON.parse(readFileSync(new URL('../../public/studies/t1-alpha-manifest.json',import.meta.url),'utf8'));
 expect(createHash('sha256').update(raw).digest('hex')).toBe(manifest.sha256);
 expect(manifest.previewWaterLevel).toBe(0);
 const alpha=JSON.parse(raw.toString()) as GeneratedLandscape;
 expect(alpha.geography!.study!.plateaus).toBeDefined();expect(alpha.stoneSites!.length).toBe(29);
});

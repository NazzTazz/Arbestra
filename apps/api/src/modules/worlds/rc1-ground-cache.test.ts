import {readFileSync} from 'node:fs';
import {type Kysely} from 'kysely';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createSpawnTerrainField,type GeneratedLandscape,type SpawnTerrace} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import {readRc1Source} from './rc1-source.js';
import {readRc1Ground} from './rc1-ground.js';
vi.mock('./rc1-source.js',()=>({readRc1Source:vi.fn()}));
const source=vi.mocked(readRc1Source);
const artifact=JSON.parse(readFileSync(new URL('../../../../world-web/public/studies/t1-alpha512-rc1.json',import.meta.url),'utf8')) as GeneratedLandscape;
type Edit={treeIndices:number[];removedIndices:number[];cleared:boolean;remainingAmount:string|null;initialAmount:string|null;cellX:number|null;cellY:number|null;variantSeed:number|null};
function smallForest(){const data=structuredClone(artifact);delete data.geography!.geology;data.geography!.study={id:'t1',base:.75,chains:[],hollows:[]};data.stoneSites=[];data.forest!.trees=data.forest!.trees.slice(0,2);return data;}
function fixture(data=smallForest()){
 const world={widthCells:512,heightCells:256,chunkSize:32,seed:String(data.seed)},field=createSpawnTerrainField(data);
 source.mockResolvedValue({world,data,field});
 const rows={terraces:[] as SpawnTerrace[],edits:[] as Edit[],reads:[] as string[]};
 const db={selectFrom(table:string){rows.reads.push(table);const q={select(){return q;},leftJoinLateral(){return q;},where(){return q;},orderBy(){return q;},async execute(){return structuredClone(table==='worldSpawnTerraces'?rows.terraces:rows.edits);}};return q;}} as unknown as Kysely<Database>;
 return {db,rows,data,field};
}
afterEach(()=>vi.clearAllMocks());
describe('RC1 ground geometry cache without database',()=>{
 it('reuses geometry after current reads and invalidates terraces, tree removals, threshold, clearing and added groves',async()=>{
  const f=fixture(),tree=f.data.forest!.trees[0]!,surface={x:tree.x,y:tree.y,halfWidth:0,halfHeight:0};
  f.rows.edits=[{treeIndices:[0],removedIndices:[],cleared:false,remainingAmount:'500',initialAmount:'500',cellX:null,cellY:null,variantSeed:null}];
  const first=await readRc1Ground(f.db,'cache-pure-main'),same=await readRc1Ground(f.db,'cache-pure-main');
  expect(same.field).toBe(first.field);expect(same.navigation).toBe(first.navigation);
  expect(source).toHaveBeenCalledTimes(2);expect(f.rows.reads).toEqual(['worldSpawnTerraces','worldRc1Resources','worldSpawnTerraces','worldRc1Resources']);
  f.rows.edits[0]!.remainingAmount='300';
  expect((await readRc1Ground(f.db,'cache-pure-main')).field).toBe(first.field);
  expect(first.field.intersectsTree(surface)).toBe(true);expect(first.navigation.sample(tree.x,tree.y).blocked).toBe(true);
  f.rows.edits[0]!.remainingAmount='50';
  const threshold=await readRc1Ground(f.db,'cache-pure-main');
  expect(threshold.field.intersectsTree(surface)).toBe(false);expect(threshold.navigation.sample(tree.x,tree.y).blocked).toBe(true);
  f.rows.edits[0]!.removedIndices=[0];
  const removed=await readRc1Ground(f.db,'cache-pure-main');
  expect(removed.navigation.sample(tree.x,tree.y).blocked).toBe(false);
  expect(removed.navigation.revision).not.toBe(threshold.navigation.revision);
  f.rows.edits[0]!.removedIndices=[];f.rows.edits[0]!.cleared=true;
  const cleared=await readRc1Ground(f.db,'cache-pure-main');expect(cleared.navigation.sample(tree.x,tree.y).blocked).toBe(false);
  const height=first.field.sample(140,20).elevation+.25;f.rows.terraces=[{cellX:140,cellY:20,height}];
  const terraced=await readRc1Ground(f.db,'cache-pure-main');
  expect(terraced.field.sample(140,20).elevation).toBe(height);expect(terraced.navigation.revision).not.toBe(cleared.navigation.revision);
  expect(terraced.patch(128,0,32).terraces).toEqual(f.rows.terraces);
  f.rows.edits.push({treeIndices:[],removedIndices:[],cleared:false,remainingAmount:'1400',initialAmount:'1500',cellX:140,cellY:20,variantSeed:2});
  const grove=await readRc1Ground(f.db,'cache-pure-main');expect(grove.navigation.revision).not.toBe(terraced.navigation.revision);
  f.rows.edits[1]!.remainingAmount='500';f.rows.edits[1]!.initialAmount='3000';
  expect((await readRc1Ground(f.db,'cache-pure-main')).navigation).toBe(grove.navigation);
  f.rows.edits[1]!.variantSeed=3;expect((await readRc1Ground(f.db,'cache-pure-main')).navigation.revision).not.toBe(grove.navigation.revision);
  const other=await readRc1Ground(f.db,'cache-pure-other');expect(other.field).not.toBe(grove.field);
  const replacement=structuredClone(f.data);source.mockResolvedValue({world:{widthCells:512,heightCells:256,chunkSize:32,seed:String(replacement.seed)},data:replacement,field:createSpawnTerrainField(replacement)});
  expect((await readRc1Ground(f.db,'cache-pure-other')).field).not.toBe(other.field);
  const rejection=Error('changed artifact rejected by source');source.mockRejectedValueOnce(rejection);await expect(readRc1Ground(f.db,'cache-pure-other')).rejects.toBe(rejection);
 });
 it('bounds retained contexts and navigation samples while preserving their answers',async()=>{
  const f=fixture(),sample=vi.spyOn(f.field,'sample'),first=await readRc1Ground(f.db,'cache-pure-bound-0');
  const answer=first.navigation.sample(1,1);sample.mockClear();first.navigation.sample(1,1);expect(sample).not.toHaveBeenCalled();
  for(let i=0;i<32_768;i++)first.navigation.sample(2+i/64,2);
  sample.mockClear();expect(first.navigation.sample(1,1)).toEqual(answer);expect(sample).toHaveBeenCalledTimes(1);
  for(let i=1;i<=4;i++)await readRc1Ground(f.db,'cache-pure-bound-'+i);
  expect((await readRc1Ground(f.db,'cache-pure-bound-0')).field).not.toBe(first.field);
 });
 it('measures cold and reused geometry on the approved RC1 forest without skipping current reads',async()=>{
  const f=fixture(structuredClone(artifact)),start=performance.now(),first=await readRc1Ground(f.db,'cache-pure-measure'),coldMs=performance.now()-start;
  const warmStart=performance.now(),warm=await readRc1Ground(f.db,'cache-pure-measure'),warmMs=performance.now()-warmStart;
  f.rows.terraces=[{cellX:140,cellY:20,height:.5}];const editStart=performance.now(),edited=await readRc1Ground(f.db,'cache-pure-measure'),editMs=performance.now()-editStart;
  expect(warm.field).toBe(first.field);expect(edited.field).not.toBe(first.field);expect(edited.field.sample(140,20).elevation).toBe(.5);
  expect(f.rows.reads).toHaveLength(6);expect(source).toHaveBeenCalledTimes(3);
  console.info(JSON.stringify({kind:'pure RC1 geometry; no DB, no network, no command',trees:f.data.forest!.trees.length,coldMs,warmMs,terraceInvalidationMs:editMs}));
 });
});

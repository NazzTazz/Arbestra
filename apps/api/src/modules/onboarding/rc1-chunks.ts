import type {createSpawnTerrainField} from '@arbestra/contracts';
export interface Rc1ChunkProjection {chunkX:number;chunkY:number;generationVersion:number;terrainCodes:number[];elevations:number[]}
let cached:Rc1ChunkProjection[]|undefined;
/** The worker has already verified the one signed RC1 artifact. This is a
 * coarse index for existing reports/overview, never the source of build or walk authority. */
export function projectRc1Chunks(field:ReturnType<typeof createSpawnTerrainField>):Rc1ChunkProjection[]{
 if(cached)return cached;
 const chunks:Rc1ChunkProjection[]=[];
 for(let cy=0;cy<8;cy++)for(let cx=0;cx<16;cx++){
  const terrainCodes:number[]=[],elevations:number[]=[];
  for(let y=0;y<32;y++)for(let x=0;x<32;x++){const s=field.sample(cx*32+x,cy*32+y);terrainCodes.push(s.elevation>Math.max(0,s.surface)+1e-6?1:2);elevations.push(Math.round(s.elevation*100));}
  chunks.push({chunkX:cx,chunkY:cy,generationVersion:3,terrainCodes,elevations});
 }
 cached=chunks;return chunks;
}

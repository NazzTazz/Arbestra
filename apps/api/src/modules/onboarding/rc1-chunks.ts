import {RC1_WORLD,type createSpawnTerrainField} from '@arbestra/contracts';
export interface Rc1ChunkProjection {chunkX:number;chunkY:number;generationVersion:number;terrainCodes:number[];elevations:number[]}
let cached:Rc1ChunkProjection[]|undefined;
/** The worker has already verified the one signed RC1 artifact. This is a
 * coarse index for existing reports/overview, never the source of build or walk authority. */
export function projectRc1Chunks(field:ReturnType<typeof createSpawnTerrainField>):Rc1ChunkProjection[]{
 if(cached)return cached;
 const chunks:Rc1ChunkProjection[]=[],size=RC1_WORLD.chunkSize;
 for(let cy=0;cy<RC1_WORLD.heightCells/size;cy++)for(let cx=0;cx<RC1_WORLD.widthCells/size;cx++){
  const terrainCodes:number[]=[],elevations:number[]=[];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const s=field.sample(cx*size+x,cy*size+y);terrainCodes.push(s.elevation>Math.max(0,s.surface)+1e-6?1:2);elevations.push(Math.round(s.elevation*100));}
  chunks.push({chunkX:cx,chunkY:cy,generationVersion:3,terrainCodes,elevations});
 }
 cached=chunks;return chunks;
}

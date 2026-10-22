import {sql,type Transaction} from 'kysely';
import {vertexSurface,terraceHeight,type Rc1Ground,type TerrainVertex,type TerrainResponse} from '@arbestra/contracts';
import type {Database} from '../../database/schema.js';
import {HttpError} from '../../errors.js';
import {normalizeCell} from './coordinates.js';
import {readRc1Source} from './rc1-source.js';

type GroundChunk=Omit<TerrainResponse['chunks'][number],'features'|'occupiedCells'>;

/** Caller has authorized the world in its MVCC capture. Mutable input is
 * bounded by this chunk and its halo; no feature, navigation or village read. */
export async function readSelectedGround(tx:Transaction<Database>,worldId:string,chunkX:number,chunkY:number):Promise<GroundChunk>{
  const world=await tx.selectFrom('worlds').select(['generationVersion','generationStatus','widthCells','heightCells','chunkSize','terrainModel'])
    .where('id','=',worldId).executeTakeFirstOrThrow();
  const {widthCells:width,heightCells:height,chunkSize:size}=world;
  if(world.generationStatus!=='ready'||width%size||height%size)throw new HttpError(409,'WORLD_NOT_READY','Terrain indisponible.');
  if(!Number.isSafeInteger(chunkX)||!Number.isSafeInteger(chunkY)||chunkX<0||chunkY<0||chunkX>=width/size||chunkY>=height/size)throw Error('Non-canonical ground chunk');
  const originCellX=chunkX*size,originCellY=chunkY*size;
  const terrainCodes:number[]=[],elevations:number[]=[];
  let rc1:Rc1Ground|undefined;
  if(world.generationVersion===3){
    const source=await readRc1Source(tx,worldId);
    // Centers in [-1,size] require corners through size+1. Wrapping the
    // indexed coordinates also covers the halo across the torus seam.
    const xs=[...new Set(Array.from({length:size+3},(_,i)=>normalizeCell(originCellX+i-1,width)))];
    const ys=[...new Set(Array.from({length:size+3},(_,i)=>normalizeCell(originCellY+i-1,height)))];
    const vertices=world.terrainModel==='vertices'?(await sql<TerrainVertex>`select vertex_x,vertex_y,height from world_terrain_vertices
      where world_id=${worldId} and vertex_x=any(${xs}::integer[]) and vertex_y=any(${ys}::integer[])`.execute(tx)).rows:undefined;
    const terraces=vertices?[]:await tx.selectFrom('worldSpawnTerraces').select(['cellX','cellY','height']).where('worldId','=',worldId)
      .where('cellX','in',xs).where('cellY','in',ys).orderBy('cellX').orderBy('cellY').execute();
    const geometry=vertices?vertexSurface(world,(x,y)=>source.field.sample(x,y).elevation,vertices):undefined;
    const water=vertices?vertexSurface(world,(x,y)=>Math.max(0,source.field.sample(x,y).surface),[]):undefined;
    for(let dy=-1;dy<=size;dy++)for(let dx=-1;dx<=size;dx++){
      const x=normalizeCell(originCellX+dx,width),y=normalizeCell(originCellY+dy,height);
      const natural=geometry?undefined:source.field.sample(x,y);
      const elevation=geometry?geometry.sample(x,y):terraceHeight(terraces,x,y,world)??natural!.elevation;
      const surface=water?water.sample(x,y):natural!.surface;
      terrainCodes.push(elevation<=Math.max(0,surface)+1e-6?2:1);elevations.push(Math.round(elevation*100));
    }
    const stride=vertices?size+1:size*2+1,heights:number[]=[],waters:number[]=[];
    for(let y=0;y<stride;y++)for(let x=0;x<stride;x++){
      const px=originCellX-.5+x/(vertices?1:2),py=originCellY-.5+y/(vertices?1:2);
      const natural=geometry?undefined:source.field.sample(px,py);
      heights.push(geometry?geometry.sample(px,py):natural!.elevation);
      waters.push(water?water.sample(px,py):Math.max(0,natural!.surface));
    }
    rc1={...(vertices?{model:'vertices' as const}:{}),stride,heights,water:waters,
      terraces:terraces.filter(t=>t.cellX>=originCellX&&t.cellX<originCellX+size&&t.cellY>=originCellY&&t.cellY<originCellY+size)};
  }else{
    const coordinates=new Map<string,{chunkX:number;chunkY:number}>();
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const x=normalizeCell(chunkX+dx,width/size),y=normalizeCell(chunkY+dy,height/size);coordinates.set(`${x}:${y}`,{chunkX:x,chunkY:y});
    }
    const rows=await tx.selectFrom('worldChunks').selectAll().where('worldId','=',worldId)
      .where(eb=>eb.or([...coordinates.values()].map(c=>eb.and([eb('chunkX','=',c.chunkX),eb('chunkY','=',c.chunkY)])))).execute();
    if(rows.length!==coordinates.size||rows.some(r=>r.generationVersion!==world.generationVersion||r.terrainCodes.length!==size*size||r.elevations.length!==size*size))
      throw new HttpError(409,'WORLD_NOT_READY','Terrain incomplet.');
    const chunks=new Map(rows.map(row=>[`${row.chunkX}:${row.chunkY}`,row]));
    for(let dy=-1;dy<=size;dy++)for(let dx=-1;dx<=size;dx++){
      const x=normalizeCell(originCellX+dx,width),y=normalizeCell(originCellY+dy,height),row=chunks.get(`${Math.floor(x/size)}:${Math.floor(y/size)}`)!;
      const index=(y%size)*size+x%size;terrainCodes.push(row.terrainCodes[index]!);elevations.push(row.elevations[index]!);
    }
  }
  return {chunkX,chunkY,originCellX,originCellY,terrainCodes,elevations,...(rc1?{rc1}:{})};
}

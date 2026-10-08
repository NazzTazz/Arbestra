import '@babylonjs/core/Meshes/instancedMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { createRockSurface, rockPreviewElevation } from './rock-surface';
import { stairProfile } from '../world-generator/stair-profile';

export type TerrainPiece = 'wall' | 'outer-corner' | 'inner-corner' | 'stairs' | 'flat';
export type TerrainFinish = 'earth' | 'rock';
export const TERRAIN_UNIT = .25;

/** Cell coordinates, base y=0, ascent +Z. Traversability belongs to the canonical graph. */
export function terrainKitGeometry(piece: TerrainPiece, finish: TerrainFinish, variant = 0) {
  if(finish==='rock'&&piece!=='stairs'){
    const seed=42+variant*17;
    return createRockSurface({x:-4,z:-3,width:8,depth:6,seed,
      elevation:piece==='flat'?undefined:(x,z)=>rockPreviewElevation(x,z,seed)});
  }

  const positions: number[] = [], indices: number[] = [], colors: number[] = [];
  const quad = (p: number[][], top: boolean, band = 0, tint = 1) => {
    const start = positions.length / 3;
    const palette = top ? (finish === 'earth' ? [.39,.48,.25] : [.57,.57,.57])
      : (finish === 'earth' ? [.40,.29,.19] : [.46,.46,.46]);
    const shade = 1 + (((band * 7 + variant * 3) % 5) - 2) * .045;
    for (const v of p) { positions.push(...v); colors.push(...palette.map(c => c * shade * tint), 1); }
    indices.push(start,start+2,start+1,start,start+3,start+2);
  };
  const stairs = stairProfile({x:0,y:0,direction:1,length:2,width:5,low:0,high:1,from:0,to:1}, {elevations:[0,1]});
  const nx = piece === 'stairs' ? 5 : piece==='flat'?1:2, nz = piece === 'stairs' ? 8 : piece==='flat'?1:2;
  const dz = piece === 'stairs' ? .25 : 1;
  const height = (x: number,z: number): number => {
    if(x<0||z<0||x>=nx||z>=nz)return 0;
    if(piece==='stairs')return stairs[z]!.height*TERRAIN_UNIT;
    if(piece==='flat')return 0;
    if(piece==='wall')return z===1?TERRAIN_UNIT:0;
    if(piece==='outer-corner')return x===1&&z===1?TERRAIN_UNIT:0;
    return x===1||z===1?TERRAIN_UNIT:0;
  };
  // Exact common edges; exposed faces only, no overlapping stacked boxes.
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
    const h=height(x,z),a=x-nx/2,b=a+1,c=z*dz-nz*dz/2,d=c+dz;
    quad([[a,h,c],[a,h,d],[b,h,d],[b,h,c]],true,x+z+variant);
    const edges = [
      {low:height(x,z-1),a:[b,c],b:[a,c]},
      {low:height(x,z+1),a:[a,d],b:[b,d]},
      {low:height(x-1,z),a:[a,c],b:[a,d]},
      {low:height(x+1,z),a:[b,d],b:[b,c]},
    ];
    for(const e of edges){
      for(let lo=e.low;lo<h-1e-8;){
      const hi=Math.min(h,lo+TERRAIN_UNIT/4);
      quad([[e.a[0]!,lo,e.a[1]!],[e.b[0]!,lo,e.b[1]!],[e.b[0]!,hi,e.b[1]!],[e.a[0]!,hi,e.a[1]!]],false,Math.round(lo*32)+x+z);
      lo=hi;
      }
    }
  }
  const normals: number[]=[];VertexData.ComputeNormals(positions,indices,normals);
  const uvs:number[]=[];
  for(let i=0;i<positions.length;i+=3){
    const nx=Math.abs(normals[i]!),ny=Math.abs(normals[i+1]!),nz=Math.abs(normals[i+2]!);
    uvs.push((ny>=nx&&ny>=nz?positions[i]!:nx>nz?positions[i+2]!:positions[i]!)*3,
      (ny>=nx&&ny>=nz?positions[i+2]!:positions[i+1]!)*3);
  }
  return {positions,indices,normals,colors,uvs};
}

/** Bounded scene-owned recipe cache: 5 shapes x 2 finishes x 3 variations. */
export function createTerrainKit(scene: Scene) {
  const material=new StandardMaterial('terrain-kit',scene);
  material.diffuseColor=Color3.White();material.specularColor=Color3.Black();
  const stone=new StandardMaterial('terrain-organic-stone',scene);
  stone.diffuseColor=Color3.White();stone.specularColor=new Color3(.06,.06,.06);stone.specularPower=24;
  const sources=new Map<string,Mesh>();
  return {
    instantiate(piece: TerrainPiece, finish: TerrainFinish, variant=0) {
      if(!Number.isInteger(variant)||variant<0||variant>2)throw new Error('Terrain variant must be 0, 1 or 2');
      const key=piece+'-'+finish+'-'+variant;
      let source=sources.get(key);
      if(!source){
        source=new Mesh('terrain-source-'+key,scene);
        const data=new VertexData();Object.assign(data,terrainKitGeometry(piece,finish,variant));data.applyToMesh(source);
        source.material=finish==='rock'?stone:material;source.isVisible=false;source.isPickable=false;sources.set(key,source);
      }
      const instance=source.createInstance('terrain-'+key);
      instance.metadata={terrainPiece:piece,finish,variant};
      return instance;
    },
    dispose(){for(const source of sources.values())source.dispose();sources.clear();material.dispose();stone.dispose();},
  };
}

import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {DynamicTexture} from '@babylonjs/core/Materials/Textures/dynamicTexture';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {GeneratedLandscape} from '@arbestra/contracts';
import {sampleWorldGeography} from '@arbestra/contracts/world-geography';
/** Two static batches (graticule + text atlas) and one small moving selection. */
export function createStudyCoordinates(scene:Scene,data:GeneratedLandscape,local:boolean,center:{x:number;y:number},point:(x:number,y:number,z:number)=>number[],withLabels=true){
 const w=data.width,h=data.height,g=data.geography!;
 const x0=local?Math.floor((center.x-16)/32)*32:0,y0=local?Math.floor((center.y-16)/32)*32:0,x1=local?x0+64:w,y1=local?y0+64:h;
 const wrap=(v:number,size:number)=>((v%size)+size)%size;
 const position=(x:number,y:number,lift=.06)=>{const s=sampleWorldGeography(g,x,y);return Vector3.FromArray(point(x,y,(Math.max(s.elevation,s.surface)+lift)*4));};
 const lines:Vector3[][]=[];
 for(let x=x0;x<=x1;x+=32){const line:Vector3[]=[];for(let y=y0;y<=y1;y+=(local?.5:1))line.push(position(x,y));lines.push(line);}
 for(let y=y0;y<=y1;y+=32){const line:Vector3[]=[];for(let x=x0;x<=x1;x+=(local?.5:1))line.push(position(x,y));lines.push(line);}
 const grid=MeshBuilder.CreateLineSystem('study-coordinates',{lines},scene);grid.color=new Color3(.8,.75,.48);grid.alpha=.55;grid.isPickable=false;
 if(!withLabels)return {meshes:[grid],update(_selected:{x:number;y:number}){void _selected;}};
 const atlasHeight=Math.max(512,Math.ceil((x1-x0)*(y1-y0)/1024/8)*64);
 const texture=new DynamicTexture('study-coordinate-labels',{width:1024,height:atlasHeight},scene,false);texture.hasAlpha=true;
 const ctx=texture.getContext();ctx.clearRect(0,0,1024,atlasHeight);ctx.font='bold 28px sans-serif';
 const positions:number[]=[],indices:number[]=[],uvs:number[]=[];let count=0;
 for(let y=y0;y<y1;y+=32)for(let x=x0;x<x1;x+=32){
  const column=Math.floor(wrap(x,w)/32),row=Math.floor(wrap(y,h)/32),label=String.fromCharCode(65+column)+(row+1);
  const tx=count%8*128,ty=Math.floor(count/8)*64;
  ctx.strokeStyle='#17251b';ctx.lineWidth=6;ctx.strokeText(label,tx+64-ctx.measureText(label).width/2,ty+40);ctx.fillStyle='#fff1bb';ctx.fillText(label,tx+64-ctx.measureText(label).width/2,ty+40);
  // Draped text receives ordinary depth testing, including the back of the torus.
  const corners=[[x+3,y+2],[x+11,y+2],[x+11,y+6],[x+3,y+6]];
  for(const [px,py]of corners)positions.push(...position(px!,py!,.06).asArray());
  const start=count*4;indices.push(start,start+1,start+2,start,start+2,start+3);
  const u=tx/1024,v=ty/atlasHeight;uvs.push(u,v+64/atlasHeight,u+128/1024,v+64/atlasHeight,u+128/1024,v,u,v);count++;
 }
 texture.update(false);
 const material=new StandardMaterial('study-coordinate-ink',scene);material.diffuseTexture=texture;material.emissiveColor=Color3.White();material.disableLighting=true;material.backFaceCulling=false;material.useAlphaFromDiffuseTexture=true;
 const labels=new Mesh('study-sector-labels',scene),vd=new VertexData();vd.positions=positions;vd.indices=indices;vd.uvs=uvs;vd.applyToMesh(labels);labels.material=material;labels.isPickable=false;
 const markerLines=Array.from({length:2},()=>Array.from({length:9},()=>Vector3.Zero()));
 const marker=MeshBuilder.CreateLineSystem('study-location',{lines:markerLines,updatable:true},scene);marker.color=new Color3(1,.35,.17);marker.isPickable=false;
 let previous='';
 return {meshes:[grid,labels,marker],update(selected:{x:number;y:number}){
  const key=selected.x+':'+selected.y;if(key===previous)return;previous=key;
  const x=local?x0+wrap(selected.x-x0,w):selected.x,y=local?y0+wrap(selected.y-y0,h):selected.y;
  for(let i=0;i<9;i++){const offset=-2+i*.5;markerLines[0]![i]!.copyFrom(position(x+offset,y,.12));markerLines[1]![i]!.copyFrom(position(x,y+offset,.12));}
  MeshBuilder.CreateLineSystem('study-location',{lines:markerLines,instance:marker},scene);marker.refreshBoundingInfo();
 }};
}

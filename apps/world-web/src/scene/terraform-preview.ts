import {cellVertices,vertexKey,type LevelingQuote,type TravelCell} from '@arbestra/contracts';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {Constants} from '@babylonjs/core/Engines/constants';
import type {Scene} from '@babylonjs/core/scene';
import type {WorldSpace} from './world-space';

export interface TerraformVisual {quote:LevelingQuote;origin:TravelCell;invalidCells:TravelCell[];sourceHeights:Array<{vertexX:number;vertexY:number;height:number}>}
/** A bounded mesh per tint; picking continues to use the actual ground. */
export class TerraformPreview {
  #meshes:Mesh[]=[];#signature='';
  constructor(private scene:Scene){}
  update(value:TerraformVisual|null,space:WorldSpace){
    const signature=value?JSON.stringify([value,space.version]):'';
    if(signature===this.#signature)return;
    this.clear();this.#signature=signature;if(!value)return;
    const {quote,origin}=value,heights=new Map(value.sourceHeights.map(v=>[vertexKey(v),v.height]));
    for(const v of quote.vertices??[])heights.set(vertexKey(v),v.height);
    const key=(c:TravelCell)=>`${c.cellX}:${c.cellY}`,selected=new Set(quote.cells.map(key)),invalid=new Set(value.invalidCells.map(key));
    const world={widthCells:space.width,heightCells:space.height},groups=new Map<string,TravelCell[]>();
    for(const c of quote.affectedCells??quote.cells){const colour=invalid.has(key(c))?'#ee776c':key(c)===key(origin)?'#f5ce55':selected.has(key(c))?'#e4eaed':'#829d98';
      const group=groups.get(colour)??[];group.push(c);groups.set(colour,group);}
    for(const [colour,cells] of groups){
      const positions:number[]=[],indices:number[]=[],lines:Vector3[][]=[];
      for(const c of cells){
        const base=space.project(c),points=cellVertices(c,world).map((v,i)=>new Vector3(base.x+(i===1||i===2?.5:-.5)*2.5,(heights.get(vertexKey(v))??0)*2.5+.035,base.z+(i>=2?.5:-.5)*2.5));
        for(const triangle of [[0,1,2],[0,2,3]]){const start=positions.length/3;for(const i of triangle){const p=points[i]!;positions.push(p.x,p.y,p.z);}indices.push(start,start+2,start+1);}
        lines.push([points[0]!,points[1]!,points[2]!,points[3]!,points[0]!],[points[0]!,points[2]!]);
      }
      const mesh=new Mesh('terraform-future-ground',this.scene),data=new VertexData();data.positions=positions;data.indices=indices;data.applyToMesh(mesh);
      const material=new StandardMaterial('terraform-tint',this.scene);material.disableLighting=true;material.emissiveColor=Color3.FromHexString(colour);
      material.alpha=colour==='#829d98'?.12:.34;material.backFaceCulling=false;material.disableDepthWrite=true;material.depthFunction=Constants.ALWAYS;
      mesh.material=material;mesh.isPickable=false;mesh.renderingGroupId=2;this.#meshes.push(mesh);
      const edge=MeshBuilder.CreateLineSystem('terraform-triangles',{lines},this.scene);edge.color=Color3.FromHexString(colour);edge.alpha=colour==='#829d98'?.36:.9;edge.isPickable=false;edge.renderingGroupId=2;
      if(edge.material)edge.material.depthFunction=Constants.ALWAYS;this.#meshes.push(edge);
    }
  }
  clear(){for(const m of this.#meshes)m.dispose(false,true);this.#meshes=[];this.#signature='';}
  dispose(){this.clear();}
}

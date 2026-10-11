import {infrastructurePlanSurface,infrastructureSidewalkSurface,type BuildingAccess,type RoadPixel,type InfrastructurePlan,type SubPoint} from '@arbestra/contracts';
import type {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {BuildingGeometry} from './building-geometry';
import type {WorldSpace} from './world-space';
import {sidewalkPaving} from './sidewalk-paving';
export class InfrastructureRenderer{
  #meshes:Mesh[]=[];#signature='';readonly materials:Record<string,StandardMaterial>={};
  #requestSignature='';
  #surfaceKey='';
  #surface:ReadonlyMap<string,RoadPixel>=new Map();
  constructor(readonly scene:Scene){for(const [code,color]of Object.entries({earth:'#795b3d','stone-1':'#c5c6b8','stone-2':'#d4d3c4',border:'#c5c6b8',preview:'#95caff'})){
    const m=new StandardMaterial(`infrastructure-${code}`,scene);m.diffuseColor=Color3.FromHexString(color);m.specularColor=Color3.Black();this.materials[code]=m;}}
  update(plan:InfrastructurePlan,space:WorldSpace,ground:(x:number,y:number)=>number|null,preview=false,terrainRevision=0,surfaceOverride?:ReadonlyMap<string,RoadPixel>,bordersOnly=false,accesses:readonly BuildingAccess[]=[],dimensions:{pavementHeight?:number;curbHeight?:number;followTerrain?:boolean}={}){
    const planKey=JSON.stringify([plan,space.width,space.height,surfaceOverride&&[...surfaceOverride]]);
    const requestSignature=JSON.stringify([planKey,space.origin,space.version,preview,terrainRevision,bordersOnly,accesses,dimensions]);
    if(requestSignature===this.#requestSignature)return;
    this.#requestSignature=requestSignature;
    if(planKey!==this.#surfaceKey){this.#surfaceKey=planKey;this.#surface=surfaceOverride??infrastructurePlanSurface(plan,{widthCells:space.width,heightCells:space.height});}
    const surface=this.#surface;
    // A remote streamed chunk must not rebuild the entire village's masonry.
    const grounds=new Map<string,number|null>();
    const sample=(x:number,y:number)=>{const key=`${x}:${y}`;if(!grounds.has(key))grounds.set(key,ground(x,y));return grounds.get(key)!;};
    const cell=(v:number,size:number)=>dimensions.followTerrain?((v%size)+size)%size:((Math.floor(v+.5)%size)+size)%size;
    const samplePixel=(p:{x:number;y:number})=>{
      const x=(p.x+.5)/16,y=(p.y+.5)/16;
      sample(cell(x,space.width),cell(y,space.height));
      if(dimensions.followTerrain)for(const dx of [-1/32,1/32])for(const dy of [-1/32,1/32])sample(cell(x+dx,space.width),cell(y+dy,space.height));
    };
    for(const p of surface.values())samplePixel(p);
    /* Legacy centre sampling stays unchanged. */
    for(const p of surface.values())sample(Math.floor((p.x+.5)/16+.5)%space.width,Math.floor((p.y+.5)/16+.5)%space.height);
    // Door connections must not cut or reshape the visible sidewalk.
    const sidewalks=infrastructureSidewalkSurface(surface,{widthCells:space.width,heightCells:space.height});
    for(const p of sidewalks.values())samplePixel(p);
    const signature=JSON.stringify([planKey,space.origin,space.version,preview,bordersOnly,accesses,dimensions,[...grounds]]);
    if(signature===this.#signature)return;
    this.#meshes.forEach(m=>m.dispose(false,false));this.#meshes=[];this.#signature=signature;
    const pavementHeight=dimensions.pavementHeight??.04,curbHeight=dimensions.curbHeight??.06;
    const groups=new Map<string,BuildingGeometry[]>(),seen=new Set<string>();
    const box=(code:string,x:number,y:number,width:number,depth:number,top:number,height=.028)=>{
      const p=space.project({cellX:x,cellY:y}),piece=BuildingGeometry.box(code,{width,height,depth});piece.position=new Vector3(p.x,top-height/2,p.z);
      if(dimensions.followTerrain){
        const centre=sample(cell(x,space.width),cell(y,space.height));
        const positions=piece.data.positions!;
        for(let i=0;i<positions.length;i+=3){const cx=cell(x+positions[i]!/2.5,space.width),cy=cell(y+positions[i+2]!/2.5,space.height);
          positions[i+1]!+=(sample(cx,cy)??centre??0)-(centre??0);}
        VertexData.ComputeNormals(positions,piece.data.indices!,piece.data.normals!);
      }
      const list=groups.get(code)??[];list.push(piece);groups.set(code,list);
    };
    // Deterministic masonry modules, clipped to the actual raster union; no overlapping layer per stroke.
    for(const p of surface.values())if(!bordersOnly&&p.manual&&(preview||p.material!=='none')){
      const x=(p.x+.5)/16,y=(p.y+.5)/16,h=sample(cell(x,space.width),cell(y,space.height));if(h===null)continue;
      const code=preview?'preview':p.material;
      if(code==='earth'||preview){box(code,x,y,2.5/16,2.5/16,h+.002,.025);continue;}
      const length=p.material==='stone-1'?6:8,depth=p.material==='stone-1'?2:4,row=Math.floor(p.y/depth),shift=(row%2)*length/2;
      const bx=Math.floor((p.x-shift)/length)*length+shift,by=row*depth,key=`${code}:${bx}:${by}`;if(seen.has(key))continue;seen.add(key);
      // Each contiguous run is clipped; cut pieces at the road's boundary keep the fixed module pitch.
      const runs:Array<{x0:number;x1:number;y0:number;y1:number}>=[];
      for(let yy=by;yy<by+depth;yy++){let first:number|null=null;
        for(let xx=bx;xx<=bx+length;xx++){const pixel=surface.get(`${(xx+space.width*16)%(space.width*16)}:${(yy+space.height*16)%(space.height*16)}`);
          const included=xx<bx+length&&pixel?.manual&&pixel.material===p.material;
          if(included&&first===null)first=xx;if(!included&&first!==null){const prior=runs.find(r=>r.x0===first&&r.x1===xx&&r.y1===yy);if(prior)prior.y1++;else runs.push({x0:first,x1:xx,y0:yy,y1:yy+1});first=null;}}
      }
      for(const r of runs)box(code,(r.x0+r.x1)/32,(r.y0+r.y1)/32,(r.x1-r.x0)*2.5/16-.012,(r.y1-r.y0)*2.5/16-.008,(dimensions.followTerrain?sample(cell((r.x0+r.x1)/32,space.width),cell((r.y0+r.y1)/32,space.height))??h:h)+.003,pavementHeight);
    }
    // Batched Pierre 1 stones; longitudinal joints and diagonal corner miters.
    for(const stone of sidewalkPaving(surface,sidewalks,{widthCells:space.width,heightCells:space.height})){
      const polygon=stone.polygon,n=polygon.length,x=polygon.reduce((s,p)=>s+p.x,0)/n/16,y=polygon.reduce((s,p)=>s+p.y,0)/n/16;
      const h=sample(cell(x,space.width),cell(y,space.height));if(h===null)continue;
      const code=preview?'preview':'border',positions:number[]=[],indices:number[]=[],normals:number[]=[],uvs:number[]=[];
      const point=(i:number,top:boolean)=>{const q=polygon[i]!,cx=q.x/16,cy=q.y/16,p=space.project({cellX:cx,cellY:cy});
        const height=dimensions.followTerrain?sample(cell(cx,space.width),cell(cy,space.height))??h:h;
        return [p.x,height+.004+(top?curbHeight:0),p.z];};
      const face=(vertices:number[][],triangles:number[])=>{const offset=positions.length/3;positions.push(...vertices.flat());for(const v of vertices)uvs.push(stone.axis==='x'?v[0]!/3.75:v[2]!/3.75,stone.axis==='x'?v[2]!/.3125:v[0]!/.3125);indices.push(...triangles.map(i=>i+offset));};
      // Babylon uses left-handed winding: the visible stone top must have +Y normals.
      face(polygon.map((_,i)=>point(i,true)),Array.from({length:n-2},(_,i)=>[0,i+1,i+2]).flat());
      face(polygon.map((_,i)=>point(i,false)),Array.from({length:n-2},(_,i)=>[0,i+2,i+1]).flat());
      for(let i=0;i<n;i++){const j=(i+1)%n;face([point(i,false),point(j,false),point(j,true),point(i,true)],[0,1,2,0,2,3]);}
      VertexData.ComputeNormals(positions,indices,normals);const data=new VertexData();Object.assign(data,{positions,indices,normals,uvs});
      const list=groups.get(code)??[];list.push(new BuildingGeometry(code,data));groups.set(code,list);
    }
    for(const [code,pieces]of groups)for(let i=0;i<pieces.length;i+=1024){const mesh=new Mesh(`infrastructure-${code}`,this.scene);BuildingGeometry.merge(pieces.slice(i,i+1024)).applyToMesh(mesh);mesh.material=this.materials[code]??null;mesh.isPickable=false;this.#meshes.push(mesh);}
  }
  setInvalid(invalid:boolean){this.materials.preview!.emissiveColor=Color3.FromHexString(invalid?'#bd453b':'#244a73');this.materials.preview!.alpha=.5;}
  visible(value:boolean){this.#meshes.forEach(m=>m.setEnabled(value));}
  get meshes(){return this.#meshes;}
  clear(){this.#meshes.forEach(m=>m.dispose(false,false));this.#meshes=[];this.#signature='';this.#requestSignature='';}
  dispose(){this.clear();Object.values(this.materials).forEach(m=>m.dispose());}
}
export interface InfrastructureGesture {kind:'hover'|'down'|'up'|'right'|'cancel';point:SubPoint|null;drag?:boolean;equipmentId?:string}

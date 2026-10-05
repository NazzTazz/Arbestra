import {infrastructurePlanSurface,infrastructureSidewalkSurface,type BuildingAccess,type RoadPixel,type InfrastructurePlan,type SubPoint} from '@arbestra/contracts';
import type {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {BuildingGeometry} from './building-geometry';
import type {WorldSpace} from './world-space';
export class InfrastructureRenderer{
  #meshes:Mesh[]=[];#signature='';readonly materials:Record<string,StandardMaterial>={};
  #requestSignature='';
  #surfaceKey='';
  #surface:ReadonlyMap<string,RoadPixel>=new Map();
  constructor(readonly scene:Scene){for(const [code,color]of Object.entries({earth:'#795b3d','stone-1':'#c5c6b8','stone-2':'#d4d3c4',border:'#c7cacc',preview:'#95caff'})){
    const m=new StandardMaterial(`infrastructure-${code}`,scene);m.diffuseColor=Color3.FromHexString(color);m.specularColor=Color3.Black();this.materials[code]=m;}}
  update(plan:InfrastructurePlan,space:WorldSpace,ground:(x:number,y:number)=>number|null,preview=false,terrainRevision=0,surfaceOverride?:ReadonlyMap<string,RoadPixel>,bordersOnly=false,accesses:readonly BuildingAccess[]=[],dimensions:{pavementHeight?:number;curbHeight?:number}={}){
    const planKey=JSON.stringify([plan,space.width,space.height,surfaceOverride&&[...surfaceOverride]]);
    const requestSignature=JSON.stringify([planKey,space.origin,space.version,preview,terrainRevision,bordersOnly,accesses,dimensions]);
    if(requestSignature===this.#requestSignature)return;
    this.#requestSignature=requestSignature;
    if(planKey!==this.#surfaceKey){this.#surfaceKey=planKey;this.#surface=surfaceOverride??infrastructurePlanSurface(plan,{widthCells:space.width,heightCells:space.height});}
    const surface=this.#surface;
    // A remote streamed chunk must not rebuild the entire village's masonry.
    const grounds=new Map<string,number|null>();
    const sample=(x:number,y:number)=>{const key=`${x}:${y}`;if(!grounds.has(key))grounds.set(key,ground(x,y));return grounds.get(key)!;};
    for(const p of surface.values())sample(Math.floor((p.x+.5)/16+.5)%space.width,Math.floor((p.y+.5)/16+.5)%space.height);
    // Door connections must not cut or reshape the visible sidewalk.
    const sidewalks=infrastructureSidewalkSurface(surface,{widthCells:space.width,heightCells:space.height});
    for(const p of sidewalks.values())sample(Math.floor((p.x+.5)/16+.5)%space.width,Math.floor((p.y+.5)/16+.5)%space.height);
    const signature=JSON.stringify([planKey,space.origin,space.version,preview,bordersOnly,accesses,dimensions,[...grounds]]);
    if(signature===this.#signature)return;
    this.#meshes.forEach(m=>m.dispose(false,false));this.#meshes=[];this.#signature=signature;
    const pavementHeight=dimensions.pavementHeight??.04,curbHeight=dimensions.curbHeight??.04;
    const groups=new Map<string,BuildingGeometry[]>(),seen=new Set<string>();
    const box=(code:string,x:number,y:number,width:number,depth:number,top:number,height=.028)=>{
      const p=space.project({cellX:x,cellY:y}),piece=BuildingGeometry.box(code,{width,height,depth});piece.position=new Vector3(p.x,top-height/2,p.z);
      const list=groups.get(code)??[];list.push(piece);groups.set(code,list);
    };
    // Deterministic masonry modules, clipped to the actual raster union; no overlapping layer per stroke.
    for(const p of surface.values())if(!bordersOnly&&p.manual&&(preview||p.material!=='none')){
      const x=(p.x+.5)/16,y=(p.y+.5)/16,h=ground(Math.floor(x+.5)%space.width,Math.floor(y+.5)%space.height);if(h===null)continue;
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
      for(const r of runs)box(code,(r.x0+r.x1)/32,(r.y0+r.y1)/32,(r.x1-r.x0)*2.5/16-.012,(r.y1-r.y0)*2.5/16-.008,h+.003,pavementHeight);
    }
    // Merge continuous strips so widening the sidewalk does not multiply masonry meshes.
    const strips:Array<{x0:number;x1:number;y:number;h:number}>=[];
    for(const pixel of [...sidewalks.values()].sort((a,b)=>a.y-b.y||a.x-b.x)){
      const x=(pixel.x+.5)/16,y=(pixel.y+.5)/16,h=sample(Math.floor(x+.5)%space.width,Math.floor(y+.5)%space.height);if(h===null)continue;
      const last=strips.at(-1);
      if(last&&last.y===pixel.y&&last.x1===pixel.x&&last.h===h)last.x1++;
      else strips.push({x0:pixel.x,x1:pixel.x+1,y:pixel.y,h});
    }
    for(const r of strips)box(preview?'preview':'border',(r.x0+r.x1)/32,(r.y+.5)/16,(r.x1-r.x0)*2.5/16,2.5/16,r.h+.004,curbHeight);
    for(const [code,pieces]of groups)for(let i=0;i<pieces.length;i+=1024){const mesh=new Mesh(`infrastructure-${code}`,this.scene);BuildingGeometry.merge(pieces.slice(i,i+1024)).applyToMesh(mesh);mesh.material=this.materials[code]??null;mesh.isPickable=false;this.#meshes.push(mesh);}
  }
  setInvalid(invalid:boolean){this.materials.preview!.emissiveColor=Color3.FromHexString(invalid?'#bd453b':'#244a73');this.materials.preview!.alpha=.5;}
  visible(value:boolean){this.#meshes.forEach(m=>m.setEnabled(value));}
  get meshes(){return this.#meshes;}
  clear(){this.#meshes.forEach(m=>m.dispose(false,false));this.#meshes=[];this.#signature='';this.#requestSignature='';}
  dispose(){this.clear();Object.values(this.materials).forEach(m=>m.dispose());}
}
export interface InfrastructureGesture {kind:'hover'|'down'|'up'|'right'|'cancel';point:SubPoint|null;drag?:boolean;equipmentId?:string}

import {infrastructurePlanSurface,infrastructureSidewalkSurface,infrastructureBorders,type BuildingAccess,type RoadPixel,type InfrastructurePlan,type SubPoint} from '@arbestra/contracts';
import type {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {BuildingGeometry} from './building-geometry';
import type {WorldSpace} from './world-space';
import {sidewalkPaving,type SidewalkStone} from './sidewalk-paving';
import {flatRoadGeometry} from './infrastructure-surface-geometry';

interface RenderLayer {key:string;probes:ReadonlyMap<string,number|null>;meshes:Mesh[]}
export class InfrastructureRenderer{
  #meshes:Mesh[]=[];#signature='';readonly materials:Record<string,StandardMaterial>={};
  #requestSignature='';
  #groundIdentity:string|undefined;
  #groundProbes=new Map<string,number|null>();
  #surfaceKey='';
  #surface:ReadonlyMap<string,RoadPixel>=new Map();
  #layers=new Map<string,RenderLayer>();
  #preview=false;
  #sidewalkKey='';
  #sidewalkReads=new Map<string,boolean>();
  #sidewalks=new Map<string,{x:number;y:number}>();
  #paving:SidewalkStone[]=[];
  constructor(readonly scene:Scene){for(const [code,color]of Object.entries({earth:'#795b3d',rubble:'#b7b8b2','stone-1':'#c5c6b8','stone-2':'#d4d3c4',border:'#c5c6b8',preview:'#95caff'})){
    const m=new StandardMaterial(`infrastructure-${code}`,scene);m.diffuseColor=Color3.FromHexString(color);m.specularColor=Color3.Black();this.materials[code]=m;}}
  update(plan:InfrastructurePlan,space:WorldSpace,ground:(x:number,y:number)=>number|null,preview=false,terrainRevision=0,surfaceOverride?:ReadonlyMap<string,RoadPixel>,bordersOnly=false,accesses:readonly BuildingAccess[]=[],dimensions:{pavementHeight?:number;curbHeight?:number;followTerrain?:boolean;groundIdentity?:string|undefined}={}){
    void accesses; // Sidewalk shape is independent of building entrances.
    const planKey=JSON.stringify([surfaceOverride?[...surfaceOverride]:[plan.roads,plan.inheritedRoads,plan.inheritedCells],space.width,space.height]);
    // The caller identity covers ground values and availability, independently of mesh admission.
    const {groundIdentity,...shape}=dimensions,sameGround=groundIdentity!==undefined&&groundIdentity===this.#groundIdentity;
    const signature=JSON.stringify([planKey,space.origin,space.version,preview,bordersOnly,shape]);
    const requestSignature=signature+':'+terrainRevision+':'+groundIdentity;
    if(requestSignature===this.#requestSignature)return;
    this.#requestSignature=requestSignature;this.#groundIdentity=groundIdentity;
    if(signature===this.#signature&&(sameGround||[...this.#groundProbes].every(([key,height])=>{const [x,y]=key.split(':').map(Number);return ground(x!,y!)===height;})))return;
    this.#signature=signature;
    if(planKey!==this.#surfaceKey){this.#surfaceKey=planKey;this.#surface=surfaceOverride??infrastructurePlanSurface(plan,{widthCells:space.width,heightCells:space.height});}
    const surface=this.#surface;
    const priorGrounds=this.#groundProbes,grounds=new Map<string,number|null>();this.#groundProbes=grounds;
    const sample=(x:number,y:number)=>{const key=`${x}:${y}`;if(!grounds.has(key))grounds.set(key,sameGround&&priorGrounds.has(key)?priorGrounds.get(key)!:ground(x,y));return grounds.get(key)!;};
    const cell=(v:number,size:number)=>dimensions.followTerrain?((v%size)+size)%size:((Math.floor(v+.5)%size)+size)%size;
    if(preview!==this.#preview){this.#meshes.forEach(m=>m.dispose(false,false));this.#meshes=[];this.#layers.clear();this.#preview=preview;}
    const world={widthCells:space.width,heightCells:space.height};
    let sidewalks:ReadonlyMap<string,{x:number;y:number}>;
    if(preview)sidewalks=infrastructureSidewalkSurface(surface,world);
    else{
      const key=JSON.stringify([world,[...infrastructureBorders(surface,world).values()]]);
      if(key!==this.#sidewalkKey||[...this.#sidewalkReads].some(([point,manual])=>Boolean(surface.get(point)?.manual)!==manual)){
        // Track the shared helpers' actual occupancy reads, without copying their rules.
        const reads=new Map<string,boolean>();
        const observed:ReadonlyMap<string,RoadPixel>={
          size:surface.size,
          get(point){const pixel=surface.get(point);reads.set(point,Boolean(pixel?.manual));return pixel;},
          has:point=>surface.has(point),
          keys:()=>surface.keys(),values:()=>surface.values(),entries:()=>surface.entries(),
          forEach:(callback,thisArg)=>surface.forEach((pixel,point)=>callback.call(thisArg,pixel,point,observed)),
          [Symbol.iterator]:()=>surface[Symbol.iterator](),
        };
        this.#sidewalks=infrastructureSidewalkSurface(observed,world);
        this.#paving=sidewalkPaving(observed,this.#sidewalks,world);
        this.#sidewalkReads=reads;this.#sidewalkKey=key;
      }
      sidewalks=this.#sidewalks;
    }
    if(preview){
      // A single welded top surface: no masonry joints, boxes or internal walls.
      this.#meshes.forEach(m=>m.dispose(false,false));this.#meshes=[];
      const pixels=new Map<string,{x:number;y:number}>();
      if(!bordersOnly)for(const [key,p] of surface)if(p.manual)pixels.set(key,p);
      for(const [key,p] of sidewalks)pixels.set(key,p);
      const data=flatRoadGeometry(pixels,space,sample,dimensions.followTerrain??false,.04);
      if(data.indices?.length)this.#meshes.push(this.#mesh('preview',data));
      return;
    }
    const baseKey=JSON.stringify([space.width,space.height,space.origin,space.version,dimensions.followTerrain??false]);
    const nextLayers=new Map<string,RenderLayer>();
    const layer=(code:string,geometryKey:unknown,generate:(read:(x:number,y:number)=>number|null)=>Mesh[])=>{
      const key=baseKey+':'+JSON.stringify(geometryKey),prior=this.#layers.get(code);
      if(prior&&prior.key===key&&(sameGround||[...prior.probes].every(([point,height])=>{const [x,y]=point.split(':').map(Number);return sample(x!,y!)===height;}))){
        for(const [point,height]of prior.probes)grounds.set(point,height);nextLayers.set(code,prior);return;
      }
      const probes=new Map<string,number|null>();
      const read=(x:number,y:number)=>{const value=sample(x,y);probes.set(x+':'+y,value);return value;};
      const meshes=generate(read);prior?.meshes.forEach(m=>m.dispose(false,false));
      nextLayers.set(code,{key,probes,meshes});
    };
    if(!bordersOnly)for(const code of ['earth','rubble'] as const){
      const pixels=new Map([...surface].filter(([,p])=>p.manual&&p.material===code));
      // Eight-cell sectors bound the geometry replaced by a short earth/rubble stroke.
      const sectorSize=128,sectors=new Map<string,Map<string,RoadPixel>>();
      for(const [point,p]of pixels){const sector=Math.floor(p.x/sectorSize)+':'+Math.floor(p.y/sectorSize);let group=sectors.get(sector);if(!group){group=new Map();sectors.set(sector,group);}group.set(point,p);}
      for(const [sector,group]of sectors){
        // Adjacent-sector occupancy determines exposed walls, including toric seams.
        const halo:Array<[string,boolean]>=[];
        for(const p of group.values())for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){
          const x=(p.x+dx!+space.width*16)%(space.width*16),y=(p.y+dy!+space.height*16)%(space.height*16),point=x+':'+y;
          if(!group.has(point))halo.push([point,pixels.has(point)]);
        }
        layer(code+':'+sector,[[...group.values()].map(p=>[p.x,p.y]),halo],read=>{
          const data=flatRoadGeometry(group,space,read,dimensions.followTerrain??false,.015,.025,pixels);
          return data.indices?.length?[this.#mesh(code,data)]:[];
        });
      }
    }
    const pavementHeight=dimensions.pavementHeight??.04,curbHeight=dimensions.curbHeight??.06;
    if(!bordersOnly)for(const code of ['stone-1','stone-2'] as const){
      const pixels=new Map([...surface].filter(([,p])=>p.manual&&p.material===code));
      layer(code,[pavementHeight,[...pixels.values()].map(p=>[p.x,p.y])],read=>{
        const pieces:BuildingGeometry[]=[],seen=new Set<string>();
        const box=(x:number,y:number,width:number,depth:number,top:number)=>{
          const p=space.project({cellX:x,cellY:y}),piece=BuildingGeometry.box(code,{width,height:pavementHeight,depth});piece.position=new Vector3(p.x,top-pavementHeight/2,p.z);
          if(dimensions.followTerrain){
            const centre=read(cell(x,space.width),cell(y,space.height)),positions=piece.data.positions!;
            for(let i=0;i<positions.length;i+=3){const cx=cell(x+positions[i]!/2.5,space.width),cy=cell(y+positions[i+2]!/2.5,space.height);
              positions[i+1]!+=(read(cx,cy)??centre??0)-(centre??0);}
            VertexData.ComputeNormals(positions,piece.data.indices!,piece.data.normals!);
          }
          pieces.push(piece);
        };
        // Only changed material layers regenerate their clipped masonry modules.
        for(const p of pixels.values()){
          const x=(p.x+.5)/16,y=(p.y+.5)/16,h=read(cell(x,space.width),cell(y,space.height));if(h===null)continue;
          const length=code==='stone-1'?6:8,depth=code==='stone-1'?2:4,row=Math.floor(p.y/depth),shift=(row%2)*length/2;
          const bx=Math.floor((p.x-shift)/length)*length+shift,by=row*depth,key=bx+':'+by;if(seen.has(key))continue;seen.add(key);
          const runs:Array<{x0:number;x1:number;y0:number;y1:number}>=[];
          for(let yy=by;yy<by+depth;yy++){let first:number|null=null;
            for(let xx=bx;xx<=bx+length;xx++){const included=xx<bx+length&&pixels.has(`${(xx+space.width*16)%(space.width*16)}:${(yy+space.height*16)%(space.height*16)}`);
              if(included&&first===null)first=xx;if(!included&&first!==null){const prior=runs.find(r=>r.x0===first&&r.x1===xx&&r.y1===yy);if(prior)prior.y1++;else runs.push({x0:first,x1:xx,y0:yy,y1:yy+1});first=null;}}
          }
          for(const r of runs)box((r.x0+r.x1)/32,(r.y0+r.y1)/32,(r.x1-r.x0)*2.5/16-.012,(r.y1-r.y0)*2.5/16-.008,
            (dimensions.followTerrain?read(cell((r.x0+r.x1)/32,space.width),cell((r.y0+r.y1)/32,space.height))??h:h)+.003);
        }
        return this.#merge(code,pieces);
      });
    }
    layer('border',[curbHeight,this.#paving],read=>{
      const pieces:BuildingGeometry[]=[];
      for(const stone of this.#paving){
        const polygon=stone.polygon,n=polygon.length,x=polygon.reduce((s,p)=>s+p.x,0)/n/16,y=polygon.reduce((s,p)=>s+p.y,0)/n/16;
        const h=read(cell(x,space.width),cell(y,space.height));if(h===null)continue;
        const positions:number[]=[],indices:number[]=[],normals:number[]=[],uvs:number[]=[];
        const point=(i:number,top:boolean)=>{const q=polygon[i]!,cx=q.x/16,cy=q.y/16,p=space.project({cellX:cx,cellY:cy});
          const height=dimensions.followTerrain?read(cell(cx,space.width),cell(cy,space.height))??h:h;
          return [p.x,height+.004+(top?curbHeight:0),p.z];};
        const face=(vertices:number[][],triangles:number[])=>{const offset=positions.length/3;positions.push(...vertices.flat());for(const v of vertices)uvs.push(stone.axis==='x'?v[0]!/3.75:v[2]!/3.75,stone.axis==='x'?v[2]!/.3125:v[0]!/.3125);indices.push(...triangles.map(i=>i+offset));};
        face(polygon.map((_,i)=>point(i,true)),Array.from({length:n-2},(_,i)=>[0,i+1,i+2]).flat());
        face(polygon.map((_,i)=>point(i,false)),Array.from({length:n-2},(_,i)=>[0,i+2,i+1]).flat());
        for(let i=0;i<n;i++){const j=(i+1)%n;face([point(i,false),point(j,false),point(j,true),point(i,true)],[0,1,2,0,2,3]);}
        VertexData.ComputeNormals(positions,indices,normals);const data=new VertexData();Object.assign(data,{positions,indices,normals,uvs});pieces.push(new BuildingGeometry('border',data));
      }
      return this.#merge('border',pieces);
    });
    for(const [code,prior]of this.#layers)if(!nextLayers.has(code))prior.meshes.forEach(m=>m.dispose(false,false));
    this.#layers=nextLayers;this.#meshes=[...nextLayers.values()].flatMap(value=>value.meshes);
  }
  #mesh(code:string,data:VertexData):Mesh{
    const mesh=new Mesh('infrastructure-'+code,this.scene);data.applyToMesh(mesh);mesh.material=this.materials[code]??null;mesh.isPickable=false;return mesh;
  }
  #merge(code:string,pieces:BuildingGeometry[]):Mesh[]{
    const meshes:Mesh[]=[];
    for(let i=0;i<pieces.length;i+=1024){const mesh=new Mesh('infrastructure-'+code,this.scene);BuildingGeometry.merge(pieces.slice(i,i+1024)).applyToMesh(mesh);mesh.material=this.materials[code]??null;mesh.isPickable=false;meshes.push(mesh);}
    return meshes;
  }
  setInvalid(invalid:boolean){this.materials.preview!.emissiveColor=Color3.FromHexString(invalid?'#bd453b':'#244a73');this.materials.preview!.alpha=.65;}
  visible(value:boolean){this.#meshes.forEach(m=>m.setEnabled(value));}
  get meshes(){return this.#meshes;}
  clear(){this.#meshes.forEach(m=>m.dispose(false,false));this.#meshes=[];this.#signature='';this.#requestSignature='';this.#groundIdentity=undefined;this.#groundProbes.clear();this.#layers.clear();this.#sidewalkKey='';this.#sidewalkReads.clear();this.#sidewalks.clear();this.#paving=[];}
  dispose(){this.clear();Object.values(this.materials).forEach(m=>m.dispose());}
}
export interface InfrastructureGesture {kind:'hover'|'down'|'up'|'right'|'cancel';point:SubPoint|null;drag?:boolean;equipmentId?:string}

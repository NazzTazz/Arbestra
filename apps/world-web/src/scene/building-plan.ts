import type { Building, VillageCell, VillageState } from '@arbestra/contracts';
import { delta, normalize } from './world-space';
import { WORKER_CLEARANCE } from './worker-motion';

export type Face = '-x' | '+x' | '-z' | '+z';
export interface Point { x: number; y: number; z: number }
export interface Opening { face: Face; left: number; right: number; bottom: number; top: number; door: boolean }
export interface Stone { x: number; y: number; z: number; length: number; height: number; thickness: number; axis: 'x'|'z'; shade: number }
export interface WallSegment { a: Point; b: Point; height: number; thickness: number; key: string; owner: string }
export interface BuildingRecipe {
  id: string; version: number; modules?: [number, number]; fill?: [number, number];
  module: { length: number; height: number; thickness: number; joint: number };
  courses: number; levels: number; floorThickness: number;
  rotateOddLevels?: boolean;
  entrance: { face: Face; centre: number; width: number; courses: number; enabled?: boolean; open?: boolean };
  windows: Partial<Record<Face, number[]>>;
  // Explicit bays: centre in half-modules, width in modules, heights in courses.
  windowOpenings?: Array<{face:Face;level:number;centre:number;width:number;sill:number;courses:number}>;
  roof: { slope: number; overhang: number; sideOverhang?: number; lengthExtraRatio?:number; allowOutsideFootprint?: boolean; trussSpacing: number; maxSpan: number; style?: 'flat-stone' };
  walls?: { courses: number; gateWidth: number };
}
export interface PlanInput {
  id: string; anchor: {cellX:number;cellY:number}; cells: {cellX:number;cellY:number}[];
  world: {widthCells:number;heightCells:number}; recipe: BuildingRecipe;
  quarterTurns?: number; offset?: [number,number]; placement?: 'centre'|Face;
  heights?: number[]; phase?: 'finished'|'works'; sourceLevels?: number;
}
export interface BuildingPlan {
  id:string; recipe:BuildingRecipe; phase:'finished'|'works'; sourceLevels:number;
  origin:Point; rotation:number; width:number; depth:number; height:number; base:number;
  footprint:{width:number;depth:number}; fill:[number,number]; openings:Opening[]; stones:Stone[];
  entry:{inside:Point;threshold:Point;outside:Point;gate:Point;normal:Point};
  murets:WallSegment[]; bounds:{halfX:number;halfZ:number};
}
export const CELL_UNITS=2.5;
export const FACES:Face[]=['-x','+x','-z','+z'];
export const HALL_RECIPE:BuildingRecipe={id:'town-hall',version:1,modules:[8,16],
  module:{length:.28,height:.14,thickness:.14,joint:.003},courses:12,levels:1,floorThickness:.05,
  entrance:{face:'-x',centre:0,width:2,courses:6},windows:{'-x':[2],'+x':[2],'-z':[1],'+z':[1]},
  roof:{slope:35,overhang:.045,sideOverhang:.290,lengthExtraRatio:.1,allowOutsideFootprint:true,trussSpacing:1.2,maxSpan:3}};
export const HOUSE_RECIPE:BuildingRecipe={...HALL_RECIPE,id:'stone-house',modules:[6,6],courses:10,
  rotateOddLevels:true,
  entrance:{face:'-z',centre:0,width:2,courses:6},windows:{'-x':[1],'+x':[1],'-z':[0],'+z':[1]}};

function assert(ok:boolean,message:string):asserts ok {if(!ok)throw new Error(`Building recipe: ${message}`);}
export function facePoint(face:Face,u:number,y:number,distance:number):Point {
  const s=face[0]==='-'?-1:1;
  return face.endsWith('x')?{x:s*distance,y,z:u}:{x:u,y,z:s*distance};
}
export function transformPoint(plan:Pick<BuildingPlan,'origin'|'rotation'>,p:Point):Point {
  const c=Math.cos(plan.rotation),s=Math.sin(plan.rotation);
  return {x:plan.origin.x+c*p.x+s*p.z,y:plan.origin.y+p.y,z:plan.origin.z-s*p.x+c*p.z};
}
/** Integer lattice and continuous local frame, including a wrapped footprint. */
export function buildingPlan(input:PlanInput):BuildingPlan {
  const r=input.recipe,m=r.module,turn=input.quarterTurns??0;
  assert(Number.isInteger(turn)&&turn>=0&&turn<4,'rotation must be a quarter turn');
  assert(input.cells.length>0&&new Set(input.cells.map(c=>`${c.cellX}:${c.cellY}`)).size===input.cells.length,'empty or duplicate footprint');
  assert(input.cells.some(c=>c.cellX===input.anchor.cellX&&c.cellY===input.anchor.cellY),'missing anchor');
  const xs=input.cells.map(c=>delta(c.cellX,input.anchor.cellX,input.world.widthCells)),zs=input.cells.map(c=>delta(c.cellY,input.anchor.cellY,input.world.heightCells));
  const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
  assert((maxX-minX+1)*(maxZ-minZ+1)===input.cells.length,'footprint must be a filled rectangle');
  const fw=(maxX-minX+1)*CELL_UNITS,fd=(maxZ-minZ+1)*CELL_UNITS;
  const available=turn%2?[fd,fw]:[fw,fd];
  assert(m.length>0&&m.height>0&&m.thickness>0&&Math.abs(m.length-2*m.thickness)<1e-8&&m.joint>=0&&m.joint<m.height/4,'invalid masonry module');
  assert(Number.isInteger(r.levels)&&r.levels>=1&&r.levels<=3&&Number.isInteger(r.courses)&&r.courses>=8,'invalid habitable levels');
  const modules=r.modules??available.map((v,i)=>Math.floor(v*(r.fill?.[i]??.8)/m.length)) as [number,number];
  assert(modules.every(n=>Number.isInteger(n)&&n>=4),'invalid module counts');
  const width=modules[0]*m.length,depth=modules[1]*m.length;
  assert(!r.rotateOddLevels||r.levels===1||Math.abs(width-depth)<1e-8,'alternating levels require a square body');
  const sideOverhang=r.roof.sideOverhang??r.roof.overhang,endOverhang=Math.max(r.roof.overhang,depth*(r.roof.lengthExtraRatio??0)/2);
  assert(width<=available[0]!+1e-8&&depth<=available[1]!+1e-8,'body exceeds footprint');
  assert(r.roof.allowOutsideFootprint||width+2*sideOverhang<=available[0]!+1e-8,'roof exceeds footprint');
  assert(depth+2*endOverhang<=available[1]!+1e-8,'roof exceeds footprint');
  assert(width<=r.roof.maxSpan&&r.roof.trussSpacing>0&&r.roof.slope>10&&r.roof.slope<60,'unsupported roof');
  const offset=input.offset??[0,0],position=input.placement??'centre';
  const ox=offset[0]+(position.endsWith('x')?(position[0]==='-'?-1:1)*(available[0]!-width-2*r.roof.overhang)/2:0);
  const oz=offset[1]+(position.endsWith('z')?(position[0]==='-'?-1:1)*(available[1]!-depth-2*r.roof.overhang)/2:0);
  assert(Math.abs(ox)+width/2<=available[0]!/2+1e-8&&Math.abs(oz)+(depth/2+endOverhang)<=available[1]!/2+1e-8,'placement exceeds footprint');
  const heights=input.heights??[0];
  assert(heights.every(Number.isFinite)&&Math.max(...heights)-Math.min(...heights)<=.025+1e-8,'uneven terrain');
  const base=Math.max(...heights)+.02,height=r.levels*r.courses*m.height+(r.levels-1)*r.floorThickness;
  const rotation=turn*Math.PI/2,c=Math.cos(rotation),s=Math.sin(rotation);
  const origin={x:(minX+maxX)/2*CELL_UNITS+c*ox+s*oz,y:base,z:(minZ+maxZ)/2*CELL_UNITS-s*ox+c*oz};
  const openings:Opening[]=[];
  for(const face of FACES){
    const length=face.endsWith('x')?depth:width,half=length/2,side=face.endsWith('x')?width/2:depth/2;
    if(face===r.entrance.face&&r.entrance.enabled!==false){const centre=r.entrance.centre*m.length/2,w=r.entrance.width*m.length;
      assert(Number.isInteger(r.entrance.centre)&&Number.isInteger(r.entrance.width)&&Number.isInteger(r.entrance.courses),'door off lattice');
      openings.push({face,left:centre-w/2,right:centre+w/2,bottom:0,top:r.entrance.courses*m.height,door:true});}
    for(let level=0;level<r.levels;level++){
      const count=r.windows[face]?.[level]??r.windows[face]?.[0]??0;
      assert(Number.isInteger(count)&&count>=0,'invalid window count');
      const bottom=level*(r.courses*m.height+r.floorThickness)+4*m.height;
      const door=openings.find(o=>o.face===face&&o.door),positions:number[]=[];
      // Deterministic balanced slots, excluding the entrance on the ground level.
      const slots:number[]=[];for(let u=-half+2*m.length;u<=half-2*m.length+1e-8;u+=m.length/2)
        if(level>0||!door||u+m.length<=door.left-m.thickness||u-m.length>=door.right+m.thickness)slots.push(u);
      for(let i=0;i<count;i++){
        const desired=count===1?0:-half+(i+1)*length/(count+1);
        const candidates=slots.filter(u=>positions.every(p=>Math.abs(p-u)>=3*m.length-1e-8));
        candidates.sort((a,b)=>Math.abs(a-desired)-Math.abs(b-desired)||a-b);
        assert(candidates.length>0,'windows cannot fit');positions.push(candidates[0]!);
      }
      for(const u of positions)openings.push({face,left:u-m.length,right:u+m.length,bottom,top:bottom+3*m.height,door:false});
    }
    for(const bay of r.windowOpenings??[]){
      if(bay.face!==face)continue;
      assert([bay.level,bay.centre,bay.width,bay.sill,bay.courses].every(Number.isInteger)&&bay.level>=0&&bay.level<r.levels&&bay.width>0&&bay.sill>=0&&bay.courses>0,'invalid explicit window');
      const centre=bay.centre*m.length/2,bottom=bay.level*(r.courses*m.height+r.floorThickness)+bay.sill*m.height;
      openings.push({face,left:centre-bay.width*m.length/2,right:centre+bay.width*m.length/2,bottom,top:bottom+bay.courses*m.height,door:false});
    }
    for(const o of openings.filter(o=>o.face===face))assert(o.left>=-half+m.thickness-1e-8&&o.right<=half-m.thickness+1e-8&&o.top<=height-m.height+1e-8,'opening exceeds wall');
    if(r.walls&&face===r.entrance.face){const free=available[face.endsWith('x')?0:1]!/2-side-(face.endsWith('x')?Math.abs(ox):Math.abs(oz))-m.thickness;
      assert(free>=WORKER_CLEARANCE,'muret leaves insufficient passage');}
  }
  const face=r.entrance.face,normal=facePoint(face,0,0,1),distance=face.endsWith('x')?width/2:depth/2,u=r.entrance.centre*m.length/2;
  const edge=available[face.endsWith('x')?0:1]!/2-(face[0]==='-'?-1:1)*(face.endsWith('x')?ox:oz);
  const entry={normal,inside:facePoint(face,u,0,distance-.08),threshold:facePoint(face,u,0,distance),outside:facePoint(face,u,0,distance+WORKER_CLEARANCE),gate:facePoint(face,u,0,edge)};
  const stones:Stone[]=[];
  for(let level=0;level<r.levels;level++)for(let row=level>0&&r.floorThickness>m.joint?-1:0;row<r.courses;row++)for(const wallFace of FACES){
    const axis=wallFace.endsWith('x')?'z':'x',through=(row%2===0)===(axis==='x'),half=(axis==='x'?width:depth)/2;
    const limit=half-(through?0:m.thickness),fixed=(wallFace[0]==='-'?-1:1)*((axis==='x'?depth:width)/2-m.thickness/2);
    const levelBase=level*(r.courses*m.height+r.floorThickness);
    const low=levelBase+(row<0?-r.floorThickness:row*m.height),high=row<0?levelBase:low+m.height;
    const holes=openings.filter(o=>o.face===wallFace).flatMap(o=>[o,{...o,left:o.left-m.thickness,right:o.right+m.thickness,bottom:o.top,top:o.top+m.height}]).filter(o=>o.bottom<high-1e-8&&o.top>low+1e-8);
    const cuts=[-limit,limit,...holes.flatMap(o=>[o.left,o.right])].filter(v=>v>=-limit&&v<=limit).sort((a,b)=>a-b);
    for(let i=0;i<cuts.length-1;i++){
      const a=cuts[i]!,b=cuts[i+1]!;if(b-a<1e-8||holes.some(o=>(a+b)/2>o.left&&(a+b)/2<o.right))continue;
      let start=a;
      while(start<b-1e-8){const halfStep=m.length/2;
        const nextJoint=-half+(row%2?halfStep:0)+(Math.floor((start+half-(row%2?halfStep:0))/m.length+1e-7)+1)*m.length;
        const end=Math.min(b,nextJoint),length=end-start;
        assert(Math.abs(length/halfStep-Math.round(length/halfStep))<1e-6,'non modular stone fragment');
        const centre=(start+end)/2;
        const x=axis==='x'?centre:fixed,z=axis==='x'?fixed:centre,rotate=r.rotateOddLevels&&level%2===1;
        stones.push({x:rotate?z:x,y:(low+high)/2,z:rotate?-x:z,length:length-m.joint,height:high-low-m.joint,thickness:m.thickness-m.joint,axis:rotate?(axis==='x'?'z':'x'):axis,shade:.96+((row*17+i*31+stones.length)%5)*.01});
        start=end;
      }
    }
  }
  if(r.rotateOddLevels)for(const opening of openings){const level=Math.floor((opening.bottom+1e-7)/(r.courses*m.height+r.floorThickness));
    if(level%2===1){const old=opening.face;opening.face=({'-x':'+z','+x':'-z','-z':'-x','+z':'+x'} as const)[old];
      if(old.endsWith('z')){const left=opening.left;opening.left=-opening.right;opening.right=-left;}}
  }
  const murets:WallSegment[]=[];
  if(r.walls){assert(r.walls.gateWidth>=WORKER_CLEARANCE&&Number.isInteger(r.walls.courses)&&r.walls.courses>0,'invalid boundary wall');
    for(const f of FACES){const along=(f.endsWith('x')?available[1]:available[0])!/2,perp=(f.endsWith('x')?available[0]:available[1])!/2;
      const shift=f.endsWith('x')?oz:ox,normalShift=(f[0]==='-'?-1:1)*(f.endsWith('x')?ox:oz);
      const cuts=f===face?[[-along-shift,u-r.walls.gateWidth/2],[u+r.walls.gateWidth/2,along-shift]]:[[-along-shift,along-shift]];
      for(const [a,b] of cuts)if(b!-a!>.001)murets.push({a:facePoint(f,a!,0,perp-normalShift-m.thickness/2),b:facePoint(f,b!,0,perp-normalShift-m.thickness/2),height:r.walls.courses*m.height,thickness:m.thickness,key:`${input.id}:${f}:${a}`,owner:input.id});
    }
  }
  return {id:input.id,recipe:r,phase:input.phase??'finished',sourceLevels:input.sourceLevels??0,origin,rotation,width,depth,height,base,footprint:{width:fw,depth:fd},fill:[width/available[0]!,depth/available[1]!],openings,stones,entry,murets,bounds:{halfX:width/2+sideOverhang,halfZ:depth/2+endOverhang}};
}

export function recipeFor(building:Building):{recipe:BuildingRecipe;phase:'finished'|'works';sourceLevels:number}|null {
  const layout=building.visualLayout;if(!layout)return null;
  const base=layout.recipe==='town-hall'?HALL_RECIPE:HOUSE_RECIPE;
  const level=building.status==='under-construction'?(building.targetLevel??building.level):building.level;
  // Explicit recipes, rather than a universal level-to-floor mapping.
  const levels=base.id==='stone-house'&&level===2?2:1;
  return {recipe:{...base,levels,entrance:{...base.entrance,face:layout.entranceFace}},phase:building.status==='under-construction'?'works':'finished',
    sourceLevels:building.targetLevel!==null?(base.id==='stone-house'&&building.level===2?2:1):0};
}
export function planForSite(state:VillageState,site:VillageCell):BuildingPlan|null {
  if(!site.building)return null;const resolved=recipeFor(site.building);if(!resolved)return null;
  const cells=state.cells.filter(c=>c.footprint?.buildingId===site.building!.id);
  const footprint=cells.length?cells:[site];
  const heights=footprint.map(c=>{const x=normalize(c.cellX-state.region.originCellX,state.world.widthCells),y=normalize(c.cellY-state.region.originCellY,state.world.heightCells);return (state.region.elevations[y*state.region.width+x]??0)*.025;});
  return buildingPlan({id:site.building.id,anchor:site,cells:footprint,world:state.world,...resolved,heights,
    quarterTurns:site.building.visualLayout!.quarterTurns,offset:site.building.visualLayout!.offset});
}
export function planFocus(state:VillageState,site:VillageCell,plan:BuildingPlan){return {
  cellX:normalize(site.cellX+plan.origin.x/CELL_UNITS,state.world.widthCells),cellY:normalize(site.cellY+plan.origin.z/CELL_UNITS,state.world.heightCells)};}

/** Local orthogonal connector around the body; never changes authoritative travel time. */
export function entranceConnector(plan:BuildingPlan,join:Point):Point[] {
  const fenced=plan.murets.length>0,normal=plan.entry.normal;
  const start=fenced?{x:plan.entry.gate.x+normal.x*WORKER_CLEARANCE,y:0,z:plan.entry.gate.z+normal.z*WORKER_CLEARANCE}:plan.entry.outside;
  const hx=fenced?Math.max(...plan.murets.flatMap(w=>[Math.abs(w.a.x),Math.abs(w.b.x)]))+plan.recipe.module.thickness/2+WORKER_CLEARANCE/2:plan.width/2+WORKER_CLEARANCE/2;
  const hz=fenced?Math.max(...plan.murets.flatMap(w=>[Math.abs(w.a.z),Math.abs(w.b.z)]))+plan.recipe.module.thickness/2+WORKER_CLEARANCE/2:plan.depth/2+WORKER_CLEARANCE/2;
  const inside=(p:Point)=>Math.abs(p.x)<hx-1e-8&&Math.abs(p.z)<hz-1e-8;
  assert(!inside(join),'connector destination inside building');
  const xs=[...new Set([start.x,join.x,-hx,hx])],zs=[...new Set([start.z,join.z,-hz,hz])];
  const nodes=xs.flatMap(x=>zs.map(z=>({x,y:0,z}))).filter(p=>!inside(p));
  const index=(p:Point)=>nodes.findIndex(n=>n.x===p.x&&n.z===p.z),source=index(start),target=index(join);
  const costs=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),done=new Set<number>();costs[source]=0;
  const blocked=(a:Point,b:Point)=>a.x===b.x?Math.abs(a.x)<hx-1e-8&&Math.min(a.z,b.z)<hz-1e-8&&Math.max(a.z,b.z)>-hz+1e-8:
    Math.abs(a.z)<hz-1e-8&&Math.min(a.x,b.x)<hx-1e-8&&Math.max(a.x,b.x)>-hx+1e-8;
  while(!done.has(target)){let u=-1;for(let i=0;i<nodes.length;i++)if(!done.has(i)&&(u<0||costs[i]!<costs[u]!))u=i;
    assert(u>=0&&Number.isFinite(costs[u]),'unreachable entrance');done.add(u);
    for(let v=0;v<nodes.length;v++){const a=nodes[u]!,b=nodes[v]!;if(done.has(v)||(a.x!==b.x&&a.z!==b.z)||blocked(a,b))continue;
      const cost=costs[u]!+Math.abs(a.x-b.x)+Math.abs(a.z-b.z);if(cost<costs[v]!){costs[v]=cost;previous[v]=u;}}
  }
  const route:Point[]=[];for(let i=target;i!==-1;i=previous[i]!)route.unshift(nodes[i]!);
  return [plan.entry.inside,plan.entry.threshold,...(fenced?[plan.entry.outside,plan.entry.gate]:[]),...route];
}

/** Shared boundary resolution in canonical world units; gates from either side win. */
export function resolveMurets(items:{plan:BuildingPlan;anchor:{cellX:number;cellY:number}}[],world:{widthCells:number;heightCells:number}):Map<string,WallSegment[]> {
  const result=new Map(items.map(i=>[i.plan.id,[] as WallSegment[]]));
  type Edge={owner:string;axis:'x'|'z';fixed:number;lo:number;hi:number;height:number;thickness:number;gate:boolean};
  const edges:Edge[]=[],width=world.widthCells*CELL_UNITS,depth=world.heightCells*CELL_UNITS;
  for(const {plan,anchor} of items){if(!plan.murets.length)continue;
    const project=(p:Point)=>{const q=transformPoint(plan,p);return {x:q.x+anchor.cellX*CELL_UNITS,z:q.z+anchor.cellY*CELL_UNITS};};
    const add=(a:Point,b:Point,height:number,thickness:number,gate:boolean)=>{
      const pa=project(a),pb=project(b),axis=Math.abs(pa.x-pb.x)>.001?'x':'z';
      // Recover the exact cell edge from wall centre (half-thickness inside the plot).
      const perp=axis==='x'?'z':'x',centre=project({x:0,y:0,z:0}),side=Math.sign(pa[perp]-centre[perp]);
      const fixed=normalize(pa[perp]+(gate?0:side*thickness/2),perp==='x'?width:depth);
      const size=axis==='x'?width:depth,lo=Math.min(pa[axis],pb[axis]),hi=Math.max(pa[axis],pb[axis]),nlo=normalize(lo,size),span=hi-lo;
      const push=(l:number,h:number)=>edges.push({owner:plan.id,axis,fixed:Math.round(fixed*1e6)/1e6,lo:l,hi:h,height,thickness,gate});
      if(nlo+span<=size)push(nlo,nlo+span);else{push(nlo,size);push(0,nlo+span-size);}
    };
    for(const w of plan.murets)add(w.a,w.b,w.height,w.thickness,false);
    const e=plan.entry.gate,n=plan.entry.normal,half=plan.recipe.walls!.gateWidth/2;
    add({x:e.x+n.z*half,y:0,z:e.z-n.x*half},{x:e.x-n.z*half,y:0,z:e.z+n.x*half},0,plan.recipe.module.thickness,true);
  }
  const lines=new Map<string,Edge[]>();for(const e of edges){const key=`${e.axis}:${e.fixed}`,line=lines.get(key)??[];line.push(e);lines.set(key,line);}
  for(const [key,line] of lines){const cuts=[...new Set(line.flatMap(e=>[e.lo,e.hi]))].sort((a,b)=>a-b);
    for(let i=0;i<cuts.length-1;i++){const lo=cuts[i]!,hi=cuts[i+1]!,mid=(lo+hi)/2;if(hi-lo<1e-6)continue;
      if(line.some(e=>e.gate&&mid>e.lo&&mid<e.hi))continue;
      const owners=line.filter(e=>!e.gate&&mid>e.lo&&mid<e.hi).sort((a,b)=>a.owner<b.owner?-1:a.owner>b.owner?1:0);if(!owners.length)continue;
      const e=owners[0]!,item=items.find(i=>i.plan.id===e.owner)!,{plan,anchor}=item;
      const centre=transformPoint(plan,{x:0,y:0,z:0}),cx=centre.x+anchor.cellX*CELL_UNITS,cz=centre.z+anchor.cellY*CELL_UNITS;
      const fixed=e.fixed-Math.sign(delta(e.fixed,e.axis==='x'?cz:cx,e.axis==='x'?depth:width))*e.thickness/2;
      const point=(u:number)=>{const x=delta(e.axis==='x'?u:fixed,cx,width),z=delta(e.axis==='x'?fixed:u,cz,depth),c=Math.cos(plan.rotation),s=Math.sin(plan.rotation);return {x:c*x-s*z,y:0,z:s*x+c*z};};
      result.get(e.owner)!.push({a:point(lo),b:point(hi),height:e.height,thickness:e.thickness,key:`${key}:${lo}:${hi}`,owner:e.owner});
    }
  }
  return result;
}

import type {VillageState} from './villages.js';
import {coarseTravelPath} from './travel-paths.js';
import {infrastructurePlanSurface,subCellKey,wrapCoordinate,wrappedDistance,type SubPoint} from './infrastructure.js';
export interface AutomaticBrazier {id:string;position:SubPoint;cellX:number;cellY:number}
/** Canonical decorative topology shared by picking, rendering and server validation. */
export function automaticBraziers(state:Pick<VillageState,'world'|'cells'|'region'|'travelRoutes'|'infrastructure'>):AutomaticBrazier[]{
  const {world,infrastructure:plan}=state,w=world.widthCells*8,h=world.heightCells*8;
  const surface=infrastructurePlanSurface(plan??{revision:0,roads:[],equipment:[],manualLighting:[],suppressedBraziers:[],stoneReserve:0},world),edited=new Set([...surface.values()].map(p=>`${Math.floor((p.x+8)/16)%world.widthCells}:${Math.floor((p.y+8)/16)%world.heightCells}`));
  const occupied=new Set(state.cells.filter(c=>c.footprint||c.building).map(c=>`${c.cellX}:${c.cellY}`));
  const nodes=new Map<string,{p:SubPoint;mask:number;width:number;legacy:boolean}>();
  const line=(a:SubPoint,b:SubPoint,width:number,legacy:boolean)=>{
    const dx=wrappedDistance(b.x,a.x,w),dy=wrappedDistance(b.y,a.y,h);if(dx&&dy)return;
    const step=legacy?8:1,n=(Math.abs(dx)+Math.abs(dy))/step;
    if(n>512)return;
    for(let i=0;i<=n;i++){
      const p={x:wrapCoordinate(a.x+Math.sign(dx)*i*step,w),y:wrapCoordinate(a.y+Math.sign(dy)*i*step,h)},cell=subCellKey(p,world);
      if(legacy&&(occupied.has(cell)||edited.has(cell)))continue;
      const key=`${p.x}:${p.y}`,node=nodes.get(key)??{p,mask:0,width,legacy};
      const bit=dx>0?1:dx<0?2:dy>0?4:8,opposite=dx>0?2:dx<0?1:dy>0?8:4;
      if(i<n)node.mask|=bit;if(i>0)node.mask|=opposite;node.width=Math.max(node.width,width);nodes.set(key,node);
    }
  };
  for(const route of state.travelRoutes){const cells=coarseTravelPath(route.cells,world).map(p=>({x:p.cellX*8,y:p.cellY*8}));
    for(let i=1;i<cells.length;i++){
      const a=cells[i-1]!,b=cells[i]!;
      // Match the visible road runs: an excluded endpoint removes the whole arm.
      if([a,b].some(p=>occupied.has(subCellKey(p,world))||edited.has(subCellKey(p,world))))continue;
      line(a,b,3,true);
    }
  }
  for(const road of [...(plan?.inheritedRoads??[]),...(plan?.roads??[])])if(road.operation==='paint'&&road.material!=='none')for(let i=1;i<road.points.length;i++)line(road.points[i-1]!,road.points[i]!,road.width,false);
  // History describes edits, not today's topology. Removed arms cannot generate fires.
  for(const node of nodes.values())if(!node.legacy){
    const painted=(dx:number,dy:number)=>{const p=surface.get(`${wrapCoordinate(node.p.x*2+dx,w*2)}:${wrapCoordinate(node.p.y*2+dy,h*2)}`);return p?.manual&&p.material!=='none';};
    if(!painted(0,0)&&!painted(-1,-1)){node.mask=0;continue;}
    for(const [bit,dx,dy]of [[1,1,0],[2,-1,0],[4,0,1],[8,0,-1]])if(!painted(dx!,dy!))node.mask&=~bit!;
    const horizontal=(node.mask&3)!==0;
    let radius=0;for(let i=0;i<8;i++)if(painted(horizontal?0:i,horizontal?i:0)||painted(horizontal?0:-i-1,horizontal?-i-1:0))radius=i+1;
    node.width=Math.max(2,radius);
  }
  const result:AutomaticBrazier[]=[];
  for(const node of nodes.values())for(const sx of [-1,1])for(const sy of [-1,1]){
    if(!(node.mask&(sx>0?1:2))||!(node.mask&(sy>0?4:8)))continue;
    const offset=node.legacy?3:Math.ceil(node.width/2+1),position={x:wrapCoordinate(node.p.x+sx*offset,w),y:wrapCoordinate(node.p.y+sy*offset,h)};
    const cellX=wrapCoordinate(Math.floor((position.x+4)/8),world.widthCells),cellY=wrapCoordinate(Math.floor((position.y+4)/8),world.heightCells),cell=`${cellX}:${cellY}`;
    const id=node.legacy?`auto:${node.p.x/8}:${node.p.y/8}:${sx}:${sy}`:`auto:${cell}:sub:${node.p.x}:${node.p.y}:${sx}:${sy}`;
    if(plan?.manualLighting.includes(cell)||plan?.suppressedBraziers.includes(id)||occupied.has(cell))continue;
    const x=wrapCoordinate(cellX-state.region.originCellX,world.widthCells),y=wrapCoordinate(cellY-state.region.originCellY,world.heightCells);
    if(x>=state.region.width||y>=state.region.height||state.region.terrainCodes[y*state.region.width+x]!==1)continue;
    if(surface.get(`${position.x*2}:${position.y*2}`)?.manual)continue;
    if(state.region.features.some(f=>f.cellX===cellX&&f.cellY===cellY&&f.deposit?.blocksCell!==false&&!f.deposit?.cleared&&f.deposit?.state!=='depleted'))continue;
    if(!result.some(e=>e.position.x===position.x&&e.position.y===position.y))result.push({id,position,cellX,cellY});
  }return result;
}

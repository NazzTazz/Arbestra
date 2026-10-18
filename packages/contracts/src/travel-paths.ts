import {canWalkSpawnSegment,type SpawnAccessField} from './spawn-access.js';
export type TravelGround=SpawnAccessField & {
 /** Identity of sample's heights, water, obstacles and trunks; must change whenever those answers change. World and dimensions are scoped separately. */
 revision:string;
 /** Present only when the field checks actual RC1 trunks. */
 woodedCells?:readonly TravelCell[];
};
import type { VillageState } from './villages.js';
import {buildingAccesses,type BuildingAccessState} from './building-access.js';
import {infrastructurePlanSurface,infrastructureBlockedPixels,infrastructureBarrierAt,pixelKey} from './infrastructure.js';

export interface TravelCell { cellX: number; cellY: number }

/** Geometry consumed by the common route planner, without an economic projection. */
export interface TravelNetworkState extends Omit<BuildingAccessState, 'cells'> {
  world: BuildingAccessState['world'] & Pick<VillageState['world'], 'id'>;
  village: Pick<VillageState['village'], 'anchorCellX' | 'anchorCellY' | 'townHallBuildingId'>;
  region: Pick<VillageState['region'], 'originCellX' | 'originCellY' | 'width' | 'height'> & {
    terrainCodes: readonly number[];
    features: ReadonlyArray<Pick<VillageState['region']['features'][number], 'id' | 'type' | 'cellX' | 'cellY'> & {
      deposit: Pick<NonNullable<VillageState['region']['features'][number]['deposit']>, 'state' | 'blocksCell' | 'cleared'> | null;
    }>;
  };
  cells: ReadonlyArray<Omit<BuildingAccessState['cells'][number], 'building'> & {
    building: (NonNullable<BuildingAccessState['cells'][number]['building']> & {
      garden?: { plots: readonly TravelCell[] } | null;
    }) | null;
  }>;
  infrastructure?: VillageState['infrastructure'];
}
export interface TravelRoute {
  version?:2;
  id: string;
  kind: 'building' | 'garden' | 'stone' | 'wood';
  destination: TravelCell;
  cells: TravelCell[];
}

const key = ({ cellX, cellY }: TravelCell): string => `${cellX}:${cellY}`;
const wrap = (value: number, size: number): number => ((value % size) + size) % size;
const delta = (value: number, origin: number, size: number): number => {
  const direct = value - origin;
  return direct > size / 2 ? direct - size : direct < -size / 2 ? direct + size : direct;
};

/** Expand long cardinal legs for the legacy, cell-based decorative topology. */
export function coarseTravelPath(path:readonly TravelCell[],world:{widthCells:number;heightCells:number}):TravelCell[]{
  const cells:TravelCell[]=[];
  for(const p of path){
    const next={cellX:wrap(Math.round(p.cellX),world.widthCells),cellY:wrap(Math.round(p.cellY),world.heightCells)},last=cells.at(-1);
    if(!last){cells.push(next);continue;}
    const dx=delta(next.cellX,last.cellX,world.widthCells),dy=delta(next.cellY,last.cellY,world.heightCells);
    if(dx&&dy){cells.push(next);continue;}
    for(let i=1;i<=Math.abs(dx)+Math.abs(dy);i++)cells.push({cellX:wrap(last.cellX+Math.sign(dx)*i,world.widthCells),cellY:wrap(last.cellY+Math.sign(dy)*i,world.heightCells)});
  }return cells;
}

interface Step { cell: TravelCell; cost: number; score: number; direction: number; steps: number; previous?: Step; via?:TravelCell[] }
const networkCache=new Map<string,TravelRoute[]>();
// Exact input aliases skip rasterization, but never outlive the authoritative result cache.
const networkAliases=new Map<string,string>();
const MAX_NETWORK_ALIASES=16,MAX_NETWORK_ALIAS_KEY_LENGTH=131072,MAX_NETWORK_ALIAS_STORAGE_LENGTH=2097152;
let networkAliasLength=0;
function removeNetworkAlias(input:string){
 const canonical=networkAliases.get(input);if(canonical===undefined)return;
 networkAliasLength-=input.length+canonical.length;networkAliases.delete(input);
}
function rememberNetworkAlias(input:string,canonical:string){
 if(input.length>MAX_NETWORK_ALIAS_KEY_LENGTH||input.length+canonical.length>MAX_NETWORK_ALIAS_STORAGE_LENGTH)return;
 removeNetworkAlias(input);networkAliases.set(input,canonical);networkAliasLength+=input.length+canonical.length;
 while(networkAliases.size>MAX_NETWORK_ALIASES||networkAliasLength>MAX_NETWORK_ALIAS_STORAGE_LENGTH)removeNetworkAlias(networkAliases.keys().next().value!);
}
const copyNetwork=(routes:readonly TravelRoute[])=>routes.map(route=>({...route,destination:{cellX:route.destination.cellX,cellY:route.destination.cellY},cells:route.cells.map(p=>({...p}))}));

class StepQueue {
  readonly #items: Step[] = [];
  get length(): number { return this.#items.length; }
  push(step: Step): void {
    const items = this.#items;
    let i = items.length;
    items.push(step);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent]!.score <= step.score) break;
      items[i] = items[parent]!;
      i = parent;
    }
    items[i] = step;
  }
  pop(): Step {
    const items = this.#items;
    const result = items[0]!;
    const last = items.pop()!;
    if (items.length) {
      let i = 0;
      while (i * 2 + 1 < items.length) {
        let child = i * 2 + 1;
        if (child + 1 < items.length && items[child + 1]!.score < items[child]!.score) child++;
        if (last.score <= items[child]!.score) break;
        items[i] = items[child]!;
        i = child;
      }
      items[i] = last;
    }
    return result;
  }
}

/** Deterministic cardinal route, with a bounded preference for shared tracks. */
/** Bounded geometric booleans only: four field revisions, 262144 segments in total. */
const passageCaches=new Map<string,Map<string|number,boolean>>();
const MAX_PASSAGE_CONTEXTS=4,MAX_PASSAGE_SEGMENTS=262144;
let passageSegments=0;
function passageInspector(ground:TravelGround|undefined,world:TravelNetworkState['world']){
 if(!ground)return ()=>true;
 const scope=JSON.stringify([world.id,world.widthCells,world.heightCells,ground.width,ground.height,ground.revision]);
 let cache=passageCaches.get(scope);
 if(cache){passageCaches.delete(scope);passageCaches.set(scope,cache);}
 else{
  cache=new Map();passageCaches.set(scope,cache);
  while(passageCaches.size>MAX_PASSAGE_CONTEXTS){const oldest=passageCaches.keys().next().value!;passageSegments-=passageCaches.get(oldest)!.size;passageCaches.delete(oldest);}
 }
 const segments=cache,w=world.widthCells*8,h=world.heightCells*8,numericSafe=Number.isSafeInteger(w)&&Number.isSafeInteger(h)&&Number.isSafeInteger(w*h*2);
 return (a:TravelCell,b:TravelCell)=>{
  let k:string|number|undefined;
  // Exact adjacent lattice edges have a unique directed start and axis, including
  // each toric seam. Door coordinates and longer segments retain their full text.
  const ax=a.cellX*8,ay=a.cellY*8,bx=b.cellX*8,by=b.cellY*8;
  if(numericSafe&&Number.isInteger(ax)&&Number.isInteger(ay)&&Number.isInteger(bx)&&Number.isInteger(by)
    &&ax>=0&&ax<w&&bx>=0&&bx<w&&ay>=0&&ay<h&&by>=0&&by<h){
   if(ay===by){if(bx===(ax+1)%w)k=(ay*w+ax)*2;else if(ax===(bx+1)%w)k=(by*w+bx)*2;}
   else if(ax===bx){if(by===(ay+1)%h)k=(ay*w+ax)*2+1;else if(ay===(by+1)%h)k=(by*w+bx)*2+1;}
  }
  if(k===undefined){const ak=key(a),bk=key(b);k=ak<bk?ak+'|'+bk:bk+'|'+ak;}
  const prior=segments.get(k);if(prior!==undefined)return prior;
  const allowed=canWalkSpawnSegment(ground,{x:a.cellX,y:a.cellY},{x:b.cellX,y:b.cellY});
  if(passageCaches.get(scope)===segments){
   while(passageSegments>=MAX_PASSAGE_SEGMENTS&&passageCaches.size>1){const oldest=passageCaches.keys().next().value!;if(oldest===scope)break;passageSegments-=passageCaches.get(oldest)!.size;passageCaches.delete(oldest);}
   if(passageSegments<MAX_PASSAGE_SEGMENTS){segments.set(k,allowed);passageSegments++;}
  }
  return allowed;
 };
}
function navigationGeometry(state:TravelNetworkState){
 const surface=infrastructurePlanSurface(state.infrastructure!,state.world);
 const curbPixels=infrastructureBlockedPixels(state.infrastructure!,state.world,state.cells.flatMap(c=>c.building?buildingAccesses(state,c.building.id):[]));
 return {surface,curbPixels};
}
export function buildTravelNetwork(state: TravelNetworkState, woodlandTargets: readonly string[] = [], ground?:TravelGround, checkpoint?:()=>void): TravelRoute[] {
  checkpoint?.();
  const { world, village, region } = state;
  // Snapshots change economic amounts without changing this spatial problem.
  // Cache only bounded, deterministic geometry; never retain an economic snapshot.
  const spatial=[ground?.revision,ground?.width,ground?.height,ground?.woodedCells?.map(key).sort(),world.id,world.widthCells,world.heightCells,village.anchorCellX,village.anchorCellY,village.townHallBuildingId,
    region.originCellX,region.originCellY,region.width,region.height,region.terrainCodes,
    [...region.features].sort((a,b)=>a.id.localeCompare(b.id)).map(f=>[f.id,f.type,f.cellX,f.cellY,f.deposit?.state,f.deposit?.blocksCell,f.deposit?.cleared]),
    state.cells.filter(c=>c.footprint||c.building).sort((a,b)=>a.cellX-b.cellX||a.cellY-b.cellY).map(c=>[c.cellX,c.cellY,c.footprint,c.building&&[c.building.id,c.building.type,c.building.quarterTurns,c.building.visualLayout,c.building.accesses,c.building.garden?.plots.map(p=>[p.cellX,p.cellY]).sort((a,b)=>a[0]!-b[0]!||a[1]!-b[1]!)]]),[...woodlandTargets].sort()];
  const input=JSON.stringify([spatial,state.infrastructure&&[state.infrastructure.roads,state.infrastructure.inheritedRoads,state.infrastructure.inheritedCells,[...state.infrastructure.equipment].sort((a,b)=>a.id.localeCompare(b.id)).map(e=>[e.id,e.x,e.y])]]);
  const alias=networkAliases.get(input),aliased=alias===undefined?undefined:networkCache.get(alias);
  if(alias!==undefined&&aliased){rememberNetworkAlias(input,alias);networkCache.delete(alias);networkCache.set(alias,aliased);return copyNetwork(aliased);}
  if(alias!==undefined)removeNetworkAlias(input);
  const geometry=state.infrastructure?navigationGeometry(state):undefined;
  const signature=JSON.stringify([spatial,geometry&&[[...geometry.surface.values()].filter(p=>p.manual).map(p=>[p.x,p.y]).sort((a,b)=>a[0]!-b[0]!||a[1]!-b[1]!),[...geometry.curbPixels].sort(),state.infrastructure!.equipment.map(e=>[e.x,e.y]).sort((a,b)=>a[0]!-b[0]!||a[1]!-b[1]!)]]);
  const cached=networkCache.get(signature);if(cached){rememberNetworkAlias(input,signature);networkCache.delete(signature);networkCache.set(signature,cached);return copyNetwork(cached);}
  const walk=passageInspector(ground,world);
  const hall = state.cells.find(c=>c.building && (village.townHallBuildingId ? c.building.id===village.townHallBuildingId : c.building.type==='town-hall'));
  const start = hall ? {cellX:hall.cellX,cellY:hall.cellY} : { cellX: village.anchorCellX, cellY: village.anchorCellY };
  const blocked = new Set(state.cells.filter((cell) => cell.footprint).map(key));
  for (const feature of region.features) {
    if (feature.type === 'woodland' && (ground?.woodedCells || feature.deposit?.blocksCell === false || feature.deposit?.cleared)) continue;
    if (feature.type !== 'stone_outcrop' || feature.deposit?.state !== 'depleted') blocked.add(key(feature));
  }
  const goals: Array<Pick<TravelRoute, 'id' | 'kind' | 'destination'>> = [];
  for (const cell of state.cells) {
    if (cell.building && cell.building.type !== 'town-hall') goals.push({
      id: cell.building.id, kind: 'building', destination: cell,
    });
    for (const plot of cell.building?.garden?.plots ?? []) goals.push({
      id: `${cell.building!.id}:${key(plot)}`, kind: 'garden', destination: plot,
    });
  }
  for (const feature of region.features) if ((feature.type === 'stone_outcrop' || feature.type === 'woodland' && woodlandTargets.includes(feature.id)) && feature.deposit?.state === 'available') {
    goals.push({ id: feature.id, kind: feature.type === 'woodland' ? 'wood' : 'stone', destination: feature });
  }
  goals.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const shared = new Set<string>();
  const routes: TravelRoute[] = [];
  const seeded=new Set<string>();
  const inside = (cell: TravelCell): boolean => {
    const x = wrap(cell.cellX - region.originCellX, world.widthCells);
    const y = wrap(cell.cellY - region.originCellY, world.heightCells);
    return x < region.width && y < region.height && region.terrainCodes[y * region.width + x] === 1;
  };
  const distance = (a: TravelCell, b: TravelCell): number =>
    Math.abs(delta(a.cellX, b.cellX, world.widthCells)) + Math.abs(delta(a.cellY, b.cellY, world.heightCells));
  for (const goal of goals) {
    checkpoint?.();
    if (!inside(goal.destination) && goal.kind !== 'stone') continue;
    const maxSteps = distance(start, goal.destination) + 8;
    const pending = new StepQueue();
    pending.push({ cell: start, cost: 0, score: distance(start, goal.destination) * 0.7, direction: -1, steps: 0 });
    const best = new Map<string, number>();
    let found: Step | undefined;
    while (pending.length) {
      checkpoint?.();
      const current = pending.pop();
      const currentKey = `${key(current.cell)}:${current.direction}`;
      if (current.cost > (best.get(currentKey) ?? Infinity)) continue;
      if (key(current.cell) === key(goal.destination)) { found = current; break; }
      if (current.steps >= maxSteps) continue;
      const neighbours = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      for (const [direction, [dx, dy]] of neighbours.entries()) {
        const cell = { cellX: wrap(current.cell.cellX + dx!, world.widthCells),
          cellY: wrap(current.cell.cellY + dy!, world.heightCells) };
        if ((!inside(cell) && key(cell) !== key(goal.destination)) || blocked.has(key(cell)) && key(cell) !== key(goal.destination)) continue;
        if(!walk(current.cell,cell))continue;
        const edge = [key(current.cell), key(cell)].sort().join('|');
        const cost = current.cost + (shared.has(edge) ? 0.7 : 1) + (current.direction >= 0 && current.direction !== direction ? 0.05 : 0);
        const stateKey = `${key(cell)}:${direction}`;
        if (cost >= (best.get(stateKey) ?? Infinity)) continue;
        best.set(stateKey, cost);
        pending.push({ cell, cost, score: cost + distance(cell, goal.destination) * 0.7, direction, steps: current.steps + 1, previous: current });
      }
    }
    if (!found) {
      // A coarse anchor can be enclosed by its own footprint, or a trunk can
      // block the cell-centre guide. The bounded door planner decides locally.
      if(state.infrastructure&&inside(goal.destination))
        {routes.push({...goal,cells:[start,goal.destination]});seeded.add(goal.id);}
      continue;
    }
    const cells: TravelCell[] = [];
    for (let cursor: Step | undefined = found; cursor; cursor = cursor.previous) cells.push(cursor.cell);
    cells.reverse();
    for (let i = 1; i < cells.length; i++) shared.add([key(cells[i - 1]!), key(cells[i]!)].sort().join('|'));
    routes.push({ ...goal, cells });
  }
  // Keep the common network as the guide for local access/obstacle refinement.
  // Previously every destination started a fresh, unrelated shortest-path search.
  const guide=new Set<string>();
  for(const route of routes)if(!seeded.has(route.id))for(const p of route.cells)guide.add(key(p));
  const refinement=state.infrastructure?prepareRefinement(state,ground,geometry,walk):undefined;
  const result=state.infrastructure?routes.flatMap(route=>{checkpoint?.();const refined=refineTravelRoute(state,route,guide,refinement,ground,checkpoint);return refined?[refined]:[];}):routes;
  if(result.reduce((n,r)=>n+r.cells.length,0)<=50_000){networkCache.set(signature,copyNetwork(result));
    while(networkCache.size>8||[...networkCache.values()].reduce((n,list)=>n+list.reduce((m,r)=>m+r.cells.length,0),0)>50_000)networkCache.delete(networkCache.keys().next().value!);rememberNetworkAlias(input,signature);}
  return copyNetwork(result);
}

export function travelDuration(path:readonly TravelCell[],world?:{widthCells:number;heightCells:number}):number{
  let length=0;const fine=path.some(p=>!Number.isInteger(p.cellX)||!Number.isInteger(p.cellY));
  for(let i=1;i<path.length;i++){
    const a=path[i-1]!,b=path[i]!;
    const dx=Math.abs(world?delta(b.cellX,a.cellX,world.widthCells):b.cellX-a.cellX),dy=Math.abs(world?delta(b.cellY,a.cellY,world.heightCells):b.cellY-a.cellY);
    // Without world dimensions only, retain the historical seam heuristic.
    length+=world?dx+dy:(dx>128?(fine?.125:1):dx)+(dy>128?(fine?.125:1):dy);
  }return Math.round(length*1000);
}

/** Bounded local refinement; distant routes retain their territorial legs. */
function prepareRefinement(state:TravelNetworkState,ground?:TravelGround,geometry?:ReturnType<typeof navigationGeometry>,walk=passageInspector(ground,state.world)){
 const {surface,curbPixels}=geometry??navigationGeometry(state),world=state.world;
 const roadNodes=[...surface.values()].filter(p=>p.manual&&p.x%2===0&&p.y%2===0).map(p=>({cellX:p.x/2,cellY:p.y/2}));
 const blocked=new Set(state.cells.filter(c=>c.footprint).map(key));
 for(const f of state.region.features)if(!(ground?.woodedCells&&f.type==='woodland')&&f.deposit?.blocksCell!==false&&!f.deposit?.cleared&&f.deposit?.state!=='depleted')blocked.add(key(f));
 const occupiedEquipment=state.infrastructure!.equipment;
 const fineCells=new Set<string>(ground?.woodedCells?.map(key));
 const markFine=(x:number,y:number)=>fineCells.add(wrap(Math.floor(x+.5),world.widthCells)+':'+wrap(Math.floor(y+.5),world.heightCells));
 for(const p of surface.values())if(p.manual)markFine((p.x+.5)/16,(p.y+.5)/16);
 for(const k of curbPixels){const [x,y]=k.split(':').map(Number);markFine((x!+.5)/16,(y!+.5)/16);}
 for(const e of occupiedEquipment)for(const dx of [-.25,0,.25])for(const dy of [-.25,0,.25])markFine(e.x/8+dx,e.y/8+dy);
 return {surface,curbPixels,roadNodes,walk,blocked,occupiedEquipment,fineCells};
}
export function refineTravelRoute(state:TravelNetworkState,route:TravelRoute,guide:ReadonlySet<string>=new Set(),prepared?:ReturnType<typeof prepareRefinement>,ground?:TravelGround,checkpoint?:()=>void):TravelRoute|null{
  if(!state.infrastructure||!route.cells.length)return route;
  const anchor=state.cells.find(c=>c.cellX===state.village.anchorCellX&&c.cellY===state.village.anchorCellY);
  const hallId=state.village.townHallBuildingId??anchor?.footprint?.buildingId??anchor?.building?.id;
  const hall=state.cells.find(c=>c.building?.id===hallId&&c.building?.type==='town-hall');if(!hall?.building)return route;
  const starts=buildingAccesses(state,hall.building.id),ends=route.kind==='building'?buildingAccesses(state,route.id):[];
  const world=state.world,w=world.widthCells*8,h=world.heightCells*8;
  const local=(p:TravelCell)=>wrap(p.cellX-state.region.originCellX,world.widthCells)<state.region.width&&wrap(p.cellY-state.region.originCellY,world.heightCells)<state.region.height;
  const lastLocal=route.cells.findLastIndex(local),destination=local(route.destination)?route.destination:route.cells[lastLocal];if(!destination)return route;
  const {surface,curbPixels,roadNodes,walk,blocked,occupiedEquipment,fineCells}=prepared??prepareRefinement(state,ground);
  // Shared obstacles and fine cells are immutable; only destination portals vary.
  const destinationFine=new Set<string>();
  const markFine=(x:number,y:number)=>destinationFine.add(wrap(Math.floor(x+.5),world.widthCells)+':'+wrap(Math.floor(y+.5),world.heightCells));
  for(const a of [...starts,...ends])markFine(a.outside.cellX,a.outside.cellY);
  markFine(destination.cellX,destination.cellY);
  const fine=(p:TravelCell)=>{const k=wrap(Math.floor(p.cellX/8+.5),world.widthCells)+':'+wrap(Math.floor(p.cellY/8+.5),world.heightCells);return fineCells.has(k)||destinationFine.has(k);};
  const land=(p:TravelCell,accessBuilding?:string)=>{
    const cx=wrap(Math.floor(p.cellX+.5),world.widthCells),cy=wrap(Math.floor(p.cellY+.5),world.heightCells);
    const xx=wrap(cx-state.region.originCellX,world.widthCells),yy=wrap(cy-state.region.originCellY,world.heightCells);
    return xx<state.region.width&&yy<state.region.height&&state.region.terrainCodes[yy*state.region.width+xx]===1
      &&(!blocked.has(`${cx}:${cy}`)||Boolean(accessBuilding&&state.cells.some(c=>c.cellX===cx&&c.cellY===cy&&c.footprint?.buildingId===accessBuilding))||cx===route.destination.cellX&&cy===route.destination.cellY&&route.kind!=='building')
      &&!infrastructureBarrierAt(curbPixels,p,world)
      &&!occupiedEquipment.some(e=>Math.abs(delta(e.x/8,p.cellX,world.widthCells))<.125&&Math.abs(delta(e.y/8,p.cellY,world.heightCells))<.125);
  };
  let best:TravelCell[]|null=null;
  // Door connections are part of the physical path too. Do not jump over an
  // obstacle between the threshold and the first fine-grid node.
  const accessClear=(access:typeof starts[number],buildingId:string)=>{
    const dx=delta(access.outside.cellX,access.position.cellX,world.widthCells),dy=delta(access.outside.cellY,access.position.cellY,world.heightCells);
    const steps=Math.max(1,Math.ceil((Math.abs(dx)+Math.abs(dy))*32));
    for(let i=0;i<=steps;i++)if(!land({cellX:wrap(access.position.cellX+dx*i/steps,world.widthCells),cellY:wrap(access.position.cellY+dy*i/steps,world.heightCells)},buildingId))return false;
    return walk(access.position,access.outside);
  };
  for(const start of starts)for(const end of ends.length?ends:[null]){
    if(!accessClear(start,hall.building.id)||end&&!accessClear(end,route.id))continue;
    const from={cellX:wrap(Math.round(start.outside.cellX*8),w),cellY:wrap(Math.round(start.outside.cellY*8),h)};
    const to={cellX:wrap(Math.round((end?.outside.cellX??destination.cellX)*8),w),cellY:wrap(Math.round((end?.outside.cellY??destination.cellY)*8),h)};
    if(!land({cellX:from.cellX/8,cellY:from.cellY/8})||!land({cellX:to.cellX/8,cellY:to.cellY/8}))continue;
    const distance=(a:TravelCell,b:TravelCell)=>Math.abs(delta(a.cellX,b.cellX,w))+Math.abs(delta(a.cellY,b.cellY,h));
    // An isolated painted fragment cannot justify a detour larger than its
    // entire possible discount. Exclude it from the heuristic, not from land.
    const budget=(roadNodes.length+guide.size*8)*.3,direct=distance(from,to);
    const roadNodeBudget=roadNodes.filter(p=>distance(from,p)+distance(p,to)-direct<=budget).length;
    const estimate=(cell:TravelCell)=>{const d=distance(cell,to);return d-.3*Math.min(d,roadNodeBudget+guide.size*8);};
    const neighbours=(p:TravelCell):TravelCell[][]=>{
      const options:TravelCell[][]=[];
      for(const [dx,dy]of [[1,0],[0,1],[-1,0],[0,-1]]){
        if(!fine(p)){
          const centre={cellX:wrap(p.cellX+dx!*8,w),cellY:wrap(p.cellY+dy!*8,h)};
          if(!fine(centre)){options.push([centre]);continue;}
          // Every usable point on the neighbouring face is a portal. The
          // first bend stays inside the unobstructed ordinary cell.
          for(let side=-3;side<=3;side++){
            const bend={cellX:wrap(p.cellX+dy!*side,w),cellY:wrap(p.cellY+dx!*side,h)};
            options.push([bend,{cellX:wrap(bend.cellX+dx!*5,w),cellY:wrap(bend.cellY+dy!*5,h)}]);
          }
        }else{
          const next={cellX:wrap(p.cellX+dx!,w),cellY:wrap(p.cellY+dy!,h)};
          if(fine(next)){options.push([next]);continue;}
          const centre={cellX:wrap(Math.floor(next.cellX/8+.5)*8,w),cellY:wrap(Math.floor(next.cellY/8+.5)*8,h)};
          const bend=dx?{cellX:centre.cellX,cellY:next.cellY}:{cellX:next.cellX,cellY:centre.cellY};
          options.push([next,bend,centre]);
        }
      }return options;
    };
    const pending=new StepQueue(),seen=new Map<string,number>();pending.push({cell:from,cost:0,score:estimate(from),direction:-1,steps:0});
    let found:Step|undefined,visited=0;
    while(pending.length&&visited++<65_536){checkpoint?.();const cur=pending.pop();if(cur.cost>(seen.get(key(cur.cell))??Infinity))continue;
      if(key(cur.cell)===key(to)){found=cur;break;}
      if(cur.steps+distance(cur.cell,to)>distance(from,to)+128)continue;
      for(const via of neighbours(cur.cell)){
        const cell=via.at(-1)!;let cost=cur.cost,steps=cur.steps,previous=cur.cell,valid=true;
        for(const end of via){
          const dx=delta(end.cellX,previous.cellX,w),dy=delta(end.cellY,previous.cellY,h),n=Math.abs(dx)+Math.abs(dy);
          for(let i=1;i<=n;i++){
            const node={cellX:wrap(previous.cellX+Math.sign(dx)*i,w),cellY:wrap(previous.cellY+Math.sign(dy)*i,h)},p={cellX:node.cellX/8,cellY:node.cellY/8};
            if(!local(p)||!land(p)||curbPixels.size&&infrastructureBarrierAt(curbPixels,{cellX:wrap(node.cellX-Math.sign(dx)/2,w)/8,cellY:wrap(node.cellY-Math.sign(dy)/2,h)/8},world)){valid=false;break;}
            if(!walk({cellX:wrap(node.cellX-Math.sign(dx),w)/8,cellY:wrap(node.cellY-Math.sign(dy),h)/8},p)){valid=false;break;}
            const manual=surface.get(pixelKey(wrap(node.cellX*2,world.widthCells*16),wrap(node.cellY*2,world.heightCells*16)))?.manual;
            const guided=guide.has(`${wrap(Math.round(p.cellX),world.widthCells)}:${wrap(Math.round(p.cellY),world.heightCells)}`);
            cost+=(manual||guided)? .7 : 1;steps++;
          }
          if(!valid)break;previous=end;
        }
        if(!valid||steps+distance(cell,to)>distance(from,to)+128||cost>=(seen.get(key(cell))??Infinity))continue;seen.set(key(cell),cost);
        pending.push({cell,via,cost,score:cost+estimate(cell)+distance(cell,to)*1e-7,direction:0,steps,previous:cur});
      }
    }
    if(!found)continue;
    const legs:TravelCell[][]=[];for(let c:Step|undefined=found;c;c=c.previous)legs.push(c.via??[c.cell]);
    const cells=legs.reverse().flat().map(p=>({cellX:p.cellX/8,cellY:p.cellY/8})).filter((p,i,list)=>!i||key(p)!==key(list[i-1]!));
    const path=[start.position,...cells,...(end?[end.position]:[]),...(!local(route.destination)?route.cells.slice(lastLocal+1):[])];
    if(!best||travelDuration(path,world)<travelDuration(best,world))best=path;
  }
  return best?{...route,cells:best,version:2}:null;
}

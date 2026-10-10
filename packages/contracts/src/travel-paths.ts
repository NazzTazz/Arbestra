import {canWalkSpawnSegment,type SpawnAccessField} from './spawn-access.js';
export type TravelGround=SpawnAccessField & {revision:string};
import type { VillageState } from './villages.js';
import {buildingAccesses} from './building-access.js';
import {infrastructurePlanSurface,infrastructureBlockedPixels,infrastructureBarrierAt,pixelKey} from './infrastructure.js';

export interface TravelCell { cellX: number; cellY: number }
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
/** Command-local immutable passage cache; no permission or dynamic snapshot is retained. */
function passageInspector(ground?:TravelGround){
 const cache=new Map<string,boolean>();
 return (a:TravelCell,b:TravelCell)=>{
  if(!ground)return true;
  const k=[key(a),key(b)].sort().join('|'),prior=cache.get(k);if(prior!==undefined)return prior;
  const allowed=canWalkSpawnSegment(ground,{x:a.cellX,y:a.cellY},{x:b.cellX,y:b.cellY});if(cache.size<262144)cache.set(k,allowed);return allowed;
 };
}
export function buildTravelNetwork(state: Pick<VillageState, 'world' | 'village' | 'region' | 'cells'|'infrastructure'>, woodlandTargets: readonly string[] = [], ground?:TravelGround): TravelRoute[] {
  const { world, village, region } = state;
  // Snapshots change economic amounts without changing this spatial problem.
  // Cache only bounded, deterministic geometry; never retain an economic snapshot.
  const signature=JSON.stringify([ground?.revision,world.id,world.widthCells,world.heightCells,village.anchorCellX,village.anchorCellY,village.townHallBuildingId,
    region.originCellX,region.originCellY,region.width,region.height,region.terrainCodes,
    [...region.features].sort((a,b)=>a.id.localeCompare(b.id)).map(f=>[f.id,f.type,f.cellX,f.cellY,f.deposit?.state,f.deposit?.blocksCell,f.deposit?.cleared]),
    state.cells.filter(c=>c.footprint||c.building).sort((a,b)=>a.cellX-b.cellX||a.cellY-b.cellY).map(c=>[c.cellX,c.cellY,c.footprint,c.building&&[c.building.id,c.building.type,c.building.quarterTurns,c.building.visualLayout,c.building.accesses,c.building.garden?.plots.map(p=>[p.cellX,p.cellY]).sort((a,b)=>a[0]!-b[0]!||a[1]!-b[1]!)]]),state.infrastructure&&[state.infrastructure.roads,state.infrastructure.inheritedRoads,state.infrastructure.inheritedCells,[...state.infrastructure.equipment].sort((a,b)=>a.id.localeCompare(b.id)).map(e=>[e.id,e.x,e.y])],[...woodlandTargets].sort()]);
  const cached=networkCache.get(signature);if(cached){networkCache.delete(signature);networkCache.set(signature,cached);return copyNetwork(cached);}
  const walk=passageInspector(ground);
  const start = { cellX: village.anchorCellX, cellY: village.anchorCellY };
  const blocked = new Set(state.cells.filter((cell) => cell.footprint).map(key));
  for (const feature of region.features) {
    if (feature.type === 'woodland' && (feature.deposit?.blocksCell === false || feature.deposit?.cleared)) continue;
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
  const inside = (cell: TravelCell): boolean => {
    const x = wrap(cell.cellX - region.originCellX, world.widthCells);
    const y = wrap(cell.cellY - region.originCellY, world.heightCells);
    return x < region.width && y < region.height && region.terrainCodes[y * region.width + x] === 1;
  };
  const distance = (a: TravelCell, b: TravelCell): number =>
    Math.abs(delta(a.cellX, b.cellX, world.widthCells)) + Math.abs(delta(a.cellY, b.cellY, world.heightCells));
  for (const goal of goals) {
    if (!inside(goal.destination) && goal.kind !== 'stone') continue;
    const maxSteps = distance(start, goal.destination) + 8;
    const pending = new StepQueue();
    pending.push({ cell: start, cost: 0, score: distance(start, goal.destination) * 0.7, direction: -1, steps: 0 });
    const best = new Map<string, number>();
    let found: Step | undefined;
    while (pending.length) {
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
    if (!found) continue;
    const cells: TravelCell[] = [];
    for (let cursor: Step | undefined = found; cursor; cursor = cursor.previous) cells.push(cursor.cell);
    cells.reverse();
    for (let i = 1; i < cells.length; i++) shared.add([key(cells[i - 1]!), key(cells[i]!)].sort().join('|'));
    routes.push({ ...goal, cells });
  }
  // Keep the common network as the guide for local access/obstacle refinement.
  // Previously every destination started a fresh, unrelated shortest-path search.
  const guide=new Set<string>();
  for(const route of routes)for(const p of route.cells)guide.add(key(p));
  const refinement=state.infrastructure?prepareRefinement(state,ground):undefined;
  const result=state.infrastructure?routes.flatMap(route=>{const refined=refineTravelRoute(state,route,guide,refinement,ground);return refined?[refined]:[];}):routes;
  if(result.reduce((n,r)=>n+r.cells.length,0)<=50_000){networkCache.set(signature,copyNetwork(result));
    while(networkCache.size>8||[...networkCache.values()].reduce((n,list)=>n+list.reduce((m,r)=>m+r.cells.length,0),0)>50_000)networkCache.delete(networkCache.keys().next().value!);}
  return result;
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
function prepareRefinement(state:Pick<VillageState,'world'|'village'|'region'|'cells'|'infrastructure'>,ground?:TravelGround){
  const surface=infrastructurePlanSurface(state.infrastructure!,state.world);
  const curbPixels=infrastructureBlockedPixels(state.infrastructure!,state.world,state.cells.flatMap(c=>c.building?buildingAccesses(state,c.building.id):[]));
  const roadNodes=[...surface.values()].filter(p=>p.manual&&p.x%2===0&&p.y%2===0).map(p=>({cellX:p.x/2,cellY:p.y/2}));
  return {surface,curbPixels,roadNodes,walk:passageInspector(ground)};
}
export function refineTravelRoute(state:Pick<VillageState,'world'|'village'|'region'|'cells'|'infrastructure'>,route:TravelRoute,guide:ReadonlySet<string>=new Set(),prepared?:ReturnType<typeof prepareRefinement>,ground?:TravelGround):TravelRoute|null{
  if(!state.infrastructure||!route.cells.length)return route;
  const anchor=state.cells.find(c=>c.cellX===state.village.anchorCellX&&c.cellY===state.village.anchorCellY);
  const hallId=state.village.townHallBuildingId??anchor?.footprint?.buildingId??anchor?.building?.id;
  const hall=state.cells.find(c=>c.building?.id===hallId&&c.building?.type==='town-hall');if(!hall?.building)return route;
  const starts=buildingAccesses(state,hall.building.id),ends=route.kind==='building'?buildingAccesses(state,route.id):[];
  const world=state.world,w=world.widthCells*8,h=world.heightCells*8;
  const local=(p:TravelCell)=>delta(p.cellX,state.village.anchorCellX,world.widthCells)>=-32&&delta(p.cellX,state.village.anchorCellX,world.widthCells)<32&&delta(p.cellY,state.village.anchorCellY,world.heightCells)>=-32&&delta(p.cellY,state.village.anchorCellY,world.heightCells)<32;
  const lastLocal=route.cells.findLastIndex(local),destination=local(route.destination)?route.destination:route.cells[lastLocal];if(!destination)return route;
  const {surface,curbPixels,roadNodes,walk}=prepared??prepareRefinement(state,ground);
  // A path cannot receive the road discount more often than there are road nodes.
  // Applying 0.7 to the entire remaining distance floods the fine grid when a
  // small edited portion lies far from the destination.
  const blocked=new Set(state.cells.filter(c=>c.footprint).map(key));
  for(const f of state.region.features)if(f.deposit?.blocksCell!==false&&!f.deposit?.cleared&&f.deposit?.state!=='depleted')blocked.add(key(f));
  const occupiedEquipment=state.infrastructure.equipment;
  // Ordinary cells have no sub-cell obstacle. Keep only their centre in the
  // search graph; portals connect it to the fine lattice near edited geometry.
  const fineCells=new Set<string>();
  const markFine=(x:number,y:number)=>fineCells.add(`${wrap(Math.floor(x+.5),world.widthCells)}:${wrap(Math.floor(y+.5),world.heightCells)}`);
  for(const p of surface.values())if(p.manual)markFine((p.x+.5)/16,(p.y+.5)/16);
  for(const k of curbPixels){const [x,y]=k.split(':').map(Number);markFine((x!+.5)/16,(y!+.5)/16);}
  for(const e of occupiedEquipment)for(const dx of [-.25,0,.25])for(const dy of [-.25,0,.25])markFine(e.x/8+dx,e.y/8+dy);
  for(const a of [...starts,...ends])markFine(a.outside.cellX,a.outside.cellY);
  markFine(destination.cellX,destination.cellY);
  const fine=(p:TravelCell)=>fineCells.has(`${wrap(Math.floor(p.cellX/8+.5),world.widthCells)}:${wrap(Math.floor(p.cellY/8+.5),world.heightCells)}`);
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
    while(pending.length&&visited++<65_536){const cur=pending.pop();if(cur.cost>(seen.get(key(cur.cell))??Infinity))continue;
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

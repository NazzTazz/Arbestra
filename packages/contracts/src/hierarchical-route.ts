import {canWalkSpawnSegment} from './spawn-access.js';
import {spawnDelta} from './spawn-map.js';
import {planRoute, routeLength, ROUTE_POLICY_VERSION, type RouteField, type RouteQuery, type RouteResult} from './route-planner.js';
import type {TravelCell} from './travel-paths.js';

export const HIERARCHICAL_ROUTE_VERSION = 'chunk-portals-1';
export interface ChunkCrossing {
  key: string;
  chunkX: number;
  chunkY: number;
  path: TravelCell[];
  cost: number;
  revalidate?: boolean;
}
export interface HierarchicalRouteStats {
  portals: number;
  localSearches: number;
  reusedCrossings: number;
  abstractNodes: number;
  fallback: boolean;
  routeRevalidated?: boolean;
  repairedSections?: number;
}
export interface HierarchicalRouteOutput {
  result: RouteResult;
  crossings: ChunkCrossing[];
  stats: HierarchicalRouteStats;
}
interface Node {point: TravelCell; chunkX: number; chunkY: number; key: string}
interface Edge {to: Node; path: TravelCell[]; cost: number; crossing?: ChunkCrossing}
interface Entry {node: Node; g: number; f: number; previous?: Entry; edge?: Edge; pending?: boolean}
const wrap = (x: number, size: number) => (x % size + size) % size;
const pointKey = (p: TravelCell) => `${p.cellX},${p.cellY}`;
const same = (a: TravelCell, b: TravelCell) => a.cellX === b.cellX && a.cellY === b.cellY;

/** A deterministic binary heap; stale entries are discarded against best costs. */
class Frontier {
  private entries: Entry[] = [];
  get size() {return this.entries.length;}
  push(entry: Entry) {
    let i = this.entries.length; this.entries.push(entry);
    while (i) {const parent = (i - 1) >> 1; if (!this.before(entry, this.entries[parent]!)) break;
      this.entries[i] = this.entries[parent]!; i = parent;}
    this.entries[i] = entry;
  }
  pop() {
    const first = this.entries[0]!, last = this.entries.pop()!;
    if (this.entries.length) {let i = 0;
      while (i * 2 + 1 < this.entries.length) {let child = i * 2 + 1;
        if (child + 1 < this.entries.length && this.before(this.entries[child + 1]!, this.entries[child]!)) child++;
        if (!this.before(this.entries[child]!, last)) break;
        this.entries[i] = this.entries[child]!; i = child;}
      this.entries[i] = last;}
    return first;
  }
  private before(a: Entry, b: Entry) {return a.f < b.f || (a.f === b.f && (a.g > b.g || (a.g === b.g && a.node.key < b.node.key)));}
}

/**
 * Two-level, lazy portal graph. Shared crossings never contain building exemptions.
 * Supplied crossings must already have been validated against persistent dependencies.
 * Failure of the abstraction is inconclusive and leaves budget for the fine solver.
 */
export function planHierarchicalRoute(field: RouteField, query: RouteQuery, chunkSize: number,
  reusable: readonly ChunkCrossing[] = [], now: () => number = () => performance.now()): HierarchicalRouteOutput {
  const began = now(), stats: HierarchicalRouteStats = {portals: 0, localSearches: 0, reusedCrossings: 0, abstractNodes: 0, fallback: false};
  let visited = 0;
  const output = (result: RouteResult, crossings: ChunkCrossing[] = []): HierarchicalRouteOutput => ({result, crossings, stats});
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || query.worldId !== field.worldId || query.contextId !== field.contextId
    || query.policyVersion !== ROUTE_POLICY_VERSION || query.movementProfileId !== 'pedestrian-v1' || query.traversalConstraintsId !== field.traversalConstraintsId)
    return output({kind: 'context-unavailable', visited});
  const deadline = began + query.limits.maxDurationMs;
  const remaining = () => ({maxNodes: Math.max(0, query.limits.maxNodes - visited), maxDurationMs: Math.max(0, deadline - now())});
  // Reserve half the request for an incomplete portal representation's fine fallback.
  const hierarchyDeadline = began + Math.min(query.limits.maxDurationMs / 2, query.hierarchy?.searchBudgetMs ?? Infinity);
  const exhausted = () => visited >= query.limits.maxNodes / 2 || now() >= hierarchyDeadline;
  const segments = new Map<string, boolean>();
  const walk = (a: TravelCell, b: TravelCell) => {
    const key = `${pointKey(a)}>${pointKey(b)}`, cached = segments.get(key);
    if (cached !== undefined) return cached;
    const valid = field.walk?.(a,b) ?? canWalkSpawnSegment(field, {x: a.cellX, y: a.cellY}, {x: b.cellX, y: b.cellY});
    if (segments.size < 65536) segments.set(key, valid);
    return valid;
  };
  const cost = (path: readonly TravelCell[]) => {
    if (!field.cost) return routeLength(path, field);
    let total = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!, b = path[i]!, dx = spawnDelta(b.cellX, a.cellX, field.width), dy = spawnDelta(b.cellY, a.cellY, field.height);
      const steps = Math.max(1, Math.ceil((Math.abs(dx) + Math.abs(dy)) * 8)); let previous = a;
      for (let j = 1; j <= steps; j++) {
        const p = {cellX: wrap(a.cellX + dx * j / steps, field.width), cellY: wrap(a.cellY + dy * j / steps, field.height)};
        total += field.cost(previous, p); previous = p;
      }
    }
    return total;
  };
  const node = (point: TravelCell): Node => ({point, chunkX: Math.floor(point.cellX / chunkSize), chunkY: Math.floor(point.cellY / chunkSize), key: pointKey(point)});
  const chunkKey = (n: Node) => `${n.chunkX}:${n.chunkY}`;
  const inChunk = (p: TravelCell, n: Node) => Math.floor(p.cellX / chunkSize) === n.chunkX && Math.floor(p.cellY / chunkSize) === n.chunkY;
  const resolve = (ends: RouteQuery['starts']) => ends.flatMap(end => {
    if (end.kind === 'access') {const access = field.accesses.find(a => a.id === end.accessId);
      return access && access.path.length && field.connector(access) ? [access.path] : [];}
    const p = {cellX: end.cellX, cellY: end.cellY};
    return Number.isFinite(p.cellX) && Number.isFinite(p.cellY) && p.cellX >= 0 && p.cellX < field.width && p.cellY >= 0 && p.cellY < field.height && walk(p, p) ? [[p]] : [];
  });
  const starts = resolve(query.starts), goals = resolve(query.goals);
  if (!starts.length || !goals.length) return output({kind: 'unreachable', reason: 'endpoints', visited});
  let previous=query.hierarchy?.previousPath?.map(p=>({...p}));
  if(previous?.length){
    const prefix=starts.find(p=>p.every((point,i)=>previous?.[i]&&same(point,previous[i]!)));
    const tail=goals.map(p=>[...p].reverse()).find(p=>p.every((point,i)=>previous?.[previous.length-p.length+i]&&same(point,previous[previous.length-p.length+i]!)));
    if(prefix&&tail)for(let attempt=0;attempt<4&&now()<deadline&&previous.length<=8192;attempt++){
      let blocked=-1;
      for(let i=prefix.length;i<=previous.length-tail.length;i++){
        if(now()>=deadline){blocked=i;break;}
        if(!walk(previous[i-1]!,previous[i]!)){blocked=i;break;}
      }
      if(blocked<0){
        stats.routeRevalidated=true;
        return output({kind:'found',contextId:query.contextId,policyVersion:query.policyVersion,movementProfileId:query.movementProfileId,
          traversalConstraintsId:query.traversalConstraintsId,path:previous,length:routeLength(previous,field),cost:cost(previous),visited});
      }
      if(attempt===3)break;
      const left=blocked-1;let right=blocked;
      while(right<previous.length-tail.length&&!walk(previous[right]!,previous[right]!))right++;
      if(!walk(previous[left]!,previous[left]!)||!walk(previous[right]!,previous[right]!))break;
      const limits=remaining();
      const repair=planRoute(field,{...query,starts:[{kind:'point',...previous[left]!}],goals:[{kind:'point',...previous[right]!}],
        limits:{maxNodes:Math.min(32768,limits.maxNodes),maxDurationMs:Math.min(500,limits.maxDurationMs)}},now);
      visited+=repair.visited;if(repair.kind!=='found')break;
      previous=[...previous.slice(0,left),...repair.path,...previous.slice(right+1)];
      stats.repairedSections=(stats.repairedSections??0)+1;
    }
  }
  const goalNodes = goals.map(path => ({node: node(path.at(-1)!), tail: [...path].reverse()}));
  const heuristic = (p: TravelCell) => (field.minimumCost ?? (field.cost ? 0 : 1)) * Math.min(...goalNodes.map(g =>
    Math.abs(spawnDelta(g.node.point.cellX, p.cellX, field.width)) + Math.abs(spawnDelta(g.node.point.cellY, p.cellY, field.height))));
  const boundaries = new Map<string, Edge[]>(), portalNodes = new Map<string, Map<string, Node>>();
  const addPortal = (n: Node) => {const key = chunkKey(n), nodes = portalNodes.get(key) ?? new Map<string, Node>(); nodes.set(n.key, n); portalNodes.set(key, nodes);};
  const boundary = (axis: 'x' | 'y', coordinate: number, from: number, to: number): Edge[] => {
    const key = `${axis}:${coordinate}:${from}:${to}`, cached = boundaries.get(key); if (cached) return cached;
    const edges: Edge[] = [], runs: Array<Array<[TravelCell, TravelCell]>> = []; let run: Array<[TravelCell, TravelCell]> = [];
    for (let at = from; at < to; at += 1 / 8) {
      if (exhausted()) break;
      const a = axis === 'x' ? {cellX: wrap(coordinate - 1 / 8, field.width), cellY: at} : {cellX: at, cellY: wrap(coordinate - 1 / 8, field.height)};
      const b = axis === 'x' ? {cellX: wrap(coordinate, field.width), cellY: at} : {cellX: at, cellY: wrap(coordinate, field.height)};
      visited++;
      if (walk(a, b)) run.push([a, b]); else if (run.length) {runs.push(run); run = [];}
    }
    if (run.length) runs.push(run);
    for (const passage of runs) {
     const centred=passage.map((pair,index)=>({pair,index})).filter(({pair})=>Number.isInteger(axis==='x'?pair[0].cellY:pair[0].cellX));
     const indices=centred.length?[centred[0]!.index,centred[Math.floor((centred.length-1)/2)]!.index,centred.at(-1)!.index]:[0,Math.floor((passage.length-1)/2),passage.length-1];
     for (const index of new Set(indices)) {
      let a = passage[index]![0];
      const b = passage[index]![1];
      const inner=axis==='x'?{cellX:wrap(coordinate-1,field.width),cellY:a.cellY}:{cellX:a.cellX,cellY:wrap(coordinate-1,field.height)};
      if(walk(inner,b))a=inner;
      const na = node(a), nb = node(b); addPortal(na); addPortal(nb);
      edges.push({to: nb, path: [a, b], cost: cost([a, b])}, {to: na, path: [b, a], cost: cost([b, a])}); stats.portals++;
     }
    }
    boundaries.set(key, edges); return edges;
  };
  const portals = (n: Node) => {
    const x0 = n.chunkX * chunkSize, y0 = n.chunkY * chunkSize, x1 = Math.min(field.width, x0 + chunkSize), y1 = Math.min(field.height, y0 + chunkSize);
    const edges = [boundary('x', x0, y0, y1), boundary('x', x1 === field.width ? 0 : x1, y0, y1),
      boundary('y', y0, x0, x1), boundary('y', y1 === field.height ? 0 : y1, x0, x1)].flat();
    return {nodes: [...(portalNodes.get(chunkKey(n))?.values() ?? [])], edges: edges.filter(e => same(e.path[0]!, n.point))};
  };
  const cache = new Map<string, ChunkCrossing>(), created = new Map<string, ChunkCrossing>(), failed = new Set<string>();
  for (const crossing of reusable) if (!cache.has(crossing.key)) cache.set(crossing.key, crossing);
  const trees = new Map<string, Map<string, Entry>>();
  const centreLinks = (p: TravelCell, owner: Node) => {
    const links: TravelCell[][] = [];
    for (const x of new Set([Math.floor(p.cellX), Math.ceil(p.cellX)])) for (const y of new Set([Math.floor(p.cellY), Math.ceil(p.cellY)])) {
      const end = {cellX: wrap(x, field.width), cellY: wrap(y, field.height)};
      if (!inChunk(end, owner)) continue;
      for (const bend of [{cellX: p.cellX, cellY: end.cellY}, {cellX: end.cellX, cellY: p.cellY}])
        if (inChunk(bend, owner) && walk(p, bend) && walk(bend, end)) links.push([p, bend, end]);
    }
    return links;
  };
  // One bounded Dijkstra tree answers every portal destination from this entry.
  // A coarse miss remains inconclusive; the global fine fallback remains available.
  const localTree = (origin: Node) => {
    const saved = trees.get(origin.key); if (saved) return saved;
    stats.localSearches++;
    const queue = new Frontier(), entries = new Map<string, Entry>(), closed = new Set<string>();
    const until = Math.min(hierarchyDeadline, now() + 150);
    for (const path of centreLinks(origin.point, origin)) {
      const target = node(path.at(-1)!), g = cost(path);
      if (g >= (entries.get(target.key)?.g ?? Infinity)) continue;
      const entry: Entry = {node: target, g, f: g, edge: {to: target, path, cost: g}};
      entries.set(target.key, entry); queue.push(entry);
    }
    while (queue.size && !exhausted() && now() < until) {
      const current = queue.pop(); if (closed.has(current.node.key) || entries.get(current.node.key) !== current) continue;
      closed.add(current.node.key); visited++;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
        const p = {cellX: wrap(current.node.point.cellX + dx, field.width), cellY: wrap(current.node.point.cellY + dy, field.height)};
        if (!inChunk(p, origin)) continue;
        const target = node(p); if (closed.has(target.key) || !walk(current.node.point, p)) continue;
        const path = [current.node.point, p], edgeCost = cost(path), g = current.g + edgeCost;
        if (g >= (entries.get(target.key)?.g ?? Infinity)) continue;
        const entry: Entry = {node: target, g, f: g, previous: current, edge: {to: target, path, cost: edgeCost}};
        entries.set(target.key, entry); queue.push(entry);
      }
    }
    trees.set(origin.key, entries); return entries;
  };
  const throughTree = (a: Node, b: Node): TravelCell[] | undefined => {
    const tree = localTree(a); let bestEntry: Entry | undefined, bestTail: TravelCell[] = [], bestCost = Infinity;
    for (const link of centreLinks(b.point, b)) {
      const entry = tree.get(pointKey(link.at(-1)!)); if (!entry) continue;
      const tail = [...link].reverse(), total = entry.g + cost(tail);
      if (total < bestCost) {bestCost = total; bestEntry = entry; bestTail = tail;}
    }
    if (!bestEntry) return;
    const parts = [bestTail];
    for (let entry: Entry | undefined = bestEntry; entry; entry = entry.previous) if (entry.edge) parts.push(entry.edge.path);
    return parts.reverse().flat().filter((p, i, all) => !i || !same(p, all[i - 1]!));
  };
  const local = (a: Node, b: Node): Edge | undefined => {
    if (same(a.point, b.point)) return {to: b, path: [a.point], cost: 0};
    const key = `${chunkKey(a)}:${a.key}>${b.key}`, saved = cache.get(key);
    if (failed.has(key)) return;
    if (saved?.path.length && same(saved.path[0]!, a.point) && same(saved.path.at(-1)!, b.point)) {
      if (!saved.revalidate || saved.path.slice(1).every((p, i) => walk(saved.path[i]!, p))) {
        const current = saved.revalidate ? {...saved, cost: cost(saved.path), revalidate: false} : saved;
        if (saved.revalidate) {created.set(key, current); cache.set(key, current);}
        stats.reusedCrossings++; return {to: b, path: current.path, cost: current.cost, crossing: current};
      }
      cache.delete(key);
    }
    if (exhausted()) return;
    let path: TravelCell[] | undefined;
    // Certify both cardinal bends; avoid a local search for an open chunk.
    const bends = [{cellX: a.point.cellX, cellY: b.point.cellY}, {cellX: b.point.cellX, cellY: a.point.cellY}];
    for (const bend of bends) {
      // A short toroidal segment may leave this chunk; do not hide that crossing.
      const candidate = [a.point, bend, b.point];
      const stays = candidate.slice(1).every((p, i) => Math.abs(p.cellX - candidate[i]!.cellX) <= field.width / 2 && Math.abs(p.cellY - candidate[i]!.cellY) <= field.height / 2);
      if (stays && inChunk(bend, a) && walk(a.point, bend) && walk(bend, b.point) && (!path || cost(candidate) < cost(path))) path = candidate;
    }
    if (!path) path = throughTree(a, b);
    if (!path) {failed.add(key); return;}
    path = path.filter((p, i) => !i || !same(p, path![i - 1]!));
    const crossing: ChunkCrossing = {key, chunkX: a.chunkX, chunkY: a.chunkY, path, cost: cost(path)};
    cache.set(key, crossing); created.set(key, crossing);
    return {to: b, path, cost: crossing.cost, crossing};
  };
  const frontier = new Frontier(), best = new Map<string, number>();
  const enqueueLocal = (from: Entry, to: Node) => {
    if (same(from.node.point, to.point)) return;
    const lower = (field.minimumCost ?? (field.cost ? 0 : 1)) * routeLength([from.node.point, to.point], field), g = from.g + lower;
    if (g >= (best.get(to.key) ?? Infinity)) return;
    frontier.push({node: to, g, f: g + heuristic(to.point), previous: from, pending: true});
  };
  for (const prefix of starts) {const n = node(prefix.at(-1)!), g = cost(prefix);
    if (g >= (best.get(n.key) ?? Infinity)) continue;
    best.set(n.key, g); frontier.push({node: n, g, f: g + heuristic(n.point), edge: {to: n, path: prefix, cost: g}});
  }
  let winner: Entry | undefined, winningTail: TravelCell[] = [], winningCost = Infinity;
  while (frontier.size && !exhausted()) {
    const current = frontier.pop();
    if (current.f >= winningCost) break;
    if (current.pending) {
      if (current.g >= (best.get(current.node.key) ?? Infinity)) continue;
      const edge = local(current.previous!.node, current.node); if (!edge) continue;
      const g = current.previous!.g + edge.cost;
      if (g >= (best.get(current.node.key) ?? Infinity)) continue;
      best.set(current.node.key, g);
      frontier.push({node: current.node, g, f: g + heuristic(current.node.point), previous: current.previous!, edge});
      continue;
    }
    if (current.g !== best.get(current.node.key)) continue;
    stats.abstractNodes++; visited++;
    for (const goal of goalNodes) if (chunkKey(current.node) === chunkKey(goal.node)) {
      if (!same(current.node.point, goal.node.point)) {enqueueLocal(current, goal.node); continue;}
      const total = current.g + cost(goal.tail);
      if (total < winningCost) {winningCost = total; winner = current; winningTail = goal.tail;}
    }
    const exits = portals(current.node), edges = [...exits.edges];
    for (const target of exits.nodes) enqueueLocal(current, target);
    for (const edge of edges) {const g = current.g + edge.cost;
      if (g >= (best.get(edge.to.key) ?? Infinity)) continue;
      best.set(edge.to.key, g); frontier.push({node: edge.to, g, f: g + heuristic(edge.to.point), previous: current, edge});}
  }
  if (winner) {
    const parts: TravelCell[][] = [winningTail];
    for (let entry: Entry | undefined = winner; entry; entry = entry.previous) if (entry.edge) parts.push(entry.edge.path);
    const path = parts.reverse().flat().filter((p, i, all) => !i || !same(p, all[i - 1]!));
    if (path.length > 8192) return output({kind: 'budget-exceeded', visited});
    return output({kind: 'found', contextId: query.contextId, policyVersion: query.policyVersion, movementProfileId: query.movementProfileId,
      traversalConstraintsId: query.traversalConstraintsId, path, length: routeLength(path, field), cost: cost(path), visited}, [...created.values()]);
  }
  stats.fallback = true;
  const result = planRoute(field, {...query, limits: remaining()}, now);
  return output({...result, visited: visited + result.visited}, [...created.values()]);
}

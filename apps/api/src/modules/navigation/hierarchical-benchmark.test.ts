import {readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {it, expect} from 'vitest';
import {canWalkSpawnSegment, createSpawnTerrainField, editedRc1Field, woodlandPassage, planRoute, planHierarchicalRoute, ChunkNavigationCache,
  ROUTE_POLICY_VERSION, type GeneratedLandscape, type RouteField, type RouteQuery, type ChunkCrossing} from '@arbestra/contracts';

/** Explicit opt-in: reproducible CPU corpus, no dev/production DB and no game mutation. */
it.skipIf(process.env.NAVIGATION_BENCHMARK !== '1')('compares thirty RC1 pairs with the same physical field and budget', async () => {
  const source=readFileSync(new URL('../../../../world-web/public/studies/t1-alpha512-rc1.json', import.meta.url), 'utf8');
  const data = JSON.parse(source) as GeneratedLandscape,checksum=createHash('sha256').update(source).digest('hex');
  const base = createSpawnTerrainField(data), terrain = editedRc1Field(data, base, [], []);
  const trunks = woodlandPassage((data.forest?.trees ?? []).map(t => ({x: t.x, y: t.y, scale: t.crown * t.size, heightScale: t.size, rotation: 0})), {widthCells: data.width, heightCells: data.height});
  const samples=new Map<string,{elevation:number;dry:boolean;blocked:boolean}>();
  const field: RouteField = {worldId: 'benchmark', contextId: 'fixed', traversalConstraintsId: 'none', width: data.width, height: data.height, accesses: [], connector: () => false,
    sample(x, y) {
      const key=x+':'+y,cached=samples.get(key);if(cached)return cached;
      const s = terrain.sample(x, y),value={elevation: s.elevation, dry: s.elevation > Math.max(0, s.surface) + 1e-6,
        blocked: terrain.intersectsRock({x, y, halfWidth: 0, halfHeight: 0}) || trunks.blocked(x, y)};
      if(samples.size>=32768)samples.clear();samples.set(key,value);return value;
    }};
  const points: Array<{cellX: number; cellY: number}> = [];
  for (let y = 20; y < data.height; y += 28) for (let x = 20; x < data.width; x += 28)
    if (canWalkSpawnSegment(field, {x, y}, {x, y}) && canWalkSpawnSegment(field, {x, y}, {x: x + .5, y})) points.push({cellX: x, cellY: y});
  expect(points.length).toBeGreaterThan(30);
  const crossings: ChunkCrossing[] = [], rows: Array<Record<string, unknown>> = [];
  const measurements: Record<string, number[]> = {old: [], cold: [], reused: [], repair: []};
  mkdirSync('test-results/navigation', {recursive: true});
  const cachePath='test-results/navigation/rc1-prepared-meshes.json';
  const saved=existsSync(cachePath)?JSON.parse(readFileSync(cachePath,'utf8')) as {checksum:string;meshes:ReturnType<ChunkNavigationCache['changed']>;preparationMs:number}:undefined;
  const prepareStart=performance.now(),prepared=new ChunkNavigationCache(field,32,saved?.checksum===checksum?saved.meshes:[]);
  if(saved?.checksum!==checksum)for(let y=0;y<data.height;y++){
    for(let x=0;x<data.width;x++)for(const [dx,dy]of [[1,0],[0,1],[-1,0],[0,-1]] as const)
      prepared.walk({cellX:x,cellY:y},{cellX:(x+dx+data.width)%data.width,cellY:(y+dy+data.height)%data.height});
    if(y%16===0){console.info(JSON.stringify({preparingRow:y}));await new Promise<void>(resolve=>setImmediate(resolve));}
  }
  const preparedMeshes=saved?.checksum===checksum?saved.meshes:prepared.changed(),preparationMs=saved?.checksum===checksum?saved.preparationMs:performance.now()-prepareStart;
  writeFileSync(cachePath,JSON.stringify({checksum,meshes:preparedMeshes,preparationMs}));
  const count=Math.max(1,Math.min(30,Number(process.env.NAVIGATION_BENCHMARK_PAIRS??30)));
  for (let i = 0; i < count; i++) {
    const start = points[i]!, goal = points[(i + 7 + i % 11) % points.length]!;
    const q: RouteQuery = {worldId: field.worldId, contextId: field.contextId, policyVersion: ROUTE_POLICY_VERSION,
      movementProfileId: 'pedestrian-v1', traversalConstraintsId: 'none', starts: [{kind: 'point', ...start}], goals: [{kind: 'point', ...goal}],
      coarseFirst: true, limits: {maxNodes: 262144, maxDurationMs: 5000}};
    samples.clear();const began = performance.now(), old = planRoute(field, q); measurements.old!.push(performance.now() - began);
    samples.clear();const coldStart = performance.now(),coldMesh=new ChunkNavigationCache(field,32);
    const cold = planHierarchicalRoute({...field,walk:coldMesh.walk}, {...q,hierarchy:{chunkSize:32,crossings:[],searchBudgetMs:0}}, 32); measurements.cold!.push(performance.now() - coldStart);
    samples.clear();const warmStart = performance.now(),warmMesh=new ChunkNavigationCache(field,32,preparedMeshes);
    const reused = planHierarchicalRoute({...field,walk:warmMesh.walk}, {...q,hierarchy:{chunkSize:32,crossings,searchBudgetMs:250}}, 32, crossings); measurements.reused!.push(performance.now() - warmStart);
    samples.clear();const repairStart = performance.now(),repairMesh=new ChunkNavigationCache(field,32,preparedMeshes.filter(m=>m.chunkX!==Math.floor(start.cellX/32)||m.chunkY!==Math.floor(start.cellY/32)));
    const repair = planHierarchicalRoute({...field,walk:repairMesh.walk}, {...q,hierarchy:{chunkSize:32,crossings,searchBudgetMs:250,
      ...(reused.result.kind==='found'?{previousPath:reused.result.path}:{})}}, 32, cold.crossings.map(c => ({...c, revalidate: c.chunkX === Math.floor(start.cellX / 32)})));
    measurements.repair!.push(performance.now() - repairStart);
    crossings.unshift(...cold.crossings); crossings.splice(2048);
    rows.push({start, goal, old: old.kind, cold: cold.result.kind, reused: reused.result.kind, repair: repair.result.kind,
      oldLength: old.kind === 'found' ? old.length : null, length: cold.result.kind === 'found' ? cold.result.length : null,
      stats: cold.stats,reusedStats:reused.stats,repairStats:repair.stats, times: Object.fromEntries(Object.entries(measurements).map(([k, v]) => [k, v.at(-1)]))});
    const summary = Object.fromEntries(Object.entries(measurements).map(([k, v]) => {const sorted = [...v].sort((a, b) => a - b);
      return [k, {median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1)}];}));
    writeFileSync('test-results/navigation/rc1-corpus.json', JSON.stringify({budgetMs: 5000, preparationMs,meshBytes:preparedMeshes.reduce((n,m)=>n+m.cells.length,0),source: 'unmodified RC1 substrate', rows, summary, rss: process.memoryUsage().rss}, null, 2));
    console.info(JSON.stringify({pair: i + 1, old: old.kind, hierarchical: cold.result.kind, ms: measurements.cold!.at(-1)}));
    for(const result of [cold.result,reused.result,repair.result])if(result.kind==='found')for(let j=1;j<result.path.length;j++)expect(canWalkSpawnSegment(field,
      {x:result.path[j-1]!.cellX,y:result.path[j-1]!.cellY},{x:result.path[j]!.cellX,y:result.path[j]!.cellY})).toBe(true);
    await new Promise<void>(resolve=>setImmediate(resolve));
  }
  expect(rows).toHaveLength(count);
}, 900000);

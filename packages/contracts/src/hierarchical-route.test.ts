import {expect, it} from 'vitest';
import {planHierarchicalRoute} from './hierarchical-route.js';
import {ROUTE_POLICY_VERSION, routeLength, type RouteField, type RouteQuery} from './route-planner.js';
import {canWalkSpawnSegment} from './spawn-access.js';

const field = (width = 96, height = 64): RouteField => ({worldId: 'world', contextId: 'revision', traversalConstraintsId: 'none',
  width, height, accesses: [], connector: () => true, sample: () => ({elevation: 1, dry: true, blocked: false})});
const query = (x: number, y: number, gx: number, gy: number): RouteQuery => ({worldId: 'world', contextId: 'revision',
  policyVersion: ROUTE_POLICY_VERSION, movementProfileId: 'pedestrian-v1', traversalConstraintsId: 'none',
  starts: [{kind: 'point', cellX: x, cellY: y}], goals: [{kind: 'point', cellX: gx, cellY: gy}],
  coarseFirst: true, limits: {maxNodes: 262144, maxDurationMs: 5000}});

it.each([[2, 2, 94, 62, 96, 64], [2, 5, 40, 5, 96, 64], [68, 34, 1, 1, 70, 35]])(
  'certifies the periodic route (%s,%s) → (%s,%s), including partial chunks', (x, y, gx, gy, width, height) => {
    const f = field(width, height), q = query(x, y, gx, gy), out = planHierarchicalRoute(f, q, 16);
    expect(out.result.kind).toBe('found'); if (out.result.kind !== 'found') return;
    const path = out.result.path;
    expect(path[0]).toEqual({cellX: x, cellY: y}); expect(path.at(-1)).toEqual({cellX: gx, cellY: gy});
    expect(out.result.length).toBe(routeLength(path, f));
    for (let i = 1; i < path.length; i++) expect(canWalkSpawnSegment(f, {x: path[i - 1]!.cellX, y: path[i - 1]!.cellY}, {x: path[i]!.cellX, y: path[i]!.cellY})).toBe(true);
    expect(out.stats.fallback).toBe(false);
  });

it('reuses certified crossings without rebuilding their local paths', () => {
  const f = field(), q = query(2, 5, 40, 5), first = planHierarchicalRoute(f, q, 16);
  expect(first.crossings.length).toBeGreaterThan(0);
  const second = planHierarchicalRoute(f, q, 16, first.crossings);
  expect(second.result.kind).toBe('found'); expect(second.stats.reusedCrossings).toBeGreaterThan(0);
  if (first.result.kind === 'found' && second.result.kind === 'found') expect(second.result.path).toEqual(first.result.path);
});

it('keeps a failed or exhausted hierarchy inconclusive and respects its total node budget', () => {
  const f = field(); f.sample = () => ({elevation: 1, dry: true, blocked: true});
  expect(planHierarchicalRoute(f, query(2, 2, 40, 5), 16).result).toMatchObject({kind: 'unreachable', reason: 'endpoints'});
  const q = query(2, 2, 40, 5); q.limits.maxNodes = 32;
  const limited = planHierarchicalRoute(field(), q, 16);
  expect(limited.result.visited).toBeLessThanOrEqual(32);
  expect(limited.result.kind).not.toBe('unreachable');
});

it('does not route through another world or accept an invalid partition', () => {
  const q = query(2, 2, 40, 5);
  expect(planHierarchicalRoute({...field(), worldId: 'other'}, q, 16).result.kind).toBe('context-unavailable');
  expect(planHierarchicalRoute(field(), q, 0).result.kind).toBe('context-unavailable');
});

it('recertifies stale crossings and repairs a blocked local witness without crossing the obstacle', () => {
  const f = field(), q = query(2, 5, 14, 5), first = planHierarchicalRoute(f, q, 16);
  const stale = first.crossings.map(c => ({...c, revalidate: true}));
  const unchanged = planHierarchicalRoute(f, q, 16, stale);
  expect(unchanged.stats.reusedCrossings).toBeGreaterThan(0);
  const changed = {...f, sample: (x: number, y: number) => ({elevation: 1, dry: true, blocked: x > 7.5 && x < 8.5 && y > 3 && y < 7})};
  const repaired = planHierarchicalRoute(changed, q, 16, stale);
  expect(repaired.result.kind).toBe('found');
  if (repaired.result.kind !== 'found') return;
  for (let i = 1; i < repaired.result.path.length; i++) expect(canWalkSpawnSegment(changed,
    {x: repaired.result.path[i - 1]!.cellX, y: repaired.result.path[i - 1]!.cellY},
    {x: repaired.result.path[i]!.cellX, y: repaired.result.path[i]!.cellY})).toBe(true);
  expect(repaired.result.length).toBeGreaterThan(12);
});

it('repairs the blocked section of a stored route while preserving its prefix and suffix',()=>{
  const previousPath=Array.from({length:39},(_,i)=>({cellX:i+2,cellY:5}));
  const q={...query(2,5,40,5),hierarchy:{chunkSize:16,crossings:[],previousPath,searchBudgetMs:0}};
  const clear=planHierarchicalRoute(field(),q,16);
  expect(clear.stats.routeRevalidated).toBe(true);expect(clear.stats.abstractNodes).toBe(0);
  const f={...field(),sample:(x:number,y:number)=>({elevation:1,dry:true,blocked:x>20.5&&x<21.5&&y>3&&y<7})};
  const repaired=planHierarchicalRoute(f,q,16);
  expect(repaired.result.kind).toBe('found');expect(repaired.stats.routeRevalidated).toBe(true);expect(repaired.stats.repairedSections).toBe(1);
  if(repaired.result.kind!=='found')return;
  expect(repaired.result.path.slice(0,10)).toEqual(previousPath.slice(0,10));expect(repaired.result.path.slice(-10)).toEqual(previousPath.slice(-10));
  for(let i=1;i<repaired.result.path.length;i++)expect(canWalkSpawnSegment(f,{x:repaired.result.path[i-1]!.cellX,y:repaired.result.path[i-1]!.cellY},{x:repaired.result.path[i]!.cellX,y:repaired.result.path[i]!.cellY})).toBe(true);
});

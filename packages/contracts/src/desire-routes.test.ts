import { describe, expect, it } from 'vitest';
import { automaticBraziers } from './automatic-braziers.js';
import { desireCellsFromEdges, desireRoutes, DESIRE_ROUTE_PREFIX, type DesireCell } from './desire-routes.js';
import {
  automaticRoadStrokes,
  createInfrastructureEditContext,
  emptyInfrastructure,
  type RoadStroke,
} from './infrastructure.js';
import { desireChunkDrift, desireScopeKeys } from './sync-v2-desire.js';
import { desirePathsFromSyncV2, desireRoutesFromSyncV2, villageStateFromSyncV2 } from './sync-v2-village-state.js';
import type { SyncV2Scope, SyncV2State } from './sync-v2.js';
import { desireEdges, type TravelCell, type TravelRoute } from './travel-paths.js';
import type { ResolvedVillagePresentation } from './village-presentation.js';
import type { VillageState } from './villages.js';

const world = { widthCells: 64, heightCells: 64 };
const route = (id: string, kind: TravelRoute['kind'], cells: TravelCell[]): TravelRoute => ({
  id,
  kind,
  destination: cells.at(-1)!,
  cells,
});
const at = (cellX: number, cellY: number): TravelCell => ({ cellX, cellY });

/** Routes of every shape the network makes: sparse legs, overlaps and reversals, a T junction, both
 * seams, fine eighths, a diagonal jump, a leg into an occupied cell. */
function fixtureRoutes(): TravelRoute[] {
  const fine: TravelCell[] = [];
  for (let i = 0; i <= 8; i++) fine.push(at(40 + i / 8, 40));
  fine.push(at(41, 40.5), at(41, 41), at(41, 42.25));
  return [
    route('building:house', 'building', [at(10, 10), at(10, 12), at(12, 12)]),
    route('wood:east', 'wood', [at(10, 10), at(20, 10), at(20, 16)]),
    route('garden:branch', 'garden', [at(10, 10), at(15, 10), at(15, 20)]),
    // The same legs walked backwards by another mission.
    route('stone:back', 'stone', [at(15, 20), at(15, 10), at(10, 10)]),
    // Horizontal and vertical seams, crossing at (63, 30).
    route('wood:seam-x', 'wood', [at(61, 30), at(3, 30)]),
    route('wood:seam-y', 'wood', [at(63, 28), at(63, 32), at(2, 32)]),
    route('garden:seam-corner', 'garden', [at(30, 62), at(30, 2)]),
    route('wood:fine', 'wood', fine),
    // A unit diagonal: a desire edge since R2a, drawn by neither derivation.
    route('wood:jump', 'wood', [at(50, 50), at(51, 51), at(51, 55)]),
  ];
}
function fixtureState(travelRoutes: TravelRoute[]): VillageState {
  const road: RoadStroke = {
    id: 'edited',
    points: [
      { x: 152, y: 80 },
      { x: 168, y: 80 },
    ],
    width: 4,
    border: false,
    operation: 'paint',
    material: 'stone-1',
  };
  return {
    world,
    village: { anchorCellX: 10, anchorCellY: 10 },
    region: { originCellX: 0, originCellY: 0, width: 64, height: 64, terrainCodes: Array(4096).fill(1), features: [] },
    cells: [
      { cellX: 10, cellY: 10, footprint: { buildingId: 'hall' }, building: { id: 'hall', type: 'town-hall' } },
      { cellX: 12, cellY: 12, footprint: { buildingId: 'house' }, building: { id: 'house', type: 'dwelling' } },
      { cellX: 15, cellY: 15, footprint: { buildingId: 'garden' }, building: null },
    ],
    travelRoutes,
    infrastructure: { ...emptyInfrastructure(), roads: [road] },
  } as unknown as VillageState;
}
/** What the T3d script and the aggregation will store for these routes, then stream back as cells. */
function desireCellsOf(routes: readonly TravelRoute[]): DesireCell[] {
  return desireCellsFromEdges(
    desireEdges(
      routes.map((r) => r.cells),
      world,
    ),
  );
}
const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
const isJoint = (id: string) => id.includes(':joint:');
/** A joint is numbered by the order its arms were met in, which follows the order of the edges. */
const normalisedJoints = (strokes: RoadStroke[]) =>
  strokes
    .filter((s) => isJoint(s.id))
    .map((s) => ({
      cell: s.id.split(':').slice(1, 3).join(':'),
      arms: [s.points[0]!, s.points[2]!].map((p) => `${p.x},${p.y}`).sort(),
      centre: s.points[1],
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe('desireRoutes', () => {
  it('makes one two-cell earth segment per visible edge, wrapped on the torus', () => {
    const routes = desireRoutes(
      [
        { cellX: 63, cellY: 5, east: true, south: false },
        { cellX: 5, cellY: 63, east: false, south: true },
        { cellX: 63, cellY: 63, east: true, south: true },
        { cellX: 3, cellY: 4, east: true, south: true },
      ],
      world,
    );
    expect(routes).toEqual([
      expect.objectContaining({ id: 'desire:3:4:east', cells: [at(3, 4), at(4, 4)], destination: at(4, 4) }),
      expect.objectContaining({ id: 'desire:3:4:south', cells: [at(3, 4), at(3, 5)], destination: at(3, 5) }),
      expect.objectContaining({ id: 'desire:63:5:east', cells: [at(63, 5), at(0, 5)] }),
      expect.objectContaining({ id: 'desire:5:63:south', cells: [at(5, 63), at(5, 0)] }),
      expect.objectContaining({ id: 'desire:63:63:east', cells: [at(63, 63), at(0, 63)] }),
      expect.objectContaining({ id: 'desire:63:63:south', cells: [at(63, 63), at(63, 0)] }),
    ]);
    // Every path is earth (decision 3): the only kind `roadEdges` does not pave.
    expect(new Set(routes.map((r) => r.kind))).toEqual(new Set(['wood']));
    expect(routes.every((r) => r.id.startsWith(DESIRE_ROUTE_PREFIX) && r.cells.length === 2)).toBe(true);
  });

  it('makes a two-cell segment per visible diagonal edge too, after the cardinal ones of its cell, wrapped', () => {
    const routes = desireRoutes(
      [
        { cellX: 63, cellY: 5, east: false, south: false, southEast: true },
        { cellX: 0, cellY: 5, east: false, south: false, southWest: true },
        { cellX: 7, cellY: 63, east: false, south: false, southEast: true, southWest: true },
        { cellX: 3, cellY: 4, east: true, south: true, southEast: true, southWest: true },
        { cellX: 9, cellY: 9, east: true, south: false, southEast: false },
      ],
      world,
    );
    expect(routes.map((r) => [r.id, r.cells, r.destination])).toEqual([
      ['desire:3:4:east', [at(3, 4), at(4, 4)], at(4, 4)],
      ['desire:3:4:south', [at(3, 4), at(3, 5)], at(3, 5)],
      ['desire:3:4:south-east', [at(3, 4), at(4, 5)], at(4, 5)],
      ['desire:3:4:south-west', [at(3, 4), at(2, 5)], at(2, 5)],
      ['desire:0:5:south-west', [at(0, 5), at(63, 6)], at(63, 6)],
      ['desire:63:5:south-east', [at(63, 5), at(0, 6)], at(0, 6)],
      ['desire:9:9:east', [at(9, 9), at(10, 9)], at(10, 9)],
      ['desire:7:63:south-east', [at(7, 63), at(8, 0)], at(8, 0)],
      ['desire:7:63:south-west', [at(7, 63), at(6, 0)], at(6, 0)],
    ]);
    expect(new Set(routes.map((r) => r.kind))).toEqual(new Set(['wood']));
    // The edges they are made from, and back.
    const edges = desireEdges(
      routes.map((r) => r.cells),
      world,
    );
    expect(edges.filter((e) => e.direction >= 2)).toEqual([
      { cellX: 0, cellY: 5, direction: 3 },
      { cellX: 3, cellY: 4, direction: 2 },
      { cellX: 3, cellY: 4, direction: 3 },
      { cellX: 7, cellY: 63, direction: 2 },
      { cellX: 7, cellY: 63, direction: 3 },
      { cellX: 63, cellY: 5, direction: 2 },
    ]);
    expect(desireCellsFromEdges(edges).find((c) => c.cellX === 3 && c.cellY === 4)).toEqual({
      cellX: 3,
      cellY: 4,
      east: true,
      south: true,
      southEast: true,
      southWest: true,
    });
    // A cell without a diagonal keeps the shape of T3b.
    expect(desireCellsFromEdges([{ cellX: 1, cellY: 1, direction: 0 }])).toEqual([
      { cellX: 1, cellY: 1, east: true, south: false },
    ]);
  });

  it('does not depend on the order the cells arrive in', () => {
    const cells = desireCellsOf(fixtureRoutes());
    expect(cells.length).toBeGreaterThan(20);
    expect(desireRoutes([...cells].reverse(), world)).toEqual(desireRoutes(cells, world));
  });

  it('is the inverse of desireEdges on the cells it builds', () => {
    const routes = fixtureRoutes(),
      edges = desireEdges(
        routes.map((r) => r.cells),
        world,
      );
    const again = desireEdges(
      desireRoutes(desireCellsFromEdges(edges), world).map((r) => r.cells),
      world,
    );
    expect(again).toEqual(edges);
    expect(edges.length).toBeGreaterThan(40);
  });
});

describe('golden: desire edges draw what the network drew', () => {
  const routes = fixtureRoutes(),
    legacy = fixtureState(routes),
    desire = fixtureState(desireRoutes(desireCellsOf(routes), world));

  it('lights the same braziers: same ids, same positions', () => {
    const expected = byId(automaticBraziers(legacy)),
      actual = byId(automaticBraziers(desire));
    // The fixture must exercise corners, junctions, the seams, masking by buildings and by the edited road.
    expect(expected.length).toBeGreaterThan(8);
    expect(expected.some((b) => b.id.startsWith('auto:63:') || b.id.startsWith('auto:0:'))).toBe(true);
    expect(actual).toEqual(expected);
  });

  it('freezes the same automatic arms when a road edit inherits them', () => {
    const expected = createInfrastructureEditContext(legacy as never).automatic,
      actual = createInfrastructureEditContext(desire as never).automatic;
    expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
    expect(expected.size).toBeGreaterThan(30);
    const arms = (strokes: RoadStroke[]) => byId(strokes.filter((s) => !isJoint(s.id)));
    for (const [cell, strokes] of expected) expect(arms(actual.get(cell)!)).toEqual(arms(strokes));
  });

  it('draws the same strokes: identical arms, the same joints', () => {
    const expected = automaticRoadStrokes(routes, world),
      actual = automaticRoadStrokes(desire.travelRoutes, world);
    expect(expected.length).toBeGreaterThan(40);
    expect(byId(actual.filter((s) => !isJoint(s.id)))).toEqual(byId(expected.filter((s) => !isJoint(s.id))));
    expect(normalisedJoints(actual)).toEqual(normalisedJoints(expected));
    expect(actual.length).toBe(expected.length);
    // Restricted to some cells, as the stubs of a road cell are.
    const allowed = new Set(['10:10', '15:10', '16:10', '63:30', '0:30', '30:63']);
    expect(byId(automaticRoadStrokes(desire.travelRoutes, world, allowed).filter((s) => !isJoint(s.id)))).toEqual(
      byId(automaticRoadStrokes(routes, world, allowed).filter((s) => !isJoint(s.id))),
    );
  });
});

describe('diagonal desire paths before they are drawn (R2a)', () => {
  // A diagonal next to every cardinal shape of the fixture: at a corner, along a leg, across both
  // seams, alone, and into the occupied cells.
  const cardinal = desireCellsOf(fixtureRoutes()),
    diagonals = desireCellsFromEdges([
      { cellX: 10, cellY: 10, direction: 2 },
      { cellX: 12, cellY: 10, direction: 3 },
      { cellX: 15, cellY: 12, direction: 2 },
      { cellX: 63, cellY: 30, direction: 2 },
      { cellX: 0, cellY: 63, direction: 3 },
      { cellX: 30, cellY: 63, direction: 2 },
      { cellX: 44, cellY: 44, direction: 2 },
      { cellX: 45, cellY: 44, direction: 3 },
      { cellX: 14, cellY: 14, direction: 2 },
    ]);
  const merged = new Map(cardinal.map((c) => [`${c.cellX},${c.cellY}`, { ...c }]));
  for (const d of diagonals) {
    const known = merged.get(`${d.cellX},${d.cellY}`);
    if (known) Object.assign(known, d.southEast ? { southEast: true } : {}, d.southWest ? { southWest: true } : {});
    else merged.set(`${d.cellX},${d.cellY}`, d);
  }
  const plain = fixtureState(desireRoutes(cardinal, world)),
    withDiagonals = fixtureState(desireRoutes(merged.values(), world)),
    onlyDiagonals = fixtureState(desireRoutes(diagonals, world));

  it('are routes of the state, and the fixture does carry them', () => {
    const ids = withDiagonals.travelRoutes.map((r) => r.id);
    // The nine above, and the unit jump of the fixture (`wood:jump`), now a south-east edge.
    expect(ids.filter((id) => id.endsWith(':south-east') || id.endsWith(':south-west'))).toHaveLength(10);
    expect(plain.travelRoutes.map((r) => r.id)).toContain('desire:50:50:south-east');
    expect(ids.length).toBe(plain.travelRoutes.length + 9);
  });

  it('light no brazier and move none', () => {
    expect(automaticBraziers(onlyDiagonals)).toEqual([]);
    expect(byId(automaticBraziers(withDiagonals))).toEqual(byId(automaticBraziers(plain)));
  });

  it('draw no stroke, and leave the strokes and the frozen arms of the cardinal paths as they are', () => {
    expect(automaticRoadStrokes(onlyDiagonals.travelRoutes, world)).toEqual([]);
    expect(byId(automaticRoadStrokes(withDiagonals.travelRoutes, world))).toEqual(
      byId(automaticRoadStrokes(plain.travelRoutes, world)),
    );
    expect(createInfrastructureEditContext(onlyDiagonals as never).automatic.size).toBe(0);
    const expected = createInfrastructureEditContext(plain as never).automatic,
      actual = createInfrastructureEditContext(withDiagonals as never).automatic;
    expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [cell, strokes] of expected) expect(byId(actual.get(cell)!)).toEqual(byId(strokes));
  });
});

describe('the village state of a village that draws desire paths', () => {
  const worldId = '11111111-1111-4111-8111-111111111111',
    villageId = '22222222-2222-4222-8222-222222222222';
  const scope = (entries: Array<[string, unknown]>, revision = '1'): SyncV2Scope => ({
    epoch: worldId,
    revision,
    base: new Map(entries) as SyncV2Scope['base'],
    effects: new Map(),
  });
  const at0 = '2026-11-15T12:00:00.000Z';
  const cell = (cellX: number, cellY: number, east: boolean, south: boolean) =>
    [`desirePaths:${cellX},${cellY}`, { id: `${cellX},${cellY}`, cellX, cellY, east, south }] as [string, unknown];
  const village = () =>
    scope([
      [`identity:${villageId}`, { id: villageId, name: 'Fixture', anchorCellX: 0, anchorCellY: 0 }],
      ['populationSummary:*', { id: '*', total: 0 }],
      ['resources:wood', { code: 'wood', amount: 0, productionPerHour: 0, productionUpdatedAt: at0 }],
      ['resources:carrot', { code: 'carrot', amount: 0, productionPerHour: 0, productionUpdatedAt: null }],
    ]);
  const sync = (desireScopes: Array<[string, SyncV2Scope]>): SyncV2State => ({
    worldId,
    villageId,
    generation: 1,
    scopes: new Map<string, SyncV2Scope>([
      [`village:${villageId}`, village()],
      ['knowledge:account', scope([['knowledgeScience:*', { id: '*', state: {} }]])],
      [
        `manifest:${worldId}`,
        scope([
          [
            'gameManifest:*',
            { id: '*', world: { widthCells: 64, heightCells: 64 }, buildingTypes: [], factoryEnabled: false },
          ],
        ]),
      ],
      ...desireScopes,
    ]),
  });
  const serverRoute = route('building:house', 'building', [at(1, 1), at(1, 4)]);
  const presentation = (pathSource?: 'routes' | 'desire') =>
    ({
      protocol: 2,
      worldId,
      villageId,
      version: '0'.repeat(64),
      observedAt: at0,
      cells: [],
      travelRoutes: [serverRoute],
      ...(pathSource ? { pathSource } : {}),
      region: {},
      market: { unlocked: false, deliveryMs: 0, commissionPercent: 30, resources: [] },
    }) as unknown as ResolvedVillagePresentation;
  const withDesire = () =>
    sync([
      ['desire:0,0', scope([cell(63, 5, true, false), cell(3, 4, true, true)])],
      ['desire:1,0', scope([cell(40, 7, false, true)])],
    ]);

  it('keeps the server network, and no pathSource field, unless the presentation asks for desire paths', () => {
    for (const source of [undefined, 'routes' as const]) {
      const state = villageStateFromSyncV2(withDesire(), presentation(source), at0)!;
      expect(state.travelRoutes).toEqual([serverRoute]);
      expect('pathSource' in state).toBe(false);
    }
  });

  it('draws the desire cells of every subscribed chunk, and not the server network', () => {
    const state = villageStateFromSyncV2(withDesire(), presentation('desire'), at0)!;
    expect(state.pathSource).toBe('desire');
    expect(state.travelRoutes.map((r) => r.id)).toEqual([
      'desire:3:4:east',
      'desire:3:4:south',
      'desire:63:5:east',
      'desire:40:7:south',
    ]);
    expect(state.travelRoutes.find((r) => r.id === 'desire:63:5:east')!.cells).toEqual([at(63, 5), at(0, 5)]);
    expect(state.travelRoutes.every((r) => r.kind === 'wood')).toBe(true);
    expect([...desirePathsFromSyncV2(withDesire()).keys()].sort()).toEqual(['3,4', '40,7', '63,5']);
  });

  it('keeps the routes by identity until a desire chunk changes, so no consumer derives again', () => {
    const first = withDesire(),
      routes = desireRoutesFromSyncV2(first, world);
    expect(routes).toHaveLength(4);
    // A publication that changes another stream replaces the state and the scopes map, not the desire scopes.
    const elsewhere: SyncV2State = {
      ...first,
      scopes: new Map(first.scopes).set(`village:${villageId}`, village()),
    };
    expect(desireRoutesFromSyncV2(elsewhere, world)).toBe(routes);
    expect(villageStateFromSyncV2(elsewhere, presentation('desire'), at0)!.travelRoutes).toBe(routes);
    // A desire delta replaces the scope object of its chunk.
    const changed: SyncV2State = {
      ...first,
      scopes: new Map(first.scopes).set('desire:1,0', scope([cell(40, 7, false, true), cell(41, 7, true, false)], '2')),
    };
    const next = desireRoutesFromSyncV2(changed, world);
    expect(next).not.toBe(routes);
    expect(next.map((r) => r.id)).toContain('desire:41:7:east');
    // A chunk emptied by a removal leaves its neighbours' paths.
    expect(
      desireRoutesFromSyncV2({ ...first, scopes: new Map(first.scopes).set('desire:1,0', scope([], '3')) }, world).map(
        (r) => r.id,
      ),
    ).toEqual(['desire:3:4:east', 'desire:3:4:south', 'desire:63:5:east']);
  });

  it('draws nothing, with a stable empty list, while no desire chunk is subscribed', () => {
    const none = sync([]);
    expect(desireRoutesFromSyncV2(none, world)).toEqual([]);
    expect(desireRoutesFromSyncV2(sync([]), world)).toBe(desireRoutesFromSyncV2(none, world));
    expect(villageStateFromSyncV2(none, presentation('desire'), at0)!.travelRoutes).toEqual([]);
  });
});

describe('desireChunkDrift', () => {
  const geometry = { widthCells: 4096, heightCells: 2048, chunkSize: 32 };
  const region = { originCellX: 4080, originCellY: 2040, width: 64, height: 48 };
  const held = (keys: string[]) => new Set(['village:x', 'manifest:y', ...keys.map((key) => `desire:${key}`)]);

  it('is null when the session holds exactly the chunks the window covers, seam included', () => {
    const wanted = desireScopeKeys(region, geometry);
    expect(wanted.length).toBeGreaterThan(2);
    expect(wanted).toContain('127,63');
    expect(wanted).toContain('0,0');
    expect(desireChunkDrift(held(wanted), region, geometry)).toBeNull();
  });

  it('names the wanted chunks when the window grew, or when none is held', () => {
    const before = desireScopeKeys(region, geometry),
      grown = { ...region, width: 200 };
    const wanted = desireChunkDrift(held(before), grown, geometry);
    expect(wanted).not.toBeNull();
    expect(wanted!.length).toBeGreaterThan(before.length);
    expect(desireChunkDrift(undefined, region, geometry)).toEqual([...before].sort());
    // After a reopening the session holds them: no drift, the memory of the request is released.
    expect(desireChunkDrift(held(wanted!), grown, geometry)).toBeNull();
  });
});

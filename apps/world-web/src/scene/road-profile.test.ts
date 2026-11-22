import { expect, it } from 'vitest';
import {
  desireCellsFromEdges,
  desireEdges,
  desireRoutes,
  emptyInfrastructure,
  type TravelRoute,
  type VillageState,
} from '@arbestra/contracts';
import {
  pavedProfiles,
  roadEdges,
  roadInnerCorners,
  roadKey,
  roadWidths,
  ROAD_HALF_WIDTH,
  villageRoadDisplayRoutes,
} from './road-profile';
import { roadCellLinks, ROAD_EAST, ROAD_WEST } from './road-cell-links';

it('does not reserve invisible automatic road strips across manually painted work areas', () => {
  const infrastructure = emptyInfrastructure();
  infrastructure.roads = [
    {
      id: 'paving',
      operation: 'paint',
      material: 'stone-1',
      width: 4,
      border: false,
      points: [
        { x: 8, y: 8 },
        { x: 24, y: 8 },
      ],
    },
  ];
  const state = {
    world: { widthCells: 16, heightCells: 16 },
    infrastructure,
    cells: [
      { cellX: 0, cellY: 1, footprint: { buildingId: 'hall' } },
      { cellX: 4, cellY: 1, footprint: { buildingId: 'house' } },
    ],
    travelRoutes: [
      {
        id: 'house',
        kind: 'building',
        destination: { cellX: 4, cellY: 1 },
        cells: Array.from({ length: 5 }, (_, cellX) => ({ cellX, cellY: 1 })),
      },
    ],
  } as unknown as VillageState;
  expect(villageRoadDisplayRoutes({ ...state, infrastructure: emptyInfrastructure() })[0]?.cells).toEqual([
    { cellX: 1, cellY: 1 },
    { cellX: 2, cellY: 1 },
    { cellX: 3, cellY: 1 },
  ]);
  expect(villageRoadDisplayRoutes(state)).toEqual([]);
});

it('masks the automatic road under road cells, which are drawn in its place', () => {
  const state = {
    world: { widthCells: 16, heightCells: 16 },
    infrastructure: emptyInfrastructure(),
    cells: [{ cellX: 4, cellY: 1, footprint: { buildingId: 'house' } }],
    roadCells: [{ id: '2,1', cellX: 2, cellY: 1, surface: 'rubble', sidewalks: false, gauge: 'chemin', revision: 1 }],
    travelRoutes: [
      {
        id: 'house',
        kind: 'building',
        destination: { cellX: 4, cellY: 1 },
        cells: Array.from({ length: 5 }, (_, cellX) => ({ cellX, cellY: 1 })),
      },
    ],
  } as unknown as VillageState;
  // Cell 2 carries a rubble road cell: the automatic strip stops on each side of it.
  expect(villageRoadDisplayRoutes(state).map((r) => r.cells)).toEqual([
    [
      { cellX: 0, cellY: 1 },
      { cellX: 1, cellY: 1 },
    ],
  ]);
});

// Desire paths (T3c): the scene reads them as the same two-cell segments it read the network as.
const world = { widthCells: 16, heightCells: 16 };
const desireOf = (routes: TravelRoute[]) =>
  desireRoutes(
    desireCellsFromEdges(
      desireEdges(
        routes.map((r) => r.cells),
        world,
      ),
    ),
    world,
  );
const edgeKeys = (routes: readonly TravelRoute[]) =>
  roadEdges(routes)
    .map((e) => `${roadKey(e.from)}|${roadKey(e.to)}`)
    .sort();
/** Straight along row 1 across the east-west seam: cells 14, 15, 0 ... 4. */
const seamRow = (kind: TravelRoute['kind']): TravelRoute => ({
  id: 'row',
  kind,
  destination: { cellX: 4, cellY: 1 },
  cells: [14, 15, 0, 1, 2, 3, 4].map((cellX) => ({ cellX, cellY: 1 })),
});

it('draws desire paths in earth only: nothing is paved, every figure walks the earth width', () => {
  const network = [seamRow('building')];
  // The all-goals network paves its building routes, as it always did ...
  expect(roadEdges(network).every((e) => e.kind === 'paved')).toBe(true);
  expect(pavedProfiles(network, 16, 16).size).toBe(7);
  expect([...roadWidths(network).values()].every((w) => w === ROAD_HALF_WIDTH * 2)).toBe(true);
  // ... the same edges as desire paths, never.
  const desire = desireOf(network);
  expect(desire).toHaveLength(6);
  expect(roadEdges(desire)).toHaveLength(6);
  expect(roadEdges(desire).every((e) => e.kind === 'earth')).toBe(true);
  expect(pavedProfiles(desire, 16, 16).size).toBe(0);
  expect(roadWidths(desire).size).toBe(7);
  expect([...roadWidths(desire).values()].every((w) => w === 0.8)).toBe(true);
});

// Diagonal desire paths (R2a) are routes before they are drawn (R2b): nothing paves, cuts a corner or
// opens an arm for them. Cells (5, 5) to (6, 6) south-east, (8, 5) to (7, 6) south-west, and the seam:
// (15, 3) south-east to (0, 4), (0, 9) south-west to (15, 10).
const diagonals = desireRoutes(
  desireCellsFromEdges([
    { cellX: 5, cellY: 5, direction: 2 },
    { cellX: 8, cellY: 5, direction: 3 },
    { cellX: 15, cellY: 3, direction: 2 },
    { cellX: 0, cellY: 9, direction: 3 },
  ]),
  world,
);

it('takes no profile, corner or arm from a diagonal desire path, alone or beside cardinal ones', () => {
  expect(diagonals.map((r) => r.id)).toEqual([
    'desire:15:3:south-east',
    'desire:5:5:south-east',
    'desire:8:5:south-west',
    'desire:0:9:south-west',
  ]);
  expect(diagonals.map((r) => r.kind)).toEqual(['wood', 'wood', 'wood', 'wood']);
  // Alone: no paving, no inner corner, no brazier corner of the fallback (without a snapshot).
  expect(pavedProfiles(diagonals, 16, 16).size).toBe(0);
  expect(roadInnerCorners(diagonals, 16, 16)).toEqual([]);
  // Beside an L of cardinal paths through (5, 5) and (6, 6): the same as without them.
  const cardinal = desireOf([
    {
      id: 'l',
      kind: 'wood',
      destination: { cellX: 6, cellY: 6 },
      cells: [
        { cellX: 5, cellY: 5 },
        { cellX: 6, cellY: 5 },
        { cellX: 6, cellY: 6 },
      ],
    },
    seamRow('wood'),
  ]);
  const both = [...cardinal, ...diagonals];
  expect(roadInnerCorners(both, 16, 16)).toEqual(roadInnerCorners(cardinal, 16, 16));
  expect(roadInnerCorners(cardinal, 16, 16)).toHaveLength(1);
  expect(pavedProfiles(both, 16, 16)).toEqual(pavedProfiles(cardinal, 16, 16));
  // Under paved routes too, a diagonal adds no arm to the excavation profile.
  const paved = cardinal.map((r) => ({ ...r, kind: 'building' as const }));
  expect(pavedProfiles([...paved, ...diagonals], 16, 16)).toEqual(pavedProfiles(paved, 16, 16));
});

it('keeps a diagonal desire path in the display routes and the widths, and masks it like any route', () => {
  // The cells a figure walks: the diagonal's two cells take the earth width (R2b draws them).
  const widths = roadWidths(diagonals);
  expect([...widths.keys()].sort()).toEqual(['0:4', '0:9', '15:10', '15:3', '5:5', '6:6', '7:6', '8:5']);
  expect([...widths.values()].every((w) => w === 0.8)).toBe(true);
  const state = (cells: VillageState['cells']) =>
    ({ world, infrastructure: emptyInfrastructure(), cells, travelRoutes: diagonals }) as unknown as VillageState;
  expect(villageRoadDisplayRoutes(state([])).map((r) => r.cells)).toEqual(diagonals.map((r) => r.cells));
  // A footprint on one end removes the segment, as for a cardinal route.
  const masked = villageRoadDisplayRoutes(state([{ cellX: 6, cellY: 6, footprint: { buildingId: 'house' } }] as never));
  expect(masked.map((r) => r.id)).toEqual([
    'desire:15:3:south-east:display:0',
    'desire:8:5:south-west:display:0',
    'desire:0:9:south-west:display:0',
  ]);
  // A road cell at one end of a diagonal opens no arm and makes no stub.
  const linked = roadCellLinks({
    ...state([]),
    roadCells: [{ id: '6,6', cellX: 6, cellY: 6, surface: 'rubble', sidewalks: false, gauge: 'chemin', revision: 1 }],
  } as unknown as VillageState);
  expect(linked.masks.size).toBe(0);
  expect(linked.stubs).toEqual([]);
});

it('masks desire paths under footprints and road cells exactly as it masks the same segments of a network, seam included', () => {
  const state = (travelRoutes: TravelRoute[]) =>
    ({
      world,
      infrastructure: emptyInfrastructure(),
      // Footprint on cell 2, a road cell on cell 0 (across the seam from 15).
      cells: [{ cellX: 2, cellY: 1, footprint: { buildingId: 'house' } }],
      roadCells: [{ id: '0,1', cellX: 0, cellY: 1, surface: 'rubble', sidewalks: false, gauge: 'chemin', revision: 1 }],
      travelRoutes,
    }) as unknown as VillageState;
  const network = [seamRow('wood')],
    desire = desireOf(network);
  const shown = edgeKeys(villageRoadDisplayRoutes(state(desire)));
  // Only the strips with both ends free: 14-15 and 3-4. Cell 0 is a road cell, cell 2 a footprint.
  expect(shown).toEqual(['14:1|15:1', '3:1|4:1']);
  expect(shown).toEqual(edgeKeys(villageRoadDisplayRoutes(state(network))));
  // The arms the road cell takes from the paths that meet it (15 on its west, 1 on its east), and their stubs.
  const links = roadCellLinks(state(desire)),
    legacy = roadCellLinks(state(network));
  expect([...links.masks]).toEqual([...legacy.masks]);
  expect(links.masks.get('0:1')).toBe(ROAD_EAST | ROAD_WEST);
  const stubCells = (stubs: TravelRoute[]) => stubs.map((r) => JSON.stringify(r.cells)).sort();
  expect(stubCells(links.stubs)).toEqual(stubCells(legacy.stubs));
  expect(links.stubs).toHaveLength(2);
});

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

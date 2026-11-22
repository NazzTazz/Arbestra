import { describe, expect, it } from 'vitest';
import { automaticBraziers, brazierQuadrants } from './automatic-braziers.js';
import { desireCellsFromEdges, desireRoutes } from './desire-routes.js';
import {
  automaticRoadStrokes,
  createInfrastructureEditContext,
  emptyInfrastructure,
  infrastructureSurface,
  type RoadStroke,
} from './infrastructure.js';
import type { DesireEdge, TravelRoute } from './travel-paths.js';
import type { VillageState } from './villages.js';

// Diagonal desire paths drawn and lit (docs/SPEC-TRAJETS-8-DIRECTIONS-2026-11-22.md §3.4, R2b).
const world = { widthCells: 64, heightCells: 64 };
const routesOf = (edges: DesireEdge[]) => desireRoutes(desireCellsFromEdges(edges), world);
const state = (travelRoutes: TravelRoute[], extra: Partial<VillageState> = {}): VillageState =>
  ({
    world,
    village: { anchorCellX: 0, anchorCellY: 0 },
    region: { originCellX: 0, originCellY: 0, width: 64, height: 64, terrainCodes: Array(4096).fill(1), features: [] },
    cells: [],
    travelRoutes,
    infrastructure: emptyInfrastructure(),
    ...extra,
  }) as unknown as VillageState;
const ids = (fires: ReturnType<typeof automaticBraziers>) => fires.map((f) => f.id).sort();
const pixels = (roads: RoadStroke[]) => infrastructureSurface(roads, world);
const has = (surface: Map<string, unknown>, x: number, y: number) =>
  surface.has(`${((x % 1024) + 1024) % 1024}:${((y % 1024) + 1024) % 1024}`);

describe('automaticRoadStrokes in eight directions', () => {
  it('draws a diagonal edge as two arms that meet at the shared corner', () => {
    const strokes = automaticRoadStrokes(routesOf([{ cellX: 10, cellY: 10, direction: 2 }]), world);
    expect(strokes.map((s) => [s.id, s.points])).toEqual([
      [
        'auto:10:10:4',
        [
          { x: 80, y: 80 },
          { x: 84, y: 84 },
        ],
      ],
      [
        'auto:11:11:6',
        [
          { x: 88, y: 88 },
          { x: 84, y: 84 },
        ],
      ],
    ]);
  });

  it('keeps the ids and joints of cardinal arms, and joins a diagonal to them without an elbow', () => {
    const cardinal = routesOf([
        { cellX: 10, cellY: 10, direction: 0 },
        { cellX: 10, cellY: 10, direction: 1 },
      ]),
      both = routesOf([
        { cellX: 10, cellY: 10, direction: 0 },
        { cellX: 10, cellY: 10, direction: 1 },
        { cellX: 10, cellY: 10, direction: 3 },
      ]);
    const plain = automaticRoadStrokes(cardinal, world),
      mixed = automaticRoadStrokes(both, world);
    for (const stroke of plain) expect(mixed).toContainEqual(stroke);
    expect(mixed.filter((s) => s.id.includes(':joint:'))).toEqual(plain.filter((s) => s.id.includes(':joint:')));
    expect(mixed.map((s) => s.id).filter((id) => !plain.some((p) => p.id === id))).toEqual([
      'auto:10:10:5',
      'auto:9:11:7',
    ]);
  });

  it('wraps a diagonal across both seams', () => {
    const strokes = automaticRoadStrokes(routesOf([{ cellX: 63, cellY: 63, direction: 2 }]), world);
    expect(strokes.map((s) => s.points)).toEqual([
      [
        { x: 504, y: 504 },
        { x: 508, y: 508 },
      ],
      [
        { x: 0, y: 0 },
        { x: 508, y: 508 },
      ],
    ]);
    // The band is continuous over the corner where the four cells meet, on both sides of the seams.
    const surface = pixels(strokes);
    for (const [x, y] of [
      [1015, 1015],
      [1016, 1016],
      [1017, 1017],
      [1023, 1023],
      [0, 0],
    ])
      expect(has(surface, x!, y!), `${x}:${y}`).toBe(true);
  });

  it('never freezes a diagonal arm into the plan of a road edit', () => {
    const context = createInfrastructureEditContext(
      state(
        routesOf([
          { cellX: 10, cellY: 10, direction: 0 },
          { cellX: 10, cellY: 10, direction: 2 },
        ]),
      ) as never,
    );
    const frozen = [...context.automatic.values()].flat();
    expect(frozen.map((s) => s.id).sort()).toEqual(['inherited:10:10:0', 'inherited:11:10:2']);
  });
});

describe('infrastructureSurface of a diagonal', () => {
  const arm = (points: RoadStroke['points']): RoadStroke => ({
    id: 'a',
    points,
    width: 4,
    material: 'earth',
    border: false,
    operation: 'paint',
  });

  it('paints a band of the cardinal width, rounded at a cell centre and cut square at the corner', () => {
    const surface = pixels([
      arm([
        { x: 80, y: 80 },
        { x: 84, y: 84 },
      ]),
    ]);
    // Along the diagonal, from the centre (160) to the corner (168), and as wide as a cardinal arm.
    for (let i = 0; i < 8; i++) expect(has(surface, 160 + i, 160 + i)).toBe(true);
    expect(has(surface, 162, 158)).toBe(true);
    expect(has(surface, 158, 162)).toBe(true);
    expect(has(surface, 164, 158)).toBe(false);
    // Rounded behind the centre: a disc of the half-width.
    expect(has(surface, 157, 160)).toBe(true);
    expect(has(surface, 155, 160)).toBe(false);
    // Nothing beyond the corner: the neighbour's arm draws its half.
    expect(has(surface, 169, 169)).toBe(false);
    expect([...surface.values()].every((p) => p.axes === 3 && p.material === 'earth')).toBe(true);
  });

  it('draws the same pixels for the two arms of an edge as one straight band', () => {
    const halves = pixels([
        arm([
          { x: 80, y: 80 },
          { x: 84, y: 84 },
        ]),
        arm([
          { x: 88, y: 88 },
          { x: 84, y: 84 },
        ]),
      ]),
      keys = [...halves.keys()];
    // Symmetric about the corner (168, 168): every pixel has its mirror.
    for (const key of keys) {
      const [x, y] = key.split(':').map(Number);
      expect(halves.has(`${335 - x!}:${335 - y!}`), key).toBe(true);
    }
    // No hole on the diagonal line between the two centres.
    for (let i = 0; i < 16; i++) expect(has(halves, 160 + i, 160 + i)).toBe(true);
  });

  it('still refuses any other slope', () => {
    expect(() =>
      pixels([
        arm([
          { x: 80, y: 80 },
          { x: 84, y: 82 },
        ]),
      ]),
    ).toThrow('Le tracé doit suivre les axes X et Y.');
  });
});

describe('automatic braziers at crossings and ends', () => {
  const E = 1,
    W = 2,
    S = 4,
    N = 8,
    SE = 16,
    SW = 32,
    NW = 128;

  it('lights no straight line and no simple bend, cardinal or diagonal', () => {
    for (const mask of [E | W, S | N, E | S, W | N, SE | NW, E | SW, S | SE, 0])
      expect(brazierQuadrants(mask)).toEqual([]);
  });

  it('lights the quadrants between perpendicular arms at a cardinal crossing, as before diagonals', () => {
    expect(brazierQuadrants(E | W | S)).toEqual([
      [-1, 1],
      [1, 1],
    ]);
    expect(brazierQuadrants(E | W | S | N)).toHaveLength(4);
  });

  it('lights one quadrant facing away from the arm at an end', () => {
    expect(brazierQuadrants(E)).toEqual([[-1, -1]]);
    expect(brazierQuadrants(N)).toEqual([[-1, 1]]);
    expect(brazierQuadrants(SE)).toEqual([[-1, -1]]);
    expect(brazierQuadrants(SW)).toEqual([[1, -1]]);
  });

  it('never lights a quadrant a diagonal arm crosses, and always lights a crossing', () => {
    // A diagonal branch off a straight line.
    expect(brazierQuadrants(E | W | SE)).toEqual([[-1, 1]]);
    // Three arms on one side: the opposite quadrant.
    expect(brazierQuadrants(E | SE | S)).toEqual([[-1, -1]]);
    for (let mask = 1; mask < 256; mask++) {
      const quadrants = brazierQuadrants(mask);
      for (const [sx, sy] of quadrants) {
        const bit = sy > 0 ? (sx > 0 ? 16 : 32) : sx > 0 ? 64 : 128;
        expect(mask & bit).toBe(0);
      }
      let arms = 0;
      for (let b = 0; b < 8; b++) if (mask & (1 << b)) arms++;
      if (arms !== 2 && (mask & 240) !== 240) expect(quadrants.length, `mask ${mask}`).toBeGreaterThan(0);
    }
  });

  it('places the fires of a desire network: ends and crossings, no bend, with ids per node and quadrant', () => {
    // An L of three cells (a bend at 10:10), then a diagonal from its end, a T at 20:20.
    const routes = routesOf([
      { cellX: 10, cellY: 10, direction: 0 },
      { cellX: 10, cellY: 10, direction: 1 },
      { cellX: 11, cellY: 10, direction: 2 },
      { cellX: 20, cellY: 20, direction: 0 },
      { cellX: 19, cellY: 20, direction: 0 },
      { cellX: 20, cellY: 20, direction: 1 },
    ]);
    expect(ids(automaticBraziers(state(routes)))).toEqual(
      [
        // 10:10 is a bend and 11:10 (west, south-east) too: no fire. The end of the south arm at
        // 10:11 faces south, away from its north arm; the end of the diagonal at 12:11 faces south-east.
        'auto:10:11:-1:1',
        'auto:12:11:1:1',
        // The T at 20:20, between its south arm and each of its east and west arms.
        'auto:20:20:-1:1',
        'auto:20:20:1:1',
        // Its three ends.
        'auto:19:20:-1:-1',
        'auto:20:21:-1:1',
        'auto:21:20:1:-1',
      ].sort(),
    );
  });

  it('keeps a suppressed fire out and a manually lit cell dark, whatever the rule', () => {
    const routes = routesOf([
        { cellX: 20, cellY: 20, direction: 0 },
        { cellX: 19, cellY: 20, direction: 0 },
        { cellX: 20, cellY: 20, direction: 1 },
      ]),
      plain = ids(automaticBraziers(state(routes)));
    const plan = { ...emptyInfrastructure(), suppressedBraziers: ['auto:20:20:1:1'], manualLighting: ['19:20'] };
    expect(ids(automaticBraziers(state(routes, { infrastructure: plan })))).toEqual(
      plain.filter((id) => id !== 'auto:20:20:1:1' && !id.startsWith('auto:19:20:')),
    );
  });

  it('gives the same fire the same id and position when the network around it grows', () => {
    const t = [
        { cellX: 20, cellY: 20, direction: 0 },
        { cellX: 19, cellY: 20, direction: 0 },
        { cellX: 20, cellY: 20, direction: 1 },
      ] as DesireEdge[],
      before = automaticBraziers(state(routesOf(t))),
      after = automaticBraziers(state(routesOf([...t, { cellX: 20, cellY: 21, direction: 1 }])));
    const at = new Map(after.map((f) => [f.id, f.position]));
    for (const fire of before.filter((f) => f.id.startsWith('auto:20:20:')))
      expect(at.get(fire.id)).toEqual(fire.position);
  });

  it('lights across the torus seam', () => {
    const routes = routesOf([{ cellX: 63, cellY: 63, direction: 2 }]);
    expect(automaticBraziers(state(routes)).map((f) => [f.id, f.position])).toEqual([
      ['auto:63:63:-1:-1', { x: 501, y: 501 }],
      ['auto:0:0:1:1', { x: 3, y: 3 }],
    ]);
  });

  it('counts the arm towards a road cell for its neighbour, and puts no fire in the road cell', () => {
    // A straight path that ends in a road cell at 22:20: 21:20 is no end, 22:20 no node.
    const routes = routesOf([
      { cellX: 20, cellY: 20, direction: 0 },
      { cellX: 21, cellY: 20, direction: 0 },
    ]);
    const roadCells = [{ cellX: 22, cellY: 20 }] as NonNullable<VillageState['roadCells']>;
    expect(ids(automaticBraziers(state(routes, { roadCells })))).toEqual(['auto:20:20:-1:-1']);
    expect(ids(automaticBraziers(state(routes)))).toEqual(['auto:20:20:-1:-1', 'auto:22:20:1:-1']);
  });
});

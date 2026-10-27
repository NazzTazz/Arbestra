import { describe, it, expect } from 'vitest';
import {
  buildingPlan,
  planShapeKey,
  entranceConnector,
  doorConnector,
  doorLaneOffset,
  doorLaneSpacing,
  recipeFor,
  DOOR_LANE_WIDTH,
  HALL_DOUBLE_DOOR_WIDTH,
  HALL_RECIPE,
  HOUSE_RECIPE,
  withBuildingAccesses,
  resolveMurets,
  transformPoint,
  type PlanInput,
} from './building-plan';
import { WORKER_CLEARANCE, WORKER_RADIUS } from './worker-motion';
const input: PlanInput = {
  id: 'hall',
  anchor: { cellX: 9, cellY: 9 },
  cells: [
    { cellX: 9, cellY: 9 },
    { cellX: 9, cellY: 10 },
  ],
  world: { widthCells: 32, heightCells: 32 },
  recipe: HALL_RECIPE,
};
describe('modular building factory', () => {
  it('rebalances ground-floor windows for two entrances on any house facade without losing upstairs windows', () => {
    const baseline = buildingPlan({ ...input, cells: [input.anchor], recipe: { ...HOUSE_RECIPE, levels: 2 } });
    const upperWindows = baseline.openings.filter(
      (o) => !o.door && o.bottom > HOUSE_RECIPE.courses * HOUSE_RECIPE.module.height,
    );
    for (const face of ['-x', '+x', '-z', '+z'] as const) {
      const recipe = withBuildingAccesses({ ...HOUSE_RECIPE, levels: 2 }, face, true),
        plan = buildingPlan({ ...input, cells: [input.anchor], recipe });
      expect(plan.accesses).toHaveLength(2);
      expect(plan.openings.filter((o) => o.door)).toHaveLength(2);
      for (const door of plan.openings.filter((o) => o.door)) {
        expect(
          plan.openings.some(
            (o) => !o.door && o.face === door.face && o.bottom < door.top && o.left < door.right && o.right > door.left,
          ),
        ).toBe(false);
      }
      // The odd storey turns 90 degrees; compare its actual openings, not the ground-floor faces.
      expect(
        plan.openings.filter((o) => !o.door && o.bottom > HOUSE_RECIPE.courses * HOUSE_RECIPE.module.height),
      ).toEqual(upperWindows);
    }
  });
  it('assembles a wrapped footprint, preserves exact modules and stone courses', () => {
    const p = buildingPlan({
      ...input,
      anchor: { cellX: 9, cellY: 31 },
      cells: [
        { cellX: 9, cellY: 31 },
        { cellX: 9, cellY: 0 },
      ],
    });
    expect(p.origin.z).toBe(1.25);
    expect(p.width).toBeCloseTo(2.24);
    expect(p.depth).toBeCloseTo(4.48);
    expect(p.stones.length).toBeGreaterThan(400);
    for (const s of p.stones) {
      expect((s.length + 0.003) / 0.14).toBeCloseTo(Math.round((s.length + 0.003) / 0.14));
      expect(s.height).toBeCloseTo(0.137);
    }
  });
  it('transforms a lateral door with the same quarter turn as the body', () => {
    const p = buildingPlan({ ...input, cells: [input.anchor, { cellX: 10, cellY: 9 }], quarterTurns: 1 });
    const door = transformPoint(p, p.entry.threshold);
    expect(door.x).toBeCloseTo(1.25);
    expect(door.z).toBeCloseTo(1.12);
    expect(p.rotation).toBe(Math.PI / 2);
  });
  it('covers all four corners once on alternating courses', () => {
    const p = buildingPlan(input);
    for (let row = 0; row < 4; row++)
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const x = sx * (p.width / 2 - 0.07),
            z = sz * (p.depth / 2 - 0.07),
            y = (row + 0.5) * 0.14;
          const covers = p.stones.filter(
            (s) =>
              Math.abs(s.y - y) < 1e-8 &&
              Math.abs(x - s.x) < (s.axis === 'x' ? s.length / 2 : s.thickness / 2) + 0.002 &&
              Math.abs(z - s.z) < (s.axis === 'z' ? s.length / 2 : s.thickness / 2) + 0.002,
          );
          expect(covers).toHaveLength(1);
        }
  });
  it('rejects unsupported terrain, windows, footprint and boundary passage', () => {
    expect(() => buildingPlan({ ...input, heights: [0, 0.1] })).toThrow('uneven');
    expect(() => buildingPlan({ ...input, recipe: { ...HALL_RECIPE, windows: { '-x': [50] } } })).toThrow('windows');
    expect(() => buildingPlan({ ...input, cells: [input.anchor, { cellX: 11, cellY: 10 }] })).toThrow('rectangle');
    expect(() => buildingPlan({ ...input, recipe: { ...HALL_RECIPE, walls: { courses: 3, gateWidth: 0.7 } } })).toThrow(
      'passage',
    );
  });
  it('creates one continuous boundary gate even over the cell seam', () => {
    const p = buildingPlan({
      ...input,
      recipe: { ...HALL_RECIPE, modules: [4, 12], walls: { courses: 3, gateWidth: 0.7 } },
    });
    expect(p.murets).toHaveLength(5);
    expect(p.entry.gate.x).toBe(-1.25);
    const doorSegments = p.murets.filter((w) => w.key.includes(':-x:'));
    expect(doorSegments[0]!.b.z).toBeCloseTo(-0.35);
    expect(doorSegments[1]!.a.z).toBeCloseTo(0.35);
  });
  it('routes the visible connector around the building instead of through its walls', () => {
    const p = buildingPlan(input),
      route = entranceConnector(p, { x: 2.5, y: 0, z: 0 });
    expect(route[0]).toEqual(p.entry.inside);
    expect(route.at(-1)).toEqual({ x: 2.5, y: 0, z: 0 });
    for (let i = 3; i < route.length; i++) {
      const a = route[i - 1]!,
        b = route[i]!;
      for (let t = 0; t <= 1; t += 0.1) {
        const x = a.x + (b.x - a.x) * t,
          z = a.z + (b.z - a.z) * t;
        expect(Math.abs(x) >= p.width / 2 || Math.abs(z) >= p.depth / 2).toBe(true);
      }
    }
  });
  it('supports a second habitable level and a fixed works phase without changing its entry', () => {
    const finished = buildingPlan({ ...input, cells: [input.anchor], recipe: { ...HOUSE_RECIPE, levels: 2 } });
    const works = buildingPlan({
      ...input,
      cells: [input.anchor],
      recipe: { ...HOUSE_RECIPE, levels: 2 },
      phase: 'works',
      sourceLevels: 1,
    });
    expect(works.entry).toEqual(finished.entry);
    expect(works.height).toBeCloseTo(2.85);
    expect(works.phase).toBe('works');
    expect(works.openings.some((o) => o.bottom > 1.4)).toBe(true);
  });
  it('assigns a shared boundary once and preserves a neighbour gate', () => {
    const recipe = {
      ...HOUSE_RECIPE,
      modules: [4, 4] as [number, number],
      windows: {},
      entrance: { ...HOUSE_RECIPE.entrance, face: '+x' as const },
      walls: { courses: 3, gateWidth: 0.7 },
    };
    const a = buildingPlan({ ...input, id: 'a', cells: [input.anchor], recipe });
    const anchor = { cellX: 10, cellY: 9 },
      b = buildingPlan({
        ...input,
        id: 'b',
        anchor,
        cells: [anchor],
        recipe: { ...recipe, entrance: { ...recipe.entrance, face: '-z' } },
      });
    const walls = resolveMurets(
      [
        { plan: b, anchor },
        { plan: a, anchor: input.anchor },
      ],
      input.world,
    );
    const sharedA = walls.get('a')!.filter((w) => Math.abs(w.a.x - 1.18) < 1e-6 && Math.abs(w.b.x - 1.18) < 1e-6);
    expect(sharedA).toHaveLength(2);
    expect(sharedA.every((w) => w.a.z >= 0.35 - 1e-8 || w.b.z <= -0.35 + 1e-8)).toBe(true);
    expect(walls.get('b')!.filter((w) => Math.abs(w.a.x + 1.18) < 1e-6 && Math.abs(w.b.x + 1.18) < 1e-6)).toEqual([]);
  });
  it('closes the storey joint with masonry on all four walls', () => {
    const p = buildingPlan({ ...input, cells: [input.anchor], recipe: { ...HOUSE_RECIPE, levels: 2 } });
    const y = HOUSE_RECIPE.courses * HOUSE_RECIPE.module.height + HOUSE_RECIPE.floorThickness / 2;
    const band = p.stones.filter((s) => Math.abs(s.y - y) < 1e-8);
    expect(band.length).toBeGreaterThan(0);
    for (const side of [-1, 1])
      for (const axis of ['x', 'z'] as const) {
        const fixed = side * ((axis === 'x' ? p.depth : p.width) / 2 - HOUSE_RECIPE.module.thickness / 2);
        expect(band.some((s) => s.axis === axis && Math.abs((axis === 'x' ? s.z : s.x) - fixed) < 1e-8)).toBe(true);
      }
    expect(
      band.every((s) => Math.abs(s.height - (HOUSE_RECIPE.floorThickness - HOUSE_RECIPE.module.joint)) < 1e-8),
    ).toBe(true);
  });
});

it('keys generated geometry by shape, not by identity or placement', () => {
  const plan = buildingPlan(input),
    moved = buildingPlan({
      ...input,
      id: 'other-hall',
      anchor: { cellX: 20, cellY: 3 },
      cells: [
        { cellX: 20, cellY: 3 },
        { cellX: 20, cellY: 4 },
      ],
    });
  expect(planShapeKey(moved)).toBe(planShapeKey(plan));
  expect(planShapeKey({ ...plan, rotation: plan.rotation + Math.PI })).toBe(planShapeKey(plan));
  expect(planShapeKey({ ...plan, origin: { x: 4, y: 1, z: -3 } })).toBe(planShapeKey(plan));
  expect(planShapeKey(buildingPlan({ ...input, recipe: { ...HALL_RECIPE, levels: 2 } }))).not.toBe(planShapeKey(plan));
  expect(planShapeKey({ ...plan, phase: 'works' })).not.toBe(planShapeKey(plan));
});

/**
 * The hall's double door: two one-way lanes through one wide opening. Seen
 * from outside, facing the door, walkers enter through the right half and
 * leave through the left half, each keeping its right.
 */
describe('double door lanes', () => {
  const doubleDoor = { ...HALL_RECIPE, entrance: { ...HALL_RECIPE.entrance, width: HALL_DOUBLE_DOOR_WIDTH } };
  const hall = buildingPlan({ ...input, recipe: doubleDoor });
  const n = hall.entry.normal;
  // Right of a walker heading `h`, in the scene's left-handed frame: (h.z, -h.x).
  const rightOfEntrant = { x: -n.z, z: n.x };
  it('widens only the market hall and keeps the baked single door at level 1', () => {
    const layout: NonNullable<Parameters<typeof recipeFor>[0]['visualLayout']> = {
      recipe: 'town-hall',
      version: 1,
      quarterTurns: 0,
      entranceFace: '+x',
      offset: [0, 0],
    };
    const market = recipeFor({ visualLayout: layout, status: 'completed', targetLevel: null, level: 2 })!,
      starter = recipeFor({ visualLayout: layout, status: 'completed', targetLevel: null, level: 1 })!,
      works = recipeFor({ visualLayout: layout, status: 'under-construction', targetLevel: 2, level: 1 })!;
    expect(market.recipe.entrance.width).toBe(HALL_DOUBLE_DOOR_WIDTH);
    expect(works.recipe.entrance.width).toBe(HALL_DOUBLE_DOOR_WIDTH);
    expect(starter.recipe.entrance.width).toBe(HALL_RECIPE.entrance.width);
    const house = recipeFor({
      visualLayout: { ...layout, recipe: 'stone-house', entranceFace: '-z' },
      status: 'completed',
      targetLevel: null,
      level: 2,
    })!;
    expect(house.recipe.entrance.width).toBe(HOUSE_RECIPE.entrance.width);
  });
  it('fits two files a body clearance apart inside the opening, entering on the right seen from outside', () => {
    const s = doorLaneSpacing(hall)!,
      opening = hall.accesses[0]!.width;
    expect(opening).toBeCloseTo(HALL_DOUBLE_DOOR_WIDTH * HALL_RECIPE.module.length);
    expect(2 * s).toBeGreaterThanOrEqual(WORKER_CLEARANCE);
    expect(s + DOOR_LANE_WIDTH / 2).toBeLessThanOrEqual(opening / 2);
    const entry = doorLaneOffset(hall, 'in'),
      exit = doorLaneOffset(hall, 'out');
    expect(entry.x * rightOfEntrant.x + entry.z * rightOfEntrant.z).toBeCloseTo(s);
    expect(exit.x * rightOfEntrant.x + exit.z * rightOfEntrant.z).toBeCloseTo(-s);
    // A hall facing +x, seen from +x: the entrant's right is +z.
    const facing = buildingPlan({
      ...input,
      recipe: { ...doubleDoor, entrance: { ...doubleDoor.entrance, face: '+x' } },
    });
    expect(doorLaneOffset(facing, 'in').x).toBeCloseTo(0);
    expect(doorLaneOffset(facing, 'in').z).toBeCloseTo(s);
    expect(doorLaneOffset(facing, 'out').z).toBeCloseTo(-s);
    expect(doorLaneSpacing(buildingPlan(input))).toBeNull();
    expect(doorLaneOffset(buildingPlan(input), 'in')).toEqual({ x: 0, y: 0, z: 0 });
  });
  it('builds two distinct tagged lanes beside the single connector that stop short of the shared join', () => {
    const join = { x: -2.5, y: 0, z: 0 },
      s = doorLaneSpacing(hall)!;
    const centre = entranceConnector(hall, join),
      out = entranceConnector(hall, join, 'out'),
      back = entranceConnector(hall, join, 'in');
    expect(centre.some((p) => p.lane)).toBe(false);
    expect(out.every((p) => p.lane === 'out')).toBe(true);
    expect(back.every((p) => p.lane === 'in')).toBe(true);
    expect(out).toHaveLength(back.length);
    expect(out.slice(0, -1).every((p) => p.width === DOOR_LANE_WIDTH)).toBe(true);
    expect(out.at(-1)!.width).toBe(0.8);
    for (let i = 0; i < out.length; i++) {
      const a = out[i]!,
        b = back[i]!;
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(WORKER_CLEARANCE - 1e-9);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(2 * s);
      expect((b.x - a.x) * rightOfEntrant.x + (b.z - a.z) * rightOfEntrant.z).toBeCloseTo(2 * s);
    }
    // Inside the door: the two files pass through the opening, bodies clear of the jambs.
    for (const lane of [out, back])
      for (const p of lane.slice(0, 2))
        expect(Math.abs(p.z) + DOOR_LANE_WIDTH / 2).toBeLessThanOrEqual(hall.accesses[0]!.width / 2 + 1e-9);
    // Facing -x, the entrant (heading +x) has +z on its left and -z on its right.
    expect(out[0]!.x).toBeCloseTo(hall.entry.inside.x);
    expect(out[0]!.z).toBeCloseTo(hall.entry.inside.z + s);
    expect(back[0]!.x).toBeCloseTo(hall.entry.inside.x);
    expect(back[0]!.z).toBeCloseTo(hall.entry.inside.z - s);
    // Each lane ends at its own join beside the shared one.
    expect(Math.hypot(out.at(-1)!.x - join.x, out.at(-1)!.z - join.z)).toBeCloseTo(s);
    expect(Math.hypot(back.at(-1)!.x - join.x, back.at(-1)!.z - join.z)).toBeCloseTo(s);
  });
  it('keeps both lanes clear of the walls around the building', () => {
    for (const join of [
      { x: 2.5, y: 0, z: 0 },
      { x: 0, y: 0, z: 3.5 },
      { x: -2.5, y: 0, z: -3 },
    ])
      for (const lane of ['out', 'in'] as const) {
        const route = entranceConnector(hall, join, lane);
        for (let i = 3; i < route.length; i++) {
          const a = route[i - 1]!,
            b = route[i]!;
          for (let t = 0; t <= 1; t += 0.05) {
            const x = a.x + (b.x - a.x) * t,
              z = a.z + (b.z - a.z) * t;
            expect(
              Math.abs(x) >= hall.width / 2 + WORKER_RADIUS - 1e-6 ||
                Math.abs(z) >= hall.depth / 2 + WORKER_RADIUS - 1e-6,
              `${lane} ${JSON.stringify(join)} ${x},${z}`,
            ).toBe(true);
          }
        }
      }
  });
  it('merges each lane onto the road beyond the join when the straight merge clears the body', () => {
    const points = [
      { x: -1.0, y: 0, z: 0 },
      { x: -2.5, y: 0, z: 0 },
      { x: -2.5, y: 0, z: 2.5 },
      { x: -2.5, y: 0, z: 5 },
    ];
    const single = doorConnector(hall, points)!;
    expect(single.route.at(-1)).toEqual(points[1]);
    expect(single.resume).toBe(2);
    const out = doorConnector(hall, points, 'out')!,
      back = doorConnector(hall, points, 'in')!,
      s = doorLaneSpacing(hall)!;
    expect(out.resume).toBe(2);
    expect(back.resume).toBe(2);
    expect(out.route.at(-1)!.lane).toBe('out');
    expect(back.route.at(-1)!.lane).toBe('in');
    // The road beyond runs along the door face (+z): the exit join moves to
    // the leaver's right of that road (+x, the hall side when heading +z), the
    // entry join to the entrant's right (-x); the merge legs stay apart.
    expect(out.route.at(-1)!.x).toBeCloseTo(-2.5 + 0.22);
    expect(out.route.at(-1)!.z).toBeCloseTo(s);
    expect(back.route.at(-1)!.x).toBeCloseTo(-2.5 - 0.22);
    expect(back.route.at(-1)!.z).toBeCloseTo(-s);
    // A road straight ahead needs no such shift: the lanes already sit apart.
    const ahead = [points[0]!, points[1]!, { x: -5, y: 0, z: 0 }];
    expect(doorConnector(hall, ahead, 'out')!.route.at(-1)).toMatchObject({ x: -2.5, z: s });
    expect(doorConnector(hall, ahead, 'in')!.route.at(-1)).toMatchObject({ x: -2.5, z: -s });
    // A road ending at the join keeps the join as the shared merge.
    const short = doorConnector(hall, points.slice(0, 2), 'out')!;
    expect(short.resume).toBe(1);
    expect(short.route.at(-1)).toMatchObject({ x: -2.5, z: s });
    // A merge that would cut through the body corner falls back to the join as well.
    const behind = [
      { x: -1.0, y: 0, z: 0 },
      { x: -2.5, y: 0, z: 0 },
      { x: 0, y: 0, z: 3.5 },
    ];
    expect(doorConnector(hall, behind, 'in')!.resume).toBe(1);
    expect(doorConnector(hall, behind, 'in')!.route.at(-1)).toMatchObject({ x: -2.5, z: -s });
    // A single door gives the untagged connector, in both directions.
    const narrow = buildingPlan(input);
    expect(doorConnector(narrow, points, 'in')!.route).toEqual(entranceConnector(narrow, points[1]!));
    expect(doorConnector(narrow, points, 'in')!.resume).toBe(2);
    expect(doorConnector(hall, [points[0]!])).toBeNull();
  });
});

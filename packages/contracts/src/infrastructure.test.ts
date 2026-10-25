import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  emptyInfrastructure,
  applyInfrastructure,
  infrastructureQuote,
  infrastructureSurface,
  infrastructureBorders,
  infrastructurePlanSurface,
  infrastructureSidewalkSurface,
  prepareInfrastructureEdit,
  createInfrastructureEditContext,
  RoadStrokeSchema,
  CART_ROAD_HALF_WIDTH,
  snapToCellBoundary,
  type RoadMaterial,
  type RoadStroke,
} from './infrastructure.js';
const world = { widthCells: 64, heightCells: 64 };
const stroke = (x0: number, x1: number, border = false): RoadStroke => ({
  id: 'r',
  points: [
    { x: x0, y: 80 },
    { x: x1, y: 80 },
  ],
  width: 4,
  material: 'stone-1',
  border,
  operation: 'paint',
});
describe('cart road (route charretière)', () => {
  // Centreline on the boundary between cells 10 and 11 (subdivision 8 × 10 + 4), one cell long.
  const cart = (material: RoadMaterial): RoadStroke => ({
    id: 'cart',
    points: [
      { x: 80, y: 84 },
      { x: 88, y: 84 },
    ],
    width: CART_ROAD_HALF_WIDTH,
    material,
    border: true,
    operation: 'paint',
  });
  it('accepts half-width 12 and still rejects anything wider', () => {
    expect(Value.Check(RoadStrokeSchema, cart('stone-1'))).toBe(true);
    expect(Value.Check(RoadStrokeSchema, { ...cart('stone-1'), width: 13 })).toBe(false);
  });
  it('snaps both coordinates to the nearest cell boundary', () => {
    expect(snapToCellBoundary({ x: 81, y: 87 })).toEqual({ x: 84, y: 84 });
    expect(snapToCellBoundary({ x: 88, y: 0 })).toEqual({ x: 92, y: 4 });
  });
  it('fills exactly two cells with a 3.75 m roadway and its two sidewalks', () => {
    const surface = infrastructureSurface([cart('stone-1')], world);
    const ys = [...surface.values()].map((p) => p.y);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([156, 179]); // 24 px = 3.75 m
    const sidewalks = [...infrastructureSidewalkSurface(surface, world).values()].map((p) => p.y);
    // Cells 10 and 11 span pixels 152 to 183 included: sidewalks fill the rest of both cells.
    expect([Math.min(...sidewalks), Math.max(...sidewalks)]).toEqual([152, 183]);
  });
  it('quotes eight stones per paved cell of length with the validated rates', () => {
    const a = emptyInfrastructure(),
      b = applyInfrastructure(a, { kind: 'road', stroke: cart('stone-1') }, 'cart');
    // 24 × 16 roadway pixels at 4 units, plus 2 × 16 sidewalk edges at 16 units.
    expect(infrastructureQuote(a, b, world)).toEqual({
      stoneUnits: 24 * 16 * 4 + 32 * 16,
      stoneDebit: 8,
      woodDebit: 0,
      reserveAfter: 0,
    });
  });
  it('charges only the sidewalks for earth and rubble cart roads', () => {
    for (const material of ['earth', 'rubble'] as const) {
      const a = emptyInfrastructure(),
        b = applyInfrastructure(a, { kind: 'road', stroke: cart(material) }, 'cart');
      expect(infrastructureQuote(a, b, world).stoneDebit).toBe(2);
    }
  });
});
describe('infrastructure geometry and payment', () => {
  it('quotes a half-cell-wide road and its two sides exactly', () => {
    const a = emptyInfrastructure(),
      b = applyInfrastructure(a, { kind: 'road', stroke: stroke(80, 88, true) }, 'one');
    expect(infrastructureQuote(a, b, world)).toEqual({
      stoneUnits: 1024,
      stoneDebit: 4,
      woodDebit: 0,
      reserveAfter: 0,
    });
    expect(infrastructureBorders(infrastructureSurface(b.roads, world), world).size).toBe(32);
  });
  it('does not pay twice for unchanged surfaces or split strokes', () => {
    const a = emptyInfrastructure();
    let b = a,
      total = 0;
    for (let i = 0; i < 8; i++) {
      const c = applyInfrastructure(b, { kind: 'road', stroke: stroke(80 + i, 81 + i) }, String(i));
      const q = infrastructureQuote(b, c, world);
      total += q.stoneDebit;
      c.stoneReserve = q.reserveAfter;
      b = c;
    }
    expect(total).toBe(2);
    expect(b.stoneReserve).toBe(0);
    expect(
      infrastructureQuote(b, applyInfrastructure(b, { kind: 'road', stroke: stroke(80, 88) }, 'again'), world)
        .stoneUnits,
    ).toBe(0);
  });
  it('preserves lighting control after removal of the last manual equipment', () => {
    let p = applyInfrastructure(
      emptyInfrastructure(),
      { kind: 'place', position: { x: 80, y: 80 }, quarterTurns: 0 },
      'b',
    );
    p = applyInfrastructure(p, { kind: 'delete', id: 'b', version: 1 }, 'd');
    expect(p.manualLighting).toEqual(['10:10']);
    p = applyInfrastructure(p, { kind: 'lighting', cell: '10:10' }, 'l');
    expect(p.manualLighting).toEqual([]);
  });
  it('crosses the seam locally instead of rasterizing the whole world', () => {
    const s = stroke(511, 1);
    expect(infrastructureSurface([s], world).size).toBe(32);
  });
});

it('persists free earth and rubble surfaces and erases captured automatic roads with the none brush', () => {
  const world = { widthCells: 512, heightCells: 256 };
  const state = {
    world,
    cells: [],
    travelRoutes: [
      {
        id: 'auto',
        kind: 'building' as const,
        cells: [
          { cellX: 10, cellY: 10 },
          { cellX: 11, cellY: 10 },
        ],
      },
    ],
    infrastructure: emptyInfrastructure(),
  } as unknown as Parameters<typeof prepareInfrastructureEdit>[0];
  for (const material of ['earth', 'rubble'] as const) {
    const road = { ...stroke(80, 88), material, border: false };
    expect(Value.Check(RoadStrokeSchema, road)).toBe(true);
    const result = prepareInfrastructureEdit(state, { kind: 'road', stroke: road }, 'free');
    expect(result.surface).toEqual(infrastructurePlanSurface(result.next, world));
    expect(result.quote).toEqual({ stoneUnits: 0, stoneDebit: 0, woodDebit: 0, reserveAfter: 0 });
    // JSON is the existing durable plan format, also used by authoritative frames.
    const roundtrip = JSON.parse(JSON.stringify(result.next));
    expect([...infrastructureSurface(roundtrip.roads, world).values()].every((p) => p.material === material)).toBe(
      true,
    );
    const erased = prepareInfrastructureEdit(
      { ...state, infrastructure: roundtrip },
      { kind: 'road', stroke: { ...road, material: 'none', operation: 'remove' } },
      'erase',
    );
    expect(erased.quote.stoneDebit).toBe(0);
    expect(
      [...infrastructureSurface(erased.next.roads, world).values()].every(
        (p) => !p.manual && p.material === 'none' && !p.border,
      ),
    ).toBe(true);
  }
  const erased = prepareInfrastructureEdit(
    state,
    { kind: 'road', stroke: { ...stroke(80, 88), material: 'none', operation: 'remove' } },
    'erase-auto',
  );
  expect(erased.next.inheritedCells?.length).toBeGreaterThan(0);
  expect(erased.next.roads.at(-1)?.operation).toBe('remove');
});

it('reuses a gesture baseline without changing full-raster prices, captured paths or seam repaint widths', () => {
  const world = { widthCells: 512, heightCells: 256 };
  const state: Parameters<typeof prepareInfrastructureEdit>[0] = {
    world,
    cells: [],
    travelRoutes: [
      {
        id: 'auto-y',
        kind: 'building',
        destination: { cellX: 0, cellY: 0 },
        cells: [
          { cellX: 0, cellY: 255 },
          { cellX: 0, cellY: 0 },
        ],
      },
      {
        id: 'auto-x',
        kind: 'building',
        destination: { cellX: 0, cellY: 255 },
        cells: [
          { cellX: 511, cellY: 255 },
          { cellX: 0, cellY: 255 },
        ],
      },
    ],
    infrastructure: emptyInfrastructure(),
  };
  const operations: RoadStroke[] = [
    {
      id: 'wide',
      points: [
        { x: 4092, y: 2040 },
        { x: 4, y: 2040 },
      ],
      width: 8,
      material: 'stone-1',
      border: true,
      operation: 'paint',
    },
    {
      id: 'cross',
      points: [
        { x: 0, y: 2032 },
        { x: 0, y: 8 },
      ],
      width: 4,
      material: 'stone-2',
      border: true,
      operation: 'paint',
    },
    {
      id: 'narrow',
      points: [
        { x: 4092, y: 2040 },
        { x: 4, y: 2040 },
      ],
      width: 2,
      material: 'stone-1',
      border: false,
      operation: 'paint',
    },
    {
      id: 'erase',
      points: [
        { x: 4094, y: 2040 },
        { x: 2, y: 2040 },
      ],
      width: 4,
      material: 'none',
      border: false,
      operation: 'remove',
    },
  ];
  for (const stroke of operations) {
    const ctx = createInfrastructureEditContext(state),
      before = JSON.stringify(state),
      edit = prepareInfrastructureEdit(state, { kind: 'road', stroke }, stroke.id, ctx);
    expect(edit.beforeSurface).toEqual(infrastructurePlanSurface(state.infrastructure!, world));
    expect(edit.surface).toEqual(infrastructurePlanSurface(edit.next, world));
    const capturedBase = { ...edit.next, roads: edit.next.roads.slice(0, -1) };
    expect(edit.quote).toEqual(infrastructureQuote(capturedBase, edit.next, world, 0, false));
    expect(JSON.stringify(state)).toBe(before);
    expect(prepareInfrastructureEdit(state, { kind: 'road', stroke }, stroke.id, ctx)).toEqual(edit);
    state.infrastructure = edit.next;
    expect(() => prepareInfrastructureEdit(state, { kind: 'road', stroke }, 'stale', ctx)).toThrow(
      'Contexte spatial périmé',
    );
  }
});

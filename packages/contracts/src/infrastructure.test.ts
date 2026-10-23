import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  emptyInfrastructure,
  applyInfrastructure,
  infrastructureQuote,
  infrastructureSurface,
  infrastructureBorders,
  infrastructurePlanSurface,
  prepareInfrastructureEdit,
  createInfrastructureEditContext,
  RoadStrokeSchema,
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

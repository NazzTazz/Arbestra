import { describe, expect, it } from 'vitest';
import { orderedTerrainEditGestures, predictTerrainEdits, terrainEditCells, terrainEditUnit } from './terrain-edits.js';
import { vertexKey, vertexLeveling } from './terrain-vertices.js';

const world = { widthCells: 64, heightCells: 32 };
/** A sloped ground: every vertex at its own height. */
const ground = (x: number, y: number) => 0.25 + x * 0.01 + y * 0.02;
const cell = (cellX: number, cellY: number) => ({ cellX, cellY });

describe('terrain edit units (docs/SPEC-TERRAFORMATION-OUTIL.md §7)', () => {
  it('orders the painted cells canonically and writes the four corners of each at the height', () => {
    expect(
      terrainEditCells({ anchor: cell(5, 3), cells: [cell(5, 3), cell(2, 9), cell(2, 1)], height: 1 }, world),
    ).toEqual([cell(2, 1), cell(2, 9), cell(5, 3)]);
    const unit = terrainEditUnit(cell(5, 3), world, ground, 1.5);
    expect(unit.vertices.map(vertexKey).sort()).toEqual(['5:3', '5:4', '6:3', '6:4']);
    expect(unit.vertices.every((v) => v.height === 1.5)).toBe(true);
    // Its 3 × 3: the cells that share one of its corners.
    expect(unit.affectedCells).toHaveLength(9);
  });

  it('predicts a stroke exactly as the all-or-nothing leveling of its cells', () => {
    const stroke = [cell(10, 10), cell(11, 10), cell(11, 11), cell(30, 5)];
    const predicted = predictTerrainEdits([{ anchor: stroke[0]!, cells: stroke, height: 2 }], world, ground);
    const whole = vertexLeveling(stroke, world, ground, 1, 2).vertices;
    expect([...predicted.values()].sort((a, b) => a.vertexX - b.vertexX || a.vertexY - b.vertexY)).toEqual(whole);
  });

  it('lets a later gesture win a shared vertex, on the seam of the torus too', () => {
    const predicted = predictTerrainEdits(
      [
        { anchor: cell(63, 0), cells: [cell(63, 0)], height: 1 },
        { anchor: cell(0, 0), cells: [cell(0, 0)], height: 3 },
      ],
      world,
      ground,
    );
    // (63,0) and (0,0) share the vertices x = 0 (the seam), y = 0 and 1.
    expect(predicted.get('63:0')!.height).toBe(1);
    expect(predicted.get('0:0')!.height).toBe(3);
    expect(predicted.get('0:1')!.height).toBe(3);
    expect(predicted.get('1:0')!.height).toBe(3);
  });

  it('builds gestures the server applies in the painting order, the same heights as painting cell by cell', () => {
    // A seeded walk across the torus seam, back and forth, with height changes
    // mid-stroke and cells painted again at another height.
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let run = 0; run < 20; run++) {
      const paints: { cell: { cellX: number; cellY: number }; height: number }[] = [];
      let x = 60,
        y = 10,
        height = 1;
      for (let i = 0; i < 200; i++) {
        x = (x + Math.floor(random() * 3) - 1 + world.widthCells) % world.widthCells;
        y = (y + Math.floor(random() * 3) - 1 + world.heightCells) % world.heightCells;
        if (random() < 0.05) height += (Math.floor(random() * 5) - 2) * 0.25;
        paints.push({ cell: cell(x, y), height });
      }
      // Painting cell by cell, each on the heights the previous ones left: the live stroke.
      const live = new Map<string, number>();
      const at = (vx: number, vy: number) => live.get(`${vx}:${vy}`) ?? ground(vx, vy);
      for (const p of paints) {
        const unit = terrainEditUnit(p.cell, world, at, p.height);
        if (unit.volume >= 1e-9) for (const v of unit.vertices) live.set(vertexKey(v), v.height);
      }
      // Sent in commands cut anywhere, each continuing its own gestures.
      const cut = 1 + Math.floor(random() * 199);
      const gestures = [
        ...orderedTerrainEditGestures(paints.slice(0, cut)),
        ...orderedTerrainEditGestures(paints.slice(cut)),
      ];
      // The server's order (terrainEditCells per gesture) is the painting order.
      expect(gestures.flatMap((g) => terrainEditCells(g, world).map((c) => ({ cell: c, height: g.height })))).toEqual(
        paints,
      );
      for (const g of gestures) expect(g.cells.length).toBeLessThanOrEqual(256);
      const predicted = predictTerrainEdits(gestures, world, ground);
      expect(new Map([...predicted].map(([k, v]) => [k, v.height]))).toEqual(live);
    }
  });

  it('writes nothing for a unit already at its height', () => {
    const flat = () => 1;
    expect(predictTerrainEdits([{ anchor: cell(4, 4), cells: [cell(4, 4)], height: 1 }], world, flat).size).toBe(0);
  });
});

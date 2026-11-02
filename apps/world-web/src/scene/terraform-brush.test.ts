import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { describe, expect, it } from 'vitest';
import { vertexLeveling } from '@arbestra/contracts';
import {
  BRUSH_VERTICES,
  BrushCursor,
  TerraformBrush,
  brushCells,
  brushColors,
  brushVertexIndex,
  sampleBrushHeights,
} from './terraform-brush';
import { CELL_UNITS, WorldSpace } from './world-space';

const world = { widthCells: 512, heightCells: 256 };
const slope = (x: number, y: number) => 1 + x * 0.01 + y * 0.001;

describe('terraforming brush geometry', () => {
  it('covers exactly the cells and vertices the server changes for one painted cell', () => {
    // The server's plan for one cell: its four corners, and the cells sharing them.
    const plan = vertexLeveling([{ cellX: 511, cellY: 0 }], world, slope, 1, 2);
    const key = (c: { cellX: number; cellY: number }) => `${c.cellX}:${c.cellY}`;
    expect(new Set(brushCells({ cellX: 511, cellY: 0 }, world).map(key))).toEqual(new Set(plan.affectedCells.map(key)));
    const heights = new Float64Array(BRUSH_VERTICES);
    expect(sampleBrushHeights({ cellX: 511, cellY: 0 }, 2, world, slope, heights)).toBe(true);
    // Inner corners take the target, as the server writes them; the others stay.
    for (const v of plan.vertices) {
      const dx = (v.vertexX - 511 + 512) % 512,
        dy = v.vertexY;
      expect(heights[brushVertexIndex(dx, dy)]).toBe(v.height);
    }
    expect(heights[brushVertexIndex(-1, -1)]).toBe(slope(510, 255));
    expect(heights[brushVertexIndex(2, 2)]).toBe(slope(1, 2));
  });

  it('keeps the inner corners as they are while no height is chosen', () => {
    const heights = new Float64Array(BRUSH_VERTICES);
    sampleBrushHeights({ cellX: 10, cellY: 10 }, null, world, slope, heights);
    expect(heights[brushVertexIndex(0, 0)]).toBe(slope(10, 10));
    expect(heights[brushVertexIndex(1, 1)]).toBe(slope(11, 11));
  });

  it('fades from the opaque centre to a transparent outer edge', () => {
    const colors = brushColors('paint', 1);
    const alpha = (dx: number, dy: number) => colors[brushVertexIndex(dx, dy) * 4 + 3];
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const)
      expect(alpha(dx, dy)).toBe(1);
    for (const [dx, dy] of [
      [-1, -1],
      [2, -1],
      [-1, 2],
      [2, 2],
      [0, -1],
      [-1, 1],
      [2, 0],
      [1, 2],
    ] as const)
      expect(alpha(dx, dy)).toBe(0);
  });
});

describe('terraforming brush hot path', () => {
  it('reads at most 16 heights per changed hover and none on the same cell', () => {
    let calls = 0;
    const counted = (x: number, y: number) => {
      calls++;
      return slope(x, y);
    };
    const cursor = new BrushCursor();
    expect(cursor.update({ cellX: 4, cellY: 4 }, null, 0, world, counted)).toBe('drawn');
    expect(calls).toBeLessThanOrEqual(16);
    calls = 0;
    // 120 frames of hover over the same cell: no work.
    for (let frame = 0; frame < 120; frame++)
      expect(cursor.update({ cellX: 4, cellY: 4 }, null, 0, world, counted)).toBe('same');
    expect(calls).toBe(0);
    // A chosen height reads only the 12 outer corners.
    expect(cursor.update({ cellX: 4, cellY: 4 }, 3, 0, world, counted)).toBe('drawn');
    expect(calls).toBe(12);
    calls = 0;
    expect(cursor.update({ cellX: 4, cellY: 4 }, 3, 1, world, counted)).toBe('drawn');
    expect(calls).toBe(12);
  });

  it('reports a ground not loaded yet and retries on the next hover', () => {
    const cursor = new BrushCursor();
    expect(cursor.update({ cellX: 4, cellY: 4 }, null, 0, world, () => NaN)).toBe('missing');
    expect(cursor.update({ cellX: 4, cellY: 4 }, null, 0, world, slope)).toBe('drawn');
  });

  it('rewrites the same two meshes, never adds one, and places the vertices at the future heights', () => {
    const engine = new NullEngine(),
      scene = new Scene(engine),
      space = new WorldSpace(512, 256, { cellX: 0, cellY: 0 });
    const brush = new TerraformBrush(scene);
    try {
      const meshes = scene.meshes.length,
        heights = new Float64Array(BRUSH_VERTICES);
      for (let x = 0; x < 50; x++) {
        sampleBrushHeights({ cellX: x, cellY: 3 }, 2, world, slope, heights);
        brush.show({ cellX: x, cellY: 3 }, heights, x % 2 ? 'paint' : 'refused', space);
      }
      expect(scene.meshes.length).toBe(meshes);
      expect(brush.writes).toBe(50);
      const fill = scene.meshes.find((m) => m.name === 'terraform-brush')!;
      const positions = fill.getVerticesData('position')!;
      expect(positions).toHaveLength(48);
      const centre = space.project({ cellX: 49, cellY: 3 });
      const inner = brushVertexIndex(0, 0);
      expect(positions[inner * 3]).toBeCloseTo(centre.x - 0.5 * CELL_UNITS);
      expect(positions[inner * 3 + 1]).toBeCloseTo(2 * CELL_UNITS + 0.04);
      expect(positions[inner * 3 + 2]).toBeCloseTo(centre.z - 0.5 * CELL_UNITS);
      const outer = brushVertexIndex(2, 2);
      expect(positions[outer * 3 + 1]).toBeCloseTo(slope(51, 5) * CELL_UNITS + 0.04);
      expect(fill.getTotalIndices()).toBe(54);
      expect(fill.isPickable).toBe(false);
      brush.hide();
      expect(fill.isEnabled()).toBe(false);
    } finally {
      brush.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
});

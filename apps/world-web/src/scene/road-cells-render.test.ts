import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { emptyInfrastructure, infrastructurePlanSurface, type RoadCellSurface } from '@arbestra/contracts';
import { InfrastructureRenderer } from './infrastructure-renderer';
import { RoadCellPreview } from './road-cell-preview';
import { RoadCellsPlan } from './road-cells-plan';
import { WorldSpace } from './world-space';

const world = { widthCells: 64, heightCells: 64 };
const cell = (cellX: number, cellY: number, surface: RoadCellSurface = 'earth', sidewalks = false) => ({
  id: `${cellX},${cellY}`,
  cellX,
  cellY,
  surface,
  sidewalks,
  gauge: 'chemin' as const,
  revision: 1,
});
/** Arms painted from the centre of (x, y): bit 0 east, 1 south, 2 west, 3 north. */
function arms(cells: ReturnType<typeof cell>[], x: number, y: number) {
  const surface = infrastructurePlanSurface(new RoadCellsPlan().compose(emptyInfrastructure(), cells), world),
    manual = (px: number, py: number) => Boolean(surface.get(`${(px + 1024) % 1024}:${(py + 1024) % 1024}`)?.manual);
  const cx = x * 16,
    cy = y * 16;
  expect(manual(cx, cy)).toBe(true);
  return (
    (manual(cx + 6, cy) ? 1 : 0) |
    (manual(cx, cy + 6) ? 2 : 0) |
    (manual(cx - 6, cy) ? 4 : 0) |
    (manual(cx, cy - 6) ? 8 : 0)
  );
}

describe('road cell tiles inferred from the four neighbours', () => {
  it('draws an end, a straight, an elbow, a T and a crossing', () => {
    // End: a single neighbour to the east.
    expect(arms([cell(10, 10), cell(11, 10)], 10, 10)).toBe(1);
    // Straight: east and west.
    expect(arms([cell(9, 10), cell(10, 10), cell(11, 10)], 10, 10)).toBe(1 | 4);
    // Elbow: east and south.
    expect(arms([cell(10, 10), cell(11, 10), cell(10, 11)], 10, 10)).toBe(1 | 2);
    // T: east, west and north.
    expect(arms([cell(9, 10), cell(10, 10), cell(11, 10), cell(10, 9)], 10, 10)).toBe(1 | 4 | 8);
    // Crossing: the four sides.
    expect(arms([cell(9, 10), cell(10, 10), cell(11, 10), cell(10, 9), cell(10, 11)], 10, 10)).toBe(15);
    // Isolated: the centre only; diagonal cells do not connect.
    expect(arms([cell(10, 10), cell(11, 11)], 10, 10)).toBe(0);
  });
  it('connects across the toric seam', () => {
    expect(arms([cell(63, 5), cell(0, 5)], 0, 5)).toBe(4);
  });
});

describe('RoadCellsPlan', () => {
  it('keeps the composed plan while the cells content does not change', () => {
    const composer = new RoadCellsPlan(),
      plan = emptyInfrastructure();
    expect(composer.compose(plan, undefined)).toBe(plan);
    const first = composer.compose(plan, [cell(1, 1)]);
    expect(first.roadCells).toEqual([{ cellX: 1, cellY: 1, surface: 'earth', sidewalks: false }]);
    // V2 rebuilds the array on every delta: same content, same plan.
    expect(composer.compose(plan, [cell(1, 1)])).toBe(first);
    expect(composer.compose(plan, [cell(1, 1, 'stone-1')])).not.toBe(first);
  });
});

describe('road cells rendering', () => {
  it('regenerates only the sectors around a changed cell', () => {
    const engine = new NullEngine(),
      scene = new Scene(engine),
      renderer = new InfrastructureRenderer(scene, true),
      composer = new RoadCellsPlan();
    try {
      const space = new WorldSpace(world.widthCells, world.heightCells, { cellX: 0, cellY: 0 }),
        base = emptyInfrastructure(),
        // A long earth line over many 8-cell sectors and a stone line elsewhere.
        cells = [
          ...Array.from({ length: 48 }, (_, i) => cell(4 + i, 20)),
          ...Array.from({ length: 24 }, (_, i) => cell(4 + i, 40, 'stone-1', true)),
        ];
      const update = (list: typeof cells) =>
        renderer.update(composer.compose(base, list), space, () => 1, false, 1, undefined, false, [], {
          followTerrain: true,
          groundIdentity: 'stable',
        });
      update(cells);
      const before = new Set(renderer.meshes);
      expect(before.size).toBeGreaterThan(8);
      // An unrelated publication with the same cells changes nothing.
      update(cells.map((c) => ({ ...c })));
      expect(renderer.meshes.every((m) => before.has(m))).toBe(true);
      // One more cell under the earth line: its sector (and at most a neighbour) only.
      update([...cells, cell(30, 21)]);
      const rebuilt = renderer.meshes.filter((m) => !before.has(m));
      expect(rebuilt.length).toBeGreaterThan(0);
      expect(rebuilt.length).toBeLessThanOrEqual(2);
      expect(rebuilt.every((m) => m.name === 'infrastructure-earth')).toBe(true);
    } finally {
      renderer.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
  it('adds one preview instance per new cell, never rebuilding the designation', () => {
    const engine = new NullEngine(),
      scene = new Scene(engine),
      preview = new RoadCellPreview(scene);
    try {
      for (let i = 0; i < 40; i++) preview.add(`${i}:0`, i, 0, 0, 2);
      preview.add('3:0', 3, 0, 0, 2);
      expect(preview.count).toBe(40);
      const mesh = scene.getMeshByName('road-cell-preview')!;
      expect(mesh.isEnabled()).toBe(true);
      preview.clear();
      expect(preview.count).toBe(0);
      expect(mesh.isEnabled()).toBe(false);
    } finally {
      preview.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
});

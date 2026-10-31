import { describe, expect, it } from 'vitest';
import type { VillageState } from '@arbestra/contracts';
import { footprintTerraformVisual, localTerraform, mergeTerraformVisuals } from './terraform-draft';

const world = { widthCells: 64, heightCells: 64 };
const state = (roadCells: Array<{ cellX: number; cellY: number }> = []) =>
  ({
    world,
    village: { anchorCellX: 32, anchorCellY: 32 },
    cells: Array.from({ length: 100 }, (_, i) => ({
      cellX: 10 + (i % 10),
      cellY: 10 + Math.floor(i / 10),
      canBuild: true,
    })),
    roadCells: roadCells.map((c) => ({ ...c, id: `${c.cellX},${c.cellY}` })),
  }) as unknown as VillageState;
const request = {
  buildingType: 'terrain' as const,
  anchor: { cellX: 14, cellY: 14 },
  quarterTurns: 0 as const,
  cells: [{ cellX: 14, cellY: 14 }],
  height: 1,
  workerCount: 1,
};
const flat = () => 0.25;

describe('local terraforming check', () => {
  it('accepts a stroke on free ground', () => {
    expect(localTerraform(state(), request, flat).error).toBeNull();
  });

  it('refuses a stroke whose ring touches a road cell, as the server does', () => {
    // The ring of (14,14) includes its eight neighbours; (15,15) carries a road cell.
    const checked = localTerraform(state([{ cellX: 15, cellY: 15 }]), request, flat);
    expect(checked.error).toMatch(/occupé, protégé/);
    expect(checked.visual.invalidCells).toContainEqual({ cellX: 15, cellY: 15 });
  });
});

describe('batch preview', () => {
  it('joins gestures, the later one winning a shared vertex', () => {
    const a = localTerraform(state(), { ...request, height: 1 }, flat).visual;
    const b = localTerraform(
      state(),
      { ...request, anchor: { cellX: 15, cellY: 14 }, cells: [{ cellX: 15, cellY: 14 }], height: 2 },
      flat,
    ).visual;
    const merged = mergeTerraformVisuals([a, b])!;
    const height = (x: number, y: number) =>
      merged.quote.vertices!.find((v) => v.vertexX === x && v.vertexY === y)?.height;
    expect(height(14, 14)).toBe(1);
    expect(height(15, 14)).toBe(2);
    expect(height(16, 14)).toBe(2);
    expect(merged.quote.cells).toHaveLength(2);
  });

  it('previews a footprint leveled flat', () => {
    const visual = footprintTerraformVisual('stonemason', { cellX: 14, cellY: 14 }, 0, world, (x) => 0.25 + x * 0.01);
    const heights = new Set(visual.quote.vertices!.map((v) => v.height));
    expect(heights.size).toBe(1);
  });
});

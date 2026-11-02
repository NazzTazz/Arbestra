import { describe, expect, it } from 'vitest';
import { vertexLeveling, type VillageState } from '@arbestra/contracts';
import { footprintTerraformVisual, localStroke } from './terraform-draft';

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
const at = (cellX: number, cellY: number) => ({ cellX, cellY });
const flat = () => 0.25;
const byVertex = (a: { vertexX: number; vertexY: number }, b: { vertexX: number; vertexY: number }) =>
  a.vertexX - b.vertexX || a.vertexY - b.vertexY;

describe('local part of a stroke (docs/SPEC-TERRAFORMATION-OUTIL.md §7)', () => {
  it('sends a stroke on free ground whole, predicted exactly as the server levels it', () => {
    const cells = [at(14, 14), at(15, 14), at(15, 15)];
    const stroke = localStroke(state(), { anchor: at(14, 14), cells, height: 1 }, flat);
    expect(stroke.refusals).toEqual([]);
    expect(stroke.gesture).toEqual({ buildingType: 'terrain', anchor: at(14, 14), cells, height: 1 });
    expect([...stroke.vertices].sort(byVertex)).toEqual(vertexLeveling(cells, world, flat, 1, 1).vertices);
  });

  it('withdraws the painted cell whose 3 × 3 holds a road, names the road, and sends the rest', () => {
    // The ring of (14,14) holds (15,15); (12,12)'s ring does not.
    const stroke = localStroke(
      state([at(15, 15)]),
      { anchor: at(14, 14), cells: [at(14, 14), at(12, 12)], height: 1 },
      flat,
    );
    expect(stroke.refusals).toEqual([{ reason: 'road', cell: at(15, 15) }]);
    // The anchor was withdrawn: the first accepted cell anchors the gesture.
    expect(stroke.gesture).toEqual({ buildingType: 'terrain', anchor: at(12, 12), cells: [at(12, 12)], height: 1 });
    expect(stroke.vertices.map((v) => `${v.vertexX}:${v.vertexY}`).sort()).toEqual([
      '12:12',
      '12:13',
      '13:12',
      '13:13',
    ]);
  });

  it('sends nothing when every painted cell is refused', () => {
    const stroke = localStroke(state([at(15, 15)]), { anchor: at(15, 15), cells: [at(15, 15)], height: 1 }, flat);
    expect(stroke.gesture).toBeNull();
    expect(stroke.vertices).toEqual([]);
    expect(stroke.refusals).toEqual([{ reason: 'road', cell: at(15, 15) }]);
  });

  it('refuses a stroke at or under the water line as one error', () => {
    const stroke = localStroke(state(), { anchor: at(14, 14), cells: [at(14, 14), at(15, 14)], height: 0 }, flat);
    expect(stroke.gesture).toBeNull();
    expect(stroke.refusals).toEqual([{ reason: 'water', cell: at(14, 14) }]);
  });

  it('sends nothing and hints when the ground is already at the height', () => {
    const stroke = localStroke(state(), { anchor: at(14, 14), cells: [at(14, 14)], height: 0.25 }, flat);
    expect(stroke.gesture).toBeNull();
    expect(stroke.hint).toBe('Le terrain est déjà à cette hauteur.');
  });

  it('throws when the ground is not loaded, rather than predicting from nothing', () => {
    expect(() => localStroke(state(), { anchor: at(14, 14), cells: [at(14, 14)], height: 1 }, () => NaN)).toThrow();
  });

  it('previews a footprint leveled flat', () => {
    const visual = footprintTerraformVisual('stonemason', at(14, 14), 0, world, (x) => 0.25 + x * 0.01);
    const heights = new Set(visual.quote.vertices!.map((v) => v.height));
    expect(heights.size).toBe(1);
  });
});

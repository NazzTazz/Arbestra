import { describe, expect, it } from 'vitest';
import type { VillageState } from '@arbestra/contracts';
import {
  cellRefusal,
  cellRefused,
  mergeWaterPages,
  oraclePages,
  serverRefusal,
  serverRefusalReason,
  terraformObstacles,
  unitRefusal,
  type TerraformRefusal,
} from './terraform-refusals';

const world = { widthCells: 64, heightCells: 64 };
/** Buildable 10 × 10 square at (10..19, 10..19), a house at (12,12), a road at (15,15). */
const state = () =>
  ({
    world,
    village: { anchorCellX: 32, anchorCellY: 32 },
    cells: [
      ...Array.from({ length: 100 }, (_, i) => ({
        cellX: 10 + (i % 10),
        cellY: 10 + Math.floor(i / 10),
        canBuild: !(i % 10 === 2 && Math.floor(i / 10) === 2),
        footprint:
          i % 10 === 2 && Math.floor(i / 10) === 2
            ? { buildingId: 'h', buildingType: 'house', role: 'anchor', state: 'active' }
            : null,
        building: null,
      })),
    ],
    roadCells: [{ id: '15,15', cellX: 15, cellY: 15 }],
  }) as unknown as VillageState;

describe('client terraforming rules', () => {
  it('classifies each cell as the server would refuse it', () => {
    const s = state(),
      o = terraformObstacles(s);
    expect(cellRefusal(o, { cellX: 14, cellY: 14 }, world)).toBeNull();
    expect(cellRefusal(o, { cellX: 15, cellY: 15 }, world)).toBe('road');
    expect(cellRefusal(o, { cellX: 12, cellY: 12 }, world)).toBe('building');
    // Not buildable but within reach of the house: the ground itself.
    expect(cellRefusal(o, { cellX: 9, cellY: 12 }, world)).toBe('nature');
    // Beyond the reach of any finished building.
    expect(cellRefusal(o, { cellX: 40, cellY: 40 }, world)).toBe('reach');
    expect(cellRefused(o, { cellX: 14, cellY: 14 })).toBe(false);
    expect(cellRefused(o, { cellX: 15, cellY: 15 })).toBe(true);
  });

  it('indexes a state once, not per hover', () => {
    const s = state();
    expect(terraformObstacles(s)).toBe(terraformObstacles(s));
  });

  it('maps the server refusal codes to the same reasons', () => {
    expect(serverRefusalReason('INFRASTRUCTURE_OCCUPIED')).toBe('road');
    expect(serverRefusalReason('CELL_OCCUPIED')).toBe('building');
    expect(serverRefusalReason('LEVELING_WATER')).toBe('water');
    expect(serverRefusalReason('OUTSIDE_VILLAGE_REACH')).toBe('reach');
    expect(serverRefusalReason('SOMETHING_ELSE')).toBeNull();
  });
});

describe('one painted cell, one unit (§7)', () => {
  const at = (cellX: number, cellY: number) => ({ cellX, cellY });
  it('names the painted cell itself first, then its ring, infrastructure before the ground', () => {
    const o = terraformObstacles(state());
    expect(unitRefusal(o, at(14, 14), world)).toEqual({ reason: 'road', cell: at(15, 15) });
    expect(unitRefusal(o, at(12, 12), world)).toEqual({ reason: 'building', cell: at(12, 12) });
    expect(unitRefusal(o, at(17, 17), world)).toBeNull();
    expect(unitRefusal(o, at(11, 13), world)).toEqual({ reason: 'building', cell: at(12, 12) });
    expect(unitRefusal(o, at(13, 14), world)).toBeNull();
    // A ring with the house (12,12) met first and a road (13,13) after: the road is named.
    const both = { ...o, roads: new Set(['13:13']) };
    expect(unitRefusal(both, at(12, 13), world)).toEqual({ reason: 'road', cell: at(13, 13) });
    expect(unitRefusal(o, at(16, 16), world)).toEqual({ reason: 'road', cell: at(15, 15) });
  });

  it('reads a server refusal at its obstacle: a fixture without a road there, unknown codes as other', () => {
    const o = terraformObstacles(state());
    expect(serverRefusal('INFRASTRUCTURE_OCCUPIED', at(15, 15), o)).toEqual({ reason: 'road', cell: at(15, 15) });
    const withFixture = { ...o, fixtures: new Set(['18:18']) };
    expect(serverRefusal('INFRASTRUCTURE_OCCUPIED', at(18, 18), withFixture).reason).toBe('fixture');
    expect(serverRefusal('BUILDING_LIMIT_REACHED', at(3, 3), o)).toEqual({ reason: 'other', cell: at(3, 3) });
  });
});

describe('the Oracle tells one error per page', () => {
  const at = (cellX: number, cellY: number) => ({ cellX, cellY });
  it('uses Tristan’s sentence, in the singular, and inspects the road cell, which pulses', () => {
    expect(oraclePages([{ reason: 'road', cell: at(15, 15) }])).toEqual([
      {
        reason: 'road',
        text: 'Une route sur ce terrain empêche de démarrer les travaux.',
        inspect: at(15, 15),
        obstacle: 'road',
      },
    ]);
  });

  it('gives each error its own page, actionable ones first, one page per obstacle cell', () => {
    const refusals: TerraformRefusal[] = [
      { reason: 'nature', cell: at(9, 12) },
      { reason: 'road', cell: at(20, 20) },
      { reason: 'building', cell: at(12, 12) },
      { reason: 'road', cell: at(15, 15) },
      // Two painted cells blocked by the same road cell: one error.
      { reason: 'road', cell: at(15, 15) },
      { reason: 'foundation', cell: at(30, 30) },
    ];
    const pages = oraclePages(refusals);
    expect(pages.map((p) => [p.reason, p.inspect])).toEqual([
      ['road', at(20, 20)],
      ['road', at(15, 15)],
      ['building', at(12, 12)],
      ['foundation', at(30, 30)],
      ['nature', at(9, 12)],
    ]);
    expect(pages.every((p) => !p.text.startsWith('Des '))).toBe(true);
    // A foundation pulses as a building; nature gets the red halo on the ground (option B, 2 November).
    expect(pages.map((p) => p.obstacle)).toEqual(['road', 'road', 'building', 'building', 'nature']);
  });

  it('merges the water of contiguous cells into one page, diagonals and the seam of the torus included', () => {
    // A stroke plunged into a lake: one server refusal per wet cell, a diagonal
    // step, and a run across the seam x = 63 → 0; a separate pond further away.
    const wet = [at(62, 5), at(63, 5), at(0, 5), at(1, 6), at(2, 6), at(30, 30)];
    const pages = oraclePages([
      { reason: 'road', cell: at(15, 15) },
      ...wet.map((cell) => ({ reason: 'water' as const, cell })),
    ]);
    expect(pages).toHaveLength(7);
    const merged = mergeWaterPages(pages, world);
    expect(merged.map((p) => p.reason)).toEqual(['road', 'water', 'water']);
    expect(merged[1]!.cells).toEqual(wet.slice(0, 5));
    // « Inspecter »: the group's cell nearest to its centre on the torus (x mean 0, y 5.4).
    expect(merged[1]!.inspect).toEqual(at(0, 5));
    expect(merged[2]).toEqual(pages[6]);
    // A page delivered later (the end of the stroke) joins its group; pages are not mutated.
    const again = mergeWaterPages([...merged, ...oraclePages([{ reason: 'water', cell: at(3, 7) }])], world);
    expect(again).toHaveLength(3);
    expect(again[1]!.cells).toHaveLength(6);
    expect(pages[1]!.cells).toBeUndefined();
    // Two cells apart: two pages.
    const apart = oraclePages([
      { reason: 'water', cell: at(10, 10) },
      { reason: 'water', cell: at(12, 10) },
    ]);
    expect(mergeWaterPages(apart, world)).toEqual(apart);
  });

  it('falls back on the anchor for a refusal without a cell, without pulse for water', () => {
    expect(oraclePages([{ reason: 'water', cell: null }], at(3, 4))).toEqual([
      {
        reason: 'water',
        text: 'À cette hauteur, l’eau s’inviterait sur le terrain. Montez un peu le réglage.',
        inspect: at(3, 4),
        obstacle: null,
      },
    ]);
    expect(oraclePages([])).toEqual([]);
  });
});

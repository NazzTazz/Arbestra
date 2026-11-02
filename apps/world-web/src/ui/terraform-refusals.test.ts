import { describe, expect, it } from 'vitest';
import type { VillageState } from '@arbestra/contracts';
import {
  cellRefusal,
  cellRefused,
  oracleRefusal,
  serverRefusalReason,
  terraformObstacles,
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

describe('the Oracle tells one refused gesture in one message', () => {
  const at = (cellX: number, cellY: number) => ({ cellX, cellY });
  it('uses Tristan’s sentence for one road cell and inspects it', () => {
    expect(oracleRefusal([{ reason: 'road', cell: at(15, 15) }], at(14, 14), world)).toEqual({
      text: 'Une route sur ce terrain empêche de démarrer les travaux.',
      more: null,
      inspect: at(15, 15),
    });
  });

  it('puts the road first, in the plural, names the others, and inspects the road cell nearest the anchor', () => {
    const refusals: TerraformRefusal[] = [
      { reason: 'nature', cell: at(9, 12) },
      { reason: 'road', cell: at(20, 20) },
      { reason: 'building', cell: at(12, 12) },
      { reason: 'road', cell: at(15, 15) },
      { reason: 'road', cell: at(15, 15) },
    ];
    const message = oracleRefusal(refusals, at(14, 14), world)!;
    expect(message.text).toBe('Des routes sur ce terrain empêchent de démarrer les travaux.');
    expect(message.more).toBe('Ailleurs dans ce geste, les travaux butent aussi sur un bâtiment et la nature.');
    expect(message.inspect).toEqual(at(15, 15));
  });

  it('measures the distance to the anchor across the seam of the torus', () => {
    const message = oracleRefusal(
      [
        { reason: 'building', cell: at(10, 0) },
        { reason: 'building', cell: at(63, 0) },
      ],
      at(1, 0),
      world,
    )!;
    expect(message.inspect).toEqual(at(63, 0));
  });

  it('falls back on the anchor when a server refusal names no cell', () => {
    expect(oracleRefusal([{ reason: 'water', cell: null }], at(3, 4), world)!.inspect).toEqual(at(3, 4));
    expect(oracleRefusal([], at(3, 4), world)).toBeNull();
  });
});

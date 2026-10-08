import { describe, expect, it } from 'vitest';
import { infrastructurePlanSurface, wrapCoordinate } from '@arbestra/contracts';
import { placeStarterVillage, translateInfrastructure } from './starter-layout.js';
import { STARTER_VILLAGE } from './starter-village.js';

describe('starter layout translation', () => {
  it('preserves buildings, road surfaces and lighting across a torus seam with fresh identities', () => {
    const world = { widthCells: 128, heightCells: 128 };
    const original = JSON.stringify(STARTER_VILLAGE);
    const first = placeStarterVillage(STARTER_VILLAGE, { x: 64, y: 64 }, world);
    const seam = placeStarterVillage(STARTER_VILLAGE, { x: 1, y: 1 }, world);
    expect(seam.buildings[0]!.cells[0]).toMatchObject({ cellX: 125, cellY: 1 });
    const firstPixels = infrastructurePlanSurface(first.infrastructure, world);
    const seamPixels = infrastructurePlanSurface(seam.infrastructure, world);
    const byPosition = new Map([...seamPixels.values()].map(p => [p.x + ':' + p.y, p]));
    expect(seamPixels.size).toBe(firstPixels.size);
    for (const pixel of firstPixels.values()) {
      const x = wrapCoordinate(pixel.x - 63 * 16, 128 * 16);
      const y = wrapCoordinate(pixel.y - 63 * 16, 128 * 16);
      const translated = byPosition.get(x + ':' + y);
      expect(translated).toMatchObject({ material: pixel.material, border: pixel.border });
    }
    expect(seam.infrastructure.manualLighting[0]).toBe('5:0');
    expect(seam.infrastructure.suppressedBraziers[0]).toBe('auto:4:0:sub:35:8:-1:-1');
    expect(seam.infrastructure.equipment[0]!.x).toBe(wrapCoordinate(STARTER_VILLAGE.infrastructure.equipment[0]!.x + 8, 1024));
    const identities = (p: typeof first) => [...p.buildings, ...p.infrastructure.roads, ...p.infrastructure.equipment].map(v => v.id);
    expect(new Set([...identities(first), ...identities(seam)]).size).toBe(identities(first).length * 2);
    expect(seam.required.every(c => c.cellX >= 0 && c.cellX < 128 && c.cellY >= 0 && c.cellY < 128)).toBe(true);
    expect(JSON.stringify(STARTER_VILLAGE)).toBe(original);
  });

  it('keeps legacy automatic lighting IDs and inherited cell references translatable', () => {
    const plan = { ...STARTER_VILLAGE.infrastructure, inheritedCells: ['-1:0'], suppressedBraziers: ['auto:-1:0:1:-1'] };
    const shifted = translateInfrastructure(plan, 1, 2, { widthCells: 128, heightCells: 128 });
    expect(shifted.inheritedCells).toEqual(['0:2']);
    expect(shifted.suppressedBraziers).toEqual(['auto:0:2:1:-1']);
  });
});

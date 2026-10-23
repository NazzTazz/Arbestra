import { expect, it } from 'vitest';
import { villageTerrainRegion } from './terrain-region.js';
const world = { anchorCellX: 100, anchorCellY: 100, widthCells: 512, heightCells: 256 };
const contains = (r: ReturnType<typeof villageTerrainRegion>, x: number, y: number, w = world) =>
  (x - r.originCellX + w.widthCells) % w.widthCells < r.width &&
  (y - r.originCellY + w.heightCells) % w.heightCells < r.height;
it('retains the starting neighbourhood and follows a village past its former border', () => {
  expect(villageTerrainRegion(world, [])).toEqual({ originCellX: 68, originCellY: 68, width: 64, height: 64 });
  const r = villageTerrainRegion(world, [{ cellX: 140, cellY: 100 }]);
  expect(contains(r, 156, 100)).toBe(true);
  expect(contains(r, 68, 68)).toBe(true);
  expect(contains(r, 157, 100)).toBe(false);
  expect(r.height).toBe(64);
});
it('keeps a compact region across both seams and never duplicates a world axis', () => {
  const w = { ...world, anchorCellX: 510, anchorCellY: 254 };
  const r = villageTerrainRegion(w, [{ cellX: 30, cellY: 30 }]);
  expect(contains(r, 46, 46, w)).toBe(true);
  expect(r.width).toBeLessThan(100);
  expect(r.height).toBeLessThan(100);
  const small = { ...world, widthCells: 32, heightCells: 32, anchorCellX: 0, anchorCellY: 0 };
  const all = villageTerrainRegion(
    small,
    Array.from({ length: 32 }, (_, i) => ({ cellX: i, cellY: i })),
  );
  expect(all.width).toBe(32);
  expect(all.height).toBe(32);
});

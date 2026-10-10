import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSpawnSurfaceIndex, createSpawnTerrainField, createSpawnTerrainInspector, firstLuminosityExtremum, spawnDistance, spawnLuminosity, spawnSurfacesAt, spawnSurfacesOverlap } from './spawn-map.js';
import { sampleWorldGeography } from './world-geography.js';
import type { GeneratedLandscape } from './world-generator.js';

const bytes = readFileSync(new URL('../../../apps/world-web/public/studies/t1-alpha512-rc1.json', import.meta.url));
const rc1 = JSON.parse(bytes.toString()) as GeneratedLandscape;
const footprint = [{ x: 0, y: 0, halfWidth: .5, halfHeight: .5 }];
function flat() {
  const data = structuredClone(rc1);
  delete data.geography!.geology;
  data.geography!.study = { id: 't1', base: .75, chains: [], hollows: [] };
  data.stoneSites = [];
  return data;
}
describe('RC1 terrain diagnostic substrate', () => {
  it('keeps indexed collisions identical to direct geometry, including epsilon, long passages and both seams', () => {
    const surfaces = Array.from({ length: 180 }, (_, i) => ({ x: (i * 23.125) % 512, y: (i * 19.3125) % 256, halfWidth: i % 3 ? .03125 : 15.5, halfHeight: i % 5 ? .5 : 4 }));
    surfaces.push({ x: 0, y: 0, halfWidth: .5, halfHeight: .5 });
    const indexed = createSpawnSurfaceIndex(surfaces, 512, 256);
    const queries = surfaces.flatMap(s => [0, .03125, .5, 1].flatMap(size => [-1, 0, 1, 512].map(offset => ({
      x: s.x + s.halfWidth + offset, y: s.y + s.halfHeight, halfWidth: size, halfHeight: size,
    }))));
    queries.push({ x: .5000005, y: 0, halfWidth: 0, halfHeight: 0 }, { x: 511.5, y: 255.5, halfWidth: 0, halfHeight: 0 });
    for (const q of queries) expect(indexed(q)).toBe(surfaces.some(s => spawnSurfacesOverlap(q, s, 512, 256)));
  });
  it('reuses immutable cell extrema but reevaluates the reference height and private occupations', () => {
    const data = flat(), field = createSpawnTerrainField(data), s = { x: 100, y: 100, halfWidth: .5, halfHeight: .5 };
    expect(field.surfaceReason(s, .75, .5)).toBeNull();
    expect(field.surfaceReason(s, .249, .5)).toBe('relief');
    expect(field.surfaceReason(s, null, .5)).toBeNull();
    expect(field.surfaceReason({ ...s, x: 612 }, 1.251, .5)).toBe('relief');
    const inspect = createSpawnTerrainInspector(data, field);
    expect(inspect(s, footprint, 0, [], true, [s]).incompatible.find(p => p.x === 100 && p.y === 100)?.reason).toBe('occupation');
    expect(inspect(s, footprint, 0, []).incompatible).toEqual([]);
  });
  it('preserves approved geographic elevations after the facet-noise optimization', () => {
    // Captured before the optimization, with the geography sampler of 06837b9.
    const original = [[0, 0, .35150403696351434], [511.9, 255.9, .3539931623728779], [140, 20, .125],
      [100.125, 100.375, -.75], [348, 210, .7760640000000001], [310.5, 178, 3], [0, 160, -1],
      [32, 32, -1], [255, 127, .25], [360, 60, .25]];
    for (const [x, y, height] of original) expect(sampleWorldGeography(rc1.geography!, x!, y!).elevation).toBe(height);
  });
  it('pins the approved bytes and leaves the input immutable, including zero legacy arrays', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('de165c395c26eb70572a4370d9a537661e9eaf78b477e1694cfda283418702a4');
    const before = JSON.stringify(rc1), inspect = createSpawnTerrainInspector(rc1);
    const result = inspect({ x: 140, y: 20 }, footprint, 0, [], false);
    expect(result.referenceHeight).toBeCloseTo(sampleWorldGeography(rc1.geography!, 140, 20).elevation);
    expect(JSON.stringify(rc1)).toBe(before);
    expect(result.readiness).toBe('terrain-only');
  });
  it('uses strict >50 toroidal town-hall distance through either seam and the corner', () => {
    const inspect = createSpawnTerrainInspector(flat());
    for (const [a, b] of [[{ x: 1, y: 10 }, { x: 463, y: 10 }], [{ x: 10, y: 1 }, { x: 10, y: 207 }], [{ x: 1, y: 1 }, { x: 483, y: 217 }]] as const) {
      expect(spawnDistance(a, b, 512, 256)).toBe(50);
      expect(inspect(a, footprint, 0, [{ ...b, id: 'neighbor', playerName: 'Voisin', population: 15 }], false).reasons).toContain('neighbor');
    }
    expect(inspect({ x: 100, y: 100 }, footprint, 0, [{ x: 151, y: 100, id: 'v', playerName: 'Voisin', population: 15 }], false).terrainCompatible).toBe(true);
  });
  it('accepts ±.5 height and rejects an additional .00001, using the original town hall reference', () => {
    for (const offset of [.5, -.5, .50001, -.50001]) {
      const data = flat();
      // A flat ramp endpoint 4 cells away from the untouched HDV.
      data.geography!.study!.ramp = { start: [104, 100, .75 + offset], end: [104, 104, .75 + offset], halfWidth: .6, shoulder: .1 };
      const result = createSpawnTerrainInspector(data)({ x: 100, y: 100 }, [{ x: 4, y: 1, halfWidth: .5, halfHeight: .5 }], 0, [], false);
      expect(result.referenceHeight).toBe(.75);
      expect(result.terrainCompatible).toBe(Math.abs(offset) <= .5);
    }
  });
  it('finds water inside a surface whose center remains dry', () => {
    const data = flat();
    data.geography!.study!.hollows = [{ name: 'subcell', x: 100.375, y: 100.375, rx: .15, ry: .15, depth: 1 }];
    expect(sampleWorldGeography(data.geography!, 100, 100).elevation).toBe(.75);
    expect(createSpawnTerrainInspector(data)({ x: 100, y: 100 }, footprint, 0, [], false).reasons).toContain('water');
  });
  it('allows incompatible terrain outside the actual surfaces, and reports it in the diagnostic disk', () => {
    const data = flat();
    data.geography!.study!.hollows = [{ name: 'pond', x: 105, y: 100, rx: 2, ry: 2, depth: 1 }];
    const result = createSpawnTerrainInspector(data)({ x: 100, y: 100 }, footprint, 0, []);
    expect(result.terrainCompatible).toBe(true);
    expect(result.incompatible.some(c => c.reason === 'water')).toBe(true);
  });
  it('intersects the rotated rock surface through a torus seam; rotation follows actual surfaces', () => {
    const data = flat(); data.stoneSites = [{ id: 1, x: 511.8, y: 10, rocks: [{ x: 511.8, y: 10, elevation: .75, width: .4, depth: 2, height: 1, rotation: Math.PI / 4, shade: 1 }] }];
    expect(createSpawnTerrainInspector(data)({ x: 0, y: 10 }, footprint, 0, [], false).reasons).toContain('rock');
    expect(spawnSurfacesAt([{ x: -4, y: 2, halfWidth: .25, halfHeight: .5 }], { x: 100, y: 50 }, 1)).toEqual([{ x: 98, y: 46, halfWidth: .5, halfHeight: .25 }]);
  });
  it('does not under-size the outcrop profile on the inner torus relative to its rendered support', () => {
    const data = flat(); data.stoneSites = [{ id: 1, x: 100, y: 0, rocks: [{ x: 100, y: 0, elevation: .75, width: 2, depth: 1, height: 1, rotation: 0, shade: 1 }] }];
    // The renderer uses radiusX=1.5 and scaleX=.7, not a width/2 world-space box.
    const result = createSpawnTerrainInspector(data)({ x: 101, y: 0 }, [{ x: .25, y: 0, halfWidth: .05, halfHeight: .05 }], 0, [], false);
    expect(result.reasons).toContain('rock');
  });
  it('uses a fixed periodic luminosity curve and centers the first plateau extremum', () => {
    const values = spawnLuminosity({ x: 140, y: 20 }, 512, 256);
    expect(values).toHaveLength(289); expect(values[0]).toBeCloseTo(values[288]!);
    expect(spawnLuminosity({ x: 652, y: 276 }, 512, 256)).toEqual(values);
    expect(firstLuminosityExtremum([.5, 1, 1, .5, 0, 0, .5], true)).toBe(1.5);
    expect(firstLuminosityExtremum([.5, 1, 1, .5, 0, 0, .5], false)).toBe(4.5);
    expect(firstLuminosityExtremum([0, 0, 1, 0, 0], false)).toBe(0);
    expect(firstLuminosityExtremum([1, 1, 1, 1], true)).toBeNull();
  });
  it('rechecks private protections each time, including subcell footprints and seam passages', () => {
    const inspect = createSpawnTerrainInspector(flat()), point = { x: 0, y: 0 };
    expect(inspect(point, footprint, 0, [], false).terrainCompatible).toBe(true);
    const protectedSurfaces = [{ x: 511.6, y: 0, halfWidth: .125, halfHeight: .125 }];
    expect(inspect(point, footprint, 0, [], false, protectedSurfaces).reasons).toContain('occupation');
    expect(inspect(point, footprint, 0, [], false).terrainCompatible).toBe(true);
  });
  it('allows adjacent cell footprints sharing an edge but still blocks points on an occupied boundary', () => {
    const occupied = createSpawnSurfaceIndex([{ x: 0, y: 0, halfWidth: .5, halfHeight: .5 }], 512, 256);
    expect(occupied({ x: 1, y: 0, halfWidth: .5, halfHeight: .5 })).toBe(false);
    expect(occupied({ x: 511, y: 0, halfWidth: .5, halfHeight: .5 })).toBe(false);
    expect(occupied({ x: .5, y: 0, halfWidth: 0, halfHeight: 0 })).toBe(true);
  });
});

import { expect, it } from 'vitest';
import type { TravelRoute } from '@arbestra/contracts';
import { roadEdges } from './village-roads';
import { pavedProfiles, roadTileBorders, roadTileRects } from './road-profile';

it('shares excavation across the toric seam and closes every grass-facing edge of bends and junctions', () => {
  const a={cellX:63,cellY:2}, b={cellX:0,cellY:2}, c={cellX:0,cellY:3};
  const profiles=pavedProfiles([{id:'a',kind:'building',cells:[a,b,c],destination:c}],64,64);
  expect(profiles.get('63:2')).toBe(1); expect(profiles.get('0:2')).toBe(6);
  for (const mask of [3,5,6,7,15]) {
    const rectangles=roadTileRects(mask), borders=roadTileBorders(mask);
    for (const e of borders) {
      const x=(e.x0+e.x1)/2, z=(e.z0+e.z1)/2;
      const at=(px:number,pz:number)=>rectangles.find(r=>px>r.x0&&px<r.x1&&pz>r.z0&&pz<r.z1)?.dug;
      expect(at(x-e.nx*.001,z-e.nz*.001)).toBe(true);
      expect(at(x+e.nx*.001,z+e.nz*.001)).toBe(false);
    }
    expect(borders.length).toBeGreaterThan(0);
  }
});

it('paves shared village trunks and leaves resource branches as earth regardless of route order', () => {
  const a = { cellX: 63, cellY: 3 }, b = { cellX: 0, cellY: 3 }, c = { cellX: 0, cellY: 4 };
  const routes: TravelRoute[] = [
    { id: 'house', kind: 'building', cells: [a, b], destination: b },
    { id: 'stone', kind: 'stone', cells: [a, b, c], destination: c },
    { id: 'garden', kind: 'garden', cells: [c, b], destination: b },
  ];
  const before = JSON.stringify(routes);
  const edges = roadEdges(routes);
  expect(edges).toHaveLength(2);
  expect(edges.filter(e => e.kind === 'paved')).toHaveLength(1);
  expect(edges.find(e => e.kind === 'earth')).toEqual({ from: b, to: c, kind: 'earth' });
  expect(roadEdges([...routes].reverse()).sort((x, y) => x.kind.localeCompare(y.kind)))
    .toEqual(edges.sort((x, y) => x.kind.localeCompare(y.kind)));
  expect(JSON.stringify(routes)).toBe(before);
});

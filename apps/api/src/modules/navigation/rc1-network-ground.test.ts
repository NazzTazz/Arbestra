import { expect, it } from 'vitest';
import { rc1NetworkGround } from './rc1-network-ground.js';

it('keeps water, height and rock results exact after repeated sample-cache turnover', () => {
  const data = { forest: { trees: [] } } as unknown as Parameters<typeof rc1NetworkGround>[0];
  const base = {} as Parameters<typeof rc1NetworkGround>[1];
  const edits = { worldId: 'sample-turnover', width: 1024, height: 1024, terraces: [], absent: [], groves: [] };
  const field = {
    physicalSample: (x: number, y: number) => ({ elevation: ((x + y) % 7) - 2, surface: 0 }),
    intersectsRock: ({ x, y }: { x: number; y: number }) => Math.floor(x + y) % 11 === 0,
  } as unknown as Parameters<typeof rc1NetworkGround>[3];
  const ground = rc1NetworkGround(data, base, edits, field);
  const expected = (x: number, y: number) => ({
    elevation: ((x + y) % 7) - 2,
    dry: ((x + y) % 7) - 2 > 1e-6,
    blocked: Math.floor(x + y) % 11 === 0,
  });
  // More than two complete cache capacities, including fine-grid coordinates.
  for (let i = 0; i < 70000; i++) {
    const x = (i % 1024) / 8,
      y = Math.floor(i / 1024) / 8;
    const value = ground.sample(x, y);
    if (i % 97 === 0) expect(value).toEqual(expected(x, y));
  }
  for (const [x, y] of [
    [0, 0],
    [0.125, 0.25],
    [127.875, 8.5],
    [1, 23],
    [12, 3],
  ]) {
    expect(ground.sample(x!, y!)).toEqual(expected(x!, y!));
    expect(ground.sample(x!, y!)).toEqual(expected(x!, y!));
  }
});

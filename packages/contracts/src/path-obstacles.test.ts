import { expect, it } from 'vitest';
import { pathPassageIntersectsBox } from './path-obstacles.js';
import { canWalkSpawnSegment } from './spawn-access.js';

const world = { widthCells: 128, heightCells: 128 };
it('protects the entire pedestrian band and its endpoints without reserving an adjacent clear lane', () => {
  const path = [
      { cellX: 9.4375, cellY: 7 },
      { cellX: 9.4375, cellY: 10 },
    ],
    target = { cellX: 10, cellY: 8 };
  expect(pathPassageIntersectsBox(path, target, 0.5, 0.5, world)).toBe(true);
  const field = {
    width: 128,
    height: 128,
    sample: (x: number, y: number) => ({
      elevation: 1,
      dry: true,
      blocked: Math.floor(x + 0.5) === 10 && Math.floor(y + 0.5) === 8,
    }),
  };
  expect(canWalkSpawnSegment(field, { x: 9.4375, y: 7 }, { x: 9.4375, y: 10 })).toBe(false);
  expect(
    pathPassageIntersectsBox(
      path.map((p) => ({ ...p, cellX: 9.375 })),
      target,
      0.5,
      0.5,
      world,
    ),
  ).toBe(false);
  expect(pathPassageIntersectsBox([{ cellX: 9.5, cellY: 8 }], target, 0.5, 0.5, world)).toBe(true);
});
it('protects the passage at both torus seams and their corner', () => {
  for (const [path, target] of [
    [
      [
        { cellX: 127.5, cellY: 7 },
        { cellX: 127.5, cellY: 10 },
      ],
      { cellX: 0, cellY: 8 },
    ],
    [
      [
        { cellX: 7, cellY: 127.5 },
        { cellX: 10, cellY: 127.5 },
      ],
      { cellX: 8, cellY: 0 },
    ],
    [
      [
        { cellX: 127.5, cellY: 127.5 },
        { cellX: 127.5, cellY: 0.5 },
      ],
      { cellX: 0, cellY: 0 },
    ],
  ] as const)
    expect(pathPassageIntersectsBox(path, target, 0.5, 0.5, world)).toBe(true);
});
it('protects against equipment touching a lateral strip of the path', () => {
  const path = [
    { cellX: 4, cellY: 8 },
    { cellX: 6, cellY: 8 },
  ];
  expect(pathPassageIntersectsBox(path, { cellX: 5, cellY: 8.18 }, 0.125, 0.125, world)).toBe(true);
  expect(pathPassageIntersectsBox(path, { cellX: 5, cellY: 8.25 }, 0.125, 0.125, world)).toBe(false);
});

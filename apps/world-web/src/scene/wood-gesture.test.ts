import { expect, it } from 'vitest';
import { LONG_PRESS_MS, LongPress, treesAlongSegment, type GestureTree } from './wood-gesture';

it('switches the mode on a press held still, once, and never on a swipe or a tap', () => {
  const press = new LongPress();
  press.start(100, 100, 0);
  // A finger held still sends no event: the scene polls every frame.
  expect(press.poll(LONG_PRESS_MS - 1)).toBe(false);
  expect(press.move(104, 103)).toBe(false); // Inside the dead zone: still a press.
  expect(press.poll(LONG_PRESS_MS)).toBe(true);
  expect(press.poll(LONG_PRESS_MS + 500)).toBe(false); // Fires once.
  expect(press.fired).toBe(true);
  // Once fired, moving does not turn it into a swipe: the gesture designates nothing.
  expect(press.move(300, 300)).toBe(false);

  const swipe = new LongPress();
  swipe.start(0, 0, 0);
  expect(swipe.move(12, 0)).toBe(true);
  expect(swipe.poll(LONG_PRESS_MS * 3)).toBe(false);
  expect(swipe.moved).toBe(true);

  const tap = new LongPress();
  tap.start(0, 0, 0);
  expect(tap.poll(200)).toBe(false);
  expect(tap.pressed).toBe(true);
  tap.end();
  expect(tap.poll(LONG_PRESS_MS * 2)).toBe(false);

  // Without the wood tool, a long press does not apply: it stays a tap, or becomes a swipe.
  const held = new LongPress();
  held.start(0, 0, 0);
  expect(held.poll(LONG_PRESS_MS)).toBe(true);
  held.disarm();
  expect([held.fired, held.pressed]).toEqual([false, true]);
  expect(held.poll(LONG_PRESS_MS * 4)).toBe(false);
  expect(held.move(20, 0)).toBe(true);
});

const tree = (featureId: string, slot: number, x: number, y: number, treeIndex: number | null = slot): GestureTree => ({
  featureId,
  treeIndex,
  slot,
  x,
  y,
});
const world = { widthCells: 512, heightCells: 256 };

it('selects the trees a swipe crosses, each in the order the swipe meets it', () => {
  const trees = [
    tree('b', 0, 13.1, 10.1),
    tree('a', 1, 10.6, 9.9),
    tree('a', 0, 11.9, 10.05),
    tree('c', 0, 12, 12), // Two cells off the line.
  ];
  expect(
    treesAlongSegment({ cellX: 10, cellY: 10 }, { cellX: 14, cellY: 10 }, trees, world).map((t) => [
      t.featureId,
      t.slot,
    ]),
  ).toEqual([
    ['a', 1],
    ['a', 0],
    ['b', 0],
  ]);
  // Backwards, the same trees in the other order.
  expect(
    treesAlongSegment({ cellX: 14, cellY: 10 }, { cellX: 10, cellY: 10 }, trees, world).map((t) => t.slot),
  ).toEqual([0, 0, 1]);
});

it('follows the torus across its seam and keeps a still pointer to the tree under it', () => {
  const seam = [tree('east', 0, 511.8, 5), tree('west', 0, 0.3, 5.1)];
  expect(
    treesAlongSegment({ cellX: 511.2, cellY: 5 }, { cellX: 0.8, cellY: 5 }, seam, world).map((t) => t.featureId),
  ).toEqual(['east', 'west']);
  expect(
    treesAlongSegment({ cellX: 0.3, cellY: 5 }, { cellX: 0.3, cellY: 5 }, seam, world).map((t) => t.featureId),
  ).toEqual(['west']);
});

it('takes only the meant tree when a touch slips a few pixels over a dense grove', () => {
  // A starter grove: three trees 0.2 to 0.3 cell apart (closest spacing 0.2).
  const grove = [tree('starter', 0, 10, 10), tree('starter', 1, 10.25, 10.1), tree('starter', 2, 9.9, 10.28)];
  expect(
    treesAlongSegment({ cellX: 10.02, cellY: 10.02 }, { cellX: 10.06, cellY: 10.03 }, grove, world).map((t) => t.slot),
  ).toEqual([0]);
  // A still pointer between two feet takes the nearest one only first.
  expect(treesAlongSegment({ cellX: 10.17, cellY: 10.07 }, { cellX: 10.17, cellY: 10.07 }, grove, world)[0]?.slot).toBe(
    1,
  );
});

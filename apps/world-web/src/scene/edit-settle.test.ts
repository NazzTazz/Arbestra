import { expect, it } from 'vitest';
import { EditSettle } from './edit-settle';

it('runs the roads and paths update once after a 60-frame stroke, never during it (§7.14)', () => {
  const settle = new EditSettle(300);
  let updates = 0,
    now = 0;
  // Before any edit: a ground change updates at once.
  if (settle.request(now)) updates++;
  expect(updates).toBe(1);
  updates = 0;
  // A stroke: one prediction and one ground change per 16 ms frame.
  for (let frame = 0; frame < 60; frame++) {
    now += 16;
    settle.edited(now);
    if (settle.request(now)) updates++;
    if (settle.due(now)) updates++;
    // The regional sheet is not refitted during the stroke either.
    expect(settle.quiet(now)).toBe(false);
  }
  expect(updates).toBe(0);
  // Released: the frames after it, until the delay has passed, then once.
  for (let frame = 0; frame < 60; frame++) {
    now += 16;
    if (settle.due(now)) updates++;
  }
  expect(updates).toBe(1);
  expect(settle.quiet(now)).toBe(true);
  // Nothing held back: no further update.
  now += 1000;
  expect(settle.due(now)).toBe(false);
});

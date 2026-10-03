import { describe, expect, it } from 'vitest';
import { LodTransition } from './lod-transition';
describe('cloud projection transition', () => {
  it('leaves navigation available while preparing and aborts a mask that never renders', () => {
    const transition = new LodTransition(450, 200, 2000); let swaps = 0;
    transition.start(0, () => swaps++);
    transition.update(100, false, false);
    expect(transition.locked).toBe(false);
    transition.update(2100, false, false);
    expect(transition.active).toBe(false); expect(swaps).toBe(0);
    transition.start(3000, () => swaps++);
    transition.update(3001, false, true);
    expect(transition.locked).toBe(true);
    transition.update(3501, false, true);
    transition.update(5600, false, true);
    expect(transition.active).toBe(false); expect(transition.alpha).toBe(0);
    expect(swaps).toBe(0);
  });
  it('renders a completely covered frame before switching, including after a long suspension', () => {
    const transition = new LodTransition(); let swaps = 0;
    transition.start(0, () => swaps++);
    transition.update(0);
    transition.update(10_000);
    expect(transition.alpha).toBe(1); expect(swaps).toBe(0);
    transition.update(10_010, false);
    expect(swaps).toBe(0);
    transition.update(10_216);
    expect(transition.alpha).toBe(1); expect(swaps).toBe(1);
    transition.update(10_666);
    expect(transition.active).toBe(false); expect(transition.alpha).toBe(0);
  });
  it('rejects overlapping requests and completes each switch once', () => {
    const transition = new LodTransition(); let swaps = 0;
    expect(transition.start(0, () => swaps++)).toBe(true);
    expect(transition.start(100, () => swaps += 10)).toBe(false);
    for (const time of [0, 450, 650, 1100, 1200]) transition.update(time);
    expect(swaps).toBe(1); expect(transition.active).toBe(false);
  });
});

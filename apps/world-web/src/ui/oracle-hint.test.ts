import { describe, expect, it } from 'vitest';
import { OracleHintTimer } from './oracle-hint';

describe('Oracle hint active time', () => {
  it('waits 90 visible seconds and never repeats', () => {
    const timer = new OracleHintTimer({ elapsed: 0, suppressed: false }, 0, true);
    expect(timer.observe(89_999, true, true, false)).toBe(false);
    expect(timer.observe(90_000, true, true, false)).toBe(true);
    expect(timer.observe(180_000, true, true, false)).toBe(false);
  });
  it('excludes hidden time, including an initially hidden tab', () => {
    const timer = new OracleHintTimer({ elapsed: 0, suppressed: false }, 0, false);
    expect(timer.observe(200_000, true, true, false)).toBe(false);
    expect(timer.observe(230_000, false, true, false)).toBe(false);
    expect(timer.observe(900_000, true, true, false)).toBe(false);
    expect(timer.observe(959_999, true, true, false)).toBe(false);
    expect(timer.observe(960_000, true, true, false)).toBe(true);
  });
  it('cancels when the chest is discovered', () => {
    const timer = new OracleHintTimer({ elapsed: 0, suppressed: false }, 0, true);
    expect(timer.observe(90_000, true, false, false)).toBe(false);
    expect(timer.progress.suppressed).toBe(true);
  });
  it('defers during a request, then allows failure but suppresses success', () => {
    const timer = new OracleHintTimer({ elapsed: 0, suppressed: false }, 0, true);
    expect(timer.observe(90_000, true, true, true)).toBe(false);
    expect(timer.observe(91_000, true, true, false)).toBe(true);
    const succeeded = new OracleHintTimer({ elapsed: 89_000, suppressed: true }, 0, true);
    expect(succeeded.observe(2_000, true, true, false)).toBe(false);
  });
  it('resumes persisted progress and preserves suppression after reload', () => {
    const timer = new OracleHintTimer({ elapsed: 60_000, suppressed: false }, 0, true);
    expect(timer.observe(30_000, true, true, false)).toBe(true);
    const restored = new OracleHintTimer(JSON.parse(JSON.stringify(timer.progress)), 0, true);
    expect(restored.observe(90_000, true, true, false)).toBe(false);
  });
});

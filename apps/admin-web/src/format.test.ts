import { describe, expect, it } from 'vitest';
import { chartPath, duration, milliseconds, number, relativeTime } from './format';

describe('operational data presentation', () => {
  it('keeps unknown measurements distinct from measured zero', () => {
    expect(number(null)).toBe('Inconnu');
    expect(milliseconds(undefined)).toBe('Inconnu');
    expect(number(0)).toBe('0');
    expect(milliseconds(0)).toBe('0 ms');
    expect(chartPath([{ time: '2026-10-15T10:00:00Z', value: 0 }]).max).toBe(0);
  });
  it('does not draw interpolated measurements across an observation gap', () => {
    const result = chartPath([
      { time: '2026-10-15T10:00:00Z', value: 10 },
      { time: '2026-10-15T10:01:00Z', value: null },
      { time: '2026-10-15T10:02:00Z', value: 20 },
      { time: '2026-10-15T10:03:00Z', value: 30 },
    ]);
    expect(result.count).toBe(3);
    expect(result.path.match(/M/g)).toHaveLength(2);
    expect(result.path.match(/L/g)).toHaveLength(1);
  });
  it('positions samples by elapsed time, not by array index', () => {
    const result = chartPath(
      [
        { time: '2026-10-15T10:00:00Z', value: 1 },
        { time: '2026-10-15T10:00:01Z', value: 2 },
        { time: '2026-10-15T10:00:10Z', value: 3 },
      ],
      100,
      100,
    );
    expect(result.path).toContain('L10.00,');
    expect(result.path).toContain('L100.00,');
  });
  it('shows future deadlines and elapsed durations without negative values', () => {
    expect(duration(3_661_000)).toBe('1 h 1 min');
    expect(relativeTime('2026-10-15T10:01:00Z', Date.parse('2026-10-15T10:00:00Z'))).toBe('dans 1 min 0 s');
    expect(relativeTime('invalid')).toBe('Inconnu');
  });
});

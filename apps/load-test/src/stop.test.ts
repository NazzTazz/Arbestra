import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, hostReasonFromSamples, hostStopReason } from './stop.js';

const host = { load1: 1.2, cpus: 2, freeMemMb: 1500, totalMemMb: 3800 };

describe('host stop thresholds', () => {
  it('stops above cores times the configured ratio, and never when disabled', () => {
    expect(hostStopReason(host, DEFAULT_THRESHOLDS)).toBeNull();
    expect(hostStopReason({ ...host, load1: 2.4 }, DEFAULT_THRESHOLDS)).toMatch(/charge de l'hôte 2.4 > 2/);
    expect(hostStopReason({ ...host, load1: 2.4 }, { ...DEFAULT_THRESHOLDS, maxHostLoadPerCore: 1.5 })).toBeNull();
    expect(hostStopReason({ ...host, load1: 9 }, { ...DEFAULT_THRESHOLDS, maxHostLoadPerCore: 0 })).toBeNull();
  });
  it('stops under the free-memory percentage', () => {
    expect(hostStopReason({ ...host, freeMemMb: 400 }, DEFAULT_THRESHOLDS)).toMatch(/mémoire disponible/);
    expect(hostStopReason({ ...host, freeMemMb: 400 }, { ...DEFAULT_THRESHOLDS, minFreeMemPercent: 10 })).toBeNull();
    expect(hostStopReason({ ...host, freeMemMb: 0 }, { ...DEFAULT_THRESHOLDS, minFreeMemPercent: 0 })).toBeNull();
  });
  it('judges the last sampler line, if recent and readable', () => {
    const line = (at: number, load1: number) => JSON.stringify({ at, host: { ...host, load1 } });
    const text = [line(1000, 0.5), line(9000, 3)].join('\n') + '\n';
    expect(hostReasonFromSamples(text, 10_000, DEFAULT_THRESHOLDS)).toMatch(/charge/);
    expect(hostReasonFromSamples(text, 60_000, DEFAULT_THRESHOLDS)).toBeNull();
    expect(hostReasonFromSamples('{"at":1,"host":', 2, DEFAULT_THRESHOLDS)).toBeNull();
    expect(hostReasonFromSamples('', 2, DEFAULT_THRESHOLDS)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { hostMemory, parseMeminfo } from './host.js';

const meminfo = `MemTotal:        3900000 kB
MemFree:          200000 kB
MemAvailable:    1950000 kB
Buffers:          100000 kB
`;

describe('host memory', () => {
  it('reads MemAvailable, not MemFree', () => {
    expect(parseMeminfo(meminfo)).toEqual({ availableKb: 1950000, totalKb: 3900000 });
    expect(hostMemory(() => meminfo, 'linux')).toEqual({ freeMb: 1904, totalMb: 3809, source: 'MemAvailable' });
  });
  it('falls back to os.freemem without MemAvailable or off Linux', () => {
    expect(parseMeminfo('MemTotal: 1000 kB\nMemFree: 10 kB\n')).toBeNull();
    expect(hostMemory(() => 'MemTotal: 1000 kB\n', 'linux').source).toBe('os.freemem');
    expect(
      hostMemory(() => {
        throw new Error('no /proc');
      }, 'linux').source,
    ).toBe('os.freemem');
    expect(hostMemory(() => meminfo, 'win32').source).toBe('os.freemem');
  });
});

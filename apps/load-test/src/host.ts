/** Host figures of the sampler. On Linux the free memory is MemAvailable
 * (/proc/meminfo): `os.freemem()` is MemFree, which a busy page cache keeps at
 * a few percent on a healthy VPS and would trip any "free memory" threshold. */
import { readFileSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';

export interface HostMemory {
  freeMb: number;
  totalMb: number;
  source: 'MemAvailable' | 'os.freemem';
}

/** Pure: MemAvailable and MemTotal (kB) from the text of /proc/meminfo, or null. */
export function parseMeminfo(text: string): { availableKb: number; totalKb: number } | null {
  const field = (name: string) => {
    const match = new RegExp(`^${name}:\\s+(\\d+)\\s*kB`, 'm').exec(text);
    return match ? Number(match[1]) : null;
  };
  const availableKb = field('MemAvailable'),
    totalKb = field('MemTotal');
  return availableKb === null || totalKb === null || totalKb <= 0 ? null : { availableKb, totalKb };
}

export function hostMemory(
  read: () => string = () => readFileSync('/proc/meminfo', 'utf8'),
  platform: string = process.platform,
): HostMemory {
  if (platform === 'linux') {
    try {
      const parsed = parseMeminfo(read());
      if (parsed)
        return {
          freeMb: Math.round(parsed.availableKb / 1024),
          totalMb: Math.round(parsed.totalKb / 1024),
          source: 'MemAvailable',
        };
    } catch {
      /* fall back to the portable figure */
    }
  }
  return { freeMb: Math.round(freemem() / 1048576), totalMb: Math.round(totalmem() / 1048576), source: 'os.freemem' };
}

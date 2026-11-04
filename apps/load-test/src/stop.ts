/** Automatic stop of a run (pure): checked every few seconds on a sliding
 * window of the bots' commands and of the API health. */
import type { WindowSummary } from './stats.js';

export interface StopThresholds {
  /** Command p95 above which the run stops, milliseconds. */
  maxP95Ms: number;
  /** Command error rate above which the run stops, percent. */
  maxErrorRate: number;
  /** Health p95 above which the API counts as degraded, milliseconds. */
  maxHealthMs: number;
  /** Consecutive failed health checks that stop the run. */
  maxHealthFailures: number;
  /** Fewer commands than this in the window: latency and error rate are not judged. */
  minCommands: number;
  /** Host load (1 min) per core above which the run stops; 0 disables the check. */
  maxHostLoadPerCore: number;
  /** Free memory (MemAvailable) below this percent of the total stops the run; 0 disables. */
  minFreeMemPercent: number;
}
export const DEFAULT_THRESHOLDS: StopThresholds = {
  maxP95Ms: 5000,
  maxErrorRate: 5,
  maxHealthMs: 2000,
  maxHealthFailures: 3,
  minCommands: 20,
  // A 2-core VPS shared with the alpha: a load above the core count already starves it.
  maxHostLoadPerCore: 1,
  minFreeMemPercent: 15,
};

export interface HostSample {
  load1: number;
  cpus: number;
  freeMemMb: number;
  totalMemMb: number;
}

/** The reason to stop for the host's own figures (load, free memory), or null. */
export function hostStopReason(
  host: HostSample,
  t: Pick<StopThresholds, 'maxHostLoadPerCore' | 'minFreeMemPercent'>,
): string | null {
  if (t.maxHostLoadPerCore > 0 && host.cpus > 0 && host.load1 > host.cpus * t.maxHostLoadPerCore)
    return `charge de l'hôte ${host.load1} > ${Math.round(host.cpus * t.maxHostLoadPerCore * 100) / 100} (${host.cpus} cœurs × ${t.maxHostLoadPerCore})`;
  if (t.minFreeMemPercent > 0 && host.totalMemMb > 0) {
    const percent = (host.freeMemMb / host.totalMemMb) * 100;
    if (percent < t.minFreeMemPercent)
      return `mémoire disponible de l'hôte ${Math.round(percent * 10) / 10} % < ${t.minFreeMemPercent} %`;
  }
  return null;
}

export interface HealthWindow {
  p95Ms: number | null;
  consecutiveFailures: number;
}

/** The reason to stop now, or null. */
export function stopReason(window: WindowSummary, health: HealthWindow, t: StopThresholds): string | null {
  if (health.consecutiveFailures >= t.maxHealthFailures)
    return `santé de l'API dégradée : ${health.consecutiveFailures} échecs consécutifs de /api/health`;
  if (health.p95Ms !== null && health.p95Ms > t.maxHealthMs)
    return `santé de l'API dégradée : /api/health p95 ${health.p95Ms} ms > ${t.maxHealthMs} ms`;
  const c = window.commands;
  if (c.count >= t.minCommands) {
    if (c.latencyMs && c.latencyMs.p95 > t.maxP95Ms)
      return `p95 des commandes ${c.latencyMs.p95} ms > ${t.maxP95Ms} ms`;
    if (c.errorRate > t.maxErrorRate) return `taux d'erreur des commandes ${c.errorRate} % > ${t.maxErrorRate} %`;
  }
  return null;
}

/** The host stop reason from the tail of the sampler's JSON lines: the last
 * complete line, ignored when older than `maxAgeMs` or unreadable. */
export function hostReasonFromSamples(
  text: string,
  now: number,
  t: Pick<StopThresholds, 'maxHostLoadPerCore' | 'minFreeMemPercent'>,
  maxAgeMs = 15_000,
): string | null {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const last = lines.at(-1);
  if (!last) return null;
  try {
    const sample = JSON.parse(last) as { at?: number; host?: HostSample };
    if (!sample.host || typeof sample.at !== 'number' || now - sample.at > maxAgeMs) return null;
    return hostStopReason(sample.host, t);
  } catch {
    return null;
  }
}

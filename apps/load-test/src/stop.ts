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
}
export const DEFAULT_THRESHOLDS: StopThresholds = {
  maxP95Ms: 5000,
  maxErrorRate: 5,
  maxHealthMs: 2000,
  maxHealthFailures: 3,
  minCommands: 20,
};

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

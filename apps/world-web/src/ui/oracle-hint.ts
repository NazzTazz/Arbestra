export const ORACLE_HINT = "L’ancien chef avait caché des provisions dans l’Hôtel de ville. Une mesure remarquablement efficace, puisque personne ne les a retrouvées.";
export const ORACLE_HINT_DELAY = 90_000;

export interface HintProgress { elapsed: number; suppressed: boolean }

/** Counts only the interval since the preceding visibility observation. */
export class OracleHintTimer {
  private previous: number;
  private visible: boolean;
  constructor(readonly progress: HintProgress, now: number, visible: boolean) {
    this.previous = now;
    this.visible = visible;
  }
  observe(now: number, visible: boolean, available: boolean, pending: boolean): boolean {
    if (this.visible && !this.progress.suppressed)
      this.progress.elapsed += Math.max(0, now - this.previous);
    this.previous = now;
    this.visible = visible;
    if (!available) this.progress.suppressed = true;
    if (this.progress.suppressed || !visible || pending || this.progress.elapsed < ORACLE_HINT_DELAY) return false;
    this.progress.suppressed = true;
    return true;
  }
}

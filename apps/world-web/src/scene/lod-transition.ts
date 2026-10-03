/** A covered frame is rendered before changing projection, even after a stall. */
export class LodTransition {
  constructor(private readonly duration = 450, private readonly hold = 200, private readonly timeout = 2500) {}
  #stage: 'idle' | 'prepare' | 'cover' | 'covered' | 'reveal' = 'idle';
  #started = 0;
  #swap: (() => void) | null = null;
  alpha = 0;
  get active() { return this.#stage !== 'idle'; }
  get locked() { return this.active && this.#stage !== 'prepare'; }
  failed = false;
  cancel(): void { this.#stage = 'idle'; this.#swap = null; this.alpha = 0; }
  start(now: number, swap: () => void): boolean {
    if (this.active) return false;
    this.#stage = 'prepare'; this.#started = now; this.#swap = swap; this.failed = false;
    return true;
  }
  update(now: number, coveredFrameRendered = true, ready = true): void {
    if (this.#stage === 'prepare') {
      if (!ready) {
        if (now - this.#started > this.timeout) { this.cancel(); this.failed = true; }
        return;
      }
      this.#stage = 'cover'; this.#started = now;
    }
    if (this.#stage === 'cover') {
      const t = this.duration === 0 ? 1 : Math.min(1, (now - this.#started) / this.duration);
      this.alpha = t * t * (3 - 2 * t);
      if (t === 1) { this.#stage = 'covered'; this.#started = now; }
    } else if (this.#stage === 'covered') {
      if (!coveredFrameRendered) {
        if (now - this.#started > this.timeout) { this.cancel(); this.failed = true; }
        return;
      }
      if (now - this.#started < (this.duration === 0 ? 0 : this.hold)) return;
      this.#swap?.(); this.#swap = null;
      this.#stage = 'reveal'; this.#started = now; this.alpha = 1;
    } else if (this.#stage === 'reveal') {
      const t = this.duration === 0 ? 1 : Math.min(1, (now - this.#started) / this.duration);
      this.alpha = 1 - t * t * (3 - 2 * t);
      if (t === 1) this.#stage = 'idle';
    }
  }
}

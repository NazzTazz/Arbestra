/** Spaced automatic retries of a connection to the village that failed. Every
 * step waits longer than the one before; the last delay repeats. */
export const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 10000, 20000, 30000] as const;

/** The wait after failure number `failures` (1 for the first). A busy server's
 * `Retry-After` lengthens a step, never shortens it and never more than doubles it. */
export function reconnectDelayMs(failures: number, retryAfterMs = 0): number {
  const step = RECONNECT_BACKOFF_MS[Math.min(Math.max(failures, 1), RECONNECT_BACKOFF_MS.length) - 1]!;
  return Math.max(step, Math.min(retryAfterMs, step * 2));
}

/** Runs `attempt` again after each reported failure, at the spaced cadence
 * above, until `reset` (success) or `stop`. `now` is the player's own
 * "Réessayer": it attempts at once and cancels the wait. The count of
 * failures survives it, so the cadence keeps growing while the server stays
 * down; the caller reports each failed attempt with `failed`. */
export class SpacedRetry {
  #failures: number;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;
  constructor(
    private readonly attempt: () => void,
    /** Failures already behind the caller: the first wait is the next step. */
    failures = 0,
  ) {
    this.#failures = failures;
  }
  get failures(): number {
    return this.#failures;
  }
  /** A failed attempt: schedules the next one. */
  failed(retryAfterMs = 0) {
    if (this.#stopped) return;
    this.cancel();
    this.#failures++;
    this.#timer = setTimeout(
      () => {
        this.#timer = undefined;
        this.attempt();
      },
      reconnectDelayMs(this.#failures, retryAfterMs),
    );
  }
  /** Attempts immediately, without waiting for the scheduled one. */
  now() {
    if (this.#stopped) return;
    this.cancel();
    this.attempt();
  }
  /** Drops the scheduled attempt; the failure count stays. */
  cancel() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
  }
  /** Success: forget the failures. */
  reset() {
    this.cancel();
    this.#failures = 0;
  }
  /** Leaves for good: nothing is scheduled afterwards. */
  stop() {
    this.#stopped = true;
    this.cancel();
  }
}

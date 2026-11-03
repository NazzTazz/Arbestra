/**
 * Holds back work that follows the ground while a terraforming stroke (or its
 * undo) is being drawn: each predicted frame changes the ground revision, and
 * the roads, village paths and braziers were rebuilt at every one of them
 * (« Voirie · chemins automatiques » p95 25,8 ms on staging, 3 November). The
 * request is kept and run once, `settleMs` after the last prediction, so the
 * final drawing is the one an immediate update gives
 * (docs/SPEC-TERRAFORMATION-OUTIL.md §7.14). O(1) per call.
 */
export class EditSettle {
  #lastEdit = -Infinity;
  #pending = false;
  constructor(readonly settleMs: number) {}
  /** A prediction was shown on the displayed ground. */
  edited(now: number): void {
    this.#lastEdit = now;
  }
  /** No prediction for `settleMs`: work that polls the ground itself may run. */
  quiet(now: number): boolean {
    return now - this.#lastEdit >= this.settleMs;
  }
  /** A ground change asks for the update: true to run it now, false to keep it for `due`. */
  request(now: number): boolean {
    if (now - this.#lastEdit < this.settleMs) {
      this.#pending = true;
      return false;
    }
    this.#pending = false;
    return true;
  }
  /** Every frame: true once, when the edits have settled and an update was held back. */
  due(now: number): boolean {
    if (!this.#pending || now - this.#lastEdit < this.settleMs) return false;
    this.#pending = false;
    return true;
  }
}

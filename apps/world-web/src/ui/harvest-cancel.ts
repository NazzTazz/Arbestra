import type { HarvestCancelReceipt } from '@arbestra/contracts';

/** « Annuler » stays on screen this long after a gesture (docs/SPEC-GRAMMAIRE-GESTUELLE.md §1). */
export const CANCEL_WINDOW_MS = 15_000;

/** Whole seconds left to cancel a gesture made at `at`; 0 once the window is over. */
export function cancelSecondsLeft(at: number, now: number): number {
  return Math.max(0, Math.ceil((CANCEL_WINDOW_MS - (now - at)) / 1000));
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/**
 * What a cancellation did, in French, from its receipt: trees withdrawn, the
 * lot under way that still ends (Tristan, 29 October: only that lot is
 * delivered), trees another gesture keeps, and those already done.
 */
export function cancelSummary(receipt: HarvestCancelReceipt): string {
  const count = (outcome: HarvestCancelReceipt['trees'][number]['outcome']) =>
    receipt.trees.filter((tree) => tree.outcome === outcome).length;
  const removed = count('removed'),
    running = count('in-progress'),
    kept = count('queued'),
    done = count('not-queued');
  if (receipt.beforeQueue)
    return removed
      ? `Geste annulé avant son traitement : ${plural(removed, 'arbre retiré', 'arbres retirés')}.`
      : 'Geste annulé avant son traitement.';
  const parts = [
    removed ? plural(removed, 'arbre retiré de la file', 'arbres retirés de la file') : '',
    running ? `${plural(running, 'lot en cours se termine', 'lots en cours se terminent')}, sans plus` : '',
    kept ? plural(kept, 'déjà prévu par un autre geste', 'déjà prévus par un autre geste') : '',
    done ? plural(done, 'déjà fait', 'déjà faits') : '',
  ].filter(Boolean);
  return parts.length ? `Annulé : ${parts.join(' · ')}.` : 'Rien à annuler.';
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DemolitionRequest, DemolitionResult } from '@arbestra/contracts';
import './wood-gesture-hud.css';

/** Safety net against a mistaken click (Tristan, 31 October): the command
 * leaves only after this delay, cancellable until then. */
export const DEMOLITION_DELAY_MS = 10000;

export interface PendingDemolition {
  deadline: number;
  sending: boolean;
}

/**
 * The designation waiting for its delay, held by the App so that it survives a
 * change of HUD mode or tool (Tristan, 31 October). A new village drops it:
 * nothing was sent. `onSettled` runs once the order is sent or dropped.
 */
export function usePendingDemolition({
  demolish,
  villageKey,
  onNotice,
  onSettled,
}: {
  demolish: ((request: DemolitionRequest) => Promise<DemolitionResult>) | null;
  villageKey: string;
  onNotice: (message: string, tone?: 'default' | 'warning') => void;
  onSettled: () => void;
}) {
  const [pending, setPending] = useState<PendingDemolition | null>(null);
  const order = useRef<DemolitionRequest | null>(null),
    timer = useRef(0);
  const latest = useRef({ demolish, onNotice, onSettled });
  latest.current = { demolish, onNotice, onSettled };
  const drop = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    if (!order.current) return;
    order.current = null;
    setPending(null);
    latest.current.onSettled();
  }, []);
  const send = useCallback(async () => {
    timer.current = 0;
    const request = order.current,
      { demolish: command, onNotice: notice } = latest.current;
    if (!request) return;
    if (!command) {
      notice('Démolition non envoyée : synchronisation du village en cours.', 'warning');
      drop();
      return;
    }
    setPending((p) => p && { ...p, sending: true });
    try {
      const result = await command(request);
      const gone = result.buildings + result.gardenCells + result.roadCells + result.braziers;
      notice(gone ? 'Démolition effectuée.' : 'Rien à démolir : ces cibles avaient déjà disparu.');
    } catch (error) {
      notice(error instanceof Error ? error.message : 'Démolition refusée.', 'warning');
    }
    drop();
  }, [drop]);
  const schedule = useCallback(
    (request: DemolitionRequest) => {
      if (order.current) return;
      order.current = request;
      setPending({ deadline: Date.now() + DEMOLITION_DELAY_MS, sending: false });
      timer.current = window.setTimeout(() => void send(), DEMOLITION_DELAY_MS);
    },
    [send],
  );
  const cancel = useCallback(() => {
    if (pending?.sending) return;
    drop();
  }, [drop, pending?.sending]);
  // Another village (or world): the waiting order is dropped, never sent there.
  useEffect(() => drop, [villageKey, drop]);
  return { pending, schedule, cancel };
}

/** « Annuler N s », like the clearing gesture's, while a delayed order waits.
 * The App stacks these buttons in one top-right region. */
export function CountdownCancelButton({
  deadline,
  label,
  onCancel,
}: {
  deadline: number | null;
  label: string;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [deadline]);
  if (deadline === null) return null;
  const seconds = Math.max(1, Math.ceil((deadline - now) / 1000));
  return (
    <button type="button" className="harvest-cancel-button" aria-label={label} onClick={onCancel}>
      Annuler <span className="harvest-cancel-count">{seconds} s</span>
    </button>
  );
}

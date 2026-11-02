import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/**
 * The Oracle's pager (Tristan, 2 November: « un message par erreur, avec un
 * simple sélecteur "1/X" et éventuellement gérer le swipe précédent/suivant
 * pour les messages de l'Oracle »): « ‹ 1/X › », the ← → keys and a
 * horizontal swipe (touch or pointer). Made for any box of the Oracle (the
 * terraforming refusals first; the release notes may follow).
 */
export type PagerAction = 'previous' | 'next';
/** The page after `action`, within 0..count − 1: no wrap, the ends stay put. */
export const pagerStep = (index: number, count: number, action: PagerAction) =>
  Math.max(0, Math.min(count - 1, index + (action === 'next' ? 1 : -1)));
/** ← previous, → next; any other key is not the pager's. */
export const pagerKey = (key: string): PagerAction | null =>
  key === 'ArrowLeft' ? 'previous' : key === 'ArrowRight' ? 'next' : null;
/** Shortest horizontal travel, in CSS pixels, that turns a page. */
export const SWIPE_THRESHOLD_PX = 40;
/** A swipe to the left shows the next page, to the right the previous one;
 * shorter than the threshold or more vertical than horizontal, nothing. */
export const swipeAction = (dx: number, dy: number, threshold = SWIPE_THRESHOLD_PX): PagerAction | null =>
  Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy) ? null : dx < 0 ? 'next' : 'previous';

/** Page state, keys and swipe of a pager over `count` pages. */
export function usePager(count: number) {
  const [index, setIndex] = useState(0);
  // Fewer pages than before: stay on the last one.
  useEffect(() => setIndex((i) => Math.max(0, Math.min(i, count - 1))), [count]);
  const step = useCallback((action: PagerAction) => setIndex((i) => pagerStep(i, count, action)), [count]);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  return {
    index: Math.max(0, Math.min(index, count - 1)),
    step,
    /** For the box's onKeyDown: true when the key turned (or tried to turn) a page. */
    onKeyDown: (event: KeyboardEvent) => {
      const action = pagerKey(event.key);
      if (!action || count < 2) return false;
      event.preventDefault();
      step(action);
      return true;
    },
    swipe: {
      onPointerDown: (event: PointerEvent) => {
        start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
      },
      onPointerUp: (event: PointerEvent) => {
        const from = start.current;
        start.current = null;
        if (!from || from.id !== event.pointerId || count < 2) return;
        const action = swipeAction(event.clientX - from.x, event.clientY - from.y);
        if (action) step(action);
      },
      onPointerCancel: () => {
        start.current = null;
      },
    },
  };
}

/** « ‹ 1/X › »; nothing for a single page. */
export function OraclePager({
  index,
  count,
  onStep,
  label = 'Messages de l’Oracle',
}: {
  index: number;
  count: number;
  onStep: (action: PagerAction) => void;
  label?: string;
}) {
  if (count < 2) return null;
  return (
    <nav className="oracle-pager" aria-label={label}>
      <button
        type="button"
        aria-label="Message précédent"
        aria-keyshortcuts="ArrowLeft"
        disabled={index === 0}
        onClick={() => onStep('previous')}
      >
        ‹
      </button>
      <span aria-live="polite">
        {index + 1}/{count}
      </span>
      <button
        type="button"
        aria-label="Message suivant"
        aria-keyshortcuts="ArrowRight"
        disabled={index === count - 1}
        onClick={() => onStep('next')}
      >
        ›
      </button>
    </nav>
  );
}

import { useEffect, useState } from 'react';
import { cancelSecondsLeft } from './harvest-cancel';
import type { CancelResult, LastGesture } from './use-harvest-tool';
import './wood-gesture-hud.css';

/**
 * The wood tool's mode, always in view while it is in use (docs/SPEC-GRAMMAIRE-
 * GESTUELLE.md §3, proposal): a badge at the top of the screen, and in
 * clearing a red frame around the view. A long press switches it.
 */
export function WoodModeIndicator({ mode }: { mode: 'cut' | 'clear' }) {
  return (
    <>
      {mode === 'clear' && <div className="wood-mode-frame" aria-hidden="true" />}
      <div className="wood-mode-indicator" data-mode={mode} role="status" aria-live="polite">
        <strong>{mode === 'clear' ? 'Défrichage' : 'Coupe'}</strong>
        <small>appui long pour {mode === 'clear' ? 'couper' : 'défricher'}</small>
      </div>
    </>
  );
}

/** A short bubble near the pointer at each switch. */
export function WoodModeBubble({
  bubble,
}: {
  bubble: { mode: 'cut' | 'clear'; x: number; y: number; at: number } | null;
}) {
  const [shown, setShown] = useState(bubble);
  useEffect(() => {
    setShown(bubble);
    if (!bubble) return;
    const timer = setTimeout(() => setShown(null), 1300);
    return () => clearTimeout(timer);
  }, [bubble]);
  if (!shown) return null;
  return (
    <div className="wood-mode-bubble" data-mode={shown.mode} style={{ left: shown.x, top: shown.y }} aria-hidden="true">
      {shown.mode === 'clear' ? 'Mode défrichage' : 'Mode coupe'}
    </div>
  );
}

/**
 * « Annuler », top right, for 15 s after a wood gesture: it targets the last
 * gesture (a new gesture replaces the previous one), then shows what the
 * server did. Ticks once a second while counting down.
 */
export function HarvestCancelButton({
  gesture,
  result,
  onCancel,
  onDismiss,
}: {
  gesture: LastGesture | null;
  result: CancelResult | null;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const counting = gesture?.wood ? cancelSecondsLeft(gesture.at, now) : 0;
  useEffect(() => {
    if (!gesture?.wood && !result) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [gesture, result]);
  // A result stays readable a few seconds, an error until dismissed.
  const showResult = result && (result.pending || result.error || now - result.at < 6000);
  if (!counting && !showResult) return null;
  return (
    <div className="harvest-cancel" role="region" aria-label="Annuler le dernier geste">
      {counting > 0 && (
        <button type="button" className="harvest-cancel-button" onClick={onCancel}>
          Annuler <span className="harvest-cancel-count">{counting} s</span>
        </button>
      )}
      {showResult && (
        <p className={`harvest-cancel-result${result.error ? ' is-error' : ''}`} role="status">
          {result.text}
          {result.error && (
            <button type="button" aria-label="Fermer" onClick={onDismiss}>
              ×
            </button>
          )}
        </p>
      )}
    </div>
  );
}

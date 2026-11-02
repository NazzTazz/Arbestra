import { useEffect, useRef } from 'react';
import type { OracleRefusal } from './terraform-refusals';
import './terraform.css';

/**
 * The Oracle explains a refused terraforming gesture
 * (docs/SPEC-TERRAFORMATION-OUTIL.md §3.5), in the box of the release notes
 * but without a backdrop: « Inspecter » brings the camera close and low over
 * the refused cell, « Compris » (or Escape) closes.
 */
export function TerraformRefusalDialog({
  refusal,
  onInspect,
  onClose,
}: {
  refusal: OracleRefusal;
  onInspect: (cell: { cellX: number; cellY: number }) => void;
  onClose: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    button.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [refusal]);
  return (
    <aside
      className="oracle-provisions-overlay oracle-refusal"
      role="alertdialog"
      aria-labelledby="oracle-refusal-title"
      aria-describedby="oracle-refusal-text"
      onKeyDown={(event) => {
        // Nothing typed here reaches the scene's shortcuts.
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <strong id="oracle-refusal-title">L’Oracle</strong>
      <p id="oracle-refusal-text">
        {refusal.text}
        {refusal.more && <small>{refusal.more}</small>}
      </p>
      <footer>
        {refusal.inspect && (
          <button
            type="button"
            onClick={() => {
              onInspect(refusal.inspect!);
              onClose();
            }}
          >
            Inspecter
          </button>
        )}
        <button type="button" ref={button} onClick={onClose}>
          Compris
        </button>
      </footer>
    </aside>
  );
}

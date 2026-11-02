import { useEffect, useRef } from 'react';
import type { OraclePage } from './terraform-refusals';
import { OraclePager, usePager } from './OraclePager';
import './terraform.css';

/**
 * The Oracle tells the refusals of terraforming, one page per error
 * (docs/SPEC-TERRAFORMATION-OUTIL.md §7), with « ‹ 1/X › », ← → and the
 * swipe; in the box of the release notes but without a backdrop: «
 * Inspecter » brings the camera close and low over the cell of the current
 * page and makes its obstacle pulse, the box staying open to go on; «
 * Compris » (or Escape) closes them all.
 */
export function TerraformRefusalDialog({
  pages,
  onInspect,
  onClose,
}: {
  pages: readonly OraclePage[];
  onInspect: (page: OraclePage) => void;
  onClose: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const pager = usePager(pages.length),
    page = pages[pager.index];
  useEffect(() => {
    const previous = document.activeElement;
    button.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  if (!page) return null;
  return (
    <aside
      className="oracle-provisions-overlay oracle-refusal"
      role="alertdialog"
      aria-labelledby="oracle-refusal-title"
      aria-describedby="oracle-refusal-text"
      onKeyDown={(event) => {
        // Nothing typed here reaches the scene's shortcuts.
        event.stopPropagation();
        if (pager.onKeyDown(event)) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
      {...pager.swipe}
    >
      <strong id="oracle-refusal-title">L’Oracle</strong>
      <p id="oracle-refusal-text">{page.text}</p>
      <footer>
        <OraclePager index={pager.index} count={pages.length} onStep={pager.step} />
        {page.inspect && (
          <button type="button" onClick={() => onInspect(page)}>
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

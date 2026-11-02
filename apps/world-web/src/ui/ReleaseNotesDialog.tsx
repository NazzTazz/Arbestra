import { useEffect, useRef } from 'react';
import type { Release } from '@arbestra/contracts';

/** `2026-11-02` as the player reads it, in the day's own calendar (no timezone shift). */
export function formatReleaseDate(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * What changed since the player's last visit, told by the Oracle
 * (docs/SPEC-NOUVEAUTES-ORACLE.md). A modal dialog: the backdrop blocks the
 * scene, Tab stays inside, and Escape means "Compris" like the button.
 */
export function ReleaseNotesDialog({ releases, onClose }: { releases: readonly Release[]; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Give the focus back to what had it (the scene) so the keyboard still plays.
    const previous = document.activeElement;
    button.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <>
      <div className="oracle-news-backdrop" aria-hidden="true" />
      <aside
        className="oracle-provisions-overlay oracle-news"
        role="dialog"
        aria-modal="true"
        aria-labelledby="oracle-news-title"
        aria-describedby="oracle-news-intro"
        onKeyDown={(event) => {
          // Nothing typed here reaches the scene's shortcuts.
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          } else if (event.key === 'Tab') {
            event.preventDefault();
            const order: HTMLElement[] = [];
            if (list.current) order.push(list.current);
            if (button.current) order.push(button.current);
            const index = order.indexOf(document.activeElement as HTMLElement);
            const next = event.shiftKey
              ? index <= 0
                ? order.length - 1
                : index - 1
              : index === order.length - 1
                ? 0
                : index + 1;
            order[next]?.focus();
          }
        }}
      >
        <strong id="oracle-news-title">L’Oracle</strong>
        <p id="oracle-news-intro">Le village a changé depuis votre dernière visite. Je vous raconte.</p>
        <div className="oracle-news-list" ref={list} tabIndex={0} role="region" aria-label="Nouveautés">
          {releases.map((release) => (
            <section key={release.id} className="oracle-news-release">
              <time dateTime={release.date}>{formatReleaseDate(release.date)}</time>
              <ul>
                {release.items.map((item) => (
                  <li key={item.title}>
                    <strong>{item.title}</strong>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <button type="button" ref={button} onClick={onClose}>
          Compris
        </button>
      </aside>
    </>
  );
}

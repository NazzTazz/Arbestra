/** What the offer list needs from the page to know when it may be read. */
export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/** Quiet rereads of the open offer list, driven by the revision of the shared
 * offer index (V2 stream offers/all) instead of a timer: another village's offer
 * changes nothing private, so only that revision tells the list is out of date.
 *
 * `readAt` holds the index revision the displayed list was read at; each read
 * records the revision it started from. The list is reread when `indexRevision`
 * differs from it, and once more each time the page becomes visible again (the
 * stream of a hidden tab may have been cut). Never while the page is hidden,
 * and one read at a time: a newer revision restarts the watch, which aborts the
 * read in flight. Returns the cleanup. */
export function watchOfferIndex(options: {
  indexRevision: string | null;
  readAt: { current: string | null };
  page: VisibilitySource;
  read: (signal: AbortSignal) => Promise<void>;
}): () => void {
  const { indexRevision, readAt, page, read } = options;
  let flight: AbortController | null = null;
  const reread = (returned: boolean) => {
    if (page.visibilityState !== 'visible' || flight) return;
    if (!returned && readAt.current === indexRevision) return;
    readAt.current = indexRevision;
    const controller = (flight = new AbortController());
    // Quiet: a failed reread keeps the list as it is.
    void read(controller.signal)
      .catch(() => undefined)
      .finally(() => {
        if (flight === controller) flight = null;
      });
  };
  const onVisibility = () => reread(true);
  reread(false);
  page.addEventListener('visibilitychange', onVisibility);
  return () => {
    page.removeEventListener('visibilitychange', onVisibility);
    flight?.abort();
  };
}

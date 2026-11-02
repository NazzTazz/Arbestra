import { useCallback, useEffect, useRef, useState } from 'react';
import { RELEASE_NOTES, releaseNotice, type Release } from '@arbestra/contracts';
import { readLastSeenRelease, sendSeenRelease } from '../api/release-notes';

/**
 * The versions this account has not seen. An account with no version yet gets
 * the current one recorded in silence (it has no history to catch up on) and
 * sees nothing. Rejects when the account cannot be read; a failed silent record
 * is ignored, the next load starts again.
 */
export async function missedReleases(
  notes: readonly Release[],
  read: () => Promise<string | null> = readLastSeenRelease,
  record: (releaseId: string) => Promise<unknown> = sendSeenRelease,
): Promise<readonly Release[]> {
  const notice = releaseNotice(notes, await read());
  if (notice.kind === 'record') {
    await record(notice.releaseId).catch(() => {});
    return [];
  }
  return notice.kind === 'show' ? notice.releases : [];
}

/**
 * The Oracle's release notes (docs/SPEC-NOUVEAUTES-ORACLE.md). `enabled` is true
 * only once the village is ready and nothing else holds the screen (no loading,
 * arrival, starter kit or connection loss): the account is read once then, and
 * the dialog shows while `enabled` stays true. Every failure is ignored: the
 * notes then come back at the next load.
 */
export function useReleaseNotes(enabled: boolean, notes: readonly Release[] = RELEASE_NOTES) {
  const [missed, setMissed] = useState<readonly Release[]>([]);
  const decided = useRef(false);
  useEffect(() => {
    if (!enabled || decided.current) return;
    let live = true;
    void missedReleases(notes)
      .then((releases) => {
        if (!live) return;
        decided.current = true;
        setMissed(releases);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled, notes]);
  // Closing is immediate; the server answer is not awaited (a failure only brings the notes back later).
  const acknowledge = useCallback(() => {
    const latest = missed[0];
    setMissed([]);
    if (latest) void sendSeenRelease(latest.id).catch(() => {});
  }, [missed]);
  return { releases: enabled ? missed : [], acknowledge };
}

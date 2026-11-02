import type { SeenReleaseResponse, SessionResponse } from '@arbestra/contracts';

/**
 * The release notes the Oracle presents (docs/SPEC-NOUVEAUTES-ORACLE.md). The
 * account's last seen version rides on the session the lobby already reads;
 * nothing here is a village command, so there is no protocol header and a
 * failure is the caller's to ignore (the notes simply come back at the next load).
 */
export async function readLastSeenRelease(signal?: AbortSignal): Promise<string | null> {
  const response = await fetch('/api/auth/session', { credentials: 'same-origin', ...(signal ? { signal } : {}) });
  if (!response.ok) throw new Error(`Session ${response.status}`);
  return ((await response.json()) as SessionResponse).account.lastSeenRelease;
}

/** "Compris": the server keeps the most recent of this version and the stored one. */
export async function sendSeenRelease(releaseId: string): Promise<string> {
  const response = await fetch('/api/account/seen-release', {
    method: 'POST',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ releaseId }),
  });
  if (!response.ok) throw new Error(`Seen release ${response.status}`);
  return ((await response.json()) as SeenReleaseResponse).lastSeenRelease;
}

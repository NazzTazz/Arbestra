import { Type, type Static } from '@sinclair/typebox';
import { RELEASE_NOTES } from './release-notes.js';

/** One point of a release, as the player reads it. */
export interface ReleaseItem {
  readonly title: string;
  readonly text: string;
}

/** What the Oracle tells about one `alpha-*` version (content: release-notes.ts). */
export interface Release {
  /** The tag, e.g. `alpha-2026.11.02.1`. */
  readonly id: string;
  /** Day of the tag, `YYYY-MM-DD`. */
  readonly date: string;
  readonly items: readonly ReleaseItem[];
}

/**
 * The version every existing account was credited with when the notes were
 * introduced (migration 081): the alpha before the first entry. It is older
 * than every entry and is the only identifier that is known without being in
 * the list. Never change it: it is part of 081.
 */
export const RELEASE_BASELINE_ID = 'alpha-2026.11.01.1';

/** A tag-shaped identifier, bounded: `alpha-2026.11.02.1`. */
export const ReleaseIdSchema = Type.String({
  minLength: 1,
  maxLength: 40,
  pattern: '^[a-z]+-\\d{4}\\.\\d{2}\\.\\d{2}\\.\\d{1,3}$',
});

export const SeenReleaseRequestSchema = Type.Object({ releaseId: ReleaseIdSchema }, { additionalProperties: false });
export type SeenReleaseRequest = Static<typeof SeenReleaseRequestSchema>;

/** The identifier now stored for the account (never older than before). */
export const SeenReleaseResponseSchema = Type.Object({ lastSeenRelease: Type.String() });
export type SeenReleaseResponse = Static<typeof SeenReleaseResponseSchema>;

/**
 * Rank of an identifier in history: 0 is the most recent entry, the baseline
 * comes right after the last entry, and an identifier the list does not know
 * has no rank. The list order is the only authority; dates are never compared.
 */
export function releaseRank(releases: readonly Release[], id: string): number | null {
  const index = releases.findIndex((release) => release.id === id);
  if (index >= 0) return index;
  return id === RELEASE_BASELINE_ID ? releases.length : null;
}

/** The latest version of the list: what a new account has already seen. */
export function latestReleaseId(releases: readonly Release[] = RELEASE_NOTES): string {
  return releases[0]?.id ?? RELEASE_BASELINE_ID;
}

/**
 * The versions newer than the last one seen, most recent first. An identifier
 * the list does not know (a client older than the account, a rolled-back
 * deployment) shows nothing rather than the whole history.
 */
export function releasesToShow(releases: readonly Release[], lastSeen: string): readonly Release[] {
  const rank = releaseRank(releases, lastSeen);
  return rank === null ? [] : releases.slice(0, rank);
}

/** What the client does once it knows the account's last seen version. */
export type ReleaseNotice =
  | { readonly kind: 'show'; readonly releases: readonly Release[] }
  | { readonly kind: 'record'; readonly releaseId: string }
  | { readonly kind: 'none' };

/**
 * An account with no version yet (created before the notes, outside the
 * registration route) gets the current one recorded without any dialog: it
 * has no history to catch up on. Otherwise the missed versions are shown.
 */
export function releaseNotice(releases: readonly Release[], lastSeen: string | null): ReleaseNotice {
  if (lastSeen === null) return { kind: 'record', releaseId: latestReleaseId(releases) };
  const missed = releasesToShow(releases, lastSeen);
  return missed.length > 0 ? { kind: 'show', releases: missed } : { kind: 'none' };
}

/**
 * The value to store when an account says it has seen `seen` (a known
 * identifier) while `current` is stored: the most recent of the two, so a late
 * request from an old tab never moves the account back. A stored value the
 * list does not know (newer than this deployment) is kept as it is.
 */
export function mostRecentSeenRelease(releases: readonly Release[], current: string | null, seen: string): string {
  if (current === null) return seen;
  const currentRank = releaseRank(releases, current),
    seenRank = releaseRank(releases, seen);
  if (currentRank === null) return current;
  if (seenRank === null) return current;
  return seenRank < currentRank ? seen : current;
}

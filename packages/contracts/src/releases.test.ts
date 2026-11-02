import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { RELEASE_NOTES } from './release-notes.js';
import {
  RELEASE_BASELINE_ID,
  SeenReleaseRequestSchema,
  latestReleaseId,
  mostRecentSeenRelease,
  releaseNotice,
  releaseRank,
  releasesToShow,
  type Release,
} from './releases.js';

const item = { title: 'Titre', text: 'Une phrase.' };
/** Most recent first, as the real list. Note the tenth of the day: ids are never compared as text. */
const list: readonly Release[] = [
  { id: 'alpha-2026.11.10.1', date: '2026-11-10', items: [item] },
  { id: 'alpha-2026.11.09.10', date: '2026-11-09', items: [item] },
  { id: 'alpha-2026.11.09.9', date: '2026-11-09', items: [item] },
  { id: 'alpha-2026.11.05.1', date: '2026-11-05', items: [item] },
];
const ids = (releases: readonly Release[]) => releases.map((release) => release.id);

describe('releasesToShow', () => {
  it('shows nothing to an account that has seen the latest version', () => {
    expect(releasesToShow(list, 'alpha-2026.11.10.1')).toEqual([]);
  });

  it('shows the one version missed, then every version missed, most recent first', () => {
    expect(ids(releasesToShow(list, 'alpha-2026.11.09.10'))).toEqual(['alpha-2026.11.10.1']);
    expect(ids(releasesToShow(list, 'alpha-2026.11.05.1'))).toEqual([
      'alpha-2026.11.10.1',
      'alpha-2026.11.09.10',
      'alpha-2026.11.09.9',
    ]);
  });

  it('follows the order of the list, not the text of the identifiers', () => {
    // As text ".10" sorts before ".9": the list order says 9.10 is the newer one.
    expect(ids(releasesToShow(list, 'alpha-2026.11.09.9'))).toEqual(['alpha-2026.11.10.1', 'alpha-2026.11.09.10']);
  });

  it('shows the whole list to the baseline, the version before the first entry', () => {
    expect(ids(releasesToShow(list, RELEASE_BASELINE_ID))).toEqual(ids(list));
  });

  it('shows nothing for an identifier the list does not know, never the whole history', () => {
    expect(releasesToShow(list, 'alpha-2099.01.01.1')).toEqual([]);
    expect(releasesToShow(list, 'staging-2026.11.05.1')).toEqual([]);
    expect(releasesToShow(list, '')).toEqual([]);
  });
});

describe('releaseNotice', () => {
  it('records the current version without a dialog for an account that has no version yet', () => {
    expect(releaseNotice(list, null)).toEqual({ kind: 'record', releaseId: 'alpha-2026.11.10.1' });
  });

  it('shows the missed versions, or nothing', () => {
    const notice = releaseNotice(list, 'alpha-2026.11.05.1');
    expect(notice.kind).toBe('show');
    expect(notice.kind === 'show' && ids(notice.releases)).toEqual([
      'alpha-2026.11.10.1',
      'alpha-2026.11.09.10',
      'alpha-2026.11.09.9',
    ]);
    expect(releaseNotice(list, 'alpha-2026.11.10.1')).toEqual({ kind: 'none' });
    expect(releaseNotice(list, 'alpha-2099.01.01.1')).toEqual({ kind: 'none' });
  });
});

describe('latestReleaseId and releaseRank', () => {
  it('names the first entry, or the baseline when the list is empty', () => {
    expect(latestReleaseId(list)).toBe('alpha-2026.11.10.1');
    expect(latestReleaseId([])).toBe(RELEASE_BASELINE_ID);
    expect(releaseNotice([], null)).toEqual({ kind: 'record', releaseId: RELEASE_BASELINE_ID });
  });

  it('ranks the entries, then the baseline after them, and nothing else', () => {
    expect(releaseRank(list, 'alpha-2026.11.10.1')).toBe(0);
    expect(releaseRank(list, 'alpha-2026.11.05.1')).toBe(3);
    expect(releaseRank(list, RELEASE_BASELINE_ID)).toBe(4);
    expect(releaseRank(list, 'alpha-2099.01.01.1')).toBeNull();
  });
});

describe('mostRecentSeenRelease', () => {
  it('moves forward, never back, and is idempotent', () => {
    expect(mostRecentSeenRelease(list, RELEASE_BASELINE_ID, 'alpha-2026.11.09.9')).toBe('alpha-2026.11.09.9');
    expect(mostRecentSeenRelease(list, 'alpha-2026.11.09.9', 'alpha-2026.11.10.1')).toBe('alpha-2026.11.10.1');
    expect(mostRecentSeenRelease(list, 'alpha-2026.11.10.1', 'alpha-2026.11.05.1')).toBe('alpha-2026.11.10.1');
    expect(mostRecentSeenRelease(list, 'alpha-2026.11.10.1', RELEASE_BASELINE_ID)).toBe('alpha-2026.11.10.1');
    expect(mostRecentSeenRelease(list, 'alpha-2026.11.09.9', 'alpha-2026.11.09.9')).toBe('alpha-2026.11.09.9');
  });

  it('takes the version when the account has none, and keeps a stored version this list does not know', () => {
    expect(mostRecentSeenRelease(list, null, 'alpha-2026.11.05.1')).toBe('alpha-2026.11.05.1');
    expect(mostRecentSeenRelease(list, 'alpha-2099.01.01.1', 'alpha-2026.11.10.1')).toBe('alpha-2099.01.01.1');
  });
});

describe('seen release request', () => {
  it('accepts a tag-shaped identifier and nothing else', () => {
    const valid = (releaseId: unknown) => Value.Check(SeenReleaseRequestSchema, { releaseId });
    expect(valid('alpha-2026.11.02.1')).toBe(true);
    expect(valid('')).toBe(false);
    expect(valid('alpha-next')).toBe(false);
    expect(valid('alpha-2026.11.02.1; drop table accounts')).toBe(false);
    expect(valid('a'.repeat(300))).toBe(false);
    expect(valid(42)).toBe(false);
    expect(Value.Check(SeenReleaseRequestSchema, { releaseId: 'alpha-2026.11.02.1', extra: 1 })).toBe(false);
  });
});

describe('the published release notes', () => {
  it('has well-formed entries, most recent first, each one distinct and after the baseline', () => {
    expect(RELEASE_NOTES.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const release of RELEASE_NOTES) {
      expect(release.id).toMatch(/^alpha-\d{4}\.\d{2}\.\d{2}\.\d{1,3}$/);
      expect(release.id).not.toBe(RELEASE_BASELINE_ID);
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isFinite(Date.parse(release.date))).toBe(true);
      expect(release.id.slice('alpha-'.length, 'alpha-'.length + 10).replaceAll('.', '-')).toBe(release.date);
      expect(seen.has(release.id)).toBe(false);
      seen.add(release.id);
      expect(release.items.length).toBeGreaterThanOrEqual(2);
      expect(release.items.length).toBeLessThanOrEqual(5);
      for (const entry of release.items) {
        expect(entry.title.trim()).not.toBe('');
        expect(entry.title.length).toBeLessThanOrEqual(60);
        expect(entry.text.trim()).not.toBe('');
        expect(entry.text.length).toBeLessThanOrEqual(260);
      }
    }
    // Every entry is later than the baseline (1 November), and the dates never go forward down the list.
    expect(RELEASE_NOTES.at(-1)!.date >= '2026-11-01').toBe(true);
    const dates = RELEASE_NOTES.map((release) => release.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});

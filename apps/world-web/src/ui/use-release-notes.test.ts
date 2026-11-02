import { describe, expect, it, vi } from 'vitest';
import { RELEASE_BASELINE_ID, type Release } from '@arbestra/contracts';
import { missedReleases } from './use-release-notes';

const item = { title: 'Titre', text: 'Une phrase.' };
const notes: readonly Release[] = [
  { id: 'alpha-2026.11.09.1', date: '2026-11-09', items: [item] },
  { id: 'alpha-2026.11.05.1', date: '2026-11-05', items: [item] },
];
const ids = (releases: readonly Release[]) => releases.map((release) => release.id);

describe('missedReleases', () => {
  it('returns every version missed, most recent first, and records nothing until the player agrees', async () => {
    const record = vi.fn().mockResolvedValue('x');
    expect(ids(await missedReleases(notes, async () => RELEASE_BASELINE_ID, record))).toEqual([
      'alpha-2026.11.09.1',
      'alpha-2026.11.05.1',
    ]);
    expect(ids(await missedReleases(notes, async () => 'alpha-2026.11.05.1', record))).toEqual(['alpha-2026.11.09.1']);
    expect(record).not.toHaveBeenCalled();
  });

  it('shows nothing to an account that is up to date or whose version is unknown', async () => {
    const record = vi.fn().mockResolvedValue('x');
    expect(await missedReleases(notes, async () => 'alpha-2026.11.09.1', record)).toEqual([]);
    expect(await missedReleases(notes, async () => 'alpha-2099.01.01.1', record)).toEqual([]);
    expect(record).not.toHaveBeenCalled();
  });

  it('records the current version in silence for an account that has none, and shows nothing', async () => {
    const record = vi.fn().mockResolvedValue('alpha-2026.11.09.1');
    expect(await missedReleases(notes, async () => null, record)).toEqual([]);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('alpha-2026.11.09.1');
  });

  it('ignores a failed silent record but reports an account that cannot be read', async () => {
    expect(
      await missedReleases(
        notes,
        async () => null,
        async () => {
          throw new Error('offline');
        },
      ),
    ).toEqual([]);
    await expect(
      missedReleases(
        notes,
        async () => {
          throw new Error('Session 401');
        },
        vi.fn(),
      ),
    ).rejects.toThrow('Session 401');
  });
});

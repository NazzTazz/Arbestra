import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Release } from '@arbestra/contracts';
import { ReleaseNotesDialog, formatReleaseDate } from './ReleaseNotesDialog';

const releases: readonly Release[] = [
  {
    id: 'alpha-2026.11.09.1',
    date: '2026-11-09',
    items: [
      { title: 'Le plus récent', text: 'Une phrase récente.' },
      { title: 'Un autre', text: 'Une autre phrase.' },
    ],
  },
  { id: 'alpha-2026.11.05.1', date: '2026-11-05', items: [{ title: 'Le plus ancien', text: 'Une phrase ancienne.' }] },
];

describe('ReleaseNotesDialog', () => {
  const markup = renderToStaticMarkup(createElement(ReleaseNotesDialog, { releases, onClose: () => {} }));

  it('is a modal dialog of the Oracle with one way out', () => {
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="oracle-news-title"');
    expect(markup).toContain('L’Oracle');
    expect(markup).toContain('>Compris</button>');
  });

  it('lists every version it is given, the most recent first, with its day and every point', () => {
    expect(markup.indexOf('9 novembre 2026')).toBeGreaterThan(-1);
    expect(markup.indexOf('9 novembre 2026')).toBeLessThan(markup.indexOf('5 novembre 2026'));
    for (const text of ['Le plus récent', 'Une phrase récente.', 'Un autre', 'Une autre phrase.'])
      expect(markup).toContain(text);
    expect(markup.indexOf('Le plus récent')).toBeLessThan(markup.indexOf('Le plus ancien'));
    expect(markup).toContain('dateTime="2026-11-09"');
  });
});

describe('formatReleaseDate', () => {
  it('reads the day as written, in French', () => {
    expect(formatReleaseDate('2026-11-02')).toBe('2 novembre 2026');
    expect(formatReleaseDate('2026-12-31')).toBe('31 décembre 2026');
    expect(formatReleaseDate('2027-01-01')).toBe('1 janvier 2027');
  });
});

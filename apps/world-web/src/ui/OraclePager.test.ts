import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OraclePager, SWIPE_THRESHOLD_PX, pagerKey, pagerStep, swipeAction } from './OraclePager';

describe('the Oracle’s pager', () => {
  it('turns one page at a time and stays at both ends', () => {
    expect(pagerStep(0, 3, 'next')).toBe(1);
    expect(pagerStep(1, 3, 'next')).toBe(2);
    expect(pagerStep(2, 3, 'next')).toBe(2);
    expect(pagerStep(2, 3, 'previous')).toBe(1);
    expect(pagerStep(0, 3, 'previous')).toBe(0);
    expect(pagerStep(0, 1, 'next')).toBe(0);
  });

  it('maps ← and → only', () => {
    expect(pagerKey('ArrowLeft')).toBe('previous');
    expect(pagerKey('ArrowRight')).toBe('next');
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'a']) expect(pagerKey(key)).toBeNull();
  });

  it('turns on a horizontal swipe from the threshold on, never on a short or vertical one', () => {
    expect(SWIPE_THRESHOLD_PX).toBe(40);
    expect(swipeAction(-39, 0)).toBeNull();
    expect(swipeAction(-40, 0)).toBe('next');
    expect(swipeAction(40, 0)).toBe('previous');
    expect(swipeAction(39.9, 0)).toBeNull();
    // More vertical than horizontal: a scroll, not a page.
    expect(swipeAction(-60, 60)).toBeNull();
    expect(swipeAction(-60, -59)).toBe('next');
    // A click (no travel) never turns.
    expect(swipeAction(0, 0)).toBeNull();
  });

  it('shows « ‹ i/X › » with disabled ends, nothing for one page', () => {
    const first = renderToStaticMarkup(createElement(OraclePager, { index: 0, count: 3, onStep: () => {} }));
    expect(first).toContain('1/3');
    expect(first).toMatch(/aria-label="Message précédent"[^>]*disabled/);
    expect(first).not.toMatch(/aria-label="Message suivant"[^>]*disabled/);
    const last = renderToStaticMarkup(createElement(OraclePager, { index: 2, count: 3, onStep: () => {} }));
    expect(last).toContain('3/3');
    expect(last).toMatch(/aria-label="Message suivant"[^>]*disabled/);
    expect(renderToStaticMarkup(createElement(OraclePager, { index: 0, count: 1, onStep: () => {} }))).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { boundedHttpPeriod, frozenQuery, httpApiPath, httpDetailLink, isFrozen, nextPageLink, previousPageLink, recentLink, safeReturnLink } from './http-navigation';

const window = { instanceId: 'instance-a', from: '2026-10-15T10:00:00Z', to: '2026-10-15T10:10:00Z', snapshotSequence: 120 };
describe('HTTP diagnostic navigation', () => {
  it('bounds a delayed sample link to ten minutes without inventing an invalid interval', () => {
    expect(boundedHttpPeriod('2026-10-15T09:40:00Z', window.to)).toEqual({ from: '2026-10-15T10:00:00.000Z', to: window.to, clamped: true });
    expect(boundedHttpPeriod(window.from, window.to)?.clamped).toBe(false);
    expect(boundedHttpPeriod(window.to, window.from)).toBeNull();
  });
  it('pins dates, instance and sequence while new observations arrive', () => {
    const query = new URLSearchParams('reason=slow&route=%2Fapi%2Fworlds%2F%3Aid&window=5');
    const next = nextPageLink(query, window, 70);
    const parsed = new URLSearchParams(next.split('?')[1]);
    expect(parsed.get('snapshotSequence')).toBe('120'); expect(parsed.get('beforeSequence')).toBe('70');
    expect(parsed.get('instanceId')).toBe('instance-a'); expect(parsed.get('to')).toBe(window.to);
    expect(parsed.get('reason')).toBe('slow'); expect(isFrozen(parsed)).toBe(true);
    const previous = new URLSearchParams(previousPageLink(parsed)!.split('?')[1]);
    expect(previous.has('beforeSequence')).toBe(false); expect(previous.get('snapshotSequence')).toBe('120');
  });
  it('preserves the complete frozen window on a detail round trip', () => {
    const query = frozenQuery(new URLSearchParams('reason=server_error&beforeSequence=80'), window);
    const returnTo = `#/infrastructure/http?${query}`;
    const detail = httpDetailLink(window.instanceId, 'request-a', returnTo);
    expect(safeReturnLink(new URLSearchParams(detail.split('?')[1]).get('returnTo'))).toBe(returnTo);
    expect(safeReturnLink('https://untrusted.example')).toBe('#/infrastructure/http');
  });
  it('only changes instance after an explicit reset and never sends UI paging state to the API', () => {
    const query = frozenQuery(new URLSearchParams('reason=slow&trail=0,90&beforeSequence=40'), window);
    expect(new URLSearchParams(recentLink(query).split('?')[1]).get('instanceId')).toBe('instance-a');
    expect(new URLSearchParams(recentLink(query, true).split('?')[1]).has('instanceId')).toBe(false);
    const apiQuery = new URL(httpApiPath(query), 'http://localhost').searchParams;
    expect(apiQuery.has('trail')).toBe(false); expect(apiQuery.get('beforeSequence')).toBe('40');
  });
  it('uses real rolling dates only for a recent view, preserving fixed intervals verbatim', () => {
    const api = new URL(httpApiPath(new URLSearchParams('window=5'), Date.parse(window.to)), 'http://localhost');
    expect(api.searchParams.get('from')).toBe('2026-10-15T10:05:00.000Z');
    const fixed = new URL(httpApiPath(frozenQuery(new URLSearchParams(), window), Date.parse(window.to) + 90_000), 'http://localhost');
    expect(fixed.searchParams.get('to')).toBe(window.to);
  });
});

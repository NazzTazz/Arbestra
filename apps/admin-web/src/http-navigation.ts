const apiKeys = [
  'instanceId',
  'from',
  'to',
  'reason',
  'method',
  'route',
  'scope',
  'requestId',
  'minDurationMs',
  'limit',
  'snapshotSequence',
  'beforeSequence',
] as const;
const listPath = '#/infrastructure/http';

export function boundedHttpPeriod(from: string, to: string): { from: string; to: string; clamped: boolean } | null {
  const start = Date.parse(from),
    end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return null;
  const clamped = end - start > 600_000;
  return { from: clamped ? new Date(end - 600_000).toISOString() : from, to, clamped };
}

export function httpListLink(values: Record<string, string | number | undefined> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== '') query.set(key, String(value));
  return listPath + (query.size ? `?${query}` : '');
}
export function isFrozen(query: URLSearchParams): boolean {
  return query.has('snapshotSequence') || query.has('beforeSequence') || query.has('from') || query.has('to');
}
export function httpApiPath(query: URLSearchParams, now = Date.now()): string {
  const result = new URLSearchParams();
  for (const key of apiKeys) {
    const value = query.get(key);
    if (value !== null && value !== '') result.set(key, value);
  }
  if (!result.has('from') && !result.has('to')) {
    const windowMinutes = Number(query.get('window') ?? 10);
    const duration = [1, 5, 10].includes(windowMinutes) ? windowMinutes : 10;
    result.set('from', new Date(now - duration * 60_000).toISOString());
    result.set('to', new Date(now).toISOString());
  }
  return `/api/admin/http-requests?${result}`;
}
export interface HttpWindow {
  instanceId: string;
  from: string;
  to: string;
  snapshotSequence: number;
}
export function frozenQuery(query: URLSearchParams, window: HttpWindow): URLSearchParams {
  const next = new URLSearchParams(query);
  next.set('instanceId', window.instanceId);
  next.set('from', window.from);
  next.set('to', window.to);
  next.set('snapshotSequence', String(window.snapshotSequence));
  next.delete('window');
  return next;
}
export function nextPageLink(query: URLSearchParams, window: HttpWindow, beforeSequence: number): string {
  const next = frozenQuery(query, window);
  const trail = (query.get('trail') ?? '')
    .split(',')
    .filter((value) => /^\d+$/.test(value))
    .slice(-31);
  trail.push(query.get('beforeSequence') ?? '0');
  next.set('trail', trail.join(','));
  next.set('beforeSequence', String(beforeSequence));
  return `${listPath}?${next}`;
}
export function previousPageLink(query: URLSearchParams): string | null {
  const trail = (query.get('trail') ?? '').split(',').filter((value) => /^\d+$/.test(value));
  if (!trail.length) return null;
  const previous = trail.pop()!,
    next = new URLSearchParams(query);
  if (previous === '0') next.delete('beforeSequence');
  else next.set('beforeSequence', previous);
  if (trail.length) next.set('trail', trail.join(','));
  else next.delete('trail');
  return `${listPath}?${next}`;
}
export function recentLink(query: URLSearchParams, newInstance = false): string {
  const next = new URLSearchParams(query);
  for (const key of ['from', 'to', 'snapshotSequence', 'beforeSequence', 'trail']) next.delete(key);
  if (newInstance) next.delete('instanceId');
  return `${listPath}?${next}`;
}
export function safeReturnLink(value: string | null): string {
  return value && (value === listPath || value.startsWith(`${listPath}?`)) ? value : listPath;
}
export function httpDetailLink(instanceId: string, requestId: string, returnTo?: string): string {
  const query = new URLSearchParams({ instanceId });
  if (returnTo) query.set('returnTo', safeReturnLink(returnTo));
  return `${listPath}/${encodeURIComponent(requestId)}?${query}`;
}

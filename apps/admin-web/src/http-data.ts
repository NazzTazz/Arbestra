import { useContext, useEffect, useRef, useState } from 'react';
import type { HttpDiagnosticsMetadata } from '@arbestra/contracts';
import { ApiError, request, SessionExpiry } from './api';

export function assertDiagnosticInstance(expected: string | null, received: string): void {
  if (expected && expected !== received)
    throw new ApiError('L’instance observée a changé.', 409, 'INSTANCE_MISMATCH', received);
}

/** Each view pins the first responding instance, including refreshes without a URL pin. */
export function useDiagnostics<T extends { metadata: HttpDiagnosticsMetadata }>(
  key: string,
  makePath: () => string,
  live: boolean,
) {
  const onExpired = useContext(SessionExpiry);
  const callback = useRef({ makePath, onExpired });
  callback.current = { makePath, onExpired };
  const instance = useRef<{ key: string; id: string | null }>({ key, id: null });
  const [result, setResult] = useState<{ key: string; data: T; receivedAt: number } | null>(null);
  const [failure, setFailure] = useState<{ key: string; error: Error } | null>(null);
  const [busy, setBusy] = useState<string | null>(key),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let closed = false,
      pending = false,
      changedInstance = false;
    if (instance.current.key !== key) instance.current = { key, id: null };
    const controller = new AbortController();
    const read = async () => {
      if (closed || pending || changedInstance) return;
      pending = true;
      setBusy(key);
      const url = new URL(callback.current.makePath(), window.location.origin);
      if (instance.current.id && !url.searchParams.has('instanceId'))
        url.searchParams.set('instanceId', instance.current.id);
      try {
        const data = await request<T>(url.pathname + url.search, { signal: controller.signal });
        if (closed) return;
        assertDiagnosticInstance(instance.current.id ?? url.searchParams.get('instanceId'), data.metadata.instanceId);
        instance.current.id = data.metadata.instanceId;
        setResult({ key, data, receivedAt: Date.now() });
        setFailure(null);
      } catch (error) {
        if (closed) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) callback.current.onExpired();
        changedInstance = error instanceof ApiError && error.code === 'INSTANCE_MISMATCH';
        setFailure({ key, error: error instanceof Error ? error : new Error('Lecture diagnostique indisponible.') });
      } finally {
        pending = false;
        if (!closed) setBusy(null);
      }
    };
    void read();
    const timer = live
      ? window.setInterval(() => {
          if (!document.hidden) void read();
        }, 15_000)
      : null;
    const visible = () => {
      if (live && !document.hidden) void read();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      closed = true;
      controller.abort();
      if (timer !== null) clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [key, live, revision]);
  return {
    data: result?.key === key ? result.data : null,
    receivedAt: result?.key === key ? result.receivedAt : null,
    error: failure?.key === key ? failure.error : null,
    loading: busy === key,
    refresh: () => setRevision((value) => value + 1),
  };
}

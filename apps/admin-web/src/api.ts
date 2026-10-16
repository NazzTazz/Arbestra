import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { AdminSession } from '@arbestra/contracts';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string | null = null,
    public readonly instanceId: string | null = null) { super(message); }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init, credentials: 'same-origin',
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; code?: string; instanceId?: string } | null;
    throw new ApiError(body?.message ?? `La requête a échoué (HTTP ${response.status}).`, response.status, body?.code ?? null, body?.instanceId ?? null);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export async function currentSession(): Promise<AdminSession | null> {
  try { return await request<AdminSession>('/api/admin/session'); }
  catch (error) { if (error instanceof ApiError && error.status === 401) return null; throw error; }
}
export const SessionExpiry = createContext<() => void>(() => {});
export const errorMessage = (error: unknown): string => error instanceof Error
  ? error.name === 'TimeoutError' ? 'Le serveur ne répond pas dans le délai prévu. Réessayez.' : error.message
  : 'Impossible de joindre le serveur.';

export function useResource<T>(path: string, refreshMs = 15_000) {
  const onExpired = useContext(SessionExpiry);
  const [result, setResult] = useState<{ path: string; value: T; receivedAt: number } | null>(null);
  const [failure, setFailure] = useState<{ path: string; message: string } | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(path);
  const [revision, setRevision] = useState(0);
  const onExpiredRef = useRef(onExpired); onExpiredRef.current = onExpired;
  useEffect(() => {
    let closed = false, pending = false;
    const controller = new AbortController();
    const load = async () => {
      if (closed || pending) return;
      pending = true; setBusyPath(path);
      try {
        const value = await request<T>(path, { signal: controller.signal });
        if (!closed) { setResult({ path, value, receivedAt: Date.now() }); setFailure(null); }
      } catch (error) {
        if (!closed) {
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) onExpiredRef.current();
          setFailure({ path, message: errorMessage(error) });
        }
      } finally { pending = false; if (!closed) setBusyPath(null); }
    };
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, refreshMs);
    const visible = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { closed = true; controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [path, refreshMs, revision]);
  return {
    data: result?.path === path ? result.value : null,
    receivedAt: result?.path === path ? result.receivedAt : null,
    error: failure?.path === path ? failure.message : null,
    loading: busyPath === path,
    refresh: () => setRevision(value => value + 1),
  };
}

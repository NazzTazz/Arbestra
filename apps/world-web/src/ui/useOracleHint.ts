import { useCallback, useEffect, useRef } from 'react';
import { OracleHintTimer, ORACLE_HINT, type HintProgress } from './oracle-hint';

export function useOracleHint(villageKey: string | null, available: boolean, pending: boolean, notify: (message: string) => void) {
  const timer = useRef<OracleHintTimer | null>(null);
  const latest = useRef({ available, pending, notify });
  latest.current = { available, pending, notify };
  const save = useCallback(() => {
    if (!villageKey || !timer.current) return;
    try { sessionStorage.setItem(`oracle-hint:${villageKey}`, JSON.stringify(timer.current.progress)); }
    catch { /* Storage unavailable: keep the current page's state. */ }
  }, [villageKey]);
  const progressed = useCallback(() => {
    if (timer.current) { timer.current.progress.suppressed = true; save(); }
  }, [save]);

  useEffect(() => {
    if (!villageKey) return;
    let progress: HintProgress = { elapsed: 0, suppressed: false };
    try {
      const stored = JSON.parse(sessionStorage.getItem(`oracle-hint:${villageKey}`) ?? 'null') as HintProgress | null;
      if (stored && Number.isFinite(stored.elapsed) && stored.elapsed >= 0 && typeof stored.suppressed === 'boolean') progress = stored;
    } catch { /* An unavailable or invalid cache cannot prevent gameplay. */ }
    timer.current = new OracleHintTimer(progress, performance.now(), document.visibilityState === 'visible');
    const observe = () => {
      const current = latest.current;
      if (timer.current?.observe(performance.now(), document.visibilityState === 'visible', current.available, current.pending))
        current.notify(ORACLE_HINT);
      save();
    };
    observe();
    const interval = window.setInterval(observe, 250);
    document.addEventListener('visibilitychange', observe);
    window.addEventListener('pagehide', observe);
    return () => {
      observe();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', observe);
      window.removeEventListener('pagehide', observe);
      timer.current = null;
    };
  }, [villageKey, save]);
  return progressed;
}

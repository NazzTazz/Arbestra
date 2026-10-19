import { useEffect, useState } from 'react';

/** Only the visible UI that needs elapsed time should subscribe to the clock. */
export function usePresentationClock(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return active ? now : Date.now();
}

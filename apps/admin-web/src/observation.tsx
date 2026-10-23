import { useContext, useEffect, useRef, useState } from 'react';
import type { ObservationLaunch } from '@arbestra/contracts';
import { ApiError, errorMessage, request, SessionExpiry } from './api';

/** The NOC launches the real world client; it never hosts a second renderer. */
export function ObservationPage({ worldId, villageId }: { worldId: string; villageId: string }) {
  const [error, setError] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0);
  const expire = useContext(SessionExpiry),
    expiry = useRef(expire);
  expiry.current = expire;
  const flight = useRef<{ key: string; promise: Promise<ObservationLaunch> } | null>(null);
  useEffect(() => {
    let active = true;
    setError(null);
    const key = worldId + ':' + villageId + ':' + attempt;
    if (flight.current?.key !== key)
      flight.current = {
        key,
        promise: request<ObservationLaunch>('/api/admin/observations/launch', {
          method: 'POST',
          body: JSON.stringify({ worldId, villageId }),
        }),
      };
    void flight.current.promise
      .then((launch) => {
        if (active) window.location.replace(launch.url);
      })
      .catch((e) => {
        if (!active) return;
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) expiry.current();
        setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [worldId, villageId, attempt]);
  return (
    <section>
      <h1>Observation du village</h1>
      <p>Ouverture du client village en lecture seule…</p>
      {error && (
        <p role="alert" className="form-error">
          {error} <button onClick={() => setAttempt((n) => n + 1)}>Réessayer</button>
        </p>
      )}
    </section>
  );
}

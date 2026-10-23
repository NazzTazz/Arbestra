import { useEffect, useState } from 'react';
import type { ObservationPose, VillageState } from '@arbestra/contracts';
let reader: (() => ObservationPose | null) | null = null;
export function observationCameraReader(read: () => ObservationPose | null) {
  reader = read;
  return () => {
    if (reader === read) reader = null;
  };
}
/** Publication is dormant until a valid observer exists; no frame-rate network work. */
export function useObservationPublisher(state: VillageState | null) {
  const [active, setActive] = useState(false);
  const world = state?.world.slug,
    village = state?.village.id;
  useEffect(() => {
    setActive(false);
    if (!world || !village) return;
    let closed = false,
      pending = false,
      enabled = false,
      sourceId: string | null = null,
      sequence = 0,
      last = '',
      poseAt = 0,
      statusAt = 0,
      hidden = document.hidden;
    const controller = new AbortController(),
      base = '/api/worlds/' + encodeURIComponent(world) + '/villages/' + village + '/observation';
    const post = async <T>(suffix: string, body?: unknown): Promise<T> => {
      const r = await fetch(base + suffix, {
        method: 'POST',
        credentials: 'same-origin',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      if (!r.ok) throw Error('Observation unavailable');
      return r.json();
    };
    const tick = async () => {
      if (closed || pending) return;
      pending = true;
      try {
        const now = Date.now();
        if (now - statusAt >= 5000) {
          statusAt = now;
          const s = await post<{ active: boolean }>('/status');
          if (closed) return;
          enabled = s.active;
          setActive(enabled);
          if (!enabled) {
            sourceId = null;
            last = '';
            return;
          }
        }
        if (!enabled) return;
        const pose = reader?.();
        if (!pose) return;
        if (!sourceId) {
          sourceId = (await post<{ sourceId: string }>('/sources')).sourceId;
          last = '';
          sequence = 0;
        }
        const json = JSON.stringify(pose, (_key, value: unknown) =>
            typeof value === 'number' ? Math.round(value * 1e5) / 1e5 : value,
          ),
          visible = !document.hidden,
          changed = json !== last || hidden !== document.hidden;
        if (!changed && now - poseAt < 5000) return;
        if (document.hidden && hidden === true && last) return;
        const result = await post<{ needPose: boolean }>('/camera', {
          version: 1,
          sourceId,
          poseSequence: changed ? ++sequence : sequence,
          visible,
          ...(changed ? { pose } : {}),
        });
        if (closed) return;
        hidden = document.hidden;
        poseAt = now;
        last = result.needPose ? '' : json;
      } catch {
        sourceId = null;
        last = '';
        enabled = false;
        statusAt = Date.now();
        if (!closed) setActive(false);
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(() => void tick(), 200);
    void tick();
    document.addEventListener('visibilitychange', tick);
    return () => {
      closed = true;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [world, village]);
  return active;
}

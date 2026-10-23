import type { ObservationLease } from '@arbestra/contracts';
import type { SceneTransport } from '../scene/scene-transport';
import { observationAddress } from './observation-address';

export class ObservationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function observationRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ObservationError(error?.message ?? 'Observation momentanément indisponible.', response.status);
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
let bootstrap: Promise<ObservationLease> | undefined;
export function startObservation() {
  if (bootstrap) return bootstrap;
  const address = observationAddress(location.href);
  history.replaceState(history.state, '', address.cleanHref);
  if (!address.leaseId || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(address.leaseId))
    return (bootstrap = Promise.reject(new Error('Lien d’observation invalide.')));
  const work = address.token
    ? observationRequest<ObservationLease>('/api/observation/exchange', {
        method: 'POST',
        body: JSON.stringify({ token: address.token }),
      })
    : observationRequest<{ lease: ObservationLease }>('/api/observation/' + address.leaseId).then((s) => s.lease);
  return (bootstrap = work.then((lease) => {
    if (lease.id !== address.leaseId) throw new Error('Contexte d’observation invalide.');
    return lease;
  }));
}
export function observationTransport(id: string, signal: AbortSignal): SceneTransport {
  async function terrain<T>(
    kind: string,
    chunks?: Array<{ chunkX: number; chunkY: number }>,
    abort?: AbortSignal,
    x?: number,
    y?: number,
  ): Promise<T> {
    const query = new URLSearchParams({ kind });
    if (chunks) query.set('chunks', chunks.map((c) => c.chunkX + ',' + c.chunkY).join(';'));
    if (x !== undefined) query.set('x', String(Math.floor(x)));
    if (y !== undefined) query.set('y', String(Math.floor(y)));
    return observationRequest<T>('/api/observation/' + id + '/terrain?' + query, {
      signal: abort ? AbortSignal.any([signal, abort]) : signal,
    });
  }
  return {
    readOnly: true,
    getTerrain: (_w, c, s) => terrain('chunks', c, s),
    getTerrainUpdates: (_w, c, s) => terrain('updates', c, s),
    getTerrainOverview: (_w, s) => terrain('overview', undefined, s),
    getTerrainVegetationOverview: (_w, s) => terrain('vegetation', undefined, s),
    getTerrainVillages: (_w, x, y, s) => terrain('villages', undefined, s, x, y),
  };
}

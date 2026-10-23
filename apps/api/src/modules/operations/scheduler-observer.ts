import type { OperationalWorker } from '@arbestra/contracts';
import type { ScheduledWorkerObservation } from '../../jobs/scheduled-tasks.js';
import type { OperationsTelemetry } from './telemetry.js';

export function observeScheduler(telemetry: OperationsTelemetry, now: () => number = Date.now) {
  let observed: string | null = null,
    success: string | null = null,
    error: string | null = null;
  let running = false,
    stopped = false,
    lastFailure = 0;
  const read = (): OperationalWorker => ({
    id: 'scheduler',
    label: 'Échéances économiques',
    status: stopped
      ? 'unavailable'
      : !observed
        ? 'unknown'
        : now() - Date.parse(observed) > 30_000 || (lastFailure > 0 && now() - lastFailure < 60_000)
          ? 'degraded'
          : 'available',
    active: running ? 1 : 0,
    lastObservedAt: observed,
    lastSuccessAt: success,
    lastErrorAt: error,
    note: 'Boucle locale observée après transaction ; un échec récent reste dégradé pendant 60 s. Retards métier consultables séparément.',
  });
  telemetry.observeWorker('scheduler', read);
  return (event: ScheduledWorkerObservation): void => {
    observed = new Date(now()).toISOString();
    if (event.kind === 'poll') running = true;
    if (event.kind === 'idle') {
      running = false;
      success = observed;
    }
    if (event.kind === 'stopped') {
      stopped = true;
      running = false;
    }
    if (event.kind === 'error' || (event.kind === 'processed' && event.outcome === 'retry-scheduled')) {
      error = observed;
      lastFailure = now();
      telemetry.event('SCHEDULER_RETRY', 'Un traitement économique a échoué et sera réessayé.', 'error');
    }
  };
}

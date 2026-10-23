import { randomUUID } from '../random-uuid';
import { useEffect, useState } from 'react';
import {
  PROCESSING_DURATIONS_SECONDS,
  processingLotsForDuration,
  type Building,
  type ProcessingCommand,
  type ProcessingOrder,
  type ProcessingRecipe,
} from '@arbestra/contracts';
import { BuildingThumbnail } from './BuildingThumbnail';

const names: Record<string, string> = {
  wood: 'bois bruts',
  stone: 'pierres brutes',
  timber: 'bois d’œuvre',
  'cut-stone': 'pierres taillées',
};
const titles: Record<string, string> = { timber: 'Bois d’œuvre', 'cut-stone': 'Pierres taillées' };
const statuses: Record<ProcessingOrder['status'], string> = {
  running: 'Fabrication en cours',
  'pause-requested': 'Pause après ce lot',
  'cancel-requested': 'Annulation après ce lot',
  paused: 'En pause',
  blocked: 'En attente',
  completed: 'Commande terminée',
  cancelled: 'Commande annulée',
};
const number = (n: number) => n.toLocaleString('fr-FR');
function duration(ms: number) {
  const minutes = Math.ceil(Math.max(0, ms) / 60000),
    hours = Math.floor(minutes / 60);
  return hours ? `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`;
}

export function ProcessingPanel({
  building,
  recipe,
  orders,
  serverNow,
  pending,
  error,
  onCommand,
  unresolved,
  onDiscard,
}: {
  slug: string;
  villageId: string;
  building: Building;
  recipe: ProcessingRecipe;
  orders: ProcessingOrder[];
  serverNow: number;
  revision: string;
  pending: boolean;
  error: string | null;
  onCommand: (command: ProcessingCommand) => Promise<boolean>;
  /** Intention whose outcome is unknown after a reload or a lost response. */
  unresolved?: ProcessingCommand | null;
  onDiscard?: (commandId: string) => void;
}) {
  const order = orders.find((o) => o.buildingId === building.id && !['completed', 'cancelled'].includes(o.status));
  const [seconds, setSeconds] = useState<(typeof PROCESSING_DURATIONS_SECONDS)[number]>(
      PROCESSING_DURATIONS_SECONDS[0],
    ),
    [workers, setWorkers] = useState(order?.workerCount ?? 1);
  const [retry, setRetry] = useState<ProcessingCommand | null>(unresolved ?? null);
  useEffect(() => {
    if (unresolved) setRetry((current) => current ?? unresolved);
  }, [unresolved?.commandId]);
  const busy = Boolean(order?.currentLot),
    orderId = order?.id,
    frozen = pending || !!retry;
  const last = order ?? orders.find((o) => o.buildingId === building.id);
  useEffect(() => {
    if (order) setWorkers(order.workerCount);
  }, [orderId, order?.workerCount]);
  async function send(command: ProcessingCommand) {
    setRetry(command);
    if (await onCommand(command)) setRetry(null);
  }
  const team = busy ? order!.workerCount : workers,
    lotMs = Math.ceil(recipe.workMs / team);
  const lots = order
    ? order.requestedLots - order.completedLots
    : processingLotsForDuration(seconds, recipe.workMs, team);
  const currentRemaining = order?.currentLot ? Math.max(0, Date.parse(order.currentLot.completesAt) - serverNow) : 0;
  const plannedMs = busy ? currentRemaining + Math.max(0, lots - 1) * lotMs : lots * lotMs;
  const progress = order
    ? Math.min(
        1,
        (order.completedLots +
          (busy
            ? Math.max(
                0,
                1 -
                  currentRemaining /
                    (Date.parse(order.currentLot!.completesAt) - Date.parse(order.currentLot!.startedAt)),
              )
            : 0)) /
          order.requestedLots,
      )
    : 0;
  return (
    <section className="processing-panel production-panel" aria-label="Fabrication de matières">
      <header className="production-heading">
        <small>{building.type === 'sawmill' ? 'Scierie' : 'Tailleur de pierre'}</small>
        <h3>{titles[recipe.outputResource] ?? names[recipe.outputResource]}</h3>
      </header>
      <div className="production-hero">
        <BuildingThumbnail code={`resource:${recipe.outputResource}`} />
      </div>
      {!order && (
        <div className="production-duration" role="group" aria-label="Durée de production prévue">
          {PROCESSING_DURATIONS_SECONDS.map((n) => (
            <button
              type="button"
              key={n}
              aria-pressed={seconds === n}
              disabled={frozen || building.status !== 'completed'}
              onClick={() => setSeconds(n)}
            >
              {n / 3600} h
            </button>
          ))}
        </div>
      )}
      <div className="production-workers" role="group" aria-label="Habitants affectés">
        {[1, 2, 3].map((n) => (
          <button
            type="button"
            key={n}
            aria-pressed={team === n}
            disabled={frozen || busy || building.status !== 'completed' || n > recipe.workerCap}
            title={n > recipe.workerCap ? `Cet atelier dispose de ${recipe.workerCap} poste(s).` : undefined}
            onClick={() => setWorkers(n)}
          >
            <BuildingThumbnail code={`workers:${n}`} />
            <strong>
              {n} habitant{n > 1 ? 's' : ''}
            </strong>
            {n > recipe.workerCap && <small>Poste indisponible</small>}
          </button>
        ))}
      </div>
      <div className="production-plan" aria-live="polite">
        <p>
          <span>{order ? 'À produire encore' : 'Production prévue'}</span>
          <output aria-label="Quantité produite">{number(lots * recipe.outputAmount)}</output>
        </p>
        <p>
          <span>{order ? 'Travail restant prévu' : 'Travail prévu'}</span>
          <strong>{duration(plannedMs)}</strong>
        </p>
        <p>
          <span>Matière première prévue</span>
          <strong>
            {number(lots * recipe.inputAmount)} {names[recipe.inputResource]}
          </strong>
        </p>
      </div>
      {last && (
        <p role="status">
          {statuses[last.status]} · {last.completedLots}/{last.requestedLots} lots achevés
        </p>
      )}
      {order && <progress aria-label="Avancement de la commande" max={1} value={progress} />}
      {order?.blockedReason && (
        <p>
          {order.blockedReason === 'missing-input'
            ? 'Matière brute insuffisante.'
            : 'Habitants disponibles et aptes insuffisants.'}{' '}
          Votre avancement est conservé. Reprenez quand la situation le permet.
        </p>
      )}
      {busy && order?.currentLot && (
        <>
          <p>
            {order.currentLot.outputAmount} {names[order.currentLot.outputResource]} à recevoir dans{' '}
            {duration(currentRemaining)}.
          </p>
          <div className="production-actions">
            <button
              type="button"
              disabled={frozen || order.status !== 'running'}
              onClick={() => void send({ commandId: randomUUID(), action: 'pause', orderId: order.id })}
            >
              Pause après ce lot
            </button>
            <button
              type="button"
              disabled={frozen || order.status === 'cancel-requested'}
              onClick={() => void send({ commandId: randomUUID(), action: 'cancel', orderId: order.id })}
            >
              Annuler après ce lot
            </button>
          </div>
        </>
      )}
      {!busy && building.status === 'completed' && (
        <div className="production-actions">
          <button
            className="production-primary"
            type="button"
            disabled={frozen}
            onClick={() =>
              void send(
                order
                  ? { commandId: randomUUID(), action: 'resume', orderId: order.id, workerCount: workers }
                  : {
                      commandId: randomUUID(),
                      action: 'start',
                      buildingId: building.id,
                      durationSeconds: seconds,
                      workerCount: workers,
                    },
              )
            }
          >
            {order ? 'Reprendre' : 'Produire'}
          </button>
          {order && (
            <button
              type="button"
              disabled={frozen}
              onClick={() => void send({ commandId: randomUUID(), action: 'cancel', orderId: order.id })}
            >
              Annuler les lots restants
            </button>
          )}
        </div>
      )}
      <small>Durée de travail prévue : les attentes repoussent la fin de la commande.</small>
      {building.status !== 'completed' && <p>Atelier en chantier.</p>}
      {retry && !pending && (
        <div>
          <p>Commande à vérifier ou corriger.</p>
          <button type="button" onClick={() => void send(retry)}>
            Vérifier la même commande
          </button>
          <button
            type="button"
            onClick={() => {
              onDiscard?.(retry.commandId);
              setRetry(null);
            }}
          >
            Modifier la demande
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

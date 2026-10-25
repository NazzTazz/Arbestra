import { useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  hudWorkforceIntentIsValid,
  hudWorkforceStateIsValid,
  type ExtractionPool,
  type ExtractionPoolCommand,
  type PopulationGesture,
  type VillageState,
  type HudWorkforceIntent,
} from '@arbestra/contracts';
import { ApiError, commandHudWorkforce } from '../api/client';
import { randomUUID } from '../random-uuid';
import { BuildingThumbnail } from './BuildingThumbnail';
import { HudIntentQueue, hudFromVillage, requestedPools, canAdjustPool } from './hud-intents';
import './workforce-hud.css';

type Group = 'resting' | 'idle' | 'working';
type Source = Group | 'carrots';
const groups = [
  { id: 'resting', label: 'Au repos' },
  { id: 'idle', label: 'Disponibles' },
  { id: 'working', label: 'Actifs' },
] as const;
const acceptsDrop = (from: Source, to: Source) =>
  from !== to &&
  (from === 'carrots' ||
    to === 'carrots' ||
    (from === 'idle' && to === 'resting') ||
    (from === 'working' && (to === 'idle' || to === 'resting')));

export function WorkforceHud({
  state,
  view,
  onConfirmed,
}: {
  state: VillageState;
  view: 'population' | 'wood' | 'stone' | 'pools' | null;
  onConfirmed: () => void;
}) {
  const [, refresh] = useState(0),
    [notice, setNotice] = useState(''),
    [over, setOver] = useState<Source | null>(null),
    [picked, setPicked] = useState<Source | null>(null);
  const [drag, setDrag] = useState<{ source: Source; x: number; y: number } | null>(null);
  const pointer = useRef<{ source: Source; x: number; y: number; id: number; dragged: boolean } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    const cancel = () => {
      if (pointer.current) suppressClick.current = true;
      pointer.current = null;
      setDrag(null);
      setOver(null);
      setPicked(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    cancel();
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', escape);
      window.removeEventListener('blur', cancel);
    };
  }, [view, state.world.id, state.village.id]);
  const latest = useRef({ onConfirmed, state });
  latest.current = { onConfirmed, state };
  const queue = useRef<HudIntentQueue | null>(null);
  useEffect(() => {
    let live = true;
    const key = `hud-workforce:${state.world.id}:${state.village.id}`;
    let initial: HudWorkforceIntent[] = [],
      confirmed = hudFromVillage(latest.current.state);
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      const items = Array.isArray(saved) ? saved : saved?.items;
      if (Array.isArray(items)) initial = items.filter(hudWorkforceIntentIsValid);
      if (
        hudWorkforceStateIsValid(saved?.confirmed) &&
        saved.confirmed.worldId === state.world.id &&
        saved.confirmed.villageId === state.village.id &&
        (initial.length || saved.confirmed.serverTime > confirmed.serverTime)
      )
        confirmed = saved.confirmed;
    } catch {
      /* Storage is optional; commands remain in memory. */
    }
    const q = new HudIntentQueue(confirmed, initial, {
      send: (intent) => commandHudWorkforce(state.world.slug, state.village.id, intent),
      save: (pending) => {
        try {
          sessionStorage.setItem(key, JSON.stringify(pending));
        } catch {
          /* Keep the in-memory intent. */
        }
      },
      changed: () => {
        if (live) refresh((n) => n + 1);
      },
      settled: (intent, result) => {
        if (!live) return;
        latest.current.onConfirmed();
        const people = `${result.affected} habitant${result.affected === 1 ? '' : 's'}`;
        if (intent.kind === 'population')
          setNotice(
            intent.command.action === 'feed'
              ? `${people} ${result.affected === 1 ? 'a' : 'ont'} mangé · −${result.carrots} carotte${result.carrots === 1 ? '' : 's'}`
              : intent.command.action === 'rest'
                ? `${people} envoyé${result.affected === 1 ? '' : 's'} au repos`
                : `Relève demandée pour ${people}`,
          );
        else setNotice('Consigne confirmée · prochain départ.');
        if (!q.items.length) q.synchronize(hudFromVillage(latest.current.state));
      },
      failed: (error) => {
        if (live)
          setNotice(error instanceof ApiError ? error.message : 'Connexion interrompue. Vos gestes sont conservés.');
        return (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          ![401, 403, 408, 429].includes(error.status)
        );
      },
    });
    const reconnect = () => {
      if (q.blocked) q.retry();
    };
    queue.current = q;
    refresh((n) => n + 1);
    void q.pump();
    window.addEventListener('online', reconnect);
    window.addEventListener('focus', reconnect);
    return () => {
      live = false;
      q.stop();
      queue.current = null;
      window.removeEventListener('online', reconnect);
      window.removeEventListener('focus', reconnect);
    };
  }, [state.world.id, state.world.slug, state.village.id]);
  useEffect(() => {
    queue.current?.synchronize(hudFromVillage(state), state.syncRevision !== undefined);
  }, [state]);
  const send = (intent: HudWorkforceIntent) => {
    try {
      queue.current?.add(intent);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Patientez.');
    }
  };
  function gesture(from: Source, to: Source) {
    if (!acceptsDrop(from, to)) return;
    let command: PopulationGesture | null = null;
    if ((from === 'carrots' && to !== 'carrots') || (to === 'carrots' && from !== 'carrots'))
      command = { commandId: randomUUID(), action: 'feed', group: (from === 'carrots' ? to : from) as Group };
    if (from === 'idle' && to === 'resting') command = { commandId: randomUUID(), action: 'rest' };
    if (from === 'working' && (to === 'idle' || to === 'resting'))
      command = { commandId: randomUUID(), action: 'release', destination: to };
    if (command) {
      send({ kind: 'population', command });
      setPicked(null);
    }
  }
  function targetAt(x: number, y: number): Source | null {
    const value = document
      .elementFromPoint(x, y)
      ?.closest('[data-population-group]')
      ?.getAttribute('data-population-group');
    return value === 'carrots' || groups.some((g) => g.id === value) ? (value as Source) : null;
  }
  function down(event: PointerEvent<HTMLButtonElement>, source: Source) {
    if (event.button !== 0 || !event.isPrimary || pointer.current) return;
    suppressClick.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = { source, x: event.clientX, y: event.clientY, id: event.pointerId, dragged: false };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const p = pointer.current;
    if (!p || p.id !== event.pointerId) return;
    p.dragged ||= Math.hypot(event.clientX - p.x, event.clientY - p.y) > 6;
    if (!p.dragged) return;
    setDrag({ source: p.source, x: event.clientX, y: event.clientY });
    const to = targetAt(event.clientX, event.clientY);
    setOver(to && acceptsDrop(p.source, to) ? to : null);
  }
  function up(event: PointerEvent<HTMLButtonElement>) {
    const p = pointer.current;
    if (!p || p.id !== event.pointerId) return;
    pointer.current = null;
    setDrag(null);
    setOver(null);
    const to = targetAt(event.clientX, event.clientY);
    if (p.dragged || Math.hypot(event.clientX - p.x, event.clientY - p.y) > 6) {
      suppressClick.current = true;
      setPicked(null);
    }
    if (to && to !== p.source) {
      suppressClick.current = true;
      gesture(p.source, to);
    }
  }
  function cancelPointer(event: PointerEvent<HTMLButtonElement>) {
    if (pointer.current?.id !== event.pointerId) return;
    pointer.current = null;
    suppressClick.current = true;
    setDrag(null);
    setOver(null);
    setPicked(null);
  }
  function sourceProps(source: Source) {
    return {
      'data-population-group': source,
      'aria-pressed': picked === source,
      onPointerDown: (e: PointerEvent<HTMLButtonElement>) => down(e, source),
      onPointerMove: move,
      onPointerUp: up,
      onPointerCancel: cancelPointer,
      onLostPointerCapture: cancelPointer,
      onDragStart: (event: DragEvent) => event.preventDefault(),
      onPointerEnter: () => {
        if (picked && acceptsDrop(picked, source)) setOver(source);
      },
      onPointerLeave: () => {
        if (!pointer.current) setOver(null);
      },
      onClick: () => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        if (picked && picked !== source) gesture(picked, source);
        else setPicked(picked === source ? null : source);
      },
    };
  }
  const confirmed = queue.current?.confirmed ?? hudFromVillage(state);
  const intentions = queue.current?.items ?? [];
  const pools = requestedPools(confirmed, intentions);
  const adjust = (resource: ExtractionPool['resource'], action: ExtractionPoolCommand['action']) => {
    // Re-read the queue at the gesture, including clicks before React's next render.
    const q = queue.current;
    if (q && canAdjustPool(q.confirmed, requestedPools(q.confirmed, q.items), resource, action, q.items))
      send({ kind: 'pool', command: { commandId: randomUUID(), resource, action } });
  };
  const population = confirmed.population;
  const counts = { resting: population.resting, idle: population.available, working: population.working };
  const pending = population.pendingRelease,
    idlePending = pending?.idle ?? 0,
    restPending = pending?.resting ?? 0;
  const carrots = confirmed.carrots;
  if (!view) return null;
  return (
    <div
      className={`mode-toolbar workforce-toolbar ${view === 'population' ? 'is-population' : 'is-extraction'}${drag ? ' is-dragging' : ''}`}
    >
      {view === 'population' && (
        <section className="population-hud" aria-label="Population">
          <div className="population-hud-groups">
            {groups.map((g) => (
              <button
                type="button"
                key={g.id}
                className={`population-group ${over === g.id ? 'is-drop-target' : ''}`}
                aria-label={`${g.label} : ${counts[g.id]} habitant${counts[g.id] === 1 ? '' : 's'}`}
                {...sourceProps(g.id)}
              >
                <span className="population-icon">
                  <img src="/thumbnails/workers-3.png" alt="" draggable={false} />
                </span>
                <span>{g.label}</span>
                <strong>{counts[g.id]}</strong>
              </button>
            ))}
            <button
              type="button"
              className={`population-group population-carrots ${over === 'carrots' ? 'is-drop-target' : ''}`}
              aria-label={`Carottes disponibles : ${carrots}`}
              {...sourceProps('carrots')}
            >
              <span className="population-icon">
                <BuildingThumbnail code="resource:carrot" />
              </span>
              <span>Carottes</span>
              <strong>{carrots.toLocaleString('fr-FR')}</strong>
            </button>
          </div>
          {idlePending + restPending > 0 && (
            <p className="workforce-pending" role="status">
              {idlePending + restPending} habitant{idlePending + restPending === 1 ? '' : 's'} à relever
              {restPending > 0 ? ` · ${restPending} vers le repos` : ''}
            </p>
          )}
        </section>
      )}
      {view === 'population' &&
        drag &&
        createPortal(
          <div className="population-drag-preview" aria-hidden="true" style={{ left: drag.x, top: drag.y }}>
            <img
              src={drag.source === 'carrots' ? '/thumbnails/carrot.png' : '/thumbnails/workers-3.png'}
              alt=""
              draggable={false}
            />
          </div>,
          document.body,
        )}
      {(view === 'wood' || view === 'stone' || view === 'pools') && (
        <section
          className={`extraction-pool-hud ${view === 'pools' ? 'is-both' : ''}`}
          aria-label="Équipes d’exploitation"
        >
          {(view === 'pools' ? (['wood', 'stone'] as const) : [view]).map((resource) => (
            <PoolControls
              key={resource}
              pool={pools.find((p) => p.resource === resource)!}
              confirmed={confirmed.extractionPools.find((p) => p.resource === resource)!}
              pending={intentions.filter((i) => i.kind === 'pool' && i.command.resource === resource).length}
              canAdjust={(action) => canAdjustPool(confirmed, pools, resource, action, intentions)}
              onCommand={(action) => adjust(resource, action)}
            />
          ))}
        </section>
      )}
      <div className="workforce-message" role="status">
        {queue.current?.retrying ? 'Vérification des gestes…' : notice}
        {intentions.length ? ` · ${intentions.length} geste${intentions.length === 1 ? '' : 's'} en attente` : ''}
        {queue.current?.blocked && !queue.current.retrying && (
          <button type="button" onClick={() => queue.current?.retry()}>
            Vérifier la commande
          </button>
        )}
      </div>
    </div>
  );
}

function PoolControls({
  pool,
  confirmed,
  pending,
  canAdjust,
  onCommand,
}: {
  pool: ExtractionPool;
  confirmed: ExtractionPool;
  pending: number;
  canAdjust: (action: ExtractionPoolCommand['action']) => boolean;
  onCommand: (action: ExtractionPoolCommand['action']) => void;
}) {
  return (
    <article
      className="extraction-pool-card"
      aria-label={pool.resource === 'wood' ? 'Coupe de bois' : 'Extraction de roche'}
    >
      <header>
        <strong>{pool.resource === 'wood' ? 'Coupe de bois' : 'Extraction de roche'}</strong>
        <small>
          {pool.pendingTargets} {pool.resource === 'wood' ? 'bosquet' : 'gisement'}
          {pool.pendingTargets === 1 ? '' : 's'}
        </small>
      </header>
      <img
        className="extraction-pool-art"
        src={`/hud/${pool.resource === 'wood' ? 'woodcutters' : 'stonecutters'}.png`}
        alt=""
        draggable={false}
      />
      <div className="extraction-pool-counters">
        <div>
          <span>Chantiers</span>
          <output>{pool.siteCount}</output>
          {pending > 0 && (
            <small>
              {confirmed.siteCount} confirmé{confirmed.siteCount === 1 ? '' : 's'}
            </small>
          )}
        </div>
        <div>
          <span>Habitants</span>
          <output>{pool.workerCap}</output>
          {pending > 0 && <small>{confirmed.workerCap} confirmés</small>}
        </div>
      </div>
      <div className="extraction-pool-buttons">
        <button
          type="button"
          aria-label="Ajouter un chantier"
          disabled={!canAdjust('sites-up')}
          onClick={() => onCommand('sites-up')}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Ajouter cinq habitants"
          disabled={!canAdjust('people-up')}
          onClick={() => onCommand('people-up')}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Retirer un chantier"
          disabled={!canAdjust('sites-down')}
          onClick={() => onCommand('sites-down')}
        >
          −
        </button>
        <button
          type="button"
          aria-label="Retirer cinq habitants"
          disabled={!canAdjust('people-down')}
          onClick={() => onCommand('people-down')}
        >
          −
        </button>
      </div>
      <footer>
        <span>
          {confirmed.mobilized
            ? `${confirmed.mobilized} en mission`
            : confirmed.siteCount === 0
              ? 'En pause'
              : confirmed.pendingTargets
                ? 'Attend une équipe'
                : 'Attend des cibles'}
        </span>
        <small>
          {pending
            ? `${pending} réglage${pending === 1 ? '' : 's'} à confirmer`
            : confirmed.siteCount === 0
              ? 'Effectif conservé'
              : 'Consigne au prochain départ'}
        </small>
      </footer>
    </article>
  );
}

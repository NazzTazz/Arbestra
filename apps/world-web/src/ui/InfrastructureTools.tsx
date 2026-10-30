import { randomUUID } from '../random-uuid';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useId, type RefObject } from 'react';
import {
  prepareInfrastructureEdit,
  createInfrastructureEditContext,
  emptyInfrastructure,
  ROAD_CELLS_PER_COMMAND,
  type InfrastructureOperation,
  type InfrastructureQuote,
  type InfrastructureRequest,
  type RoadCellSurface,
  type RoadCellsPreview,
  type RoadCellsPreviewRequest,
  type RoadCellsRequest,
  type RoadCellsResult,
  type VillageState,
  type SubPoint,
  subCellKey,
} from '@arbestra/contracts';
import {
  ApiError,
  commandInfrastructure,
  previewInfrastructure,
  getVillage,
  type TimedVillageUpdate,
  type TimedInfrastructureConfirmation,
} from '../api/client';
import type { TerrainHandle } from '../scene/VillageScene';
import { villageRequestGeneration } from '../api/village-sync';
import type { InfrastructureGesture } from '../scene/infrastructure-renderer';
import { InfrastructureThumbnail } from './InfrastructureThumbnail';
import { RoadVariantMenu } from './RoadVariantMenu';
import { subPointCell } from './demolition-selection';
import { RoadCellGesture } from './road-cell-gesture';
import './harvest-feedback.css';
type Item = { id: string; version: number; position: SubPoint; quarterTurns: number };
/** Road cells commands of the V2 village session; null while V2 is not ready. */
export interface RoadCellsApi {
  command: (request: RoadCellsRequest) => Promise<RoadCellsResult>;
  preview: (body: RoadCellsPreviewRequest) => Promise<RoadCellsPreview>;
}
const materials = [
  ['none', 'Pas de route'],
  ['earth', 'Terre'],
  ['stone-1', 'Petite Pierre'],
  ['stone-2', 'Grands Pavés'],
] as const;
type Surface = RoadCellSurface | 'none';
const surfaceCost = (surface: Surface) => (surface === 'stone-1' || surface === 'stone-2' ? 4 : 0);
const costLabel = (surface: Surface, sidewalks: boolean) => {
  const stone = surfaceCost(surface) + (sidewalks ? 2 : 0);
  return stone ? `◆ ${stone} / case` : 'Gratuit';
};
export function InfrastructureTools({
  state,
  scene,
  active,
  roadCells,
  onSnapshot,
  onConfirmation,
  onWorkshop,
}: {
  state: VillageState;
  scene: RefObject<TerrainHandle | null>;
  active: boolean;
  roadCells: RoadCellsApi | null;
  onSnapshot: (s: TimedVillageUpdate) => void;
  onConfirmation: (s: TimedInfrastructureConfirmation) => void;
  onWorkshop: () => void;
}) {
  const [family, setFamily] = useState('Voirie'),
    [surface, setSurface] = useState<Surface>('earth'),
    [sidewalks, setSidewalks] = useState(false),
    [turn, setTurn] = useState(0);
  const [menu, setMenu] = useState<{ code: 'earth' | 'stone-1' | 'stone-2'; anchor: HTMLButtonElement } | null>(null),
    menuId = useId();
  const [point, setPoint] = useState<SubPoint | null>(null),
    [item, setItem] = useState<Item | null>(null),
    [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [serverValid, setServerValid] = useState(true),
    [uncertain, setUncertain] = useState<InfrastructureRequest | null>(null);
  const session = useRef<string>(randomUUID()),
    latest = useRef({ state, family, turn, point, item, armed, busy, menu, roadCells });
  const price = useRef<HTMLSpanElement>(null);
  const generation = useRef(0),
    presented = useRef<{ operation: string; revision: number; quote: InfrastructureQuote } | null>(null);
  const previewInFlight = useRef(false);
  latest.current = { state, family, turn, point, item, armed, busy, menu, roadCells };
  // Road cell gesture (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §4.2), one per village.
  const [, render] = useReducer((n: number) => n + 1, 0);
  const road = useMemo(
    () =>
      new RoadCellGesture({
        world: { widthCells: state.world.widthCells, heightCells: state.world.heightCells },
        uuid: randomUUID,
        preview: (body) => {
          const api = latest.current.roadCells;
          return api ? api.preview(body) : Promise.reject(Error('Synchronisation indisponible.'));
        },
        command: (request) => {
          const api = latest.current.roadCells;
          return api ? api.command(request) : Promise.reject(Error('Synchronisation indisponible.'));
        },
        added: (cells) => scene.current?.roadCellsPreviewAdd(cells),
        cleared: () => scene.current?.roadCellsPreviewClear(),
        tone: (tone) => scene.current?.roadCellsPreviewTone(tone),
        changed: render,
      }),
    [state.world.id, state.world.widthCells, state.world.heightCells, state.village.id, scene],
  );
  useEffect(() => {
    // Strict mode remounts effects: the same controller is resumed.
    road.resume();
    return () => {
      road.dispose();
      scene.current?.roadCellsPreviewClear();
    };
  }, [road, scene]);
  useEffect(() => {
    road.setMode(surface === 'none' ? { action: 'remove' } : { action: 'place', style: { surface, sidewalks } });
  }, [road, surface, sidewalks]);
  const pendingKey = `arbestra:infrastructure:${state.world.id}:${state.village.id}`;
  useEffect(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null') as InfrastructureRequest | null;
      if (value?.commandId) {
        setUncertain(value);
        session.current = value.sessionId;
      }
    } catch {
      /* corrupt local history cannot authorize an action */
    }
  }, [pendingKey]);
  /** Braziers only: roads are placed by cell with the road gesture. */
  function operation(p: SubPoint | null): InfrastructureOperation | null {
    const c = latest.current;
    if (!p || c.family !== 'Éclairage') return null;
    return c.item
      ? { kind: 'move', id: c.item.id, version: c.item.version, position: p, quarterTurns: c.turn }
      : c.armed
        ? { kind: 'place', position: p, quarterTurns: c.turn }
        : null;
  }
  const op = operation(point),
    plan = state.infrastructure ?? emptyInfrastructure();
  const opKey = JSON.stringify(op);
  const stableOp = useMemo(() => JSON.parse(opKey) as InfrastructureOperation | null, [opKey]);
  const editContext = useMemo(
    () => createInfrastructureEditContext(state),
    [state.world, state.cells, state.travelRoutes, state.infrastructure],
  );
  const prepared = useMemo(() => {
    try {
      return stableOp ? prepareInfrastructureEdit(editContext.state, stableOp, 'preview', editContext) : null;
    } catch {
      return null;
    }
  }, [editContext, stableOp]);
  const quote = prepared?.quote ?? null;
  const stone = state.village.resources.find((r) => r.code === 'stone')?.amount ?? 0;
  const insufficient = Boolean(quote && (quote.stoneDebit > stone || quote.woodDebit > state.village.wood));
  const roadQuote = family === 'Voirie' && road.quoteCurrent ? road.quote : null;
  useEffect(() => {
    if (!active) return;
    // Move the label directly: pointer motion must not schedule extra React renders.
    const move = (e: PointerEvent) => {
      const node = price.current;
      if (!node) return;
      const canvas = e.target instanceof Element && e.target.closest('.village-canvas');
      node.style.visibility = canvas ? 'visible' : 'hidden';
      if (canvas) {
        node.style.left = e.clientX + 'px';
        node.style.top = e.clientY - 38 + 'px';
      }
    };
    // Canvas gestures stop propagation: observe the pointer before canvas capture.
    window.addEventListener('pointermove', move, { capture: true });
    return () => window.removeEventListener('pointermove', move, { capture: true });
  }, [active]);
  const clearPending = () => {
    try {
      sessionStorage.removeItem(pendingKey);
    } catch {
      /* a storage failure cannot turn a successful server response into uncertainty */
    }
  };
  useLayoutEffect(() => {
    presented.current = active && op && quote ? { operation: opKey, revision: plan.revision, quote } : null;
  });
  useEffect(() => {
    scene.current?.infrastructurePreview(
      active ? op : null,
      !serverValid || insufficient,
      prepared?.next,
      prepared?.surface,
    );
  }, [active, opKey, serverValid, insufficient, scene, prepared]);
  useEffect(() => {
    if (!active || !op || busy) return;
    let cancelled = false;
    setServerValid(true);
    const request: InfrastructureRequest = {
      commandId: randomUUID(),
      sessionId: session.current,
      revision: plan.revision,
      operation: op,
    };
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      if (cancelled) return;
      // Coalesce obsolete read-only previews instead of queuing server work.
      if (previewInFlight.current) {
        timer = setTimeout(run, 120);
        return;
      }
      previewInFlight.current = true;
      void previewInfrastructure(state.world.slug, state.village.id, request)
        .then((result) => {
          if (!cancelled) {
            setServerValid(result.valid);
            setError(result.message);
          }
        })
        .catch((reason) => {
          if (!cancelled) {
            setServerValid(false);
            setError(reason instanceof Error ? reason.message : 'Devis indisponible.');
          }
        })
        .finally(() => {
          previewInFlight.current = false;
        });
    };
    timer = setTimeout(run, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Structural key freezes exactly the geometry being quoted, not render identity.
  }, [active, opKey, plan.revision, insufficient, scene, busy]);
  async function send(next: InfrastructureOperation, requestOverride?: InfrastructureRequest) {
    if (latest.current.busy) return;
    const c = latest.current,
      current = c.state.infrastructure ?? emptyInfrastructure();
    let expected: InfrastructureQuote | undefined;
    if (!requestOverride && (next.kind === 'place' || next.kind === 'move')) {
      const shown = presented.current;
      if (!shown || shown.operation !== JSON.stringify(next) || shown.revision !== current.revision) {
        setPoint(next.position);
        setError('Vérifiez l’aperçu actualisé avant de valider.');
        return;
      }
      expected = shown.quote;
    } else if (next.kind !== 'undo')
      try {
        expected = prepareInfrastructureEdit(c.state, next, 'preview').quote;
      } catch (reason) {
        setError((reason as Error).message);
        return;
      }
    const request = requestOverride ?? {
      commandId: randomUUID(),
      sessionId: session.current,
      revision: current.revision,
      operation: next,
      ...(expected ? { expected } : {}),
    };
    const sentGeneration = generation.current,
      sentRequestGeneration = villageRequestGeneration();
    setBusy(true);
    latest.current.busy = true;
    setError(null);
    try {
      sessionStorage.setItem(pendingKey, JSON.stringify(request));
    } catch {
      /* memory retains the identity */
    }
    try {
      const result = await commandInfrastructure(
        c.state.world.slug,
        c.state.village.id,
        request,
        c.state.syncRevision === undefined
          ? undefined
          : { revision: c.state.syncRevision, serverTime: c.state.serverTime },
      );
      // App remains the sole owner of HTTP/SSE reconciliation.
      if (
        (result.requestGeneration !== undefined && result.requestGeneration !== villageRequestGeneration()) ||
        latest.current.state.world.id !== c.state.world.id ||
        latest.current.state.village.id !== c.state.village.id
      )
        return;
      if ('confirmation' in result) {
        if (
          result.confirmation.commandId !== request.commandId ||
          result.confirmation.worldId !== c.state.world.id ||
          result.confirmation.villageId !== c.state.village.id
        )
          throw Error('Confirmation Infrastructure incohérente.');
        onConfirmation(result);
      } else onSnapshot(result);
      clearPending();
      setUncertain(null);
      if (sentGeneration === generation.current && (next.kind === 'move' || next.kind === 'delete')) {
        setItem(null);
        setArmed(false);
        setPoint(null);
      }
      setServerValid(true);
    } catch (reason) {
      if (
        sentRequestGeneration !== villageRequestGeneration() ||
        latest.current.state.world.id !== c.state.world.id ||
        latest.current.state.village.id !== c.state.village.id
      )
        return;
      setError(reason instanceof Error ? reason.message : 'Commande impossible.');
      if (!(reason instanceof ApiError) || reason.status >= 500) setUncertain(request);
      else {
        clearPending();
        setUncertain(null);
        const fresh = await getVillage(c.state.world.slug, c.state.village.id).catch(() => null);
        if (fresh) onSnapshot(fresh);
      }
    } finally {
      setBusy(false);
      latest.current.busy = false;
    }
  }
  const handler = useRef<(e: InfrastructureGesture) => void>(() => {});
  handler.current = (e) => {
    const c = latest.current;
    if (c.family === 'Voirie') {
      if (e.kind === 'cancel') {
        setMenu(null);
        road.cancel();
        return;
      }
      if (e.kind === 'right') {
        // Right click drops the gesture in progress; the pointer is released too.
        scene.current?.cancelGesture();
        road.cancel();
        return;
      }
      const cell =
        e.point &&
        subPointCell(e.point, { widthCells: c.state.world.widthCells, heightCells: c.state.world.heightCells });
      if (!cell) return;
      if (e.kind === 'down') road.down(cell);
      else if (e.kind === 'hover') road.move(cell);
      else if (e.kind === 'up') road.up(cell);
      return;
    }
    if (e.kind === 'cancel') {
      setMenu(null);
      generation.current++;
      session.current = randomUUID();
      setItem(null);
      setPoint(null);
      setArmed(false);
      scene.current?.infrastructurePreview(null);
      return;
    }
    if (c.busy || uncertain) return;
    if (e.kind === 'hover') {
      setPoint((previous) => (previous?.x === e.point?.x && previous?.y === e.point?.y ? previous : e.point));
      return;
    }
    if (e.kind === 'right') {
      if (c.item) void send({ kind: 'delete', id: c.item.id, version: c.item.version, position: c.item.position });
      else {
        setArmed(false);
        setPoint(null);
      }
      return;
    }
    if (e.kind === 'up' && e.point) {
      if (!c.item) {
        const picked = scene.current?.equipmentAt(e.point, e.equipmentId);
        if (picked) {
          setItem(picked);
          setTurn(picked.quarterTurns);
          setArmed(false);
          setPoint(picked.position);
          return;
        }
      }
      const action = operation(e.point);
      if (action) void send(action);
    }
  };
  useEffect(() => {
    if (!active) {
      handler.current({ kind: 'cancel', point: null });
      scene.current?.infrastructureTool(null);
      return;
    }
    let frame = 0,
      stopped = false;
    const register = () => {
      if (stopped) return;
      if (scene.current?.ready()) scene.current.infrastructureTool((e) => handler.current(e));
      else frame = requestAnimationFrame(register);
    };
    register();
    const context = (e: MouseEvent) => {
      if (active && e.target instanceof Element && e.target.closest('.village-canvas')) e.preventDefault();
    };
    const key = (e: KeyboardEvent) => {
      if (
        !active ||
        (e.target instanceof Element && e.target.closest('input,select,textarea,[contenteditable="true"]'))
      )
        return;
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (latest.current.menu) {
          latest.current.menu.anchor.focus();
          setMenu(null);
          return;
        }
        scene.current?.cancelGesture();
        handler.current({ kind: 'cancel', point: null });
      }
      if (
        e.key.toLowerCase() === 'r' &&
        !e.repeat &&
        latest.current.family === 'Éclairage' &&
        (latest.current.item || latest.current.armed)
      ) {
        e.preventDefault();
        setTurn((t) => (t + 1) % 4);
      }
    };
    window.addEventListener('contextmenu', context);
    window.addEventListener('keydown', key, true);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      scene.current?.infrastructureTool(null);
      window.removeEventListener('contextmenu', context);
      window.removeEventListener('keydown', key, true);
    };
  }, [active, scene, state.world.id, state.village.id]);
  function chooseFamily(value: string) {
    handler.current({ kind: 'cancel', point: null });
    setFamily(value);
    setError(null);
    setTurn(0);
  }
  const chooseStyle = (next: Surface, nextSidewalks: boolean) => {
    setSurface(next);
    setSidewalks(nextSidewalks);
  };
  const roadStatus = road.drawing
    ? `${road.cells.size} ${road.cells.size > 1 ? 'cases' : 'case'}${
        road.limited ? ` · ${ROAD_CELLS_PER_COMMAND} au plus par geste` : ''
      }${roadQuote && !roadQuote.valid ? ` · ${roadQuote.message ?? 'Pose impossible.'}` : ''}`
    : road.busy
      ? 'Commande en cours…'
      : road.error
        ? road.error
        : !roadCells
          ? 'Synchronisation en cours…'
          : (road.notice ??
            (surface === 'none'
              ? 'Glissez sur les cases à retirer · sans remboursement'
              : 'Glissez de case en case · clic droit ou Échap : annuler le geste'));
  return (
    <>
      <nav className="construction-categories" aria-label="Familles d’infrastructures">
        {['Voirie', 'Éclairage'].map((f) => (
          <button key={f} aria-pressed={family === f} onClick={() => chooseFamily(f)}>
            {f}
          </button>
        ))}
      </nav>
      <section className="construction-showroom infrastructure-showroom" aria-label={`Infrastructure · ${family}`}>
        {family === 'Voirie' ? (
          materials.map(([code, name]) => (
            <button
              type="button"
              className="showroom-model"
              key={code}
              aria-pressed={code === 'earth' ? surface === 'earth' || surface === 'rubble' : surface === code}
              aria-expanded={code === 'none' ? undefined : menu?.code === code}
              aria-controls={menu?.code === code ? menuId : undefined}
              onClick={(e) => {
                if (code === 'none') {
                  setMenu(null);
                  chooseStyle('none', false);
                } else {
                  const anchor = e.currentTarget;
                  setMenu((current) => (current?.code === code ? null : { code, anchor }));
                }
              }}
            >
              <strong>{name}</strong>
              <InfrastructureThumbnail code={code === 'earth' && surface === 'rubble' ? 'rubble' : code} />
              <span className="resource-costs">
                {code === 'none'
                  ? 'Retirer'
                  : (code === 'earth' ? surface === 'earth' || surface === 'rubble' : surface === code)
                    ? costLabel(surface, sidewalks) + (sidewalks ? ' · trottoirs' : '')
                    : costLabel(code, false)}
              </span>
            </button>
          ))
        ) : (
          <button
            className="showroom-model"
            aria-pressed={armed}
            onClick={() => {
              setItem(null);
              setArmed(true);
              setTurn(0);
            }}
          >
            <strong>Brasero</strong>
            <InfrastructureThumbnail code="brazier" />
            <span className="resource-costs">◆ 2 · ▰ 1</span>
          </button>
        )}
        {import.meta.env.DEV && state.factoryEnabled && (
          <button className="showroom-model workshop-launcher" onClick={onWorkshop}>
            <strong>Créer un bâtiment</strong>
            <InfrastructureThumbnail code="workshop" />
            <span className="resource-costs">Atelier Infrastructure</span>
          </button>
        )}
      </section>
      {active && menu && (
        <RoadVariantMenu
          anchor={menu.anchor}
          id={menuId}
          label={
            menu.code === 'earth'
              ? 'Textures de terre'
              : menu.code === 'stone-1'
                ? 'Variantes Petite Pierre'
                : 'Variantes Grands Pavés'
          }
          onClose={() => setMenu(null)}
        >
          {(menu.code === 'earth' ? (['earth', 'rubble'] as const) : [menu.code]).flatMap((code) =>
            [false, true].map((withSidewalks) => (
              <button
                type="button"
                key={code + ':' + withSidewalks}
                aria-pressed={surface === code && sidewalks === withSidewalks}
                onClick={() => {
                  chooseStyle(code, withSidewalks);
                  menu.anchor.focus();
                  setMenu(null);
                }}
              >
                <strong>{code === 'earth' ? 'Terre battue' : code === 'rubble' ? 'Gravats' : 'Chaussée'}</strong>
                <small>
                  {withSidewalks ? 'Avec trottoirs' : 'Sans trottoir'} · {costLabel(code, withSidewalks)}
                </small>
              </button>
            )),
          )}
        </RoadVariantMenu>
      )}
      <div className="harvest-feedback infrastructure-price">
        <span
          ref={price}
          hidden={!active || family !== 'Voirie' || !road.drawing || !roadQuote?.valid || !roadQuote.stone}
          className="harvest-feedback--stone"
          title="Débit prévisionnel en pierres"
        >
          {roadQuote ? '−' + roadQuote.stone.toLocaleString('fr-FR') : ''}
        </span>
      </div>
      {active && family === 'Voirie' && (
        <aside className="construction-feedback infrastructure-feedback" aria-label="Action Voirie">
          <span role="status">{roadStatus}</span>
          {road.uncertain && (
            <button disabled={road.busy} onClick={() => road.retry()}>
              Vérifier la même commande
            </button>
          )}
        </aside>
      )}
      {family === 'Éclairage' && (error || uncertain || item || armed) && (
        <aside className="construction-feedback infrastructure-feedback" aria-label="Action Infrastructure">
          {point && plan.manualLighting.includes(subCellKey(point, state.world)) && (
            <button
              disabled={
                busy ||
                Boolean(uncertain) ||
                plan.equipment.some((e) => subCellKey(e, state.world) === subCellKey(point, state.world))
              }
              onClick={() => void send({ kind: 'lighting', cell: subCellKey(point, state.world) })}
            >
              Rétablir l’éclairage automatique
            </button>
          )}
          <span role="status">
            {busy
              ? 'Commande en cours…'
              : (error ??
                (insufficient
                  ? 'Ressources insuffisantes.'
                  : item
                    ? 'Clic pour déplacer · clic droit pour supprimer · Échap pour annuler'
                    : armed
                      ? 'Clic pour placer · R pour tourner'
                      : 'Choisissez un brasero dans le showroom ou sur la carte'))}
          </span>
          {uncertain && (
            <button disabled={busy} onClick={() => void send(uncertain.operation, uncertain)}>
              Vérifier la même commande
            </button>
          )}
        </aside>
      )}
    </>
  );
}

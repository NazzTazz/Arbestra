import { randomUUID } from '../random-uuid';
import { useEffect, useMemo, useReducer, useRef, useState, useId, type RefObject } from 'react';
import {
  ROAD_ACCESSORY_PRICES,
  ROAD_ANCHORS_PER_COMMAND,
  ROAD_CELLS_PER_COMMAND,
  type RoadAnchorsPreview,
  type RoadAnchorsPreviewRequest,
  type RoadAnchorsRequest,
  type RoadAnchorsResult,
  type RoadCellSurface,
  type RoadCellsPreview,
  type RoadCellsPreviewRequest,
  type RoadCellsRequest,
  type RoadCellsResult,
  type VillageState,
} from '@arbestra/contracts';
import type { TimedVillageUpdate, TimedInfrastructureConfirmation } from '../api/client';
import type { TerrainHandle } from '../scene/VillageScene';
import type { InfrastructureGesture } from '../scene/infrastructure-renderer';
import { InfrastructureThumbnail } from './InfrastructureThumbnail';
import { RoadVariantMenu } from './RoadVariantMenu';
import { subPointCell } from './demolition-selection';
import { RoadCellGesture, skippedLabel } from './road-cell-gesture';
import {
  RoadAnchorGesture,
  RoadAnchorIndex,
  highlightedAnchors,
  skippedAnchorsLabel,
  snapAnchor,
  subPointVertex,
  vertexKey,
  type RoadAnchorMode,
  type Vertex,
} from './road-anchor-gesture';
import './harvest-feedback.css';
/** Road cells commands of the V2 village session; null while V2 is not ready. */
export interface RoadCellsApi {
  command: (request: RoadCellsRequest) => Promise<RoadCellsResult>;
  preview: (body: RoadCellsPreviewRequest) => Promise<RoadCellsPreview>;
}
/** Road anchors commands of the V2 village session; null while V2 is not ready. */
export interface RoadAnchorsApi {
  command: (request: RoadAnchorsRequest) => Promise<RoadAnchorsResult>;
  preview: (body: RoadAnchorsPreviewRequest) => Promise<RoadAnchorsPreview>;
}
// Removal is the Détruire tool's (Tristan, 31 October): no « Pas de route » here.
const materials = [
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
const brazierPrice = ROAD_ACCESSORY_PRICES.brazier;
export function InfrastructureTools({
  state,
  scene,
  active,
  roadCells,
  roadAnchors,
  onWorkshop,
}: {
  state: VillageState;
  scene: RefObject<TerrainHandle | null>;
  active: boolean;
  roadCells: RoadCellsApi | null;
  roadAnchors: RoadAnchorsApi | null;
  /** Legacy stroke plan answers, unused since the lighting tool moved to anchors (S4b); removed with S3. */
  onSnapshot?: (s: TimedVillageUpdate) => void;
  onConfirmation?: (s: TimedInfrastructureConfirmation) => void;
  onWorkshop: () => void;
}) {
  const [family, setFamily] = useState('Voirie'),
    [surface, setSurface] = useState<Surface>('earth'),
    [sidewalks, setSidewalks] = useState(false),
    [lightMode, setLightMode] = useState<RoadAnchorMode>('place');
  const [menu, setMenu] = useState<{ code: 'earth' | 'stone-1' | 'stone-2'; anchor: HTMLButtonElement } | null>(null),
    menuId = useId();
  const latest = useRef({ state, family, menu, roadCells, roadAnchors });
  const price = useRef<HTMLSpanElement>(null);
  latest.current = { state, family, menu, roadCells, roadAnchors };
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
        refused: (cells) => scene.current?.roadCellsPreviewAdd(cells, true),
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
  // Lighting: anchors of the village's road cells (§5), indexed once per state change.
  const world = useMemo(
    () => ({ widthCells: state.world.widthCells, heightCells: state.world.heightCells }),
    [state.world.widthCells, state.world.heightCells],
  );
  const anchorIndex = useMemo(
    () => new RoadAnchorIndex(state.roadCells, state.roadAnchors, world),
    [state.roadCells, state.roadAnchors, world],
  );
  const anchors = useRef(anchorIndex);
  anchors.current = anchorIndex;
  const hovered = useRef<Vertex | null>(null),
    snappedRef = useRef<Vertex | null>(null);
  const lighting = useMemo(
    () =>
      new RoadAnchorGesture({
        world: { widthCells: state.world.widthCells, heightCells: state.world.heightCells },
        uuid: randomUUID,
        designable: (vertex, mode) => anchors.current.designable(vertex, mode),
        preview: (body) => {
          const api = latest.current.roadAnchors;
          return api ? api.preview(body) : Promise.reject(Error('Synchronisation indisponible.'));
        },
        command: (request) => {
          const api = latest.current.roadAnchors;
          return api ? api.command(request) : Promise.reject(Error('Synchronisation indisponible.'));
        },
        added: (vertices) => scene.current?.roadAnchorPreviewAdd(vertices),
        refused: (vertices) => scene.current?.roadAnchorPreviewAdd(vertices, true),
        cleared: () => scene.current?.roadAnchorPreviewClear(),
        tone: (tone) => scene.current?.roadAnchorPreviewTone(tone),
        changed: render,
      }),
    [state.world.id, state.world.widthCells, state.world.heightCells, state.village.id, scene],
  );
  useEffect(() => {
    lighting.resume();
    return () => {
      lighting.dispose();
      scene.current?.roadAnchorPreviewClear();
      scene.current?.roadAnchorMarkers(null);
      scene.current?.roadAnchorGhost(null, null);
    };
  }, [lighting, scene]);
  useEffect(() => {
    lighting.setMode(lightMode);
  }, [lighting, lightMode]);
  /** Bounded highlight around the pointer: at most (2r+1)² lookups, MAX_HIGHLIGHTS
   * instances; the anchor the pointer snaps to is emphasized when designable. */
  const highlight = (vertex: Vertex | null, snapped: Vertex | null) => {
    hovered.current = vertex;
    snappedRef.current = snapped;
    const mode = lighting.mode;
    scene.current?.roadAnchorMarkers(
      vertex ? highlightedAnchors(anchors.current, vertex, mode) : null,
      mode === 'remove',
      snapped && anchors.current.designable(snapped, mode) ? snapped : null,
    );
  };
  useEffect(() => {
    // The village's anchors or the mode changed: refresh the highlight where the pointer is.
    if (active && family === 'Éclairage' && hovered.current) highlight(hovered.current, snappedRef.current);
    else scene.current?.roadAnchorMarkers(null);
    if (!active || family !== 'Éclairage' || lightMode !== 'place') scene.current?.roadAnchorGhost(null, null);
  }, [active, family, anchorIndex, lightMode]);
  const roadQuote = family === 'Voirie' && road.quoteCurrent ? road.quote : null;
  const lightQuote = family === 'Éclairage' && lighting.quoteCurrent ? lighting.quote : null;
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
  const handler = useRef<(e: InfrastructureGesture) => void>(() => {});
  handler.current = (e) => {
    const c = latest.current;
    const gesture = c.family === 'Voirie' ? road : lighting;
    if (e.kind === 'cancel') {
      setMenu(null);
      gesture.cancel();
      if (gesture === lighting) {
        highlight(null, null);
        scene.current?.roadAnchorGhost(null, null);
      }
      return;
    }
    if (e.kind === 'right') {
      // Right click drops the gesture in progress; the pointer is released too.
      scene.current?.cancelGesture();
      gesture.cancel();
      return;
    }
    const shape = { widthCells: c.state.world.widthCells, heightCells: c.state.world.heightCells };
    if (gesture === road) {
      const cell = e.point && subPointCell(e.point, shape);
      if (!cell) return;
      if (e.kind === 'down') road.down(cell);
      else if (e.kind === 'hover') road.move(cell);
      else if (e.kind === 'up') road.up(cell);
      return;
    }
    if (!e.point) {
      scene.current?.roadAnchorGhost(null, null);
      if (e.kind === 'up') lighting.up(null);
      return;
    }
    // Magnetic anchors: an O(1) snap per pointer sample (samples are coalesced per frame).
    const vertex = subPointVertex(e.point, shape),
      snapped = snapAnchor(e.point, shape);
    const key = (v: Vertex | null) => (v ? vertexKey(v) : '');
    // The highlight changes only when the pointer reaches another vertex or snaps differently.
    if (key(hovered.current) !== key(vertex) || key(snappedRef.current) !== key(snapped)) highlight(vertex, snapped);
    // The brazier ghost follows the pointer and settles on a free anchor it snaps to.
    if (lighting.mode === 'place')
      scene.current?.roadAnchorGhost(e.point, snapped && anchors.current.designable(snapped, 'place') ? snapped : null);
    if (e.kind === 'down') lighting.down(snapped);
    else if (e.kind === 'hover') lighting.move(snapped);
    else if (e.kind === 'up') lighting.up(snapped);
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
  }
  const chooseStyle = (next: Surface, nextSidewalks: boolean) => {
    setSurface(next);
    setSidewalks(nextSidewalks);
  };
  const roadStatus = road.drawing
    ? `${road.cells.size} ${road.cells.size > 1 ? 'cases' : 'case'}${
        road.limited ? ` · ${ROAD_CELLS_PER_COMMAND} au plus par geste` : ''
      }${
        roadQuote && !roadQuote.valid
          ? ` · ${roadQuote.message ?? 'Pose impossible.'}`
          : roadQuote?.skipped.length
            ? ` · ${skippedLabel(roadQuote.skipped)}`
            : ''
      }`
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
  const anchorCount = lighting.vertices.size;
  const lightStatus = lighting.drawing
    ? `${anchorCount} ${anchorCount > 1 ? 'ancrages' : 'ancrage'}${
        lighting.limited ? ` · ${ROAD_ANCHORS_PER_COMMAND} au plus par geste` : ''
      }${
        lightQuote && !lightQuote.valid
          ? ` · ${lightQuote.message ?? 'Pose impossible.'}`
          : lightQuote?.skipped.length
            ? ` · ${skippedAnchorsLabel(lightQuote.skipped)}`
            : ''
      }`
    : lighting.busy
      ? 'Commande en cours…'
      : lighting.error
        ? lighting.error
        : !roadAnchors
          ? 'Synchronisation en cours…'
          : (lighting.notice ??
            (lightMode === 'remove'
              ? 'Cliquez ou glissez sur les braseros à retirer · sans remboursement'
              : 'Cliquez ou glissez sur les ancrages en surbrillance · clic droit ou Échap : annuler'));
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
        {family === 'Voirie'
          ? materials.map(([code, name]) => (
              <button
                type="button"
                className="showroom-model"
                key={code}
                aria-pressed={code === 'earth' ? surface === 'earth' || surface === 'rubble' : surface === code}
                aria-expanded={menu?.code === code}
                aria-controls={menu?.code === code ? menuId : undefined}
                onClick={(e) => {
                  const anchor = e.currentTarget;
                  setMenu((current) => (current?.code === code ? null : { code, anchor }));
                }}
              >
                <strong>{name}</strong>
                <InfrastructureThumbnail code={code === 'earth' && surface === 'rubble' ? 'rubble' : code} />
                <span className="resource-costs">
                  {(code === 'earth' ? surface === 'earth' || surface === 'rubble' : surface === code)
                    ? costLabel(surface, sidewalks) + (sidewalks ? ' · trottoirs' : '')
                    : costLabel(code, false)}
                </span>
              </button>
            ))
          : // Braziers are removed with the Détruire tool (Tristan, 31 October).
            (['place'] as const).map((mode) => (
              <button
                type="button"
                className="showroom-model"
                key={mode}
                aria-pressed={lightMode === mode}
                onClick={() => setLightMode(mode)}
              >
                <strong>{mode === 'place' ? 'Brasero' : 'Retirer'}</strong>
                <InfrastructureThumbnail code="brazier" />
                <span className="resource-costs">
                  {mode === 'place' ? `◆ ${brazierPrice.stone} · ▰ ${brazierPrice.wood}` : 'Sans remboursement'}
                </span>
              </button>
            ))}
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
          hidden={
            !active ||
            (family === 'Voirie'
              ? !road.drawing || !roadQuote?.valid || !roadQuote.stone
              : !lighting.drawing || !lightQuote?.valid || !(lightQuote.stone || lightQuote.wood))
          }
          className="harvest-feedback--stone"
          title="Débit prévisionnel"
        >
          {family === 'Voirie'
            ? roadQuote
              ? '−' + roadQuote.stone.toLocaleString('fr-FR')
              : ''
            : lightQuote
              ? `−${lightQuote.stone} ◆ · −${lightQuote.wood} ▰`
              : ''}
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
      {active && family === 'Éclairage' && (
        <aside className="construction-feedback infrastructure-feedback" aria-label="Action Éclairage">
          <span role="status">{lightStatus}</span>
          {lighting.uncertain && (
            <button disabled={lighting.busy} onClick={() => lighting.retry()}>
              Vérifier la même commande
            </button>
          )}
        </aside>
      )}
    </>
  );
}

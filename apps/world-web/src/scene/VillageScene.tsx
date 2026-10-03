import type { VillageArrival } from './village-arrival';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { CosmologyDebug } from './CosmologyDebug';
import { sciencePreview } from '../api/client';

import type { StoneDeposit, VillageState } from '@arbestra/contracts';

import { BabylonVillageScene, type TerrainStatus, type TerrainViewMode } from './BabylonVillageScene';
import type { ScreenAnchor } from '../ui/WorldContextMenu';
import type { AreaPreview, Cell } from './construction-selection';

interface VillageSceneProps {
  state: VillageState;
  serverOffsetMs: number;
  terrainRef: Ref<TerrainHandle>;
  pendingHarvestCells: Cell[];
  highlightedSiteIds: string[];
  constructionMode?: boolean;
  showTravelPaths?: boolean;
  selectedRouteId?: string | null;
  selectingArea: boolean;
  preview: AreaPreview | null;
  previewInvalid: boolean;
  onAreaGesture: (first: Cell, last: Cell, tap: boolean) => void;
  onGardenHarvest: (cell: Cell | null, newGesture?: boolean) => void;
  onSiteSelected: (siteId: string, anchor: ScreenAnchor) => void;
  onFeatureSelected?: (featureId: string, anchor: ScreenAnchor) => void;
  onCameraMoved: () => void;
  onArrivalActive?: (active: boolean) => void;
  onEyesFound?: () => void;
  onViewChanged?: (mode: TerrainViewMode) => void;
}
export interface TerrainHandle { acceptDeposit: (deposit: StoneDeposit) => void }

export function VillageScene({ state, serverOffsetMs, terrainRef, pendingHarvestCells, highlightedSiteIds, constructionMode = false, showTravelPaths = false, selectedRouteId = null, selectingArea, preview, previewInvalid, onAreaGesture, onGardenHarvest, onSiteSelected, onCameraMoved, onFeatureSelected, onViewChanged, onArrivalActive, onEyesFound }: VillageSceneProps) {
  const [arrival, setArrival] = useState<VillageArrival | null>(null);
  const callbacks = useRef({ onArrivalActive, onEyesFound }); callbacks.current = { onArrivalActive, onEyesFound };
  const [loading, setLoading] = useState<TerrainStatus>(null);
  const [viewMode, setViewMode] = useState<TerrainViewMode>('village');
  const [cosmologyDebug, setCosmologyDebug] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<BabylonVillageScene | null>(null);
  const loginSceneRef = useRef<BabylonVillageScene | null>(null);
  const getScene = useCallback(() => sceneRef.current, []);
  const selectionHandlerRef = useRef(onSiteSelected);
  const featureHandlerRef = useRef(onFeatureSelected);
  featureHandlerRef.current = onFeatureSelected;
  const cameraHandlerRef = useRef(onCameraMoved);
  const viewHandlerRef = useRef(onViewChanged);
  const areaHandlerRef = useRef(onAreaGesture);
  const harvestHandlerRef = useRef(onGardenHarvest);
  selectionHandlerRef.current = onSiteSelected;
  cameraHandlerRef.current = onCameraMoved;
  viewHandlerRef.current = onViewChanged;
  areaHandlerRef.current = onAreaGesture;
  harvestHandlerRef.current = onGardenHarvest;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setArrival(null);
    const scene = new BabylonVillageScene(
      canvas,
      (siteId, anchor) => selectionHandlerRef.current(siteId, anchor),
      () => cameraHandlerRef.current(),
      (first, last, tap) => areaHandlerRef.current(first, last, tap),
      (featureId, anchor) => featureHandlerRef.current?.(featureId, anchor),
      (cell, newGesture) => harvestHandlerRef.current(cell, newGesture),
      setLoading,
      mode => { setViewMode(mode); viewHandlerRef.current?.(mode); },
      value => {
        if (!value && document.activeElement?.closest('.village-arrival')) canvas.focus();
        setArrival(value); callbacks.current.onArrivalActive?.(value !== null);
      },
      () => callbacks.current.onEyesFound?.(),
    );
    sceneRef.current = scene;
    return () => {
      callbacks.current.onArrivalActive?.(false);
      scene.dispose();
      sceneRef.current = null;
    };
  }, [state.world.id, state.world.generationVersion]);

  useEffect(() => {
    sceneRef.current?.update(state, highlightedSiteIds, constructionMode, showTravelPaths, selectedRouteId);
    if (sceneRef.current && loginSceneRef.current !== sceneRef.current) {
      loginSceneRef.current = sceneRef.current;
      sceneRef.current.startFlyover();
    }
  }, [state, highlightedSiteIds, constructionMode, showTravelPaths, selectedRouteId]);

  useImperativeHandle(terrainRef, () => ({ acceptDeposit: deposit => sceneRef.current?.acceptDeposit(deposit) }), []);

  useEffect(() => { sceneRef.current?.updateHarvestPending(pendingHarvestCells); }, [state, pendingHarvestCells]);

  useEffect(() => {
    sceneRef.current?.updateAreaSelection(selectingArea, preview, previewInvalid);
  }, [selectingArea, preview, previewInvalid]);
  useEffect(() => { sceneRef.current?.setCosmologyDebug(cosmologyDebug); }, [cosmologyDebug, state.world.id]);
  useEffect(() => { sceneRef.current?.setCosmologyServerOffset(serverOffsetMs); }, [serverOffsetMs, state.world.id, state.world.generationVersion]);

  const keyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === 'Escape' && viewMode === 'world') { sceneRef.current?.showRegion(); event.preventDefault(); }
    if (event.key === '+' || event.key === '=') {
      if (viewMode === 'world') sceneRef.current?.showRegion();
      else sceneRef.current?.showVillage();
      event.preventDefault();
    }
    if (event.key === '-' || event.key === '_') {
      if (viewMode === 'village') sceneRef.current?.showRegion();
      else sceneRef.current?.showWorld();
      event.preventDefault();
    }
    if (viewMode === 'world' && event.key.startsWith('Arrow')) {
      sceneRef.current?.rotateWorld(event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0,
        event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0);
      event.preventDefault();
    }
    if (viewMode === 'world' && event.key === 'Enter') { sceneRef.current?.selectWorldCenter(); event.preventDefault(); }
  };

  return <><canvas ref={canvasRef} className="village-canvas" data-testid="village-canvas" aria-label="Vue stratégique du village" tabIndex={0} onKeyDown={keyDown} data-view-mode={viewMode} />
    <div className="world-view-controls" aria-label="Échelle de la carte">
      <span>{viewMode === 'village' ? 'Village' : viewMode === 'region' ? 'Région' : 'Monde'}</span>
      {viewMode === 'village' && <button type="button" onClick={() => sceneRef.current?.showRegion()}>Explorer la région</button>}
      {viewMode !== 'village' && <button type="button" onClick={() => sceneRef.current?.showVillage()}>Mon village</button>}
      {viewMode === 'world' && <button type="button" onClick={() => sceneRef.current?.showRegion()}>Voir cette région</button>}
      {viewMode !== 'world' && <button type="button" onClick={() => sceneRef.current?.showWorld()}>{state.science?.globalModelAvailable || sciencePreview() ? 'Monde torique' : 'Observer la courbure'}</button>}
      {(state.science?.globalModelAvailable || sciencePreview()) && <button type="button" aria-pressed={cosmologyDebug} onClick={() => setCosmologyDebug(value => !value)}>Cosmologie · debug</button>}
      {sciencePreview() && <span>Sciences · aperçu développeur</span>}
    </div>
    {arrival && <div className="village-arrival" role="dialog" aria-label={`Arrivée à ${arrival.name}`} onClick={event => { event.stopPropagation(); sceneRef.current?.skipArrival(true); }}
      onWheel={event => { event.stopPropagation(); sceneRef.current?.zoomDuringArrival(event.deltaY); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); sceneRef.current?.skipArrival(true); } }}>
      <div className="village-arrival-veil" style={{ backdropFilter: `blur(${arrival.veil * 1.15}px)` }} />
      {arrival.time === 'Nuit' && <div className="village-arrival-mist" style={{ opacity: arrival.veil * .12 }} />}
      <div className="village-arrival-black" style={{ opacity: arrival.black }} />
      <div className="village-arrival-title" style={{ opacity: arrival.title }}><strong>{arrival.name}</strong><span>({arrival.time})</span></div>
      <button autoFocus type="button" onClick={() => sceneRef.current?.skipArrival(true)}>Passer</button>
    </div>}
    {cosmologyDebug && <CosmologyDebug scene={getScene} />}
    {loading && viewMode !== 'world' ? <div className="terrain-loading" role="status">{loading === 'retry' ? 'Terrain : connexion interrompue' : 'Chargement du terrain…'}{loading === 'retry' ? <button onClick={() => sceneRef.current?.retryTerrain()}>Réessayer</button> : null}</div> : null}</>;
}

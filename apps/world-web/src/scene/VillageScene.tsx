import type {StarterGhost} from '../spawn-map/starter-controller';
import type {InfrastructureGesture} from './infrastructure-renderer';
import type {InfrastructureOperation,SubPoint} from '@arbestra/contracts';
import type { RepresentativeInfo } from './village-workers';
import type { InhabitantCameraMode } from './inhabitant-camera';
import type { VillageArrival } from './village-arrival';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { CosmologyDebug } from './CosmologyDebug';
import { createPortal } from 'react-dom';
import { VillageSolarPreview } from './VillageSolarPreview';

import type { NaturalFeature, StoneDeposit, VillageState } from '@arbestra/contracts';

import { BabylonVillageScene, type TerrainStatus, type TerrainViewMode } from './BabylonVillageScene';
import type { ScreenAnchor } from '../ui/WorldContextMenu';
import type { AreaPreview, Cell } from './construction-selection';
import type { ActiveWorldMode } from '../ui/world-mode';

interface VillageSceneProps {
  preparing?:boolean; starterGhost?:StarterGhost|null; onStarterManual?:(()=>void)|undefined;
  worldMode: ActiveWorldMode;
  populationFocus?: string | null;
  populationFilter?: string;
  noclip?: boolean;
  state: VillageState;
  serverOffsetMs: number;
  terrainRef: Ref<TerrainHandle>;
  pendingHarvestCells: Cell[];
  highlightedSiteIds: string[];
  constructionMode?: boolean;
  showTravelPaths?: boolean;
  selectedRouteId?: string | null;
  cosmologyDebug?: boolean;
  paletteOpen?: boolean;
  devOpen?: boolean;
  constructionType?: string | null;
  constructionQuarterTurns?:number;
  constructionHouseVariant?:'stone'|'logs'|'beams';
  constructionAction?: 'build' | 'upgrade' | 'extend' | null;
  onBuildingHover?: (id: string | null) => void;
  selectingArea: boolean;
  preview: AreaPreview | null;
  previewInvalid: boolean;
  onAreaGesture: (first: Cell, last: Cell, commit: boolean) => void;
  onGardenHarvest: (cell: Cell | null, newGesture?: boolean, previewOnly?: boolean) => void;
  onWorldGestureCancelled?: () => void;
  onSiteSelected: (siteId: string, anchor: ScreenAnchor, inspect?: boolean) => void;
  onFeatureSelected?: (featureId: string, anchor: ScreenAnchor) => void;
  onCameraMoved: () => void;
  onArrivalActive?: (active: boolean) => void;
  onEyesFound?: () => void;
  onViewChanged?: (mode: TerrainViewMode) => void;
}
export interface TerrainHandle { focusCell:(cell:Cell)=>void; viewCenter:()=>Cell|null; naturalFeatures:()=>NaturalFeature[]; ready:()=>boolean; infrastructureTool:(handler:((gesture:InfrastructureGesture)=>void)|null)=>void; infrastructurePreview:(operation:InfrastructureOperation|null,invalid?:boolean,preparedPlan?:import('@arbestra/contracts').InfrastructurePlan)=>void; equipmentAt:(point:SubPoint,pickedId?:string)=>{id:string;version:number;position:SubPoint;quarterTurns:number}|null; selectRepresentative:(id:string|null)=>void; representativeInfo:(id:string)=>RepresentativeInfo|null; projectRepresentative:(id:string)=>ScreenAnchor|null; representativeCamera:(mode:'pov'|'follow'|'village')=>void; representativeCameraMode:()=>InhabitantCameraMode; cancelGesture: () => void; resetCosmology: () => void; projectPopulation: (id: string) => ScreenAnchor | null; featuresAt: (cell: Cell) => NaturalFeature[]; acceptDeposit: (deposit: StoneDeposit) => void; showVillage: () => void; projectCell: (cell: Cell) => ScreenAnchor | null; setWorldMode: (mode: ActiveWorldMode) => void }

export function VillageScene({ preparing=false, starterGhost=null, onStarterManual, worldMode, noclip=false, populationFocus = null, populationFilter = 'all', state, serverOffsetMs, terrainRef, pendingHarvestCells, highlightedSiteIds, constructionMode = false, showTravelPaths = false, selectedRouteId = null, cosmologyDebug = false, devOpen = false, paletteOpen = true, constructionAction = null, constructionType = null, constructionQuarterTurns=0, constructionHouseVariant='stone', onBuildingHover, selectingArea, preview, previewInvalid, onAreaGesture, onGardenHarvest, onWorldGestureCancelled, onSiteSelected, onCameraMoved, onFeatureSelected, onViewChanged, onArrivalActive, onEyesFound }: VillageSceneProps) {
  const [arrival, setArrival] = useState<VillageArrival | null>(null);
  const callbacks = useRef({ onArrivalActive, onEyesFound, onWorldGestureCancelled }); callbacks.current = { onArrivalActive, onEyesFound, onWorldGestureCancelled };
  const [devTarget, setDevTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setDevTarget(devOpen ? document.getElementById('dev-cosmology-slot') : null); }, [devOpen, cosmologyDebug]);
  const [loading, setLoading] = useState<TerrainStatus>(null);
  const [viewMode, setViewMode] = useState<TerrainViewMode>('village');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<BabylonVillageScene | null>(null);
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
      (siteId, anchor, inspect) => selectionHandlerRef.current(siteId, anchor, inspect),
      () => cameraHandlerRef.current(),
      (first, last, commit) => areaHandlerRef.current(first, last, commit),
      (featureId, anchor) => featureHandlerRef.current?.(featureId, anchor),
      (cell, newGesture, previewOnly) => harvestHandlerRef.current(cell, newGesture, previewOnly),
      () => callbacks.current.onWorldGestureCancelled?.(),
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
  }, [state.world.id, state.world.generationVersion, BabylonVillageScene]);

  useEffect(() => {
    // React's development mount probe is disposed before the next frame. Do not
    // manufacture an entire campus for that discarded scene (or a stale snapshot).
    const frame = requestAnimationFrame(() => {
      sceneRef.current?.setPreparation(preparing);
      sceneRef.current?.update(state, highlightedSiteIds, constructionMode, showTravelPaths, selectedRouteId);
      sceneRef.current?.updateAreaSelection(selectingArea,preview,previewInvalid);
      sceneRef.current?.setStarterGhost(starterGhost,onStarterManual??null);
      sceneRef.current?.updateConstructionGhost(selectingArea?constructionType:null,preview,previewInvalid,constructionQuarterTurns,constructionHouseVariant);
    });
    return () => cancelAnimationFrame(frame);
  }, [state, preparing, highlightedSiteIds, constructionMode, showTravelPaths, selectedRouteId, BabylonVillageScene]);

  useImperativeHandle(terrainRef, () => ({ ready:()=>Boolean(sceneRef.current), infrastructureTool:handler=>sceneRef.current?.infrastructureTool(handler),infrastructurePreview:(op,invalid,preparedPlan)=>sceneRef.current?.infrastructurePreview(op,invalid,preparedPlan),equipmentAt:(p,pickedId)=>sceneRef.current?.equipmentAt(p,pickedId)??null,selectRepresentative:id=>sceneRef.current?.selectRepresentative(id), representativeInfo:id=>sceneRef.current?.representativeInfo(id)??null, projectRepresentative:id=>sceneRef.current?.projectRepresentative(id)??null, representativeCamera:mode=>sceneRef.current?.representativeCamera(mode), representativeCameraMode:()=>sceneRef.current?.representativeCameraMode??'village', cancelGesture: () => sceneRef.current?.cancelGesture(), resetCosmology: () => { sceneRef.current?.setCosmologyPhase(null); sceneRef.current?.setCosmologyPeriod(28800); }, featuresAt: cell => sceneRef.current?.featuresAt(cell) ?? [], acceptDeposit: deposit => sceneRef.current?.acceptDeposit(deposit),
    projectPopulation: id => sceneRef.current?.projectPopulation(id) ?? null,
    showVillage: () => sceneRef.current?.showVillage(), projectCell: cell => sceneRef.current?.projectCell(cell) ?? null,
    focusCell:cell=>sceneRef.current?.focusCell(cell),viewCenter:()=>sceneRef.current?.viewCenter()??null,naturalFeatures:()=>sceneRef.current?.naturalFeatures()??[],
    setWorldMode: mode => sceneRef.current?.setWorldMode(mode) }), []);
  useEffect(() => { sceneRef.current?.setWorldMode(worldMode); }, [worldMode, state.world.id, BabylonVillageScene]);
  useEffect(() => { sceneRef.current?.setNoclip(noclip); }, [noclip,state.world.id,BabylonVillageScene]);
  useEffect(() => { sceneRef.current?.setPopulationFocus(populationFocus, populationFilter); }, [populationFocus, populationFilter, state.world.id, BabylonVillageScene]);

  useEffect(() => { sceneRef.current?.updateHarvestPending(pendingHarvestCells); }, [state, pendingHarvestCells]);

  useEffect(() => {
    sceneRef.current?.updateAreaSelection(selectingArea, preview, previewInvalid);
  }, [selectingArea, preview, previewInvalid]);
  useEffect(() => { sceneRef.current?.setStarterGhost(starterGhost,onStarterManual??null); sceneRef.current?.updateConstructionGhost(selectingArea ? constructionType : null, preview, previewInvalid,constructionQuarterTurns,constructionHouseVariant); }, [starterGhost, onStarterManual, constructionType, selectingArea, preview, previewInvalid,constructionQuarterTurns,constructionHouseVariant]);
  useEffect(() => { sceneRef.current?.setConstructionAction(constructionAction, id => onBuildingHover?.(id)); }, [constructionAction, onBuildingHover]);
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
    {arrival && <div className="village-arrival" role="dialog" aria-label={`Arrivée à ${arrival.name}`} onClick={event => { event.stopPropagation(); sceneRef.current?.skipArrival(true); }}
      onWheel={event => { event.stopPropagation(); sceneRef.current?.zoomDuringArrival(event.deltaY); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); sceneRef.current?.skipArrival(true); } }}>
      <div className="village-arrival-veil" style={{ backdropFilter: `blur(${arrival.veil * 1.15}px)` }} />
      {arrival.time === 'Nuit' && <div className="village-arrival-mist" style={{ opacity: arrival.veil * .12 }} />}
      <div className="village-arrival-black" style={{ opacity: arrival.black }} />
      <div className="village-arrival-title" style={{ opacity: arrival.title }}><strong>{arrival.name}</strong><span>({arrival.time})</span></div>
      <button autoFocus type="button" onClick={() => sceneRef.current?.skipArrival(true)}>Passer</button>
    </div>}
    {cosmologyDebug && devOpen && devTarget && createPortal(<CosmologyDebug scene={getScene} />, devTarget)}
    {worldMode === 'exploration' && viewMode === 'village' && !arrival && !cosmologyDebug && paletteOpen && <VillageSolarPreview scene={getScene} onChoose={() => {}} />}
    {loading && viewMode !== 'world' ? <div className="terrain-loading" role="status">{loading === 'retry' ? 'Terrain : connexion interrompue' : 'Chargement du terrain…'}{loading === 'retry' ? <button onClick={() => sceneRef.current?.retryTerrain()}>Réessayer</button> : null}</div> : null}</>;
}

import { useEffect, useRef } from 'react';

import type { VillageState } from '@arbestra/contracts';

import { BabylonVillageScene } from './BabylonVillageScene';
import type { ScreenAnchor } from '../ui/WorldContextMenu';
import type { AreaPreview, Cell } from './construction-selection';

interface VillageSceneProps {
  state: VillageState;
  highlightedSiteIds: string[];
  constructionMode?: boolean;
  selectingArea: boolean;
  preview: AreaPreview | null;
  previewInvalid: boolean;
  onAreaGesture: (first: Cell, last: Cell, tap: boolean) => void;
  onSiteSelected: (siteId: string, anchor: ScreenAnchor) => void;
  onFeatureSelected?: (featureId: string, anchor: ScreenAnchor) => void;
  onCameraMoved: () => void;
}

export function VillageScene({ state, highlightedSiteIds, constructionMode = false, selectingArea, preview, previewInvalid, onAreaGesture, onSiteSelected, onCameraMoved, onFeatureSelected }: VillageSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<BabylonVillageScene | null>(null);
  const selectionHandlerRef = useRef(onSiteSelected);
  const featureHandlerRef = useRef(onFeatureSelected);
  featureHandlerRef.current = onFeatureSelected;
  const cameraHandlerRef = useRef(onCameraMoved);
  const areaHandlerRef = useRef(onAreaGesture);
  selectionHandlerRef.current = onSiteSelected;
  cameraHandlerRef.current = onCameraMoved;
  areaHandlerRef.current = onAreaGesture;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new BabylonVillageScene(
      canvas,
      (siteId, anchor) => selectionHandlerRef.current(siteId, anchor),
      () => cameraHandlerRef.current(),
      (first, last, tap) => areaHandlerRef.current(first, last, tap),
      (featureId, anchor) => featureHandlerRef.current?.(featureId, anchor),
    );
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.update(state, highlightedSiteIds, constructionMode);
  }, [state, highlightedSiteIds, constructionMode]);

  useEffect(() => {
    sceneRef.current?.updateAreaSelection(selectingArea, preview, previewInvalid);
  }, [selectingArea, preview, previewInvalid]);

  return <canvas ref={canvasRef} className="village-canvas" data-testid="village-canvas" aria-label="Vue stratégique du village" />;
}

import { useEffect, useRef } from 'react';

import type { VillageState } from '@arbestra/contracts';

import { BabylonVillageScene } from './BabylonVillageScene';
import type { ScreenAnchor } from '../ui/WorldContextMenu';

interface VillageSceneProps {
  state: VillageState;
  highlightedSiteIds: string[];
  onSiteSelected: (siteId: string, anchor: ScreenAnchor) => void;
  onCameraMoved: () => void;
}

export function VillageScene({ state, highlightedSiteIds, onSiteSelected, onCameraMoved }: VillageSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<BabylonVillageScene | null>(null);
  const selectionHandlerRef = useRef(onSiteSelected);
  const cameraHandlerRef = useRef(onCameraMoved);
  selectionHandlerRef.current = onSiteSelected;
  cameraHandlerRef.current = onCameraMoved;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new BabylonVillageScene(
      canvas,
      (siteId, anchor) => selectionHandlerRef.current(siteId, anchor),
      () => cameraHandlerRef.current(),
    );
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.update(state, highlightedSiteIds);
  }, [state, highlightedSiteIds]);

  return <canvas ref={canvasRef} className="village-canvas" data-testid="village-canvas" aria-label="Vue stratégique du village" />;
}

export type InitialLoadPhase = 'terrain' | 'details' | 'buildings' | 'routes' | 'render' | 'ready';
export interface InitialLoadProgress {
  phase: InitialLoadPhase;
  completed: number;
  total: number;
  error: string | null;
}
export interface InitialLoadEvidence {
  ground: { completed: number; total: number };
  detailsPending: number;
  terrainFailed: boolean;
  buildingsPending: boolean;
  buildingsFailed: boolean;
  routesPrepared: boolean;
  rendered: boolean;
}

/** A reveal requires actual geometry and a rendered frame, never a timer or an empty demand. */
export class InitialVillageLoad {
  ready = false;
  observe(e: InitialLoadEvidence): InitialLoadProgress {
    if (this.ready) return { phase: 'ready', ...e.ground, error: null };
    const phase: InitialLoadPhase =
      !e.ground.total || e.ground.completed < e.ground.total
        ? 'terrain'
        : e.detailsPending
          ? 'details'
          : e.buildingsPending || e.buildingsFailed
            ? 'buildings'
            : !e.routesPrepared
              ? 'routes'
              : !e.rendered
                ? 'render'
                : 'ready';
    const error = e.terrainFailed
      ? 'Le terrain est momentanément inaccessible. Nouvelle tentative en cours…'
      : e.buildingsFailed
        ? 'Certains bâtiments n’ont pas pu être chargés.'
        : null;
    this.ready = phase === 'ready' && !error;
    return { phase: phase === 'ready' && error ? 'terrain' : phase, ...e.ground, error };
  }
}

/**
 * Whether the villagers walk this frame. Never behind the loading cover (opaque, full screen): the
 * frames there come about 300 ms apart and each one caught up four traffic steps of walkers no one
 * saw, 10 to 25 ms a frame with desire paths on (15 November, Bressuire). Figures resume on the
 * first visible frame, as after a long absence. Then only in the village view, close enough to see
 * them.
 */
export function villagersAnimated(ready: boolean, mode: string, cameraRadius: number): boolean {
  return ready && mode === 'village' && cameraRadius < 165;
}

import { Component, type ReactNode } from 'react';
import type { InitialLoadProgress } from '../scene/initial-village-load';

const labels = {
  terrain: 'Chargement du terrain', details: 'Préparation du paysage', buildings: 'Préparation des bâtiments',
  routes: 'Initialisation des routes', render: 'Préparation de la première image', ready: 'Bienvenue',
};
export function WorldLoading({worldName, progress, message = 'Préparation du monde', error, onRetry, lobbyUrl}: {
  worldName?: string | undefined; progress?: InitialLoadProgress | undefined; message?: string;
  error?: string | null | undefined; onRetry?: (() => void) | undefined; lobbyUrl?: string | undefined;
}) {
  const problem = error ?? progress?.error;
  return <section className="world-loading" aria-label="Chargement du monde" data-phase={progress?.phase ?? 'village'}>
    <img className="world-loading-art" src="/arbestra-loading.png" alt="" fetchPriority="high" />
    <div className="world-loading-content">
      <p className="world-loading-eyebrow">{worldName ? 'Votre destination' : 'Bienvenue dans Arbestra'}</p>
      <h1>{worldName || 'Arbestra'}</h1>
      <div className="world-loading-rule" aria-hidden="true"><span>✦</span></div>
      <div role="status" aria-live="polite" aria-atomic="true">
        <p className="world-loading-step">{problem || (progress ? labels[progress.phase] : message)}{!problem && '…'}</p>
        {progress?.phase === 'terrain' && progress.total > 0 && <p className="world-loading-detail">{progress.completed} / {progress.total} tuiles préparées</p>}
      </div>
      {!problem && <div className="world-loading-pulse" aria-hidden="true"><i/><i/><i/></div>}
      {(problem || lobbyUrl) && <div className="world-loading-actions">
        {problem && onRetry && <button type="button" onClick={onRetry}>Réessayer</button>}
        {lobbyUrl && <a href={lobbyUrl}>Retour aux mondes</a>}
      </div>}
    </div>
  </section>;
}

/** Also handles a failed lazy import or WebGL initialization, with an actionable exit. */
export class WorldLoadingBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  override state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  override render() { return this.state.failed ? <WorldLoading error="Le monde n’a pas pu être affiché." onRetry={() => location.reload()}
    lobbyUrl={import.meta.env.VITE_LOBBY_URL ?? `${location.protocol}//${location.hostname}:5173`}/> : this.props.children; }
}

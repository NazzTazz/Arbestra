import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';

const SpawnPlacement = lazy(() => import('./spawn-map/SpawnPlacement').then((m) => ({ default: m.SpawnPlacement })));
const App = lazy(() => import('./App').then((m) => ({ default: m.App })));
import { GeneratorEntry } from './world-generator/GeneratorEntry';
import { isStarterRoute } from './spawn-map/starter-route';
const TerrainStudy = lazy(() => import('./world-generator/TerrainStudy').then((m) => ({ default: m.TerrainStudy })));
const SpawnMap = lazy(() => import('./spawn-map/SpawnAtlas').then((m) => ({ default: m.SpawnMap })));
const WorldGenerator = lazy(() =>
  import('./world-generator/WorldGenerator').then((m) => ({ default: m.WorldGenerator })),
);
const TerrainKitPreview = lazy(() =>
  import('./world-generator/TerrainKitPreview').then((m) => ({ default: m.TerrainKitPreview })),
);
const GeographyPreview = lazy(() =>
  import('./world-generator/GeographyPreview').then((m) => ({ default: m.GeographyPreview })),
);
import './styles.css';
import { StatisticsOverlay } from './dev/StatisticsOverlay';
import { WorldLoading, WorldLoadingBoundary } from './ui/WorldLoading';
import { initialVillageRead, initialWorldName } from './api/initial-village';
import { startObservation } from './api/observation-client';
import { addressRedirect } from './api/world-address';
import { devToolsEnabled } from './dev/dev-tools';
// A former shared-host address (`?world=`) moves to the world's own subdomain.
if (addressRedirect) location.replace(addressRedirect);
const observing =
  !addressRedirect &&
  (new URLSearchParams(location.search).has('observe') ||
    new URLSearchParams(location.hash.slice(1)).has('observationToken'));
const ObservationEntry = lazy(() => import('./ObservationEntry'));
if (observing) void startObservation().catch(() => {});

if (
  !addressRedirect &&
  !observing &&
  !isStarterRoute(location.pathname, location.search) &&
  !['/spawn-map', '/terrain-study', '/geography-preview', '/terrain-kit', '/world-generator'].includes(
    location.pathname,
  )
) {
  void initialVillageRead().catch(() => {}); // App presents the error with recovery actions.
  void initialWorldName();
}

if (!addressRedirect)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {devToolsEnabled() && <StatisticsOverlay />}
      {observing ? (
        <WorldLoadingBoundary>
          <Suspense fallback={<WorldLoading message="Ouverture du village observé" />}>
            <ObservationEntry />
          </Suspense>
        </WorldLoadingBoundary>
      ) : isStarterRoute(location.pathname, location.search) ? (
        <Suspense fallback={<p>Préparation du village…</p>}>
          <SpawnPlacement />
        </Suspense>
      ) : location.pathname === '/spawn-map' ? (
        <Suspense fallback={<p>Chargement de la carte…</p>}>
          <SpawnMap />
        </Suspense>
      ) : location.pathname === '/terrain-study' ? (
        <Suspense fallback={<p>Chargement du monde témoin…</p>}>
          <TerrainStudy />
        </Suspense>
      ) : location.pathname === '/geography-preview' ? (
        <Suspense fallback={<p>Chargement de la géographie...</p>}>
          <GeographyPreview />
        </Suspense>
      ) : location.pathname === '/terrain-kit' ? (
        <Suspense fallback={<p>Chargement du kit...</p>}>
          <TerrainKitPreview />
        </Suspense>
      ) : location.pathname === '/world-generator' ? (
        <Suspense fallback={<p>Chargement du World generator…</p>}>
          <WorldGenerator />
        </Suspense>
      ) : (
        <WorldLoadingBoundary>
          <Suspense fallback={<WorldLoading />}>
            <App />
            <GeneratorEntry />
          </Suspense>
        </WorldLoadingBoundary>
      )}
    </StrictMode>,
  );

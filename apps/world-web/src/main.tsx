import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';

const SpawnPlacement=lazy(()=>import('./spawn-map/SpawnPlacement').then(m=>({default:m.SpawnPlacement})));
const App=lazy(()=>import('./App').then(m=>({default:m.App})));
import { GeneratorEntry } from './world-generator/GeneratorEntry';
const TerrainStudy=lazy(()=>import('./world-generator/TerrainStudy').then(m=>({default:m.TerrainStudy})));
const SpawnMap=lazy(()=>import('./spawn-map/SpawnAtlas').then(m=>({default:m.SpawnMap})));
const WorldGenerator=lazy(()=>import('./world-generator/WorldGenerator').then(m=>({default:m.WorldGenerator})));
const TerrainKitPreview=lazy(()=>import('./world-generator/TerrainKitPreview').then(m=>({default:m.TerrainKitPreview})));
const GeographyPreview=lazy(()=>import('./world-generator/GeographyPreview').then(m=>({default:m.GeographyPreview})));
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.pathname === '/spawn' ? <Suspense fallback={<p>Préparation du village…</p>}><SpawnPlacement /></Suspense> : location.pathname === '/spawn-map' ? <Suspense fallback={<p>Chargement de la carte…</p>}><SpawnMap /></Suspense> : (
    location.pathname === '/terrain-study' ? <Suspense fallback={<p>Chargement du monde témoin…</p>}><TerrainStudy /></Suspense> : location.pathname === '/geography-preview' ? <Suspense fallback={<p>Chargement de la géographie...</p>}><GeographyPreview /></Suspense> : location.pathname === '/terrain-kit' ? <Suspense fallback={<p>Chargement du kit...</p>}><TerrainKitPreview /></Suspense> : location.pathname === '/world-generator' ? <Suspense fallback={<p>Chargement du World generator…</p>}><WorldGenerator /></Suspense> : <Suspense fallback={<p>Chargement du village…</p>}><App /><GeneratorEntry /></Suspense>
    )}
  </StrictMode>,
);

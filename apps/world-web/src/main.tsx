import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { GeneratorEntry } from './world-generator/GeneratorEntry';
const WorldGenerator=lazy(()=>import('./world-generator/WorldGenerator').then(m=>({default:m.WorldGenerator})));
const TerrainKitPreview=lazy(()=>import('./world-generator/TerrainKitPreview').then(m=>({default:m.TerrainKitPreview})));
const GeographyPreview=lazy(()=>import('./world-generator/GeographyPreview').then(m=>({default:m.GeographyPreview})));
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.pathname === '/geography-preview' ? <Suspense fallback={<p>Chargement de la géographie...</p>}><GeographyPreview /></Suspense> : location.pathname === '/terrain-kit' ? <Suspense fallback={<p>Chargement du kit...</p>}><TerrainKitPreview /></Suspense> : location.pathname === '/world-generator' ? <Suspense fallback={<p>Chargement du World generator…</p>}><WorldGenerator /></Suspense> : <><App /><GeneratorEntry /></>}
  </StrictMode>,
);

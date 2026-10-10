import { useEffect, useMemo, useRef, useState } from 'react';
import { firstLuminosityExtremum, spawnDistance, spawnLuminosity,
  type SpawnMap as MapData, type SpawnPoint, type SpawnTerrainResult, type SpawnResourcePreflight } from '@arbestra/contracts';
import { PreviewScene, type PreviewMapOverlay, type PreviewStats } from '../world-generator/PreviewScene';
import type { WorldGeometryBuffers } from '../world-generator/world-geography-mesh';
import '../world-generator/world-generator.css';
import './spawn-map.css';
import { createInspectionQueue } from './inspection-queue';
import { periodicMapLines } from './periodic-lines';

const reasonLabels = { water: 'Eau sous une emprise', rock: 'Roche sous une emprise', relief: 'Relief hors de la bande ±2 niveaux', neighbor: 'Un village est à 50 cases ou moins', occupation: 'Occupation ou passage à préserver', territory: 'Territoire d’un village existant' };
async function response<T>(r: Response): Promise<T> {
  const body = await r.json(); if (!r.ok) throw Error(body.message ?? 'Lecture de la carte impossible.'); return body as T;
}
function Luminosity({ point, width, height }: { point: SpawnPoint; width: number; height: number }) {
  const values = useMemo(() => spawnLuminosity(point, width, height), [point, width, height]);
  const peak = firstLuminosityExtremum(values, true), trough = firstLuminosityExtremum(values, false);
  const at = (i: number) => { const a = Math.floor(i), t = i - a; return values[a]! * (1 - t) + values[Math.min(a + 1, values.length - 1)]! * t; };
  return <figure className="spawn-luminosity"><figcaption>Ensoleillement · luminosité sur 24 h</figcaption>
    <svg viewBox="0 0 330 140" role="img" aria-label="Courbe locale de luminosité sur 24 heures, échelle commune de zéro à un">
      {[0, .5, 1].map(v => <g key={v}><path d={`M 24 ${112 - v * 80} H 312`} className="spawn-chart-grid"/><text x="2" y={116 - v * 80}>{v}</text></g>)}
      <path className="spawn-chart-line" d={values.map((v, i) => `${i ? 'L' : 'M'} ${24 + i} ${112 - v * 80}`).join(' ')}/>
      {[0, 6, 12, 18, 24].map(h => <text key={h} x={24 + h * 12} y="133" textAnchor="middle">{h} h</text>)}
      {peak !== null && <g aria-label="Premier sommet" transform={`translate(${24 + peak},${112 - at(peak) * 80 - 15})`}><circle r="4" className="spawn-sun"/>{Array.from({ length: 8 }, (_, i) => <path key={i} className="spawn-sun" d="M 0 -7 V -10" transform={`rotate(${i * 45})`}/>)}</g>}
      {trough !== null && <path aria-label="Premier creux" className="spawn-moon" transform={`translate(${24 + trough},${112 - at(trough) * 80 - 14})`} d="M 3 -6 A 6 6 0 1 0 3 6 A 7 7 0 0 1 3 -6"/>}
    </svg></figure>;
}
/** Internal receipt route; no lobby link until playable installation is connected. */
export function SpawnMap() {
  const slug = new URLSearchParams(location.search).get('world') ?? '';
  const [map, setMap] = useState<MapData | null>(null), [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [hover, setHover] = useState<SpawnPoint | null>(null), [selected, setSelected] = useState<SpawnPoint | null>(null);
  const [disk, setDisk] = useState<SpawnTerrainResult | null>(null), [turns, setTurns] = useState(0);
  const [checked, setChecked] = useState<SpawnTerrainResult | null>(null), [checking, setChecking] = useState(false);
  const [resources, setResources] = useState<SpawnResourcePreflight | null>(null);
  const [villageHover, setVillageHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [stats, setStats] = useState<PreviewStats | null>(null);
  const [inspected, setInspected] = useState<SpawnTerrainResult | null>(null);
  const [geometry, setGeometry] = useState<WorldGeometryBuffers | null>(null);
  const worker = useRef<Worker | null>(null), diskSequence = useRef(0), selectionSequence = useRef(0);
  const inspectionQueue = useRef<ReturnType<typeof createInspectionQueue> | null>(null);
  const cursorEventAt = useRef(0), diskResultAt = useRef(0);
  const request = useRef<AbortController | null>(null), sequence = useRef(0), hiddenVillage = useRef<string | null>(null);
  const villageLeave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepVillage = () => { if (villageLeave.current) clearTimeout(villageLeave.current); villageLeave.current = null; };
  const leaveVillage = () => { keepVillage(); villageLeave.current = setTimeout(() => setVillageHover(null), 350); };
  useEffect(() => {
    const abort = new AbortController();
    setError('');
    if (!slug) { setError('Indiquez le monde de recette dans le lien.'); return; }
    fetch(`/api/worlds/${encodeURIComponent(slug)}/spawn-map`, { signal: abort.signal, credentials: 'same-origin' })
      .then(response<MapData>).then(data => { if (!abort.signal.aborted) setMap(data); }).catch(e => { if (!abort.signal.aborted) setError(String(e.message)); });
    return () => abort.abort();
  }, [slug, reload]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => () => { if (villageLeave.current) clearTimeout(villageLeave.current); }, []);
  const displayed = useMemo(() => map && { ...map.landscape, geography: { ...map.landscape.geography!, study: { ...map.landscape.geography!.study!, waterLevel: 0 } } }, [map]);
  useEffect(() => {
    if (!map) return;
    keepVillage();
    setGeometry(null); setDisk(null); setInspected(null);
    const instance = new Worker(new URL('./terrain-worker.ts', import.meta.url), { type: 'module' }); worker.current = instance;
    const queue = createInspectionQueue(task => instance.postMessage(task)); inspectionQueue.current = queue;
    instance.onmessage = (e: MessageEvent<{ channel: 'geometry'; geometry: WorldGeometryBuffers; milliseconds: number } | { channel: 'disk' | 'selection'; sequence: number; result: SpawnTerrainResult; milliseconds: number }>) => {
      const message = e.data;
      if (message.channel === 'geometry') { queue.ready(); setGeometry(message.geometry); document.querySelector<HTMLElement>('.spawn-workspace')?.setAttribute('data-geography-ms', message.milliseconds.toFixed(1)); return; }
      const task = queue.complete(message.channel, message.sequence); if (!task) return;
      if (message.channel === 'disk' && message.sequence === diskSequence.current) { diskResultAt.current = task.requestedAt; setDisk(message.result); }
      if (message.channel === 'selection' && message.sequence === selectionSequence.current) setInspected(message.result);
      const workspace = document.querySelector<HTMLElement>('.spawn-workspace');
      workspace?.setAttribute(`data-${message.channel}-compute-ms`, message.milliseconds.toFixed(1));
      workspace?.setAttribute(`data-${message.channel}-result-ms`, (performance.now() - task.requestedAt).toFixed(1));
    };
    instance.onerror = () => { setError('Le diagnostic du terrain a échoué. Rechargez la carte.'); setMap(null); setGeometry(null); };
    instance.postMessage({ kind: 'init', map });
    return () => { instance.terminate(); worker.current = null; inspectionQueue.current = null; };
  }, [map]);
  useEffect(() => {
    const current = ++selectionSequence.current; setInspected(null); inspectionQueue.current?.cancel('selection');
    if (selected && map) inspectionQueue.current?.request({ kind: 'inspect', channel: 'selection', sequence: current, point: selected, turns, requestedAt: performance.now() });
  }, [selected, turns, map]);
  const cursor = hover ?? selected;
  const cursorX = cursor?.x, cursorY = cursor?.y;
  const cursorRequestedAt = useMemo(() => cursorEventAt.current || performance.now(), [cursorX, cursorY, turns]);
  const currentDisk = disk && disk.point.x === cursorX && disk.point.y === cursorY && disk.quarterTurns === turns ? disk : null;
  const currentInspection = inspected && inspected.point.x === selected?.x && inspected.point.y === selected.y && inspected.quarterTurns === turns ? inspected : null;
  useEffect(() => {
    const current = ++diskSequence.current; setDisk(null); inspectionQueue.current?.cancel('disk');
    if (cursorX === undefined || cursorY === undefined || !map) return;
    const timer = setTimeout(() => inspectionQueue.current?.request({ kind: 'inspect', channel: 'disk', sequence: current, point: { x: cursorX, y: cursorY }, turns, requestedAt: cursorRequestedAt }), 120);
    return () => clearTimeout(timer);
  }, [cursorX, cursorY, map, turns, cursorRequestedAt]);
  const select = (point: SpawnPoint) => { cursorEventAt.current = performance.now(); request.current?.abort(); sequence.current++; setChecking(false); setChecked(null); setResources(null); setError(''); setSelected(point); };
  const hoverAt = (x: number, y: number, screenX: number, screenY: number) => {
    if (!map) return;
    cursorEventAt.current = performance.now();
    const village = map.villages.find(v => spawnDistance(v, { x, y }, map.landscape.width, map.landscape.height) <= 2);
    if (village) { if (hiddenVillage.current !== village.id) setVillageHover({ id: village.id, x: screenX, y: screenY }); setHover(null); }
    else { hiddenVillage.current = null; setVillageHover(null); setHover(previous => previous?.x === x && previous.y === y ? previous : { x, y }); }
  };
  const pick = (x: number, y: number) => {
    const village = map?.villages.find(v => spawnDistance(v, { x, y }, map.landscape.width, map.landscape.height) <= 2);
    if (village) { document.getElementById(`spawn-village-${village.id}`)?.focus(); return; }
    select({ x, y });
  };
  const check = async () => {
    if (!selected || !map) return;
    request.current?.abort(); const abort = new AbortController(); request.current = abort; const current = ++sequence.current;
    setChecking(true); setChecked(null); setResources(null); setError('');
    try {
      const result = await fetch(`/api/worlds/${encodeURIComponent(slug)}/spawn-map/resource-check`, { method: 'POST', credentials: 'same-origin', signal: abort.signal,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ point: selected, quarterTurns: turns, artifactChecksum: map.artifactChecksum }) }).then(response<SpawnResourcePreflight>);
      if (current === sequence.current) { setChecked(result.terrain); setResources(result); }
    } catch (e) { if (!abort.signal.aborted && current === sequence.current) setError((e as Error).message); }
    finally { if (current === sequence.current) setChecking(false); }
  };
  const overlay = useMemo<PreviewMapOverlay>(() => {
    const lines: PreviewMapOverlay['lines'] = [];
    if (!map) return { lines }; const w = map.landscape.width, h = map.landscape.height;
    // Split periodic segments at the visible edges; never connect opposite sides through the map.
    const line = (points: SpawnPoint[], color: PreviewMapOverlay['lines'][number]['color']) => {
      for (const part of periodicMapLines(points, w, h)) lines.push({ points: part, color });
    };
    if (cursor) {
      line(Array.from({ length: 241 }, (_, i) => ({ x: cursor.x + Math.cos(i / 240 * Math.PI * 2) * 30, y: cursor.y + Math.sin(i / 240 * Math.PI * 2) * 30 })), 'diagnostic');
      for (const c of currentDisk?.incompatible ?? []) {
        line([{ x: c.x - .5, y: c.y - .5 }, { x: c.x + .5, y: c.y - .5 }, { x: c.x + .5, y: c.y + .5 }, { x: c.x - .5, y: c.y + .5 }, { x: c.x - .5, y: c.y - .5 }], 'error');
        // Cross provides a second cue beyond red alone.
        line([{ x: c.x - .18, y: c.y - .18 }, { x: c.x + .18, y: c.y + .18 }], 'error');
      }
    }
    if (selected) { line([{ x: selected.x - 1, y: selected.y }, { x: selected.x + 1, y: selected.y }], 'selection'); line([{ x: selected.x, y: selected.y - 1 }, { x: selected.x, y: selected.y + 1 }], 'selection'); }
    for (const v of map.villages) line([{ x: v.x - 1, y: v.y - 1 }, { x: v.x + 1, y: v.y - 1 }, { x: v.x + 1, y: v.y + 1 }, { x: v.x - 1, y: v.y + 1 }, { x: v.x - 1, y: v.y - 1 }], 'village');
    return { lines, ...(cursor ? { disk: cursor, requestedAt: cursorRequestedAt } : {}),
      ...(currentDisk ? { diagnosticPoint: currentDisk.point, diagnosticRequestedAt: diskResultAt.current } : {}) };
  }, [currentDisk, cursor, cursorRequestedAt, selected, map]);
  const activeVillage = map?.villages.find(v => v.id === villageHover?.id);
  const close = () => { request.current?.abort(); sequence.current++; setChecking(false); setSelected(null); setChecked(null); setResources(null); document.querySelector<HTMLCanvasElement>('.spawn-map canvas')?.focus(); };
  return <main className="spawn-map"><header><h1>{map?.worldName ?? 'Carte d’arrivée RC1'}</h1><p>Recette interne · diagnostic du terrain. Installation jouable en cours de raccordement.</p></header>
    {error && <div><p role="alert">{error}</p><button onClick={() => { if (map && selected) void check(); else setReload(v => v + 1); }}>Réessayer</button></div>}
    {!displayed && !error && <p role="status">Chargement de la carte…</p>}
    {map && displayed && <>
      {!geometry && <p role="status">Préparation de la géographie RC1…</p>}
      <div className="spawn-workspace" data-terrain-compatible={currentDisk?.terrainCompatible ? 'true' : 'false'} data-disk-state={cursor ? currentDisk ? 'ready' : 'pending' : 'idle'}>{geometry && <PreviewScene data={displayed} mapGeometry={geometry} candidateKey={map.artifactChecksum} arrivalMap flat local={false} layer="terrain" center={selected ?? { x: 0, y: 0 }}
        fog={false} solar={false} exaggeration={1} cycleDegrees={0} onPick={pick} onHover={hoverAt} onLeave={() => { setHover(null); leaveVillage(); }} onStats={setStats} mapOverlay={overlay}
        onMapKey={key => { if (key === 'Escape') { if (villageHover) { hiddenVillage.current = villageHover.id; setVillageHover(null); } else close(); return; }
          const p = cursor ?? { x: Math.floor(map.landscape.width / 2), y: Math.floor(map.landscape.height / 2) };
          if (key === 'Enter') { pick(p.x, p.y); return; } const dx = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0, dy = key === 'ArrowUp' ? 1 : key === 'ArrowDown' ? -1 : 0;
          hoverAt(((p.x + dx) % map.landscape.width + map.landscape.width) % map.landscape.width, ((p.y + dy) % map.landscape.height + map.landscape.height) % map.landscape.height, 30, 160); }}/>}
        {selected && <aside className="spawn-panel" aria-label="Zone sélectionnée"><button className="spawn-close" onClick={close} aria-label="Fermer le panneau">×</button><h2>Emplacement {selected.x}, {selected.y}</h2>
          <label>Orientation du modèle <select value={turns} onChange={e => { request.current?.abort(); sequence.current++; setChecking(false); cursorEventAt.current = performance.now(); setTurns(Number(e.target.value)); setChecked(null); setResources(null); }}>{[0, 1, 2, 3].map(t => <option key={t} value={t}>{t * 90}°</option>)}</select></label>
          <p role="status">{!inspected ? 'Diagnostic du terrain…' : inspected.terrainCompatible ? 'Emprises compatibles avec le terrain.' : inspected.reasons.map(r => reasonLabels[r]).join(' · ')}</p>
          <Luminosity point={selected} width={map.landscape.width} height={map.landscape.height}/>
          <dl>{['Humidité', 'Température', 'Vent', 'Précipitations'].map(name => <div key={name}><dt>{name}</dt><dd>En attente d’instrumentation</dd></div>)}</dl>
          <button disabled={!currentInspection?.terrainCompatible || checking} onClick={() => void check()}>{checking ? 'Vérification…' : 'Vérifier terrain et dotation'}</button>
          {checked && <p role="status">{checked.terrainCompatible ? 'Terrain et voisinage confirmés par le serveur.' : checked.reasons.map(r => reasonLabels[r]).join(' · ')}</p>}
          {resources && resources.planningStatus !== 'terrain-blocked' && <p role="status">{resources.planningStatus === 'planned'
            ? 'Dotation complète possible sur les trajets calculés : 4 300 pierres et, si nécessaire, 3 000 bois.'
            : 'Recherche de dotation inachevée : cet emplacement ne peut pas encore être confirmé.'} Projection des ressources naturelles en attente.</p>}
          <button disabled aria-describedby="spawn-pending">Choisir cet emplacement</button><p id="spawn-pending">Accès piétons, ressources exploitables et préparation du village à raccorder.</p>
        </aside>}
      </div>
      {activeVillage && villageHover && <span className="spawn-village-hover" style={{ left: Math.min(villageHover.x + 12, innerWidth - 220), top: villageHover.y + 12 }} onPointerEnter={keepVillage} onPointerLeave={leaveVillage}>{activeVillage.playerName} · {activeVillage.population} habitants</span>}
      <p className="spawn-help">Glisser pour déplacer · molette pour zoomer · clic pour inspecter. Disque de diagnostic : rayon 30 cases. Arêtes rouges et croisées : surfaces incompatibles.</p>
      <p aria-live="polite">{currentDisk ? `Point inspecté ${currentDisk.point.x}, ${currentDisk.point.y} · ${currentDisk.incompatible.length} surfaces incompatibles dans le disque. ${currentDisk.terrainCompatible ? 'Emprises compatibles.' : currentDisk.reasons.map(r => reasonLabels[r]).join(' · ')}` : cursor ? 'Diagnostic du terrain en cours…' : ''}</p>
      <nav className="spawn-villages" aria-label="Villages">{map.villages.map(v => <button id={`spawn-village-${v.id}`} key={v.id} onFocus={() => { keepVillage(); hiddenVillage.current = null; setVillageHover({ id: v.id, x: 30, y: 160 }); }} onBlur={leaveVillage} onKeyDown={e => { if (e.key === 'Escape') { hiddenVillage.current = v.id; setVillageHover(null); } }}>{v.playerName} · {v.population} habitants</button>)}</nav>
      {stats && <small>{stats.fps.toFixed(0)} FPS · {stats.p95.toFixed(1)} ms p95 · {stats.draws} draws</small>}
    </>}
  </main>;
}

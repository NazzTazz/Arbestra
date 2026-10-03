import { useState } from 'react';
import type { ScienceCommand, ScienceState } from '@arbestra/contracts';

const names = { mathematics: 'Mathématiques', geography: 'Géographie', astronomy: 'Astronomie' };
const statuses = { available: 'Disponible', blocked: 'Prérequis manquants', working: 'Recherche en cours',
  'waiting-data': 'Observations attendues', 'waiting-means': 'En attente de moyens', paused: 'En pause', acquired: 'Maîtrisé' };
const dependencies: Record<string, string[]> = { 'mathematics-2': ['mathematics-1'], 'mathematics-3': ['mathematics-2'],
  'geography-2': ['geography-1', 'mathematics-2'], 'astronomy-1': ['mathematics-3', 'geography-2'] };

export function SciencePanel({ science, villageId, buildingId, target, pending, serverNow, error, onCommand, onClose }:
  { science: ScienceState; villageId: string; buildingId: string | null; pending: boolean; serverNow: number; error: string | null;
    target: {cellX:number;cellY:number}; onCommand: (command: ScienceCommand) => void; onClose: () => void }) {
  const campuses = science.universities.filter(u => u.villageId === villageId);
  const [chosen, setChosen] = useState(buildingId ?? campuses[0]?.buildingId ?? '');
  const [workers, setWorkers] = useState(1);
  const [x, setX] = useState(target.cellX), [y, setY] = useState(target.cellY), [budget, setBudget] = useState(10);
  const campus = campuses.find(u => u.buildingId === chosen) ?? campuses[0];
  return <section className="science-panel" role="dialog" aria-label="Arbre des connaissances">
    <header><div><small>Université · savoir partagé dans ce monde</small><h2>Arbre des connaissances</h2></div><button type="button" onClick={onClose} aria-label="Fermer les connaissances">×</button></header>
    {error && <p className="error">{error}</p>}
    {!campus ? <p>Construis une Université pour ouvrir des centres de recherche et de formation.</p> : <div className="science-capacity">
      <label>Université <select value={campus.buildingId} onChange={e => setChosen(e.target.value)}>{campuses.map((u, i) => <option key={u.buildingId} value={u.buildingId}>Université {i + 1} · niveau {u.level}</option>)}</select></label>
      <p>{campus.centres - campus.occupiedCentres}/{campus.centres} centres libres · {campus.mobilizedWorkers}/{campus.workerCapacity} habitants mobilisés</p>
      <label>Plafond simultané du programme <input type="range" min="1" max="15" value={workers} onChange={e => setWorkers(Number(e.target.value))} /> {workers}</label>
    </div>}
    <div className="knowledge-tree">{(['mathematics', 'geography', 'astronomy'] as const).filter(d => science.programs.some(p => p.discipline === d)).map(d => <div className="knowledge-branch" key={d}><h3>{names[d]}</h3>
      {science.programs.filter(p => p.discipline === d).map(p => {
        const active = science.activities.filter(a => a.programCode === p.code);
        const displayedWork = Math.min(p.workRequiredMs, p.workDoneMs + active.reduce((n, a) => n + Math.max(0, Math.min(serverNow, Date.parse(a.completesAt)) - Date.parse(a.startedAt)) * a.workerCount, 0));
        const sources = (dependencies[p.code] ?? []).map(code => science.programs.find(other => other.code === code)).filter(Boolean);
        return <article key={p.code} className={`knowledge-node ${p.status}`}>
          <small>{names[d]} {p.level} · {statuses[p.status]}</small><h4>{p.title}</h4>
          <p>{p.status === 'acquired' && p.code === 'astronomy-1' ? 'Le modèle du monde annulaire est établi. Tu peux dézoomer librement ; les terres inconnues restent à relever.' : p.description}</p>
          {sources.length > 0 && <p className="knowledge-prerequisites">← {sources.map(other => `${names[other!.discipline]} ${other!.level}`).join(' + ')}</p>}
          {!['available', 'blocked'].includes(p.status) && <><progress max={p.workRequiredMs} value={displayedWork} /><small>{Math.round(displayedWork / p.workRequiredMs * 100)} % du travail</small></>}
          {p.needs.map(need => <p className="science-evidence" key={need}>{need}</p>)}
          {p.spontaneous && p.status !== 'acquired' && <p>Campagne suscitée par les témoignages des habitants.</p>}
          {!['acquired', 'blocked'].includes(p.status) && !(p.spontaneous && p.status === 'available') && campus && <button type="button" disabled={pending} onClick={() => onCommand({ action: 'research', buildingId: campus.buildingId, programCode: p.code, workerCount: workers })}>{p.status === 'available' ? 'Démarrer le programme' : 'Affecter / ajuster cette Université'}</button>}
          {!['available', 'blocked', 'acquired'].includes(p.status) && <button type="button" disabled={pending} onClick={() => onCommand({ action: p.status === 'paused' ? 'resume' : 'pause', programCode: p.code })}>{p.status === 'paused' ? 'Reprendre' : 'Pause après les lots engagés'}</button>}
        </article>;
      })}
    </div>)}</div>
    {science.levels.geography >= 1 && <section className="science-expeditions"><h3>Cartographes et relevés</h3>
      <p>{science.cartographers} cartographe(s) formé(s) · {science.surveyedPlaces} lieux relevés</p>
      <button type="button" onClick={() => {setX(target.cellX);setY(target.cellY);}}>Utiliser le lieu sélectionné · {target.cellX}, {target.cellY}</button>
      {campus && <button type="button" disabled={pending || campus.occupiedCentres >= campus.centres} onClick={() => onCommand({ action: 'train', buildingId: campus.buildingId })}>Former un cartographe · 10 min</button>}
      <div className="science-target"><label>Case X <input type="number" min="0" value={x} onChange={e => setX(Math.max(0, Math.floor(Number(e.target.value))))} /></label><label>Case Y <input type="number" min="0" value={y} onChange={e => setY(Math.max(0, Math.floor(Number(e.target.value))))} /></label><label>Budget total (min) <input type="number" min="1" max="1440" value={budget} onChange={e => setBudget(Math.max(1, Math.min(1440, Number(e.target.value))))} /></label></div>
      <button type="button" disabled={pending || !science.cartographers} onClick={() => onCommand({ action: 'survey', target: { cellX: x, cellY: y }, budgetSeconds: Math.round(budget * 60) })}>Relever un lieu repéré</button>
      {science.levels.geography >= 2 && <button type="button" disabled={pending || !science.cartographers} onClick={() => onCommand({ action: 'explore', target: { cellX: x, cellY: y }, budgetSeconds: Math.round(budget * 60) })}>Reconnaître vers cet objectif</button>}
      <p>60 s de relevé, 1 s par case de trajet. Le budget réserve le retour ; les rapports arrivent avec le cartographe.</p>
      {science.activities.filter(a => ['survey', 'exploration', 'training'].includes(a.kind)).map(a => <p key={a.id}>{a.kind === 'training' ? 'Formation' : 'Expédition'} · {Math.max(0, Math.ceil((Date.parse(a.completesAt) - serverNow) / 1000))} s restantes {a.kind !== 'training' && a.villageId === villageId && <button disabled={pending} type="button" onClick={() => onCommand({ action: 'recall', activityId: a.id })}>Rappeler</button>}</p>)}
    </section>}
    {science.solarObservations.since && <p className="science-solar">Observations du ciel : {science.solarObservations.complete ? 'campagne locale complète' : `enregistrement en cours · ${Math.max(0, Math.ceil((Date.parse(science.solarObservations.readyAt!) - serverNow) / 3600000))} h restantes`}. Aucun besoin de rester connecté.</p>}
    {science.villageReports.length > 0 && <section><h3>Implantations reconnues</h3>{science.villageReports.map(r => <p key={r.villageId}>{r.name} · {r.anchor.cellX}, {r.anchor.cellY} · rapport du {new Date(r.observedAt).toLocaleString('fr-FR')}</p>)}</section>}
  </section>;
}

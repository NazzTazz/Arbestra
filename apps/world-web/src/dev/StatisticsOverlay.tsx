import { useEffect, useState, useSyncExternalStore } from 'react';
import { DEV_TIMING_PHASES } from '@arbestra/contracts';
import { CLIENT_COSTS, REQUEST_KINDS, setStatisticsEnabled, statisticsEnabled, statisticsSnapshot, subscribeStatistics, type RequestKind } from './statistics';

const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const ms = (value: number | null) => value === null ? '—' : numberFormat.format(value);
export function StatisticsOverlay() {
  const enabled = useSyncExternalStore(subscribeStatistics, statisticsEnabled, () => false);
  return enabled ? <ActiveOverlay/> : null;
}
function ActiveOverlay() {
  const [data, setData] = useState(statisticsSnapshot), [kind, setKind] = useState<RequestKind | 'scene'>('village');
  const [sample, setSample] = useState<'first' | 'latest'>('latest');
  useEffect(() => { const timer = window.setInterval(() => setData(statisticsSnapshot()), 500); return () => clearInterval(timer); }, []);
  const row = kind === 'scene' ? undefined : data.requests.get(kind)?.[sample];
  return <aside className="dev-statistics-overlay" aria-label="Statistiques de performance">
    <header><strong>STATISTIQUES · DEV · ms</strong><button type="button" aria-label="Masquer les statistiques" onClick={() => setStatisticsEnabled(false)}>Masquer</button></header>
    <div className="dev-statistics-selectors">
      <select aria-label="Requête mesurée" value={kind} onChange={e => setKind(e.target.value as RequestKind | 'scene')}>
        <option value="scene">Scène / FPS uniquement</option>
        {Object.entries(REQUEST_KINDS).map(([value, label]) => <option key={value} value={value}>{label}{data.requests.has(value as RequestKind) ? ' •' : ''}</option>)}
      </select>
      {kind !== 'scene' && <select aria-label="Échantillon mesuré" value={sample} onChange={e => setSample(e.target.value as 'first' | 'latest')}>
        <option value="latest">Dernière requête lancée</option><option value="first">Première depuis activation</option>
      </select>}
    </div>
    {kind === 'scene' ? null : !row ? <p>Aucune lecture {REQUEST_KINDS[kind].toLowerCase()} mesurée. Les prochaines lectures sont instrumentées. Rechargez pour mesurer l’entrée dans le village.</p> : <>
      <p>{timeFormat.format(row.at)} · {row.status === null ? 'Sans réponse HTTP' : `HTTP ${row.status}`} · {({pending:'En cours',headers:'Lecture du corps',complete:'Terminée',error:'Erreur / interruption'})[row.state]}</p>
      <dl>
        <div><dt>Client · total jusqu’au JSON</dt><dd>{ms(row.totalMs ?? (row.state === 'pending' || row.state === 'headers' ? performance.now() - row.started : null))}</dd></div>
        <div><dt>Attente des en-têtes (serveur inclus)</dt><dd>{ms(row.waitMs)}</dd></div>
        <div><dt>Lecture / décodage du corps</dt><dd>{ms(row.bodyMs)}</dd></div>
        <div><dt>Parsing JSON</dt><dd>{ms(row.parseMs)}</dd></div>
      </dl>
      {row.server.length ? <table><caption>Serveur : cumul / propre · appels</caption>
        <thead><tr><th scope="col">Étape</th><th scope="col">Cumul</th><th scope="col">Propre</th><th scope="col">n</th></tr></thead>
        <tbody>{row.server.map(m => <tr key={m.phase}><th scope="row">{DEV_TIMING_PHASES[m.phase]}</th><td>{ms(m.durationMs)}</td><td>{ms(m.selfMs)}</td><td>{m.count}</td></tr>)}</tbody>
      </table> : <p>Ventilation serveur {row.state === 'pending' ? 'en attente' : 'non reçue'}.</p>}
      {row.requestId && <p className="dev-statistics-reference">Requête {row.requestId}</p>}
    </>}
    <strong>CLIENT · dernière / maximum depuis activation</strong>
    <dl>{Object.entries(CLIENT_COSTS).map(([key,label]) => { const cost = data.clientCosts.get(key as keyof typeof CLIENT_COSTS); return <div key={key}><dt>{label}{cost ? ` · ${timeFormat.format(cost.at)}` : ''}</dt><dd>{ms(cost?.lastMs ?? null)} / {ms(cost?.maxMs ?? null)}</dd></div>; })}</dl>
    <strong>SCÈNE · images achevées sur les 2 dernières secondes</strong>
    <dl><div><dt>Cadence · {data.frame.count} images observées</dt><dd>{ms(data.frame.fps)} FPS</dd></div>
      <div><dt>Mise à jour de l’image · moyenne</dt><dd>{ms(data.frame.updateMs)}</dd></div>
      <div><dt>Soumission du rendu CPU · moyenne</dt><dd>{ms(data.frame.renderMs)}</dd></div>
      <div><dt>Callback complet · moyenne / maximum</dt><dd>{ms(data.frame.totalMs)} / {ms(data.frame.maxMs)}</dd></div></dl>
    {data.frame.phases.length > 0 && <table><caption>Ventilation par image · même fenêtre · ms</caption>
      <thead><tr><th scope="col">Étape</th><th scope="col">Moyenne</th><th scope="col">Maximum</th></tr></thead>
      <tbody>{data.frame.phases.map(p => <tr key={p.phase}><th scope="row">{p.label}</th><td>{ms(p.meanMs)}</td><td>{ms(p.maxMs)}</td></tr>)}</tbody>
    </table>}
    <table><caption>BABYLON · {data.rendering.scene === 'world' ? 'Monde' : 'Village / région'} · {data.rendering.count} images</caption>
      <thead><tr><th scope="col">Compteur</th><th scope="col">Moyenne</th><th scope="col">Maximum</th></tr></thead>
      <tbody>{data.rendering.metrics.map(m => <tr key={m.key}><th scope="row">{m.label} · {m.unit}</th><td>{ms(m.mean)}</td><td>{ms(m.max)}</td></tr>)}</tbody>
    </table>
    <dl><div><dt>GPU moteur · {data.rendering.gpu.count} échantillons · moyenne / maximum</dt>
      <dd>{data.rendering.gpu.supported === false ? 'Non disponible' : `${ms(data.rendering.gpu.meanMs)} / ${ms(data.rendering.gpu.maxMs)} ms`}</dd></div></dl>
    <p>Les compteurs Babylon détaillent le rendu et peuvent se chevaucher : ne pas les additionner. Le GPU est mesuré séparément, avec un retour asynchrone ; il inclut toutes les scènes du moteur. Une mesure absente n’est pas zéro.</p>
    <p>Les étapes d’image se partagent le callback, sans chevauchement. Une étape non exécutée compte pour zéro dans la moyenne ; les maxima peuvent appartenir à des images différentes. Les callbacks SSE / React entre deux images sont hors de cette ventilation.</p>
    <p>Cumul inclut les sous-étapes ; propre les exclut. Durées murales, parfois parallèles : ne pas additionner les lignes. SQL inclut file du driver, réseau et attentes PostgreSQL. Les acquisitions de verrous incluent le trajet SQL, pas seulement l’attente du verrou.</p>
    <p>Mesures client indépendantes de la requête sélectionnée. Envoi serveur après les en-têtes et commit React non isolés. « — » = aucune mesure.</p>
  </aside>;
}

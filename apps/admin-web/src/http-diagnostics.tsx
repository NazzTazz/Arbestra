import { useState, type FormEvent } from 'react';
import type { AdminRuntimeSnapshot, HttpDiagnosticsMetadata, HttpRequestDetail, HttpRequestObservation, HttpRequestsPage, OperationalEvent } from '@arbestra/contracts';
import { ApiError, errorMessage } from './api';
import { Badge, Chart, DataState, Empty, KeyValues, Panel, Timestamp } from './components';
import { absoluteTime, duration, milliseconds, number, shortId } from './format';
import { useDiagnostics } from './http-data';
import { boundedHttpPeriod, frozenQuery, httpApiPath, httpDetailLink, httpListLink, isFrozen, nextPageLink, previousPageLink, recentLink, safeReturnLink } from './http-navigation';

const reasonLabels = { slow: 'Lente', server_error: 'Erreur serveur', aborted: 'Interrompue' };
const explanations: Record<string, string> = {
  INTERNAL_ERROR: 'Erreur interne non classée. Sa cause technique n’est pas établie par cette observation.',
  ADMIN_BUSY: 'La capacité de lecture de la console était occupée.',
  ADMIN_DATA_UNAVAILABLE: 'La lecture diagnostique était indisponible. Le temps SQL, l’attente du pool et la cause technique ne sont pas connus.',
  VALIDATION_ERROR: 'La requête ne satisfaisait pas le contrat attendu.',
  HTTP_SERVER_RESPONSE: 'Une réponse serveur en erreur a été observée sans annotation plus précise.',
  CONNECTION_INTERRUPTED: 'La connexion s’est fermée avant la fin observée de la réponse. L’origine de cette fermeture n’est pas établie.',
};
export const readableLatency = (value: number) => value >= 1_000 ? `${number(value / 1_000, 2)} s` : milliseconds(value);

function HttpHeading({ detail, back }: { detail?: boolean; back?: string }) {
  return <div className="page-heading"><div><a className="back-link" href={back ?? '#/infrastructure'}>← {detail ? 'Observations conservées' : 'Infrastructure'}</a><h1>{detail ? 'Diagnostic de la requête' : 'Diagnostic HTTP'}</h1><p>Faits observés sur une instance · aucune attribution automatique de cause</p></div><span className="read-only">◈ Lecture seule</span></div>;
}
export function StatusReasons({ runtime }: { runtime: AdminRuntimeSnapshot }) {
  const [acknowledgedInstance, acknowledgeInstance] = useState(runtime.instanceId);
  if (!runtime.statusReasons) return <p className="scope-note">Les raisons actives ne sont pas disponibles dans la réponse de cette instance.</p>;
  return <>{acknowledgedInstance !== runtime.instanceId && <div className="form-error" role="alert">L’instance répondante a changé. Les mesures ci-dessous appartiennent à la nouvelle instance ; l’historique précédent n’est pas fusionné. <button className="text-button" onClick={() => acknowledgeInstance(runtime.instanceId)}>Prendre acte</button></div>}
    <details className="status-reasons"><summary><Badge status={runtime.status} /><span>Pourquoi cet état ?</span><small>{runtime.statusReasons.length} raison{runtime.statusReasons.length > 1 ? 's' : ''} active{runtime.statusReasons.length > 1 ? 's' : ''}</small></summary>
    <div className="status-reasons-body"><p className="scope-note">Raisons calculées avec le badge, pour l’instance {shortId(runtime.instanceId)}. Les incidents historiques ne sont pas nécessairement encore actifs.</p>
      {runtime.statusReasons.length ? runtime.statusReasons.map((reason, index) => <article className="status-reason" key={`${reason.code}:${reason.workerId}:${index}`}><Badge status={reason.status} /><div><strong>{reason.code}</strong><p>{reason.message}</p><small>Source : {reason.source} · {reason.workerId ?? 'instance courante'}{reason.count !== null ? ` · ${number(reason.count)} observation(s)` : ''}</small>{reason.from && reason.to && <small>Période : {absoluteTime(reason.from)} → {absoluteTime(reason.to)}</small>}
        {reason.source === 'http' && reason.from && reason.to && <a href={httpListLink({ instanceId: runtime.instanceId, reason: 'server_error', from: reason.from, to: reason.to })}>Consulter les erreurs retenues ↗</a>}
        {reason.source === 'database' && <><small>Durée de la sonde : {milliseconds(runtime.database.latencyMs)} · seuil de dégradation : 500 ms</small><a href="#/infrastructure?section=database">Consulter la sonde actuelle ↗</a></>}
        {reason.workerId && <a href="#/infrastructure?section=workers">Consulter les workers ↗</a>}
      </div><Timestamp value={reason.observedAt} /></article>) : <Empty>Aucune raison de dégradation ou de couverture inconnue dans ce snapshot.</Empty>}
    </div>
  </details></>;
}
export function HttpLatencyChart({ runtime, color = 'mint' }: { runtime: AdminRuntimeSnapshot; color?: 'mint' | 'amber' }) {
  const points = runtime.series.map(sample => {
    const period = boundedHttpPeriod(sample.from, sample.to);
    return {
      time: sample.to, value: sample.p95Ms,
      ...(period ? { link: httpListLink({ instanceId: runtime.instanceId, from: period.from, to: period.to }) } : {}),
      context: `${absoluteTime(sample.from)} → ${absoluteTime(sample.to)} · ${duration(Math.max(0, Date.parse(sample.to) - Date.parse(sample.from)))} · ${number(sample.responses)} réponses · ${number(sample.sampledResponses)} durées${sample.truncated ? ' · échantillon tronqué' : ''} · ${number(sample.aborted)} interruptions${period?.clamped ? ' · consultation limitée aux 10 dernières minutes de cette période' : ''}`,
    };
  });
  return <Chart title="Latence HTTP p95" unit="ms" color={color} points={points} note="p95 par période réellement observée, sur les réponses terminées. Avec peu de réponses, il peut correspondre à la plus lente. Les interruptions sont exclues. Les liens ouvrent uniquement les observations retenues, pas toutes les réponses." />;
}
export function HttpEvents({ events, empty = 'Aucun événement corrélé encore conservé.', returnTo }: { events: OperationalEvent[]; empty?: string; returnTo?: string }) {
  return events.length ? <div className="event-list">{events.map(event => <article key={event.id} className={`event event-${event.severity}`}><span className="event-marker" aria-hidden="true" /><div><strong>{event.code}</strong><p>{event.message}</p>{event.httpRequest && <a href={httpDetailLink(event.httpRequest.instanceId, event.httpRequest.requestId, returnTo)}>Requête {shortId(event.httpRequest.requestId)} ↗</a>}</div><Timestamp value={event.at} /></article>)}</div> : <Empty>{empty}</Empty>;
}
function Coverage({ metadata }: { metadata: HttpDiagnosticsMetadata }) {
  return <details className="http-coverage"><summary><span>{number(metadata.retained)} / {number(metadata.capacity)} observations conservées</span><span>Rétention maximale : {duration(metadata.retentionMs)}</span><span>{metadata.evicted + metadata.expired + metadata.collectionFailures > 0 ? 'Couverture limitée' : 'Consulter les limites de couverture'}</span>{metadata.logs.dropped > 0 && <span className="warning-text">{number(metadata.logs.dropped)} lignes de journal non émises</span>}</summary><div>
    <KeyValues items={[["Instance", <code>{metadata.instanceId}</code>], ["Démarrage", <Timestamp value={metadata.startedAt} />], ["Observation serveur", <Timestamp value={metadata.observedAt} />], ["Plus ancienne fiche conservée", <Timestamp value={metadata.oldestRetainedAt} />], ["Seuil lent actuel", readableLatency(metadata.slowThresholdMs)], ["Évictions par capacité", number(metadata.evicted)], ["Expirations", number(metadata.expired)], ["Échecs de collecte", number(metadata.collectionFailures)], ["Journal diagnostique", metadata.logs.mode === 'off' ? 'Désactivé · les observations mémoire restent collectées' : 'Anomalies'], ["Lignes émises / perdues", `${number(metadata.logs.emitted)} / ${number(metadata.logs.dropped)}`], ["Pertes : débit / capacité / transport", `${number(metadata.logs.droppedRateLimit)} / ${number(metadata.logs.droppedCapacity)} / ${number(metadata.logs.droppedTransport)}`], ["File de journalisation", `${number(metadata.logs.queuedLines)} lignes · ${number(metadata.logs.queuedBytes)} octets`]]} />
    <p className="panel-note">Compteurs depuis le démarrage. Une fenêtre demandée ne garantit pas un historique complet : expiration et éviction continuent pendant la consultation. Aucun fichier de journal n’est lu par la console.</p>
  </div></details>;
}
function DiagnosticFailure({ error, query }: { error: Error | null; query: URLSearchParams }) {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 'INSTANCE_MISMATCH') {
    const next = new URLSearchParams(recentLink(query, true).split('?')[1]);
    if (error.instanceId) next.set('instanceId', error.instanceId);
    return <div className="form-error" role="alert"><strong>L’instance a changé.</strong><p>Les anciennes références et les nouvelles observations ne sont pas fusionnées. Les données précédentes restent datées.</p><a href={`#/infrastructure/http?${next}`}>Ouvrir explicitement l’instance actuelle ↗</a>{error.instanceId && <small className="diagnostic-instance">{error.instanceId}</small>}</div>;
  }
  if (error.code === 'HTTP_OBSERVATION_NOT_RETAINED') return <div className="form-error" role="alert"><strong>Observation non conservée.</strong><p>Cette référence n’est plus dans le tampon de l’instance, ou n’y a jamais été enregistrée. La cause de son absence n’est pas connue.</p><a href={recentLink(query)}>Revenir aux observations récentes ↗</a></div>;
  return null;
}
function Filters({ query, threshold, observedInstanceId }: { query: URLSearchParams; threshold: number | null; observedInstanceId: string | undefined }) {
  const [windowMinutes, setWindow] = useState(query.get('window') ?? '10');
  const [reason, setReason] = useState(query.get('reason') ?? ''), [method, setMethod] = useState(query.get('method') ?? '');
  const [route, setRoute] = useState(query.get('route') ?? ''), [scope, setScope] = useState(query.get('scope') ?? '');
  const [requestId, setRequestId] = useState(query.get('requestId') ?? ''), [minimum, setMinimum] = useState(query.get('minDurationMs') ?? '');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    window.location.hash = httpListLink({ window: windowMinutes, reason, method, route: route.trim(), scope, requestId: requestId.trim(), minDurationMs: minimum, instanceId: observedInstanceId ?? query.get('instanceId') ?? undefined });
  }
  const durations = [...new Set([...(threshold === null ? [] : [threshold]), 5_000, 10_000])].sort((a, b) => a - b);
  if (minimum && !durations.includes(Number(minimum))) durations.push(Number(minimum));
  return <form className="http-filters" onSubmit={submit}>
    <label>Fenêtre récente<select value={windowMinutes} onChange={event => setWindow(event.target.value)}><option value="1">Dernière minute</option><option value="5">5 dernières minutes</option><option value="10">10 dernières minutes</option></select></label>
    <label>Motif<select value={reason} onChange={event => setReason(event.target.value)}><option value="">Tous les motifs</option><option value="server_error">Erreur serveur</option><option value="slow">Lente</option><option value="aborted">Interrompue</option></select></label>
    <label>Méthode<select value={method} onChange={event => setMethod(event.target.value)}><option value="">Toutes les méthodes</option>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE', 'OTHER'].map(value => <option key={value}>{value}</option>)}</select></label>
    <label>Périmètre<select value={scope} onChange={event => setScope(event.target.value)}><option value="">API et Console</option><option value="api">API</option><option value="console">Console</option></select></label>
    <label>Durée minimale<select value={minimum} onChange={event => setMinimum(event.target.value)}><option value="">Toutes les durées retenues</option>{durations.map(value => <option key={value} value={value}>{readableLatency(value)}{value === threshold ? ' · seuil actif' : ''}</option>)}</select></label>
    <label className="wide-filter">Route modèle exacte<input value={route} maxLength={256} placeholder="/api/worlds/:worldSlug/…" onChange={event => setRoute(event.target.value)} /></label>
    <label className="wide-filter">Référence de requête exacte<input value={requestId} maxLength={36} placeholder="UUID serveur" onChange={event => setRequestId(event.target.value)} /></label>
    <button type="submit" className="button primary">Appliquer les filtres</button>
  </form>;
}
function Outcome({ observation }: { observation: HttpRequestObservation }) {
  return observation.outcome === 'aborted' ? <span className="warning-text">Interrompue<small>Statut final non observé</small></span> : <span className={observation.statusCode !== null && observation.statusCode >= 500 ? 'warning-text' : ''}>HTTP {observation.statusCode}</span>;
}
function ReasonTags({ reasons }: { reasons: HttpRequestObservation['reasons'] }) {
  return <span className="reason-tags">{reasons.map(reason => <span className={`reason-tag reason-${reason}`} key={reason}>{reasonLabels[reason]}</span>)}</span>;
}
export function HttpRequestsPageView({ queryString }: { queryString: string }) {
  const query = new URLSearchParams(queryString), frozen = isFrozen(query);
  const resource = useDiagnostics<HttpRequestsPage>(queryString, () => httpApiPath(query), !frozen);
  const data = resource.data;
  const window = data ? { instanceId: data.metadata.instanceId, from: data.from, to: data.to, snapshotSequence: data.snapshotSequence } : null;
  const returnTo = window ? `#/infrastructure/http?${frozenQuery(query, window)}` : httpListLink();
  const previous = previousPageLink(query);
  return <><HttpHeading /><p className="scope-note">Requêtes terminées lentes, erreurs serveur et interruptions seulement. Les SSE et l’inventaire détaillé des requêtes en cours sont exclus. Ces fiches ne permettent pas de recalculer les percentiles de tout le trafic.</p>
    <DiagnosticFailure error={resource.error} query={query} />
    <DataState {...resource} error={resource.error ? errorMessage(resource.error) : null} frozen={frozen} />
    <Panel title="Filtrer les observations conservées" subtitle="Filtres combinés par ET · appliquer ouvre une nouvelle fenêtre"><Filters query={query} threshold={data?.metadata.slowThresholdMs ?? null} observedInstanceId={data?.metadata.instanceId} /></Panel>
    {frozen && <div className="frozen-banner"><span>Fenêtre figée volontairement · actualisation automatique suspendue.</span><a href={recentLink(query)}>Revenir aux observations récentes ↗</a></div>}
    {data && <><div className="context-bar"><span>Fenêtre consultée : <Timestamp value={data.from} /> → <Timestamp value={data.to} /></span><span>Instance <code>{shortId(data.metadata.instanceId)}</code></span><span>{data.items.length} observations sur cette page</span></div>
      <Coverage metadata={data.metadata} />
      <Panel title="Observations conservées" subtitle="Une requête avec plusieurs motifs reste une seule ligne">
        {data.items.length ? <div className="table-scroll"><table><thead><tr><th>Fin observée</th><th>Méthode / route modèle</th><th>Durée</th><th>Résultat</th><th>Motifs</th><th>Référence</th></tr></thead><tbody>{data.items.map(observation => <tr key={`${observation.instanceId}:${observation.requestId}`}>
          <td><Timestamp value={observation.endedAt} /></td><td><a className="table-primary http-route" href={httpDetailLink(observation.instanceId, observation.requestId, returnTo)}><b>{observation.method}</b> <code>{observation.route}</code></a><small>{observation.scope === 'console' ? 'Console' : 'API'} · {observation.safeCode ?? 'Code non capturé'}</small></td>
          <td className="numeric">{readableLatency(observation.durationMs)}</td><td><Outcome observation={observation} /></td><td><ReasonTags reasons={observation.reasons} /></td><td><a href={httpDetailLink(observation.instanceId, observation.requestId, returnTo)}><code>{shortId(observation.requestId)}</code> ↗</a></td>
        </tr>)}</tbody></table></div> : <Empty>Aucune observation conservée pour ces filtres. Cela n’établit pas l’absence historique d’incident.</Empty>}
        <div className="http-pagination">{previous ? <a href={previous}>← Page précédente</a> : <span />}{data.nextBeforeSequence !== null && window ? <a href={nextPageLink(query, window, data.nextBeforeSequence)}>Observations plus anciennes →</a> : <span>Fin des observations disponibles dans cette fenêtre</span>}</div>
      </Panel></>}
  </>;
}
export function HttpRequestDetailView({ requestId, instanceId, returnTo }: { requestId: string; instanceId: string; returnTo: string | null }) {
  const query = new URLSearchParams({ instanceId });
  const resource = useDiagnostics<HttpRequestDetail>(`${instanceId}:${requestId}`, () => `/api/admin/http-requests/${encodeURIComponent(requestId)}?instanceId=${encodeURIComponent(instanceId)}`, true);
  const data = resource.data, observation = data?.observation;
  const [copied, setCopied] = useState<string | null>(null);
  async function copy() {
    try { await navigator.clipboard.writeText(`${instanceId}/${requestId}`); setCopied('Référence copiée.'); }
    catch { setCopied('Copie indisponible. Sélectionnez la référence affichée.'); }
  }
  return <><HttpHeading detail back={safeReturnLink(returnTo)} /><DiagnosticFailure error={resource.error} query={query} /><DataState {...resource} error={resource.error ? errorMessage(resource.error) : null} />
    <div className="reference-bar"><div><span className="eyebrow">Référence de corrélation</span><code>{instanceId}/{requestId}</code></div><button className="button" onClick={() => void copy()}>Copier la référence</button>{copied && <span role="status">{copied}</span>}</div>
    {data && observation && <><Panel title={`${observation.method} ${observation.route}`} subtitle={observation.scope === 'console' ? 'Requête Console' : 'Requête API'} action={<ReasonTags reasons={observation.reasons} />}>
      <KeyValues items={[["Résultat", <Outcome observation={observation} />], ["Début serveur", <Timestamp value={observation.startedAt} />], ["Fin observée serveur", <Timestamp value={observation.endedAt} />], ["Durée monotone", <span title={`${observation.durationMs} ms`}>{readableLatency(observation.durationMs)} · {number(observation.durationMs, 3)} ms</span>], ["Seuil lent appliqué", readableLatency(observation.slowThresholdMs)], ["Code sûr", observation.safeCode ?? 'Non capturé'], ["Catégorie", observation.errorCategory ?? 'Aucune catégorie d’erreur capturée'], ["Point de capture", <code>{observation.captureSite}</code>], ["Séquence de finalisation", number(observation.sequence)]]} />
      <p className="panel-note">{observation.safeCode ? explanations[observation.safeCode] ?? 'Aucune explication contrôlée disponible.' : 'Aucun code d’erreur capturé.'} La durée inclut les attentes côté serveur ; elle ne mesure pas la réception ni l’affichage navigateur. Les temps SQL, pool et verrou ne sont pas instrumentés dans cette fiche. Aucun rattachement métier n’est déduit de l’URL.</p>
    </Panel>
    <Panel title="Événements explicitement corrélés" subtitle="Même instance et même référence HTTP"><HttpEvents events={data.events} returnTo={safeReturnLink(returnTo)} /></Panel>
    <div className="context-bar"><a href={`#/infrastructure?eventsFrom=${encodeURIComponent(observation.startedAt)}&eventsTo=${encodeURIComponent(observation.endedAt)}&instanceId=${encodeURIComponent(instanceId)}`}>Autres événements de cette période ↗</a><span>Le voisinage temporel n’établit aucun lien causal.</span></div>
    <Coverage metadata={data.metadata} /></>}
  </>;
}

import { useEffect, useState, type ReactNode } from 'react';
import type {
  AdminAccountDetail, AdminAccounts, AdminActivities, AdminActivity, AdminActivityDetail,
  AdminDiagnostic, AdminOverview, AdminRuntimeSnapshot, AdminVillage, AdminVillageDetail,
  AdminWorldDetail, AdminWorlds,
} from '@arbestra/contracts';
import { useResource } from './api';
import { Badge, Chart, DataState, Empty, KeyValues, Metric, Panel, Search, Timestamp } from './components';
import { bytes, duration, matches, milliseconds, number, shortId } from './format';
import { HttpLatencyChart, StatusReasons } from './http-diagnostics';
import { httpDetailLink, httpListLink } from './http-navigation';

export const worldLink = (id: string) => `#/worlds/${encodeURIComponent(id)}`;
export const villageLink = (village: Pick<AdminVillage, 'id' | 'worldId'>) => `#/villages/${encodeURIComponent(village.id)}?worldId=${encodeURIComponent(village.worldId)}`;
export const accountLink = (id: string) => `#/accounts/${encodeURIComponent(id)}`;
export const activityLink = (activity: AdminActivity) => `#/activities/${encodeURIComponent(activity.id)}?worldId=${encodeURIComponent(activity.worldId)}&kind=${activity.kind}${activity.villageId ? `&villageId=${encodeURIComponent(activity.villageId)}` : ''}`;
const activityNames = { expedition: 'Expédition', science: 'Science', task: 'Tâche planifiée' };

function PageHeading({ title, description, back }: { title: string; description: string; back?: { href: string; label: string } }) {
  return <div className="page-heading"><div>{back && <a className="back-link" href={back.href}>← {back.label}</a>}<h1>{title}</h1><p>{description}</p></div><span className="read-only"><span aria-hidden="true">◈</span> Lecture seule</span></div>;
}
function LimitNote({ truncated, count }: { truncated: boolean; count: number }) {
  return <p className={truncated ? 'limit-note warning-text' : 'limit-note'}>{number(count)} résultat{count > 1 ? 's' : ''}{truncated ? ' · Liste limitée. Affinez la recherche ou le périmètre.' : ' affiché' + (count > 1 ? 's' : '')}.</p>;
}
function Diagnostics({ items }: { items: AdminDiagnostic[] }) {
  return <div className="diagnostics">{items.length ? items.map(item => <article key={item.code} className={`diagnostic diagnostic-${item.status}`}><span aria-hidden="true">{item.status === 'attention' ? '!' : item.status === 'ok' ? '✓' : '?'}</span><div><strong>{item.code}</strong><p>{item.message}</p></div></article>) : <Empty>Aucun diagnostic disponible.</Empty>}</div>;
}
function Activities({ items, title = 'Activité récente', action, note }: { items: AdminActivity[]; title?: string; action?: ReactNode; note?: string }) {
  const [query, setQuery] = useState('');
  const filtered = items.filter(item => matches(query, item.label, item.id, item.status, item.kind, item.worldId, item.villageId));
  return <Panel title={title} subtitle={note ?? 'Événements persistés · ne mesure pas la présence des joueurs'} action={action}>
    <div className="table-toolbar"><Search value={query} onChange={setQuery} label="Filtrer l’activité affichée" placeholder="Type, identifiant, statut…" /><span className="muted">{filtered.length} / {items.length}</span></div>
    {filtered.length ? <div className="table-scroll"><table><thead><tr><th>Activité</th><th>État</th><th>Début</th><th>Échéance</th><th>Tentatives</th><th><span className="sr-only">Détail</span></th></tr></thead><tbody>{filtered.map(item => <tr key={`${item.kind}:${item.id}`}>
      <td><a className="table-primary" href={activityLink(item)}>{item.label}</a><small>{activityNames[item.kind]} · <code title={item.id}>{shortId(item.id)}</code></small></td><td><Badge status={item.status} />{item.receiptStatus && <small>Reçu : {item.receiptStatus}</small>}{item.errorCode && <small className="warning-text">{item.errorCode}</small>}</td><td><Timestamp value={item.startedAt} /></td><td><Timestamp value={item.dueAt} /></td><td className="numeric">{number(item.attempts)}</td><td><a className="row-link" href={activityLink(item)} aria-label={`Diagnostiquer ${item.label}`}>↗</a></td>
    </tr>)}</tbody></table></div> : <Empty>{query ? 'Aucune activité ne correspond au filtre.' : 'Aucune activité dans le périmètre observé.'}</Empty>}
  </Panel>;
}
function Villages({ items, truncated }: { items: AdminVillage[]; truncated: boolean }) {
  const [query, setQuery] = useState('');
  const filtered = items.filter(item => matches(query, item.name, item.id, item.worldSlug, item.ownerAccountId));
  return <Panel title="Villages" subtitle="Implantations persistantes et comptes propriétaires">
    <div className="table-toolbar"><Search value={query} onChange={setQuery} label="Filtrer les villages" placeholder="Village, monde, identifiant…" /></div>
    {filtered.length ? <div className="table-scroll"><table><thead><tr><th>Village</th><th>Monde</th><th>Propriétaire</th><th>Position</th><th>Création</th></tr></thead><tbody>{filtered.map(village => <tr key={village.id}><td><a className="table-primary" href={villageLink(village)}>{village.name}</a><small><code title={village.id}>{shortId(village.id)}</code></small></td><td><a href={worldLink(village.worldId)}>{village.worldSlug}</a></td><td><a href={accountLink(village.ownerAccountId)}><code>{shortId(village.ownerAccountId)}</code></a></td><td className="numeric">{village.anchorCellX}, {village.anchorCellY}</td><td><Timestamp value={village.createdAt} /></td></tr>)}</tbody></table></div> : <Empty>Aucun village dans cette sélection.</Empty>}
    <LimitNote count={filtered.length} truncated={truncated} />
  </Panel>;
}
function ExpeditionMetrics({ summary }: { summary: AdminOverview['expeditions'] }) {
  return <Panel title="Expéditions" subtitle="Préparation, progression métier et issue des demandes">
    <div className="metrics four embedded">
      <Metric label="En préparation" value={number(summary.pending)} note="Total actuel des demandes en attente" />
      <Metric label="En cours" value={number(summary.active)} note="Total actuel des explorations et relevés" />
      <Metric label="Terminées" value={number(summary.completed)} note={`Parmi les ${number(summary.sampleSize)} reçus observés`} />
      <Metric label="En erreur" value={number(summary.failed)} note={`Parmi les ${number(summary.sampleSize)} reçus observés`} tone={summary.failed ? 'warning' : undefined} />
    </div>
    <p className="panel-note">{summary.note} Admissions : {number(summary.admitted)} · refus : {number(summary.rejected)}.{summary.truncated && ' Échantillon tronqué.'}</p>
  </Panel>;
}
function TaskMetrics({ tasks, expeditions }: Pick<AdminOverview, 'tasks' | 'expeditions'>) {
  return <>
    <div className="metrics three">
      <Metric label="Tâches en attente" value={number(tasks.pending)} note="Notifications planifiées persistées" />
      <Metric label="Échéances dépassées" value={number(tasks.due)} note={tasks.oldestDueAt ? <>Plus ancienne : <Timestamp value={tasks.oldestDueAt} /></> : 'Aucune échéance dépassée observée'} tone={tasks.due ? 'warning' : 'accent'} />
      <Metric label="Tâches en reprise" value={number(tasks.retrying)} note="Au moins une tentative" />
    </div>
    <p className="scope-note">Les tâches sont des notifications ; leur retard ne prouve pas à lui seul un retard économique.</p>
    <ExpeditionMetrics summary={expeditions} />
  </>;
}
function Incidents({ runtime, queryString = '' }: { runtime: AdminRuntimeSnapshot; queryString?: string }) {
  const [level, setLevel] = useState('all');
  const params = new URLSearchParams(queryString), from = params.get('eventsFrom'), to = params.get('eventsTo');
  const instanceMismatch = params.has('instanceId') && params.get('instanceId') !== runtime.instanceId;
  const events = instanceMismatch ? [] : runtime.events.filter(event => (level === 'all' || event.severity === level)
    && (!from || Date.parse(event.at) >= Date.parse(from)) && (!to || Date.parse(event.at) <= Date.parse(to)));
  return <Panel id="noc-events" title="Journal opérationnel" subtitle="Événements bornés de cette instance depuis son démarrage" action={<select aria-label="Filtrer la gravité" value={level} onChange={event => setLevel(event.target.value)}><option value="all">Toutes les gravités</option><option value="error">Erreurs</option><option value="warning">Avertissements</option><option value="info">Informations</option></select>}>
    {(from || to) && <p className="panel-note">Autres événements de cette période : {from} → {to}. Le voisinage temporel ne prouve aucune cause. <a href="#/infrastructure">Retirer ce filtre</a></p>}
    {instanceMismatch && <p className="form-error" role="alert">L’instance demandée ne correspond plus à l’instance répondante. Aucun événement de la nouvelle instance n’est associé à l’ancienne référence. <a href="#/infrastructure">Consulter explicitement l’instance actuelle</a></p>}
    {events.length ? <div className="event-list">{events.map(event => <article key={event.id} className={`event event-${event.severity}`}><span className="event-marker" aria-hidden="true" /><div><strong>{event.code}</strong><p>{event.message}</p>{event.httpRequest && <a href={httpDetailLink(event.httpRequest.instanceId,event.httpRequest.requestId)}>Diagnostic HTTP {shortId(event.httpRequest.requestId)} ↗</a>}{event.worldId && <a href={worldLink(event.worldId)}>Monde {shortId(event.worldId)} ↗</a>}{event.villageId && event.worldId && <a href={villageLink({ id: event.villageId, worldId: event.worldId })}>Village {shortId(event.villageId)} ↗</a>}</div><Timestamp value={event.at} /></article>)}</div> : <Empty>Aucun événement conservé dans cette sélection. Ce journal ne couvre pas les autres instances.</Empty>}
  </Panel>;
}

export function OverviewPage() {
  const resource = useResource<AdminOverview>('/api/admin/overview');
  const infrastructure = useResource<AdminRuntimeSnapshot>('/api/admin/infrastructure');
  const data = resource.data, runtime = infrastructure.data;
  return <><PageHeading title="Vue d’ensemble" description="État des installations, signaux opérationnels et activité persistante." /><DataState {...resource} />
    {data ? <>
      <div className="metrics four"><Metric label="Mondes" value={number(data.counts.worlds)} note={`${number(data.counts.openWorlds)} ouverts aux inscriptions`} /><Metric label="Comptes inscrits" value={number(data.counts.accounts)} note="Tous les comptes persistés" /><Metric label="Villages" value={number(data.counts.villages)} note="Tous les mondes" /><Metric label="Observation métier" value={<span className="metric-time"><Timestamp value={data.observedAt} /></span>} note={`Rafraîchissement conseillé : ${data.refreshAfterSeconds} s`} /></div>
      <div className="section-title"><h2>Infrastructure observée</h2><a href="#/infrastructure">Ouvrir les métriques ↗</a></div><DataState {...infrastructure} />
      {runtime ? <><StatusReasons runtime={runtime} /><div className="service-strip"><div><span>Instance supervisée</span><strong>API</strong><code title={runtime.instanceId}>{shortId(runtime.instanceId)}</code></div><div><span>PostgreSQL</span><Badge status={runtime.database.status} /><small>{milliseconds(runtime.database.latencyMs)}</small></div><div><span>Connexions SSE</span><strong>{number(runtime.sse.connections)}</strong><small>{number(runtime.sse.accounts)} comptes distincts sur cette instance</small></div><div><span>Fenêtre HTTP</span><strong>{number(runtime.http.requests)} requêtes</strong><small>{duration(runtime.http.windowSeconds * 1_000)} · <a href={httpListLink({instanceId:runtime.instanceId,reason:'server_error',from:new Date(Date.parse(runtime.observedAt)-runtime.http.windowSeconds*1000).toISOString(),to:runtime.observedAt})}>{number(runtime.http.errors5xx)} erreurs 5xx ↗</a></small></div></div>
        <div className="grid two"><Panel title="Latence des requêtes" subtitle="p95 observé par période · instance répondante"><HttpLatencyChart runtime={runtime} /></Panel><Panel title="File de travail" subtitle="État courant de la base"><KeyValues items={[["Tâches en attente", number(data.tasks.pending)], ["Échéances dépassées", <span className={data.tasks.due ? 'warning-text' : ''}>{number(data.tasks.due)}</span>], ["Tâches en reprise", number(data.tasks.retrying)], ["Demandes d’expédition en préparation", number(data.expeditions.pending)], ["Plus ancienne échéance due", <Timestamp value={data.tasks.oldestDueAt} />]]} /></Panel></div></> : !infrastructure.loading && <Empty>Les métriques d’infrastructure ne sont pas disponibles.</Empty>}
      <ExpeditionMetrics summary={data.expeditions} />
      <Activities items={data.recentActivities} note={data.activityNote} action={<a href="#/activities">Explorer ↗</a>} />{runtime && <Incidents runtime={runtime} />}
    </> : !resource.loading && <Empty>La synthèse n’a pas pu être chargée. Utilisez Réessayer.</Empty>}
  </>;
}

export function InfrastructurePage({ queryString = '' }: { queryString?: string }) {
  const resource = useResource<AdminRuntimeSnapshot>('/api/admin/infrastructure');
  const data = resource.data;
  const params = new URLSearchParams(queryString), section = params.get('section') ?? (params.has('eventsFrom') ? 'events' : null);
  const ready = Boolean(data);
  useEffect(() => { if (ready && section) document.getElementById(`noc-${section}`)?.scrollIntoView({ block: 'start' }); }, [ready, section]);
  return <><PageHeading title="Infrastructure" description="Mesures du processus API répondant, de ses workers et de PostgreSQL." /><div className="http-entry"><a href={httpListLink(data ? {instanceId:data.instanceId} : {})}>Diagnostic HTTP · requêtes lentes, erreurs et interruptions ↗</a></div><DataState {...resource} />
    {data && <><StatusReasons runtime={data} /><div className="context-bar"><span>Instance <code>{data.instanceId}</code></span><span>Démarrée <Timestamp value={data.startedAt} /></span><span>Observation <Timestamp value={data.observedAt} /></span></div>
      <p className="scope-note">Périmètre : un processus API. Historique en mémoire, borné et réinitialisé au redémarrage. CPU et mémoire portent sur ce processus uniquement. HTTP inclut la console NOC et exclut les durées des flux SSE. Les connexions SSE ne sont pas un compteur de joueurs actifs.</p>
      <div className="metrics four"><Metric label="CPU processus" value={data.process.cpuPercent == null ? 'Inconnu' : `${number(data.process.cpuPercent, 1)} %`} note="100 % = un cœur · peut dépasser 100 %" /><Metric label="Mémoire résidente" value={bytes(data.process.rssBytes)} note={`Heap utilisé : ${bytes(data.process.heapUsedBytes)}`} /><Metric label="Latence HTTP p95" value={milliseconds(data.http.p95Ms)} note={`p50 ${milliseconds(data.http.p50Ms)} · p99 ${milliseconds(data.http.p99Ms)}`} /><Metric label="PostgreSQL" value={<Badge status={data.database.status} />} note={`Sonde : ${milliseconds(data.database.latencyMs)}`} /></div>
      <div className="grid three"><Chart title="CPU du processus" unit="%" points={data.series.map(sample => ({ time: sample.at, value: sample.cpuPercent }))} /><Chart title="Mémoire résidente" unit="Mio" color="blue" points={data.series.map(sample => ({ time: sample.at, value: sample.rssBytes / 1024 ** 2 }))} /><HttpLatencyChart runtime={data} color="amber" /></div>
      <div className="grid two"><Panel title="Trafic HTTP" subtitle={`Fenêtre glissante : ${duration(data.http.windowSeconds * 1_000)}`}><KeyValues items={[["Requêtes terminées ou interrompues", number(data.http.requests)], ["Réponses terminées", number(data.http.responses)], ["Interruptions", number(data.http.aborted)], ["Requêtes en cours", number(data.http.activeRequests)], ["Réponses 4xx", number(data.http.errors4xx)], ["Réponses 5xx", <a href={httpListLink({instanceId:data.instanceId,reason:'server_error',from:new Date(Date.parse(data.observedAt)-data.http.windowSeconds*1000).toISOString(),to:data.observedAt})}>{number(data.http.errors5xx)} · Diagnostiquer ↗</a>], ["Requêtes échantillonnées", number(data.http.sampledRequests)], ["Échantillon tronqué", data.http.truncated ? 'Oui · quantiles sur échantillon borné' : 'Non'], ["Retard event loop p95", milliseconds(data.process.eventLoopDelayP95Ms)], ["Durée de vie du processus", duration(data.process.uptimeSeconds * 1_000)]]} /></Panel>
      <Panel id="noc-database" title="Base de données" subtitle="Sonde et état de connexion observés"><KeyValues items={[["Disponibilité", <Badge status={data.database.status} />], ["Connexions PostgreSQL", number(data.database.connections)], ["Requêtes actives PostgreSQL", number(data.database.activeQueries)], ["Dernière observation", <Timestamp value={data.database.observedAt} />]]} /><p className="panel-note">{data.database.note}</p></Panel></div>
      <Panel id="noc-workers" title="Workers" subtitle="Derniers signaux effectivement observés par cette instance">{data.workers.length ? <div className="table-scroll"><table><thead><tr><th>Worker</th><th>État</th><th>Travaux actifs</th><th>Observation</th><th>Dernier succès</th><th>Dernière erreur</th></tr></thead><tbody>{data.workers.map(worker => <tr key={worker.id}><td><strong>{worker.label}</strong><small>{worker.note}</small></td><td><Badge status={worker.status} /></td><td className="numeric">{number(worker.active)}</td><td><Timestamp value={worker.lastObservedAt} /></td><td><Timestamp value={worker.lastSuccessAt} /></td><td><Timestamp value={worker.lastErrorAt} /></td></tr>)}</tbody></table></div> : <Empty>Aucun worker instrumenté communiqué.</Empty>}</Panel>
      <Panel title="Flux SSE" subtitle={data.sse.note}><div className="metrics three embedded"><Metric label="Connexions ouvertes" value={number(data.sse.connections)} /><Metric label="Comptes distincts connectés" value={number(data.sse.accounts)} note="Peuvent inclure des onglets inactifs" /><Metric label="Échecs de flux observés" value={number(data.sse.failures)} note={<>Dernier événement : <Timestamp value={data.sse.lastEventAt} /></>} /></div>{data.sse.worlds.length ? <div className="table-scroll"><table><thead><tr><th>Monde</th><th>Connexions</th><th>Comptes distincts</th></tr></thead><tbody>{data.sse.worlds.map(world => <tr key={world.worldId}><td><a href={worldLink(world.worldId)}><code>{world.worldId}</code></a></td><td>{number(world.connections)}</td><td>{number(world.accounts)}</td></tr>)}</tbody></table></div> : <Empty>Aucun flux SSE ouvert sur cette instance.</Empty>}</Panel>
      <Incidents runtime={data} queryString={queryString} />
    </>}
  </>;
}

export function WorldsPage() {
  const resource = useResource<AdminWorlds>('/api/admin/worlds', 30_000);
  const [query, setQuery] = useState(''), [status, setStatus] = useState('all');
  const data = resource.data, items = data?.items.filter(world => matches(query, world.name, world.slug, world.id) && (status === 'all' || world.isOpen === (status === 'open'))) ?? [];
  return <><PageHeading title="Mondes" description="Ouverture, génération et implantations de tous les mondes observés." /><DataState {...resource} />
    <Panel title="Installations" subtitle={data ? `Observation ${new Date(data.observedAt).toLocaleString('fr-FR')}` : 'Chargement des mondes'}><div className="table-toolbar"><Search value={query} onChange={setQuery} label="Filtrer les mondes" placeholder="Nom, slug ou identifiant…" /><select aria-label="Ouverture du monde" value={status} onChange={event => setStatus(event.target.value)}><option value="all">Tous les mondes</option><option value="open">Ouverts</option><option value="closed">Fermés</option></select></div>
    {items.length ? <div className="table-scroll"><table><thead><tr><th>Monde</th><th>Ouverture</th><th>Génération</th><th>Dimensions</th><th>Inscrits</th><th>Villages</th><th>Sciences actives</th><th /></tr></thead><tbody>{items.map(world => <tr key={world.id}><td><a className="table-primary" href={worldLink(world.id)}>{world.name}</a><small><code>{world.slug}</code></small></td><td><Badge status={world.isOpen ? 'open' : 'closed'} /></td><td><Badge status={world.generationStatus} /><small>Version {world.generationVersion}</small></td><td className="numeric">{world.widthCells} × {world.heightCells}</td><td className="numeric">{number(world.accounts)}</td><td className="numeric">{number(world.villages)}</td><td className="numeric">{number(world.activeScience)}</td><td><a className="row-link" href={worldLink(world.id)} aria-label={`Ouvrir ${world.name}`}>↗</a></td></tr>)}</tbody></table></div> : <Empty>{resource.loading ? 'Lecture des mondes…' : 'Aucun monde ne correspond à cette sélection.'}</Empty>}{data && <LimitNote count={items.length} truncated={data.truncated} />}</Panel>
  </>;
}

export function WorldPage({ id }: { id: string }) {
  const resource = useResource<AdminWorldDetail>(`/api/admin/worlds/${encodeURIComponent(id)}`);
  const data = resource.data;
  return <><PageHeading title={data?.world.name ?? 'Diagnostic du monde'} description={data ? `${data.world.slug} · ${data.world.id}` : 'Chargement du périmètre mondial.'} back={{ href: '#/worlds', label: 'Tous les mondes' }} /><DataState {...resource} />
    {data && <><div className="context-bar"><Badge status={data.world.isOpen ? 'open' : 'closed'} /><Badge status={data.world.generationStatus} /><span>Génération v{data.world.generationVersion}</span><span>{data.world.widthCells} × {data.world.heightCells} cases</span><span>Créé <Timestamp value={data.world.createdAt} /></span></div>
      <div className="metrics three"><Metric label="Comptes inscrits au monde" value={<a href={`#/accounts?worldId=${encodeURIComponent(id)}`}>{number(data.world.accounts)} ↗</a>} /><Metric label="Villages" value={number(data.world.villages)} /><Metric label="Activités scientifiques" value={number(data.world.activeScience)} note="État métier, pas présence humaine" /></div><TaskMetrics tasks={data.tasks} expeditions={data.expeditions} />
      <Panel title="Synchronisation" subtitle="Périmètre de la révision autoritaire"><KeyValues items={[["Révision", number(data.synchronization.revision)]]} /><p className="panel-note">{data.synchronization.note}</p></Panel>
      <Villages items={data.villages} truncated={data.villagesTruncated} /><Activities items={data.recentActivities} note={data.activityNote} action={<a href={`#/activities?worldId=${encodeURIComponent(id)}`}>Explorer le monde ↗</a>} />
    </>}
  </>;
}

export function AccountsPage({ worldId }: { worldId: string | null }) {
  const [input, setInput] = useState(''), [query, setQuery] = useState('');
  const params = new URLSearchParams(); if (query) params.set('query', query); if (worldId) params.set('worldId', worldId);
  const resource = useResource<AdminAccounts>(`/api/admin/accounts?${params}`, 30_000);
  const data = resource.data;
  return <><PageHeading title="Comptes" description="Recherche de support : compte, personnages, mondes et villages rattachés." /><DataState {...resource} />
    {worldId && <div className="context-bar"><span>Monde <a href={worldLink(worldId)}><code>{worldId}</code></a></span><a href="#/accounts">Retirer le périmètre ×</a></div>}
    <Panel title="Annuaire de support" subtitle="Les comptes inscrits ne représentent pas les joueurs actuellement présents."><form className="table-toolbar" onSubmit={event => { event.preventDefault(); setQuery(input.trim()); }}><Search value={input} onChange={setInput} label="Recherche de compte" placeholder="E-mail, identifiant ou personnage…" /><button type="submit" className="button">Rechercher</button>{query && <button type="button" className="text-button" onClick={() => { setInput(''); setQuery(''); }}>Effacer</button>}</form>
      {data?.items.length ? <div className="table-scroll"><table><thead><tr><th>Compte</th><th>Inscription</th><th>Mondes</th><th>Villages</th><th /></tr></thead><tbody>{data.items.map(account => <tr key={account.id}><td><a className="table-primary" href={accountLink(account.id)}>{account.email}</a><small><code>{account.id}</code></small></td><td><Timestamp value={account.createdAt} /></td><td className="numeric">{number(account.worlds)}</td><td className="numeric">{number(account.villages)}</td><td><a className="row-link" href={accountLink(account.id)} aria-label={`Ouvrir le compte ${account.email}`}>↗</a></td></tr>)}</tbody></table></div> : <Empty>{resource.loading ? 'Recherche en cours…' : 'Aucun compte trouvé.'}</Empty>}{data && <LimitNote count={data.items.length} truncated={data.truncated} />}
    </Panel>
  </>;
}

export function AccountPage({ id }: { id: string }) {
  const resource = useResource<AdminAccountDetail>(`/api/admin/accounts/${encodeURIComponent(id)}`, 30_000);
  const data = resource.data;
  return <><PageHeading title={data?.account.email ?? 'Diagnostic du compte'} description={id} back={{ href: '#/accounts', label: 'Tous les comptes' }} /><DataState {...resource} />
    {data && <><div className="metrics three"><Metric label="Mondes rejoints" value={number(data.account.worlds)} /><Metric label="Villages" value={number(data.account.villages)} /><Metric label="Date d’inscription" value={<span className="metric-time"><Timestamp value={data.account.createdAt} /></span>} /></div>
      <Panel title="Personnages et mondes" subtitle="Identités de jeu rattachées au compte">{data.memberships.length ? <div className="table-scroll"><table><thead><tr><th>Personnage</th><th>Monde</th><th>Inscription au monde</th></tr></thead><tbody>{data.memberships.map(member => <tr key={member.worldId}><td><strong>{member.playerName}</strong></td><td><a href={worldLink(member.worldId)}>{member.worldSlug}</a></td><td><Timestamp value={member.joinedAt} /></td></tr>)}</tbody></table></div> : <Empty>Aucune inscription à un monde.</Empty>}</Panel>
      <Villages items={data.villages} truncated={data.truncated} /><Activities items={data.recentActivities} note={data.activityNote} action={<a href={`#/activities?accountId=${encodeURIComponent(id)}`}>Explorer ce compte ↗</a>} />
    </>}
  </>;
}

export function VillagePage({ id, worldId }: { id: string; worldId: string }) {
  const resource = useResource<AdminVillageDetail>(`/api/admin/villages/${encodeURIComponent(id)}?worldId=${encodeURIComponent(worldId)}`);
  const data = resource.data;
  return <><PageHeading title={data?.village.name ?? 'Diagnostic du village'} description={id} back={{ href: worldLink(worldId), label: 'Monde parent' }} /><DataState {...resource} />
    {data && <><div className="context-bar"><span>Monde <a href={worldLink(worldId)}>{data.village.worldSlug}</a></span><span>Propriétaire <a href={accountLink(data.village.ownerAccountId)}><code>{shortId(data.village.ownerAccountId)}</code></a></span><span>Position {data.village.anchorCellX}, {data.village.anchorCellY}</span><span>Créé <Timestamp value={data.village.createdAt} /></span></div>
      <Panel title="Diagnostic" subtitle="Lecture des données persistées, sans commande ni réconciliation"><Diagnostics items={data.diagnostics} /></Panel>
      <div className="metrics four"><Metric label="Population totale" value={number(data.economy.population.total)} /><Metric label="Au travail" value={number(data.economy.population.working)} /><Metric label="Au repos" value={number(data.economy.population.resting)} /><Metric label="Sans affectation" value={number(data.economy.population.idle)} /></div>
      <div className="grid two"><Panel title="Ressources persistées" subtitle="Valeurs exactes stockées"><p className="panel-note">{data.economy.note}</p>{data.economy.resources.length ? <div className="table-scroll"><table><thead><tr><th>Ressource</th><th>Quantité</th><th>Production actualisée</th></tr></thead><tbody>{data.economy.resources.map(resource => <tr key={resource.code}><td><code>{resource.code}</code></td><td className="numeric">{resource.amount}</td><td><Timestamp value={resource.productionUpdatedAt} /></td></tr>)}</tbody></table></div> : <Empty>Aucune ressource persistée.</Empty>}</Panel>
      <Panel title="Échéances métier" subtitle="Échéances dues observées au moment de la lecture"><KeyValues items={[["Bâtiments", number(data.economy.buildings)], ["Constructions dues", number(data.economy.constructionDue)], ["Récoltes dues", number(data.economy.harvestsDue)], ["Extractions dues", number(data.economy.extractionsDue)], ["Transformations dues", number(data.economy.processingDue)], ["Marché : échéances dues", number(data.economy.marketDue)], ["Science : échéances dues", number(data.economy.scienceDue)]]} /></Panel></div>
      <Activities items={data.recentActivities} note={data.activityNote} action={<a href={`#/activities?worldId=${encodeURIComponent(worldId)}&villageId=${encodeURIComponent(id)}`}>Explorer le village ↗</a>} />
    </>}
  </>;
}

export function ActivitiesPage({ queryString }: { queryString: string }) {
  const params = new URLSearchParams(queryString), [kind, setKind] = useState(params.get('kind') ?? '');
  if (kind) params.set('kind', kind); else params.delete('kind');
  const resource = useResource<AdminActivities>(`/api/admin/activities?${params}`);
  return <><PageHeading title="Activités" description="Demandes d’expédition, science et notifications planifiées. Les derniers événements sont bornés." /><DataState {...resource} />
    <div className="table-toolbar page-toolbar"><label>Type <select value={kind} onChange={event => setKind(event.target.value)}><option value="">Tous les types</option><option value="expedition">Expéditions</option><option value="science">Science</option><option value="task">Tâches planifiées</option></select></label>{params.get('worldId') && <a href={worldLink(params.get('worldId')!)}>Monde {shortId(params.get('worldId')!)} ↗</a>}{params.get('villageId') && params.get('worldId') && <a href={villageLink({ id: params.get('villageId')!, worldId: params.get('worldId')! })}>Village ↗</a>}{params.get('accountId') && <a href={accountLink(params.get('accountId')!)}>Compte ↗</a>}{queryString && <a href="#/activities">Tous les périmètres</a>}</div>
    {resource.data && <><Activities items={resource.data.items} note={resource.data.note} title="Événements persistés" /><LimitNote count={resource.data.items.length} truncated={resource.data.truncated} /></>}
  </>;
}

export function ActivityPage({ id, worldId, kind, villageId }: { id: string; worldId: string; kind: string; villageId: string | null }) {
  const resource = useResource<AdminActivityDetail>(`/api/admin/activities/${encodeURIComponent(id)}?worldId=${encodeURIComponent(worldId)}&kind=${encodeURIComponent(kind)}${villageId ? `&villageId=${encodeURIComponent(villageId)}` : ''}`);
  const data = resource.data;
  return <><PageHeading title={data?.activity.label ?? 'Diagnostic de l’activité'} description={id} back={{ href: `#/activities?worldId=${encodeURIComponent(worldId)}`, label: 'Activités du monde' }} /><DataState {...resource} />
    {data && <><Panel title="État et rattachements" subtitle={activityNames[data.activity.kind]}><KeyValues items={[["État", <Badge status={data.activity.status} />], ["Statut du reçu", data.activity.receiptStatus ? <Badge status={data.activity.receiptStatus} /> : 'Sans reçu'], ["Monde", <a href={worldLink(worldId)}><code>{worldId}</code></a>], ["Village", data.activity.villageId ? <a href={villageLink({ id: data.activity.villageId, worldId })}><code>{data.activity.villageId}</code></a> : 'Non renseigné'], ["Compte", data.activity.accountId ? <a href={accountLink(data.activity.accountId)}><code>{data.activity.accountId}</code></a> : 'Non renseigné'], ["Début", <Timestamp value={data.activity.startedAt} />], ["Échéance", <Timestamp value={data.activity.dueAt} />], ["Fin", <Timestamp value={data.activity.completedAt} />], ["Tentatives", number(data.activity.attempts)], ["Code d’erreur", data.activity.errorCode ?? 'Aucun code enregistré']]} /></Panel><Panel title="Diagnostic" subtitle="Constats dérivés de l’état métier observé"><Diagnostics items={data.diagnostics} /></Panel><Activities items={data.relatedActivities} title="Activités liées" /></>}
  </>;
}

export function AdministrationPage() {
  return <><PageHeading title="Administration" description="Périmètre actuel et capacités futures de la console opérateur." />
    <div className="admin-intro"><span className="admin-symbol" aria-hidden="true">◈</span><div><span className="eyebrow">Version 1 · Observation</span><h2>Comprendre avant d’intervenir.</h2><p>Cette console consulte les données et les métriques autorisées. Elle ne propose aucune mutation des mondes, des comptes ou de l’économie.</p></div></div>
    <div className="grid two admin-capabilities">{[
      ['01', 'Rôles et habilitations', 'À définir', 'L’accès opérateur est contrôlé côté serveur. Une gestion fine des rôles et de leurs permissions reste à concevoir.'],
      ['02', 'Invitations alpha', 'Prévu', 'Une future interface pourra préparer les invitations et suivre leurs accès. Aucun envoi ni création de compte depuis cette version.'],
      ['03', 'Maintenance', 'À définir', 'Les procédures d’ouverture, de fermeture et de maintenance des mondes doivent disposer d’un cadre opérationnel explicite.'],
      ['04', 'Réparations', 'À définir', 'Les futures interventions nécessiteront une prévisualisation, une autorisation et une trace d’audit. Aucun outil de réparation n’est exposé ici.'],
    ].map(([index, title, state, description]) => <article className="capability" key={index}><span className="capability-number">{index}</span><div><span className="future-label">{state}</span><h3>{title}</h3><p>{description}</p></div></article>)}</div>
    <Panel title="Lire correctement les indicateurs"><KeyValues items={[["Comptes inscrits", 'Comptes persistés, indépendamment de leur présence.'], ["Comptes SSE", 'Comptes distincts ayant au moins un flux ouvert sur l’instance API observée.'], ["Activité récente", 'Événements métier persistés, pouvant être réalisés par un worker.'], ["Inconnu", 'Absence de mesure exploitable. Aucune valeur n’est déduite artificiellement.'], ["Données anciennes", 'Dernier résultat conservé lorsque l’actualisation échoue ou prend du retard.']]} /></Panel>
  </>;
}

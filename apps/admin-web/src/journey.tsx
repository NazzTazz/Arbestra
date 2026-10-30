import { useMemo, useState } from 'react';
import type { AdminJourney } from '@arbestra/contracts';
import { useResource } from './api';
import { DataState, Empty, Metric, Panel, Timestamp } from './components';
import { absoluteTime, duration, number } from './format';
import {
  emptyJourneyFilter,
  filterJourney,
  journeyTypeLabel,
  outcomeLabels,
  sinceSessionStart,
  sourceLabels,
  type JourneyFilter,
} from './journey-data';
import { accountLink, PageHeading } from './pages';

/** NOC « Parcours »: sessions, chronology and light summary of one player,
 * optionally restricted to one village. Read-only, bounded by the server. */
export function JourneyPage({ accountId, query }: { accountId: string; query: URLSearchParams }) {
  const worldId = query.get('worldId'),
    villageId = query.get('villageId'),
    days = query.get('days') ?? '7';
  const params = new URLSearchParams();
  if (worldId && villageId) {
    params.set('worldId', worldId);
    params.set('villageId', villageId);
  }
  params.set('days', days);
  const resource = useResource<AdminJourney>(`/api/admin/journeys/${encodeURIComponent(accountId)}?${params}`, 60_000);
  const data = resource.data;
  const [filter, setFilter] = useState<JourneyFilter>(emptyJourneyFilter);
  const events = useMemo(() => (data ? filterJourney(data.events, filter) : []), [data, filter]);
  const sessionStart = useMemo(
    () => new Map(data?.sessions.map((s) => [s.index, s.startedAt]) ?? []),
    [data?.sessions],
  );
  const villageNames = useMemo(() => new Map(data?.villages.map((v) => [v.id, v.name]) ?? []), [data?.villages]);
  const navigate = (next: { villageKey?: string; days?: string }) => {
    const target = new URLSearchParams();
    const key = next.villageKey ?? (worldId && villageId ? `${worldId}/${villageId}` : '');
    if (key) {
      const [w, v] = key.split('/');
      target.set('worldId', w!);
      target.set('villageId', v!);
    }
    target.set('days', next.days ?? days);
    window.location.hash = `#/journeys/${encodeURIComponent(accountId)}?${target}`;
  };
  const set = (key: keyof JourneyFilter) => (value: string) => setFilter((f) => ({ ...f, [key]: value }));
  const types = useMemo(() => [...new Set(data?.events.map((e) => e.type) ?? [])].sort(), [data?.events]);
  const activeMinutes = data?.sessions.reduce((n, s) => n + s.activeMinutes, 0) ?? 0;
  return (
    <>
      <PageHeading
        title={data ? `Parcours · ${data.account.email}` : 'Parcours du joueur'}
        description="Sessions, actions et résultats du joueur, reconstitués à la lecture depuis le journal des commandes et les faits métier."
        back={{ href: accountLink(accountId), label: 'Fiche du compte' }}
      />
      <DataState {...resource} />
      {data && (
        <>
          <div className="table-toolbar page-toolbar">
            <label>
              Village{' '}
              <select
                value={worldId && villageId ? `${worldId}/${villageId}` : ''}
                onChange={(event) => navigate({ villageKey: event.target.value })}
              >
                <option value="">Tous ses villages</option>
                {data.villages.map((v) => (
                  <option key={v.id} value={`${v.worldId}/${v.id}`}>
                    {v.name} ({v.worldSlug})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Période{' '}
              <select value={days} onChange={(event) => navigate({ days: event.target.value })}>
                <option value="1">Dernières 24 h</option>
                <option value="7">7 derniers jours</option>
                <option value="30">30 derniers jours</option>
                <option value="90">90 jours (conservation)</option>
              </select>
            </label>
            {data.account.admin && <span className="badge status-attention">Compte administrateur</span>}
          </div>
          {!data.collection.enabled && (
            <p className="form-error" role="status">
              Collecte des commandes désactivée sur ce serveur (<code>JOURNEY_ENABLED</code>) : seules les données déjà
              conservées, les fins différées et les accomplissements apparaissent.
            </p>
          )}
          <p className="panel-note">
            {data.collection.note} Conservation {data.collection.retentionDays} jours
            {data.collection.oldestRetainedAt
              ? ` · plus ancienne donnée ${absoluteTime(data.collection.oldestRetainedAt)}`
              : ' · aucune donnée conservée'}
            {data.collection.dropped + data.collection.lost > 0
              ? ` · ${number(data.collection.dropped + data.collection.lost)} entrée(s) perdue(s) depuis le démarrage`
              : ''}
            .
          </p>
          <div className="metrics four">
            <Metric label="Sessions" value={number(data.sessions.length)} note={`sur ${data.scope.days} j`} />
            <Metric label="Minutes actives" value={number(activeMinutes)} note="minutes avec une commande" />
            <Metric
              label="Actions"
              value={number(data.summary.byType.reduce((n, t) => n + t.actions, 0))}
              note={`${number(data.summary.byType.length)} activité(s) différente(s)`}
            />
            <Metric
              label="Refus"
              value={number(data.summary.byType.reduce((n, t) => n + t.refused, 0))}
              tone={data.summary.refusals.length ? 'warning' : undefined}
            />
          </div>
          <Panel title="Sessions" subtitle="Les plus récentes d’abord. Une pause de 15 min ou plus ouvre une session.">
            {data.sessions.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>N°</th>
                      <th>Début</th>
                      <th>Dernière activité</th>
                      <th>Étendue</th>
                      <th>Minutes actives</th>
                      <th>Actions</th>
                      <th>Refus</th>
                      <th>Statut</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.sessions.map((s) => (
                      <tr key={s.index}>
                        <td className="numeric">{s.index}</td>
                        <td>
                          <Timestamp value={s.startedAt} />
                        </td>
                        <td>
                          <Timestamp value={s.lastActivityAt} />
                        </td>
                        <td>{duration(Date.parse(s.endedAt) - Date.parse(s.startedAt))}</td>
                        <td className="numeric">{number(s.activeMinutes)}</td>
                        <td className="numeric">{number(s.actions)}</td>
                        <td className="numeric">{number(s.refused)}</td>
                        <td>{s.ongoing ? 'En cours' : 'Terminée'}</td>
                        <td>
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => setFilter({ ...emptyJourneyFilter, session: String(s.index) })}
                          >
                            Chronologie
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Aucune commande journalisée sur la période.</Empty>
            )}
            {data.sessionsTruncated && <p className="limit-note warning-text">Sessions limitées aux plus récentes.</p>}
          </Panel>
          <Panel
            title="Chronologie"
            subtitle="Actions du joueur, fins différées et accomplissements, du plus récent au plus ancien."
          >
            <div className="table-toolbar">
              <label>
                Session{' '}
                <select value={filter.session} onChange={(event) => set('session')(event.target.value)}>
                  <option value="">Toutes</option>
                  {data.sessions.map((s) => (
                    <option key={s.index} value={String(s.index)}>
                      N° {s.index} · {absoluteTime(s.startedAt)}
                    </option>
                  ))}
                  <option value="none">Hors session</option>
                </select>
              </label>
              <label>
                Source{' '}
                <select value={filter.source} onChange={(event) => set('source')(event.target.value)}>
                  <option value="">Toutes</option>
                  {Object.entries(sourceLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Issue{' '}
                <select value={filter.outcome} onChange={(event) => set('outcome')(event.target.value)}>
                  <option value="">Toutes</option>
                  <option value="problems">Refus, erreurs, interruptions</option>
                  {Object.entries(outcomeLabels).map(([key, { label }]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Activité{' '}
                <select value={filter.type} onChange={(event) => set('type')(event.target.value)}>
                  <option value="">Toutes</option>
                  {types.map((type) => (
                    <option key={type} value={type}>
                      {journeyTypeLabel(type)}
                    </option>
                  ))}
                </select>
              </label>
              {filter !== emptyJourneyFilter && (
                <button className="text-button" type="button" onClick={() => setFilter(emptyJourneyFilter)}>
                  Effacer les filtres
                </button>
              )}
            </div>
            {events.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Heure</th>
                      <th>Session</th>
                      <th>Source</th>
                      <th>Activité</th>
                      <th>Issue</th>
                      <th>Tentatives</th>
                      {data.villages.length > 1 && !villageId && <th>Village</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <time dateTime={e.at}>{absoluteTime(e.at)}</time>
                        </td>
                        <td>
                          {e.session === null ? (
                            <span className="muted">hors session</span>
                          ) : (
                            <>
                              N° {e.session}{' '}
                              <small className="muted">{sinceSessionStart(e.at, sessionStart.get(e.session))}</small>
                            </>
                          )}
                        </td>
                        <td>{sourceLabels[e.source]}</td>
                        <td>
                          <strong>{journeyTypeLabel(e.type)}</strong>
                          {e.subject && (
                            <>
                              {' '}
                              <code>{e.subject}</code>
                            </>
                          )}
                        </td>
                        <td>
                          <span className={`badge status-${outcomeLabels[e.outcome].tone}`}>
                            <span aria-hidden="true" />
                            {outcomeLabels[e.outcome].label}
                          </span>
                          {e.code && (
                            <>
                              {' '}
                              <code>{e.code}</code>
                            </>
                          )}
                        </td>
                        <td className="numeric">{e.attempts > 1 ? number(e.attempts) : ''}</td>
                        {data.villages.length > 1 && !villageId && <td>{villageNames.get(e.villageId) ?? '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Aucun événement pour ces filtres.</Empty>
            )}
            <p className={data.eventsTruncated ? 'limit-note warning-text' : 'limit-note'}>
              {number(events.length)} événement(s) affiché(s) sur {number(data.events.length)}
              {data.eventsTruncated
                ? ` · liste limitée aux ${number(data.limit)} plus récents ; réduisez la période.`
                : '.'}
            </p>
          </Panel>
          <div className="grid two">
            <Panel title="Activités" subtitle="Commandes du joueur par type sur la période">
              {data.summary.byType.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Activité</th>
                        <th>Actions</th>
                        <th>Refus</th>
                        <th>Sessions</th>
                        <th>Première fois</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.summary.byType.map((t) => (
                        <tr key={t.type}>
                          <td>{journeyTypeLabel(t.type)}</td>
                          <td className="numeric">{number(t.actions)}</td>
                          <td className="numeric">{number(t.refused)}</td>
                          <td className="numeric">{number(t.sessions)}</td>
                          <td>{absoluteTime(t.firstAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>Aucune commande sur la période.</Empty>
              )}
            </Panel>
            <Panel title="Refus" subtitle="Motifs métier renvoyés au joueur">
              {data.summary.refusals.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Activité</th>
                        <th>Motif</th>
                        <th>Nombre</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.summary.refusals.map((r) => (
                        <tr key={r.type + r.code}>
                          <td>{journeyTypeLabel(r.type)}</td>
                          <td>
                            <code>{r.code}</code>
                          </td>
                          <td className="numeric">{number(r.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>Aucun refus sur la période.</Empty>
              )}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}

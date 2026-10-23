import { useEffect, useId, useState, type ReactNode } from 'react';
import { absoluteTime, chartPath, number, relativeTime, type ChartPoint } from './format';

const statusLabels: Record<string, string> = {
  available: 'Disponible',
  degraded: 'Dégradé',
  unavailable: 'Indisponible',
  unknown: 'Inconnu',
  ready: 'Prêt',
  open: 'Ouvert',
  closed: 'Fermé',
  pending: 'En attente',
  running: 'En cours',
  completed: 'Terminé',
  failed: 'Échec',
  cancelled: 'Annulé',
  active: 'Actif',
  admitted: 'Admis',
  rejected: 'Refusé',
  'in-progress': 'En cours',
};
export function Badge({ status }: { status: string | null | undefined }) {
  const value = status ?? 'unknown';
  return (
    <span className={`badge status-${value}`}>
      <span aria-hidden="true" />
      {statusLabels[value] ?? value}
    </span>
  );
}
export function Timestamp({ value }: { value: string | number | null | undefined }) {
  const valid = value != null && Number.isFinite(new Date(value).getTime());
  return (
    <span className="timestamp">
      <time dateTime={valid ? new Date(value).toISOString() : undefined}>{absoluteTime(value)}</time>
      {valid && <small>{relativeTime(value)}</small>}
    </span>
  );
}
export function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: 'accent' | 'warning' | undefined;
}) {
  return (
    <article className={`metric${tone ? ` metric-${tone}` : ''}`}>
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      <span className="metric-note">{note ?? '—'}</span>
    </article>
  );
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
  id,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`panel ${className}`}>
      <header className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">◌</span>
      <p>{children}</p>
    </div>
  );
}
export function DataState({
  loading,
  error,
  receivedAt,
  refresh,
  frozen = false,
}: {
  loading: boolean;
  error: string | null;
  receivedAt: number | null;
  refresh: () => void;
  frozen?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const stale = receivedAt !== null && (error !== null || (!frozen && now - receivedAt > 45_000));
  return (
    <div className={`data-state${error || stale ? ' data-state-warning' : ''}`} role={error ? 'alert' : 'status'}>
      <span className={`sync-dot${loading ? ' is-loading' : ''}`} aria-hidden="true" />
      <span>
        {error
          ? `${receivedAt !== null ? `Données conservées · reçu ${absoluteTime(receivedAt)} · ` : ''}${error}`
          : loading
            ? 'Actualisation en cours…'
            : receivedAt !== null
              ? `Reçu ${absoluteTime(receivedAt)}`
              : 'En attente de données'}
        {stale && <strong> · Anciennes données</strong>}
      </span>
      <button className="text-button" type="button" disabled={loading} onClick={refresh}>
        {error ? 'Réessayer' : 'Actualiser'} <span aria-hidden="true">↻</span>
      </button>
    </div>
  );
}
export function Search({
  value,
  onChange,
  label = 'Rechercher',
  placeholder = 'Filtrer…',
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <label className="search" htmlFor={id}>
      <span aria-hidden="true">⌕</span>
      <span className="sr-only">{label}</span>
      <input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
export function Chart({
  title,
  points,
  unit,
  color = 'mint',
  note,
}: {
  title: string;
  points: ChartPoint[];
  unit: string;
  color?: 'mint' | 'blue' | 'amber';
  note?: string;
}) {
  const id = useId(),
    chart = chartPath(points);
  const valid = points.filter(
    (point) => point.value !== null && Number.isFinite(point.value) && Number.isFinite(Date.parse(point.time)),
  );
  const times = valid.map((point) => Date.parse(point.time));
  const firstTime = Math.min(...times),
    timeSpan = Math.max(1, Math.max(...times) - firstTime);
  return (
    <article className={`chart chart-${color}`}>
      <div className="chart-title">
        <h3>{title}</h3>
        <span>{unit}</span>
      </div>
      {chart.count === 0 ? (
        <Empty>Aucune mesure disponible pour cette fenêtre.</Empty>
      ) : (
        <>
          <div className="chart-plot">
            <span className="chart-max">{number(chart.max, 1)}</span>
            <svg viewBox="0 0 640 150" role="img" aria-labelledby={id} preserveAspectRatio="none">
              <title id={id}>
                {title} : {chart.count} observations, maximum {number(chart.max, 1)} {unit}.
              </title>
              {[0, 50, 100, 150].map((y) => (
                <line key={y} x1="0" x2="640" y1={y} y2={y} className="chart-grid" />
              ))}
              <path d={chart.path} className="chart-line" />
              {valid.map((point, index) => {
                const dot = (
                  <circle
                    className="chart-point"
                    cx={((Date.parse(point.time) - firstTime) / timeSpan) * 640}
                    cy={150 - (point.value! / Math.max(1, chart.max)) * 150}
                    r={point.link ? '3.5' : '2.5'}
                  >
                    <title>
                      {absoluteTime(point.time)} · {number(point.value, 2)} {unit}
                    </title>
                  </circle>
                );
                return point.link ? (
                  <a
                    key={`${point.time}:${index}`}
                    href={point.link}
                    aria-label={`Voir les requêtes retenues de cette période : ${point.context ?? absoluteTime(point.time)}`}
                  >
                    {dot}
                  </a>
                ) : (
                  <g key={`${point.time}:${index}`}>{dot}</g>
                );
              })}
            </svg>
            <span className="chart-zero">0</span>
          </div>
          <div className="chart-axis">
            <span>{absoluteTime(valid[0]?.time)}</span>
            <span>{absoluteTime(valid.at(-1)?.time)}</span>
          </div>
        </>
      )}
      {points.length > 0 && (
        <details className="chart-values">
          <summary>
            Consulter les {points.length} périodes · {chart.count} mesures
          </summary>
          {note && <p className="chart-explanation">{note}</p>}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Horodatage / période</th>
                  <th>{unit}</th>
                  {points.some((point) => point.link) && <th>Diagnostic</th>}
                </tr>
              </thead>
              <tbody>
                {points.map((point, index) => (
                  <tr key={`${point.time}:${index}`}>
                    <td>{point.context ?? absoluteTime(point.time)}</td>
                    <td>{number(point.value, 2)}</td>
                    {points.some((item) => item.link) && (
                      <td>{point.link && <a href={point.link}>Voir les requêtes retenues de cette période ↗</a>}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </article>
  );
}
export function KeyValues({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="key-values">
      {items.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value ?? 'Inconnu'}</dd>
        </div>
      ))}
    </dl>
  );
}

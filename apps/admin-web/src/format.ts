export const number = (value: number | null | undefined, digits = 0): string => value == null || !Number.isFinite(value)
  ? 'Inconnu' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(value);
export const milliseconds = (value: number | null | undefined): string => value == null ? 'Inconnu' : `${number(value, 1)} ms`;
export const bytes = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return 'Inconnu';
  if (value < 1024 ** 2) return `${number(value / 1024, 1)} Kio`;
  if (value < 1024 ** 3) return `${number(value / 1024 ** 2, 1)} Mio`;
  return `${number(value / 1024 ** 3, 2)} Gio`;
};
export function duration(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'Inconnu';
  const seconds = Math.max(0, Math.floor(value / 1_000));
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ${Math.floor(seconds % 3600 / 60)} min`;
  return `${Math.floor(seconds / 86_400)} j ${Math.floor(seconds % 86_400 / 3600)} h`;
}
export function absoluteTime(value: string | number | null | undefined): string {
  if (value == null || !Number.isFinite(new Date(value).getTime())) return 'Inconnu';
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}
export function relativeTime(value: string | number | null | undefined, now = Date.now()): string {
  if (value == null || !Number.isFinite(new Date(value).getTime())) return 'Inconnu';
  const delta = now - new Date(value).getTime();
  return delta >= 0 ? `il y a ${duration(delta)}` : `dans ${duration(-delta)}`;
}
export const shortId = (value: string): string => value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
export const matches = (query: string, ...values: Array<string | null | undefined>): boolean =>
  values.some(value => value?.toLocaleLowerCase('fr').includes(query.trim().toLocaleLowerCase('fr')));

export interface ChartPoint { time: string; value: number | null; link?: string; context?: string }
export function chartPath(points: ChartPoint[], width = 640, height = 150): { path: string; max: number; count: number } {
  const valid = points.filter(point => point.value !== null && Number.isFinite(point.value) && Number.isFinite(Date.parse(point.time)));
  if (!valid.length) return { path: '', max: 1, count: 0 };
  const dates = valid.map(point => Date.parse(point.time));
  const first = Math.min(...dates), span = Math.max(1, Math.max(...dates) - first);
  const max = Math.max(0, ...valid.map(point => point.value!)), scale = Math.max(1, max);
  let connected = false;
  const path = points.map(point => {
    if (point.value === null || !Number.isFinite(point.value) || !Number.isFinite(Date.parse(point.time))) { connected = false; return ''; }
    const x = (Date.parse(point.time) - first) / span * width, y = height - point.value / scale * height;
    const command = `${connected ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`; connected = true; return command;
  }).join(' ');
  return { path, max, count: valid.length };
}

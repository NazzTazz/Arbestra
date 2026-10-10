import { useMemo } from 'react';
import { firstLuminosityExtremum, spawnLuminosity, type SpawnPoint } from '@arbestra/contracts';
export function Luminosity({ point, width, height }: { point: SpawnPoint; width: number; height: number }) {
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

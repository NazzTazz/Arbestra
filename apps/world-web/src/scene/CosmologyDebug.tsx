import { useEffect, useMemo, useState } from 'react';
import type { BabylonVillageScene } from './BabylonVillageScene';
import { COSMOLOGY, TAU, measureRegime } from './cosmology';

export function CosmologyDebug({ scene }: { scene: () => BabylonVillageScene | null }) {
  const [state, setState] = useState(() => scene()?.getCosmologyDiagnostics());
  const choosePhase = (fraction: number) => {
    const value = Math.max(0, Math.min(1, fraction));
    scene()?.setCosmologyPhase(value);
    setState(previous => previous ? { ...previous, phase: value * TAU, paused: true } : previous);
  };
  useEffect(() => {
    const timer = window.setInterval(() => setState(scene()?.getCosmologyDiagnostics()), 250);
    return () => window.clearInterval(timer);
  }, [scene]);
  const regimes = useMemo(() => [
    { label: 'Équateur extérieur', v: 0 }, { label: 'Équateur intérieur', v: Math.PI },
    { label: 'Lieu regardé', v: state?.v ?? 0 },
  ].map(row => ({ ...row, ...measureRegime(state?.u ?? 0, row.v, undefined, 2048) })), [state?.u, state?.v]);
  return <section className="cosmology-debug" aria-label="Laboratoire cosmologique">
    <strong>Soleil et rotation · debug</strong>
    <div className="cosmology-actions">
      <button type="button" onClick={() => scene()?.setCosmologyPhase(state?.paused ? null : (state?.phase ?? 0) / TAU)}>{state?.paused ? 'Reprendre le temps' : 'Pause cosmologique'}</button>
      <button type="button" onClick={() => scene()?.previewSolarProfile()}>Profil du huit</button>
    </div>
    <label>Phase du cycle combiné <input aria-label="Phase cosmologique" type="range" min="0" max="1" step="0.001"
      value={(state?.phase ?? 0) / TAU} onChange={event => choosePhase(Number(event.target.value))}
      onKeyDown={event => {
        const steps: Record<string, number> = { ArrowRight: .001, ArrowUp: .001, ArrowLeft: -.001, ArrowDown: -.001, PageUp: .1, PageDown: -.1 };
        if (event.key !== 'Home' && event.key !== 'End' && !(event.key in steps)) return;
        event.preventDefault(); event.stopPropagation();
        choosePhase(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (state?.phase ?? 0) / TAU + steps[event.key]!);
      }} /></label>
    <label>Rotation en secondes <input aria-label="Durée de rotation" type="number" min="30" max="28800" defaultValue={COSMOLOGY.periodMs / 1000}
      onChange={event => { if (event.target.value) scene()?.setCosmologyPeriod(Number(event.target.value)); }} /></label>
    <p>Tore : {(state?.rotationPeriodMs ?? COSMOLOGY.periodMs) / 1000} s · Soleil : {(state?.rotationPeriodMs ?? COSMOLOGY.periodMs) / 1000 * 1.5} s · Cycle combiné : {(state?.rotationPeriodMs ?? COSMOLOGY.periodMs) / 1000 * 3} s</p>
    <p>{state?.occluded ? 'Soleil occulté par le tore' : (state?.direct ?? 0) > COSMOLOGY.horizonThreshold ? 'Soleil au-dessus de l’horizon' : 'Soleil sous l’horizon'}</p>
    {regimes.map(row => <div className="cosmology-regime" key={row.label}>
      <span>{row.label} : {row.permanent === 'day' ? 'jour permanent' : row.permanent === 'night' ? 'nuit permanente' : `${row.days} lever${row.days > 1 ? 's' : ''}`}</span>
      <svg viewBox="0 0 240 12" role="img" aria-label={`Périodes éclairées ${row.label}`}>
        <rect width="240" height="12" fill="#263d52" />
        {row.permanent === 'day' && <rect width="240" height="12" fill="#efcd78" />}
        {row.intervals.flatMap(([a, b], i) => b <= 1
          ? [<rect key={i} x={a * 240} width={(b - a) * 240} height="12" fill="#efcd78" />]
          : [<rect key={`${i}a`} x={a * 240} width={(1 - a) * 240} height="12" fill="#efcd78" />,
            <rect key={`${i}b`} width={(b - 1) * 240} height="12" fill="#efcd78" />])}
        <line x1={(state?.phase ?? 0) / TAU * 240} x2={(state?.phase ?? 0) / TAU * 240} y1="0" y2="12" stroke="white" strokeWidth="2" />
      </svg>
    </div>)}
    <small>Intervalles sur le cycle combiné : 3 rotations du tore, 2 huit solaires. Sondes : or = jour · bleu = nuit · mauve = occultation. Aucun effet économique.</small>
  </section>;
}

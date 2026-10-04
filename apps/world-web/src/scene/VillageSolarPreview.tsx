import { useEffect, useState } from 'react';
import type { BabylonVillageScene } from './BabylonVillageScene';

export function VillageSolarPreview({ scene, onChoose }: { scene: () => BabylonVillageScene | null; onChoose: () => void }) {
  const [view, setView] = useState(() => scene()?.getVillageSolarView());
  useEffect(() => {
    const timer = window.setInterval(() => setView(scene()?.getVillageSolarView()), 250);
    return () => { window.clearInterval(timer); scene()?.setVillageSolarPreview(null); };
  }, [scene]);
  const minute = Math.min(1439, Math.floor((view?.fraction ?? 0) * 1440));
  const time = `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`;
  return <section className="mode-toolbar solar-preview-toolbar" aria-label="Éclairage du village">
    <label>Moment visualisé · {time} / 24 h
      <input aria-label="Moment du cycle solaire" aria-valuetext={`${time} sur le cycle combiné de 24 heures`} type="range" min="0" max="1439" step="1" value={minute}
        onChange={event => {
          onChoose(); scene()?.setVillageSolarPreview(Number(event.target.value) / 1440);
          setView(scene()?.getVillageSolarView());
        }} />
    </label>
    <div><strong>{view?.label ?? 'Éclairage local'}</strong><small>{view?.preview ? 'Aperçu visuel' : 'Temps réel'} · deux trajectoires solaires de 12 h</small></div>
    <button type="button" disabled={!view?.preview} onClick={() => { scene()?.setVillageSolarPreview(null); setView(scene()?.getVillageSolarView()); }}>Temps réel</button>
  </section>;
}

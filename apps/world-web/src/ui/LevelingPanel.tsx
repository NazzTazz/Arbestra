import { useEffect, useState } from 'react';
import type { LevelingCommand, LevelingPreview, LevelingRequest } from '@arbestra/contracts';
import { ApiError, commandLeveling, previewLeveling, type TimedVillageState } from '../api/client';
import { randomUUID } from '../random-uuid';
import { BuildingThumbnail } from './BuildingThumbnail';
import './leveling.css';

const duration = (ms: number) => `${Math.max(1, Math.ceil(ms / 60_000))} min`;
export function LevelingPanel({ slug, villageId, request, onSnapshot, onClose, onStarted, onPreview }: {
  onPreview: (preview: LevelingPreview) => void;
  slug: string; villageId: string; request: Omit<LevelingRequest, 'workerCount'>;
  onSnapshot: (snapshot: TimedVillageState) => void; onClose: () => void; onStarted: () => void;
}) {
  const [workers, setWorkers] = useState(1), [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<LevelingPreview | null>(null);
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null), [retry, setRetry] = useState<LevelingCommand | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setPreview(null);
    void previewLeveling(slug, villageId, { ...request, workerCount: workers }, controller.signal)
      .then(value => { if (!controller.signal.aborted) {setPreview(value);onPreview(value);} })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Devis indisponible.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [slug, villageId, request, workers, revision,onPreview]);
  async function submit() {
    if (pending || (!retry && (!preview?.valid || loading))) return;
    const command = retry ?? { ...request, workerCount: workers, commandId: randomUUID(), expected: preview!.quote };
    setRetry(command); setPending(true); setError(null);
    try { onSnapshot(await commandLeveling(slug, villageId, command)); onStarted(); }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Résultat inconnu. Vérifiez la même commande.');
      if (reason instanceof ApiError && reason.status >= 400 && reason.status < 500) { setRetry(null); setPreview(null); }
    } finally { setPending(false); }
  }
  return <div className="leveling-backdrop"><section className="leveling-panel production-panel" role="dialog" aria-modal="true" aria-labelledby="leveling-title">
    <header className="production-heading"><small>{request.buildingType === 'university' ? 'Université' : 'Tailleur de pierre'}</small><h2 id="leveling-title">Préparer le terrain</h2></header>
    <p>Aplanir l’emprise, puis construire le bâtiment à votre retour.</p>
    <div className="production-workers" role="group" aria-label="Habitants du chantier">{[1, 2, 3].map(n => <button type="button" key={n} aria-pressed={workers === n} disabled={pending || !!retry} onClick={() => setWorkers(n)}><BuildingThumbnail code={`workers:${n}`}/><strong>{n} habitant{n > 1 ? 's' : ''}</strong></button>)}</div>
    <div className="leveling-quote" aria-live="polite" aria-busy={loading}>
      <p><span>Emprise</span><strong>{preview ? (preview.quote.affectedCells??preview.quote.cells).length : '—'} cases{preview?.quote.affectedCells?' · raccord compris':''}</strong></p>
      <p><span>Travail et aller-retour</span><strong>{preview ? duration(preview.quote.durationMs) : '—'}</strong></p>
      <p><span>Coût en pierres</span><strong>{preview ? preview.quote.stoneDebit === 0 ? 'Gratuit · pelouse / terre' : preview.quote.stoneDebit : '—'}</strong></p>
      <p className="leveling-status" role="status">{loading ? 'Estimation du chantier…' : error ?? preview?.message ?? 'La fatigue habituelle s’applique aux habitants.'}</p>
    </div>
    <div className="production-actions"><button type="button" disabled={pending || !!retry} onClick={onClose}>Retour</button>
      {error && !retry && <button type="button" disabled={pending || loading} onClick={() => setRevision(n => n + 1)}>Actualiser le devis</button>}
      <button className="production-primary" type="button" disabled={pending || loading || (!retry && !preview?.valid)} onClick={() => void submit()}>{pending ? 'Lancement…' : retry ? 'Vérifier le même chantier' : 'Lancer le nivellement'}</button>
    </div>
  </section></div>;
}

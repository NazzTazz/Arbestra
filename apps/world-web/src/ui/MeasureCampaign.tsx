import { useState, useSyncExternalStore } from 'react';
import { DEFAULT_CAMPAIGN_TEXT } from '../dev/measure-campaign';
import {
  campaignResults,
  clearCampaign,
  measureProgress,
  startCampaign,
  stopCampaign,
  subscribeMeasure,
} from '../dev/measure-runner';

const STATUS = { running: 'en cours', done: 'terminée', stopped: 'arrêtée', failed: 'en échec' } as const;
const useMeasure = () => useSyncExternalStore(subscribeMeasure, measureProgress, measureProgress);

/** Section « Campagne de mesures » du laboratoire (dev/measure-runner.ts). */
export function MeasureCampaignSection() {
  const progress = useMeasure(),
    [text, setText] = useState(DEFAULT_CAMPAIGN_TEXT),
    [error, setError] = useState<string | null>(null),
    [copied, setCopied] = useState(false);
  const run = progress.run,
    running = run?.status === 'running',
    output = run && !running ? JSON.stringify(campaignResults(), null, 2) : null;
  const download = () => {
    if (!output) return;
    const url = URL.createObjectURL(new Blob([output], { type: 'application/json' })),
      link = document.createElement('a');
    link.href = url;
    link.download = `arbestra-mesures-${(run?.startedAt ?? new Date().toISOString()).replace(/[:.]/g, '-')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = () => {
    if (!output) return;
    try {
      void navigator.clipboard.writeText(output).then(
        () => setCopied(true),
        () => setCopied(false),
      );
    } catch {
      /* Presse-papiers facultatif : « Télécharger » reste possible. */
    }
  };
  return (
    <section className="measure-campaign">
      <strong>Campagne de mesures</strong>
      <small>
        Joue les scénarios du JSON sur ce village, par des gestes simulés. Les traits de terraformation sont tous
        annulés. Rien n’est envoyé : les résultats restent ici.
      </small>
      <textarea
        aria-label="Campagne (JSON)"
        spellCheck={false}
        rows={9}
        value={text}
        disabled={running}
        onChange={(event) => {
          setText(event.target.value);
          setError(null);
        }}
      />
      <div className="measure-campaign-actions">
        <button type="button" disabled={running} onClick={() => setText(DEFAULT_CAMPAIGN_TEXT)}>
          Campagne par défaut
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() => {
            setCopied(false);
            setError(startCampaign(text));
          }}
        >
          Lancer
        </button>
        <button type="button" disabled={!running} onClick={stopCampaign}>
          Arrêter
        </button>
      </div>
      {error && <span role="alert">{error}</span>}
      {run && (
        <span>
          « {run.campaign.name} » {STATUS[run.status]} · {run.results.length} résultat
          {run.results.length > 1 ? 's' : ''}
          {run.error ? ` · ${run.error}` : ''}
        </span>
      )}
      {output && (
        <>
          <textarea aria-label="Résultats (JSON)" readOnly rows={9} value={output} spellCheck={false} />
          <div className="measure-campaign-actions">
            <button type="button" onClick={copy}>
              {copied ? 'Copié' : 'Copier'}
            </button>
            <button type="button" onClick={download}>
              Télécharger
            </button>
            <button type="button" onClick={clearCampaign}>
              Effacer
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** Pendant une campagne : une bannière discrète en haut de l'écran, avec « Arrêter ». */
export function MeasureCampaignBanner() {
  const progress = useMeasure();
  if (progress.run?.status !== 'running' && !progress.label) return null;
  return (
    <div className="measure-campaign-banner" role="status" data-measure-banner="">
      <span>{progress.label ?? 'Campagne de mesures'}</span>
      <button type="button" onClick={stopCampaign}>
        Arrêter
      </button>
    </div>
  );
}

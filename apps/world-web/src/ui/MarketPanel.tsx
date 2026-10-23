import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  MARKET_QUANTITIES,
  MARKET_TRAVEL_SECONDS,
  oracleAmount,
  oracleCost,
  type Building,
  type TradeCommand,
  type TradeOffer,
  type TradePreview,
  type MarketState,
  type VillageState,
} from '@arbestra/contracts';
import { randomUUID } from '../random-uuid';
import { browseMarket, previewTrade } from '../api/client';
import { BuildingThumbnail } from './BuildingThumbnail';

const number = (n: number) => n.toLocaleString('fr-FR');
const duration = (ms: number) => (ms < 60000 ? `${Math.ceil(ms / 1000)} s` : `${Math.ceil(ms / 60000)} min`);
export function MarketQuantity({
  label,
  value,
  onChange,
  stock,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  stock?: number;
  disabled: boolean;
}) {
  const choices = MARKET_QUANTITIES.filter((n) => stock === undefined || n <= stock);
  const smaller = [...choices].reverse().find((n) => n < value),
    larger = choices.find((n) => n > value);
  return (
    <fieldset className="market-quantity" disabled={disabled}>
      <legend>{label}</legend>
      <div className="market-counter">
        <button
          type="button"
          aria-label={`Diminuer ${label}`}
          disabled={smaller === undefined}
          onClick={() => onChange(smaller!)}
        >
          −
        </button>
        <output key={value} aria-live="polite">
          {number(value)}
        </output>
        <button
          type="button"
          aria-label={`Augmenter ${label}`}
          disabled={larger === undefined}
          onClick={() => onChange(larger!)}
        >
          +
        </button>
      </div>
      <div className="market-pills">
        {MARKET_QUANTITIES.map((n) => (
          <button
            type="button"
            key={n}
            aria-pressed={value === n}
            disabled={stock !== undefined && n > stock}
            onClick={() => onChange(n)}
          >
            {number(n)}
          </button>
        ))}
      </div>
      {stock !== undefined && (
        <>
          <p>Disponible : {number(stock)}</p>
          <button type="button" disabled={stock < 1 || stock > 1_000_000_000} onClick={() => onChange(stock)}>
            Tout mon stock
          </button>
        </>
      )}
    </fieldset>
  );
}
export function MarketPanel({
  slug,
  villageId,
  building,
  market,
  stocks,
  serverNow,
  revision,
  pending,
  error,
  onCommand,
  onUpgrade,
}: {
  slug: string;
  villageId: string;
  building: Building;
  market: MarketState;
  stocks: VillageState['village']['resources'];
  serverNow: number;
  revision: string;
  pending: boolean;
  error: string | null;
  onCommand: (command: TradeCommand) => Promise<boolean>;
  onUpgrade: () => void;
}) {
  const [tab, setTab] = useState<'browse' | 'publish' | 'mine'>('publish');
  const panelRef = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0),
    [requested, setRequested] = useState(''),
    [wantedAmount, setWantedAmount] = useState(100);
  useLayoutEffect(() => {
    panelRef.current?.closest('.world-context-menu')?.scrollTo({ top: 0 });
  }, [step, tab]);
  const [offered, setOffered] = useState(''),
    [offeredAmount, setOfferedAmount] = useState(100),
    [travelIndex, setTravelIndex] = useState(4);
  const [offers, setOffers] = useState<TradeOffer[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false),
    [localError, setLocalError] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<TradeOffer | null>(null),
    [preview, setPreview] = useState<TradePreview | null>(null);
  const [retry, setRetry] = useState<TradeCommand | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const frozen = pending || !!retry,
    stock = (code: string) => stocks.find((r) => r.code === code)?.amount ?? 0;
  const name = (code: string) => market.resources.find((r) => r.code === code)?.displayName ?? code;
  const value = (code: string) => market.resources.find((r) => r.code === code)?.valueUnits ?? 0;
  const maxTravelSeconds = MARKET_TRAVEL_SECONDS[travelIndex]!;
  const eligible =
    !!offered && !!requested && oracleAmount(offeredAmount, value(offered), value(requested)) >= wantedAmount;
  const [oraclePayment, setOraclePayment] = useState('wood'),
    [oracleConfirmation, setOracleConfirmation] = useState<Extract<TradeCommand, { action: 'oracle' }> | null>(null);
  useEffect(() => {
    if (oraclePayment === requested || !market.resources.some((r) => r.code === oraclePayment)) {
      setOraclePayment(market.resources.find((r) => r.code !== requested)?.code ?? '');
      setOracleConfirmation(null);
    }
  }, [requested, oraclePayment, market.resources]);
  useEffect(() => {
    if (!market.unlocked || tab === 'publish') return;
    const controller = new AbortController();
    setLoading(true);
    setLocalError(null);
    void browseMarket(slug, villageId, tab === 'mine', undefined, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) {
          setOffers(page.offers);
          setCursor(page.nextCursor);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setLocalError(e instanceof Error ? e.message : 'Marché indisponible.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug, villageId, market.unlocked, tab, revision, refresh]);
  useEffect(() => {
    setSelected(null);
    setPreview(null);
    setOracleConfirmation(null);
  }, [tab]);
  async function send(command: TradeCommand) {
    setRetry(command);
    setLocalError(null);
    if (await onCommand(command)) {
      setRetry(null);
      setRefresh((n) => n + 1);
      setSelected(null);
      setPreview(null);
      setOracleConfirmation(null);
      setNotice(
        command.action === 'publish'
          ? 'Offre publiée. Votre contrepartie est réservée.'
          : command.action === 'cancel'
            ? 'Offre annulée. Réserve restituée.'
            : command.action === 'oracle'
              ? 'Échange Oracle livré.'
              : 'Vos porteurs sont en route.',
      );
      if (command.action === 'publish') {
        setTab('mine');
        setStep(0);
      }
    }
  }
  async function inspect(offer: TradeOffer) {
    setSelected(offer);
    setPreview(null);
    setLoading(true);
    setLocalError(null);
    try {
      setPreview(await previewTrade(slug, villageId, offer.id));
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Trajet indisponible.');
    } finally {
      setLoading(false);
    }
  }
  async function more() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await browseMarket(slug, villageId, tab === 'mine', cursor);
      setOffers((old) => [...old, ...page.offers]);
      setCursor(page.nextCursor);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Marché indisponible.');
    } finally {
      setLoading(false);
    }
  }
  function resourceCards(current: string, choose: (code: string) => void, excluded?: string) {
    const order = ['wood', 'timber', 'stone', 'cut-stone', 'carrot'];
    return (
      <div className="market-resources">
        {[...market.resources]
          .filter((r) => r.code !== excluded)
          .sort(
            (a, b) =>
              (order.indexOf(a.code) < 0 ? 99 : order.indexOf(a.code)) -
              (order.indexOf(b.code) < 0 ? 99 : order.indexOf(b.code)),
          )
          .map((r) => (
            <button
              className="market-resource"
              type="button"
              key={r.code}
              disabled={frozen}
              aria-pressed={current === r.code}
              onClick={() => choose(r.code)}
            >
              <BuildingThumbnail code={`resource:${r.code}`} />
              <strong>{r.displayName}</strong>
            </button>
          ))}
      </div>
    );
  }
  const states = {
    open: 'Publiée',
    cancelled: 'Annulée',
    accepted: 'Acceptée · transport engagé',
    oracle: 'Livrée par l’Oracle',
  };
  return (
    <section ref={panelRef} className="market-panel player-market" aria-label="Place de marché">
      <header>
        <span className="market-eyebrow">Hôtel de ville · Commerce</span>
        <h3>Place de marché</h3>
        {market.unlocked && (
          <p className="market-activity" role="status" aria-atomic="true">
            {loading ? 'Préparation du marché…' : ''}
          </p>
        )}
      </header>
      {!market.unlocked ? (
        <>
          <p>Le marché ouvre à l’hôtel de ville niveau 2.</p>
          <p>500 bois d’œuvre + 120 pierres taillées · 10 minutes.</p>
          {building.level === 1 && building.status === 'completed' && (
            <button
              type="button"
              disabled={pending || stock('timber') < 500 || stock('cut-stone') < 120}
              onClick={onUpgrade}
            >
              Améliorer l’hôtel de ville
            </button>
          )}
        </>
      ) : (
        <>
          <nav className="market-tabs" aria-label="Navigation du marché">
            {(
              [
                ['browse', 'Consulter les offres'],
                ['publish', 'Publier une offre'],
                ['mine', 'Mes offres'],
              ] as const
            ).map(([id, label]) => (
              <button
                type="button"
                key={id}
                aria-pressed={tab === id}
                disabled={frozen || loading}
                onClick={() => {
                  setTab(id);
                  setNotice(null);
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          {notice && (
            <p role="status" className="market-notice">
              {notice}
            </p>
          )}
          {tab === 'publish' && (
            <div className="market-wizard">
              <p className="market-eyebrow">Étape {step + 1} sur 4</p>
              {step === 0 && (
                <>
                  <h4>Que cherchez-vous ?</h4>
                  <p>Touchez une ressource pour commencer.</p>
                  {resourceCards(requested, (code) => {
                    setRequested(code);
                    if (offered === code) setOffered('');
                    setStep(1);
                  })}
                </>
              )}
              {step === 1 && (
                <>
                  <h4>Combien de {name(requested)} ?</h4>
                  <BuildingThumbnail code={`resource:${requested}`} />
                  <MarketQuantity
                    label="Quantité souhaitée"
                    value={wantedAmount}
                    onChange={setWantedAmount}
                    disabled={frozen}
                  />
                </>
              )}
              {step === 2 && (
                <>
                  <h4>Que proposez-vous en échange ?</h4>
                  {resourceCards(
                    offered,
                    (code) => {
                      setOffered(code);
                      setOfferedAmount(Math.min(100, stock(code)));
                    },
                    requested,
                  )}
                  {offered && (
                    <MarketQuantity
                      label="Maximum offert"
                      value={offeredAmount}
                      onChange={setOfferedAmount}
                      stock={stock(offered)}
                      disabled={frozen}
                    />
                  )}
                </>
              )}
              {step === 3 && (
                <>
                  <h4>Votre offre</h4>
                  <div className="market-summary">
                    <p>
                      Je cherche{' '}
                      <strong>
                        {number(wantedAmount)} {name(requested)}
                      </strong>
                    </p>
                    <p>
                      Je donne{' '}
                      <strong>
                        {number(offeredAmount)} {name(offered)}
                      </strong>
                    </p>
                  </div>
                  <label className="market-slider">
                    Temps de trajet maximum · aller simple <output>{duration(maxTravelSeconds * 1000)}</output>
                    <input
                      aria-label="Temps de trajet maximum"
                      type="range"
                      min={0}
                      max={MARKET_TRAVEL_SECONDS.length - 1}
                      step={1}
                      value={travelIndex}
                      disabled={frozen}
                      onChange={(e) => setTravelIndex(Number(e.target.value))}
                    />
                  </label>
                  <p>
                    {eligible
                      ? 'Priorité aux joueurs pendant 10 minutes, puis reprise et livraison instantanées par l’Oracle.'
                      : 'Votre offre reste ouverte aux joueurs. Ce tarif ne permet pas la reprise par l’Oracle.'}
                  </p>
                  <small>
                    Quantité offerte réservée dès publication. Annulation possible avant acceptation. Échange entier,
                    sans fractionnement.
                  </small>
                </>
              )}
              <div className="market-actions">
                {step > 0 && (
                  <button type="button" disabled={frozen} onClick={() => setStep((n) => n - 1)}>
                    Retour
                  </button>
                )}
                {step > 0 && step < 3 && (
                  <button
                    type="button"
                    disabled={
                      frozen || (step === 2 && (!offered || offeredAmount < 1 || offeredAmount > stock(offered)))
                    }
                    onClick={() => setStep((n) => n + 1)}
                  >
                    Continuer
                  </button>
                )}
                {step === 3 && (
                  <button
                    className="market-primary"
                    type="button"
                    disabled={frozen || offeredAmount < 1 || offeredAmount > stock(offered)}
                    onClick={() =>
                      void send({
                        action: 'publish',
                        commandId: randomUUID(),
                        requestedResource: requested,
                        requestedAmount: wantedAmount,
                        offeredResource: offered,
                        offeredAmount,
                        maxTravelSeconds,
                      })
                    }
                  >
                    Valider
                  </button>
                )}
              </div>
            </div>
          )}
          {tab !== 'publish' && (
            <>
              {tab === 'browse' && (
                <>
                  <h4>Je cherche</h4>
                  {resourceCards(requested, (code) => {
                    setRequested(code);
                    setOraclePayment(code === 'wood' ? 'stone' : 'wood');
                    setOracleConfirmation(null);
                  })}
                </>
              )}
              <div className="market-list">
                {offers
                  .filter((o) => tab === 'mine' || !requested || o.offeredResource === requested)
                  .map((o) => (
                    <article className="market-offer" key={o.id}>
                      <div>
                        <strong>
                          {number(o.offeredAmount)} {name(o.offeredResource)}
                        </strong>
                        <span>
                          contre {number(o.requestedAmount)} {name(o.requestedResource)}
                        </span>
                        <small>
                          {o.villageName} · {states[o.status]}
                        </small>
                      </div>
                      {o.status === 'open' && (
                        <small>
                          Trajet maximum : {duration(o.maxTravelSeconds * 1000)} ·{' '}
                          {o.oracleEligible
                            ? `Oracle dans ${duration(Math.max(0, Date.parse(o.oracleAt) - serverNow))}`
                            : 'Joueurs uniquement'}
                        </small>
                      )}
                      {o.status === 'open' &&
                        (o.villageId === villageId ? (
                          <button
                            type="button"
                            disabled={frozen}
                            onClick={() => void send({ action: 'cancel', commandId: randomUUID(), offerId: o.id })}
                          >
                            Annuler et récupérer ma réserve
                          </button>
                        ) : (
                          <button type="button" disabled={frozen || loading} onClick={() => void inspect(o)}>
                            Voir le trajet et accepter
                          </button>
                        ))}
                    </article>
                  ))}
              </div>
              {offers.length === 0 && (
                <p className={`market-empty${loading ? ' is-loading' : ''}`}>
                  Aucune offre {tab === 'mine' ? 'publiée' : 'joueur disponible'}.
                </p>
              )}
              {cursor && (
                <button type="button" disabled={loading || frozen} onClick={() => void more()}>
                  Afficher la suite
                </button>
              )}
              {selected && preview && (
                <div className="market-confirm">
                  <h4>Confirmer cet échange</h4>
                  <p>
                    Vous envoyez {number(selected.requestedAmount)} {name(selected.requestedResource)} et rapportez{' '}
                    {number(selected.offeredAmount)} {name(selected.offeredResource)}.
                  </p>
                  <p>
                    {preview.workerCount} habitants · {duration(preview.travelMs)} à l’aller · retour dans{' '}
                    {duration(preview.travelMs * 2)}.
                  </p>
                  <button
                    type="button"
                    disabled={
                      frozen ||
                      preview.availableWorkers < preview.workerCount ||
                      stock(selected.requestedResource) < selected.requestedAmount
                    }
                    onClick={() => void send({ action: 'accept', commandId: randomUUID(), offerId: selected.id })}
                  >
                    Confirmer le départ
                  </button>
                  {preview.availableWorkers < preview.workerCount && (
                    <p>Habitants disponibles pour ce trajet : {preview.availableWorkers}.</p>
                  )}
                </div>
              )}
              {tab === 'browse' && requested && (
                <section className="market-oracle" aria-label="Offres permanentes de l’Oracle">
                  <h4>Les étals de l’Oracle</h4>
                  <p>Livraison instantanée · commission de 30 % incluse.</p>
                  <label>
                    Je paie en{' '}
                    <select
                      value={oraclePayment}
                      disabled={frozen}
                      onChange={(e) => {
                        setOraclePayment(e.target.value);
                        setOracleConfirmation(null);
                      }}
                    >
                      {market.resources
                        .filter((r) => r.code !== requested)
                        .map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.displayName}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="market-oracle-lots">
                    {MARKET_QUANTITIES.map((q) => {
                      const cost =
                        value(oraclePayment) && value(requested)
                          ? oracleCost(q, value(oraclePayment), value(requested))
                          : 0;
                      return (
                        <button
                          type="button"
                          key={q}
                          disabled={frozen || cost < 1 || stock(oraclePayment) < cost}
                          onClick={() =>
                            setOracleConfirmation({
                              action: 'oracle',
                              commandId: randomUUID(),
                              requestedResource: requested,
                              requestedAmount: q,
                              offeredResource: oraclePayment,
                              expectedCost: cost,
                            })
                          }
                        >
                          <strong>
                            {number(q)} {name(requested)}
                          </strong>
                          <span>
                            {number(cost)} {name(oraclePayment)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {oracleConfirmation && (
                    <div className="market-confirm">
                      <p>
                        Recevoir {number(oracleConfirmation.requestedAmount)}{' '}
                        {name(oracleConfirmation.requestedResource)} contre {number(oracleConfirmation.expectedCost)}{' '}
                        {name(oracleConfirmation.offeredResource)}. Débit et livraison immédiats.
                      </p>
                      <button type="button" disabled={frozen} onClick={() => void send(oracleConfirmation)}>
                        Confirmer l’échange Oracle
                      </button>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
          {(market.journeys ?? []).some((j) => j.villageId === villageId || j.destinationVillageId === villageId) && (
            <section>
              <h4>Convois en route</h4>
              {market
                .journeys!.filter((j) => j.villageId === villageId || j.destinationVillageId === villageId)
                .map((j) => (
                  <p key={j.id}>
                    {j.workerCount} porteurs ·{' '}
                    {serverNow < Date.parse(j.arrivesAt)
                      ? `aller · arrivée dans ${duration(Date.parse(j.arrivesAt) - serverNow)}`
                      : `retour · arrivée dans ${duration(Date.parse(j.returnsAt) - serverNow)}`}
                  </p>
                ))}
            </section>
          )}
        </>
      )}
      {retry && !pending && (
        <div className="market-confirm">
          <p>Le résultat de la commande est à vérifier avant toute nouvelle action.</p>
          <button type="button" onClick={() => void send(retry)}>
            Vérifier la même commande
          </button>
          <button
            type="button"
            onClick={() => {
              setRetry(null);
              setRefresh((n) => n + 1);
            }}
          >
            Revenir au marché
          </button>
        </div>
      )}
      {market.exchanges.length > 0 && (
        <details>
          <summary>Livraisons Oracle précédentes</summary>
          {market.exchanges.map((e) => (
            <p key={e.id}>
              {e.receivedAmount} {name(e.requestedResource)} ·{' '}
              {e.completedAt ? 'Livré' : duration(Math.max(0, Date.parse(e.completesAt) - serverNow))}
            </p>
          ))}
        </details>
      )}
      {(localError || error) && (
        <p role="alert" className="error">
          {localError || error}
        </p>
      )}
    </section>
  );
}

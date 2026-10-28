import { describe, expect, it } from 'vitest';
import type { MarketJourney, MarketState, TradeOffer } from '@arbestra/contracts';
import { completedMarketTransactions, marketCommandDelivers, type MarketDeliveryState } from './market-deliveries';

const ME = 'village-me',
  OTHER = 'village-other';
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 28, 12, 0, seconds)).toISOString();
type Exchange = MarketState['exchanges'][number];

function state(
  seconds: number,
  market: { exchanges?: Exchange[]; offers?: TradeOffer[]; journeys?: MarketJourney[] } = {},
): MarketDeliveryState {
  return {
    world: { id: 'world' },
    serverTime: at(seconds),
    village: { id: ME, market: { exchanges: [], offers: [], journeys: [], ...market } },
  };
}
const exchange = (id: string, completedAt: number | null): Exchange => ({
  id,
  offeredResource: 'wood',
  requestedResource: 'stone',
  offeredAmount: 100,
  receivedAmount: 70,
  startedAt: at(0),
  completesAt: at(30),
  completedAt: completedAt === null ? null : at(completedAt),
});
const offer = (id: string, oracleAt: number, oracleEligible = true): TradeOffer => ({
  id,
  villageId: ME,
  villageName: 'Moi',
  requestedResource: 'stone',
  requestedAmount: 50,
  offeredResource: 'wood',
  offeredAmount: 100,
  maxTravelSeconds: 600,
  status: 'open',
  createdAt: at(0),
  oracleAt: at(oracleAt),
  oracleEligible,
});
const journey = (id: string, from: string, to: string, started: number, travel: number): MarketJourney => ({
  id,
  villageId: from,
  destinationVillageId: to,
  workerCount: 1,
  path: [],
  startedAt: at(started),
  arrivesAt: at(started + travel),
  returnsAt: at(started + travel * 2),
});

describe('market transactions that just credited the village', () => {
  it('counts an Oracle delivery when its exchange completes', () => {
    expect(
      completedMarketTransactions(
        state(29, { exchanges: [exchange('e1', null), exchange('old', 5)] }),
        state(31, { exchanges: [exchange('e1', 30), exchange('old', 5)] }),
      ),
    ).toBe(1);
  });

  it('counts the Oracle taking an own offer at its Oracle time, but not a cancelled or unexpired one', () => {
    expect(completedMarketTransactions(state(599, { offers: [offer('o1', 600)] }), state(601, { offers: [] }))).toBe(1);
    // Cancelled before its Oracle time.
    expect(completedMarketTransactions(state(100, { offers: [offer('o1', 600)] }), state(101, { offers: [] }))).toBe(0);
    // Not eligible: the Oracle never takes it.
    expect(
      completedMarketTransactions(state(599, { offers: [offer('o1', 600, false)] }), state(601, { offers: [] })),
    ).toBe(0);
  });

  it('counts a player trade for the seller when the convoy arrives, and for the buyer when it comes home', () => {
    const sale = journey('j1', OTHER, ME, 100, 60);
    expect(completedMarketTransactions(state(159, { journeys: [sale] }), state(161, { journeys: [sale] }))).toBe(1);
    const purchase = journey('j2', ME, OTHER, 100, 60);
    // Arrival at the seller credits the other village, not this one.
    expect(
      completedMarketTransactions(state(159, { journeys: [purchase] }), state(161, { journeys: [purchase] })),
    ).toBe(0);
    // Home again: the convoy leaves the list as the goods are credited.
    expect(completedMarketTransactions(state(219, { journeys: [purchase] }), state(221, { journeys: [] }))).toBe(1);
  });

  it('counts nothing for a departure, including the acceptance of an own offer', () => {
    expect(completedMarketTransactions(state(100), state(101, { journeys: [journey('j1', ME, OTHER, 100, 60)] }))).toBe(
      0,
    );
    // Someone accepts our offer: the offer leaves the list and their convoy sets off.
    expect(
      completedMarketTransactions(
        state(100, { offers: [offer('o1', 600)] }),
        state(101, { offers: [], journeys: [journey('j1', OTHER, ME, 100, 60)] }),
      ),
    ).toBe(0);
    // Same acceptance, observed only after the Oracle time (late frame).
    expect(
      completedMarketTransactions(
        state(100, { offers: [offer('o1', 120)] }),
        state(130, { offers: [], journeys: [journey('j1', OTHER, ME, 110, 60)] }),
      ),
    ).toBe(0);
  });

  it('counts nothing for the first state, another village or an identical reload', () => {
    const delivered = state(31, { exchanges: [exchange('e1', 30)], journeys: [journey('j1', OTHER, ME, 0, 30)] });
    expect(completedMarketTransactions(null, delivered)).toBe(0);
    expect(
      completedMarketTransactions(
        { ...state(29, { exchanges: [exchange('e1', null)] }), village: { id: 'elsewhere', market: null } },
        delivered,
      ),
    ).toBe(0);
    expect(completedMarketTransactions(delivered, structuredClone(delivered))).toBe(0);
    // A reload carries the same history: delivered exchanges and passed arrivals are not news.
    const later = structuredClone(delivered);
    later.serverTime = at(40);
    expect(completedMarketTransactions(delivered, later)).toBe(0);
    // A state without its market stream yet tells nothing.
    expect(completedMarketTransactions({ ...delivered, village: { id: ME } }, later)).toBe(0);
  });

  it('counts several deliveries arriving together', () => {
    const sale = journey('j1', OTHER, ME, 100, 60),
      purchase = journey('j2', ME, OTHER, 70, 50);
    expect(
      completedMarketTransactions(
        state(150, {
          exchanges: [exchange('e1', null), exchange('e2', null)],
          offers: [offer('o1', 155), offer('o2', 900)],
          journeys: [sale, purchase],
        }),
        state(175, {
          exchanges: [exchange('e1', 160), exchange('e2', 170), exchange('e3', 172)],
          offers: [offer('o2', 900)],
          journeys: [sale],
        }),
      ),
    ).toBe(6);
  });

  it('marks only a direct Oracle purchase as delivered by its command', () => {
    expect(marketCommandDelivers({ action: 'oracle' })).toBe(true);
    for (const action of ['publish', 'cancel', 'accept'] as const)
      expect(marketCommandDelivers({ action })).toBe(false);
  });
});

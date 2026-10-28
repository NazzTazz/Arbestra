import type { MarketState, TradeCommand, VillageState } from '@arbestra/contracts';

type MarketView = Pick<MarketState, 'exchanges' | 'offers' | 'journeys'>;
export type MarketDeliveryState = {
  world: Pick<VillageState['world'], 'id'>;
  serverTime: string;
  village: Pick<VillageState['village'], 'id'> & { market?: MarketView | null };
};

/**
 * Market transactions that have just finished and credited this village,
 * between two accepted states (the same pair as the "+N" of the HUD):
 *
 * - Oracle delivery (`market.exchanges`): an exchange gets its `completedAt`.
 * - Oracle takeover of an own offer: an open offer that the Oracle could take
 *   leaves the list once its `oracleAt` has passed. The server reconciles that
 *   transition before any cancel or accept, so only a player's acceptance
 *   observed late can look alike: each new incoming convoy accounts for one.
 * - Player trade, seller: an incoming convoy reaches us (`arrivesAt`).
 * - Player trade, buyer: our convoy comes home with the goods (`returnsAt`).
 *
 * A departure, a first state, a different village or an identical reload
 * count nothing. A direct Oracle purchase leaves no trace in the state: see
 * `marketCommandDelivers`.
 */
export function completedMarketTransactions(previous: MarketDeliveryState | null, next: MarketDeliveryState): number {
  if (!previous || previous.world.id !== next.world.id || previous.village.id !== next.village.id) return 0;
  const before = previous.village.market,
    after = next.village.market;
  if (!before || !after) return 0;
  const since = Date.parse(previous.serverTime),
    until = Date.parse(next.serverTime);
  if (!(until > since)) return 0;
  const crossed = (at: string) => {
    const time = Date.parse(at);
    return time > since && time <= until;
  };
  const village = next.village.id;
  let count = 0;

  const pending = new Set(before.exchanges.filter((e) => e.completedAt === null).map((e) => e.id));
  const known = new Set(before.exchanges.map((e) => e.id));
  for (const exchange of after.exchanges)
    if (
      exchange.completedAt !== null &&
      (pending.has(exchange.id) || (!known.has(exchange.id) && crossed(exchange.completedAt)))
    )
      count++;

  const priorJourneys = new Map((before.journeys ?? []).map((j) => [j.id, j]));
  const journeys = new Map(priorJourneys);
  for (const journey of after.journeys ?? []) journeys.set(journey.id, journey);
  for (const journey of journeys.values()) {
    if (journey.destinationVillageId === village && crossed(journey.arrivesAt)) count++;
    if (journey.villageId === village && crossed(journey.returnsAt)) count++;
  }

  if (before.offers && after.offers) {
    const remaining = new Set(after.offers.map((o) => o.id));
    const gone = before.offers.filter((o) => o.status === 'open' && !remaining.has(o.id));
    const taken = gone.filter((o) => o.oracleEligible && Date.parse(o.oracleAt) <= until).length;
    const accepted = (after.journeys ?? []).filter(
      (j) => j.destinationVillageId === village && !priorJourneys.has(j.id),
    ).length;
    // Acceptances explain the offers that left before their Oracle time first.
    count += Math.max(0, taken - Math.max(0, accepted - (gone.length - taken)));
  }
  return count;
}

/** A direct Oracle purchase debits and credits at once, in the command itself. */
export function marketCommandDelivers(command: Pick<TradeCommand, 'action'>): boolean {
  return command.action === 'oracle';
}

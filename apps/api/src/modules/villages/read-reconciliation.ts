import type { VillageEconomy } from './reconcile-economy.js';

/** Only overlapping read-side wakeups share a commit. Commands never enter this
 * registry, and settled work (including failures) is never cached. */
export class VillageReadReconciliations {
  private readonly flights = new Map<string, Promise<VillageEconomy>>();
  constructor(private readonly load: (accountId: string, slug: string, villageId: string) => Promise<VillageEconomy>) {}

  run(accountId: string, slug: string, worldId: string, villageId: string): Promise<VillageEconomy> {
    const key = accountId + ':' + worldId + ':' + villageId;
    let flight = this.flights.get(key);
    if (!flight) {
      flight = this.load(accountId, slug, villageId).finally(() => this.flights.delete(key));
      this.flights.set(key, flight);
    }
    return flight;
  }
}

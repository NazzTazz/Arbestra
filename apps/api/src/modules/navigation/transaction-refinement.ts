import type { Kysely } from 'kysely';
import { buildTravelNetwork, type TravelNetworkState, type TravelRoute } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import type { readRc1Ground } from '../worlds/rc1-ground.js';
import { devTime, devTimeSync } from '../operations/dev-timing.js';
import { networkJob, networkState, type NetworkLoader } from './network-job.js';

export interface TransactionRefiner {
  refine(load: NetworkLoader): Promise<TravelRoute[]>;
  /** A whole village network, queued behind other commands only. */
  network?(load: NetworkLoader): Promise<TravelRoute[]>;
}
// Kysely transactions share their database adapter. Separate databases never
// borrow each other's executor, including tests creating more than one app.
const executors = new WeakMap<object, TransactionRefiner>();
export function bindTransactionRefiner(db: Kysely<Database>, executor: TransactionRefiner) {
  const key = db.getExecutor().adapter;
  executors.set(key, executor);
  return () => {
    if (executors.get(key) === executor) executors.delete(key);
  };
}
export function transactionRefiner(db: Kysely<Database>) {
  return executors.get(db.getExecutor().adapter);
}

/** A command holds its village lock while it needs the network. A large village
 * takes seconds to route (alpha Catmark: 9.5 s), so the bound lane computes it
 * from geometry already read (no SQL in the loader) and the API thread keeps
 * answering. Without a bound lane (transactional tests) it stays inline. */
export async function commandTravelNetwork(
  db: Kysely<Database>,
  state: TravelNetworkState,
  ground: Awaited<ReturnType<typeof readRc1Ground>> | null | undefined,
  woodlandTargets: readonly string[] = [],
): Promise<TravelRoute[]> {
  const executor = transactionRefiner(db);
  if (!executor?.network)
    return devTimeSync('navigation', () => buildTravelNetwork(state, woodlandTargets, ground?.navigation));
  const network = executor.network.bind(executor);
  return devTime('navigation', () =>
    network(async (known) => ({
      ...networkJob(networkState(state), ground ?? undefined, known),
      ...(woodlandTargets.length ? { woodlandTargets: [...woodlandTargets] } : {}),
    })),
  );
}

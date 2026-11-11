import type { Kysely } from 'kysely';
import {
  buildTravelNetwork,
  planVillageLeg,
  type GardenTourLeg,
  type TravelCell,
  type TravelNetworkState,
  type TravelRoute,
} from '@arbestra/contracts';
import { HttpError } from '../../errors.js';
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

/** Legs of a garden tour (refonte des trajets T2), in one job on the bound
 * lane, or inline without one (transactional tests). Null: no path. */
export async function commandVillageLegs(
  db: Kysely<Database>,
  state: TravelNetworkState,
  ground: Awaited<ReturnType<typeof readRc1Ground>> | null | undefined,
  legs: readonly GardenTourLeg[],
): Promise<Array<TravelCell[] | null>> {
  if (!legs.length) return [];
  const executor = transactionRefiner(db);
  if (!executor)
    return devTimeSync('navigation', () =>
      legs.map((leg) =>
        planVillageLeg(state, leg.from, leg.to, ground?.navigation, undefined, () => {
          throw new HttpError(503, 'NAVIGATION_BUSY', 'Calcul du trajet interrompu. Réessayez.');
        }),
      ),
    );
  const routes = await devTime('navigation', () =>
    executor.refine(async (known) => ({
      ...networkJob(networkState(state), ground ?? undefined, known),
      legs: [...legs],
    })),
  );
  return routes.map((route) => (route.cells.length ? route.cells : null));
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

import type { Kysely } from 'kysely';
import type { TravelRoute } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import type { NetworkLoader } from './network-job.js';

export interface TransactionRefiner {
  refine(load: NetworkLoader): Promise<TravelRoute[]>;
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

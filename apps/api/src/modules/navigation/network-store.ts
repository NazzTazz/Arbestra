import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import type { Kysely } from 'kysely';
import { HIERARCHICAL_ROUTE_VERSION, ROUTE_POLICY_VERSION, type TravelRoute } from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';

const zip = promisify(gzip),
  unzip = promisify(gunzip);

/** Part of every network fingerprint: bump the last digit when the planner's
 * output changes for an identical input, or stored networks would be reused.
 * network-2 (29 October): active gardens are no longer ordinary roads.
 * network-3 (30 October): roads draw the coarse search (ROAD_STEP_COST). */
export const TRAVEL_NETWORK_VERSION = `${ROUTE_POLICY_VERSION}/${HIERARCHICAL_ROUTE_VERSION}/network-3`;

export interface TravelNetworkStore {
  load(worldId: string, villageId: string, fingerprint: string): Promise<TravelRoute[] | null>;
  save(worldId: string, villageId: string, fingerprint: string, routes: readonly TravelRoute[]): Promise<void>;
}

/** The last network of each village survives a restart. A cache only: a failed
 * read is a miss and a failed write is ignored, never a player-visible error. */
export function databaseTravelNetworkStore(
  db: Kysely<Database>,
  warn: (error: unknown) => void = () => {},
): TravelNetworkStore {
  return {
    async load(worldId, villageId, fingerprint) {
      try {
        const row = await db
          .selectFrom('villageTravelNetworks')
          .select('routes')
          .where('worldId', '=', worldId)
          .where('villageId', '=', villageId)
          .where('fingerprint', '=', fingerprint)
          .executeTakeFirst();
        return row ? (JSON.parse((await unzip(row.routes)).toString('utf8')) as TravelRoute[]) : null;
      } catch (error) {
        warn(error);
        return null;
      }
    },
    async save(worldId, villageId, fingerprint, routes) {
      try {
        const values = {
          worldId,
          villageId,
          fingerprint,
          routes: await zip(Buffer.from(JSON.stringify(routes), 'utf8')),
          computedAt: new Date(),
        };
        await db
          .insertInto('villageTravelNetworks')
          .values(values)
          .onConflict((oc) =>
            oc.columns(['worldId', 'villageId']).doUpdateSet({
              fingerprint: values.fingerprint,
              routes: values.routes,
              computedAt: values.computedAt,
            }),
          )
          .execute();
      } catch (error) {
        warn(error);
      }
    },
  };
}

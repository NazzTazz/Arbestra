/** Balancing report of navigation T1 (docs/SPEC-REFONTE-TRAJETS-2026-11-10.md §3, §7):
 * for each wood and stone deposit in a village's range, and for its garden
 * tours, the one-way duration at the historical rule (path length, one second
 * per cell) against the cost rule of decision 8 (0.7 s per road cell), on the
 * same path. Paths are computed by the current code, in a transaction rolled
 * back at the end: nothing is written, even to the copy.
 *
 *   tsx src/bench-durations.ts --target local --world rc1-dev --village UUID */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { planGardenTour, travelDuration, withinDepositRange, type TravelCell } from '@arbestra/contracts';
import { createDatabase } from '../../api/src/database/connection.js';
import { beginVillageEconomy } from '../../api/src/modules/villages/reconcile-economy.js';
import {
  ownedVillage,
  readInfrastructureSpatialState,
  stoneTravelPath,
} from '../../api/src/modules/villages/service.js';
import { pathRoadLookup, pathTravelDuration } from '../../api/src/modules/navigation/road-cost.js';
import { databaseUrl, describeDatabase, guard, main, OUT_DIR, timestamp } from './cli.js';
import { distribution } from './stats.js';

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    'database-url': { type: 'string' },
    world: { type: 'string' },
    village: { type: 'string' },
  },
});

class Rollback extends Error {}

await main(async () => {
  const url = databaseUrl(values),
    world = values.world,
    villageId = values.village;
  if (!world || !villageId) throw new Error('--world et --village obligatoires.');
  guard({ target: values.target, databaseUrl: url, worldSlug: world });
  const db = createDatabase(url);
  let report: Record<string, unknown> = {};
  try {
    console.info(`Base ${describeDatabase(url)}, monde ${world}.`);
    await db
      .transaction()
      .execute(async (tx) => {
        const owner = await tx
          .selectFrom('villages')
          .select(['ownerAccountId', 'worldId'])
          .where('id', '=', villageId)
          .executeTakeFirstOrThrow();
        const village = await ownedVillage(tx, owner.ownerAccountId, world, villageId);
        const cells = await tx
          .selectFrom('worldCellOccupancies')
          .innerJoin('buildings', 'buildings.id', 'worldCellOccupancies.buildingId')
          .select(['worldCellOccupancies.cellX', 'worldCellOccupancies.cellY'])
          .where('buildings.villageId', '=', villageId)
          .where('buildings.status', '=', 'completed')
          .execute();
        const deposits = (
          await tx
            .selectFrom('resourceDeposits')
            .select(['featureId', 'cellX', 'cellY', 'resourceCode'])
            .where('worldId', '=', owner.worldId)
            .execute()
        ).filter((d) => withinDepositRange(cells, d, village));
        const rows: Array<{ resource: string; before: number; after: number; roads: boolean }> = [];
        for (const d of deposits) {
          let path: TravelCell[] | undefined;
          try {
            path = await stoneTravelPath(tx, village, d.featureId);
          } catch {
            continue;
          }
          if (!path) continue;
          const before = travelDuration(path, village),
            after = await pathTravelDuration(tx, village, path);
          rows.push({ resource: d.resourceCode, before, after, roads: after < before });
        }
        const summary = (resource: string) => {
          const list = rows.filter((r) => r.resource === resource);
          return {
            paths: list.length,
            onRoads: list.filter((r) => r.roads).length,
            before: distribution(list.map((r) => r.before)),
            after: distribution(list.map((r) => r.after)),
            ratio: distribution(list.map((r) => r.after / r.before)),
          };
        };
        // Garden tours over the network's routes, every plot of the village by size.
        const economy = await beginVillageEconomy(tx, owner.worldId, villageId);
        const spatial = await readInfrastructureSpatialState(tx, village, economy);
        const routes = spatial.snapshot.travelRoutes,
          roads = await pathRoadLookup(
            tx,
            village,
            routes.map((r) => r.cells),
          );
        const plots = await tx
          .selectFrom('gardenPlots')
          .select(['cellX', 'cellY'])
          .where('villageId', '=', villageId)
          .orderBy('buildingId')
          .orderBy('cellX')
          .orderBy('cellY')
          .execute();
        const home = { cellX: village.anchorCellX, cellY: village.anchorCellY };
        const gardens = [1, 4, 8].flatMap((size) => {
          if (plots.length < size) return [];
          const selection = plots.slice(0, size),
            before = planGardenTour(routes, home, selection, village)?.durationMs ?? null,
            after = planGardenTour(routes, home, selection, village, roads)?.durationMs ?? null;
          return [{ plots: size, before, after, ratio: before && after ? after / before : null }];
        });
        report = { village: village.villageName, wood: summary('wood'), stone: summary('stone'), gardens, rows };
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
  } finally {
    await db.destroy();
  }
  const r = report as {
    village: string;
    wood: { paths: number; onRoads: number; ratio: { mean: number; min: number } | null };
    stone: { paths: number; onRoads: number; ratio: { mean: number; min: number } | null };
    gardens: Array<{ plots: number; before: number | null; after: number | null }>;
  };
  console.info(
    `${r.village} : bois ${r.wood.paths} trajets (${r.wood.onRoads} sur route, rapport moyen ${r.wood.ratio?.mean}, min ${r.wood.ratio?.min}) ; ` +
      `pierre ${r.stone.paths} (${r.stone.onRoads} sur route, moyen ${r.stone.ratio?.mean}, min ${r.stone.ratio?.min}) ; ` +
      r.gardens.map((g) => `jardin ${g.plots} : ${g.before} → ${g.after} ms`).join(' ; '),
  );
  mkdirSync(OUT_DIR, { recursive: true });
  const out = resolve(OUT_DIR, `bench-durations-${timestamp()}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.info(`Résultats : ${out}`);
});

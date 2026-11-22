/** Profile of village mission searches (docs/SPEC-TRAJETS-8-DIRECTIONS-2026-11-22.md §5, slice R1):
 * the travel paths from a village's town hall to given wood or stone cells,
 * timed end to end (`stoneTravelPath`, as the worksite admission calls it) and
 * search only, cold then warm, with the nodes visited and the physical samples
 * read. READ ONLY: everything runs in a `read only` transaction rolled back at
 * the end, so the script may target the development database. The connection
 * comes from the API configuration (DATABASE_URL, never printed).
 *
 *   tsx src/bench-village-paths.ts --world rc1-dev --village UUID --cells 259:216,258:220,262:223
 *     [--repeat 3] [--restore-trees 11059,2823,...] [--lane]
 *
 * Each target is searched first on a ground revision never seen (an empty
 * mesh: cold), then `repeat - 1` times on that same revision (warm). Before
 * R1 the same script timed the former eighth-cell refinement: its figures are
 * in docs/SPEC-TRAJETS-8-DIRECTIONS-2026-11-22.md §6.
 *
 * `--restore-trees` rebuilds the navigation ground with those trunks standing
 * again (the trees felled since an incident), as the navigation worker builds
 * it from the transactional edits; its build time is reported.
 */
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { sql } from 'kysely';
import { travelDuration, type TravelCell, type TravelGround } from '@arbestra/contracts';
import * as contracts from '@arbestra/contracts';
import { loadConfig } from '../../api/src/config.js';
import { createDatabase } from '../../api/src/database/connection.js';
import { ownedVillage, stoneTravelPath, villageNavigationContext } from '../../api/src/modules/villages/service.js';
import { readRc1Ground } from '../../api/src/modules/worlds/rc1-ground.js';
import { rc1NetworkGround } from '../../api/src/modules/navigation/rc1-network-ground.js';
import { main } from './cli.js';
import { NavigationCompute } from '../../api/src/modules/navigation/compute.js';
import { bindTransactionRefiner } from '../../api/src/modules/navigation/transaction-refinement.js';

const { values } = parseArgs({
  options: {
    world: { type: 'string' },
    village: { type: 'string' },
    cells: { type: 'string' },
    repeat: { type: 'string', default: '3' },
    /** RC1 tree indices to stand again (trunks removed since the measured incident). */
    'restore-trees': { type: 'string' },
    /** Also time `stoneTravelPath` through a navigation worker lane, as the API runs it. */
    lane: { type: 'boolean' },
  },
});

class Rollback extends Error {}
const ms = (t: number) => Math.round(t * 10) / 10;

/** The mission search (planVillageRoute), from the town hall doors to a cell. */
function search(
  state: contracts.TravelNetworkState,
  to: TravelCell,
  ground: TravelGround | undefined,
  stats: contracts.VillageSearchStats,
): TravelCell[] | null {
  const outcome = contracts.planVillageRoute(state, { cells: [to], destination: to }, ground, { stats });
  return outcome.kind === 'found' ? outcome.path : null;
}

await main(async () => {
  const world = values.world,
    villageId = values.village;
  if (!world || !villageId || !values.cells) throw new Error('--world, --village et --cells obligatoires.');
  const targets = values.cells.split(',').map((c) => {
    const [x, y] = c.split(':').map(Number);
    return { cellX: x!, cellY: y! };
  });
  const repeat = Math.max(1, Number(values.repeat));
  const db = createDatabase(loadConfig().databaseUrl);
  const report: Record<string, unknown> = { search: 'planVillageRoute (cells, 8 directions)', targets: [] };
  try {
    await db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (tx) => {
        await sql`set transaction read only`.execute(tx);
        const owner = await tx
          .selectFrom('villages')
          .select(['ownerAccountId', 'worldId'])
          .where('id', '=', villageId)
          .executeTakeFirstOrThrow();
        const village = await ownedVillage(tx, owner.ownerAccountId, world, villageId);
        let began = performance.now();
        const ground = await readRc1Ground(tx, village.worldId);
        report.groundMs = ms(performance.now() - began);
        began = performance.now();
        const { context } = await villageNavigationContext(tx, village, ground);
        report.contextMs = ms(performance.now() - began);
        report.region = context.region && {
          originCellX: context.region.originCellX,
          originCellY: context.region.originCellY,
          width: context.region.width,
          height: context.region.height,
        };
        // Physical samples read by the search, and their share of its time.
        const counted = { samples: 0, sampleMs: 0 };
        let base = ground.navigation;
        if (values['restore-trees']) {
          const restore = new Set(values['restore-trees'].split(',').map(Number));
          began = performance.now();
          base = rc1NetworkGround(ground.data, contracts.createSpawnTerrainField(ground.data), {
            ...ground.navigationEdits,
            absent: ground.navigationEdits.absent.filter((i) => !restore.has(i)),
          });
          report.restoredTrees = restore.size;
          report.workerGroundMs = ms(performance.now() - began);
        }
        const navigation: TravelGround = {
          ...base,
          sample(x, y) {
            counted.samples++;
            const t = performance.now(),
              s = base.sample(x, y);
            counted.sampleMs += performance.now() - t;
            return s;
          },
        };
        const rows: Array<Record<string, unknown>> = [];
        for (const target of targets) {
          const deposit = await tx
            .selectFrom('resourceDeposits')
            .select(['featureId', 'resourceCode'])
            .where('worldId', '=', village.worldId)
            .where('cellX', '=', target.cellX)
            .where('cellY', '=', target.cellY)
            .executeTakeFirst();
          const runs: Array<Record<string, unknown>> = [];
          for (let i = 0; i < repeat; i++) {
            counted.samples = 0;
            counted.sampleMs = 0;
            const stats = { visited: 0, certified: 0 };
            // Run 0 on a ground revision never seen (an empty mesh: cold), the
            // others on that same revision (its mesh warm).
            const revisioned = {
              ...navigation,
              revision: `${navigation.revision}:bench:${target.cellX}:${target.cellY}`,
            };
            const t = performance.now(),
              path = search(context as contracts.TravelNetworkState, target, revisioned, stats),
              searchMs = performance.now() - t;
            runs.push({
              searchMs: ms(searchMs),
              visited: stats.visited,
              certified: stats.certified,
              samples: counted.samples,
              sampleMs: ms(counted.sampleMs),
              found: !!path,
              points: path?.length ?? 0,
              durationMs: path ? travelDuration(path, village) : null,
            });
          }
          // End to end, as the worksite admission (wood or stone cell only).
          let endToEnd: Record<string, unknown> | undefined;
          if (deposit) {
            const t = performance.now(),
              path = await stoneTravelPath(tx, village, deposit.featureId).catch((e: Error) => e);
            endToEnd = {
              ms: ms(performance.now() - t),
              ...(path instanceof Error
                ? { error: path.message }
                : { found: !!path, durationMs: path ? travelDuration(path, village) : null }),
            };
          }
          rows.push({
            target,
            resource: deposit?.resourceCode ?? null,
            ...(deposit ? { featureId: deposit.featureId } : {}),
            runs,
            endToEnd,
          });
        }
        report.targets = rows;
        if (values.lane) {
          // The API's command lane (app.ts): one worker, its caches cold at first.
          const lane = new NavigationCompute(1, { waiting: 16, waitMs: 30000, computeMs: 90000 });
          let t = performance.now();
          await lane.start();
          const laneRuns: Array<Record<string, unknown>> = [{ startMs: ms(performance.now() - t) }];
          const unbind = bindTransactionRefiner(db, {
            refine: (load) => lane.network(load),
            network: (load) => lane.network(load),
          });
          try {
            for (let i = 0; i < repeat; i++)
              for (const row of rows) {
                const featureId = (row as { featureId?: string }).featureId;
                if (!featureId) continue;
                t = performance.now();
                const path = await stoneTravelPath(tx, village, featureId).catch((e: Error) => e);
                laneRuns.push({
                  run: i,
                  target: row.target,
                  ms: ms(performance.now() - t),
                  ...(path instanceof Error ? { error: path.message } : { found: !!path }),
                });
              }
          } finally {
            unbind();
            await lane.close();
          }
          report.lane = laneRuns;
        }
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
  } finally {
    await db.destroy();
  }
  console.info(JSON.stringify(report, null, 2));
});

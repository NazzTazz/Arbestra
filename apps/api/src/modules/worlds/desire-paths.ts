import { sql, type Transaction } from 'kysely';

import { desireEdges, type DesireEdge, type TravelCell } from '@arbestra/contracts';

import type { Database } from '../../database/schema.js';
import type { ScheduledTask } from '../../jobs/scheduled-tasks.js';

/**
 * Desire lines observed (docs/SPEC-REFONTE-TRAJETS-2026-11-10.md §4.3 and §17,
 * slice T3a). One task per open world adds the edges of the missions admitted
 * in that world to `world_desire_edges`. Nothing is written by the commands
 * that admit a mission: no row lock between neighbouring villages, no V2
 * publication held until their COMMIT.
 *
 * The task takes no village row and no zone. It reads `deposit_extractions`
 * (wood, stone and stumps), `garden_harvests` (outward legs, tour stops and
 * return) and the `survey` and `exploration` trips of `science_activities`.
 * Trade journeys and expedition submissions are not counted (§8.4). The
 * scheduler's frame applies: the task was taken with SKIP LOCKED, it
 * acknowledges nothing but itself (the scheduler does), and it reads, locks or
 * modifies no other notification.
 *
 * Commit-safe selection (§17 point 3). `started_at` is read from the database
 * clock after a command has taken its village, but the command commits later,
 * after its zone and deposit waits: a mission can become visible after a more
 * recent one was counted. A `(started_at, id)` cursor would skip it. The task
 * therefore re-reads a window and keeps a ledger of the missions already
 * counted:
 *
 * - a run reads, in its world, the missions with `started_at >= watermark` that
 *   are not in `world_desire_missions`, oldest first, at most `limit`;
 * - it records those in the ledger and adds their edges, in one transaction (a
 *   mission is counted exactly once, even if two runs overlapped);
 * - the watermark then moves to `now - DESIRE_MARGIN_MS`, or no further than
 *   the last mission read when the run was cut by its limit. A mission still
 *   invisible at `now` commits after `now` and started at most
 *   `DESIRE_MARGIN_MS` before it: it is at or after the next watermark. The
 *   watermark, not the clock, bounds the window, so a stopped scheduler (a
 *   restart, an outage) loses no mission either;
 * - ledger rows older than the watermark by one more margin are deleted: they
 *   can no longer be read.
 *
 * Counting starts when the world is open (`counting_from`: the migration for
 * the worlds of 085, the opening for later ones): earlier missions are not
 * back-filled, the starting state is the display of the day (decision 9, §17).
 */
export const DESIRE_PATHS_TASK = 'world.desire-paths';

/** Delay of the next run. A new path shows up on screen after about this long. */
export const DESIRE_PATHS_INTERVAL_MS = 60_000;
/** Delay of the next run when this one was cut by its limit: more missions wait. */
export const DESIRE_PATHS_CONTINUE_MS = 1_000;

/**
 * Longest span between the moment a mission takes its `started_at` and the
 * moment its transaction commits, with room to spare. A command reads the
 * statement time once its village is held, then waits for its zones and
 * deposits, computes, writes, and waits for the V2 stream rows at COMMIT.
 * Every lock wait is capped by `lock_timeout`: 4 s for a command
 * (`COMMAND_LOCK_TIMEOUT_MS`), 1.5 s inside a scheduler task
 * (`TASK_LOCK_TIMEOUT_MS`); the caps apply to each wait, not to the whole
 * transaction, and a command takes at most 16 ordinary zones (128 on RC1).
 * Taken at their worst, 16 zone waits (64 s) plus the deposit and the COMMIT
 * (8 s) plus about 10 s of path computation make 82 s; an honest command lasts
 * under a second, and a client gives up at 15 s. 120 s covers the worst case
 * with a margin. The connection of a command carries no `statement_timeout`
 * or `idle_in_transaction_session_timeout`: a transaction left open longer
 * than the margin (a blocked process) would have its mission counted never,
 * which for a decorative passage count is a lost footprint, not a double count.
 */
export const DESIRE_MARGIN_MS = 120_000;
/** Missions read per run; more are left for the next run, one second later. */
export const DESIRE_MISSIONS_PER_RUN = 200;
/** Edge rows per upsert statement. */
export const DESIRE_EDGE_ROWS_PER_STATEMENT = 1_000;

type Source = 'deposit' | 'garden' | 'science';
interface Mission {
  source: Source;
  id: string;
  startedAt: Date;
  paths: TravelCell[][];
}

/**
 * Keeps one pending `world.desire-paths` notification for a world: a new one
 * only when none other than `ownTaskId` (still pending while its handler runs)
 * exists. Existing notifications are read, never locked, updated or
 * acknowledged. Same shape as `ensurePopulationEnergyWake` (071).
 */
export async function scheduleDesirePathsTask(
  tx: Transaction<Database>,
  worldId: string,
  delayMs: number,
  ownTaskId?: string,
): Promise<void> {
  await sql`insert into scheduled_tasks(world_id,task_type,subject_id,payload,due_at,available_at)
    select ${worldId}::uuid,${DESIRE_PATHS_TASK},${worldId}::uuid,jsonb_build_object('worldId',${worldId}::text),
      statement_timestamp() + (${delayMs} * interval '1 millisecond'),
      statement_timestamp() + (${delayMs} * interval '1 millisecond')
    where not exists(select 1 from scheduled_tasks where world_id=${worldId}::uuid
      and task_type=${DESIRE_PATHS_TASK} and subject_id=${worldId}::uuid and completed_at is null
      ${ownTaskId ? sql`and id<>${ownTaskId}::uuid` : sql``})
    on conflict (world_id,subject_id,due_at) where task_type='world.desire-paths' and completed_at is null
    do nothing`.execute(tx);
}

/**
 * Starts counting in a world, once: its state row (now) and its notification.
 * Idempotent; called wherever a world is created open or opened. A world that
 * is not open has nothing to count.
 */
export async function ensureDesirePathsTask(tx: Transaction<Database>, worldId: string): Promise<void> {
  await tx
    .insertInto('worldDesireState')
    .values({ worldId, countingFrom: sql`statement_timestamp()`, watermark: sql`statement_timestamp()` })
    .onConflict((conflict) => conflict.column('worldId').doNothing())
    .execute();
  await scheduleDesirePathsTask(tx, worldId, DESIRE_PATHS_INTERVAL_MS);
}

const asPath = (value: unknown): TravelCell[] =>
  Array.isArray(value)
    ? value.filter(
        (p): p is TravelCell =>
          !!p &&
          typeof p === 'object' &&
          Number.isFinite((p as TravelCell).cellX) &&
          Number.isFinite((p as TravelCell).cellY),
      )
    : [];

/** The first `limit + 1` missions of a source not yet counted, oldest first. */
async function depositMissions(tx: Transaction<Database>, worldId: string, from: Date, limit: number) {
  const rows = await tx
    .selectFrom('depositExtractions as d')
    .select(['d.id', 'd.startedAt', 'd.pathCells'])
    .where('d.worldId', '=', worldId)
    .where('d.startedAt', '>=', from)
    .where(
      sql<boolean>`not exists(select 1 from world_desire_missions m
        where m.world_id=d.world_id and m.source='deposit' and m.mission_id=d.id)`,
    )
    .orderBy('d.startedAt')
    .orderBy('d.id')
    .limit(limit + 1)
    .execute();
  return rows.map<Mission>((r) => ({
    source: 'deposit',
    id: r.id,
    startedAt: r.startedAt,
    paths: [asPath(r.pathCells)],
  }));
}

async function gardenMissions(tx: Transaction<Database>, worldId: string, from: Date, limit: number) {
  const rows = await tx
    .selectFrom('gardenHarvests as g')
    .select(['g.id', 'g.startedAt', 'g.pathCells', 'g.stops', 'g.returnPathCells'])
    .where('g.worldId', '=', worldId)
    .where('g.startedAt', '>=', from)
    .where(
      sql<boolean>`not exists(select 1 from world_desire_missions m
        where m.world_id=g.world_id and m.source='garden' and m.mission_id=g.id)`,
    )
    .orderBy('g.startedAt')
    .orderBy('g.id')
    .limit(limit + 1)
    .execute();
  // A tour keeps its first outward leg in `path_cells` as well as in its first
  // stop; a row from before tours has `path_cells` alone. Edges are counted
  // once per mission, so the repetition costs nothing.
  return rows.map<Mission>((r) => ({
    source: 'garden',
    id: r.id,
    startedAt: r.startedAt,
    paths: [
      asPath(r.pathCells),
      ...(Array.isArray(r.stops) ? r.stops.map((stop) => asPath(stop?.path)) : []),
      asPath(r.returnPathCells),
    ],
  }));
}

async function scienceMissions(tx: Transaction<Database>, worldId: string, from: Date, limit: number) {
  const rows = await tx
    .selectFrom('scienceActivities as s')
    .select(['s.id', 's.startedAt', 's.pathCells'])
    .where('s.worldId', '=', worldId)
    .where(sql<boolean>`s.kind in ('survey','exploration')`)
    .where('s.startedAt', '>=', from)
    .where(
      sql<boolean>`not exists(select 1 from world_desire_missions m
        where m.world_id=s.world_id and m.source='science' and m.mission_id=s.id)`,
    )
    .orderBy('s.startedAt')
    .orderBy('s.id')
    .limit(limit + 1)
    .execute();
  return rows.map<Mission>((r) => ({
    source: 'science',
    id: r.id,
    startedAt: r.startedAt,
    paths: [asPath(r.pathCells)],
  }));
}

export interface DesirePathsOptions {
  limit?: number;
  marginMs?: number;
}
export interface DesirePathsRun {
  /** Missions counted by this run. */
  counted: number;
  /** More missions wait: the next run follows quickly. */
  truncated: boolean;
}

/**
 * One run of the task, in the scheduler's transaction (see the header). The
 * caller owns `task`, which stays pending until the scheduler acknowledges it.
 */
export async function aggregateDesirePaths(
  tx: Transaction<Database>,
  task: ScheduledTask,
  { limit = DESIRE_MISSIONS_PER_RUN, marginMs = DESIRE_MARGIN_MS }: DesirePathsOptions = {},
): Promise<DesirePathsRun> {
  const worldId = task.worldId;
  const world = await tx
    .selectFrom('worlds')
    .select(['widthCells', 'heightCells'])
    .where('id', '=', worldId)
    .executeTakeFirst();
  if (!world) return { counted: 0, truncated: false };
  // Read before any mission: whatever is invisible to the reads below commits
  // after this instant (see the header).
  const { now } = await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('now')).executeTakeFirstOrThrow();
  let state = await tx
    .selectFrom('worldDesireState')
    .select('watermark')
    .where('worldId', '=', worldId)
    .executeTakeFirst();
  if (!state) {
    // A world the migration or its opening did not seed (a fixture, an
    // operator's insert) starts counting at its first run.
    await tx
      .insertInto('worldDesireState')
      .values({ worldId, countingFrom: now, watermark: now })
      .onConflict((conflict) => conflict.column('worldId').doNothing())
      .execute();
    state = await tx
      .selectFrom('worldDesireState')
      .select('watermark')
      .where('worldId', '=', worldId)
      .executeTakeFirstOrThrow();
  }

  const candidates = [
    ...(await depositMissions(tx, worldId, state.watermark, limit)),
    ...(await gardenMissions(tx, worldId, state.watermark, limit)),
    ...(await scienceMissions(tx, worldId, state.watermark, limit)),
  ].sort(
    (a, b) =>
      a.startedAt.getTime() - b.startedAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : a.source < b.source ? -1 : 1),
  );
  const missions = candidates.slice(0, limit),
    truncated = candidates.length > limit;

  let counted = 0;
  if (missions.length) {
    // The ledger decides what counts: only the rows this statement inserts, so
    // a mission another run recorded first adds nothing.
    const recorded = await tx
      .insertInto('worldDesireMissions')
      .values(missions.map((m) => ({ worldId, source: m.source, missionId: m.id, startedAt: m.startedAt })))
      .onConflict((conflict) => conflict.columns(['worldId', 'source', 'missionId']).doNothing())
      .returning(['source', 'missionId'])
      .execute();
    const fresh = new Set(recorded.map((r) => `${r.source}:${r.missionId}`));
    const passages = new Map<
      number,
      { cellX: number; cellY: number; direction: DesireEdge['direction']; passages: number; lastPassageAt: Date }
    >();
    for (const mission of missions) {
      if (!fresh.has(`${mission.source}:${mission.id}`)) continue;
      counted++;
      for (const edge of desireEdges(mission.paths, world)) {
        const key = (edge.cellY * world.widthCells + edge.cellX) * 4 + edge.direction,
          known = passages.get(key);
        if (known) {
          known.passages++;
          if (mission.startedAt > known.lastPassageAt) known.lastPassageAt = mission.startedAt;
        } else passages.set(key, { ...edge, passages: 1, lastPassageAt: mission.startedAt });
      }
    }
    // Primary-key order, in lots: the same order in every writer, bounded statements.
    const rows = [...passages.values()].sort(
      (a, b) => a.cellX - b.cellX || a.cellY - b.cellY || a.direction - b.direction,
    );
    for (let i = 0; i < rows.length; i += DESIRE_EDGE_ROWS_PER_STATEMENT)
      await tx
        .insertInto('worldDesireEdges')
        .values(rows.slice(i, i + DESIRE_EDGE_ROWS_PER_STATEMENT).map((row) => ({ worldId, ...row })))
        .onConflict((conflict) =>
          conflict.columns(['worldId', 'cellX', 'cellY', 'direction']).doUpdateSet({
            passages: sql`world_desire_edges.passages + excluded.passages`,
            lastPassageAt: sql`greatest(world_desire_edges.last_passage_at, excluded.last_passage_at)`,
          }),
        )
        .execute();
  }

  // The next window starts a margin before now, or at the last mission read
  // when a limit cut this one (the missions after it were not read at all).
  const next = Math.min(now.getTime() - marginMs, truncated ? missions.at(-1)!.startedAt.getTime() : Infinity);
  const moved = await tx
    .updateTable('worldDesireState')
    .set({ watermark: sql`greatest(watermark, ${new Date(next)}::timestamptz)` })
    .where('worldId', '=', worldId)
    .returning('watermark')
    .executeTakeFirstOrThrow();
  await tx
    .deleteFrom('worldDesireMissions')
    .where('worldId', '=', worldId)
    .where('startedAt', '<', new Date(moved.watermark.getTime() - marginMs))
    .execute();

  await scheduleDesirePathsTask(tx, worldId, truncated ? DESIRE_PATHS_CONTINUE_MS : DESIRE_PATHS_INTERVAL_MS, task.id);
  return { counted, truncated };
}

/** The scheduler's handler for `world.desire-paths`. */
export async function aggregateDesireEdges(tx: Transaction<Database>, task: ScheduledTask): Promise<void> {
  await aggregateDesirePaths(tx, task);
}

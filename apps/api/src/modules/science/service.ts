import { sql, type Transaction } from 'kysely';
import type { ScienceCommand, ScienceState, TravelCell } from '@arbestra/contracts';
import { combinedPeriod, measureRegime, TAU } from '@arbestra/contracts/cosmology';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { assignWorkers, eligibleWorkers, materializeCohorts, releaseWorkers, withoutAssignment, energyState } from '../population/work.js';
import { beginRest, canWorkFor } from '../population/energy.js';
import type { VillageEconomy } from '../villages/reconcile-economy.js';
import { normalizeCell } from '../worlds/coordinates.js';
import { CARTOGRAPHER_TRAINING_MS, knowledgeProfile, prerequisitesMet, programVisible, SCIENCE_PROGRAMS, UNIVERSITY_CAPACITIES, type Mastery, type ProgramDefinition } from './programs.js';
import { sciencePath, type ScienceWorld } from './navigation.js';

export const SCIENCE_WAKE_TASK = 'science.wake';
// Short reservations let several centres contribute and staffing changes apply
// promptly, while staying below the product's ten-minute maximum batch.
const BATCH_MS = 60_000;
const SURVEY_MS = 60_000;
const HISTORICAL_HALF_SIZE = 32;
const key = (p: TravelCell) => `${p.cellX}:${p.cellY}`;

async function context(tx: Transaction<Database>, economy: VillageEconomy) {
  return tx.selectFrom('villages').innerJoin('worlds', 'worlds.id', 'villages.worldId')
    .select(['ownerAccountId', 'anchorCellX', 'anchorCellY', 'widthCells', 'heightCells', 'chunkSize'])
    .where('villages.worldId', '=', economy.worldId).where('villages.id', '=', economy.villageId).executeTakeFirstOrThrow();
}

/** The village is already locked. This player/world latch serializes shared
 * mastery; nothing under it acquires another village or a deposit lock. */
export async function lockScience(tx: Transaction<Database>, economy: VillageEconomy) {
  const village = await context(tx, economy);
  await tx.insertInto('playerScience').values({ worldId: economy.worldId, accountId: village.ownerAccountId,
    observationsSince: null, solarReport: null }).onConflict(oc => oc.columns(['worldId', 'accountId']).doNothing()).execute();
  const science = await tx.selectFrom('playerScience').selectAll().where('worldId', '=', economy.worldId)
    .where('accountId', '=', village.ownerAccountId).forUpdate().executeTakeFirstOrThrow();
  return { village, science, accountId: village.ownerAccountId };
}

async function levelsFor(tx: Transaction<Database>, worldId: string, accountId: string): Promise<Mastery> {
  const rows = await tx.selectFrom('sciencePrograms').select(['discipline', 'level']).where('worldId', '=', worldId)
    .where('accountId', '=', accountId).where('acquiredAt', 'is not', null).execute();
  const levels: Mastery = { mathematics: 0, geography: 0, astronomy: 0 };
  for (const row of rows) levels[row.discipline] = Math.max(levels[row.discipline], row.level);
  return levels;
}

async function evidence(tx: Transaction<Database>, worldId: string, accountId: string) {
  const places = await tx.selectFrom('sciencePlaces').select(['cellX', 'cellY']).where('worldId', '=', worldId)
    .where('accountId', '=', accountId).where('surveyed', '=', true).execute();
  const science = await tx.selectFrom('playerScience').select(['solarReport', 'observationsSince'])
    .where('worldId', '=', worldId).where('accountId', '=', accountId).executeTakeFirstOrThrow();
  return { places: places.length, solar: science.solarReport !== null, since: science.observationsSince };
}
function evidenceMet(program: ProgramDefinition, facts: { places: number; solar: boolean }) {
  return program.evidence === 'none' || (program.evidence === 'surveys' ? facts.places >= 2 : facts.solar);
}
function needsFor(program: ProgramDefinition, facts: { places: number; solar: boolean }) {
  return evidenceMet(program, facts) ? [] : [program.evidence === 'surveys'
    ? `Deux relevés rapportés de lieux distincts (${Math.min(2, facts.places)}/2).`
    : 'Une campagne locale d’observations du ciel sur 24 heures réelles.'];
}

async function notify(tx: Transaction<Database>, economy: VillageEconomy, subjectId: string, dueAt: Date) {
  await tx.insertInto('scheduledTasks').values({ worldId: economy.worldId, taskType: SCIENCE_WAKE_TASK, subjectId,
    payload: { villageId: economy.villageId }, dueAt, availableAt: dueAt, lastError: null, completedAt: null })
    .onConflict(oc => oc.doNothing()).execute();
}

/** Shared evidence/mastery can unblock another campus. Notify it without
 * acquiring its village; its worker will respect the normal village-first order. */
async function wakeOtherCampuses(tx: Transaction<Database>, economy: VillageEconomy, accountId: string) {
  const campuses = await tx.selectFrom('buildings').innerJoin('villages', join => join.onRef('villages.id', '=', 'buildings.villageId').onRef('villages.worldId', '=', 'buildings.worldId'))
    .select('buildings.villageId').distinct().where('buildings.worldId', '=', economy.worldId).where('villages.ownerAccountId', '=', accountId)
    .where('buildingType', '=', 'university').where('status', '=', 'completed').where('buildings.villageId', '!=', economy.villageId).execute();
  for (const campus of campuses) await notify(tx, { ...economy, villageId: campus.villageId }, campus.villageId, economy.through);
}

/** Actual immutable terrain measurements; called only for known initial ground
 * or cells genuinely visited by a returned survey. */
async function recordPlaces(tx: Transaction<Database>, world: ScienceWorld, accountId: string, cells: TravelCell[],
  at: Date, surveyed: boolean, activityId: string | null) {
  const unique = [...new Map(cells.map(p => [key(p), p])).values()];
  const wanted = new Map(unique.map(p => {
    const chunkX = Math.floor(p.cellX / world.chunkSize), chunkY = Math.floor(p.cellY / world.chunkSize);
    return [`${chunkX}:${chunkY}`, { chunkX, chunkY }] as const;
  }));
  if (!wanted.size) return;
  const chunks = await tx.selectFrom('worldChunks').select(['chunkX', 'chunkY', 'terrainCodes', 'elevations']).where('worldId', '=', world.id)
    .where(eb => eb.or([...wanted.values()].map(c => eb.and([eb('chunkX', '=', c.chunkX), eb('chunkY', '=', c.chunkY)])))).execute();
  const byChunk = new Map(chunks.map(c => [`${c.chunkX}:${c.chunkY}`, c]));
  const rows = unique.map(p => {
    const chunk = byChunk.get(`${Math.floor(p.cellX / world.chunkSize)}:${Math.floor(p.cellY / world.chunkSize)}`);
    if (!chunk) throw new HttpError(409, 'WORLD_NOT_READY', 'Terrain incomplet pour les relevés.');
    const index = p.cellY % world.chunkSize * world.chunkSize + p.cellX % world.chunkSize;
    return { worldId: world.id, accountId, ...p, terrainCode: chunk.terrainCodes[index]!, elevation: chunk.elevations[index]!,
      observedAt: at, surveyed, sourceActivityId: activityId };
  });
  for (let i = 0; i < rows.length; i += 500) await tx.insertInto('sciencePlaces').values(rows.slice(i, i + 500))
    .onConflict(oc => oc.columns(['worldId', 'accountId', 'cellX', 'cellY']).doUpdateSet({
      surveyed: sql`science_places.surveyed or excluded.surveyed`, terrainCode: sql`excluded.terrain_code`,
      elevation: sql`excluded.elevation`, observedAt: sql`greatest(science_places.observed_at,excluded.observed_at)`,
      sourceActivityId: sql`coalesce(excluded.source_activity_id,science_places.source_activity_id)`,
    })).execute();
}

async function initializeKnowledge(tx: Transaction<Database>, economy: VillageEconomy) {
  const { village, science, accountId } = await lockScience(tx, economy);
  const first = await tx.selectFrom('buildings').innerJoin('villages', 'villages.id', 'buildings.villageId')
    .select(['buildings.completedAt', 'buildings.id', 'villages.anchorCellX as observationX', 'villages.anchorCellY as observationY']).where('buildings.worldId', '=', economy.worldId)
    .where('villages.worldId', '=', economy.worldId).where('villages.ownerAccountId', '=', accountId)
    .where('buildingType', '=', 'university').where('completedAt', 'is not', null).orderBy('buildings.completedAt').executeTakeFirst();
  if (!science.observationsSince && first?.completedAt) {
    science.observationsSince = first.completedAt;
    await tx.updateTable('playerScience').set({ observationsSince: first.completedAt }).where('worldId', '=', economy.worldId).where('accountId', '=', accountId).execute();
    await notify(tx, economy, first.id, new Date(first.completedAt.getTime() + combinedPeriod()));
  }
  if (!science.solarReport && science.observationsSince && economy.through.getTime() >= science.observationsSince.getTime() + combinedPeriod()) {
    const observationX = first?.observationX ?? village.anchorCellX, observationY = first?.observationY ?? village.anchorCellY;
    const u = observationX / village.widthCells * TAU, v = observationY / village.heightCells * TAU + Math.PI;
    const regime = measureRegime(u, v);
    await tx.updateTable('playerScience').set({ solarReport: JSON.stringify({ cellX: observationX, cellY: observationY,
      from: science.observationsSince.toISOString(), through: new Date(science.observationsSince.getTime() + combinedPeriod()).toISOString(),
      days: regime.days, dayFraction: regime.dayFraction, intervals: regime.intervals, samples: 1024 }) })
      .where('worldId', '=', economy.worldId).where('accountId', '=', accountId).execute();
    await wakeOtherCampuses(tx, economy, accountId);
  }
  // Current historical 64×64 snapshot, per village; never grant a mastery.
  const initial = await tx.selectFrom('sciencePlaces').select('cellX').where('worldId', '=', economy.worldId).where('accountId', '=', accountId)
    .where('cellX', '=', village.anchorCellX).where('cellY', '=', village.anchorCellY).executeTakeFirst();
  if (!initial) {
    const cells: TravelCell[] = [];
    for (let y = -HISTORICAL_HALF_SIZE; y < HISTORICAL_HALF_SIZE; y++) for (let x = -HISTORICAL_HALF_SIZE; x < HISTORICAL_HALF_SIZE; x++)
      cells.push({ cellX: normalizeCell(village.anchorCellX + x, village.widthCells), cellY: normalizeCell(village.anchorCellY + y, village.heightCells) });
    await recordPlaces(tx, { id: economy.worldId, ...village }, accountId, cells, economy.through, false, null);
  }
  return { village, accountId };
}

async function acquireReady(tx: Transaction<Database>, economy: VillageEconomy, accountId: string) {
  const facts = await evidence(tx, economy.worldId, accountId);
  const programs = await tx.selectFrom('sciencePrograms').selectAll().where('worldId', '=', economy.worldId).where('accountId', '=', accountId)
    .where('acquiredAt', 'is', null).where('paused', '=', false).execute();
  for (const row of programs) {
    const definition = SCIENCE_PROGRAMS.find(p => p.code === row.code)!;
    if (Number(row.workDoneMs) >= definition.workRequiredMs && evidenceMet(definition, facts)) {
      await tx.updateTable('sciencePrograms').set({ acquiredAt: economy.through }).where('worldId', '=', economy.worldId)
        .where('accountId', '=', accountId).where('code', '=', row.code).where('acquiredAt', 'is', null).execute();
      await wakeOtherCampuses(tx, economy, accountId);
    }
  }
}

/** Called in chronological order with the village's other due transitions. */
export async function completeScienceAt(tx: Transaction<Database>, economy: VillageEconomy, id: string, at: Date) {
  const { accountId, village } = await lockScience(tx, economy);
  const activity = await tx.selectFrom('scienceActivities').selectAll().where('worldId', '=', economy.worldId)
    .where('villageId', '=', economy.villageId).where('id', '=', id).executeTakeFirst();
  if (!activity || activity.status !== 'in-progress' || activity.completesAt.getTime() !== at.getTime()) return;
  const cohorts = await materializeCohorts(tx, economy.worldId, economy.villageId, at);
  const workers = cohorts.filter(c => c.scienceActivityId === id);
  if (activity.kind === 'training') await tx.updateTable('populationCohorts').set({ cartographer: true })
    .where('worldId', '=', economy.worldId).where('villageId', '=', economy.villageId).where('scienceActivityId', '=', id).execute();
  await releaseWorkers(tx, workers, activity.workerCount, at);
  await tx.updateTable('scienceActivities').set({ status: 'completed', completedAt: at }).where('worldId', '=', economy.worldId).where('id', '=', id).execute();
  if (activity.kind === 'research') await tx.updateTable('sciencePrograms').set({ workDoneMs: sql`work_done_ms + ${activity.workMs}::bigint` })
    .where('worldId', '=', economy.worldId).where('accountId', '=', accountId).where('code', '=', activity.programCode!).execute();
  if (activity.kind === 'survey' || activity.kind === 'exploration') {
    const world = { id: economy.worldId, ...village };
    await recordPlaces(tx, world, accountId, activity.pathCells, at, false, id);
    await recordPlaces(tx, world, accountId, activity.surveyCells, at, true, id);
    await wakeOtherCampuses(tx, economy, accountId);
    // Dated exterior report. Never expose owner, stocks, workers or live production.
    const visited = new Set(activity.pathCells.map(key));
    const relative = (n: number, centre: number, size: number) => ((n-centre+size/2)%size+size)%size-size/2;
    const others = await tx.selectFrom('villages').select(['id', 'name', 'anchorCellX', 'anchorCellY']).where('worldId', '=', economy.worldId)
      .where('ownerAccountId', '!=', accountId).execute();
    for (const other of others) if (visited.has(key({ cellX: other.anchorCellX, cellY: other.anchorCellY }))) {
      const blocks = await tx.selectFrom('worldCellOccupancies').innerJoin('buildings', join => join.onRef('buildings.worldId', '=', 'worldCellOccupancies.worldId').onRef('buildings.id', '=', 'worldCellOccupancies.buildingId'))
        .select(['cellX', 'cellY', 'buildingType']).where('buildings.worldId', '=', economy.worldId).where('buildings.villageId', '=', other.id).limit(64).execute();
      await tx.insertInto('scienceVillageReports').values({ worldId: economy.worldId, accountId, villageId: other.id, name: other.name,
        anchorCellX: other.anchorCellX, anchorCellY: other.anchorCellY, observedAt: at,
        blocks: JSON.stringify(blocks.map(c => ({ x: relative(c.cellX,other.anchorCellX,village.widthCells), y: relative(c.cellY,other.anchorCellY,village.heightCells), width: 1, depth: 1, garden: c.buildingType === 'garden' }))) })
        .onConflict(oc => oc.columns(['worldId', 'accountId', 'villageId']).doUpdateSet({ name: other.name, observedAt: at, blocks: sql`excluded.blocks` })).execute();
    }
  }
  await acquireReady(tx, { ...economy, through: at }, accountId);
}

async function freeCapacity(tx: Transaction<Database>, economy: VillageEconomy, buildingId: string) {
  const building = await tx.selectFrom('buildings').select(['level', 'status', 'buildingType']).where('worldId', '=', economy.worldId)
    .where('villageId', '=', economy.villageId).where('id', '=', buildingId).executeTakeFirst();
  if (!building || building.buildingType !== 'university' || building.status !== 'completed') return null;
  const capacity = UNIVERSITY_CAPACITIES.find(c => c.level === building.level)!;
  const active = await tx.selectFrom('scienceActivities').select('workerCount').where('worldId', '=', economy.worldId)
    .where('buildingId', '=', buildingId).where('status', '=', 'in-progress').execute();
  return { centres: capacity.centres - active.length, workers: capacity.workers - active.reduce((n, a) => n + a.workerCount, 0) };
}

async function startActivity(tx: Transaction<Database>, economy: VillageEconomy, accountId: string,
  input: { buildingId: string | null; programCode: string | null; kind: 'research' | 'training' | 'survey' | 'exploration';
    workers: number; durationMs: number; workMs: number; path?: TravelCell[]; surveys?: TravelCell[] }) {
  const cohorts = await materializeCohorts(tx, economy.worldId, economy.villageId, economy.through);
  const eligible = eligibleWorkers(cohorts, input.durationMs).filter(c => input.kind !== 'survey' && input.kind !== 'exploration' || c.cartographer)
    .filter(c => input.kind !== 'training' || !c.cartographer);
  if (eligible.reduce((n, c) => n + c.memberCount, 0) < input.workers) return false;
  const completesAt = new Date(economy.through.getTime() + input.durationMs);
  const activity = await tx.insertInto('scienceActivities').values({ worldId: economy.worldId, villageId: economy.villageId, accountId,
    buildingId: input.buildingId, programCode: input.programCode, kind: input.kind, workerCount: input.workers,
    workMs: input.workMs, startedAt: economy.through, completesAt, completedAt: null, status: 'in-progress',
    pathCells: sql`${JSON.stringify(input.path ?? [])}::jsonb`, surveyCells: sql`${JSON.stringify(input.surveys ?? [])}::jsonb` }).returning('id').executeTakeFirstOrThrow();
  await assignWorkers(tx, eligible, input.workers, { harvestId: null, extractionId: null, scienceActivityId: activity.id });
  await notify(tx, economy, activity.id, completesAt);
  return true;
}

/** After manual commands, admit new batches at H, never in the past. Engaged
 * batches retain their due dates; free centres follow least-recently-started order. */
export async function admitScience(tx: Transaction<Database>, economy: VillageEconomy) {
  const { accountId } = await initializeKnowledge(tx, economy);
  await acquireReady(tx, economy, accountId);
  const levels = await levelsFor(tx, economy.worldId, accountId), facts = await evidence(tx, economy.worldId, accountId);
  const astro = SCIENCE_PROGRAMS.find(p => p.code === 'astronomy-1')!;
  if (prerequisitesMet(astro, levels) && facts.solar && !levels.astronomy) {
    await tx.insertInto('sciencePrograms').values({ worldId: economy.worldId, accountId, code: astro.code, discipline: astro.discipline,
      level: 1, workDoneMs: 0, paused: false, acquiredAt: null, createdAt: economy.through, workerCap: 1 })
      .onConflict(oc => oc.columns(['worldId', 'accountId', 'code']).doNothing()).execute();
    const campus = await tx.selectFrom('buildings').select('id').where('worldId', '=', economy.worldId).where('villageId', '=', economy.villageId)
      .where('buildingType', '=', 'university').where('status', '=', 'completed').orderBy('id').executeTakeFirst();
    if (campus) await tx.insertInto('scienceContributions').values({ worldId: economy.worldId, villageId: economy.villageId, accountId,
      buildingId: campus.id, programCode: astro.code, workerCap: 1, requestedAt: economy.through, lastStartedAt: null })
      .onConflict(oc => oc.columns(['worldId', 'buildingId', 'programCode']).doNothing()).execute();
  }
  const contributions = await tx.selectFrom('scienceContributions').selectAll().where('worldId', '=', economy.worldId)
    .where('villageId', '=', economy.villageId).orderBy(sql`last_started_at asc nulls first`).orderBy('requestedAt').orderBy('programCode').orderBy('buildingId').execute();
  for (const contribution of contributions) {
    const program = await tx.selectFrom('sciencePrograms').selectAll().where('worldId', '=', economy.worldId).where('accountId', '=', accountId)
      .where('code', '=', contribution.programCode).executeTakeFirstOrThrow();
    if (program.acquiredAt || program.paused) continue;
    const definition = SCIENCE_PROGRAMS.find(p => p.code === program.code)!;
    // Theory may proceed without data; the last quarter validates the model.
    const limit = evidenceMet(definition, facts) ? definition.workRequiredMs : Math.floor(definition.workRequiredMs * .75);
    const outstanding = await tx.selectFrom('scienceActivities').select(['workerCount', 'workMs']).where('worldId', '=', economy.worldId)
      .where('accountId', '=', accountId).where('programCode', '=', program.code).where('status', '=', 'in-progress').execute();
    const remaining = limit - Number(program.workDoneMs) - outstanding.reduce((n, a) => n + Number(a.workMs), 0);
    const capacity = await freeCapacity(tx, economy, contribution.buildingId);
    if (!capacity || capacity.centres <= 0 || remaining <= 0) continue;
    const cohorts = await materializeCohorts(tx, economy.worldId, economy.villageId, economy.through);
    const available = eligibleWorkers(cohorts, Math.min(BATCH_MS, remaining)).reduce((n, c) => n + c.memberCount, 0);
    for (const cohort of cohorts) {
      if (!withoutAssignment(cohort) || cohort.activity !== 'idle' || canWorkFor(energyState(cohort), Math.min(BATCH_MS, remaining))) continue;
      const rest = beginRest(energyState(cohort));
      if (rest) await tx.updateTable('populationCohorts').set({ activity: rest.activity, restingSince: rest.restingSince })
        .where('worldId', '=', economy.worldId).where('villageId', '=', economy.villageId).where('id', '=', cohort.id).execute();
    }
    const workers = Math.min(capacity.workers, contribution.workerCap, available,
      program.workerCap - outstanding.reduce((n, a) => n + a.workerCount, 0));
    if (workers < 1) continue;
    const durationMs = Math.min(BATCH_MS, Math.ceil(remaining / workers));
    if (await startActivity(tx, economy, accountId, { kind: 'research', buildingId: contribution.buildingId, programCode: program.code,
      workers, durationMs, workMs: Math.min(remaining, durationMs * workers) }))
      await tx.updateTable('scienceContributions').set({ lastStartedAt: economy.through }).where('worldId', '=', economy.worldId)
        .where('buildingId', '=', contribution.buildingId).where('programCode', '=', program.code).execute();
  }
  // Rest/centre waiting must progress offline. Missing evidence instead wakes
  // at the survey return or solar deadline; it needs no minute-by-minute polling.
  const pendingPrograms = contributions.length ? await tx.selectFrom('sciencePrograms').selectAll().where('worldId', '=', economy.worldId).where('accountId', '=', accountId)
    .where('code', 'in', contributions.map(c => c.programCode)).where('acquiredAt', 'is', null).where('paused', '=', false).execute() : [];
  const pending = pendingPrograms.some(p => {
    const definition = SCIENCE_PROGRAMS.find(d => d.code === p.code)!;
    return Number(p.workDoneMs) < definition.workRequiredMs * (evidenceMet(definition, facts) ? 1 : .75);
  });
  const localActive = await tx.selectFrom('scienceActivities').select('id').where('worldId', '=', economy.worldId)
    .where('villageId', '=', economy.villageId).where('status', '=', 'in-progress').executeTakeFirst();
  if (pending && !localActive) {
    const wake = new Date(Math.floor(economy.through.getTime() / 60_000) * 60_000 + 60_000);
    await tx.insertInto('scheduledTasks').values({ worldId: economy.worldId, taskType: SCIENCE_WAKE_TASK, subjectId: economy.villageId,
      payload: { villageId: economy.villageId }, dueAt: wake, availableAt: wake, completedAt: null, lastError: null })
      .onConflict(oc => oc.doNothing()).execute();
  }
}

export async function scienceCommand(tx: Transaction<Database>, economy: VillageEconomy, command: ScienceCommand) {
  const { village, accountId } = await initializeKnowledge(tx, economy), levels = await levelsFor(tx, economy.worldId, accountId);
  if (command.action === 'pause' || command.action === 'resume') {
    const changed = await tx.updateTable('sciencePrograms').set({ paused: command.action === 'pause' }).where('worldId', '=', economy.worldId)
      .where('accountId', '=', accountId).where('code', '=', command.programCode).where('acquiredAt', 'is', null).executeTakeFirst();
    if (!Number(changed.numUpdatedRows)) throw new HttpError(404, 'SCIENCE_PROGRAM_NOT_FOUND', 'Programme actif introuvable.');
  } else if (command.action === 'research') {
    const definition = SCIENCE_PROGRAMS.find(p => p.code === command.programCode);
    if (!definition || !prerequisitesMet(definition, levels) || levels[definition.discipline] >= definition.level)
      throw new HttpError(409, 'SCIENCE_PREREQUISITES', 'Ce programme n’est pas accessible.');
    if (definition.spontaneous && !await tx.selectFrom('sciencePrograms').select('code').where('worldId', '=', economy.worldId)
      .where('accountId', '=', accountId).where('code', '=', definition.code).executeTakeFirst())
      throw new HttpError(409, 'ASTRONOMY_OBSERVATIONS_PENDING', 'Cette campagne naît spontanément des observations des habitants.');
    const campus = await freeCapacity(tx, economy, command.buildingId);
    if (!campus) throw new HttpError(409, 'UNIVERSITY_NOT_READY', 'Université terminée requise.');
    await tx.insertInto('sciencePrograms').values({ worldId: economy.worldId, accountId, code: definition.code, discipline: definition.discipline,
      level: definition.level, workDoneMs: 0, paused: false, acquiredAt: null, createdAt: economy.through, workerCap: command.workerCount })
      .onConflict(oc => oc.columns(['worldId', 'accountId', 'code']).doUpdateSet({ workerCap: command.workerCount })).execute();
    await tx.insertInto('scienceContributions').values({ worldId: economy.worldId, villageId: economy.villageId, accountId, buildingId: command.buildingId,
      programCode: definition.code, workerCap: command.workerCount, requestedAt: economy.through, lastStartedAt: null })
      .onConflict(oc => oc.columns(['worldId', 'buildingId', 'programCode']).doUpdateSet({ workerCap: command.workerCount })).execute();
  } else if (command.action === 'train') {
    if (levels.geography < 1) throw new HttpError(409, 'GEOGRAPHY_REQUIRED', 'Géographie 1 est nécessaire pour former un cartographe.');
    const capacity = await freeCapacity(tx, economy, command.buildingId);
    if (!capacity || capacity.centres < 1 || capacity.workers < 1)
      throw new HttpError(409, 'UNIVERSITY_CAPACITY', 'Aucun centre libre dans cette Université.');
    if (!await startActivity(tx, economy, accountId, { kind: 'training', buildingId: command.buildingId, programCode: null,
      workers: 1, durationMs: CARTOGRAPHER_TRAINING_MS, workMs: CARTOGRAPHER_TRAINING_MS }))
      throw new HttpError(409, 'SCIENTISTS_UNAVAILABLE', 'Aucun habitant disponible et assez reposé.');
  } else if (command.action === 'survey' || command.action === 'explore') {
    if (levels.geography < (command.action === 'survey' ? 1 : 2)) throw new HttpError(409, 'GEOGRAPHY_REQUIRED', 'Maîtrise géographique insuffisante.');
    if (command.target.cellX >= village.widthCells || command.target.cellY >= village.heightCells)
      throw new HttpError(400, 'INVALID_SURVEY_TARGET', 'Objectif hors des coordonnées canoniques.');
    const known = await tx.selectFrom('sciencePlaces').select(['cellX', 'cellY']).where('worldId', '=', economy.worldId).where('accountId', '=', accountId).execute();
    if (command.action === 'survey' && !known.some(p => key(p) === key(command.target)))
      throw new HttpError(409, 'SURVEY_UNKNOWN_TARGET', 'Ce lieu doit d’abord être repéré par une reconnaissance.');
    const path = await sciencePath(tx, { id: economy.worldId, ...village }, { cellX: village.anchorCellX, cellY: village.anchorCellY }, command.target);
    const maximumSteps = Math.floor((command.budgetSeconds * 1000 - SURVEY_MS) / 2000);
    if (maximumSteps < 0) throw new HttpError(409, 'SURVEY_BUDGET', 'Le budget doit couvrir le relevé et le retour.');
    const outward = path.slice(0, Math.min(path.length, maximumSteps + 1)), target = outward.at(-1)!;
    const durationMs = (outward.length - 1) * 2000 + SURVEY_MS;
    if (!await startActivity(tx, economy, accountId, { kind: command.action === 'survey' ? 'survey' : 'exploration', buildingId: null,
      programCode: null, workers: 1, durationMs, workMs: SURVEY_MS, path: [...outward, ...outward.slice(0, -1).reverse()], surveys: [target] }))
      throw new HttpError(409, 'CARTOGRAPHERS_UNAVAILABLE', 'Aucun cartographe disponible avec assez d’énergie pour revenir.');
  } else if (command.action === 'recall') {
    const activity = await tx.selectFrom('scienceActivities').selectAll().where('worldId', '=', economy.worldId).where('villageId', '=', economy.villageId)
      .where('accountId', '=', accountId).where('id', '=', command.activityId).where('status', '=', 'in-progress').executeTakeFirst();
    if (!activity || !['survey', 'exploration'].includes(activity.kind)) throw new HttpError(404, 'EXPEDITION_NOT_FOUND', 'Expédition en cours introuvable.');
    const outwardCount = Math.floor((activity.pathCells.length + 1) / 2), outward = activity.pathCells.slice(0, outwardCount);
    const elapsed = economy.through.getTime() - activity.startedAt.getTime(), steps = Math.min(outward.length - 1, Math.floor(elapsed / 1000));
    // Already returning: retain the original deadline and report.
    if (elapsed >= (outward.length - 1) * 1000 + SURVEY_MS) return;
    const visited = outward.slice(0, steps + 1), completesAt = new Date(economy.through.getTime() + steps * 1000);
    await tx.updateTable('scienceActivities').set({ completesAt, pathCells: sql`${JSON.stringify([...visited, ...visited.slice(0, -1).reverse()])}::jsonb`,
      surveyCells: sql`'[]'::jsonb` }).where('worldId', '=', economy.worldId).where('id', '=', activity.id).execute();
    await notify(tx, economy, activity.id, completesAt);
  }
}

export async function scienceSnapshot(tx: Transaction<Database>, economy: VillageEconomy): Promise<ScienceState> {
  const { accountId, science } = await lockScience(tx, economy), levels = await levelsFor(tx, economy.worldId, accountId);
  const facts = await evidence(tx, economy.worldId, accountId);
  const programs = await tx.selectFrom('sciencePrograms').selectAll().where('worldId', '=', economy.worldId).where('accountId', '=', accountId).execute();
  const activities = await tx.selectFrom('scienceActivities').selectAll().where('worldId', '=', economy.worldId).where('accountId', '=', accountId)
    .where('status', '=', 'in-progress').orderBy('startedAt').execute();
  const campuses = await tx.selectFrom('buildings').innerJoin('villages', 'villages.id', 'buildings.villageId').select(['buildings.id', 'buildings.villageId', 'buildings.level'])
    .where('buildings.worldId', '=', economy.worldId).where('villages.worldId', '=', economy.worldId).where('villages.ownerAccountId', '=', accountId)
    .where('buildingType', '=', 'university').where('status', '=', 'completed').execute();
  const cohorts = await tx.selectFrom('populationCohorts').innerJoin('villages', 'villages.id', 'populationCohorts.villageId').select('memberCount')
    .where('populationCohorts.worldId', '=', economy.worldId).where('villages.worldId', '=', economy.worldId).where('villages.ownerAccountId', '=', accountId).where('cartographer', '=', true).execute();
  const reports = await tx.selectFrom('scienceVillageReports').selectAll().where('worldId', '=', economy.worldId).where('accountId', '=', accountId).orderBy('observedAt', 'desc').execute();
  const revision = await tx.selectFrom('sciencePlaces').select(sql<Date | null>`max(observed_at)`.as('at')).where('worldId', '=', economy.worldId).where('accountId', '=', accountId).executeTakeFirstOrThrow();
  return { serverTime: economy.through.toISOString(), levels, ...knowledgeProfile(levels, facts.places),
    geographyRevision: revision.at?.getTime() ?? 0,
    programs: SCIENCE_PROGRAMS.filter(p => programVisible(p, levels)).map(definition => {
      const program = programs.find(p => p.code === definition.code), active = activities.some(a => a.programCode === definition.code);
      const needs = needsFor(definition, facts);
      const status = program?.acquiredAt ? 'acquired' : program?.paused ? 'paused' : active ? 'working' : program
        ? needs.length && Number(program.workDoneMs) >= definition.workRequiredMs * .75 ? 'waiting-data' : 'waiting-means'
        : prerequisitesMet(definition, levels) ? 'available' : 'blocked';
      return { code: definition.code, discipline: definition.discipline, level: definition.level, title: definition.title, description: definition.description,
        status, workDoneMs: Number(program?.workDoneMs ?? 0), workRequiredMs: definition.workRequiredMs, needs, spontaneous: definition.spontaneous,
        acquiredAt: program?.acquiredAt?.toISOString() ?? null };
    }), universities: campuses.map(c => { const capacity = UNIVERSITY_CAPACITIES.find(v => v.level === c.level)!;
      const active = activities.filter(a => a.buildingId === c.id); return { buildingId: c.id, villageId: c.villageId, level: c.level,
        centres: capacity.centres, workerCapacity: capacity.workers, occupiedCentres: active.length, mobilizedWorkers: active.reduce((n, a) => n + a.workerCount, 0) }; }),
    activities: activities.map(a => ({ id: a.id, villageId: a.villageId, buildingId: a.buildingId, kind: a.kind, programCode: a.programCode,
      workerCount: a.workerCount, startedAt: a.startedAt.toISOString(), completesAt: a.completesAt.toISOString(), path: a.pathCells,
      target: a.surveyCells[0] ?? null })), cartographers: cohorts.reduce((n, c) => n + c.memberCount, 0), surveyedPlaces: facts.places,
    solarObservations: { since: science.observationsSince?.toISOString() ?? null,
      readyAt: science.observationsSince ? new Date(science.observationsSince.getTime() + combinedPeriod()).toISOString() : null, complete: facts.solar },
    villageReports: reports.map(r => ({ villageId: r.villageId, name: r.name, anchor: { cellX: r.anchorCellX, cellY: r.anchorCellY }, observedAt: r.observedAt.toISOString() })) };
}

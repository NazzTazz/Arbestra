import {claimWoodlandCell} from '../deposits/woodland.js';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { type Kysely, type Transaction } from 'kysely';
import {
  fixedBuildingFootprint, isBuildingFootprintFlat, levelingWork, buildTravelNetwork, refineTravelRoute,
  travelDuration, pathPassageIntersectsBox, spawnDelta,
  type LevelingRequest, type LevelingCommand, type LevelingPreview, type LevelingJob, type VillageState,
} from '@arbestra/contracts';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { readRc1Ground } from '../worlds/rc1-ground.js';
import { readRc1Source } from '../worlds/rc1-source.js';
import { editedRc1Field } from '../onboarding/rc1-field.js';
import { rc1NetworkGround } from '../navigation/rc1-network-ground.js';
import { assignWorkers, eligibleWorkers, materializeCohorts, releaseWorkers } from '../population/work.js';
import { ownedVillage, state, assertBuildableCells, type OwnedVillage } from './service.js';
import { beginVillageEconomy, type VillageEconomy } from './reconcile-economy.js';
import { readNavigationInfrastructure } from './infrastructure.js';

export const COMPLETE_LEVELING_TASK = 'leveling.complete';
const key = (c: { cellX: number; cellY: number }) => `${c.cellX}:${c.cellY}`;
const wrap = (n: number, size: number) => (n % size + size) % size;

/** Called after the village lock, before taking any navigation/deposit lock. */
export async function hasActiveLeveling(tx: Transaction<Database>, worldId: string, villages: string[]) {
  return !!await tx.selectFrom('levelingJobs').select('id').where('worldId', '=', worldId)
    .where('villageId', 'in', villages).where('completedAt', 'is', null).limit(1).executeTakeFirst();
}

async function prepare(tx: Transaction<Database>, v: OwnedVillage, ctx: VillageEconomy, accountId: string, request: LevelingRequest) {
  if (v.generationVersion !== 3) throw new HttpError(409, 'LEVELING_UNAVAILABLE', 'Le nivellement est disponible sur les mondes RC1.');
  if (request.anchor.cellX >= v.widthCells || request.anchor.cellY >= v.heightCells)
    throw new HttpError(400, 'INVALID_COORDINATES', 'Coordonnées non canoniques.');
  const cells = fixedBuildingFootprint(request.buildingType, request.anchor, request.quarterTurns, v);
  // Same rights, reach, water, trees, deposits, roads and engaged passages as construction.
  await assertBuildableCells(tx, v, cells);
  const ground = await readRc1Ground(tx, v.worldId);
  if (isBuildingFootprintFlat(cells.map(c => ground.cell(c.cellX, c.cellY).elevation)))
    throw new HttpError(409, 'ALREADY_LEVEL', 'Cette emprise est déjà plane. Vous pouvez construire.');
  const samples = cells.map(c => Array.from({ length: 64 }, (_, i) => ground.field.sample(c.cellX - .5 + (i % 8 + .5) / 8, c.cellY - .5 + (Math.floor(i / 8) + .5) / 8).elevation));
  const { height, workMs } = levelingWork(samples, request.workerCount);
  // Water is checked over the full surface, including corners, at its final height.
  for (const c of cells) for (let y = 0; y <= 8; y++) for (let x = 0; x <= 8; x++) {
    const s = ground.field.sample(c.cellX - .5 + x / 8, c.cellY - .5 + y / 8);
    if (height <= Math.max(0, s.surface) + 1e-6) throw new HttpError(409, 'LEVELING_WATER', 'Le nivellement ferait entrer l’eau dans cette emprise.');
  }
  const selected = new Set(cells.map(key));
  const terraces = [...ground.terraces.filter(c => !selected.has(key(c))), ...cells.map(c => ({ ...c, height }))].sort((a,b) => a.cellX-b.cellX || a.cellY-b.cellY);
  const source = await readRc1Source(tx, v.worldId);
  const futureField = editedRc1Field(source.data, source.field, terraces, []);
  const future = rc1NetworkGround(source.data, source.field, { ...ground.navigationEdits, terraces }, futureField);
  const foundations = await tx.selectFrom('worldCellOccupancies').select(['cellX', 'cellY']).where('worldId', '=', v.worldId).where('buildingId', 'is not', null).execute();
  for (const c of foundations) {
    if (!cells.some(p => Math.abs(spawnDelta(p.cellX, c.cellX, v.widthCells)) <= 1 && Math.abs(spawnDelta(p.cellY, c.cellY, v.heightCells)) <= 1)) continue;
    for (const dx of [-.5, 0, .5]) for (const dy of [-.5, 0, .5])
      if (ground.field.sample(c.cellX + dx, c.cellY + dy).elevation !== futureField.sample(c.cellX + dx, c.cellY + dy).elevation)
        throw new HttpError(409, 'LEVELING_FOUNDATION', 'Éloignez le chantier de la fondation voisine.');
  }
  const snapshot = await state(tx, accountId, v.worldSlug, ctx, false, true);
  const infrastructure = await readNavigationInfrastructure(tx, v);
  // Neighbours participate as physical obstacles, never as editable buildings.
  const foreign = await tx.selectFrom('worldCellOccupancies as o').innerJoin('buildings as b', j => j.onRef('b.worldId', '=', 'o.worldId').onRef('b.id', '=', 'o.buildingId'))
    .select(['o.cellX', 'o.cellY', 'o.role', 'b.id', 'b.buildingType', 'b.visualLayout', 'b.quarterTurns'])
    .where('o.worldId', '=', v.worldId).where('b.villageId', '!=', v.villageId).execute();
  const foreignCells = foreign.filter(c => wrap(c.cellX - snapshot.region.originCellX, v.widthCells) < snapshot.region.width
    && wrap(c.cellY - snapshot.region.originCellY, v.heightCells) < snapshot.region.height);
  const foreignKeys = new Set(foreignCells.map(key));
  const current = { ...snapshot, infrastructure, cells: [...snapshot.cells.filter(c => !foreignKeys.has(key(c))), ...foreignCells.map(c => ({
    cellX: c.cellX, cellY: c.cellY, footprint: {buildingId:c.id},
    building: c.role === 'anchor' ? {id:c.id,type:c.buildingType,quarterTurns:c.quarterTurns,visualLayout:c.visualLayout} : null,
  }))] };
  const siteId = 'leveling-preview';
  const reserved = { ...current, region: { ...current.region, features: [...current.region.features,
    ...cells.map(c => ({ ...c, id: siteId, type: 'leveling-site', variantSeed: 0, deposit: null }))] } };
  const existing = new Set(buildTravelNetwork(current, [], ground.navigation).filter(r => r.kind === 'building').map(r => r.id));
  const during = new Set(buildTravelNetwork(reserved, [], ground.navigation).filter(r => r.kind === 'building').map(r => r.id));
  if ([...existing].some(id => !during.has(id))) throw new HttpError(409, 'LEVELING_ACCESS', 'Ce chantier bloquerait l’accès d’un bâtiment.');
  const futureState = { ...current, cells: current.cells.map(c => selected.has(key(c)) ? { ...c,
    footprint: { buildingId: siteId }, building: c.cellX === request.anchor.cellX && c.cellY === request.anchor.cellY
      ? { id: siteId, type: request.buildingType, quarterTurns: request.quarterTurns } : null,
  } : c) } as unknown as VillageState;
  const after = buildTravelNetwork(futureState, [], future);
  if (!after.some(r => r.id === siteId) || [...existing].some(id => !after.some(r => r.id === id)))
    throw new HttpError(409, 'LEVELING_ACCESS', 'La hauteur proposée ne permet pas un accès praticable aux bâtiments.');
  const candidates = [...new Map(cells.flatMap(c => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ cellX: wrap(c.cellX + dx!, v.widthCells), cellY: wrap(c.cellY + dy!, v.heightCells) }))).map(c => [key(c), c])).values()]
    .filter(c => !selected.has(key(c))).sort((a, b) => Math.hypot(spawnDelta(a.cellX, v.anchorCellX, v.widthCells), spawnDelta(a.cellY, v.anchorCellY, v.heightCells)) - Math.hypot(spawnDelta(b.cellX, v.anchorCellX, v.widthCells), spawnDelta(b.cellY, v.anchorCellY, v.heightCells)));
  let path: LevelingJob['path'] | undefined;
  for (const destination of candidates.slice(0, 8)) {
    // A real free perimeter cell, never an exemption through the reserved pad.
    if (current.cells.some(c => key(c) === key(destination) && c.footprint) || current.region.features.some(f => key(f) === key(destination) && f.deposit?.blocksCell !== false && !f.deposit?.cleared && f.deposit?.state !== 'depleted')) continue;
    const route = refineTravelRoute(reserved, { id: siteId, kind: 'stone', destination, cells: [{ cellX: v.anchorCellX, cellY: v.anchorCellY }, destination] }, new Set(), undefined, ground.navigation);
    if (route && !cells.some(c => pathPassageIntersectsBox(route.cells, c, .5, .5, v))) { path = route.cells; break; }
  }
  if (!path) throw new HttpError(409, 'LEVELING_UNREACHABLE', 'Les habitants ne peuvent pas rejoindre le bord du chantier.');
  const transportMs = Math.ceil(travelDuration(path, v)), durationMs = workMs + transportMs * 2;
  const signature = createHash('sha256').update(JSON.stringify([request, samples, path, height])).digest('hex');
  // RC1 free dry ground is grass/soil. Rock deposits must be extracted first;
  // no artificial stone credits are minted by raising/lowering ordinary soil.
  const quote = { height, cells, workMs, transportMs, durationMs, stoneDebit: 0, stoneCredit: 0, signature };
  const workers = eligibleWorkers(await materializeCohorts(tx, v.worldId, v.villageId, ctx.through), durationMs);
  const availableWorkers = workers.reduce((n, c) => n + c.memberCount, 0), valid = availableWorkers >= request.workerCount;
  const preview: LevelingPreview = { quote, availableWorkers, valid, message: valid ? null : 'Habitants disponibles et assez reposés insuffisants pour ce chantier.' };
  return { preview, workers, path };
}

export async function previewLeveling(db: Kysely<Database>, accountId: string, slug: string, villageId: string, request: LevelingRequest) {
  return db.transaction().execute(async tx => {
    const v = await ownedVillage(tx, accountId, slug, villageId);
    const ctx = await beginVillageEconomy(tx, v.worldId, v.villageId, undefined, [], [], true);
    return (await prepare(tx, v, ctx, accountId, request)).preview;
  });
}
export async function commandLeveling(db: Kysely<Database>, accountId: string, slug: string, villageId: string, command: LevelingCommand) {
  return db.transaction().execute(async tx => {
    const v = await ownedVillage(tx, accountId, slug, villageId);
    const ctx = await beginVillageEconomy(tx, v.worldId, v.villageId, undefined, [], [], true);
    const prior = await tx.selectFrom('levelingJobs').select('request').where('worldId', '=', v.worldId).where('villageId', '=', v.villageId).where('commandId', '=', command.commandId).executeTakeFirst();
    if (prior) {
      if (!isDeepStrictEqual(prior.request, command)) throw new HttpError(409, 'COMMAND_REUSED', 'Identifiant déjà utilisé pour un autre chantier.');
    } else {
      const { commandId, expected, ...request } = command;
      const { preview, workers, path } = await prepare(tx, v, ctx, accountId, request);
      if (!isDeepStrictEqual(preview.quote, expected)) throw new HttpError(409, 'QUOTE_CHANGED', 'Le terrain ou le trajet a changé. Reprenez le devis.');
      if (!preview.valid) throw new HttpError(409, 'LEVELING_WORKERS', preview.message!);
      const featureId = randomUUID(), completesAt = new Date(ctx.through.getTime() + preview.quote.durationMs);
      await tx.insertInto('worldFeatures').values({ id: featureId, worldId: v.worldId, featureTypeCode: 'leveling-site', state: 'reserved', variantSeed: 0 }).execute();
      await tx.insertInto('worldCellOccupancies').values(preview.quote.cells.map(c => ({ ...c, worldId: v.worldId, buildingId: null, featureId, pendingExpansionId: null, role: 'body' as const }))).execute();
      for (const c of preview.quote.cells) await claimWoodlandCell(tx, v.worldId, c.cellX, c.cellY);
      const job = await tx.insertInto('levelingJobs').values({ worldId: v.worldId, villageId: v.villageId, featureId, commandId,
        request: JSON.stringify(command), quote: JSON.stringify(preview.quote), path: JSON.stringify(path), workerCount: request.workerCount,
        startedAt: ctx.through, completesAt, completedAt: null }).returning('id').executeTakeFirstOrThrow();
      await assignWorkers(tx, workers, request.workerCount, { harvestId: null, extractionId: null, scienceActivityId: null, processingLotId: null, tradeJourneyId: null, levelingJobId: job.id });
      await tx.insertInto('scheduledTasks').values({ worldId: v.worldId, taskType: COMPLETE_LEVELING_TASK, subjectId: job.id, payload: {}, dueAt: completesAt, availableAt: completesAt, completedAt: null, lastError: null }).execute();
    }
    return state(tx, accountId, slug, ctx);
  });
}

/** One atomic terrain change after work and return; visuals never credit resources. */
export async function completeLevelingAt(tx: Transaction<Database>, ctx: VillageEconomy, id: string, at: Date) {
  const job = await tx.selectFrom('levelingJobs').selectAll().where('worldId', '=', ctx.worldId).where('villageId', '=', ctx.villageId).where('id', '=', id).forUpdate().executeTakeFirst();
  if (!job || job.completedAt || job.completesAt.getTime() !== at.getTime() || at > ctx.through) return;
  const workers = (await materializeCohorts(tx, ctx.worldId, ctx.villageId, at)).filter(c => c.levelingJobId === id);
  await tx.insertInto('worldSpawnTerraces').values(job.quote.cells.map(c => ({ ...c, worldId: ctx.worldId, villageId: ctx.villageId, height: job.quote.height })))
    .onConflict(c => c.columns(['worldId', 'cellX', 'cellY']).doUpdateSet({ height: job.quote.height, villageId: ctx.villageId })).execute();
  await tx.deleteFrom('worldCellOccupancies').where('worldId', '=', ctx.worldId).where('featureId', '=', job.featureId).execute();
  await tx.deleteFrom('worldFeatures').where('worldId', '=', ctx.worldId).where('id', '=', job.featureId).execute();
  await releaseWorkers(tx, workers, job.workerCount, at);
  await tx.updateTable('levelingJobs').set({ completedAt: at }).where('worldId', '=', ctx.worldId).where('villageId', '=', ctx.villageId).where('id', '=', id).execute();
}
export async function levelingSnapshot(tx: Kysely<Database>, ctx: VillageEconomy): Promise<LevelingJob[]> {
  const jobs = await tx.selectFrom('levelingJobs').selectAll().where('worldId', '=', ctx.worldId).where('villageId', '=', ctx.villageId).where('completedAt', 'is', null).orderBy('id').execute();
  return jobs.map(j => ({ id: j.id, featureId: j.featureId, buildingType: j.request.buildingType, cells: j.quote.cells, height: j.quote.height,
    workerCount: j.workerCount, path: j.path, transportMs: j.quote.transportMs, startedAt: j.startedAt.toISOString(), completesAt: j.completesAt.toISOString() }));
}

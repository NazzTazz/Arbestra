// One-off, explicitly authorized operator repair. Default: perform and ROLLBACK.
// Run with the deployed alpha runtime UID/env and INCIDENT_ROOT pointing at its
// immutable release. INCIDENT_APPLY=1 requires a verified backup outside this tool.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL, URL } from 'node:url';
import process from 'node:process';
import { log } from 'node:console';
const root = process.env.INCIDENT_ROOT;
assert(root?.startsWith('/srv/arbestra/alpha/releases/'), 'Expected alpha release');
const module = (path) => import(pathToFileURL(root + '/api/' + path).href);
const { createDatabase } = await module('dist/database/connection.js');
const { readRc1Ground } = await module('dist/modules/worlds/rc1-ground.js');
const { navigationRevision } = await module('dist/modules/navigation/context.js');
const { assertNoInfrastructure } = await module('dist/modules/villages/infrastructure.js');
const { fixedBuildingFootprint, withinBuildReach, spawnDelta } = await module(
  'node_modules/@arbestra/contracts/dist/index.js',
);
const { sql } = await module('node_modules/kysely/dist/esm/index.js');
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.pathname, '/arbestra_alpha');
assert(['127.0.0.1', 'localhost'].includes(url.hostname));
const db = createDatabase(url.href),
  worldId = '45f81817-cad6-47f8-9e35-ec0dab16cff3',
  villageId = '928d0d18-494d-4d17-905a-322fb41d5ed7',
  owner = '99212fda-7656-4911-8b78-7939378642d3';
const anchor = { cellX: 59, cellY: 200 },
  turns = 1,
  height = 0.2512025798568366,
  cells = fixedBuildingFootprint('university', anchor, turns),
  apply = process.env.INCIDENT_APPLY === '1';
const marker = new Error('NUMBER_TERRACE_PREVIEW_ROLLBACK');
let proof;
const area = (tx) =>
  tx
    .selectFrom('worldSpawnTerraces')
    .selectAll()
    .where('worldId', '=', worldId)
    .where('cellX', '>=', 57)
    .where('cellX', '<=', 62)
    .where('cellY', '>=', 198)
    .where('cellY', '<=', 202)
    .orderBy('cellX')
    .orderBy('cellY')
    .execute();
async function unchangedRows(tx) {
  return {
    buildings: await tx
      .selectFrom('buildings')
      .selectAll()
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .orderBy('id')
      .execute(),
    occupancies: await tx
      .selectFrom('worldCellOccupancies')
      .selectAll()
      .where('worldId', '=', worldId)
      .orderBy('cellX')
      .orderBy('cellY')
      .execute(),
    resources: await tx
      .selectFrom('villageResources')
      .selectAll()
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .orderBy('resourceCode')
      .execute(),
    cohorts: await tx
      .selectFrom('populationCohorts')
      .selectAll()
      .where('worldId', '=', worldId)
      .where('villageId', '=', villageId)
      .orderBy('id')
      .execute(),
  };
}
try {
  const revision = await navigationRevision(db, worldId),
    ground = await readRc1Ground(db, worldId),
    prior = await area(db);
  assert.equal(prior.length, 0, 'Pad already edited: re-audit rather than overwriting');
  try {
    await db.transaction().execute(async (tx) => {
      await sql`set local lock_timeout='2s'`.execute(tx);
      await sql`set local statement_timeout='4s'`.execute(tx);
      await sql`set local transaction_timeout='10s'`.execute(tx);
      const village = await tx
        .selectFrom('villages')
        .selectAll()
        .where('worldId', '=', worldId)
        .where('id', '=', villageId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      assert.equal(village.ownerAccountId, owner);
      assert.equal(village.name, 'Petibonom');
      await sql`select pg_advisory_xact_lock(hashtextextended(${'infrastructure:' + worldId},0))`.execute(tx);
      assert.equal(await navigationRevision(tx, worldId), revision, 'Physical state changed: re-run preview');
      assert.equal((await area(tx)).length, 0);
      const before = await unchangedRows(tx);
      const completed = new Set(before.buildings.filter((b) => b.status === 'completed').map((b) => b.id));
      const reach = before.occupancies.filter((o) => completed.has(o.buildingId));
      assert(cells.every((c) => withinBuildReach(c, reach, { widthCells: 512, heightCells: 256 })));
      assert(
        cells.every((c) => !before.occupancies.some((o) => o.cellX === c.cellX && o.cellY === c.cellY)),
        'Occupied pad',
      );
      assert(
        cells.every(
          (c) =>
            !ground.field.intersectsTree({ x: c.cellX, y: c.cellY, halfWidth: 0.5, halfHeight: 0.5 }) &&
            !ground.field.surfaceReason({ x: c.cellX, y: c.cellY, halfWidth: 0.5, halfHeight: 0.5 }, height, 0.125),
        ),
        'Natural obstacle or excessive modification',
      );
      // Reuse the normal construction guard for roads, sidewalks, equipment and
      // swept engaged passages, including plans belonging to neighbouring players.
      await assertNoInfrastructure(tx, worldId, cells, { widthCells: 512, heightCells: 256 });
      const [extractions, harvests, science] = await Promise.all([
        tx
          .selectFrom('depositExtractions')
          .select('pathCells')
          .where('worldId', '=', worldId)
          .where('status', '=', 'in-progress')
          .execute(),
        tx
          .selectFrom('gardenHarvests')
          .select(['pathCells', 'returnPathCells', 'stops'])
          .where('worldId', '=', worldId)
          .where('status', '=', 'in-progress')
          .execute(),
        tx
          .selectFrom('scienceActivities')
          .select('pathCells')
          .where('worldId', '=', worldId)
          .where('status', '=', 'in-progress')
          .execute(),
      ]);
      const paths = [
        ...extractions.map((p) => p.pathCells ?? []),
        ...harvests.flatMap((p) => [
          p.pathCells ?? [],
          p.returnPathCells ?? [],
          ...(p.stops?.map((s) => s.path) ?? []),
        ]),
        ...science.map((p) => p.pathCells),
      ];
      const overlaps = (a, b) =>
        Math.max(a.x, b.x) >= 56.375 &&
        Math.min(a.x, b.x) <= 62.625 &&
        Math.max(a.y, b.y) >= 197.375 &&
        Math.min(a.y, b.y) <= 202.625;
      for (const path of paths) {
        let previous;
        for (const p of path) {
          const point = { x: 59 + spawnDelta(p.cellX, 59, 512), y: 200 + spawnDelta(p.cellY, 200, 256) };
          assert(!overlaps(previous ?? point, point), 'Engaged path crosses pad');
          previous = point;
        }
      }
      const foundations = before.occupancies
        .filter((c) => c.buildingId !== null)
        .flatMap((c) =>
          [-0.5, 0, 0.5].flatMap((dx) => [-0.5, 0, 0.5].map((dy) => ({ x: c.cellX + dx, y: c.cellY + dy }))),
        );
      const oldHeights = foundations.map((p) => ground.field.sample(p.x, p.y).elevation);
      await tx
        .insertInto('worldSpawnTerraces')
        .values(cells.map((c) => ({ worldId, villageId, ...c, height })))
        .execute();
      assert.equal((await area(tx)).length, 30, 'Writes must precede preview rollback');
      const afterGround = await readRc1Ground(tx, worldId),
        padHeights = cells.map((c) => afterGround.cell(c.cellX, c.cellY).elevation);
      assert(
        padHeights.every((h) => h === 25),
        'University must see a level footprint',
      );
      foundations.forEach((p, i) =>
        assert.equal(afterGround.field.sample(p.x, p.y).elevation, oldHeights[i], 'Existing foundation changed'),
      );
      assert(isDeepStrictEqual(await unchangedRows(tx), before), 'Business data changed');
      assert.notEqual(await navigationRevision(tx, worldId), revision, 'Navigation/SSE invalidation missing');
      proof = {
        mode: apply ? 'applied' : 'rollback preview',
        worldId,
        villageId,
        anchor,
        turns,
        height,
        cells: 30,
        existingBuildings: before.buildings.length,
        foundationSamples: foundations.length,
        activePaths: paths.length,
        planeRange: Math.max(...padHeights) - Math.min(...padHeights),
      };
      if (!apply) throw marker;
    });
  } catch (error) {
    if (error !== marker) throw error;
    assert(!apply);
    assert.deepEqual(await area(db), prior, 'Preview left edits behind');
  }
  log('NUMBER_TERRACE_PROOF', JSON.stringify(proof));
} finally {
  await db.destroy();
}

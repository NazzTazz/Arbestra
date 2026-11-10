/** Reference measures of the navigation redesign (docs/SPEC-REFONTE-TRAJETS-2026-11-10.md §7):
 * presentation of a village cold and warm, after a distant terrain edit, and
 * the garden exploitation preview (the all-goals network of the village), on
 * a dedicated copy of a world served by `local-api.ts`.
 *
 *   tsx src/bench-navigation.ts --target local --base-url http://127.0.0.1:3301 \
 *     --world rc1-dev --village UUID[,UUID] [--repeat 10] [--edit-wait-seconds 61]
 *
 * It writes to the copy only: one session per village owner, and one distant
 * terrain vertex raised by a quarter then restored. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { sql } from 'kysely';
import { DEV_TIMING_HEADER } from '@arbestra/contracts';
import { createDatabase } from '../../api/src/database/connection.js';
import { createSessionToken, hashSessionToken } from '../../api/src/security/sessions.js';
import { databaseUrl, describeDatabase, guard, main, OUT_DIR, timestamp } from './cli.js';
import { distribution } from './stats.js';

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    'database-url': { type: 'string' },
    'base-url': { type: 'string', default: 'http://127.0.0.1:3301' },
    world: { type: 'string' },
    village: { type: 'string' },
    repeat: { type: 'string', default: '10' },
    'edit-wait-seconds': { type: 'string', default: '61' },
  },
});

interface Timed {
  ms: number;
  status: number;
  bytes: number;
  serverTiming: string | null;
}

await main(async () => {
  const url = databaseUrl(values),
    base = values['base-url']!,
    world = values.world;
  if (!world || !values.village) throw new Error('--world et --village obligatoires.');
  guard({ target: values.target, databaseUrl: url, baseUrl: base, worldSlug: world });
  const repeat = Number(values.repeat),
    waitMs = Number(values['edit-wait-seconds']) * 1000;
  const db = createDatabase(url);
  const results: Record<string, unknown>[] = [];
  try {
    console.info(`Base ${describeDatabase(url)}, API ${base}, monde ${world}.`);
    for (const villageId of values.village.split(',')) {
      const village = await db
        .selectFrom('villages')
        .innerJoin('worlds', 'worlds.id', 'villages.worldId')
        .select([
          'villages.id',
          'villages.name',
          'villages.worldId',
          'villages.ownerAccountId',
          'villages.anchorCellX',
          'villages.anchorCellY',
          'worlds.widthCells',
          'worlds.heightCells',
        ])
        .where('villages.id', '=', villageId)
        .where('worlds.slug', '=', world)
        .executeTakeFirstOrThrow();
      const token = createSessionToken();
      await db
        .insertInto('sessions')
        .values({
          tokenHash: hashSessionToken(token),
          accountId: village.ownerAccountId,
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .execute();
      const headers = {
        cookie: `arbestra_session=${token}`,
        'x-arbestra-protocol': '2',
        [DEV_TIMING_HEADER]: '1',
      };
      const prefix = `${base}/api/worlds/${world}/villages/${village.id}`;
      const timed = async (path: string, init: RequestInit = {}): Promise<Timed> => {
        const start = performance.now();
        const response = await fetch(prefix + path, { ...init, headers: { ...headers, ...init.headers } });
        const body = await response.arrayBuffer();
        return {
          ms: Math.round(performance.now() - start),
          status: response.status,
          bytes: body.byteLength,
          serverTiming: response.headers.get('server-timing'),
        };
      };
      const presentation = () => timed('/presentation');

      // Presentation: first read of the process, then cached reads.
      const cold = await presentation();
      const warm: Timed[] = [];
      for (let i = 0; i < repeat; i++) warm.push(await presentation());

      // Distant edit: the vertex row of the world farthest from the village.
      const far = await sql<{ vertexX: number; vertexY: number; height: number }>`
        select vertex_x as "vertexX", vertex_y as "vertexY", height from world_terrain_vertices
        where world_id = ${village.worldId}
        order by least(abs(vertex_x - ${village.anchorCellX}), ${village.widthCells} - abs(vertex_x - ${village.anchorCellX}))
               + least(abs(vertex_y - ${village.anchorCellY}), ${village.heightCells} - abs(vertex_y - ${village.anchorCellY})) desc,
          vertex_x, vertex_y
        limit 1`.execute(db);
      let afterEdit: Timed | null = null,
        afterEditWarm: Timed | null = null;
      const vertex = far.rows[0];
      if (vertex) {
        const move = (height: number) =>
          db
            .updateTable('worldTerrainVertices')
            .set({ height })
            .where('worldId', '=', village.worldId)
            .where('vertexX', '=', vertex.vertexX)
            .where('vertexY', '=', vertex.vertexY)
            .execute();
        await move(Number(vertex.height) + 0.25);
        try {
          // The reader keeps its capture while the village streams stand still, 60 s at most.
          await new Promise((done) => setTimeout(done, waitMs));
          afterEdit = await presentation();
          afterEditWarm = await presentation();
        } finally {
          await move(Number(vertex.height));
        }
      }

      // Garden preview: the only simulation consumer of the all-goals network.
      const plots = await db
        .selectFrom('gardenPlots')
        .select(['cellX', 'cellY'])
        .where('villageId', '=', village.id)
        .orderBy('buildingId')
        .orderBy('cellX')
        .orderBy('cellY')
        .execute();
      const gardens: Record<string, { first: Timed; next: ReturnType<typeof distribution>; statuses: number[] }> = {};
      for (const size of [1, 4, 8]) {
        if (plots.length < size) continue;
        const body = () =>
          JSON.stringify({
            commandId: randomUUID(),
            workerCap: 1,
            durationMs: null,
            cohortId: null,
            woodMode: 'cut',
            gardens: plots.slice(0, size),
            wood: [],
            stone: [],
          });
        const post = () =>
          timed('/exploitation/preview', {
            method: 'POST',
            body: body(),
            headers: { 'content-type': 'application/json' },
          });
        const first = await post();
        const next: Timed[] = [];
        for (let i = 0; i < repeat; i++) next.push(await post());
        gardens[size] = {
          first,
          next: distribution(next.map((t) => t.ms)),
          statuses: [...new Set([first, ...next].map((t) => t.status))],
        };
      }

      const row = {
        village: village.name,
        villageId: village.id,
        plots: plots.length,
        presentation: {
          cold,
          warm: distribution(warm.map((t) => t.ms)),
          warmStatuses: [...new Set(warm.map((t) => t.status))],
          bytes: cold.bytes,
        },
        distantEdit: vertex
          ? { vertex: { x: vertex.vertexX, y: vertex.vertexY }, waitMs, afterEdit, afterEditWarm }
          : null,
        gardens,
      };
      results.push(row);
      console.info(
        `${village.name} : présentation à froid ${cold.ms} ms (${cold.status}, ${Math.round(cold.bytes / 1024)} Ko), ` +
          `à chaud p50 ${row.presentation.warm?.p50} ms ; après retouche distante ${afterEdit?.ms ?? '—'} ms ; ` +
          Object.entries(gardens)
            .map(([k, g]) => `jardin ${k} : 1er ${g.first.ms} ms, puis p50 ${g.next?.p50} / p95 ${g.next?.p95} ms`)
            .join(' ; '),
      );
    }
  } finally {
    await db.destroy();
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const out = resolve(OUT_DIR, `bench-navigation-${timestamp()}.json`);
  writeFileSync(out, JSON.stringify({ base, world, results }, null, 2));
  console.info(`Résultats : ${out}`);
});

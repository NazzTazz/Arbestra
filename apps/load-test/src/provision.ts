/** Creates N bot accounts and villages in a target database through the
 * game's own code: registration (`register`), session (`login`) and village
 * installation (`installVillage`, then `poseRemainingStarter` in manual mode),
 * as the lobby and the spawn atlas do. Idempotent: an existing bot keeps its
 * account and village. It measures the installation cost on the way (world
 * lock of the kit poses, docs/DETTE-TECHNIQUE.md « Installation »).
 *
 *   tsx src/provision.ts --target local --world charge --count 30 [--layout spread]
 *     [--create-world] [--mode grouped|manual] [--concurrency 1] [--start 1]
 *
 * docs/TEST-DE-CHARGE.md §3. */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { sql } from 'kysely';
import {
  createSpawnTerrainField,
  createSpawnTerrainInspector,
  editedRc1Field,
  poseStarterElement,
  starterElementSurfaces,
  type GeneratedLandscape,
  type SpawnMap,
  type StarterInstallation,
} from '@arbestra/contracts';
import type { AppConfig } from '../../api/src/config.js';
import { createDatabase } from '../../api/src/database/connection.js';
import { HttpError } from '../../api/src/errors.js';
import { authenticate, login, register } from '../../api/src/modules/auth/service.js';
import {
  installVillage,
  poseRemainingStarter,
  readInstallation,
} from '../../api/src/modules/onboarding/installation.js';
import { SpawnCompute } from '../../api/src/modules/onboarding/spawn-compute.js';
import { getSpawnMap, readSpawnSnapshot } from '../../api/src/modules/onboarding/spawn-map.js';
import { STARTER_KIT } from '../../api/src/modules/onboarding/starter-kit.js';
import { openCanonicalRc1World } from '../../api/src/modules/world-generator/open-rc1.js';
import { activateTerrainVertices } from '../../api/src/modules/worlds/terrain-vertices.js';
import { beginVillageEconomy } from '../../api/src/modules/villages/reconcile-economy.js';
import { hashPassword } from '../../api/src/security/passwords.js';
import { BOT_EMAIL_PATTERN, botEmail, botName } from './bots.js';
import {
  credentialsPath,
  databaseUrl,
  describeDatabase,
  guard,
  main,
  OUT_DIR,
  readCredentials,
  timestamp,
  writeCredentials,
  type BotCredential,
} from './cli.js';
import { candidatePoints, farEnough, type Layout, type Point } from './placement.js';
import { distribution } from './stats.js';
import { LoadTargetRefused } from './target.js';

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    'database-url': { type: 'string' },
    world: { type: 'string' },
    'world-name': { type: 'string' },
    'create-world': { type: 'boolean', default: false },
    'world-owner-email': { type: 'string' },
    count: { type: 'string', default: '10' },
    start: { type: 'string', default: '1' },
    layout: { type: 'string', default: 'cluster' },
    center: { type: 'string' },
    step: { type: 'string', default: '8' },
    seed: { type: 'string', default: '1' },
    mode: { type: 'string', default: 'grouped' },
    concurrency: { type: 'string', default: '1' },
    attempts: { type: 'string', default: '40' },
    grant: { type: 'string' },
    credentials: { type: 'string' },
    'confirm-staging': { type: 'boolean', default: false },
  },
});

const RC1_ARTIFACT = new URL('../../world-web/public/studies/t1-alpha512-rc1.json', import.meta.url);
/** The game keeps villages more than 50 cells apart (createSpawnTerrainInspector, « neighbor »). */
const NEIGHBOR_DISTANCE = 51;
/** A refused point (blocked terrain, no room for the starter resources) moves on to the next one. */
const SKIPPED_PLACEMENT = new Set(['SPAWN_BLOCKED', 'SPAWN_RESOURCE_SPACE']);
/** No candidate point left: the world holds no further village (neighbour distance, terrain). */
class WorldFull extends Error {
  constructor(readonly villages: number) {
    super(`Plus aucun emplacement libre dans ce monde (${villages} villages).`);
  }
}

interface Timing {
  bot: number;
  operation: 'register' | 'login' | 'install' | 'install-refused' | 'pose';
  ms: number;
  code?: string;
}

await main(async () => {
  const url = databaseUrl(values);
  const world = values.world;
  if (!world) throw new LoadTargetRefused('Monde obligatoire : --world <slug>.');
  const checked = guard({ target: values.target, databaseUrl: url, worldSlug: world });
  const layout = values.layout as Layout;
  if (layout !== 'cluster' && layout !== 'spread') throw new LoadTargetRefused('--layout cluster ou spread.');
  const mode = values.mode === 'manual' ? 'manual' : 'grouped';
  const count = Number(values.count),
    start = Number(values.start),
    concurrency = Math.max(1, Math.min(4, Number(values.concurrency))),
    attempts = Math.max(1, Number(values.attempts));
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(start) || start < 1)
    throw new LoadTargetRefused('--count et --start sont des entiers positifs.');
  const center = values.center ? (([x, y]) => ({ x: Number(x), y: Number(y) }))(values.center.split(',')) : undefined;
  console.info(`Cible ${checked.target}, base ${describeDatabase(url)}, monde ${world}, ${count} bots dès ${start}.`);

  const db = createDatabase(url);
  const compute = new SpawnCompute();
  const config = { sessionTtlDays: 30 } as AppConfig;
  const path = credentialsPath(checked.target, world, values.credentials);
  const credentials = readCredentials(path, checked.target, world);
  const timings: Timing[] = [];
  const timed = async <T>(bot: number, operation: Timing['operation'], run: () => Promise<T>) => {
    const started = performance.now();
    const result = await run();
    timings.push({ bot, operation, ms: Math.round(performance.now() - started) });
    return result;
  };
  // Opt-in acceleration (--grant wood=5000,timber=600): a new village cannot
  // reach the market (town hall level 2) during a test. Raises the bot's own
  // stocks to at least these amounts, under its economy lock; never another village.
  const grant = (values.grant ?? '')
    .split(',')
    .filter(Boolean)
    .map((part) => {
      const [code, amount] = part.split('=');
      if (!code || !Number.isSafeInteger(Number(amount)) || Number(amount) < 0)
        throw new LoadTargetRefused(`--grant invalide : « ${part} » (ressource=quantité).`);
      return { code, amount: Number(amount) };
    });
  const grantResources = (worldId: string, villageId: string) =>
    db.transaction().execute(async (tx) => {
      await beginVillageEconomy(tx, worldId, villageId);
      for (const { code, amount } of grant)
        await tx
          .updateTable('villageResources')
          .set({ amount: sql<number>`greatest(amount, ${amount})` })
          .where('worldId', '=', worldId)
          .where('villageId', '=', villageId)
          .where('resourceCode', '=', code)
          .execute();
    });
  try {
    let row = await db.selectFrom('worlds').selectAll().where('slug', '=', world).executeTakeFirst();
    if (!row) {
      if (!values['create-world'] || checked.target !== 'local')
        throw new LoadTargetRefused(
          `Le monde ${world} n'existe pas. En local, --create-world l'ouvre (géométrie RC1 canonique) ; en staging, l'opérateur l'ouvre (docs/TEST-DE-CHARGE.md §7).`,
        );
      const owner = await db
        .selectFrom('accounts')
        .select(['id', 'email'])
        .$if(Boolean(values['world-owner-email']), (q) => q.where('email', '=', values['world-owner-email']!))
        .orderBy('createdAt')
        .execute();
      const author = owner.find((account) => !BOT_EMAIL_PATTERN.test(account.email));
      if (!author) throw new LoadTargetRefused('Aucun compte auteur (non bot) pour ouvrir le monde.');
      const artifact = JSON.parse(readFileSync(RC1_ARTIFACT, 'utf8')) as GeneratedLandscape;
      const opened = await openCanonicalRc1World(db, {
        ownerAccountId: author.id,
        slug: world,
        name: values['world-name'] ?? 'Monde de charge',
        artifact,
      });
      // As the alpha and staging worlds: shared terrain vertices.
      await activateTerrainVertices(db, opened.worldId);
      console.info(`Monde ${world} ouvert (${opened.worldId}), sommets partagés.`);
      row = await db.selectFrom('worlds').selectAll().where('slug', '=', world).executeTakeFirstOrThrow();
    }
    if (row.generationVersion !== 3 || !row.isOpen) throw new LoadTargetRefused(`Le monde ${world} n'est pas ouvert.`);
    if (row.terrainModel !== 'vertices') console.warn(`Attention : ${world} est sur l'ancien terrain à terrasses.`);
    const dimensions = { widthCells: row.widthCells, heightCells: row.heightCells };
    const taken: Point[] = (
      await db.selectFrom('villages').select(['anchorCellX', 'anchorCellY']).where('worldId', '=', row.id).execute()
    ).map((v) => ({ x: v.anchorCellX, y: v.anchorCellY }));
    const points = candidatePoints(layout, dimensions, {
      spacing: Number(values.step),
      seed: Number(values.seed),
      ...(center ? { center } : {}),
    });
    // The terrain check the atlas runs before the player may click « Installer »
    // (the plan runs the same one first on the server): a point the player
    // could not choose is not sent. The map is reread after each village.
    const surfaces = STARTER_KIT.elements
      .filter((e) => mode === 'grouped' || e.type === 'town-hall')
      .flatMap((e) => starterElementSurfaces(e));
    let map: SpawnMap | null = null;
    let inspect: ReturnType<typeof createSpawnTerrainInspector> | null = null;
    let screened = 0;
    const nextPoint = async () => {
      if (!map || !inspect) {
        map = await getSpawnMap(db, world, compute);
        const field = editedRc1Field(
          map.landscape,
          createSpawnTerrainField(map.landscape),
          map.terraces ?? [],
          map.removedTreeIndices ?? [],
          map.vertices,
        );
        inspect = createSpawnTerrainInspector(map.landscape, field);
      }
      for (let next = points.next(); !next.done; next = points.next()) {
        if (!farEnough(next.value, taken, NEIGHBOR_DISTANCE, dimensions)) continue;
        screened++;
        if (inspect(next.value, surfaces, 0, map.villages, false, [], map.territories ?? []).terrainCompatible)
          return next.value;
      }
      return null;
    };
    const snapshot = await readSpawnSnapshot(db, world, true);

    const provisionOne = async (index: number) => {
      const email = botEmail(index),
        name = botName(index);
      let credential = credentials.bots.find((b) => b.index === index);
      let account = await db.selectFrom('accounts').select(['id']).where('email', '=', email).executeTakeFirst();
      if (!account) {
        const password = randomBytes(18).toString('base64url');
        const created = await timed(index, 'register', () => register(db, config, email, password));
        account = { id: created.session.account.id };
        credential = { index, email, password, accountId: account.id, token: created.token };
      } else if (!credential || credential.accountId !== account.id) {
        // Existing bot whose generated password was lost with its file: a new one, bot accounts only.
        const password = randomBytes(18).toString('base64url');
        await db
          .updateTable('accounts')
          .set({ passwordHash: await hashPassword(password) })
          .where('id', '=', account.id)
          .where('email', '=', email)
          .execute();
        credential = { index, email, password, accountId: account.id };
      }
      const valid = credential.token
        ? await authenticate(db, credential.token).then(
            () => true,
            () => false,
          )
        : false;
      if (!valid) {
        const password = credential.password;
        credential.token = (await timed(index, 'login', () => login(db, config, email, password))).token;
      }
      const remember = (c: BotCredential) => {
        credentials.bots = [...credentials.bots.filter((b) => b.index !== index), c];
        writeCredentials(path, credentials);
      };
      remember(credential);
      const accountId = account.id;
      let installation = await readInstallation(db, accountId, world);
      for (let attempt = 0; !installation && attempt < attempts; attempt++) {
        const point = await nextPoint();
        if (!point) throw new WorldFull(taken.length);
        const started = performance.now();
        try {
          installation = await installVillage(db, compute, accountId, world, {
            commandId: randomUUID(),
            artifactChecksum: snapshot.map.artifactChecksum,
            kitVersion: STARTER_KIT.version,
            point,
            quarterTurns: 0,
            mode,
            playerName: name,
            villageName: name,
          });
          timings.push({ bot: index, operation: 'install', ms: Math.round(performance.now() - started) });
          taken.push(point);
          map = null;
        } catch (error) {
          if (!(error instanceof HttpError) || !SKIPPED_PLACEMENT.has(error.code)) throw error;
          timings.push({
            bot: index,
            operation: 'install-refused',
            ms: Math.round(performance.now() - started),
            code: error.code,
          });
        }
      }
      if (!installation) throw new Error(`${name} : aucun emplacement accepté en ${attempts} essais.`);
      const installed: StarterInstallation = installation;
      for (const key of installed.remaining) {
        const element = installed.kit.elements.find((e) => e.key === key);
        if (!element) continue;
        // The kit's own layout: the element's anchor where the grouped pose would put it.
        const placed = poseStarterElement(element, installed.anchor, installed.quarterTurns);
        const anchor = placed.cells.find((c) => c.role === 'anchor') ?? placed.cells[0]!;
        await timed(index, 'pose', () =>
          poseRemainingStarter(db, compute, accountId, world, installed.villageId, {
            commandId: randomUUID(),
            elementKey: key,
            point: { x: anchor.cellX, y: anchor.cellY },
            quarterTurns: installed.quarterTurns,
          }),
        );
      }
      if (grant.length) await grantResources(row.id, installed.villageId);
      remember({ ...credential, villageId: installed.villageId });
      console.info(`${name} : village ${installed.villageId} en ${installed.anchor.x},${installed.anchor.y}.`);
    };

    const queue = Array.from({ length: count }, (_, i) => start + i);
    let full: number | null = null;
    const started = Date.now();
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        for (let index = queue.shift(); index !== undefined && full === null; index = queue.shift())
          await provisionOne(index).catch((error) => {
            if (!(error instanceof WorldFull)) throw error;
            full = error.villages;
          });
      }),
    );
    const byOperation = Object.fromEntries(
      (['register', 'login', 'install', 'install-refused', 'pose'] as const).map((operation) => [
        operation,
        distribution(timings.filter((t) => t.operation === operation).map((t) => t.ms)),
      ]),
    );
    const villages = await sql<{ n: number }>`select count(*)::int as n from villages v join accounts a
      on a.id = v.owner_account_id where v.world_id = ${row.id} and a.email like 'bot-%@load.arbestra.test'`.execute(
      db,
    );
    const report = {
      target: checked.target,
      world,
      layout,
      mode,
      concurrency,
      requested: count,
      screenedPoints: screened,
      botVillagesInWorld: villages.rows[0]!.n,
      wallClockMs: Date.now() - started,
      worldFullAtVillages: full,
      byOperation,
      timings,
    };
    mkdirSync(OUT_DIR, { recursive: true });
    const reportPath = resolve(OUT_DIR, `provision-${checked.target}-${world}-${timestamp()}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.info(JSON.stringify({ ...report, timings: undefined }, null, 2));
    if (full !== null)
      console.warn(
        `Monde plein : ${full} villages, les bots suivants n'ont pas été installés. Provisionnez un autre monde.`,
      );
    console.info(`Identifiants : ${path} (jamais commités). Rapport : ${reportPath}`);
  } finally {
    await compute.close();
    await db.destroy();
  }
});

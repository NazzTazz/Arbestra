import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import {
  applySyncV2Batch,
  syncV2BatchIsValid,
  visibleSyncV2Scope,
  type ExpeditionReceipt,
  type HarvestIntent,
  type HarvestReceipt,
  type SyncV2Batch,
  type SyncV2Change,
  type SyncV2State,
} from '@arbestra/contracts';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import { resetE2eState } from '../../database/reset-e2e.js';
import { DEVELOPMENT_IDS as ids } from '../../database/seed.js';
import type { ScheduledTask } from '../../jobs/scheduled-tasks.js';
import { receiveExpedition, expireExpeditions } from '../science/expeditions.js';
import { HARVEST_SUBMISSION_TASK, processHarvestSubmission, receiveHarvestIntent } from './harvest-submissions.js';
import { captureSyncV2 } from './sync-v2-capture.js';
import { readPrivateScopeSnapshot } from './sync-v2-readers.js';

// The route computation belongs to the navigation tests: the worker's receipt is what counts here.
vi.mock('./harvest-intents.js', () => ({
  acceptHarvestIntent: vi.fn(
    async (_db: unknown, _account: string, _slug: string, _village: string, r: HarvestIntent) => ({
      commandId: r.commandId,
      accepted: [{ key: 'garden:1040:512', cellX: 1040, cellY: 512, resource: 'carrot', amount: 12 }],
      refused: [],
    }),
  ),
}));

const url = testDatabaseUrl(),
  target = new URL(url);
if (target.hostname !== '127.0.0.1' || !/^\/arbestra(_\d+)?_test$/.test(target.pathname))
  throw Error('Unexpected receipt synchronization test database');
const db = createDatabase(url);
const intruder = { account: randomUUID(), village: randomUUID() };
const DAY = 86_400_000;

beforeAll(async () => {
  await migrateToLatest(url);
  await resetE2eState(url);
  await db
    .insertInto('accounts')
    .values({ id: intruder.account, email: intruder.account + '@receipts.test', passwordHash: 'fixture' })
    .execute();
  await db
    .insertInto('worldMemberships')
    .values({ worldId: ids.world, accountId: intruder.account, playerName: 'Intruder' })
    .execute();
  await db
    .insertInto('villages')
    .values({
      id: intruder.village,
      worldId: ids.world,
      ownerAccountId: intruder.account,
      name: 'Neighbour',
      anchorCellX: 40,
      anchorCellY: 40,
    })
    .execute();
}, 180000);
afterAll(async () => {
  await clear();
  await db.deleteFrom('villages').where('id', '=', intruder.village).execute();
  await db.deleteFrom('accounts').where('id', '=', intruder.account).execute();
  await db.destroy();
}, 60000);

async function clear() {
  await db.deleteFrom('harvestSubmissions').where('worldId', '=', ids.world).execute();
  await db.deleteFrom('expeditionSubmissions').where('worldId', '=', ids.world).execute();
  await db.deleteFrom('scheduledTasks').where('worldId', '=', ids.world).execute();
}
const expeditionReceipt = (commandId: string, status: 'pending' | 'failed'): ExpeditionReceipt => ({
  kind: 'expedition-receipt',
  commandId,
  worldId: ids.world,
  villageId: ids.village,
  version: status === 'pending' ? 1 : 2,
  receivedAt: new Date().toISOString(),
  requestedTarget: { cellX: 5, cellY: 6 },
  ...(status === 'pending'
    ? { status }
    : { status, code: 'EXPEDITION_EXPIRED', message: 'La préparation a dépassé son délai.' }),
});
/** A submission row as the player's own village stores it, `ageMs` old. */
async function expedition(
  status: 'pending' | 'failed',
  { ageMs = 0, village = ids.village as string, account = ids.account as string } = {},
) {
  const commandId = randomUUID();
  await sql`insert into expedition_submissions(world_id,village_id,account_id,command_id,request,receipt,created_at)
    values(${ids.world},${village},${account},${commandId},${JSON.stringify({ commandId })}::jsonb,
    ${JSON.stringify(expeditionReceipt(commandId, status))}::jsonb,statement_timestamp()-${ageMs / 1000}*interval '1 second')`.execute(
    db,
  );
  return commandId;
}
async function harvest(
  resolved: boolean,
  { ageMs = 0, village = ids.village as string, account = ids.account as string } = {},
): Promise<string> {
  const commandId = randomUUID();
  const receipt: HarvestReceipt = { commandId, accepted: [], refused: [] };
  await sql`insert into harvest_submissions(world_id,village_id,account_id,command_id,request,receipt,created_at)
    values(${ids.world},${village},${account},${commandId},${JSON.stringify({ commandId })}::jsonb,
    ${resolved ? JSON.stringify(receipt) : null}::jsonb,statement_timestamp()-${ageMs / 1000}*interval '1 second')`.execute(
    db,
  );
  return commandId;
}
const snapshot = () =>
  db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (tx) => {
      await sql`set transaction read only`.execute(tx);
      return readPrivateScopeSnapshot(tx, { worldId: ids.world, villageId: ids.village, through: new Date() });
    });
const component = <C extends SyncV2Change['component']>(changes: SyncV2Change[], name: C) =>
  changes.find((change) => change.component === name) as Extract<SyncV2Change, { component: C }>;
const keys = (change: { upsert: Array<{ id: string }> }) => change.upsert.map((entity) => entity.id).sort();

it('lists in a snapshot the pending receipts and the recent ones of the village, and no other', async () => {
  await clear();
  const pending = await expedition('pending'),
    recent = await expedition('failed', { ageMs: 60_000 }),
    old = await expedition('failed', { ageMs: 3 * DAY });
  const waiting = await harvest(false),
    done = await harvest(true, { ageMs: 5_000 }),
    stale = await harvest(true, { ageMs: 3 * DAY });
  // Another village's receipts, and a row the village's current owner did not send.
  const foreign = [
    await expedition('pending', { village: intruder.village, account: intruder.account }),
    await expedition('pending', { account: intruder.account }),
  ];
  const foreignHarvests = [
    await harvest(false, { village: intruder.village, account: intruder.account }),
    await harvest(false, { account: intruder.account }),
  ];
  const changes = await snapshot();
  expect(keys(component(changes, 'expeditionReceipts'))).toEqual([pending, recent].sort());
  expect(keys(component(changes, 'harvestReceipts'))).toEqual([waiting, done].sort());
  expect(component(changes, 'expeditionReceipts').remove).toEqual([]);
  // A gesture the worker has not processed reads as pending, as in the historical answer.
  expect(component(changes, 'harvestReceipts').upsert.find((entity) => entity.id === waiting)!.receipt).toEqual({
    commandId: waiting,
    pending: true,
    accepted: [],
    refused: [],
  });
  for (const id of [old, stale, ...foreign, ...foreignHarvests]) expect(JSON.stringify(changes)).not.toContain(id);
  expect(syncV2BatchIsValid(batchOf(changes))).toBe(true);
}, 120000);

it('bounds the history of a snapshot, never the pending receipts', async () => {
  await clear();
  const pending = await expedition('pending');
  const recent: string[] = [];
  for (let age = 40; age >= 1; age--) recent.push(await expedition('failed', { ageMs: age * 1000 }));
  const gestures: string[] = [];
  for (let age = 40; age >= 1; age--) gestures.push(await harvest(true, { ageMs: age * 1000 }));
  const changes = await snapshot();
  // The 32 newest of each, and the pending expedition older than all of them.
  expect(keys(component(changes, 'expeditionReceipts'))).toEqual([pending, ...recent.slice(-32)].sort());
  expect(keys(component(changes, 'harvestReceipts'))).toEqual(gestures.slice(-32).sort());
}, 120000);

it('publishes a receipt at the instant the worker writes it, and the private reader returns it', async () => {
  await clear();
  const stream = async () =>
    (
      await sql<{ revision: string }>`select revision::text from game_sync_streams
        where world_id=${ids.world} and stream_kind='village' and scope_key=${ids.village}`.execute(db)
    ).rows[0]?.revision;
  const scopes = [{ kind: 'village' as const, key: ids.village }];
  const load = await captureSyncV2(db, ids.account, 'aube', ids.village, {
    protocol: 2,
    generation: 1,
    scopes,
    cursors: [],
  });
  let state: SyncV2State = {
    worldId: ids.world,
    villageId: ids.village,
    generation: 1,
    scopes: new Map(),
    subscribedScopes: new Set([`village:${ids.village}`]),
  };
  const applied = applySyncV2Batch(state, load);
  if (applied.kind !== 'applied') throw Error('The snapshot was not applied: ' + applied.kind);
  state = applied.state;
  const receipts = (kind: 'expeditionReceipts' | 'harvestReceipts') =>
    [...visibleSyncV2Scope(state.scopes.get(`village:${ids.village}`)!)]
      .filter(([key]) => key.startsWith(kind + ':'))
      .map(([, entity]) => entity as { id: string; receipt: { status?: string; pending?: boolean } });
  expect(receipts('expeditionReceipts')).toEqual([]);
  /** A delta from the applied cursor, as the stream sends it. */
  const follow = async () => {
    const scope = state.scopes.get(`village:${ids.village}`)!;
    const delta = await captureSyncV2(db, ids.account, 'aube', ids.village, {
      protocol: 2,
      generation: 1,
      scopes,
      cursors: [{ kind: 'village', key: ids.village, epoch: scope.epoch, revision: scope.revision }],
    });
    expect(syncV2BatchIsValid(delta)).toBe(true);
    const next = applySyncV2Batch(state, delta);
    if (next.kind === 'applied') state = next.state;
    return delta.groups[0]!.changes;
  };

  // The player's commands store a pending receipt, published with them.
  const command = randomUUID(),
    gesture = randomUUID();
  await receiveExpedition(db, ids.account, 'aube', ids.village, {
    commandId: command,
    action: 'survey',
    target: { cellX: 1030, cellY: 520 },
    budgetSeconds: 600,
  });
  await receiveHarvestIntent(db, ids.account, 'aube', ids.village, {
    commandId: gesture,
    gardens: [{ cellX: 1040, cellY: 512 }],
    wood: [],
    stone: [],
  });
  const submitted = await follow();
  expect(component(submitted, 'expeditionReceipts').upsert).toMatchObject([
    { id: command, receipt: { status: 'pending' } },
  ]);
  expect(component(submitted, 'harvestReceipts').upsert).toMatchObject([{ id: gesture, receipt: { pending: true } }]);
  expect(receipts('expeditionReceipts')).toHaveLength(1);
  expect(receipts('harvestReceipts')).toHaveLength(1);

  // The worker's lease and deadline bookkeeping is not a receipt.
  const before = await stream();
  await db
    .updateTable('expeditionSubmissions')
    .set({ attempt: 1, attemptToken: randomUUID(), leaseUntil: sql`statement_timestamp()+interval '10 seconds'` })
    .where('commandId', '=', command)
    .execute();
  await db
    .updateTable('expeditionSubmissions')
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where('commandId', '=', command)
    .execute();
  expect(await stream()).toBe(before);

  // The worker writes the outcome: the next delta carries it, once.
  await expireExpeditions(db);
  const refused = await follow();
  expect(component(refused, 'expeditionReceipts').upsert).toMatchObject([
    { id: command, receipt: { status: 'failed', code: 'EXPEDITION_EXPIRED', version: 2 } },
  ]);
  expect(refused.some((change) => change.component === 'harvestReceipts')).toBe(false);
  expect(receipts('expeditionReceipts')[0]!.receipt.status).toBe('failed');

  const task = (await db
    .selectFrom('scheduledTasks')
    .selectAll()
    .where('worldId', '=', ids.world)
    .where('taskType', '=', HARVEST_SUBMISSION_TASK)
    .executeTakeFirstOrThrow()) as unknown as ScheduledTask;
  await db.transaction().execute((tx) => processHarvestSubmission(tx, task));
  const accepted = await follow();
  expect(component(accepted, 'harvestReceipts').upsert).toMatchObject([
    { id: gesture, receipt: { accepted: [{ resource: 'carrot', amount: 12 }], refused: [] } },
  ]);
  expect(accepted.some((change) => change.component === 'expeditionReceipts')).toBe(false);
  expect(receipts('harvestReceipts')[0]!.receipt.pending).toBeUndefined();

  // A client joining now finds both outcomes in its snapshot.
  const joined = await snapshot();
  expect(component(joined, 'expeditionReceipts').upsert).toMatchObject([
    { id: command, receipt: { status: 'failed' } },
  ]);
  expect(component(joined, 'harvestReceipts').upsert).toMatchObject([
    { id: gesture, receipt: { accepted: [{ amount: 12 }] } },
  ]);
}, 120000);

const batchOf = (changes: SyncV2Change[]): SyncV2Batch => ({
  protocol: 2,
  worldId: ids.world,
  villageId: ids.village,
  generation: 1,
  observedAt: new Date().toISOString(),
  coverage: 'scope-snapshot',
  groups: [
    {
      stream: { kind: 'village', key: ids.village, epoch: randomUUID() },
      fromRevision: '0',
      toRevision: '1',
      changes,
    },
  ],
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { RELEASE_BASELINE_ID, latestReleaseId } from '@arbestra/contracts';
import { loadConfig } from '../../config.js';
import { buildApp } from '../../app.js';
import { createDatabase } from '../../database/connection.js';
import { testDatabaseUrl } from '../../database/test-environment.js';
import { migrateToLatest } from '../../database/migrate.js';
import * as releaseMigration from '../../database/migrations/081_account_last_seen_release.js';
import { hashSessionToken } from '../../security/sessions.js';

// The release notes the Oracle presents (docs/SPEC-NOUVEAUTES-ORACLE.md): the
// server keeps, per account, the last version acknowledged, and only moves it forward.
const url = testDatabaseUrl(),
  target = new URL(url);
if (!/^\/arbestra(_\d+)?_test$/.test(target.pathname)) throw Error('Unexpected release notes test database');
const db = createDatabase(url),
  config = loadConfig({ ...process.env, DATABASE_URL: url, NODE_ENV: 'test' });
let app: Awaited<ReturnType<typeof buildApp>>;
const accounts: string[] = [];

/** An account created outside the registration route (seed, fixtures): no version yet. */
async function fixtureAccount(lastSeenRelease?: string) {
  const id = randomUUID(),
    token = randomUUID();
  await db
    .insertInto('accounts')
    .values({
      id,
      email: `${id}@releases.test`,
      passwordHash: 'fixture',
      ...(lastSeenRelease ? { lastSeenRelease } : {}),
    })
    .execute();
  await db
    .insertInto('sessions')
    .values({ accountId: id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) })
    .execute();
  accounts.push(id);
  return { id, cookie: `${config.cookieName}=${token}` };
}
const stored = async (id: string) =>
  (await db.selectFrom('accounts').select('lastSeenRelease').where('id', '=', id).executeTakeFirstOrThrow())
    .lastSeenRelease;
const seen = (cookie: string | undefined, payload: unknown) =>
  app.inject({
    method: 'POST',
    url: '/api/account/seen-release',
    ...(cookie ? { headers: { cookie } } : {}),
    payload: payload as object,
  });
const session = (cookie: string) => app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });

class Rollback extends Error {}

describe('release notes seen by account', () => {
  beforeAll(async () => {
    await migrateToLatest(url);
    app = await buildApp(config, db);
    await app.ready();
  }, 120000);
  afterAll(async () => {
    if (accounts.length) await db.deleteFrom('accounts').where('id', 'in', accounts.splice(0)).execute();
    await app?.close();
    await db.destroy();
  }, 30000);

  it('gives a new account the current version at registration, so it has no history to catch up on', async () => {
    const email = `${randomUUID()}@releases.test`;
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: 'releases-password' },
    });
    expect(registered.statusCode).toBe(201);
    const body = registered.json();
    accounts.push(body.account.id);
    expect(body.account.lastSeenRelease).toBe(latestReleaseId());
    expect(await stored(body.account.id)).toBe(latestReleaseId());
    const cookie = registered.cookies[0]!;
    const read = await session(`${cookie.name}=${cookie.value}`);
    expect(read.statusCode).toBe(200);
    expect(read.json().account.lastSeenRelease).toBe(latestReleaseId());
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'releases-password' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().account.lastSeenRelease).toBe(latestReleaseId());
    expect(login.json().account.passwordHash).toBeUndefined();
  });

  it('reads the version from the session: null for an account that has none yet', async () => {
    const empty = await fixtureAccount(),
      old = await fixtureAccount(RELEASE_BASELINE_ID);
    expect((await session(empty.cookie)).json().account.lastSeenRelease).toBeNull();
    expect((await session(old.cookie)).json().account.lastSeenRelease).toBe(RELEASE_BASELINE_ID);
  });

  it('records a version seen, moves forward only, and answers the same way when repeated', async () => {
    const player = await fixtureAccount(RELEASE_BASELINE_ID),
      latest = latestReleaseId();
    const first = await seen(player.cookie, { releaseId: latest });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ lastSeenRelease: latest });
    expect(await stored(player.id)).toBe(latest);
    // The same request again: same answer, same row.
    const again = await seen(player.cookie, { releaseId: latest });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ lastSeenRelease: latest });
    // A late request of an old tab (an older version) never moves the account back.
    const late = await seen(player.cookie, { releaseId: RELEASE_BASELINE_ID });
    expect(late.statusCode).toBe(200);
    expect(late.json()).toEqual({ lastSeenRelease: latest });
    expect(await stored(player.id)).toBe(latest);
    // An account with no version yet takes the one it sends (the client's silent record).
    const empty = await fixtureAccount();
    expect((await seen(empty.cookie, { releaseId: latest })).json()).toEqual({ lastSeenRelease: latest });
    expect(await stored(empty.id)).toBe(latest);
  });

  it('refuses a request without a session and changes nothing', async () => {
    const player = await fixtureAccount(RELEASE_BASELINE_ID);
    const anonymous = await seen(undefined, { releaseId: latestReleaseId() });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().code).toBe('AUTHENTICATION_REQUIRED');
    const expired = await seen(`${config.cookieName}=${randomUUID()}`, { releaseId: latestReleaseId() });
    expect(expired.statusCode).toBe(401);
    expect(await stored(player.id)).toBe(RELEASE_BASELINE_ID);
  });

  it('refuses an invalid or unknown version, and changes nothing', async () => {
    const player = await fixtureAccount(RELEASE_BASELINE_ID);
    for (const payload of [
      {},
      { releaseId: '' },
      { releaseId: 42 },
      { releaseId: 'alpha-next' },
      { releaseId: 'a'.repeat(500) },
    ]) {
      const response = await seen(player.cookie, payload);
      expect([response.statusCode, response.json().code]).toEqual([400, 'VALIDATION_ERROR']);
    }
    // Well formed, but no deployment published it.
    const unknown = await seen(player.cookie, { releaseId: 'alpha-2099.12.31.9' });
    expect([unknown.statusCode, unknown.json().code]).toEqual([400, 'UNKNOWN_RELEASE']);
    expect(await stored(player.id)).toBe(RELEASE_BASELINE_ID);
  });

  it('keeps its constraint: a stored version is never empty', async () => {
    const player = await fixtureAccount(RELEASE_BASELINE_ID);
    await expect(
      db.updateTable('accounts').set({ lastSeenRelease: '' }).where('id', '=', player.id).execute(),
    ).rejects.toThrow(/accounts_last_seen_release_check/);
  });

  it('migration 081 credits every account that exists with the alpha before the first entry, and rolls back whole', async () => {
    const withoutVersion = await fixtureAccount(),
      other = await fixtureAccount(RELEASE_BASELINE_ID),
      ids = [withoutVersion.id, other.id];
    const column = async (executor: Kysely<unknown>) =>
      (
        await sql<{ count: string }>`select count(*)::text as count from information_schema.columns
          where table_schema = current_schema() and table_name = 'accounts' and column_name = 'last_seen_release'`.execute(
          executor,
        )
      ).rows[0]!.count;
    await db
      .transaction()
      .execute(async (tx) => {
        const executor = tx as unknown as Kysely<unknown>;
        await releaseMigration.down(executor);
        expect(await column(executor)).toBe('0');
        await releaseMigration.up(executor);
        expect(await column(executor)).toBe('1');
        const rows = await sql<{
          id: string;
          lastSeenRelease: string | null;
        }>`select id, last_seen_release from accounts where id = any(${ids}::uuid[])`.execute(executor);
        expect(rows.rows).toHaveLength(2);
        expect(rows.rows.map((row) => row.lastSeenRelease)).toEqual([RELEASE_BASELINE_ID, RELEASE_BASELINE_ID]);
        // Not a single account is left without a version by the migration.
        const empty = await sql<{ count: string }>`select count(*)::text as count from accounts
          where last_seen_release is null`.execute(executor);
        expect(empty.rows[0]!.count).toBe('0');
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
    // The test left the schema and the data as they were.
    expect(await stored(withoutVersion.id)).toBeNull();
    expect(await stored(other.id)).toBe(RELEASE_BASELINE_ID);
  });
});

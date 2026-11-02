import { devTime } from '../operations/dev-timing.js';
import { observationAuthenticated } from '../admin/observation-actions.js';
import { scrypt as callbackScrypt } from 'node:crypto';
import { promisify } from 'node:util';

import type { Kysely } from 'kysely';

import {
  RELEASE_NOTES,
  latestReleaseId,
  mostRecentSeenRelease,
  releaseRank,
  type SeenReleaseResponse,
  type SessionResponse,
} from '@arbestra/contracts';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { hashPassword, verifyPassword } from '../../security/passwords.js';
import { createSessionToken, hashSessionToken } from '../../security/sessions.js';

const scrypt = promisify(callbackScrypt);

export async function register(db: Kysely<Database>, config: AppConfig, email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase(),
    passwordHash = await hashPassword(password);
  return db.transaction().execute(async (tx) => {
    const account = await tx
      .insertInto('accounts')
      .values({ email: normalizedEmail, passwordHash, lastSeenRelease: latestReleaseId() })
      .onConflict((c) => c.column('email').doNothing())
      .returning(['id', 'email', 'lastSeenRelease'])
      .executeTakeFirst();
    if (!account) throw new HttpError(409, 'EMAIL_ALREADY_USED', 'Cette adresse possède déjà un compte.');
    const token = createSessionToken();
    await tx
      .insertInto('sessions')
      .values({
        tokenHash: hashSessionToken(token),
        accountId: account.id,
        expiresAt: new Date(Date.now() + config.sessionTtlDays * 86_400_000),
      })
      .execute();
    return { token, session: { account, worlds: [] } satisfies SessionResponse };
  });
}

export interface AuthenticatedAccount {
  id: string;
  email: string;
  lastSeenRelease: string | null;
}

export async function login(
  db: Kysely<Database>,
  config: AppConfig,
  email: string,
  password: string,
): Promise<{ token: string; session: SessionResponse }> {
  const normalizedEmail = email.trim().toLowerCase();
  const account = await db
    .selectFrom('accounts')
    .select(['id', 'email', 'lastSeenRelease', 'passwordHash'])
    .where('email', '=', normalizedEmail)
    .executeTakeFirst();

  const passwordMatches = account
    ? await verifyPassword(password, account.passwordHash)
    : (await scrypt(password, Buffer.alloc(16), 64), false);

  if (!account || !passwordMatches) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Identifiants incorrects.');
  }

  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 86_400_000);
  await db
    .insertInto('sessions')
    .values({
      tokenHash: hashSessionToken(token),
      accountId: account.id,
      expiresAt,
    })
    .execute();

  return {
    token,
    session: await getSessionForAccount(db, {
      id: account.id,
      email: account.email,
      lastSeenRelease: account.lastSeenRelease,
    }),
  };
}

export async function authenticate(db: Kysely<Database>, token: string | undefined): Promise<AuthenticatedAccount> {
  return devTime('auth', async () => {
    if (!token) throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Connexion requise.');

    const account = await db
      .selectFrom('sessions')
      .innerJoin('accounts', 'accounts.id', 'sessions.accountId')
      .select(['accounts.id', 'accounts.email', 'accounts.lastSeenRelease'])
      .where('sessions.tokenHash', '=', hashSessionToken(token))
      .where('sessions.expiresAt', '>', new Date())
      .executeTakeFirst();

    if (!account) throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Session invalide ou expirée.');
    observationAuthenticated(account.id);
    return account;
  });
}

export async function getSessionForAccount(
  db: Kysely<Database>,
  account: AuthenticatedAccount,
): Promise<SessionResponse> {
  const worlds = await db
    .selectFrom('worldMemberships')
    .innerJoin('worlds', 'worlds.id', 'worldMemberships.worldId')
    .select(['worlds.id', 'worlds.slug', 'worlds.name', 'worldMemberships.playerName'])
    .where('worldMemberships.accountId', '=', account.id)
    .orderBy('worlds.name')
    .execute();

  return { account, worlds };
}

export async function logout(db: Kysely<Database>, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.deleteFrom('sessions').where('tokenHash', '=', hashSessionToken(token)).execute();
}

/**
 * The player acknowledged a version of the release notes ("Compris"). Idempotent
 * and monotonic: the stored version only moves forward in the list's order, so
 * a late request from an old tab changes nothing. An identifier the list does
 * not know is refused: only versions this deployment published can be seen.
 */
export async function markReleaseSeen(
  db: Kysely<Database>,
  accountId: string,
  releaseId: string,
): Promise<SeenReleaseResponse> {
  if (releaseRank(RELEASE_NOTES, releaseId) === null)
    throw new HttpError(400, 'UNKNOWN_RELEASE', 'Cette version est inconnue.');
  return db.transaction().execute(async (tx) => {
    const current = await tx
      .selectFrom('accounts')
      .select('lastSeenRelease')
      .where('id', '=', accountId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const next = mostRecentSeenRelease(RELEASE_NOTES, current.lastSeenRelease, releaseId);
    if (next !== current.lastSeenRelease)
      await tx.updateTable('accounts').set({ lastSeenRelease: next }).where('id', '=', accountId).execute();
    return { lastSeenRelease: next };
  });
}

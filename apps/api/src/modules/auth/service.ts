import { scrypt as callbackScrypt } from 'node:crypto';
import { promisify } from 'node:util';

import type { Kysely } from 'kysely';

import type { SessionResponse } from '@arbestra/contracts';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { verifyPassword } from '../../security/passwords.js';
import { createSessionToken, hashSessionToken } from '../../security/sessions.js';

const scrypt = promisify(callbackScrypt);

export interface AuthenticatedAccount {
  id: string;
  email: string;
}

export async function login(
  db: Kysely<Database>,
  config: AppConfig,
  email: string,
  password: string,
): Promise<{ token: string; session: SessionResponse }> {
  const normalizedEmail = email.trim().toLowerCase();
  const account = await db.selectFrom('accounts')
    .select(['id', 'email', 'passwordHash'])
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
  await db.insertInto('sessions').values({
    tokenHash: hashSessionToken(token),
    accountId: account.id,
    expiresAt,
  }).execute();

  return { token, session: await getSessionForAccount(db, account) };
}

export async function authenticate(
  db: Kysely<Database>,
  token: string | undefined,
): Promise<AuthenticatedAccount> {
  if (!token) throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Connexion requise.');

  const account = await db.selectFrom('sessions')
    .innerJoin('accounts', 'accounts.id', 'sessions.accountId')
    .select(['accounts.id', 'accounts.email'])
    .where('sessions.tokenHash', '=', hashSessionToken(token))
    .where('sessions.expiresAt', '>', new Date())
    .executeTakeFirst();

  if (!account) throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Session invalide ou expirée.');
  return account;
}

export async function getSessionForAccount(
  db: Kysely<Database>,
  account: AuthenticatedAccount,
): Promise<SessionResponse> {
  const worlds = await db.selectFrom('worldMemberships')
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

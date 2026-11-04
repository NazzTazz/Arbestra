/** Shared plumbing of the load-test scripts: arguments, guarded targets and
 * the bots' credentials file (generated passwords and session tokens, never
 * committed: apps/load-test/out/ is ignored by Git). */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTarget, LoadTargetRefused, STAGING_CONFIRM_FLAG, type CheckedTarget } from './target.js';

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = resolve(PACKAGE_ROOT, 'out');

export interface BotCredential {
  index: number;
  email: string;
  password: string;
  accountId: string;
  token?: string;
  villageId?: string;
}
export interface CredentialsFile {
  target: string;
  world: string;
  bots: BotCredential[];
}

export const credentialsPath = (target: string, world: string, explicit?: string) =>
  explicit ? resolve(explicit) : resolve(OUT_DIR, `bots-${target}-${world}.json`);

export function readCredentials(path: string, target: string, world: string): CredentialsFile {
  if (!existsSync(path)) return { target, world, bots: [] };
  const file = JSON.parse(readFileSync(path, 'utf8')) as CredentialsFile;
  if (file.target !== target || file.world !== world)
    throw new LoadTargetRefused(`${path} appartient à ${file.target}/${file.world}, pas à ${target}/${world}.`);
  return file;
}
export function writeCredentials(path: string, file: CredentialsFile) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + '.tmp';
  file.bots.sort((a, b) => a.index - b.index);
  writeFileSync(temporary, JSON.stringify(file, null, 2), { mode: 0o600 });
  renameSync(temporary, path);
}

/** The database is given by --database-url or LOAD_DATABASE_URL; it is never printed. */
export function databaseUrl(values: { 'database-url'?: string | undefined }): string {
  const url = values['database-url'] ?? process.env.LOAD_DATABASE_URL;
  if (!url) throw new LoadTargetRefused('Base obligatoire : --database-url ou LOAD_DATABASE_URL.');
  return url;
}
/** host/name only, for logs. */
export function describeDatabase(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || 5432}/${parsed.pathname.slice(1)}`;
}

export function guard(input: {
  target: string | undefined;
  databaseUrl?: string;
  baseUrl?: string;
  worldSlug?: string;
}): CheckedTarget {
  return checkTarget({
    ...input,
    confirmStaging: process.argv.includes(STAGING_CONFIRM_FLAG),
    env: process.env,
  });
}

/** Runs a script body; a refused target prints its reason and exits 2. */
export async function main(body: () => Promise<void>) {
  try {
    await body();
  } catch (error) {
    if (error instanceof LoadTargetRefused) {
      console.error('Refusé : ' + error.message);
      process.exitCode = 2;
      return;
    }
    console.error(error);
    process.exitCode = 1;
  }
}

export const timestamp = () => new Date().toISOString().replace(/[:.]/g, '-');

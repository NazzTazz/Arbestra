import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { GeneratedLandscape } from '@arbestra/contracts';
import { loadConfig } from './config.js';
import { createDatabase } from './database/connection.js';
import { openCanonicalRc1World } from './modules/world-generator/open-rc1.js';

const { values } = parseArgs({ options: {
  'owner-account-id': { type: 'string' }, slug: { type: 'string' },
  name: { type: 'string' }, artifact: { type: 'string' },
} });
if (!values['owner-account-id'] || !values.slug || !values.name || !values.artifact) {
  throw new Error('Required: --owner-account-id UUID --slug SLUG --name NAME --artifact PATH');
}
const artifact = JSON.parse(await readFile(values.artifact, 'utf8')) as GeneratedLandscape;
const db = createDatabase(loadConfig().databaseUrl);
try {
  console.info(JSON.stringify(await openCanonicalRc1World(db, {
    ownerAccountId: values['owner-account-id'], slug: values.slug, name: values.name, artifact,
  })));
} finally {
  await db.destroy();
}

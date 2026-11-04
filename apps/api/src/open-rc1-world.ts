import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { GeneratedLandscape } from '@arbestra/contracts';
import { loadConfig } from './config.js';
import { createDatabase } from './database/connection.js';
import { openCanonicalRc1World } from './modules/world-generator/open-rc1.js';
import { activateTerrainVertices } from './modules/worlds/terrain-vertices.js';

const { values } = parseArgs({
  options: {
    'owner-account-id': { type: 'string' },
    slug: { type: 'string' },
    name: { type: 'string' },
    artifact: { type: 'string' },
    // Operator choice: share terrain vertices, as on the alpha and staging worlds (idempotent).
    'shared-vertices': { type: 'boolean', default: false },
  },
});
if (!values['owner-account-id'] || !values.slug || !values.name || !values.artifact) {
  throw new Error('Required: --owner-account-id UUID --slug SLUG --name NAME --artifact PATH');
}
const artifact = JSON.parse(await readFile(values.artifact, 'utf8')) as GeneratedLandscape;
const db = createDatabase(loadConfig().databaseUrl);
try {
  const opened = await openCanonicalRc1World(db, {
    ownerAccountId: values['owner-account-id'],
    slug: values.slug,
    name: values.name,
    artifact,
  });
  console.info(JSON.stringify(opened));
  if (values['shared-vertices']) {
    // Same operator code as the 19 October conversions; a world already on vertices is left as is.
    const audit = await activateTerrainVertices(db, opened.worldId);
    console.info(
      JSON.stringify({ terrainModel: 'vertices', previousModel: audit.model, vertices: audit.vertices.length }),
    );
  }
} finally {
  await db.destroy();
}

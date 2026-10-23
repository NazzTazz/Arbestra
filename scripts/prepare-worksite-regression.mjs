import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

// Retrospective reproduction: unchanged worksite fixtures and current test
// setup, with the two business modules resolved to the isolated historical
// build. No database is opened by this preparation step.
const source = resolve('apps/api/src/modules/deposits/worksites.integration.test.ts');
const root = resolve('test-results/command-sync');
const oracle = resolve(root, 'oracle-4966379/apps/api/dist/modules/deposits');
const manifest = JSON.parse(readFileSync(resolve(root, 'oracle-4966379/oracle-manifest.json'), 'utf8'));
if (manifest.revision !== '496637925666b6474a04231d15c368a2d2f8c8a6') throw Error('Unexpected historical oracle');
const historicalFixture = execFileSync(
  'git',
  ['show', `${manifest.revision}:apps/api/src/modules/deposits/worksites.integration.test.ts`],
  { encoding: 'utf8' },
);
const content = historicalFixture.replace(/from '(\.[^']+|@arbestra\/contracts|kysely)'/g, (_match, specifier) => {
  if (specifier === '@arbestra/contracts')
    return `from ${JSON.stringify(resolve('packages/contracts/dist/index.js').replaceAll('\\', '/'))}`;
  if (specifier === 'kysely')
    return `from ${JSON.stringify(resolve('apps/api/node_modules/kysely/dist/esm/index.js').replaceAll('\\', '/'))}`;
  const path =
    specifier === './stone-extractions.js' || specifier === './worksites.js'
      ? resolve(oracle, specifier)
      : resolve(dirname(source), specifier.replace(/\.js$/, '.ts'));
  return `from ${JSON.stringify(path.replaceAll('\\', '/'))}`;
});
mkdirSync(root, { recursive: true });
writeFileSync(resolve(root, 'worksites-historical.test.ts'), content);
writeFileSync(
  resolve(root, 'vitest.historical.config.mjs'),
  `import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['test-results/command-sync/worksites-historical.test.ts'],testTimeout:60000,fileParallelism:false}});
`,
);
process.stdout.write(`Prepared retrospective worksite reproduction against ${manifest.revision}\n`);

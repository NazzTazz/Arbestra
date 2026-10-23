import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import process from 'node:process';
import console from 'node:console';

// Freeze the server AND its contracts at the audited pre-migration commit.
// Only installed third-party packages are shared. Never seed or run a server
// here: callers must supply the explicitly guarded test database themselves.
const revision = '496637925666b6474a04231d15c368a2d2f8c8a6';
const root = process.cwd();
const destination = resolve(root, 'test-results/command-sync/oracle-' + revision.slice(0, 7));
if (existsSync(destination)) throw Error('Oracle directory already exists; preserve it instead of overwriting');
mkdirSync(destination, { recursive: true });
const archive = join(destination, 'source.tar');
execFileSync(
  'git',
  [
    'archive',
    '--format=tar',
    '--output=' + archive,
    revision,
    'apps/api/src',
    'apps/api/package.json',
    'apps/api/tsconfig.json',
    'packages/contracts/src',
    'packages/contracts/package.json',
    'packages/contracts/tsconfig.json',
    'tsconfig.base.json',
    'package.json',
  ],
  { cwd: root, stdio: 'pipe' },
);
execFileSync('tar', ['-xf', archive, '-C', destination], { stdio: 'pipe' });
const link = (from, to) => symlinkSync(realpathSync(from), to, process.platform === 'win32' ? 'junction' : 'dir');
link(join(root, 'node_modules'), join(destination, 'node_modules'));
link(join(root, 'packages/contracts/node_modules'), join(destination, 'packages/contracts/node_modules'));
const modules = join(destination, 'apps/api/node_modules');
mkdirSync(join(modules, '@arbestra'), { recursive: true });
link(join(destination, 'packages/contracts'), join(modules, '@arbestra/contracts'));
for (const entry of readdirSync(join(root, 'apps/api/node_modules'), { withFileTypes: true })) {
  if (entry.name === '@arbestra' || entry.name === '.bin') continue;
  link(join(root, 'apps/api/node_modules', entry.name), join(modules, entry.name));
}
writeFileSync(
  join(destination, 'oracle-manifest.json'),
  JSON.stringify(
    {
      revision,
      source: 'git archive: API and contracts source, compiler configuration and manifests',
      dependencies: 'Existing installed third-party packages, shared read-only by directory links',
      database: 'Not started or configured. Test runner must guard TEST_DATABASE_URL.',
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ revision, destination }));

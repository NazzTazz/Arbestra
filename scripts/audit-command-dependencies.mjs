import ts from 'typescript';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';
import console from 'node:console';

// Static evidence complements the runtime route inventory. Dynamic SQL is kept
// explicitly unresolved; this is not a claim of transitive dependency closure.
const root = process.cwd();
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(ts|mjs)$/.test(path) && !/\.(test|spec)\.ts$/.test(path)) files.push(path);
  }
}
walk(join(root, 'apps/api/src'));
walk(join(root, 'scripts'));
const evidence = [];
for (const path of files) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  function visit(node, owner = '<module>') {
    if (ts.isFunctionDeclaration(node) && node.name) owner = node.name.text;
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    )
      owner = node.name.getText(source);
    let kind, target;
    if (ts.isCallExpression(node)) {
      const call = node.expression.getText(source);
      const method = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : call;
      if (['selectFrom', 'innerJoin', 'leftJoin', 'insertInto', 'updateTable', 'deleteFrom'].includes(method)) {
        kind = ['insertInto', 'updateTable', 'deleteFrom'].includes(method) ? 'write' : 'read';
        target = node.arguments[0]?.getText(source);
      } else if (
        /^(state|beginVillageEconomy|reconcileVillageEconomy|finalizeVillageEconomy|villageCommandResult|readVillageProjection|reconcileSyncDeadline)$/.test(
          method,
        )
      ) {
        kind = 'economy-or-projection';
        target = call;
      }
    } else if (ts.isTaggedTemplateExpression(node) && node.tag.getText(source).startsWith('sql')) {
      kind = 'sql-review';
      target = node.template.getText(source);
    }
    if (kind)
      evidence.push({
        file: relative(root, path).replaceAll('\\', '/'),
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        owner,
        kind,
        target,
      });
    ts.forEachChild(node, (child) => visit(child, owner));
  }
  visit(source);
}
mkdirSync('test-results/command-sync', { recursive: true });
writeFileSync(
  'test-results/command-sync/dependencies.json',
  JSON.stringify(
    {
      scope:
        'Direct AST references, including workers, migrations, seeds and scripts. SQL templates require review; no inferred transitive completeness.',
      evidence,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    files: files.length,
    references: evidence.length,
    writes: evidence.filter((e) => e.kind === 'write').length,
    output: 'test-results/command-sync/dependencies.json',
  }),
);

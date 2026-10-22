import ts from 'typescript';
import { mkdirSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { commandScopeInventory, secondaryProjections } from './command-scope-inventory.mjs';

// Resolve symbols, including imported aliases, rather than matching function
// names. Closures are conservative: branches and callbacks are included. SQL
// templates and unresolved application dispatch remain explicit review items.
const configPath = ts.findConfigFile('apps/api', ts.sys.fileExists);
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, 'apps/api');
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const nodes = new Map();
const ids = new Map();
const sources = program.getSourceFiles().filter(source => !source.isDeclarationFile &&
  source.fileName.replaceAll('\\', '/').includes('/apps/api/src/') && !/\.(test|spec)\.ts$/.test(source.fileName));
function location(node) {
  const source = node.getSourceFile();
  return `${relative(process.cwd(), source.fileName).replaceAll('\\', '/')}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
}
function functionName(node) {
  if (node.name) return node.name.getText();
  if (ts.isVariableDeclaration(node.parent)) return node.parent.name.getText();
  return '<callback>';
}
function register(node) {
  if (ts.isFunctionLike(node) && node.body) {
    const id = `${location(node)}:${functionName(node)}:${node.pos}`;
    ids.set(node, id);
    nodes.set(id, { location: location(node), name: functionName(node), calls: new Set(), reads: new Set(), writes: new Set(), review: new Set() });
  }
  ts.forEachChild(node, register);
}
sources.forEach(register);
function resolved(expression) {
  let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.name : expression);
  if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol?.declarations?.flatMap(declaration => {
    if (ids.has(declaration)) return [ids.get(declaration)];
    if (ts.isVariableDeclaration(declaration) && ids.has(declaration.initializer)) return [ids.get(declaration.initializer)];
    return [];
  }) ?? [];
}
function inspect(node, owner) {
  if (ids.has(node)) {
    const child = ids.get(node);
    // Inline transaction/route callbacks are part of their enclosing action.
    if (owner && !ts.isFunctionDeclaration(node)) nodes.get(owner).calls.add(child);
    owner = child;
  }
  const record = nodes.get(owner);
  if (record && ts.isCallExpression(node)) {
    const method = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : node.expression.getText();
    const targets = resolved(node.expression);
    targets.forEach(target => record.calls.add(target));
    const read = ['selectFrom', 'innerJoin', 'leftJoin', 'rightJoin', 'fullJoin'].includes(method);
    const write = ['insertInto', 'updateTable', 'deleteFrom'].includes(method);
    if (read || write) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) (read ? record.reads : record.writes).add(argument.text.split(/\s+as\s+/i)[0]);
      else record.review.add(`${location(node)} dynamic ${method}`);
    }
    if (!targets.length && ts.isIdentifier(node.expression)) {
      const symbol = checker.getSymbolAtLocation(node.expression);
      if (symbol?.declarations?.some(d => ts.isParameter(d))) record.review.add(`${location(node)} callback dispatch ${method}`);
    }
  }
  if (record && ts.isTaggedTemplateExpression(node) && /^sql(?:<|\.|$)/.test(node.tag.getText())) {
    record.review.add(`${location(node)} SQL template`);
  }
  ts.forEachChild(node, child => inspect(child, owner));
}
sources.forEach(source => inspect(source));
const closure = start => {
  const seen = new Set(), pending = [start], reads = new Set(), writes = new Set(), review = new Set(), economy = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodes.get(id);
    node.reads.forEach(x => reads.add(x)); node.writes.forEach(x => writes.add(x)); node.review.forEach(x => review.add(x));
    if (/^(state|beginVillageEconomy|reconcileVillageEconomy|finalizeVillageEconomy|villageCommandResult|readVillageProjection|reconcileSyncDeadline)$/.test(node.name)) economy.add(node.name);
    pending.push(...node.calls);
  }
  return { functions: seen.size, reads: [...reads].sort(), writes: [...writes].sort(), economy: [...economy].sort(), review: [...review].sort() };
};
const functions = [...nodes].map(([id, node]) => ({ id, location: node.location, name: node.name, directReads: [...node.reads].sort(), directWrites: [...node.writes].sort(), calls: [...node.calls].sort(), closure: closure(id) }));
const routes = [];
function inspectRoutes(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      ['get', 'post', 'put', 'patch', 'delete'].includes(node.expression.name.text)) {
    const path = node.arguments[0], handler = node.arguments.at(-1);
    // Only registrations with an actual local handler, not Map.get/HTTP clients.
    const handlers = ids.has(handler) ? [ids.get(handler)] : handler ? resolved(handler) : [];
    if (handlers.length) routes.push({ location: location(node), method: node.expression.name.text.toUpperCase(),
      path: path?.getText(), handlers: handlers.map(id => ({ id, ...closure(id) })) });
  }
  ts.forEachChild(node, inspectRoutes);
}
sources.forEach(inspectRoutes);
const writers = {};
for (const item of functions) for (const table of item.directWrites) (writers[table] ??= []).push(item.location + ':' + item.name);
const classified = new Map(Object.entries(commandScopeInventory).flatMap(([scope, tables]) => tables.map(table => [table, scope])));
const unclassified = Object.keys(writers).filter(table => !classified.has(table));
if (unclassified.length) throw Error('Unclassified persistent writers: ' + unclassified.join(', '));
const ownership = Object.fromEntries(Object.keys(writers).sort().map(table => [table, {
  primary: classified.get(table), secondary: secondaryProjections[table] ?? [], writers: writers[table],
}]));
mkdirSync('test-results/command-sync', { recursive: true });
writeFileSync('test-results/command-sync/dependency-closure.json', JSON.stringify({
  scope: 'Conservative resolved application call graph; branch variants require business review. SQL templates and callback dispatch are explicitly unresolved.', routes, functions, writers, ownership,
}, null, 2));
console.log(JSON.stringify({ sources: sources.length, functions: functions.length, writtenTables: Object.keys(writers).length, output: 'test-results/command-sync/dependency-closure.json' }));

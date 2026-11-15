import { parseArgs } from 'node:util';
import type { VillageState } from '@arbestra/contracts';
import { loadConfig } from './config.js';
import { createDatabase } from './database/connection.js';
import { NavigationCompute } from './modules/navigation/compute.js';
import { databaseTravelNetworkStore } from './modules/navigation/network-store.js';
import { readInfrastructure } from './modules/villages/infrastructure.js';
import { VillagePresentationReader } from './modules/villages/presentation.js';
import {
  applyDesireStart,
  compareBraziers,
  type BrazierComparison,
  displayedDesireEdges,
  unionDesireEdges,
} from './modules/worlds/desire-start.js';

/** Starting state of the desire paths of one world (slice T3d, docs/SPEC-REFONTE-TRAJETS-2026-11-10.md
 * §17): reads the presentation of every village (its network is computed if no stored one fits),
 * turns the routes shown into edges at the visibility threshold, and compares each village's
 * automatic braziers before and after. Read only unless `--apply`; idempotent with it. The
 * connection comes from the usual configuration (DATABASE_URL), never printed.
 *
 *   node dist/desire-start.js --world SLUG [--apply] [--json]
 */
const sameBraziers = (c: BrazierComparison) => !c.missing.length && !c.extra.length && !c.moved.length;
const { values } = parseArgs({
  options: { world: { type: 'string' }, apply: { type: 'boolean' }, json: { type: 'boolean' } },
});
if (!values.world) throw Error('--world SLUG is required');
const db = createDatabase(loadConfig().databaseUrl);
const navigation = new NavigationCompute(1, { waiting: 4, waitMs: 120_000, computeMs: 120_000 });
try {
  const world = await db
    .selectFrom('worlds')
    .select(['id', 'slug', 'name', 'topology', 'widthCells', 'heightCells', 'chunkSize', 'seed', 'generationVersion'])
    .where('slug', '=', values.world)
    .executeTakeFirstOrThrow(() => Error(`World ${values.world} not found`));
  const villages = await db
    .selectFrom('villages')
    .select(['id', 'name', 'ownerAccountId'])
    .where('worldId', '=', world.id)
    .orderBy('id')
    .execute();
  await navigation.start();
  const reader = new VillagePresentationReader(db, navigation, { store: databaseTravelNetworkStore(db) });
  const shown = [],
    unread: { villageId: string; villageName: string; error: string }[] = [];
  for (const village of villages) {
    // A village without a presentation (incomplete data) is reported, never guessed: it adds no edge.
    const presentation = await reader.read(village.ownerAccountId, world.slug, village.id).catch((error: unknown) => {
      unread.push({ villageId: village.id, villageName: village.name, error: String(error) });
      return null;
    });
    if (presentation)
      shown.push({ village, presentation, edges: displayedDesireEdges(presentation.travelRoutes, world) });
  }
  const edges = unionDesireEdges(shown.map((s) => s.edges));
  const reports = [];
  for (const { village, presentation, edges: own } of shown) {
    const infrastructure = await readInfrastructure(db, world.id, village.id);
    reports.push({
      villageId: village.id,
      villageName: village.name,
      routes: presentation.travelRoutes.length,
      edges: own.length,
      braziers: compareBraziers(presentation, world as VillageState['world'], infrastructure, edges),
      // The proof of equality: from its own edges alone, a village lights exactly what it lights today.
      own: compareBraziers(presentation, world as VillageState['world'], infrastructure, own),
    });
  }
  const applied = values.apply ? await applyDesireStart(db, world.id, edges) : null;
  if (values.json)
    console.info(JSON.stringify({ world: world.slug, edges: edges.length, applied, reports, unread }, null, 2));
  else {
    for (const r of reports)
      console.info(
        `${r.villageName} (${r.villageId}) : ${r.routes} routes, ${r.edges} arêtes ; braseros ${r.braziers.legacy} → ${r.braziers.desire}, ` +
          `${r.braziers.missing.length} perdus, ${r.braziers.extra.length} ajoutés, ${r.braziers.moved.length} déplacés` +
          ` (avec ses seules arêtes : ${sameBraziers(r.own) ? 'identiques' : `ÉCART ${JSON.stringify(r.own)}`})`,
      );
    for (const u of unread)
      console.info(`${u.villageName} (${u.villageId}) : présentation illisible, ignoré (${u.error})`);
    console.info(
      `${world.slug} : ${villages.length} villages, ${edges.length} arêtes distinctes` +
        (applied
          ? ` ; ${applied.inserted} créées, ${applied.raised} relevées au seuil, ${applied.unchanged} déjà visibles`
          : ' ; lecture seule (--apply pour écrire)'),
    );
  }
} finally {
  await navigation.close();
  await db.destroy();
}

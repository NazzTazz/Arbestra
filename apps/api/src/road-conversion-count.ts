import { parseArgs } from 'node:util';
import { sql } from 'kysely';
import { loadConfig } from './config.js';
import { createDatabase } from './database/connection.js';
import { countLegacyRoadConversion } from './modules/villages/road-conversion.js';

/** Read-only count of the legacy road conversion (migration 076,
 * docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §7): per village, the strokes,
 * the cells created, kept or refused by motive, the braziers moved or
 * deleted, the suppressions translated or abandoned and the stone credited.
 * Runs in a read-only transaction, without locks; the connection comes from
 * the usual configuration (DATABASE_URL), never printed. Before migration
 * 076, every plan with content counts; after it, only the plans not yet
 * converted.
 *
 *   node dist/road-conversion-count.js [--world UUID] [--json]
 */
const { values } = parseArgs({ options: { world: { type: 'string' }, json: { type: 'boolean' } } });
const db = createDatabase(loadConfig().databaseUrl);
try {
  const reports = await db.transaction().execute(async (tx) => {
    await sql`set transaction read only`.execute(tx);
    return countLegacyRoadConversion(tx, values.world);
  });
  if (values.json) console.info(JSON.stringify(reports, null, 2));
  else {
    const total = { villages: reports.length, created: 0, kept: 0, refused: 0, moved: 0, deleted: 0, stone: 0 };
    for (const r of reports) {
      const refused = Object.values(r.cells.refused).reduce((n, v) => n + (v ?? 0), 0);
      total.created += r.cells.created;
      total.kept += r.cells.kept;
      total.refused += refused;
      total.moved += r.braziers.moved;
      total.deleted += r.braziers.deleted;
      total.stone += r.stone.credited;
      console.info(
        [
          `${r.worldSlug} / ${r.villageName} (${r.villageId})`,
          `traits ${r.strokes.manual} (+${r.strokes.removed} retraits, ${r.strokes.inherited} hérités, ${r.strokes.lost} sans case)`,
          `cases ${r.cells.created} créées, ${r.cells.kept} déjà présentes, ${refused} refusées ${JSON.stringify(r.cells.refused)}`,
          `braseros ${r.braziers.moved} déplacés, ${r.braziers.deleted} supprimés`,
          `éclairage ${r.suppressions.translated}/${r.suppressions.entries} traduits (${r.suppressions.anchors} ancrages vides), ${r.suppressions.abandoned} abandonnés`,
          `pierre rendue ${r.stone.credited} (réserve ${r.stone.reserve}/256)`,
        ].join(' · '),
      );
    }
    console.info('TOTAL ' + JSON.stringify(total));
  }
} finally {
  await db.destroy();
}

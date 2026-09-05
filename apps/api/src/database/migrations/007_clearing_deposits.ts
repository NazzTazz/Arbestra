import { randomUUID } from 'node:crypto';

import { sql, type Kysely } from 'kysely';

import type { Database } from '../schema.js';
import { planClearingFeatures } from '../../modules/worlds/clearing-features.js';
import { worldCellKey } from '../../modules/worlds/coordinates.js';

/**
 * Generation v2 only enriches clearings. Existing terrain, buildings and
 * natural deposits remain untouched.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  const db = database as Kysely<Database>;
  const worlds = await db
    .selectFrom('worlds')
    .select(['id', 'seed', 'widthCells', 'heightCells', 'generationStatus'])
    .where('generationVersion', '<', 2)
    .execute();

  for (const world of worlds) {
    if (world.generationStatus !== 'ready') continue;
    const [clearings, occupancies] = await Promise.all([
      db
        .selectFrom('worldClearings')
        .select(['centerCellX', 'centerCellY'])
        .where('worldId', '=', world.id)
        .execute(),
      db
        .selectFrom('worldCellOccupancies')
        .select(['cellX', 'cellY'])
        .where('worldId', '=', world.id)
        .execute(),
    ]);
    const occupied = new Set(
      occupancies.map(({ cellX, cellY }) => worldCellKey(cellX, cellY)),
    );
    const plans = planClearingFeatures(
      Number(world.seed),
      world.widthCells,
      world.heightCells,
      clearings,
      occupied,
    ).map((plan) => ({ id: randomUUID(), ...plan }));

    for (let offset = 0; offset < plans.length; offset += 1_000) {
      const batch = plans.slice(offset, offset + 1_000);
      await db
        .insertInto('worldFeatures')
        .values(
          batch.map((feature) => ({
            id: feature.id,
            worldId: world.id,
            featureTypeCode: feature.featureTypeCode,
            state: 'available' as const,
            variantSeed: feature.variantSeed,
          })),
        )
        .execute();
      await db
        .insertInto('worldCellOccupancies')
        .values(
          batch.map((feature) => ({
            worldId: world.id,
            cellX: feature.cellX,
            cellY: feature.cellY,
            buildingId: null,
            featureId: feature.id,
            role: 'body' as const,
          })),
        )
        .execute();
    }
  }

  await sql`
    alter table worlds alter column generation_version set default 2;
    update worlds set generation_version = 2 where generation_version < 2;
    update world_chunks set generation_version = 2 where generation_version < 2;
  `.execute(db);
}

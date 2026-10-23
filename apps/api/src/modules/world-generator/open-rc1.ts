import { randomUUID } from 'node:crypto';
import { RC1_WORLD, type GeneratedLandscape } from '@arbestra/contracts';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../database/schema.js';
import { RC1_CANONICAL_CHECKSUM } from '../onboarding/spawn-compute-protocol.js';
import { artifactChecksum } from './artifact.js';

export interface OpenRc1World {
  readonly ownerAccountId: string;
  readonly slug: string;
  readonly name: string;
  readonly artifact: GeneratedLandscape;
}

/** Explicit server-side operation for the approved RC1 geometry only.
 * Never imports players, villages or mutable state from another world.
 * The general v3 candidate-opening guard deliberately remains unchanged. */
export async function openCanonicalRc1World(db: Kysely<Database>, input: OpenRc1World) {
  const { artifact, ownerAccountId, slug } = input;
  const name = input.name.trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(ownerAccountId) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    slug.length > 64 ||
    !name ||
    name.length > 80
  ) {
    throw new Error('Invalid RC1 world identity');
  }
  if (
    artifact.version !== 3 ||
    artifact.width !== RC1_WORLD.widthCells ||
    artifact.height !== RC1_WORLD.heightCells ||
    !artifact.geography ||
    artifactChecksum(artifact) !== RC1_CANONICAL_CHECKSUM
  ) {
    throw new Error('Only the signed canonical RC1 artifact is accepted');
  }
  const parameters = artifact.geography.parameters;
  return db.transaction().execute(async (tx) => {
    await sql`set local lock_timeout = '5s'`.execute(tx);
    await sql`select pg_advisory_xact_lock(hashtextextended(${'open-canonical-rc1:' + slug}, 0))`.execute(tx);
    const owner = await tx.selectFrom('accounts').select('id').where('id', '=', ownerAccountId).executeTakeFirst();
    if (!owner) throw new Error('The author account must already exist in this database');
    const existing = await tx.selectFrom('worlds').selectAll().where('slug', '=', slug).forUpdate().executeTakeFirst();
    if (existing) {
      const candidate = await tx
        .selectFrom('worldGenerationCandidates')
        .selectAll()
        .where('worldId', '=', existing.id)
        .executeTakeFirst();
      if (
        existing.name !== name ||
        existing.generationVersion !== 3 ||
        existing.generationStatus !== 'ready' ||
        existing.widthCells !== artifact.width ||
        existing.heightCells !== artifact.height ||
        existing.chunkSize !== RC1_WORLD.chunkSize ||
        Number(existing.seed) !== artifact.seed ||
        candidate?.status !== 'ready' ||
        candidate.ownerAccountId !== ownerAccountId ||
        candidate.checksum !== RC1_CANONICAL_CHECKSUM ||
        !candidate.artifact ||
        artifactChecksum(candidate.artifact) !== RC1_CANONICAL_CHECKSUM
      ) {
        throw new Error('World slug already exists with a different identity; nothing was replaced');
      }
      if (!existing.isOpen) {
        await tx
          .updateTable('worlds')
          .set({ isOpen: true, openedAt: sql`coalesce(opened_at, statement_timestamp())` })
          .where('id', '=', existing.id)
          .execute();
      }
      return { worldId: existing.id, slug, name, created: false, checksum: RC1_CANONICAL_CHECKSUM };
    }
    const id = randomUUID();
    const { through } = await tx.selectNoFrom(sql<Date>`statement_timestamp()`.as('through')).executeTakeFirstOrThrow();
    await tx
      .insertInto('worlds')
      .values({
        id,
        slug,
        name,
        topology: 'torus',
        widthCells: artifact.width,
        heightCells: artifact.height,
        chunkSize: RC1_WORLD.chunkSize,
        seed: artifact.seed,
        generationVersion: 3,
        generationStatus: 'ready',
        generatedAt: through,
        isOpen: false,
      })
      .execute();
    await tx
      .insertInto('worldGenerationCandidates')
      .values({
        worldId: id,
        commandId: randomUUID(),
        ownerAccountId,
        parameters,
        status: 'ready',
        checksum: RC1_CANONICAL_CHECKSUM,
        artifact,
        recipeRevision: artifact.recipeRevision ?? 0,
        retainedAt: through,
        finishedAt: through,
      })
      .execute();
    await tx
      .insertInto('worldAtlasPresentations')
      .values({
        worldId: id,
        title: name,
        slogan: 'Choisissez où commencer votre cité.',
      })
      .execute();
    await tx.updateTable('worlds').set({ isOpen: true, openedAt: through }).where('id', '=', id).execute();
    return { worldId: id, slug, name, created: true, checksum: RC1_CANONICAL_CHECKSUM };
  });
}

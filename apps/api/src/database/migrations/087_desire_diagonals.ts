import { sql, type Kysely } from 'kysely';

/** Diagonal desire edges (docs/SPEC-TRAJETS-8-DIRECTIONS-2026-11-22.md §3.4,
 * slice R2a). `world_desire_edges.direction` was 0 (east) or 1 (south); it may
 * now also be 2 (south-east: towards cell x + 1, y + 1) or 3 (south-west:
 * towards x - 1, y + 1), the origin wrapped on the torus, as `desireEdges`
 * names them.
 *
 * Only the constraint changes. What 086 installed reads no direction value:
 * its statement triggers touch the stream of the chunk of the ORIGIN cell and
 * name the origin cell as the entity, whatever the direction (a south-west edge
 * of column 0 is published in the chunk of its origin, like the east edge of
 * the last column), the visibility test and `world_desire_visible_passages()`
 * (still 3) are per edge, and the readers (sync-v2-desire-readers.ts) group the
 * edges of a cell into its four flags. 086 has no view. So no function,
 * trigger or stream is replaced, and nothing is published by the migration.
 *
 * Down restores the constraint of 085 exactly (same name, same definition).
 * The diagonal edges have no place under it: they are deleted first. The
 * delete trigger of 086 then publishes the cells whose diagonal was visible,
 * so a client still subscribed hears that the diagonal is gone (at the COMMIT
 * of the migration). Their passages are lost: a rollback of the 8-direction
 * search leaves nothing to draw them anyway. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table world_desire_edges drop constraint world_desire_edges_direction_check;
    alter table world_desire_edges add constraint world_desire_edges_direction_check
      check (direction in (0, 1, 2, 3));
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    delete from world_desire_edges where direction in (2, 3);
    alter table world_desire_edges drop constraint world_desire_edges_direction_check;
    alter table world_desire_edges add constraint world_desire_edges_direction_check
      check (direction in (0, 1));
  `.execute(db);
}

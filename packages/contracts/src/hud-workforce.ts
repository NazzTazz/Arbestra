import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const Resource = Type.Union([Type.Literal('wood'), Type.Literal('stone')]);
const Group = Type.Union([Type.Literal('idle'), Type.Literal('working'), Type.Literal('resting')]);
const CommandId = Type.String({ format: 'uuid' });
export const ExtractionPoolCommandSchema = Type.Object(
  {
    commandId: CommandId,
    resource: Resource,
    action: Type.Union(['sites-up', 'sites-down', 'people-up', 'people-down'].map((v) => Type.Literal(v))),
  },
  { additionalProperties: false },
);
export type ExtractionPoolCommand = Static<typeof ExtractionPoolCommandSchema>;
// Declare the union's field names in every branch: Fastify's removeAdditional
// must not erase a later branch's destination while trying the feed branch.
// Optional Never rejects a mixed intention without deleting its fields.
const Absent = Type.Optional(Type.Never());
export const PopulationGestureSchema = Type.Union([
  Type.Object(
    { commandId: CommandId, action: Type.Literal('feed'), group: Group, destination: Absent },
    { additionalProperties: false },
  ),
  Type.Object(
    { commandId: CommandId, action: Type.Literal('rest'), group: Absent, destination: Absent },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      commandId: CommandId,
      action: Type.Literal('release'),
      group: Absent,
      destination: Type.Union([Type.Literal('idle'), Type.Literal('resting')]),
    },
    { additionalProperties: false },
  ),
]);
export type PopulationGesture = Static<typeof PopulationGestureSchema>;
export const ExtractionPoolSchema = Type.Object({
  resource: Resource,
  siteCount: Type.Integer({ minimum: 0, maximum: 8 }),
  workerCap: Type.Integer({ minimum: 1, maximum: 80 }),
  mobilized: Type.Integer({ minimum: 0 }),
  activeSites: Type.Integer({ minimum: 0 }),
  pendingTargets: Type.Integer({ minimum: 0 }),
});
export type ExtractionPool = Static<typeof ExtractionPoolSchema>;

export type HudWorkforceIntent =
  | { kind: 'pool'; command: ExtractionPoolCommand }
  | { kind: 'population'; command: PopulationGesture };
const Count = Type.Integer({ minimum: 0 });
/** A scoped authoritative HUD read, never a replacement for a versioned world snapshot. */
export const HudWorkforceStateSchema = Type.Object({
  worldId: Type.String({ format: 'uuid' }),
  villageId: Type.String({ format: 'uuid' }),
  serverTime: Type.String({ format: 'date-time' }),
  // Fence for accepting a later full snapshot; this does not advance the client's world revision.
  minimumRevision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  population: Type.Object({
    available: Count,
    working: Count,
    resting: Count,
    pendingRelease: Type.Object({ idle: Count, resting: Count }),
  }),
  carrots: Count,
  extractionPools: Type.Array(ExtractionPoolSchema),
  openWorksites: Type.Object({ wood: Count, stone: Count, other: Count }),
});
export type HudWorkforceState = Static<typeof HudWorkforceStateSchema>;
export const hudWorkforceStateIsValid = (value: unknown): value is HudWorkforceState =>
  Value.Check(HudWorkforceStateSchema, value);
export const hudWorkforceIntentIsValid = (value: unknown): value is HudWorkforceIntent => {
  if (!value || typeof value !== 'object' || !('kind' in value) || !('command' in value)) return false;
  return value.kind === 'pool'
    ? Value.Check(ExtractionPoolCommandSchema, value.command)
    : value.kind === 'population' && Value.Check(PopulationGestureSchema, value.command);
};
export const HudWorkforceConfirmationSchema = Type.Object({
  commandId: CommandId,
  affected: Count,
  carrots: Count,
  hud: HudWorkforceStateSchema,
});
export type HudWorkforceConfirmation = Static<typeof HudWorkforceConfirmationSchema>;
export const hudWorkforceConfirmationIsValid = (value: unknown): value is HudWorkforceConfirmation =>
  Value.Check(HudWorkforceConfirmationSchema, value);

/** The requested settings only; actual missions and population are never projected optimistically. */
export function extractionPoolSettings(
  pool: Pick<ExtractionPool, 'siteCount' | 'workerCap'>,
  action: ExtractionPoolCommand['action'],
) {
  let { siteCount, workerCap } = pool;
  if (action === 'sites-up') siteCount++;
  if (action === 'sites-down') siteCount--;
  if (action === 'people-up') workerCap = Math.min(workerCap + 5, 10 * Math.max(1, siteCount));
  if (action === 'people-down') workerCap = Math.max(workerCap - 5, Math.max(1, siteCount));
  extractionPoolCaps(siteCount, workerCap);
  return { siteCount, workerCap };
}

/** Balanced ceilings, independent of actual availability; trips keep their original teams. */
export function extractionPoolCaps(sites: number, people: number): number[] {
  if (
    !Number.isInteger(sites) ||
    sites < 0 ||
    sites > 8 ||
    !Number.isInteger(people) ||
    people < 1 ||
    people > 80 ||
    (sites > 0 && (people < sites || people > sites * 10))
  )
    throw Error('Invalid extraction workforce');
  return Array.from({ length: sites }, (_, i) => Math.floor(people / sites) + (i < people % sites ? 1 : 0));
}

import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  InfrastructurePlanSchema,
  InfrastructureQuoteSchema,
  type InfrastructurePlan,
  type InfrastructureQuote,
} from './infrastructure.js';
import { SynchronizationChangesSchema, synchronizationChanges, applySynchronizationChanges } from './village-sync.js';

/** A committed plan delta, independent of the complete village/world revision.
 * It confirms presentation immediately; the village SSE stream still covers all economic transitions. */
export const InfrastructureConfirmationSchema = Type.Object({
  kind: Type.Literal('infrastructure-confirmation'),
  worldId: Type.String({ format: 'uuid' }),
  villageId: Type.String({ format: 'uuid' }),
  commandId: Type.String({ format: 'uuid' }),
  commandTime: Type.String({ format: 'date-time' }),
  fromRevision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  toRevision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  quote: InfrastructureQuoteSchema,
  changes: SynchronizationChangesSchema,
});
export type InfrastructureConfirmation = Static<typeof InfrastructureConfirmationSchema>;
export const infrastructureConfirmationIsValid = (value: unknown): value is InfrastructureConfirmation =>
  Value.Check(InfrastructureConfirmationSchema, value);
export function infrastructureConfirmation(
  metadata: Pick<InfrastructureConfirmation, 'worldId' | 'villageId' | 'commandId' | 'commandTime'>,
  before: InfrastructurePlan,
  after: InfrastructurePlan,
  quote: InfrastructureQuote,
): InfrastructureConfirmation {
  const changes = synchronizationChanges(before, after);
  if (after.revision < before.revision || (after.revision === before.revision && changes.length))
    throw Error('Invalid infrastructure confirmation revisions');
  return {
    ...metadata,
    kind: 'infrastructure-confirmation',
    fromRevision: before.revision,
    toRevision: after.revision,
    quote,
    changes,
  };
}
export type InfrastructureConfirmationResult =
  | { kind: 'applied'; plan: InfrastructurePlan }
  | { kind: 'ignored' | 'resync' };
/** The caller guards world/village and subscription generation. Never advance syncRevision here. */
export function applyInfrastructureConfirmation(
  plan: InfrastructurePlan,
  input: unknown,
): InfrastructureConfirmationResult {
  if (!infrastructureConfirmationIsValid(input) || input.toRevision < input.fromRevision) return { kind: 'resync' };
  if (input.toRevision <= plan.revision) return { kind: 'ignored' };
  if (input.fromRevision !== plan.revision) return { kind: 'resync' };
  try {
    const next = applySynchronizationChanges(plan, input.changes);
    if (!Value.Check(InfrastructurePlanSchema, next) || next.revision !== input.toRevision) return { kind: 'resync' };
    return { kind: 'applied', plan: next };
  } catch {
    return { kind: 'resync' };
  }
}

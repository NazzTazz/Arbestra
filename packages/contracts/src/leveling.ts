import { Type, type Static } from '@sinclair/typebox';

const Cell = Type.Object({ cellX: Type.Integer({ minimum: 0 }), cellY: Type.Integer({ minimum: 0 }) });
const Point = Type.Object({ cellX: Type.Number(), cellY: Type.Number() });
export const LevelingRequestSchema = Type.Object({
  buildingType: Type.Union([Type.Literal('university'), Type.Literal('stonemason')]),
  anchor: Cell, quarterTurns: Type.Integer({ minimum: 0, maximum: 3 }),
  workerCount: Type.Integer({ minimum: 1, maximum: 3 }),
}, { additionalProperties: false });
export const LevelingQuoteSchema = Type.Object({
  height: Type.Number(), cells: Type.Array(Cell), workMs: Type.Integer({ minimum: 1 }),
  transportMs: Type.Integer({ minimum: 0 }), durationMs: Type.Integer({ minimum: 1 }),
  stoneDebit: Type.Integer({ minimum: 0 }), stoneCredit: Type.Integer({ minimum: 0 }),
  signature: Type.String(),
});
export const LevelingPreviewSchema = Type.Object({
  quote: LevelingQuoteSchema, availableWorkers: Type.Integer({ minimum: 0 }),
  valid: Type.Boolean(), message: Type.Union([Type.String(), Type.Null()]),
});
export const LevelingCommandSchema = Type.Object({
  ...LevelingRequestSchema.properties, commandId: Type.String({ format: 'uuid' }), expected: LevelingQuoteSchema,
}, { additionalProperties: false });
export const LevelingJobSchema = Type.Object({
  id: Type.String({ format: 'uuid' }), featureId: Type.String({ format: 'uuid' }),
  buildingType: LevelingRequestSchema.properties.buildingType,
  cells: Type.Array(Cell), height: Type.Number(), workerCount: Type.Integer(),
  path: Type.Array(Point), transportMs: Type.Integer(), startedAt: Type.String({ format: 'date-time' }),
  completesAt: Type.String({ format: 'date-time' }),
});
export type LevelingRequest = Static<typeof LevelingRequestSchema>;
export type LevelingQuote = Static<typeof LevelingQuoteSchema>;
export type LevelingPreview = Static<typeof LevelingPreviewSchema>;
export type LevelingCommand = Static<typeof LevelingCommandSchema>;
export type LevelingJob = Static<typeof LevelingJobSchema>;

/** Five minutes of labour per quarter unit moved, shared by the team.
 * Equal-area samples balance cut and fill. Rounding only the final duration
 * avoids charging an entire quarter for arbitrarily small relief. */
export function levelingWork(samples: readonly (readonly number[])[], workers: number) {
  if (!samples.length || samples.some(s => !s.length || s.some(h => !Number.isFinite(h))) || !Number.isInteger(workers) || workers < 1 || workers > 3)
    throw new Error('Invalid leveling samples/team');
  const mean = (values: readonly number[]) => values.reduce((n, h) => n + h, 0) / values.length;
  const height = mean(samples.map(mean));
  const volume = samples.reduce((n, s) => n + mean(s.map(h => Math.abs(h - height))), 0);
  return { height, workMs: Math.max(1, Math.ceil(volume / .25 * 300_000 / workers)) };
}

/** Elevations in village snapshots are hundredths of a terrain unit. */
export function isBuildingFootprintFlat(heights: readonly number[]): boolean {
  return heights.length > 0 && heights.every(Number.isFinite)
    && Math.max(...heights) - Math.min(...heights) <= 1;
}

/** A worksite is one logical feature with several physical cells. */
export function terrainFeatureKey(feature: {id:string;type:string;cellX:number;cellY:number}) {
  return feature.type === 'leveling-site' ? `${feature.id}:${feature.cellX}:${feature.cellY}` : feature.id;
}

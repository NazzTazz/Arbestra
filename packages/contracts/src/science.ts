import { Type, type Static } from '@sinclair/typebox';

export const ScienceDisciplineSchema = Type.Union([
  Type.Literal('mathematics'), Type.Literal('geography'), Type.Literal('astronomy'),
]);
export type ScienceDiscipline = Static<typeof ScienceDisciplineSchema>;

export const ScienceProgramStatusSchema = Type.Union([
  Type.Literal('available'), Type.Literal('blocked'), Type.Literal('working'),
  Type.Literal('waiting-data'), Type.Literal('waiting-means'), Type.Literal('paused'), Type.Literal('acquired'),
]);
const PointSchema = Type.Object({ cellX: Type.Integer({ minimum: 0 }), cellY: Type.Integer({ minimum: 0 }) });
export const ScienceStateSchema = Type.Object({
  serverTime: Type.String({ format: 'date-time' }),
  levels: Type.Object({ mathematics: Type.Integer({ minimum: 0 }), geography: Type.Integer({ minimum: 0 }), astronomy: Type.Integer({ minimum: 0 }) }),
  knowledgeCoefficient: Type.Number({ minimum: 0, maximum: 1 }),
  geographyRevision: Type.Number({ minimum: 0 }),
  globalModelAvailable: Type.Boolean(),
  programs: Type.Array(Type.Object({
    code: Type.String(), discipline: ScienceDisciplineSchema, level: Type.Integer({ minimum: 1 }),
    title: Type.String(), description: Type.String(), status: ScienceProgramStatusSchema,
    workDoneMs: Type.Number({ minimum: 0 }), workRequiredMs: Type.Number({ minimum: 1 }),
    needs: Type.Array(Type.String()), spontaneous: Type.Boolean(),
    acquiredAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  })),
  universities: Type.Array(Type.Object({
    buildingId: Type.String({ format: 'uuid' }), villageId: Type.String({ format: 'uuid' }),
    level: Type.Integer({ minimum: 1 }), centres: Type.Integer({ minimum: 1 }),
    workerCapacity: Type.Integer({ minimum: 1 }), occupiedCentres: Type.Integer({ minimum: 0 }),
    mobilizedWorkers: Type.Integer({ minimum: 0 }),
  })),
  activities: Type.Array(Type.Object({
    id: Type.String({ format: 'uuid' }), villageId: Type.String({ format: 'uuid' }),
    buildingId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    kind: Type.Union([Type.Literal('research'), Type.Literal('training'), Type.Literal('survey'), Type.Literal('exploration')]),
    programCode: Type.Union([Type.String(), Type.Null()]), workerCount: Type.Integer({ minimum: 1 }),
    startedAt: Type.String({ format: 'date-time' }), completesAt: Type.String({ format: 'date-time' }),
    path: Type.Array(Type.Object({cellX:Type.Number(),cellY:Type.Number()})), target: Type.Union([PointSchema, Type.Null()]),
  })),
  cartographers: Type.Integer({ minimum: 0 }),
  surveyedPlaces: Type.Integer({ minimum: 0 }),
  solarObservations: Type.Object({ since: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    readyAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]), complete: Type.Boolean() }),
  villageReports: Type.Array(Type.Object({
    villageId: Type.String({ format: 'uuid' }), name: Type.String(), anchor: PointSchema,
    observedAt: Type.String({ format: 'date-time' }),
  })),
});
export type ScienceState = Static<typeof ScienceStateSchema>;

export const ScienceCommandSchema = Type.Union([
  Type.Object({ action: Type.Literal('research'), buildingId: Type.String({ format: 'uuid' }), programCode: Type.String(),
    workerCount: Type.Integer({ minimum: 1, maximum: 15 }) }),
  Type.Object({ action: Type.Union([Type.Literal('pause'), Type.Literal('resume')]), programCode: Type.String() }),
  Type.Object({ action: Type.Literal('train'), buildingId: Type.String({ format: 'uuid' }) }),
  Type.Object({ action: Type.Union([Type.Literal('survey'), Type.Literal('explore')]), target: PointSchema,
    budgetSeconds: Type.Integer({ minimum: 60, maximum: 86400 }) }),
  Type.Object({ action: Type.Literal('recall'), activityId: Type.String({ format: 'uuid' }) }),
]);
export type ScienceCommand = Static<typeof ScienceCommandSchema>;

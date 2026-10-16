import { Type, type Static } from '@sinclair/typebox';

const Id = Type.String({ format: 'uuid' });
const DateTime = Type.String({ format: 'date-time' });
const Count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const NullableDate = Type.Union([DateTime, Type.Null()]);
export const HttpRequestReferenceSchema = Type.Object({ instanceId: Id, requestId: Id }, { additionalProperties: false });
export type HttpRequestReference = Static<typeof HttpRequestReferenceSchema>;
export const HttpDiagnosticReasonSchema = Type.Union([Type.Literal('server_error'), Type.Literal('slow'), Type.Literal('aborted')]);
export const HttpDiagnosticMethodSchema = Type.Union((['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE', 'OTHER'] as const).map(value => Type.Literal(value)));
export const HttpDiagnosticCodeSchema = Type.Union((['INTERNAL_ERROR', 'ADMIN_BUSY', 'ADMIN_DATA_UNAVAILABLE', 'VALIDATION_ERROR', 'HTTP_SERVER_RESPONSE', 'CONNECTION_INTERRUPTED'] as const).map(value => Type.Literal(value)));
export const HttpCaptureSiteSchema = Type.Union((['http.error-handler', 'http.on-error', 'http.finalize', 'admin.read'] as const).map(value => Type.Literal(value)));
export const HttpRequestObservationSchema = Type.Object({
  instanceId: Id, requestId: Id, sequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  startedAt: DateTime, endedAt: DateTime, durationMs: Type.Number({ minimum: 0 }),
  method: HttpDiagnosticMethodSchema, route: Type.String({ maxLength: 256 }), scope: Type.Union([Type.Literal('api'), Type.Literal('console')]),
  outcome: Type.Union([Type.Literal('response'), Type.Literal('aborted')]),
  statusCode: Type.Union([Type.Integer({ minimum: 100, maximum: 599 }), Type.Null()]),
  reasons: Type.Array(HttpDiagnosticReasonSchema, { minItems: 1, maxItems: 3, uniqueItems: true }),
  slowThresholdMs: Type.Integer({ minimum: 250, maximum: 60_000 }),
  safeCode: Type.Union([HttpDiagnosticCodeSchema, Type.Null()]),
  errorCategory: Type.Union([Type.Literal('application'), Type.Literal('internal'), Type.Literal('transport'), Type.Literal('unknown'), Type.Null()]),
  captureSite: HttpCaptureSiteSchema,
}, { additionalProperties: false });
export type HttpRequestObservation = Static<typeof HttpRequestObservationSchema>;
export type HttpDiagnosticCode = NonNullable<HttpRequestObservation['safeCode']>;
export type HttpCaptureSite = HttpRequestObservation['captureSite'];

export const HttpDiagnosticLogStateSchema = Type.Object({
  mode: Type.Union([Type.Literal('anomalies'), Type.Literal('off')]), emitted: Count, dropped: Count,
  droppedRateLimit: Count, droppedCapacity: Count, droppedTransport: Count, queuedLines: Count, queuedBytes: Count,
}, { additionalProperties: false });
export type HttpDiagnosticLogState = Static<typeof HttpDiagnosticLogStateSchema>;
export const HttpDiagnosticsMetadataSchema = Type.Object({
  observedAt: DateTime, instanceId: Id, startedAt: DateTime,
  slowThresholdMs: Type.Integer({ minimum: 250, maximum: 60_000 }), retentionMs: Count, capacity: Count,
  retained: Count, oldestRetainedAt: NullableDate, evicted: Count, expired: Count, collectionFailures: Count,
  logs: HttpDiagnosticLogStateSchema,
}, { additionalProperties: false });
export type HttpDiagnosticsMetadata = Static<typeof HttpDiagnosticsMetadataSchema>;
export const HttpRequestsQuerySchema = Type.Object({
  instanceId: Type.Optional(Id), from: Type.Optional(DateTime), to: Type.Optional(DateTime),
  reason: Type.Optional(HttpDiagnosticReasonSchema), method: Type.Optional(HttpDiagnosticMethodSchema),
  route: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })), scope: Type.Optional(Type.Union([Type.Literal('api'), Type.Literal('console')])),
  requestId: Type.Optional(Id), minDurationMs: Type.Optional(Type.Number({ minimum: 0, maximum: 86_400_000 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), snapshotSequence: Type.Optional(Count), beforeSequence: Type.Optional(Count),
}, { additionalProperties: false });
export type HttpRequestsQuery = Static<typeof HttpRequestsQuerySchema>;
export const HttpRequestsPageSchema = Type.Object({
  metadata: HttpDiagnosticsMetadataSchema, from: DateTime, to: DateTime, snapshotSequence: Count,
  nextBeforeSequence: Type.Union([Count, Type.Null()]), items: Type.Array(HttpRequestObservationSchema, { maxItems: 100 }),
}, { additionalProperties: false });
export type HttpRequestsPage = Static<typeof HttpRequestsPageSchema>;

export const OperationalEventSchema = Type.Object({
  id: Id, at: DateTime, severity: Type.Union([Type.Literal('info'), Type.Literal('warning'), Type.Literal('error')]),
  code: Type.String({ maxLength: 80 }), message: Type.String({ maxLength: 256 }),
  worldId: Type.Union([Id, Type.Null()]), villageId: Type.Union([Id, Type.Null()]),
  httpRequest: Type.Union([HttpRequestReferenceSchema, Type.Null()]),
}, { additionalProperties: false });
export type OperationalEvent = Static<typeof OperationalEventSchema>;
export const HttpRequestDetailSchema = Type.Object({
  metadata: HttpDiagnosticsMetadataSchema, observation: HttpRequestObservationSchema,
  events: Type.Array(OperationalEventSchema, { maxItems: 100 }),
}, { additionalProperties: false });
export type HttpRequestDetail = Static<typeof HttpRequestDetailSchema>;
export const HttpInstanceMismatchSchema = Type.Object({
  code: Type.Literal('INSTANCE_MISMATCH'), message: Type.String(), instanceId: Id, startedAt: DateTime,
}, { additionalProperties: false });

export const OperationalStatusReasonSchema = Type.Object({
  code: Type.String({ maxLength: 80 }), source: Type.Union([Type.Literal('http'), Type.Literal('database'), Type.Literal('worker'), Type.Literal('coverage')]),
  status: Type.Union([Type.Literal('degraded'), Type.Literal('unavailable'), Type.Literal('unknown')]),
  message: Type.String({ maxLength: 256 }), observedAt: NullableDate, from: NullableDate, to: NullableDate,
  count: Type.Union([Count, Type.Null()]), workerId: Type.Union([Type.String({ maxLength: 80 }), Type.Null()]),
}, { additionalProperties: false });
export type OperationalStatusReason = Static<typeof OperationalStatusReasonSchema>;

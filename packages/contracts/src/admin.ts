import { Type, type Static } from '@sinclair/typebox';

const Id = Type.String({ format: 'uuid' });
const DateTime = Type.String({ format: 'date-time' });
const NullableDate = Type.Union([DateTime, Type.Null()]);
const NullableId = Type.Union([Id, Type.Null()]);
const Count = Type.Integer({ minimum: 0 });
export const AdminSessionSchema = Type.Object({
  account: Type.Object({ id: Id }),
  permissions: Type.Array(Type.Literal('noc:read')),
});
export type AdminSession = Static<typeof AdminSessionSchema>;

export const AdminTaskSummarySchema = Type.Object({
  pending: Count,
  due: Count,
  retrying: Count,
  oldestDueAt: NullableDate,
});
export const AdminExpeditionSummarySchema = Type.Object({
  // pending/active are current totals; terminal/admitted counts describe the bounded receipt sample.
  pending: Count,
  admitted: Count,
  active: Count,
  completed: Count,
  rejected: Count,
  failed: Count,
  sampleSize: Count,
  sampleLimit: Count,
  truncated: Type.Boolean(),
  note: Type.String(),
});
export const AdminWorldSchema = Type.Object({
  id: Id,
  slug: Type.String(),
  name: Type.String(),
  isOpen: Type.Boolean(),
  generationStatus: Type.String(),
  generationVersion: Count,
  widthCells: Count,
  heightCells: Count,
  createdAt: DateTime,
  accounts: Count,
  villages: Count,
  activeScience: Count,
});
export type AdminWorld = Static<typeof AdminWorldSchema>;
export const AdminVillageSchema = Type.Object({
  id: Id,
  worldId: Id,
  worldSlug: Type.String(),
  ownerAccountId: Id,
  name: Type.String(),
  anchorCellX: Type.Integer(),
  anchorCellY: Type.Integer(),
  createdAt: DateTime,
});
export type AdminVillage = Static<typeof AdminVillageSchema>;
export const AdminAccountSchema = Type.Object({
  id: Id,
  email: Type.String(),
  createdAt: DateTime,
  worlds: Count,
  villages: Count,
});
export type AdminAccount = Static<typeof AdminAccountSchema>;
export const AdminActivityKindSchema = Type.Union([
  Type.Literal('expedition'),
  Type.Literal('science'),
  Type.Literal('task'),
]);
export const AdminActivitySchema = Type.Object({
  id: Id,
  kind: AdminActivityKindSchema,
  worldId: Id,
  villageId: NullableId,
  accountId: NullableId,
  label: Type.String(),
  status: Type.String(),
  receiptStatus: Type.Union([Type.String(), Type.Null()]),
  startedAt: DateTime,
  dueAt: NullableDate,
  completedAt: NullableDate,
  attempts: Count,
  errorCode: Type.Union([Type.String(), Type.Null()]),
  relatedActivityId: NullableId,
});
export type AdminActivity = Static<typeof AdminActivitySchema>;
export const AdminDiagnosticSchema = Type.Object({
  status: Type.Union([Type.Literal('ok'), Type.Literal('attention'), Type.Literal('unknown')]),
  code: Type.String(),
  message: Type.String(),
});
export type AdminDiagnostic = Static<typeof AdminDiagnosticSchema>;
export const AdminOverviewSchema = Type.Object({
  observedAt: DateTime,
  refreshAfterSeconds: Count,
  counts: Type.Object({ accounts: Count, worlds: Count, openWorlds: Count, villages: Count }),
  tasks: AdminTaskSummarySchema,
  expeditions: AdminExpeditionSummarySchema,
  recentActivities: Type.Array(AdminActivitySchema),
  activityNote: Type.String(),
});
export type AdminOverview = Static<typeof AdminOverviewSchema>;
export const AdminWorldsSchema = Type.Object({
  observedAt: DateTime,
  items: Type.Array(AdminWorldSchema),
  truncated: Type.Boolean(),
  limit: Count,
});
export type AdminWorlds = Static<typeof AdminWorldsSchema>;
export const AdminWorldDetailSchema = Type.Object({
  observedAt: DateTime,
  world: AdminWorldSchema,
  tasks: AdminTaskSummarySchema,
  expeditions: AdminExpeditionSummarySchema,
  villages: Type.Array(AdminVillageSchema),
  villagesTruncated: Type.Boolean(),
  recentActivities: Type.Array(AdminActivitySchema),
  activityNote: Type.String(),
  synchronization: Type.Object({ revision: Type.Null(), note: Type.String() }),
});
export type AdminWorldDetail = Static<typeof AdminWorldDetailSchema>;
export const AdminAccountsSchema = Type.Object({
  observedAt: DateTime,
  items: Type.Array(AdminAccountSchema),
  truncated: Type.Boolean(),
  limit: Count,
});
export type AdminAccounts = Static<typeof AdminAccountsSchema>;
export const AdminAccountDetailSchema = Type.Object({
  observedAt: DateTime,
  account: AdminAccountSchema,
  memberships: Type.Array(
    Type.Object({ worldId: Id, worldSlug: Type.String(), playerName: Type.String(), joinedAt: DateTime }),
  ),
  villages: Type.Array(AdminVillageSchema),
  truncated: Type.Boolean(),
  recentActivities: Type.Array(AdminActivitySchema),
  activityNote: Type.String(),
});
export type AdminAccountDetail = Static<typeof AdminAccountDetailSchema>;
export const AdminVillageDetailSchema = Type.Object({
  observedAt: DateTime,
  village: AdminVillageSchema,
  economy: Type.Object({
    mode: Type.Literal('persisted-only'),
    note: Type.String(),
    resources: Type.Array(
      Type.Object({ code: Type.String(), amount: Type.String(), productionUpdatedAt: NullableDate }),
    ),
    population: Type.Object({ total: Count, idle: Count, working: Count, resting: Count }),
    buildings: Count,
    constructionDue: Count,
    harvestsDue: Count,
    extractionsDue: Count,
    processingDue: Count,
    marketDue: Count,
    scienceDue: Count,
  }),
  recentActivities: Type.Array(AdminActivitySchema),
  activityNote: Type.String(),
  diagnostics: Type.Array(AdminDiagnosticSchema),
});
export type AdminVillageDetail = Static<typeof AdminVillageDetailSchema>;
export const AdminActivitiesSchema = Type.Object({
  observedAt: DateTime,
  items: Type.Array(AdminActivitySchema),
  truncated: Type.Boolean(),
  limit: Count,
  note: Type.String(),
});
export type AdminActivities = Static<typeof AdminActivitiesSchema>;
export const AdminActivityDetailSchema = Type.Object({
  observedAt: DateTime,
  activity: AdminActivitySchema,
  relatedActivities: Type.Array(AdminActivitySchema),
  diagnostics: Type.Array(AdminDiagnosticSchema),
});
export type AdminActivityDetail = Static<typeof AdminActivityDetailSchema>;

/** Player journey (NOC « Parcours », docs/DESIGN-OBSERVABILITE-PARCOURS.md §2.6).
 * `action`: a command of the player, as the server answered it; `deferred`:
 * the later completion of a player's command (building, leveling, market,
 * science); `automatic`: an accomplishment recorded by the economy. */
export const AdminJourneySourceSchema = Type.Union([
  Type.Literal('action'),
  Type.Literal('deferred'),
  Type.Literal('automatic'),
]);
export const AdminJourneyOutcomeSchema = Type.Union([
  Type.Literal('accepted'),
  Type.Literal('pending'),
  Type.Literal('rejected'),
  Type.Literal('error'),
  Type.Literal('interrupted'),
  Type.Literal('completed'),
]);
export const AdminJourneyEventSchema = Type.Object({
  id: Type.String({ maxLength: 80 }),
  at: DateTime,
  source: AdminJourneySourceSchema,
  type: Type.String({ maxLength: 64 }),
  subject: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
  outcome: AdminJourneyOutcomeSchema,
  code: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
  attempts: Count,
  commandId: NullableId,
  worldId: Id,
  villageId: Id,
  /** Index of the session containing this event, null outside any session. */
  session: Type.Union([Count, Type.Null()]),
});
export type AdminJourneyEvent = Static<typeof AdminJourneyEventSchema>;
export const AdminJourneySessionSchema = Type.Object({
  index: Count,
  startedAt: DateTime,
  lastActivityAt: DateTime,
  endedAt: DateTime,
  activeMinutes: Count,
  actions: Count,
  refused: Count,
  ongoing: Type.Boolean(),
});
export type AdminJourneySession = Static<typeof AdminJourneySessionSchema>;
export const AdminJourneySchema = Type.Object({
  observedAt: DateTime,
  account: Type.Object({ id: Id, email: Type.String(), admin: Type.Boolean() }),
  villages: Type.Array(Type.Object({ id: Id, worldId: Id, worldSlug: Type.String(), name: Type.String() })),
  scope: Type.Object({ worldId: NullableId, villageId: NullableId, from: DateTime, days: Count }),
  collection: Type.Object({
    enabled: Type.Boolean(),
    dropped: Count,
    lost: Count,
    oldestRetainedAt: NullableDate,
    retentionDays: Count,
    inactivityMinutes: Count,
    note: Type.String(),
  }),
  sessions: Type.Array(AdminJourneySessionSchema),
  sessionsTruncated: Type.Boolean(),
  events: Type.Array(AdminJourneyEventSchema),
  eventsTruncated: Type.Boolean(),
  limit: Count,
  summary: Type.Object({
    byType: Type.Array(
      Type.Object({
        type: Type.String({ maxLength: 64 }),
        actions: Count,
        refused: Count,
        sessions: Count,
        firstAt: DateTime,
      }),
    ),
    refusals: Type.Array(Type.Object({ type: Type.String({ maxLength: 64 }), code: Type.String(), count: Count })),
  }),
});
export type AdminJourney = Static<typeof AdminJourneySchema>;

import { Type, type Static } from '@sinclair/typebox';

export const LoginRequestSchema = Type.Object({
  email: Type.String({ format: 'email', maxLength: 320 }),
  password: Type.String({ minLength: 1, maxLength: 1024 }),
});

export type LoginRequest = Static<typeof LoginRequestSchema>;

export const RegisterRequestSchema = Type.Object({
  email: Type.String({ format: 'email', maxLength: 320 }),
  password: Type.String({ minLength: 8, maxLength: 128 }),
}, { additionalProperties: false });
export type RegisterRequest = Static<typeof RegisterRequestSchema>;
export const JoinWorldRequestSchema = Type.Object({
  playerName: Type.String({ minLength: 1, maxLength: 40, pattern: '\\S' }),
  villageName: Type.String({ minLength: 1, maxLength: 60, pattern: '\\S' }),
}, { additionalProperties: false });
export type JoinWorldRequest = Static<typeof JoinWorldRequestSchema>;
export const AvailableWorldsSchema = Type.Array(Type.Object({
  slug: Type.String(), name: Type.String(), joined: Type.Boolean(), canJoin: Type.Boolean(),
}));
export type AvailableWorlds = Static<typeof AvailableWorldsSchema>;
export const JoinWorldResponseSchema = Type.Object({ villageId: Type.String({ format: 'uuid' }) });
export type JoinWorldResponse = Static<typeof JoinWorldResponseSchema>;

export const AccountSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  email: Type.String({ format: 'email' }),
});

export type Account = Static<typeof AccountSchema>;

export const WorldSummarySchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  slug: Type.String(),
  name: Type.String(),
  playerName: Type.String(),
});

export type WorldSummary = Static<typeof WorldSummarySchema>;

export const SessionResponseSchema = Type.Object({
  account: AccountSchema,
  worlds: Type.Array(WorldSummarySchema),
});

export type SessionResponse = Static<typeof SessionResponseSchema>;

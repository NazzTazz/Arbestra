import { Type, type Static } from '@sinclair/typebox';

export const LoginRequestSchema = Type.Object({
  email: Type.String({ format: 'email', maxLength: 320 }),
  password: Type.String({ minLength: 1, maxLength: 1024 }),
});

export type LoginRequest = Static<typeof LoginRequestSchema>;

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

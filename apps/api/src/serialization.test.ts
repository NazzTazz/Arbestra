import { describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { VillageStateSchema } from '@arbestra/contracts';
import { Type } from '@sinclair/typebox';
import { buildApp } from './app.js';
import type { Database } from './database/schema.js';

describe('shared response serialization', () => {
  it('reuses the village serializer across GET and commands without changing nullable output or field filtering', async () => {
    // No database access: this exercises the real application compiler and HTTP serialization.
    const app = await buildApp({ databaseUrl: '', host: '127.0.0.1', port: 0, isProduction: false,
      cookieName: 'test', sessionTtlDays: 1, constructionDurationOverrideMs: null, scheduledTaskPollIntervalMs: 250 }, {} as Kysely<Database>);
    const schema = Type.Object({ value: Type.Union([Type.Object({ amount: Type.Integer() }), Type.Null()]) });
    app.get('/serialization-test/null', { schema: { response: { 200: schema } } }, async () => ({ value: null, privateField: 'omitted' }));
    app.get('/serialization-test/value', { schema: { response: { 200: schema } } }, async () => ({ value: { amount: 3, privateField: 'omitted' } }));
    try {
      await app.ready();
      const compiler = app.serializerCompiler!;
      const read = compiler({ schema: VillageStateSchema, method: 'GET', url: '/village', httpStatus: '200' });
      const command = compiler({ schema: structuredClone(VillageStateSchema), method: 'POST', url: '/exploitation', httpStatus: '200' });
      expect(command).toBe(read);
      expect((await app.inject('/serialization-test/null')).json()).toEqual({ value: null });
      expect((await app.inject('/serialization-test/value')).json()).toEqual({ value: { amount: 3 } });
      const different = compiler({ schema: Type.Object({ another: Type.String() }), method: 'GET', url: '/other', httpStatus: '200' });
      expect(different).not.toBe(read);
      expect(JSON.parse(different({ another: 'kept', privateField: 'omitted' }))).toEqual({ another: 'kept' });
    } finally { await app.close(); }
  });
});

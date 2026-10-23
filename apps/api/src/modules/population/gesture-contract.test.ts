import Fastify from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PopulationGestureSchema } from '@arbestra/contracts';

const app = Fastify(),
  commandId = '10000000-0000-4000-8000-000000000001';
beforeAll(async () => {
  app.post('/gestures', { schema: { body: PopulationGestureSchema } }, async (request) => request.body);
  await app.ready();
});
afterAll(() => app.close());
it.each([
  { action: 'feed', group: 'working' },
  { action: 'rest' },
  { action: 'release', destination: 'idle' },
  { action: 'release', destination: 'resting' },
])('preserves every valid gesture through the real HTTP validator: $action $destination', async (command) => {
  const payload = { commandId, ...command },
    response = await app.inject({ method: 'POST', url: '/gestures', payload });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual(payload);
});
it.each([
  { action: 'feed' },
  { action: 'release' },
  { action: 'release', group: 'idle', destination: 'resting' },
  { action: 'rest', group: 'working' },
  { action: 'feed', group: 'working', destination: 'idle' },
])('rejects incomplete or mixed gesture intentions: $action $group $destination', async (command) => {
  expect((await app.inject({ method: 'POST', url: '/gestures', payload: { commandId, ...command } })).statusCode).toBe(
    400,
  );
});

import { createServer } from 'node:net';
import { expect, it } from 'vitest';
import { DatabaseProbe } from './database-probe.js';
import { OperationsTelemetry } from './telemetry.js';

it('reports a real refused PostgreSQL handshake as unavailable, shares the probe and masks connection secrets', async () => {
  let connections = 0;
  const server = createServer(socket => { connections++; socket.destroy(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing local probe address');
  const telemetry = new OperationsTelemetry(Date.now, false);
  const probe = new DatabaseProbe(`postgres://private:never-expose@127.0.0.1:${address.port}/arbestra_test`, telemetry);
  try {
    const first = probe.read(), second = probe.read();
    expect(first).toBe(second);
    const result = await first;
    expect(result).toMatchObject({ status: 'unavailable', latencyMs: null, connections: null, activeQueries: null });
    expect(await probe.read()).toBe(result);
    expect(connections).toBe(1);
    expect(telemetry.snapshot(result).events).toEqual([expect.objectContaining({ code: 'DATABASE_UNAVAILABLE' })]);
    expect(JSON.stringify(telemetry.snapshot(result))).not.toMatch(/never-expose|postgres:\/\//);
  } finally {
    await probe.close(); telemetry.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

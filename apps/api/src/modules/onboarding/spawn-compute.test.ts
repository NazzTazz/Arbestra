import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';

// A fake worker: under `node --watch`, module-load notices reach the parent on
// the message channel before the computed reply.
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    postMessage() {
      queueMicrotask(() => {
        this.emit('message', { 'watch:import': ['file:///spawn-compute-worker.ts'] });
        this.emit('message', { ok: true, result: { worldSlug: 'aube' } });
      });
    }
    ref() {}
    unref() {}
    terminate() {
      return Promise.resolve(0);
    }
  },
}));

it('ignores worker messages that are not replies instead of failing the pending job', async () => {
  const { SpawnCompute } = await import('./spawn-compute.js');
  const compute = new SpawnCompute();
  try {
    await expect(compute.run({ kind: 'map' } as never)).resolves.toEqual({ worldSlug: 'aube' });
  } finally {
    await compute.close();
  }
});

import { Worker } from 'node:worker_threads';
import { HttpError } from '../../errors.js';
import type { SpawnJob, SpawnReply } from './spawn-compute-protocol.js';

/** One lazy CPU worker per app, with bounded admission. Database snapshots stay
 * in the request layer; no worker can read/write the DB or cache occupations. */
export class SpawnCompute {
  private worker: Worker | undefined;
  private closed = false;
  private queue: Array<{ job: SpawnJob; resolve: (result: Extract<SpawnReply, { ok: true }>['result']) => void; reject: (error: Error) => void }> = [];
  private timeout?: ReturnType<typeof setTimeout>;
  run(job: SpawnJob): Promise<Extract<SpawnReply, { ok: true }>['result']> {
    if (this.closed) return Promise.reject(new HttpError(503, 'SPAWN_COMPUTE_CLOSED', 'Le diagnostic est indisponible. Réessayez.'));
    if (this.queue.length >= 4) return Promise.reject(new HttpError(503, 'SPAWN_COMPUTE_BUSY', 'Le diagnostic est occupé. Réessayez.'));
    return new Promise((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      if (this.queue.length === 1) { try { this.dispatch(); } catch { this.fail(); } }
    });
  }
  private dispatch() {
    if (!this.worker) {
      const source = import.meta.url.endsWith('.ts');
      const entry = new URL(source ? './spawn-compute-worker.ts' : './spawn-compute-worker.js', import.meta.url);
      // TSX registration inside the worker also covers dev and Vitest. Built
      // production runs plain JS and does not depend on the dev loader.
      const worker = source ? new Worker(`import('tsx/esm/api').then(({ register }) => { register(); return import(${JSON.stringify(entry.href)}); });`, { eval: true, execArgv: [] })
        : new Worker(entry, { execArgv: [] });
      this.worker = worker;
      worker.on('message', (reply: SpawnReply) => {
        if (this.worker !== worker) return;
        clearTimeout(this.timeout);
        const pending = this.queue.shift()!;
        if (reply.ok) pending.resolve(reply.result);
        else pending.reject(new HttpError(reply.statusCode, reply.code, reply.message));
        if (this.queue.length) this.dispatch(); else worker.unref();
      });
      worker.on('error', () => { if (this.worker === worker) this.fail(); });
      worker.on('exit', () => { if (this.worker === worker) this.fail(); });
    }
    this.worker.ref();
    this.timeout = setTimeout(() => this.fail(), 60_000);
    try { this.worker.postMessage(this.queue[0]!.job); } catch { this.fail(); }
  }
  private fail() {
    clearTimeout(this.timeout);
    const worker = this.worker; this.worker = undefined;
    const terminated = worker?.terminate();
    for (const pending of this.queue.splice(0)) pending.reject(new HttpError(503, 'SPAWN_COMPUTE_FAILED', 'Le diagnostic a été interrompu. Réessayez.'));
    return terminated;
  }
  async close() {
    this.closed = true;
    await this.fail();
  }
}

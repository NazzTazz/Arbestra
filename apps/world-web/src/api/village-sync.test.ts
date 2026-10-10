import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { villageFrame, type VillageState } from '@arbestra/contracts';
import { VillageSynchronization, villageRequestGeneration, type VillageEventSource } from './village-sync';
import { getVillage } from './client';
class Source implements VillageEventSource {
  listeners = new Map<string, (event: MessageEvent<string>) => void>();
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) { this.listeners.set(type, listener); }
  close() { this.closed = true; }
  send(type: string, value: unknown) { this.listeners.get(type)?.({ data: JSON.stringify(value) } as MessageEvent<string>); }
}
const sessions: VillageSynchronization[] = [];
afterEach(() => { sessions.splice(0).forEach(s => s.close()); vi.useRealTimers(); vi.unstubAllGlobals(); });
function harness() {
  let state = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/village-sync-state.json', import.meta.url), 'utf8')) as VillageState;
  const sources: Source[] = [], accepted = vi.fn(snapshot => { state = snapshot.state; });
  const options = { current: () => state, offset: () => 5, accept: accepted, source: () => { const s = new Source(); sources.push(s); return s; } };
  const sync = new VillageSynchronization(state.world.slug, state.world.id, state.village.id, options); sessions.push(sync);
  return { sources, sync, accepted, options, state: () => state };
}
it('recovers a missing notification detected by an authoritative revision, without advancing on receipt alone', async () => {
  vi.useFakeTimers(); const h = harness(), old = h.sources[0]!;
  old.send('revision', { worldId: h.state().world.id, villageId: h.state().village.id, revision: 2 });
  expect(old.closed).toBe(true); expect(h.state().syncRevision).toBe(1);
  await vi.advanceTimersByTimeAsync(100); expect(h.sources).toHaveLength(2);
  const recovered = { ...h.state(), syncRevision: 2, village: { ...h.state().village, wood: 200 } };
  h.sources[1]!.send('snapshot', recovered); expect(h.state().village.wood).toBe(200);
  old.send('snapshot', { ...recovered, syncRevision: 3, village: { ...recovered.village, wood: 0 } });
  expect(h.state().syncRevision).toBe(2);
});
it('applies once, resynchronizes a gap and rejects late events after reconnect or village change', async () => {
  vi.useFakeTimers(); const h = harness(), before = h.state(), next = { ...before, syncRevision: 2, village: { ...before.village, wood: 150 } };
  const frame = villageFrame(before, next), old = h.sources[0]!;
  old.send('frame', frame); old.send('frame', frame); expect(h.accepted).toHaveBeenCalledTimes(1);
  old.send('frame', { ...frame, fromRevision: 4, toRevision: 5 });
  old.send('snapshot', { ...next, syncRevision: 6 }); expect(h.state().syncRevision).toBe(2);
  await vi.advanceTimersByTimeAsync(100); h.sources[1]!.send('snapshot', { ...next, syncRevision: 5 });
  expect(h.state().syncRevision).toBe(5);
  h.sync.close();
  const other = new VillageSynchronization(before.world.slug, before.world.id, before.world.id, { ...h.options,
    current: () => ({ ...next, village: { ...next.village, id: before.world.id } }) }); sessions.push(other);
  old.send('frame', { ...frame, fromRevision: 5, toRevision: 6 }); expect(h.accepted).toHaveBeenCalledTimes(2);
});
it('bounds a silent stalled connection and retries with a fresh generation', async () => {
  vi.useFakeTimers(); const h = harness(), epoch = villageRequestGeneration();
  await vi.advanceTimersByTimeAsync(30_000); expect(h.sources[0]!.closed).toBe(true);
  expect(h.sources).toHaveLength(2); expect(villageRequestGeneration()).toBeGreaterThan(epoch);
});
it('tags an HTTP response with its sending generation, before a later reconnect', async () => {
  const h = harness(), epoch = villageRequestGeneration(); let resolve!: (r: Response) => void;
  vi.stubGlobal('fetch', () => new Promise<Response>(r => { resolve = r; }));
  const pending = getVillage(h.state().world.slug, h.state().village.id); h.sync.reconnect();
  resolve(new Response(JSON.stringify({ ...h.state(), syncRevision: 2 })));
  const result = await pending; expect(result.requestGeneration).toBe(epoch);
  expect(result.requestGeneration).not.toBe(villageRequestGeneration());
});
it('joins a newer time projection at the same persistent revision without replaying a mutation',()=>{
  const h=harness(),next={...h.state(),serverTime:'2026-10-11T18:00:00.000Z'};
  h.sources[0]!.send('snapshot',next);expect(h.accepted).toHaveBeenCalledTimes(1);
  h.sources[0]!.send('snapshot',next);expect(h.accepted).toHaveBeenCalledTimes(1);
  expect(h.state().syncRevision).toBe(1);
});

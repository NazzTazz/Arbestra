import type { SpawnPoint } from '@arbestra/contracts';
export interface SpawnInspectionTask {
  kind: 'inspect'; channel: 'disk' | 'selection'; sequence: number;
  point: SpawnPoint; turns: number; requestedAt: number;
}
/** One in-flight computation, newest pending request per channel. Prioritize
 * clicks over hover; obsolete results never reach the UI or its measurements. */
export function createInspectionQueue(send: (task: SpawnInspectionTask) => void) {
  const pending = new Map<SpawnInspectionTask['channel'], SpawnInspectionTask>();
  let active: SpawnInspectionTask | undefined, ready = false;
  const dispatch = () => {
    if (!ready || active) return;
    active = pending.get('selection') ?? pending.get('disk');
    if (active) send(active);
  };
  return {
    ready() { ready = true; dispatch(); },
    cancel(channel: SpawnInspectionTask['channel']) { pending.delete(channel); },
    request(task: SpawnInspectionTask) { pending.set(task.channel, task); dispatch(); },
    complete(channel: SpawnInspectionTask['channel'], sequence: number) {
      if (active?.channel !== channel || active.sequence !== sequence) return undefined;
      const accepted = pending.get(channel) === active ? active : undefined;
      if (accepted) pending.delete(channel);
      active = undefined; dispatch(); return accepted;
    },
  };
}

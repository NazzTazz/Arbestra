import { ApiError, type TimedVillageState } from '../api/client';
import type { Cell } from '../scene/construction-selection';

export interface HarvestTarget extends Cell { worldSlug: string; villageId: string; buildingId: string }
export interface HarvestIntent extends HarvestTarget { commandId: string; gesture: number; status: 'queued' | 'sending' | 'uncertain' }
const targetKey = (target: HarvestTarget) => `${target.worldSlug}:${target.villageId}:${target.cellX}:${target.cellY}`;

/** An uncertain departure keeps its receipt and its place before later plots. */
export class GardenHarvestQueue {
  private intents: HarvestIntent[] = [];
  private gesture = 0;
  private readonly stopped = new Set<number>();
  private readonly notified = new Set<number>();
  private running: Promise<void> | null = null;

  constructor(private readonly handlers: {
    send: (intent: HarvestIntent) => Promise<TimedVillageState>;
    accepted: (snapshot: TimedVillageState) => void;
    warning: (message: string) => void;
    changed: (intents: HarvestIntent[]) => void;
  }) {}

  pending() { return this.intents.map((intent) => ({ ...intent })); }
  has(target: HarvestTarget) { return this.intents.some((intent) => targetKey(intent) === targetKey(target)); }
  enqueue(target: HarvestTarget, newGesture: boolean) {
    if (newGesture) this.gesture++;
    if (this.has(target)) { this.retry(); return; }
    if (this.stopped.has(this.gesture)) return;
    this.intents.push({ ...target, gesture: this.gesture, commandId: crypto.randomUUID(), status: 'queued' });
    this.changed();
    this.drain();
  }
  retry() {
    if (this.running || !this.intents.length) return;
    this.intents[0]!.status = 'queued';
    this.drain();
  }
  settled() { return this.running ?? Promise.resolve(); }
  private changed() { this.handlers.changed(this.pending()); }
  private drain() {
    if (this.running) return;
    this.running = this.process().finally(() => { this.running = null; });
  }
  private async process() {
    while (this.intents.length) {
      const intent = this.intents[0]!;
      intent.status = 'sending'; this.changed();
      try {
        const snapshot = await this.handlers.send(intent);
        this.handlers.accepted(snapshot);
        this.intents.shift();
      } catch (error) {
        const definite = error instanceof ApiError && error.status >= 400 && error.status < 500;
        if (!this.notified.has(intent.gesture)) {
          this.notified.add(intent.gesture);
          this.handlers.warning(definite ? error.message : 'Récolte à confirmer. La même demande sera réessayée.');
        }
        if (!definite) { intent.status = 'uncertain'; this.changed(); return; }
        this.intents.shift();
        if (error.code === 'HARVESTERS_UNAVAILABLE') {
          this.stopped.add(intent.gesture);
          this.intents = this.intents.filter((item) => item.gesture !== intent.gesture);
        }
      }
      this.changed();
    }
    // Only the current gesture can still receive pointer events.
    for (const id of this.stopped) if (id !== this.gesture) this.stopped.delete(id);
    for (const id of this.notified) if (id !== this.gesture) this.notified.delete(id);
  }
}

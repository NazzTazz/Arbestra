/** Keep unresolved commands scoped to their deposit across panel changes. */
export class ExtractionIntents {
  private readonly pending = new Map<string, { featureId: string; workerCount: number; id: string }>();

  get(featureId: string) { return this.pending.get(featureId); }

  begin(featureId: string, workerCount: number) {
    const intent = this.pending.get(featureId) ?? { featureId, workerCount, id: crypto.randomUUID() };
    this.pending.set(featureId, intent);
    return intent;
  }

  complete(featureId: string) { this.pending.delete(featureId); }
}

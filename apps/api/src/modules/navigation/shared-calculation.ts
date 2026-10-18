/** Coalesce geometry only. Callers must independently authorize and validate their command. */
export class SharedCalculation<T> {
  private pending = new Map<string, {promise: Promise<T>; waiters: number}>();
  constructor(private readonly maxKeys = 8, private readonly maxWaiters = 32) {}
  async run(key: string, calculate: () => Promise<T>): Promise<T> {
    let entry = this.pending.get(key);
    if (entry) {
      if (entry.waiters >= this.maxWaiters) throw Error('Navigation waiters saturated');
      entry.waiters++;
    } else {
      if (this.pending.size >= this.maxKeys) throw Error('Navigation calculations saturated');
      entry = {promise: Promise.resolve().then(calculate), waiters: 1};
      this.pending.set(key, entry);
    }
    try {return await entry.promise;}
    finally {if (--entry.waiters === 0 && this.pending.get(key) === entry) this.pending.delete(key);}
  }
}

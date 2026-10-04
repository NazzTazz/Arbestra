type ThumbnailRenderer = (code: string, level: number) => Promise<string>;
type ThumbnailStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const THUMBNAIL_STORAGE_KEY = 'arbestra:building-thumbnails';
export const THUMBNAIL_MAX_ENTRIES = 24;
// Bound UTF-16 storage as well as image count; leave room for other app preferences.
export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

/** Pixel cache only: no scene, engine, mesh or texture survives a render. */
export class BuildingThumbnailCache {
  private readonly images = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<string>>();
  private queue = Promise.resolve();
  private hydrated = false;

  constructor(
    private readonly revision: string,
    private readonly render: ThumbnailRenderer,
    private readonly storage: () => ThumbnailStorage = () => window.localStorage,
  ) {}

  peek(code: string, level = 1): string | undefined {
    this.hydrate();
    const key = `${code}:${level}`;
    const image = this.images.get(key);
    if (image) {
      this.images.delete(key);
      this.images.set(key, image);
    }
    return image;
  }

  get(code: string, level = 1): Promise<string> {
    const cached = this.peek(code, level);
    if (cached) return Promise.resolve(cached);
    const key = `${code}:${level}`;
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const result = this.queue.then(() => this.render(code, level)).then(image => {
      this.remember(key, image);
      this.persist();
      return image;
    });
    this.inFlight.set(key, result);
    // A failed render neither poisons this key nor blocks later requests.
    this.queue = result.then(
      () => { this.inFlight.delete(key); },
      () => { this.inFlight.delete(key); },
    );
    return result;
  }

  private serialize(): string {
    return JSON.stringify({ revision: this.revision, entries: [...this.images] });
  }

  private remember(key: string, image: string): void {
    // An unusually large image can be displayed without consuming the whole cache.
    if (JSON.stringify({ revision: this.revision, entries: [[key, image]] }).length * 2 > THUMBNAIL_MAX_BYTES) return;
    this.images.delete(key);
    this.images.set(key, image);
    while (this.images.size > THUMBNAIL_MAX_ENTRIES || this.serialize().length * 2 > THUMBNAIL_MAX_BYTES) {
      this.images.delete(this.images.keys().next().value!);
    }
  }

  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      const raw = this.storage().getItem(THUMBNAIL_STORAGE_KEY);
      if (!raw || raw.length * 2 > THUMBNAIL_MAX_BYTES) return;
      const stored: unknown = JSON.parse(raw);
      if (!stored || typeof stored !== 'object' || !('revision' in stored) || stored.revision !== this.revision
        || !('entries' in stored) || !Array.isArray(stored.entries)) return;
      for (const entry of stored.entries.slice(-THUMBNAIL_MAX_ENTRIES)) {
        if (!Array.isArray(entry) || entry.length !== 2) continue;
        const [key, image] = entry as unknown[];
        if (typeof key !== 'string' || !/^[a-z-]+:[1-9]\d*$/.test(key)
          || typeof image !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) continue;
        this.remember(key, image);
      }
    } catch {
      // Disabled storage or an obsolete/corrupt cache must never block the catalogue.
    }
  }

  private persist(): void {
    try { this.storage().setItem(THUMBNAIL_STORAGE_KEY, this.serialize()); }
    catch { /* Quota/private mode: the in-memory cache remains usable. */ }
  }
}

// A prepared evaluation can read any hosted file. Computed values stay local
// until its write commits. Invalidations also forget published values, since
// another file may commit independently during the evaluation.
import { AsyncLocalStorage } from 'node:async_hooks';

type Entry = { value: unknown; revision: number; publish(): void };
export const preparing = new AsyncLocalStorage<Map<object, Entry>>();

/** A cache and its bookkeeping, copied on first use in a preparation scope. */
export class PreparedCache<T> {
  private committed: T;
  private readonly copy: (value: T) => T;
  private revision = 0;

  constructor(value: T, copy: (value: T) => T = (value) => value) {
    this.committed = value;
    this.copy = copy;
  }

  get value(): T {
    const scope = preparing.getStore();
    if (!scope) return this.committed;
    let entry = scope.get(this);
    if (!entry || entry.revision !== this.revision) {
      entry = { value: this.copy(this.committed), revision: this.revision, publish: () => {
        if (entry!.revision === this.revision) this.value = entry!.value as T;
      } };
      scope.set(this, entry);
    }
    return entry.value as T;
  }

  set value(value: T) {
    const scope = preparing.getStore();
    if (!scope) { this.committed = value; return; }
    // Register publication even when the first access is a replacement.
    void this.value;
    scope.get(this)!.value = value;
  }

  /** Forget published data too: an invalidation is safe even if preparation rolls back. */
  invalidate(clear: (value: T) => void): void {
    clear(this.committed);
    // Older scopes must neither read nor publish entries from before the invalidation.
    this.revision++;
  }
}

/** Run formulas now; publish only prepared data after the caller's COMMIT. */
export function prepareCaches(run: () => () => void): () => void {
  const scope = new Map<object, Entry>();
  const publish = preparing.run(scope, run);
  return () => {
    for (const entry of scope.values()) entry.publish();
    publish();
  };
}

/** A FIFO cache. Use only for disposable state; active locks and rate counters must refuse admission instead. */
export class BoundedMap<K, V> extends Map<K, V> {
  readonly limit: number;
  private readonly evicted?: (value: V, key: K) => void;

  constructor(limit: number, evicted?: (value: V, key: K) => void) {
    super();
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('A cache needs a positive finite entry limit');
    this.limit = limit;
    this.evicted = evicted;
  }

  override set(key: K, value: V): this {
    if (!this.has(key)) {
      while (this.size >= this.limit) {
        const oldest = this.entries().next().value!;
        super.delete(oldest[0]);
        this.evicted?.(oldest[1], oldest[0]);
      }
    }
    return super.set(key, value);
  }
}

import { checkTextSize } from './text-budget.ts';
import type { Value } from './values.ts';

// Logical retained bytes: UTF-16 payloads plus conservative per-entry metadata.
// Shared payloads are charged for each owner so cloning cannot evade the limit.
export const MAX_RETAINED_BYTES = 512 * 1024 * 1024;
export const MAX_PLUGIN_VARIABLES = 10_000;
export const ENTRY_BYTES = 64;
export const LIST_SLOT_BYTES = 8;

export class RetainedBudget {
  used = 0;
  readonly limit: number;
  constructor(limit = MAX_RETAINED_BYTES) {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_RETAINED_BYTES) throw new RangeError('Invalid retained memory limit');
    this.limit = limit;
  }
  check(oldBytes: number, newBytes: number): void {
    const next = this.used - oldBytes + newBytes;
    if (!Number.isSafeInteger(next) || next < 0 || next > this.limit) throw new RangeError('The session retained memory limit would be exceeded');
  }
  replace(oldBytes: number, newBytes: number): void {
    this.check(oldBytes, newBytes);
    this.used += newBytes - oldBytes;
  }
}
const budgets = new WeakMap<object, RetainedBudget>();
/** A host may choose a stricter session limit before the first plug-in operation. */
export function retainedBudget(scope: object, limit = MAX_RETAINED_BYTES): RetainedBudget {
  let budget = budgets.get(scope);
  if (!budget) budgets.set(scope, budget = new RetainedBudget(limit));
  return budget;
}
export function stringBytes(s: string): number {
  checkTextSize(s.length);
  return s.length * 2;
}
export function valueBytes(v: Value): number {
  let bytes = ENTRY_BYTES;
  if (typeof v.value === 'string') bytes += stringBytes(v.value);
  if (v.type === 'container') bytes += v.data?.buffer.byteLength ?? 0;
  if (v.type === 'number') bytes += (v.decimal?.length ?? 0) * 2 + (v.exact?.toString().length ?? 0) * 2;
  if (v.type === 'text') for (const run of v.runs ?? []) bytes += ENTRY_BYTES + stringBytes(run.font ?? '') + stringBytes(run.color ?? '');
  return bytes;
}

/** Changes reserve the final size before publishing entries. In-place edits require an exact preflight and synchronous republication. */
export class RetainedMap<K, V> extends Map<K, V> {
  private sizes = new Map<K, number>();
  private bytes = 0;
  private budget: RetainedBudget;
  private measure: (key: K, value: V) => number;
  private maxCount: number;
  constructor(budget: RetainedBudget, measure: (key: K, value: V) => number, maxCount = Infinity) {
    super(); this.budget = budget; this.measure = measure; this.maxCount = maxCount;
  }
  override set(key: K, value: V): this { return this.replaceMany(new Map([[key, value]])); }
  replaceMany(entries: Map<K, V>): this {
    let next = this.bytes, count = this.size;
    const sizes = new Map<K, number>();
    for (const [key, value] of entries) {
      const size = this.measure(key, value);
      sizes.set(key, size);
      next += size - (this.sizes.get(key) ?? 0);
      if (!this.has(key)) count++;
    }
    if (count > this.maxCount) throw new RangeError('Too many plug-in variables');
    this.budget.replace(this.bytes, next);
    for (const [key, value] of entries) { super.set(key, value); this.sizes.set(key, sizes.get(key)!); }
    this.bytes = next;
    return this;
  }
  override delete(key: K): boolean {
    if (!this.has(key)) return false;
    const bytes = this.sizes.get(key)!;
    this.budget.replace(bytes, 0);
    this.bytes -= bytes;
    this.sizes.delete(key);
    return super.delete(key);
  }
  override clear(): void {
    this.budget.replace(this.bytes, 0);
    this.bytes = 0;
    this.sizes.clear();
    super.clear();
  }
}

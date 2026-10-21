import { markExecutionRefusal } from './execution-refusal.ts';
import { ComplexityError } from './complexity-error.ts';
import { MAX_TEXT_RESULT } from './text-budget.ts';

// Synchronous calculation helpers share a budget through nested calls. These are
// implementation limits; each independent operation starts with fresh capacity.
export class ResourceLimitError extends ComplexityError {
  constructor(detail: string) { super(`Calculation resource limit: ${detail}`); }
}

export class WorkBudget {
  private workLeft: number;
  private nodesLeft: number;
  private textLeft = 32_000_000;
  private outputLeft = MAX_TEXT_RESULT;
  private resultTextLeft = MAX_TEXT_RESULT;
  private transformWorkLeft = 4_000_000;
  private readonly copiedNodes = new WeakMap<object, number>();
  private depth = 0;
  private readonly limits: { work: number; nodes: number };

  constructor(limits = { work: 4_000_000, nodes: 2_500_000 }) {
    this.limits = limits;
    this.workLeft = limits.work;
    this.nodesLeft = limits.nodes;
  }

  private take(left: number, amount: number, kind: string): number {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > left) throw new ResourceLimitError(kind);
    return left - amount;
  }
  work(n = 1): void { this.workLeft = this.take(this.workLeft, n, 'too much work'); }
  transformWork(n = 1): void {
    this.work(n);
    this.transformWorkLeft = this.take(this.transformWorkLeft, n, 'too much XSLT instruction work');
  }
  nodes(n = 1): void { this.work(n); this.nodesLeft = this.take(this.nodesLeft, n, 'too many intermediate nodes'); }
  checkNodes(n: number): void { this.take(this.limits.nodes, n, 'too many intermediate nodes'); }
  /** Shallow-copy storage is bounded individually; retaining snapshots charges it cumulatively. */
  copyNodes(value: object, n: number): void {
    this.copiedNodes.set(value, n);
  }
  retainNodes(value: unknown): void {
    if (value === null || typeof value !== 'object') return;
    const n = this.copiedNodes.get(value);
    if (n === undefined) return;
    this.nodes(n);
    this.copiedNodes.delete(value);
  }
  text(n: number): void {
    this.checkText(n);
    this.textLeft = this.take(this.textLeft, n, 'too much allocated text');
  }
  checkText(n: number): void { this.take(MAX_TEXT_RESULT, n, 'text is too large'); }
  output(n: number): void { this.outputLeft = this.take(this.outputLeft, n, 'result is too large'); }
  resultText(n: number): void { this.resultTextLeft = this.take(this.resultTextLeft, n, 'result tree text is too large'); }
  enter(): void {
    this.work();
    if (this.depth >= 128) throw new ResourceLimitError('expression or result nests too deeply');
    this.depth++;
  }
  leave(): void { this.depth--; }
}

let active: WorkBudget | undefined;
export function workBudget(): WorkBudget | undefined { return active; }
export function withWorkBudget<T>(fn: () => T, limits?: { work: number; nodes: number }): T {
  if (active) return fn();
  active = new WorkBudget(limits);
  try { return fn(); } finally { active = undefined; }
}

// XML's 8 MB parser limit admits hundreds of thousands of nodes. Axes,
// predicates and XSLT instructions revisit them during an ordinary linear pass.
// Nested helpers still consume their caller's budget, never a fresh allowance.
export function withXmlWorkBudget<T>(fn: () => T): T {
  return withWorkBudget(fn, { work: 32_000_000, nodes: 8_000_000 });
}

export function budgetDepth<T>(fn: () => T): T {
  const b = active;
  b?.enter();
  try { return fn(); } finally { b?.leave(); }
}

/** Reserve a replacement's complete size before the native string allocation. */
export function budgetReplace(input: string, pattern: RegExp, replacement: (match: string) => string): string {
  let size = input.length;
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  for (const match of input.matchAll(new RegExp(pattern.source, flags))) {
    active?.work();
    size += replacement(match[0]).length - match[0].length;
    active?.checkText(size);
    if (!pattern.global) break;
  }
  active?.text(size);
  return input.replace(pattern, replacement);
}

/** Preserve public helper error classes while making a limit refusal non-recoverable. */
export function resourceError<T extends Error>(error: T): T {
  if (!error.message.startsWith('Calculation resource limit:')) error.message = `Calculation resource limit: ${error.message}`;
  markExecutionRefusal(error);
  return error;
}

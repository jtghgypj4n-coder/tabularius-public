// Errors the store reports with a FileMaker error code, and the guard that
// keeps one request from taking all the server's memory.

import { getHeapSpaceStatistics, getHeapStatistics } from 'node:v8';
import type { AccessDenial } from './access-denial.ts';

export class StoreError extends Error {
  readonly code: number;
  readonly denial?: AccessDenial;
  /** Target field when write-time validation failed; used by Import Records to skip only that field. */
  validationField?: string;
  constructor(code: number, message: string, denial?: AccessDenial) {
    super(message);
    this.code = code;
    this.denial = denial;
  }
}

/**
 * Thrown instead of making a write when an approval-gated AI agent attempts
 * one: the change is recorded as a pending proposal for a human to approve or
 * reject, and nothing is changed yet. `pendingId` is the proposal's id and
 * `summary` a one-line description of what it would do.
 */
export class PendingApprovalError extends StoreError {
  readonly pendingId: number;
  readonly summary: string;
  constructor(pendingId: number, summary: string) {
    super(952, `This change needs a human's approval before it is applied: ${summary}`);
    this.pendingId = pendingId;
    this.summary = summary;
  }
}

/** Share of the JavaScript heap a request may take the server to before it is stopped. */
const HEAP_SHARE = 0.85;
/**
 * What V8's heap limit sets aside for short-lived objects (the young
 * generation), on top of --max-old-space-size. Long-lived data runs out at
 * the old-space size, so that is the limit the share is taken of.
 */
const YOUNG_RESERVE = 48 * 2 ** 20;
let checks = 0;
let over = 0;

/**
 * Stops work that would run the server out of memory (FileMaker error 812,
 * "Exceeded host's capacity"), so one request fails instead of the server
 * dying for everyone. Cheap enough for a loop: it looks at the heap every
 * 512th call.
 */
export function checkMemory(): void {
  ++checks;
  // A request that has held the server's one thread past the budget stops, so others are answered (and a stop signal is heard).
  if (budget && (checks & 15) === 0 && performance.now() - lastTick > budget) {
    throw new StoreError(812, `Exceeded host's capacity: this request ran for more than ${Math.round(budget / 1000)} s without letting other requests in; try a smaller found set or simpler layout`);
  }
  if ((checks & 511) !== 0) return;
  const h = getHeapStatistics();
  const limit = Math.max(h.heap_size_limit - YOUNG_RESERVE, h.heap_size_limit / 2);
  const young = getHeapSpaceStatistics().filter((s) => s.space_name.startsWith('new_')).reduce((n, s) => n + s.space_used_size, 0);
  const used = h.used_heap_size - young;
  // Twice in a row: the first time may be garbage the next collection frees.
  over = used > limit * HEAP_SHARE ? over + 1 : 0;
  if (over >= 2) {
    over = 0;
    throw new StoreError(812, `Exceeded host's capacity: this request needs more memory than the server has (${Math.round(used / 2 ** 20)} of ${Math.round(limit / 2 ** 20)} MB in use); try a smaller found set`);
  }
}

let budget = 0;
let lastTick = performance.now();
const budgets = new Map<symbol, number>();
let budgetTimer: NodeJS.Timeout | undefined;

/**
 * Starts timing how long the server's thread is kept busy without a break:
 * after `ms`, work that checks in (the row loops that call checkMemory) stops
 * with error 812. Only a server calls this; tools that run one long job don't.
 */
export function watchEventLoop(ms: number): () => void {
  if (!(ms > 0)) return () => {};
  const owner = Symbol();
  budgets.set(owner, ms);
  budget = Math.min(...budgets.values());
  if (!budgetTimer) {
    lastTick = performance.now();
    budgetTimer = setInterval(() => { lastTick = performance.now(); }, 250).unref();
  }
  return () => {
    budgets.delete(owner);
    budget = budgets.size ? Math.min(...budgets.values()) : 0;
    if (!budgets.size) {
      clearInterval(budgetTimer);
      budgetTimer = undefined;
    }
  };
}

/** How much longer the work in hand may keep the server's thread busy before it is stopped (Infinity outside a server). */
export function timeLeft(): number {
  return budget ? budget - (performance.now() - lastTick) : Infinity;
}

// Keeps each hosted file's layout results (whole-table summaries, ExecuteSQL
// results) worked out ahead of the people reading them: when the file opens,
// and once changes settle. The work runs on a worker thread (warm-worker.ts),
// so a long pass over a large table never holds up a request; until it
// finishes, layout reads show the result from before the latest change.

import { Worker } from 'node:worker_threads';
import type { Store } from '../../store/src/index.ts';

/** Quiet time after the last change before warming. */
const SETTLE_MS = 2_000;
/** Longest a busy file waits for a quiet moment. */
const MAX_WAIT_MS = 30_000;
/** The warming thread's memory, in MB (TABULARIUS_WARM_HEAP_MB). */
const WARM_HEAP_MB = Math.max(256, Number(process.env.TABULARIUS_WARM_HEAP_MB) || 1536);

export class Warmer {
  private worker?: Worker;
  private running?: string;
  private readonly queue = new Map<string, string>();
  private readonly pending = new Map<string, { timer: ReturnType<typeof setTimeout>; since: number }>();
  private closed = false;

  private readonly log: (msg: string) => void;
  private readonly settleMs: number;

  constructor(log: (msg: string) => void = () => {}, settleMs = SETTLE_MS) {
    this.log = log;
    this.settleMs = settleMs;
  }

  /** Warms `store` once things are quiet: `delay` ms after the latest request, or soon after a long run of changes. */
  request(store: Store, delay = this.settleMs): void {
    if (this.closed) return;
    const path = store.path;
    const was = this.pending.get(path);
    if (was) clearTimeout(was.timer);
    const since = was?.since ?? performance.now();
    const wait = Math.max(0, Math.min(delay, since + MAX_WAIT_MS - performance.now()));
    const timer = setTimeout(() => {
      this.pending.delete(path);
      this.queue.set(path, store.name);
      this.pump();
    }, wait);
    timer.unref();
    this.pending.set(path, { timer, since });
  }

  /** Stops warming a file that is being closed, so nothing holds it open. */
  cancel(store: Store): void {
    const was = this.pending.get(store.path);
    if (was) clearTimeout(was.timer);
    this.pending.delete(store.path);
    this.queue.delete(store.path);
    if (this.running === store.path) {
      void this.stopWorker();
      this.pump();
    }
  }

  /** Stops warming; resolves once the warming thread has stopped, so nothing it was writing is still being written. */
  close(): Promise<void> {
    this.closed = true;
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    this.queue.clear();
    return this.stopWorker();
  }

  /** Whether the warming thread is at work on a file (closing then waits for it to stop). */
  get busy(): boolean {
    return !!this.running;
  }

  /** Resolves once nothing is queued or running (for tests). */
  async idle(): Promise<void> {
    while (this.running || this.queue.size || this.pending.size) await new Promise((r) => setTimeout(r, 50));
  }

  private stopWorker(): Promise<void> {
    const w = this.worker;
    this.worker = undefined;
    this.running = undefined;
    return w ? w.terminate().then(() => undefined, () => undefined) : Promise.resolve();
  }

  private pump(): void {
    if (this.running || this.closed) return;
    const next = this.queue.entries().next();
    if (next.done) return;
    const [path, name] = next.value;
    this.queue.delete(path);
    this.running = path;
    if (!this.worker) {
      // Its own memory cap: a pass that would need more stops (that layout is worked out on request instead),
      // rather than pushing the machine into swapping beside the server's processes.
      const w = new Worker(new URL('./warm-worker.ts', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: WARM_HEAP_MB } });
      w.unref();
      w.on('message', (m: { done: string; layouts: number }) => {
        if (this.worker !== w) return;
        this.running = undefined;
        this.pump();
      });
      w.on('error', (e) => {
        this.log(`warming results stopped: ${e.message}`);
        if (this.worker === w) this.stopWorker();
        this.pump();
      });
      this.worker = w;
    }
    this.worker.postMessage({ path, name });
  }
}

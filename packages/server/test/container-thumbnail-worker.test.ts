import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Worker } from 'node:worker_threads';
import { ContainerFiles } from '../src/containers.ts';

class FakeWorker extends EventEmitter {
  terminated = false;
  private readonly hang: boolean;
  constructor(hang: boolean) { super(); this.hang = hang; }
  unref(): this { return this; }
  postMessage(message: { id: number }): void {
    if (!this.hang) setImmediate(() => this.emit('message', { id: message.id, png: Uint8Array.of(1, 2, 3) }));
  }
  async terminate(): Promise<number> { this.terminated = true; return 0; }
}

class SerialWorker extends EventEmitter {
  private queue: { id: number }[] = [];
  private busy = false;
  unref(): this { return this; }
  postMessage(message: { id: number }): void { this.queue.push(message); this.next(); }
  private next(): void {
    if (this.busy || !this.queue.length) return;
    this.busy = true;
    const job = this.queue.shift()!;
    setImmediate(() => {
      this.emit('message', { id: job.id, png: Uint8Array.of(4, 5, 6) });
      this.busy = false;
      this.next();
    });
  }
  async terminate(): Promise<number> { return 0; }
}

test('a thumbnail worker that hangs is terminated and replaced for the next request', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 });
  // Worker backoff runs on the monotonic clock, so it advances with the mocked timers.
  let mono = performance.now();
  t.mock.method(performance, 'now', () => mono);
  const tick = (ms: number) => { t.mock.timers.tick(ms); mono += ms; };
  const made: FakeWorker[] = [];
  const files = new ContainerFiles({ workerTimeoutMs: 1000, createWorker: () => {
    const worker = new FakeWorker(made.length === 0);
    made.push(worker);
    return worker as unknown as Worker;
  } });
  try {
    const inWorker = (data: Uint8Array) => (files as unknown as { inWorker(data: Uint8Array, size: number): Promise<Uint8Array | undefined> }).inWorker(data, 32);
    const hung = inWorker(Uint8Array.of(0));
    tick(1001);
    assert.equal(await hung, undefined);
    assert.equal(made[0]?.terminated, true, 'the timed out worker was terminated');
    assert.deepEqual(await inWorker(Uint8Array.of(0)), Uint8Array.of(1, 2, 3));
    tick(101);
    await inWorker(Uint8Array.of(0));
    assert.equal(made.length, 3, 'the timed out pool slot was replaced after its backoff');
  } finally {
    files.stop();
  }
});

test('workers that fail to start are retried with a cap, then thumbnails fall back without a worker', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 });
  // Worker backoff runs on the monotonic clock, so it advances with the mocked timers.
  let mono = performance.now();
  t.mock.method(performance, 'now', () => mono);
  const tick = (ms: number) => { t.mock.timers.tick(ms); mono += ms; };
  let starts = 0;
  const files = new ContainerFiles({ createWorker: () => { starts++; throw new Error('worker unavailable'); } });
  const warnings: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    const inWorker = (data: Uint8Array) => (files as unknown as { inWorker(data: Uint8Array, size: number): Promise<Uint8Array | undefined> }).inWorker(data, 32);
    for (const delay of [0, 101, 501, 501]) {
      if (delay) tick(delay);
      assert.equal(await inWorker(Uint8Array.of(0)), undefined);
    }
    assert.equal(starts, 6, 'each of two slots gets at most three start attempts');
    assert.equal(warnings.length, 2, 'each disabled slot logs once');
  } finally {
    console.warn = warn;
    files.stop();
  }
});

test('a worker timeout starts when a queued job is sent, not while it waits behind another job', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const files = new ContainerFiles({ workerTimeoutMs: 15, createWorker: () => new SerialWorker() as unknown as Worker });
  try {
    const inWorker = (data: Uint8Array) => (files as unknown as { inWorker(data: Uint8Array, size: number): Promise<Uint8Array | undefined> }).inWorker(data, 32);
    const first = inWorker(Uint8Array.of(0)); // pool slot 0, starts immediately
    const otherSlot = inWorker(Uint8Array.of(0));
    const queued = inWorker(Uint8Array.of(0)); // pool slot 0, waits for first
    assert.deepEqual(await Promise.all([first, otherSlot, queued]), [Uint8Array.of(4, 5, 6), Uint8Array.of(4, 5, 6), Uint8Array.of(4, 5, 6)]);
  } finally {
    files.stop();
  }
});

test('external thumbnail tool slots cap concurrent invocations at two', async () => {
  const files = new ContainerFiles();
  const slots = files as unknown as { takeToolSlot(): Promise<void>; releaseToolSlot(): void; activeTools: number; waitingTools: (() => void)[] };
  try {
    const jobs = Array.from({ length: 5 }, () => slots.takeToolSlot());
    assert.equal(slots.activeTools, 2);
    assert.equal(slots.waitingTools.length, 3);
    for (let i = 0; i < 5; i++) {
      slots.releaseToolSlot();
      await Promise.resolve();
      assert.ok(slots.activeTools <= 2);
    }
    await Promise.all(jobs);
    assert.equal(slots.activeTools, 0);
  } finally {
    files.stop();
  }
});

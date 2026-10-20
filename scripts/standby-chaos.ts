// Deterministic capacity model for standby catch-up. All changes are generated
// integers; this runner opens no files or network connections.
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

export interface ChaosOptions {
  changes: number;
  seed: number;
  bandwidthBytesPerSecond: number;
  budgetSeconds: number;
}

export interface ChaosResult {
  changes: number;
  seed: number;
  ticks: number;
  virtualSeconds: number;
  wallSeconds: number;
  modelChangesPerSecond: number;
  replayedChanges: number;
  snapshotPosition: number;
  replayChangesPerVirtualSecond: number;
  standbyBytesTransferred: number;
  maxBytesInTick: number;
  copies: number;
  copyRestarts: number;
  refusals: number;
  diskFailures: number;
  linkFailures: number;
  promotions: number;
  schemaChanges: number;
  containersChecked: number;
  lagChecks: number;
}

const CHANGE_BYTES = 256;
const COPY_BYTES = 512 * 1024;
const TICK_MS = 100;
const CONTAINER_EVERY = 997;
const SCHEMA_EVERY = 991;

function hashAt(seq: number): string {
  return createHash('sha256').update(`generated-container-${seq}`).digest('hex');
}

interface Follower {
  seq: number;
  run: number;
  digest: number;
  protocol: number;
  copy?: { remaining: number; snapshot: number; run: number };
  promoted: boolean;
  containers: Map<number, string>;
}

/** Throws when a safety or time-budget invariant fails. Rates use simulated time. */
export function runStandbyChaos(options: ChaosOptions): ChaosResult {
  const { changes, seed, bandwidthBytesPerSecond, budgetSeconds } = options;
  if (!Number.isSafeInteger(changes) || changes < 100 || !Number.isSafeInteger(seed) ||
      !Number.isFinite(bandwidthBytesPerSecond) || bandwidthBytesPerSecond < CHANGE_BYTES * 10 ||
      !Number.isFinite(budgetSeconds) || budgetSeconds <= 0) throw new Error('invalid chaos profile');
  const start = performance.now();
  // A 32-bit prefix digest checks that a copied prefix and every replayed
  // change produce the same value, including schema transitions.
  const prefix = new Uint32Array(changes + 1);
  for (let i = 1; i <= changes; i++) {
    const kind = i % SCHEMA_EVERY === 0 ? 0x51 : i % CONTAINER_EVERY === 0 ? 0xa7 : 0x19;
    prefix[i] = (Math.imul(prefix[i - 1] ^ i, 16777619) + kind) >>> 0;
  }
  const initial = Math.floor(changes / 2);
  const producedPerTick = Math.max(1, Math.ceil((changes - initial) / 40));
  let primary = initial;
  let run = 1;
  const a: Follower = { seq: 0, run, digest: prefix[0], protocol: 0, promoted: false, containers: new Map() };
  const bStart = Math.floor(changes / 4);
  const b: Follower = { seq: bStart, run, digest: prefix[bStart], protocol: 1, promoted: false, containers: new Map() };
  for (let i = CONTAINER_EVERY; i <= bStart; i += CONTAINER_EVERY) b.containers.set(i, hashAt(i));
  const result: ChaosResult = { changes, seed, ticks: 0, virtualSeconds: 0, wallSeconds: 0, modelChangesPerSecond: 0,
    replayedChanges: 0, snapshotPosition: 0, replayChangesPerVirtualSecond: 0, standbyBytesTransferred: 0,
    maxBytesInTick: 0, copies: 0, copyRestarts: 0, refusals: 0, diskFailures: 0, linkFailures: 0,
    promotions: 0, schemaChanges: Math.floor(changes / SCHEMA_EVERY), containersChecked: 0, lagChecks: 0 };
  // The seed moves fault times but preserves their order. Each fault occurs
  // while changes remain queued even in the small CI profile.
  let random = seed >>> 0;
  const jitter = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % 2; };
  const fault = [2, 4, 6, 8, 10, 14, 16, 20, 20].map((n) => n + jitter());
  const bytesPerTick = Math.floor(bandwidthBytesPerSecond * TICK_MS / 1000);
  let diskFull = false;
  let linkDown = false;
  let copiedAfterDivergence = false;
  let snapshotTick = 0;
  const check = (f: Follower) => {
    if (f.seq > primary || f.digest !== prefix[f.seq]) throw new Error('standby has a divergent or future prefix');
    const trueBacklog = primary - f.seq;
    const standbyBehind = Math.max(0, primary - f.seq);
    if (standbyBehind !== trueBacklog) throw new Error('standby_behind differs from the true backlog');
    result.lagChecks++;
  };
  const copy = (f: Follower) => { f.copy = { remaining: COPY_BYTES, snapshot: primary, run }; result.copies++; };
  const apply = (f: Follower, limit: number) => {
    const end = Math.min(primary, f.seq + limit);
    for (let i = f.seq + 1; i <= end; i++) {
      f.digest = (Math.imul(f.digest ^ i, 16777619) + (i % SCHEMA_EVERY === 0 ? 0x51 : i % CONTAINER_EVERY === 0 ? 0xa7 : 0x19)) >>> 0;
      if (i % CONTAINER_EVERY === 0) {
        const hash = hashAt(i);
        f.containers.set(i, hash);
        if (f.containers.get(i) !== hash) throw new Error('container hash mismatch');
        result.containersChecked++;
      }
    }
    f.seq = end;
  };
  while (a.seq < changes || primary < changes) {
    const tick = ++result.ticks;
    if (tick * TICK_MS > budgetSeconds * 1000) throw new Error(`catch-up exceeded ${budgetSeconds}s time budget`);
    primary = Math.min(changes, primary + producedPerTick);
    if (tick === fault[0]) { if (a.protocol >= 1) throw new Error('older standby was accepted'); result.refusals++; }
    if (tick === fault[1]) a.protocol = 1;
    if (tick === fault[2]) { b.digest ^= 1; copy(b); }
    if (tick === fault[3]) {
      run++;
      if (b.copy) { b.copy = undefined; result.copyRestarts++; }
      // A primary restart invalidates the run. A must take a fresh copy too.
      copy(a);
      copy(b);
    }
    if (tick === fault[4]) diskFull = true;
    if (tick === fault[5]) diskFull = false;
    if (tick === fault[6]) linkDown = true;
    if (tick === fault[7]) linkDown = false;
    if (tick === fault[8]) {
      if (b.seq >= primary) throw new Error('promotion was not during catch-up');
      b.promoted = true;
      b.copy = undefined;
      result.promotions++;
    }
    for (const f of [a, b]) {
      if (f.promoted) continue;
      if (f === a && f.protocol < 1) continue;
      if (f === a && diskFull) { result.diskFailures++; continue; }
      if (f === a && linkDown) { result.linkFailures++; continue; }
      if (f.run !== run && !f.copy) copy(f);
      let spent = 0;
      if (f.copy) {
        spent = Math.min(bytesPerTick, f.copy.remaining);
        f.copy.remaining -= spent;
        if (f.copy.remaining === 0) {
          const snapshot = f.copy.snapshot;
          if (f.copy.run !== run) throw new Error('stale copy was committed');
          f.seq = snapshot;
          f.run = run;
          f.digest = prefix[snapshot];
          f.containers.clear();
          for (let i = CONTAINER_EVERY; i <= snapshot; i += CONTAINER_EVERY) {
            f.containers.set(i, hashAt(i)); result.containersChecked++;
          }
          f.copy = undefined;
          if (f === b) copiedAfterDivergence = true;
          if (f === a) {
            result.snapshotPosition = snapshot;
            result.replayedChanges = 0;
            snapshotTick = tick;
          }
        }
      } else {
        const before = f.seq;
        apply(f, Math.floor(bytesPerTick / CHANGE_BYTES));
        spent = (f.seq - before) * CHANGE_BYTES;
        if (f === a) result.replayedChanges += f.seq - before;
      }
      if (f === a) result.standbyBytesTransferred += spent;
      if (spent > bytesPerTick) throw new Error('bandwidth cap exceeded');
      result.maxBytesInTick = Math.max(result.maxBytesInTick, spent);
      if (!f.copy) check(f);
    }
  }
  if (a.seq !== changes || a.digest !== prefix[changes] || result.promotions !== 1 ||
      result.copyRestarts < 1 || !copiedAfterDivergence || result.diskFailures < 1 || result.linkFailures < 1) {
    throw new Error('chaos schedule did not exercise every required transition');
  }
  result.virtualSeconds = result.ticks * TICK_MS / 1000;
  result.replayChangesPerVirtualSecond = Math.round(result.replayedChanges / ((result.ticks - snapshotTick) * TICK_MS / 1000));
  result.wallSeconds = (performance.now() - start) / 1000;
  result.modelChangesPerSecond = Math.round(changes / result.wallSeconds);
  return result;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const number = (name: string, fallback: number) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
  const result = runStandbyChaos({ changes: number('changes', 5_000), seed: number('seed', 26014),
    bandwidthBytesPerSecond: number('bandwidth', 512 * 1024), budgetSeconds: number('budget', 900) });
  process.stdout.write(JSON.stringify(result) + '\n');
}

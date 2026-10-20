// Independent oracle: no production planner, merge helpers, SQL, or sync-map reads.
export type Policy = 'flag' | 'filemaker-wins' | 'tabularius-wins' | 'newer-wins';
export type Fault = 'none' | 'drop' | 'lost-ack' | 'duplicate' | 'reorder' | 'truncate' | 'short-page' | 'schema';
export type Row = { A: string; B: string; stamp: string; version: number };
export type Op =
  | { kind: 'edit' | 'create'; replica: number; key: string; field: 'A' | 'B'; value: string; stamp: string }
  | { kind: 'delete'; replica: number; key: string }
  | { kind: 'sync'; replica: number; policy: Policy; keep: 'mine' | 'theirs'; fault: Fault; at: number };
export const values = (rows: Map<string, Row>) => [...rows].map(([uuid, r]) => ({ uuid, A: r.A, B: r.B })).sort((a, b) => a.uuid.localeCompare(b.uuid));
const same = (a: Row, b: Row) => a.A === b.A && a.B === b.B;

export class Model {
  rows: Map<string, Row>[];
  // Each local replica has its own pairwise baseline with replica zero (the hub).
  seen: Map<string, [number, number]>[];
  serial = 0;
  constructor(count: number) {
    this.rows = Array.from({ length: count }, () => new Map());
    this.seen = Array.from({ length: count }, () => new Map());
  }
  edit(op: Exclude<Op, { kind: 'sync' }>): boolean {
    const rows = this.rows[op.replica], old = rows.get(op.key);
    if (op.kind === 'delete') return rows.delete(op.key);
    if ((op.kind === 'edit' && !old) || (op.kind === 'create' && old)) return false;
    rows.set(op.key, { A: '', B: '', ...old, [op.field]: op.value, stamp: op.stamp, version: ++this.serial });
    return true;
  }
  preview(op: Extract<Op, { kind: 'sync' }>) {
    const local = this.rows[op.replica], remote = this.rows[0], baseline = this.seen[op.replica];
    const actions: { key: string; from: number; to: number }[] = [], conflicts: string[] = [];
    for (const key of new Set([...local.keys(), ...remote.keys(), ...baseline.keys()])) {
      const l = local.get(key), r = remote.get(key), seen = baseline.get(key);
      if ((!l && !r) || (l && r && same(l, r))) continue;
      const lc = l ? l.version !== seen?.[0] : !!seen;
      const rc = r ? r.version !== seen?.[1] : !!seen;
      let mine: boolean;
      if (lc && rc) {
        const comparable = l && r && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(l.stamp) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(r.stamp) && l.stamp !== r.stamp;
        if (l && r && op.policy === 'tabularius-wins') mine = true;
        else if (l && r && op.policy === 'filemaker-wins') mine = false;
        else if (op.policy === 'newer-wins' && comparable) mine = l!.stamp > r!.stamp;
        else { conflicts.push(key); mine = op.keep === 'mine'; }
      } else mine = lc;
      actions.push({ key, from: mine ? op.replica : 0, to: mine ? 0 : op.replica });
    }
    return { actions, conflicts: conflicts.sort() };
  }
  sync(op: Extract<Op, { kind: 'sync' }>): void {
    for (const { key, from, to } of this.preview(op).actions) {
      const winner = this.rows[from].get(key), old = this.rows[to].get(key);
      if (!winner) this.rows[to].delete(key);
      // Modification timestamps are not transferred; generated schemas have no auto-enter.
      else this.rows[to].set(key, { ...winner, stamp: old?.stamp ?? '', version: ++this.serial });
    }
    const baseline = this.seen[op.replica];
    baseline.clear();
    for (const [key, local] of this.rows[op.replica]) {
      const remote = this.rows[0].get(key);
      if (remote) baseline.set(key, [local.version, remote.version]);
    }
  }
}

export function generate(seed: number, count: number): Op[] {
  let state = seed >>> 0;
  const next = (n: number) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor(((t ^ (t >>> 14)) >>> 0) / 4294967296 * n);
  };
  const pick = <T>(xs: T[]) => xs[next(xs.length)];
  const ops: Op[] = [];
  const stamp = () => pick(['2026-01-01T00:00:00', '2026-01-02T00:00:00', '2025-12-31T23:00:00', 'unreadable']);
  const sync = (replica: number, fault: Fault = 'none', policy: Policy = 'flag') => ops.push({ kind: 'sync', replica, fault, policy, keep: next(2) ? 'mine' : 'theirs', at: 1 + next(5) });
  // Shared records establish deletion baselines on every replica.
  for (let k = 0; k < 4; k++) ops.push({ kind: 'create', replica: 0, key: `base${k}`, field: 'A', value: `initial${k}`, stamp: stamp() });
  for (let r = 1; r < count; r++) sync(r);
  // Same-key creates and disjoint field edits are record conflicts, not a field merge.
  for (const replica of [0, 1]) ops.push({ kind: 'create', replica, key: 'collision', field: 'A', value: `side${replica}`, stamp: stamp() });
  ops.push({ kind: 'edit', replica: 0, key: 'base0', field: 'A', value: 'remote edit', stamp: stamp() });
  ops.push({ kind: 'edit', replica: 1, key: 'base0', field: 'B', value: 'local edit', stamp: stamp() });
  sync(1);
  ops.push({ kind: 'delete', replica: 1, key: 'base1' });
  ops.push({ kind: 'edit', replica: 0, key: 'base1', field: 'A', value: 'edit versus delete', stamp: stamp() });
  sync(1, 'none', 'newer-wins');
  // Edited clocks: later local, later remote, equal, and unreadable. This tests
  // wall-clock policy only; physical chronology under clock skew is unverified.
  for (const [mine, theirs] of [
    ['2026-01-02T00:00:00', '2026-01-01T00:00:00'],
    ['2025-12-31T23:00:00', '2026-01-01T00:00:00'],
    ['2026-01-01T00:00:00', '2026-01-01T00:00:00'],
    ['unreadable', '2026-01-01T00:00:00'],
  ]) {
    ops.push({ kind: 'edit', replica: 1, key: 'base2', field: 'A', value: `mine/${mine}`, stamp: mine });
    ops.push({ kind: 'edit', replica: 0, key: 'base2', field: 'A', value: `theirs/${theirs}`, stamp: theirs });
    sync(1, 'none', 'newer-wins');
  }
  // Each fault sees five outgoing writes: one update, three creates and a delete.
  const faults: Fault[] = ['drop', 'lost-ack', 'duplicate', 'reorder', 'truncate', 'short-page', 'schema'];
  for (let i = faults.length - 1; i > 0; i--) { const j = next(i + 1); [faults[i], faults[j]] = [faults[j], faults[i]]; }
  for (const fault of faults) {
    ops.push({ kind: 'create', replica: 0, key: `victim-${fault}`, field: 'A', value: 'delete after baseline', stamp: stamp() });
    sync(1);
    ops.push({ kind: 'delete', replica: 1, key: `victim-${fault}` });
    ops.push({ kind: 'edit', replica: 1, key: 'base3', field: 'B', value: `update-${fault}`, stamp: stamp() });
    for (let k = 0; k < 3; k++) ops.push({ kind: 'create', replica: 1, key: `${fault}${k}`, field: 'A', value: `ack-${seed}-${k}`, stamp: stamp() });
    sync(1, fault);
  }
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < 3; i++) {
      const replica = next(count), key = `base${next(4)}`;
      if (next(5) === 0) ops.push({ kind: 'delete', replica, key });
      else ops.push({ kind: 'edit', replica, key, field: next(2) ? 'A' : 'B', value: `${seed}/${round}/${i}`, stamp: stamp() });
    }
    const order = Array.from({ length: count - 1 }, (_, i) => i + 1);
    if (next(2)) order.reverse();
    for (const replica of order) sync(replica, pick(['none', 'reorder']), pick(['flag', 'filemaker-wins', 'tabularius-wins', 'newer-wins']));
  }
  // Quiescent full sweep: first settle pending edits, then propagate the last hub state.
  for (let sweep = 0; sweep < 2; sweep++) for (let r = 1; r < count; r++) sync(r, 'none', 'filemaker-wins');
  return ops;
}

/** Bounded delta debugging; replay always creates fresh replicas. Preserve the original assertion identity. */
export async function shrink(history: Op[], fails: (candidate: Op[]) => Promise<boolean>, budget = 24): Promise<Op[]> {
  let out = history;
  const deadline = performance.now() + 10_000;
  for (let size = Math.ceil(out.length / 2); size >= 1 && budget > 0 && performance.now() < deadline; size = Math.floor(size / 2)) {
    for (let start = 0; start < out.length && budget > 0 && performance.now() < deadline;) {
      const candidate = out.slice(0, start).concat(out.slice(start + size));
      budget--;
      if (await fails(candidate)) out = candidate;
      else start += size;
    }
  }
  return out;
}

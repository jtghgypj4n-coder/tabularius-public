// A model-based test of the script engine's transactions. Random scripts (new, edit, delete, go to record, a failed commit,
// Perform Script, Open/Commit/Revert Transaction, Exit Script, Set Revert Transaction on Error) are run against the real engine
// and against a plain model: a map of records, a found set and a position, with a snapshot taken at Open Transaction. After every
// script the records (every field and the modification count), the error codes the script logged, the found count, the record
// number and the current record must agree.
//
// A failure prints the seed and the smallest script that still disagrees (the generator is seeded; the shrinker drops steps and
// unwraps blocks). Re-run one seed with TX_SEED=<n>; widen the search with TX_SEEDS=<count>.
//
// What Claris does not document is not guessed at here: the KNOWN table at the end pins the repo's behaviour for each such
// combination, with the Claris page and "unverified" where the page is silent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

type Field = 'Name' | 'Qty' | 'Tag';
type Op =
  | { k: 'new'; name?: string; qty?: number; tag?: string }
  | { k: 'edit'; field: Field; v: string | number }
  | { k: 'dangling'; field: Field; v: string | number }
  | { k: 'delete' }
  | { k: 'go'; to: 'first' | 'last' | 'next' | 'previous' }
  | { k: 'sub'; ops: Op[] }
  | { k: 'tx'; ops: Op[]; end: 'commit' | 'revert' | 'custom' | 'none' }
  | { k: 'revertTx'; custom: boolean }
  | { k: 'exit' }
  | { k: 'revertOnError'; on: boolean };

// ---------------------------------------------------------------------------------------------- the generator

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['n1', 'n2', 'n3'];
const QTYS = [0, 5, 50, 100, 101, 250];
const TAGS = ['a', 'b', 'c'];

function generate(random: () => number, size: number, inTx: boolean, inSub: boolean): Op[] {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
  const weighted = (table: [string, number][]) => {
    let n = random() * table.reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of table) if ((n -= w) < 0) return k;
    return table[0]![0];
  };
  const ops: Op[] = [];
  for (let i = 0; i < size; i++) {
    const kind = weighted([['new', 24], ['edit', 20], ['dangling', 4], ['delete', 9], ['go', 14], ['sub', inTx ? 8 : 6], ['tx', inTx ? 0 : 12], ['revertTx', 4], ['exit', inTx ? 1 : 0], ['revertOnError', 3]]);
    const value = (f: Field) => f === 'Name' ? pick(NAMES) : f === 'Qty' ? pick(QTYS) : pick(TAGS);
    switch (kind) {
      case 'new': {
        const op: Op = { k: 'new' };
        if (random() < 0.8) op.name = pick(NAMES);
        if (random() < 0.8) op.qty = pick(QTYS);
        if (random() < 0.5) op.tag = pick(TAGS);
        ops.push(op);
        break;
      }
      case 'edit': { const field = pick<Field>(['Name', 'Qty', 'Tag']); ops.push({ k: 'edit', field, v: value(field) }); break; }
      case 'dangling': { const field = pick<Field>(['Name', 'Qty', 'Tag']); ops.push({ k: 'dangling', field, v: value(field) }); break; }
      case 'delete': ops.push({ k: 'delete' }); break;
      case 'go': ops.push({ k: 'go', to: pick(['first', 'last', 'next', 'previous'] as const) }); break;
      case 'sub': ops.push({ k: 'sub', ops: generate(random, 1 + Math.floor(random() * 3), inTx, true) }); break;
      case 'tx': ops.push({ k: 'tx', ops: generate(random, 1 + Math.floor(random() * 4), true, inSub), end: pick(['commit', 'commit', 'revert', 'custom'] as const) }); break;
      case 'revertTx': ops.push({ k: 'revertTx', custom: random() < 0.5 }); break;
      case 'exit': ops.push({ k: 'exit' }); i = size; break; // nothing after it runs
      case 'revertOnError': ops.push({ k: 'revertOnError', on: random() < 0.5 }); break;
    }
  }
  // A subscript may end with its transaction still open: the engine reverts it as the subscript ends.
  if (inSub && !inTx && random() < 0.15) ops.push({ k: 'tx', ops: generate(random, 1 + Math.floor(random() * 2), true, true), end: 'none' });
  return ops;
}

// ---------------------------------------------------------------------------------------------- rendering

const LOG = (what: string) => `Set Variable [ $$log ; Value: $$log & ${what} & "," ]`;
const ERR = LOG('Get ( LastError )');
const q = (v: string | number) => typeof v === 'number' ? String(v) : `"${v}"`;

interface Rendered { main: string; subs: [string, string][] }

function render(ops: Op[], tag: string): Rendered {
  const subs: [string, string][] = [];
  let n = 0;
  const lines = (list: Op[]): string[] => list.flatMap((op): string[] => {
    switch (op.k) {
      case 'new': {
        const sets = (['Name', 'Qty', 'Tag'] as const).flatMap((f) => {
          const v = f === 'Name' ? op.name : f === 'Qty' ? op.qty : op.tag;
          return v === undefined ? [] : [`Set Field [ Items::${f} ; ${q(v)} ]`];
        });
        return ['New Record/Request', ...sets, 'Commit Records/Requests [ With dialog: Off ]', 'Set Variable [ $e ; Value: Get ( LastError ) ]', LOG('$e'), 'If [ $e <> 0 ]', 'Revert Record/Request [ With dialog: Off ]', 'End If'];
      }
      case 'edit':
        return ['If [ Get ( FoundCount ) > 0 ]', `Set Field [ Items::${op.field} ; ${q(op.v)} ]`, 'Commit Records/Requests [ With dialog: Off ]', 'Set Variable [ $e ; Value: Get ( LastError ) ]', LOG('$e'), 'If [ $e <> 0 ]', 'Revert Record/Request [ With dialog: Off ]', 'End If', 'End If'];
      case 'dangling':
        return ['If [ Get ( FoundCount ) > 0 ]', `Set Field [ Items::${op.field} ; ${q(op.v)} ]`, 'Revert Record/Request [ With dialog: Off ]', ERR, 'End If'];
      case 'delete':
        return ['If [ Get ( FoundCount ) > 0 ]', 'Delete Record/Request [ With dialog: Off ]', ERR, 'End If'];
      case 'go':
        return [op.to === 'next' || op.to === 'previous' ? `Go to Record/Request/Page [ ${op.to === 'next' ? 'Next' : 'Previous'} ; Exit after last: Off ]` : `Go to Record/Request/Page [ ${op.to === 'first' ? 'First' : 'Last'} ]`, ERR];
      case 'sub': {
        const name = `Sub ${tag} ${++n}`;
        subs.push([name, [...lines(op.ops), 'Exit Script [ Text Result: "r" ]'].join('\n')]);
        return [`Perform Script [ Specified: By name ; "${name}" ]`, LOG('"<" & Get ( ScriptResult ) & ">"')];
      }
      case 'tx': {
        const end = op.end === 'commit' ? ['Commit Transaction'] : op.end === 'revert' ? ['Revert Transaction', 'Commit Transaction']
          : op.end === 'custom' ? ['Revert Transaction [ Error code: 5001 ; Error message: "model" ]', 'Commit Transaction'] : [];
        return ['Open Transaction', ...lines(op.ops), ...end, ...(op.end === 'none' ? [] : [ERR])];
      }
      case 'revertTx':
        return [op.custom ? 'Revert Transaction [ Error code: 5001 ; Error message: "model" ]' : 'Revert Transaction', ERR];
      case 'exit': return ['Exit Script [ Text Result: "x" ]'];
      case 'revertOnError': return [`Set Revert Transaction on Error [ ${op.on ? 'On' : 'Off'} ]`];
    }
  });
  const main = ['Set Error Capture [ On ]', 'Set Variable [ $$log ; Value: "" ]', ...lines(ops),
    'Set Variable [ $n ; Value: Case ( Get ( FoundCount ) > 0 ; Items::Name & "/" & Items::Qty & "/" & Items::Tag ; "-" ) ]',
    'Exit Script [ Text Result: $$log & "|" & Get ( FoundCount ) & "/" & Get ( RecordNumber ) & "/" & $n ]'].join('\n');
  return { main, subs };
}

// ---------------------------------------------------------------------------------------------- the model

interface Rec { name: string | null; qty: number | null; tag: string | null; mod: number }
interface Snapshot { recs: [number, Rec][]; fs: number[]; idx: number }
class Reverted {
  readonly code: number;
  readonly owner: number;
  constructor(code: number, owner: number) { this.code = code; this.owner = owner; }
}
class Exited {
  readonly frame: number;
  constructor(frame: number) { this.frame = frame; }
}
/** A transaction with no Commit Transaction was reverted: the script goes on at its end, past its Exit Script. */
class Ended {
  readonly frame: number;
  constructor(frame: number) { this.frame = frame; }
}

class Model {
  recs = new Map<number, Rec>();
  fs: number[] = [];
  idx = 0;
  next = 1;
  revertOnError = true;
  tx?: { snap: Snapshot; owner: number };
  log = '';
  lastError = 0;
  frames = 0;
  exited = false;

  /** Each script starts on every record, at the first. */
  begin() { this.frames = 0; this.fs = [...this.recs.keys()]; this.idx = 0; this.log = ''; this.revertOnError = true; this.tx = undefined; this.exited = false; this.lastError = 0; }

  private snapshot(): Snapshot { return { recs: [...this.recs].map(([id, r]) => [id, { ...r }]), fs: [...this.fs], idx: this.idx }; }

  /** The records come back; a record the transaction made leaves the found set, one it deleted is not put back (KNOWN). */
  private restore(snap: Snapshot) {
    this.recs = new Map(snap.recs.map(([id, r]) => [id, { ...r }]));
    const current = this.fs[this.idx];
    const kept = this.fs.filter((id) => this.recs.has(id));
    // When the record it is on was made inside the transaction, the last one is current (KNOWN).
    this.idx = kept.length === this.fs.length ? this.idx : Math.max(0, current !== undefined && kept.includes(current) ? kept.indexOf(current) : Math.min(this.idx, kept.length - 1));
    this.fs = kept;
    this.tx = undefined;
  }

  private revertOpenTransaction(code: number): never {
    const tx = this.tx!;
    this.restore(tx.snap);
    this.lastError = code;
    throw new Reverted(code, tx.owner);
  }

  private commitFailure(code: number, newRecord = false) {
    this.lastError = code;
    if (this.tx && this.revertOnError) this.revertOpenTransaction(code);
    this.log += `${code},`;
    // Revert Record/Request on a new record deletes it; the found set's last record is current (KNOWN).
    if (newRecord) this.idx = Math.max(0, this.fs.length - 1);
  }

  private validate(rec: Rec, self?: number): number {
    if (rec.qty !== null && (rec.qty < 0 || rec.qty > 100)) return 503;
    if (rec.tag !== null) for (const [id, other] of this.recs) if (id !== self && other.tag === rec.tag) return 504;
    return 0;
  }

  /** Runs a script's steps: what it returns, 'r' by its last step, 'x' by an Exit Script before it, '' past it. */
  frame(ops: Op[]): string {
    const id = ++this.frames;
    const saved = this.revertOnError;
    let returned = 'r';
    try {
      this.run(ops, id);
    } catch (e) {
      if (!((e instanceof Exited || e instanceof Ended) && e.frame === id)) throw e;
      returned = e instanceof Exited ? 'x' : '';
    } finally {
      this.revertOnError = saved;
    }
    // A script that ends with its transaction open keeps none of it.
    if (this.tx?.owner === id) this.restore(this.tx.snap);
    return returned;
  }

  private run(ops: Op[], frame: number) { for (const op of ops) this.step(op, frame); }

  private step(op: Op, frame: number) {
    switch (op.k) {
      case 'new': {
        const rec: Rec = { name: op.name ?? null, qty: op.qty ?? null, tag: op.tag ?? null, mod: 1 };
        const code = this.validate(rec);
        if (code) {
          // The record exists, uncommitted, when the commit fails: a reverting transaction finds it in the found set.
          if (this.tx && this.revertOnError) { this.fs.push(Math.max(0, ...this.recs.keys()) + 1); this.idx = this.fs.length - 1; }
          return this.commitFailure(code, true);
        }
        // Record ids are the table's row ids: the highest one is used again after its record is deleted (KNOWN).
        const id = Math.max(0, ...this.recs.keys()) + 1;
        this.recs.set(id, rec);
        this.fs.push(id);
        this.idx = this.fs.length - 1;
        this.lastError = 0;
        this.log += '0,';
        return;
      }
      case 'edit': {
        if (!this.fs.length) return;
        const id = this.fs[this.idx]!;
        const rec = { ...this.recs.get(id)! };
        if (op.field === 'Name') rec.name = String(op.v); else if (op.field === 'Qty') rec.qty = Number(op.v); else rec.tag = String(op.v);
        const code = this.validate(rec, id);
        if (code) return this.commitFailure(code);
        rec.mod++;
        this.recs.set(id, rec);
        this.lastError = 0;
        this.log += '0,';
        return;
      }
      case 'dangling': if (this.fs.length) { this.lastError = 0; this.log += '0,'; } return;
      case 'delete': {
        if (!this.fs.length) return;
        this.recs.delete(this.fs[this.idx]!);
        this.fs.splice(this.idx, 1);
        this.idx = Math.max(0, Math.min(this.idx, this.fs.length - 1));
        this.lastError = 0;
        this.log += '0,';
        return;
      }
      case 'go': {
        const last = this.fs.length - 1;
        let error = 0;
        if (op.to === 'first') this.idx = 0;
        else if (op.to === 'last') this.idx = Math.max(0, last);
        else if (op.to === 'next') { if (this.idx >= last) error = 101; else this.idx++; }
        else if (this.idx <= 0) error = 101; else this.idx--;
        if (!error && !this.fs.length) error = 101;
        this.lastError = error;
        this.log += `${error},`;
        return;
      }
      case 'sub': {
        const returned = this.frame(op.ops);
        this.log += `<${returned}>,`;
        return;
      }
      case 'tx': {
        // The generator never opens one inside another.
        assert.ok(!this.tx, 'the model is not asked to nest Open Transaction');
        this.tx = { snap: this.snapshot(), owner: frame };
        this.lastError = 0;
        try {
          this.run(op.ops, frame);
        } catch (e) {
          if (!(e instanceof Reverted) || e.owner !== frame) throw e;
          if (op.end === 'none') throw new Ended(frame);
          this.log += `${e.code},`;
          return;
        }
        if (op.end === 'commit') { this.tx = undefined; this.lastError = 0; }
        else if (op.end === 'revert' || op.end === 'custom') {
          // The step that reverts goes on after this block's Commit Transaction.
          try { this.revertOpenTransaction(op.end === 'custom' ? 5001 : 0); } catch (e) { if (!(e instanceof Reverted)) throw e; }
        } else return; // 'none': the subscript ends, and the frame reverts it
        this.log += `${this.lastError},`;
        return;
      }
      case 'revertTx': {
        if (!this.tx) { this.lastError = 3; this.log += '3,'; return; }
        this.revertOpenTransaction(op.custom ? 5001 : 0);
        return;
      }
      case 'exit': throw new Exited(frame);
      case 'revertOnError': this.revertOnError = op.on; return;
    }
  }

  result(): string {
    if (this.exited) return 'x';
    const cur = this.fs.length ? this.recs.get(this.fs[this.idx]!)! : undefined;
    const text = (v: string | number | null) => v === null ? '' : String(v);
    return `${this.log}|${this.fs.length}/${this.fs.length ? this.idx + 1 : 0}/${cur ? `${text(cur.name)}/${text(cur.qty)}/${text(cur.tag)}` : '-'}`;
  }

  rows(): string[] { return [...this.recs.values()].map((r) => JSON.stringify([r.name, r.qty, r.tag, r.mod])); }
}

// ---------------------------------------------------------------------------------------------- the runner

let counter = 0;

async function withEngine<T>(fn: (run: (ops: Op[]) => Promise<{ result: string; rows: string[] }>) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-tx-model-'));
  createStore(join(dir, 'M.sqlite'));
  const store = new Store(join(dir, 'M.sqlite'), 'M');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [
      { name: 'Name', type: 'text' },
      { name: 'Qty', type: 'number', options: { validation: { always: true, range: { min: '0', max: '100' } } } },
      { name: 'Tag', type: 'text', options: { validation: { always: true, unique: true } } },
    ] }]);
    return await fn(async (ops) => {
      const tag = String(++counter);
      const { main, subs } = render(ops, tag);
      for (const [name, text] of subs) store.applyDesign([{ op: 'createScript', name, text }]);
      store.applyDesign([{ op: 'createScript', name: `Main ${tag}`, text: main }]);
      let result: string;
      try { result = String((await runScript(store, `Main ${tag}`, { layout: 'Items' })).result); } catch (e) { result = `THROW ${(e as Error).message}`; }
      const rows = store.select('SELECT Name, Qty, Tag, _fm_mod_id FROM "Items" ORDER BY _fm_record_id', [], 1000).rows
        .map((r: unknown[]) => JSON.stringify([r[0] ?? null, r[1] ?? null, r[2] ?? null, r[3]]));
      return { result, rows };
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A transaction left open belongs only at the end of a subscript, and nowhere in another transaction. */
function valid(ops: Op[], inSub: boolean, inTx: boolean): boolean {
  return ops.every((op, i) => {
    if (op.k === 'tx') {
      if (inTx) return false;
      if (op.end === 'none' && !(inSub && i === ops.length - 1)) return false;
      return valid(op.ops, inSub, true);
    }
    if (op.k === 'sub') return valid(op.ops, true, inTx);
    return true;
  });
}

/** The first script of `history` + `last` whose result or records differ from the model's, or undefined when they all agree. */
async function disagreement(history: Op[][], last: Op[]): Promise<string | undefined> {
  if (![...history, last].every((ops) => valid(ops, false, false))) return undefined;
  return withEngine(async (run) => {
    const model = new Model();
    for (const ops of [...history, last]) {
      model.begin();
      // A smaller script the model is not asked about (a block unwrapped into another's) is not a disagreement.
      try { model.exited = model.frame(ops) === 'x'; } catch { return undefined; }
      const got = await run(ops);
      if (got.result !== model.result()) return `result: model ${model.result()} ≠ engine ${got.result}`;
      const want = model.rows();
      if (JSON.stringify(got.rows) !== JSON.stringify(want)) return `records: model ${want.join(' ')} ≠ engine ${got.rows.join(' ')}`;
    }
    return undefined;
  });
}

/** Every list with one op removed, or one block replaced by its body, anywhere in the tree. */
function* smaller(ops: Op[]): Generator<Op[]> {
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    yield [...ops.slice(0, i), ...ops.slice(i + 1)];
    if (op.k === 'tx' || op.k === 'sub') {
      yield [...ops.slice(0, i), ...op.ops, ...ops.slice(i + 1)];
      for (const inner of smaller(op.ops)) yield [...ops.slice(0, i), { ...op, ops: inner } as Op, ...ops.slice(i + 1)];
      if (op.k === 'tx' && op.end !== 'commit') yield [...ops.slice(0, i), { ...op, end: 'commit' }, ...ops.slice(i + 1)];
    }
  }
}

async function shrink(history: Op[][], failing: Op[], why: string): Promise<{ history: Op[][]; ops: Op[]; why: string }> {
  let budget = 400;
  let progress = true;
  while (progress && budget > 0) {
    progress = false;
    for (let i = 0; i < history.length && budget > 0; i++) {
      budget--;
      const without = [...history.slice(0, i), ...history.slice(i + 1)];
      const d = await disagreement(without, failing);
      if (d) { history = without; why = d; progress = true; break; }
    }
    for (const candidate of smaller(failing)) {
      if (budget-- <= 0) break;
      const d = await disagreement(history, candidate);
      if (d) { failing = candidate; why = d; progress = true; break; }
    }
  }
  return { history, ops: failing, why };
}

const SEEDS = process.env.TX_SEED ? [Number(process.env.TX_SEED)] : Array.from({ length: Number(process.env.TX_SEEDS ?? 40) }, (_, i) => i + 1);

for (const seed of SEEDS) {
  test(`transactions agree with the model: seed ${seed}`, async () => {
    const random = rng(seed);
    const history: Op[][] = [];
    for (let s = 0; s < 5; s++) {
      const ops = generate(random, 4 + Math.floor(random() * 8), false, false);
      const why = await disagreement(history, ops);
      if (why) {
        const small = await shrink(history, ops, why);
        const text = [...small.history, small.ops].map((o, i) => `--- script ${i + 1}${i === small.history.length ? ' (fails)' : ''}\n${render(o, 'x').subs.map(([n, t]) => `[${n}]\n${t}\n`).join('')}${render(o, 'x').main}`).join('\n');
        assert.fail(`seed ${seed}, script ${s + 1}: ${small.why}\n${text}`);
      }
      history.push(ops);
    }
  });
}

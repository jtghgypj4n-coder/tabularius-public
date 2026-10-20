// Results shared between a server's processes and worked out ahead in the
// background: a whole-table summary over a calculation is worked out once per
// server (not once per process), the warmer works it out before anyone asks,
// and after a change a layout read shows the last result while the new one
// is worked out, where a script or calculation always gets the new one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store } from '../../store/src/index.ts';
import { ResultCache } from '../../store/src/results.ts';
import { Host } from '../src/host.ts';
import { writer } from '../../store/src/activity.ts';

/** A change by another account, which (unlike the one that made it) may be shown the last result while the new one is worked out. */
const asOther = <T>(fn: () => T): T => writer.run({ account: 'someone else' }, fn);

let dir: string;
let path: string;
const ROWS = 3000;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-shared-results-'));
  path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Id', type: 'number' }, { name: 'Total', type: 'number' }] },
    { op: 'createField', table: 'Orders', name: 'Net', type: 'number', kind: 'calculation', calculation: 'Total * 2', options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'sNet', kind: 'summary', summary: { type: 'total', field: 'Net' } },
    // Through a custom function: not known to depend on the record alone, so never updated in place.
    { op: 'createCustomFunction', name: 'Twice', parameters: ['x'], formula: 'x * 2' },
    { op: 'createField', table: 'Orders', name: 'Net2', type: 'number', kind: 'calculation', calculation: 'Twice ( Total )', options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'sNet2', kind: 'summary', summary: { type: 'total', field: 'Net2' } },
  ] as never);
  store.close();
  const sql = new DatabaseSync(path);
  sql.exec('BEGIN');
  for (let i = 1; i <= ROWS; i++) sql.prepare('INSERT INTO Orders (Id, Total) VALUES (?, ?)').run(i, i % 10);
  sql.exec('COMMIT');
  sql.close();
});
after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const expected = (extra = 0) => {
  let t = 0;
  for (let i = 1; i <= ROWS; i++) t += (i % 10) * 2;
  return t + extra;
};

/** Whole-table passes a function makes, counted from the SQL trace. */
function passes(fn: () => void): number {
  const write = process.stderr.write;
  let n = 0;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    if (/allRecords/.test(String(chunk))) n++;
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = write;
  }
  return n;
}

function open(): Store {
  process.env.TABULARIUS_TRACE_SQL = '1';
  try {
    const s = new Store(path, 'Shop');
    s.shareResults();
    return s;
  } finally {
    delete process.env.TABULARIUS_TRACE_SQL;
  }
}

const first = (s: Store) => s.find('Orders', { limit: 1, layoutOnly: true }).records[0];
const read = (s: Store, field = 'sNet') => Number(first(s).fieldData[field]);

test('a summary over a calculation is worked out once for every process, and again only after a change', () => {
  const a = open();
  const b = open();
  try {
    let value = 0;
    assert.equal(passes(() => (value = read(a))), 1, 'the first process works it out');
    assert.equal(value, expected());
    assert.equal(passes(() => (value = read(b))), 0, 'the second process reads the shared result');
    assert.equal(value, expected());

    // A change in one process moves the data version for both.
    const id = b.find('Orders', { limit: 1 }).records[0].recordId;
    const was = read(b, 'sNet2');
    asOther(() => b.update('Orders', id, { Total: '1001' }));
    let rec!: ReturnType<typeof first>;
    let warm = 0;
    a.warmSoon = () => warm++;
    // A layout read shows the last result, marked as updating, and asks for the new one...
    assert.equal(passes(() => (rec = first(a))), 0);
    assert.equal(Number(rec.fieldData.sNet2), was);
    assert.deepEqual(rec.updating, ['sNet2']);
    assert.equal(warm, 1);
    // ...while a calculation (a script's, say) works the new one out.
    const fresh = Number(a.evaluate('Orders', 'Orders::sNet2', id).value);
    assert.equal(fresh, expected((1001 - 1) * 2));
    assert.equal(passes(() => (rec = first(b))), 0, 'and shares it');
    assert.equal(Number(rec.fieldData.sNet2), fresh);
    assert.equal(rec.updating, undefined);
  } finally {
    a.close();
    b.close();
  }
});

test('the warmer works layout results out in the background when a file opens and after changes', async () => {
  const host = new Host(dir, () => {}, { shareResults: true, warmSettleMs: 0 });
  try {
    const store = host.add(path);
    await host.warmed();
    const s = open();
    try {
      let value = 0;
      assert.equal(passes(() => (value = read(s))), 0, 'already worked out');
      const id = s.find('Orders', { limit: 1 }).records[0].recordId;
      assert.equal(value, Number(store.evaluate('Orders', 'Orders::sNet', id).value));
      store.update('Orders', id, { Total: '5' });
      await host.warmed();
      assert.equal(passes(() => (value = read(s))), 0, 'worked out again after the change');
      assert.equal(value, Number(store.evaluate('Orders', 'Orders::sNet', id).value));
    } finally {
      s.close();
    }
  } finally {
    host.close();
  }
});

test('a store file put in place of another (reconverted, restored) never reuses its results', () => {
  const a = open();
  let before = 0;
  try {
    before = read(a);
  } finally {
    a.close();
  }
  // A copy with other data, same design and the same data version, moved in.
  const live = new DatabaseSync(path);
  live.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  live.close();
  const copy = path + '.copy';
  copyFileSync(path, copy);
  const sql = new DatabaseSync(copy);
  const { n } = sql.prepare('SELECT n FROM _fm_data_version').get() as { n: number };
  sql.exec('UPDATE Orders SET Total = Total + 1');
  sql.prepare('UPDATE _fm_data_version SET n = ?').run(n);
  sql.close();
  for (const side of ['-wal', '-shm']) rmSync(path + side, { force: true });
  renameSync(copy, path);
  const b = open();
  try {
    let value = 0;
    assert.equal(passes(() => (value = read(b))), 1, 'worked out afresh');
    assert.equal(value, before + ROWS * 2);
  } finally {
    b.close();
  }
});

test('a total over values of the record alone is brought up to date on each change, without reading every record', () => {
  const a = open();
  const b = open();
  try {
    let value = read(a);
    const id = b.find('Orders', { limit: 1 }).records[0].recordId;
    const total = (s: Store) => Number(s.evaluate('Orders', 'Orders::Total', id).value);
    const before = total(b);
    asOther(() => b.update('Orders', id, { Total: String(before + 7) }));
    let rec!: ReturnType<typeof first>;
    assert.equal(passes(() => (rec = first(a))), 0, 'not read again');
    assert.equal(Number(rec.fieldData.sNet), value + 14);
    assert.ok(!rec.updating?.includes('sNet'));
    value += 14;
    // Added and deleted records too.
    const { recordId } = asOther(() => b.create('Orders', { Id: '99999', Total: '50' }));
    assert.equal(passes(() => (rec = first(a))), 0);
    assert.equal(Number(rec.fieldData.sNet), value + 100);
    asOther(() => b.delete('Orders', recordId));
    assert.equal(passes(() => (rec = first(a))), 0);
    assert.equal(Number(rec.fieldData.sNet), value);
    assert.equal(Number(a.evaluate('Orders', 'Orders::sNet', id).value), value, 'the same as worked out afresh');
  } finally {
    a.close();
    b.close();
  }
});

test('whoever made a change sees results worked out after it, never one from before', () => {
  const a = open();
  try {
    read(a, 'sNet2');
    const id = a.find('Orders', { limit: 1 }).records[0].recordId;
    a.update('Orders', id, { Total: '3' });
    let rec!: ReturnType<typeof first>;
    assert.equal(passes(() => (rec = first(a))), 1, 'worked out afresh for the writer');
    assert.equal(rec.updating, undefined);
    assert.equal(Number(rec.fieldData.sNet2), Number(a.evaluate('Orders', 'Orders::sNet2', id).value));
  } finally {
    a.close();
  }
});

test('one process at a time claims working a result out; the others wait for it', () => {
  const file = join(dir, 'claims.results');
  const a = new ResultCache(file);
  const b = new ResultCache(file);
  try {
    assert.equal(a.claim('k', 60_000), true);
    assert.equal(a.claim('k', 60_000), true, 'its own claim again');
    assert.equal(b.claim('k', 60_000), false, 'held by the other');
    assert.equal(b.claimed('k'), true);
    a.release('k');
    assert.equal(b.claimed('k'), false);
    assert.equal(b.claim('k', 1), true);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    assert.equal(a.claim('k', 60_000), true, 'a claim that ran out is taken over');
    // Not inside a transaction that may be rolled back: nothing is shared from there.
    let open = true;
    const c = new ResultCache(file, () => open);
    c.put('x', 'f/v1', 'v');
    assert.equal(c.get('x'), undefined);
    open = false;
    c.put('x', 'f/v1', 'v');
    assert.equal(c.get('x')?.value, 'v');
    c.close();
  } finally {
    a.close();
    b.close();
  }
});

test('the trace times each field a layout read works out, by id and never by name', () => {
  const s = open();
  const write = process.stderr.write;
  const lines: string[] = [];
  process.env.TABULARIUS_TRACE_SQL = '1';
  process.stderr.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    s.find('Orders', { limit: 1 });
  } finally {
    process.stderr.write = write;
    delete process.env.TABULARIUS_TRACE_SQL;
    s.close();
  }
  const fields = lines.filter((l) => l.startsWith('[field]'));
  assert.ok(fields.some((l) => /calc t\d+\.f\d+ related 0 sql 0 cf 1 /.test(l)), fields.join(''));
  assert.ok(fields.some((l) => /summaries t\d+ 2 fields/.test(l)), fields.join(''));
  assert.ok(!fields.some((l) => /Net|Total|Orders|Twice/.test(l)));
});

// How many statements one record's read costs, whatever the table sizes: a
// related field two hops away (the second hop a ×) takes one query per hop,
// not one per record in between, and a layout summary over an unstored
// calculation, or an ExecuteSQL over one, isn't worked out again while the
// data is unchanged. Counted from TABULARIUS_TRACE_SQL in a process of its own.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store } from '../src/index.ts';

let dir: string;
let path: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-related-queries-'));
  path = join(dir, 'Shop.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'Id', type: 'number' }, { name: 'Group', type: 'number' }, { name: 'Total', type: 'number' }] },
    { op: 'createTable', name: 'Groups', fields: [{ name: 'Group', type: 'number' }, { name: 'Name' }] },
    { op: 'createTable', name: 'Prices', fields: [{ name: 'Id', type: 'number' }, { name: 'Price', type: 'number' }] },
    { op: 'createRelationship', left: 'Orders', right: 'Groups', predicates: [{ left: 'Group', right: 'Group' }] },
    { op: 'createRelationship', left: 'Groups', right: 'Prices', predicates: [{ left: 'Group', operator: '×', right: 'Id' }] },
    { op: 'createField', table: 'Orders', name: 'Net', type: 'number', kind: 'calculation', calculation: 'Total * 2 + Count(Groups::Group)', options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'sNet', kind: 'summary', summary: { type: 'total', field: 'Net' } },
    { op: 'createField', table: 'Orders', name: 'Over', type: 'number', kind: 'calculation', calculation: 'ExecuteSQL("SELECT COUNT(*) FROM Orders WHERE Net > ?"; ""; ""; Total)', options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'Now', type: 'number', kind: 'calculation', calculation: 'Net + Hour ( Get ( CurrentTime ) )', options: { unstored: true } },
    { op: 'createField', table: 'Orders', name: 'Big', type: 'number', kind: 'calculation', calculation: 'ExecuteSQL("SELECT COUNT(*) FROM Orders WHERE Net > ?"; ""; ""; 100)', options: { unstored: true } },
  ] as never);
  const occ = (name: string) => store.schema.tableOccurrences.find((t) => t.name === name)!;
  const ref = (to: string, f: string) => {
    const table = store.schema.tables.find((t) => t.id === occ(to).baseTableId)!;
    return { tableOccurrenceId: occ(to).id, fieldId: table.fields.find((x) => x.name === f)!.id, tableOccurrence: to, field: f };
  };
  let id = 1000;
  let top = 0;
  const field = (r: ReturnType<typeof ref>) => ({ id: ++id, kind: 'field', type: 1, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: top += 20, left: 20, bottom: top + 18, right: 200 }, style: {}, field: { ...r, display: 'edit', repetitions: 1 } });
  const layouts = {
    Related: [field(ref('Orders', 'Id')), field(ref('Prices', 'Price'))],
    Summary: [field(ref('Orders', 'Id')), field(ref('Orders', 'sNet')), field(ref('Orders', 'Big'))],
    Over: [field(ref('Orders', 'Id')), field(ref('Orders', 'Over'))],
  };
  for (const [name, objects] of Object.entries(layouts)) {
    store.applyDesign([{ op: 'createLayout', name, occurrence: 'Orders' } as never]);
    // No table view columns: a new layout's list every field.
    store.applyDesign([{ op: 'updateLayout', layout: name, design: { objects, tableView: [] } } as never]);
  }
  store.close();
  const sql = new DatabaseSync(path);
  sql.exec('BEGIN');
  for (let i = 1; i <= 2000; i++) sql.prepare('INSERT INTO Orders (Id, "Group", Total) VALUES (?, ?, ?)').run(i, i % 40, i % 97);
  for (let i = 1; i <= 2000; i++) sql.prepare('INSERT INTO Groups ("Group", Name) VALUES (?, ?)').run(i % 40, `Group ${i}`);
  for (let i = 1; i <= 2000; i++) sql.prepare('INSERT INTO Prices (Id, Price) VALUES (?, ?)').run(i, i % 13);
  sql.exec('COMMIT');
  sql.close();
});
after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** The statements each read ran, by reading, in a fresh process with tracing on. */
function traced(reads: string[], layoutOnly = false, offsets: number[] = []): { lines: string[]; out: string[] } {
  const store = join(import.meta.dirname, '..', 'src', 'index.ts');
  const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
    import { Store } from ${JSON.stringify(store)};
    const s = new Store(${JSON.stringify(path)}, 'Shop');
    const offsets = ${JSON.stringify(offsets)};
    for (const [i, layout] of ${JSON.stringify(reads)}.entries()) {
      process.stderr.write('-- read\\n');
      const rec = s.find(layout, { limit: 1, offset: offsets[i] ?? 1001, layoutOnly: ${layoutOnly} }).records[0];
      console.log(JSON.stringify(rec.fieldData));
    }
  `], { encoding: 'utf8', env: { ...process.env, TABULARIUS_TRACE_SQL: '1', TABULARIUS_TRACE_SQL_MIN_MS: '' }, timeout: 60_000, maxBuffer: 256 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  return { lines: r.stderr.split('-- read\n').slice(1), out: r.stdout.trim().split('\n') } as never;
}

test('a related field two hops away costs one query per hop, not one per record between', () => {
  const { lines, out } = traced(['Related']) as unknown as { lines: string[]; out: string[] };
  // Only the related field's own statements: the table's other fields (a summary, an ExecuteSQL) cost their own.
  const statements = lines[0].split('\n').filter((l) => l.startsWith('[sql]') && /<- .*\baddRelated\b/.test(l));
  // Order 1001 is in group 1, which has 50 group records: each would have been a query of its own.
  assert.ok(statements.length && statements.length < 10, `${statements.length} statements:\n${statements.join('\n')}`);
  assert.equal(JSON.parse(out[0])['Prices::Price'], 1);
});

test('a summary and an ExecuteSQL over a calculation are worked out once while the data is the same', () => {
  const { lines, out } = traced(['Summary', 'Summary']) as unknown as { lines: string[]; out: string[] };
  const whole = (i: number) => lines[i].split('\n').filter((l) => /SELECT \* FROM x ORDER BY x|COUNT\(\*\) FROM \(SELECT/.test(l)).length;
  assert.ok(whole(0) >= 2, 'the first read works them out');
  assert.equal(whole(1), 0, `the second read reuses them:\n${lines[1]}`);
  assert.deepEqual(JSON.parse(out[1]), JSON.parse(out[0]));
  let total = 0;
  let over = 0;
  for (let i = 1; i <= 2000; i++) {
    const net = (i % 97) * 2 + 50;
    total += net;
    if (net > 100) over++;
  }
  assert.equal(JSON.parse(out[0]).sNet, total);
  assert.equal(Number(JSON.parse(out[0]).Big), over);
});

test('read as the Data API reads it, a layout works out only the fields it uses', () => {
  const { lines, out } = traced(['Related'], true) as unknown as { lines: string[]; out: string[] };
  // The table's summary and ExecuteSQL calculation aren't on this layout, so nothing reads the whole table.
  assert.deepEqual(lines[0].split('\n').filter((l) => /summaries|executeSQL|storedRelatedValues/.test(l)), []);
  assert.deepEqual(Object.keys(JSON.parse(out[0])).sort(), ['Id', 'Prices::Price']);
});

test('calculations that depend only on the data are kept until it changes; the clock, globals and other files are not', () => {
  const store = new Store(path, 'Shop');
  try {
    const orders = store.schema.tables.find((t) => t.name === 'Orders')!;
    const f = (name: string) => orders.fields.find((x) => x.name === name)!;
    assert.equal(store.calc.stable(orders, f('Net')), true);
    assert.equal(store.calc.stable(orders, f('sNet')), true);
    assert.equal(store.calc.stable(orders, f('Big')), true);
    assert.equal(store.calc.stable(orders, f('Now')), false);
  } finally {
    store.close();
  }
});

test('ExecuteSQL queries that differ only in their parameters work out each record\'s calculation once', () => {
  // Order 1001 and order 1002 have different totals, so each runs its own query over Net.
  const { lines, out } = traced(['Over', 'Over'], true, [1001, 1002]) as unknown as { lines: string[]; out: string[] };
  const computed = (i: number) => lines[i].split('\n').filter((l) => /<- computeColumn/.test(l)).length;
  assert.ok(computed(0) >= 2000, `the first works out every record (${computed(0)})`);
  assert.equal(computed(1), 0, 'the second reuses them');
  let over = 0;
  for (let i = 1; i <= 2000; i++) if ((i % 97) * 2 + 50 > 1002 % 97) over++;
  assert.equal(Number(JSON.parse(out[1]).Over), over);
});

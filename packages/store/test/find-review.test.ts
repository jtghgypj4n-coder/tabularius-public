import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError, type FindRequest } from '../src/index.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-find-review-'));
  const path = join(dir, 'Find.sqlite');
  createStore(path);
  const store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [
      { name: 'Text', options: { indexLanguage: 'Japanese' } }, { name: 'Number', type: 'number' },
      { name: 'Visible', type: 'number' }, { name: 'Tags', options: { repetitions: 3 } },
    ] },
    { op: 'createField', table: 'Items', name: 'Calc', type: 'text', kind: 'calculation', calculation: 'Lower ( Text )', options: { unstored: true } },
    { op: 'createTable', name: 'Links', fields: [{ name: 'Item' }] },
    { op: 'createRelationship', left: 'Links', right: 'Items', predicates: [{ left: 'Item', right: 'Text' }] },
  ]);
  return { store, path };
}

for (const field of ['Text', 'Tags', 'Calc']) for (const related of [false, true]) {
  test(`duplicates exclude hidden records: ${related ? 'related ' : ''}${field}`, (t) => {
    const { store } = fixture(t);
    const visible = store.create('Items', { Text: 'secret-code', 'Tags(2)': 'secret-code', Visible: 1 }).recordId;
    const hidden = store.create('Items', { Text: 'secret-code', 'Tags(2)': 'secret-code', Visible: 0 }).recordId;
    const link = store.create('Links', { Item: 'secret-code' }).recordId;
    store.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false },
      tables: { Items: { view: 'Visible = 1', edit: false, create: false, delete: false } },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmapp'] });
    store.setPassword('Reader', 'pw', 'Reader');
    const privileges = store.privileges('Reader');
    const layout = related ? 'Links' : 'Items';
    const query = [{ [related ? `Items::${field}` : field]: '!' }];
    assert.equal(store.find(layout, { query, privileges }).foundCount, 0);
    assert.deepEqual(store.findIds(layout, { query, privileges }), []);
    assert.equal(store.find(layout, { query }).foundCount, related ? 1 : 2);
    store.update('Items', hidden, { Visible: 1 });
    assert.deepEqual(store.findIds(layout, { query, privileges }), related ? [link] : [visible, hidden]);
  });
}

test('pathological wildcards finish within two seconds without blocking the test runner', (t) => {
  const { store, path } = fixture(t);
  store.create('Items', { Text: 'a'.repeat(60) });
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { Store } from ${JSON.stringify(join(import.meta.dirname, '../src/index.ts'))};
    const store = new Store(${JSON.stringify(path)});
    const start = performance.now();
    assert.equal(store.find('Items', { query: [{ Text: 'a*'.repeat(20) + 'b#' }] }).foundCount, 0);
    assert.ok(performance.now() - start < 1000, 'matching must finish within one second');
    store.close();
  `], { encoding: 'utf8', timeout: 2000 });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
});

test('oversized criteria and matching work return FileMaker error 400', (t) => {
  const { store } = fixture(t);
  store.create('Items', { Text: 'a'.repeat(100000) });
  for (const Text of ['#'.repeat(100000), 'a*'.repeat(2000) + 'b#']) {
    for (const find of [() => store.find('Items', { query: [{ Text }] }), () => store.findIds('Items', { query: [{ Text }] })]) {
      assert.throws(find, (e: unknown) => e instanceof StoreError && e.code === 400);
    }
  }
});

test('calculated duplicates materialize once and use an indexed record lookup', (t) => {
  const { store } = fixture(t);
  store.sql.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000)
    INSERT INTO Items (_fm_record_id, Text) SELECT x, 'duplicate' FROM n`);
  const calc = t.mock.method(store.calc, 'unstoredValue');
  assert.equal(store.find('Items', { query: [{ Calc: '!' }], limit: 0 }).foundCount, 10000);
  assert.equal(calc.mock.callCount(), 10000, 'one calculation per source record');
  const plan = store.sql.prepare('EXPLAIN QUERY PLAN SELECT * FROM temp._fm_find WHERE _fm_record_id = ?').all(1);
  assert.match(JSON.stringify(plan), /SEARCH .* USING .*(INDEX|PRIMARY KEY)/);
  calc.mock.resetCalls();
  assert.equal(store.findIds('Items', { query: [{ Calc: '!' }] }).length, 10000);
  assert.equal(calc.mock.callCount(), 10000);
});

test('numeric wildcards match complete values, never decimal or signed fragments', (t) => {
  const { store } = fixture(t);
  const values = [3, 30, 30.3, -3, 3.3, 300];
  const ids = values.map((Number) => store.create('Items', { Number }).recordId);
  for (const [Number, expected] of [['#', [ids[0]]], ['##.#', [ids[2]]], ['-#', [ids[3]]], ['#.#', [ids[4]]]] as const) {
    assert.deepEqual(store.findIds('Items', { query: [{ Number }] }), expected);
  }
});

test('invalid numeric data means nonempty values containing no digits', (t) => {
  const { store } = fixture(t);
  const bad = store.create('Items', { Number: 'twelve' }).recordId;
  for (const Number of ['twelve30', 12, 0, '', '-3.5']) store.create('Items', { Number });
  store.create('Items', {});
  assert.deepEqual(store.findIds('Items', { query: [{ Number: '?' }] }), [bad]);
});

test('relaxed Japanese finds voiced kana inside words with and without word indexing', (t) => {
  const { store } = fixture(t);
  const ids = ['は', 'ハナ', 'おばさん'].map((Text) => store.create('Items', { Text }).recordId);
  for (const enabled of [true, false]) {
    store.words.enabled = enabled;
    assert.deepEqual(store.findIds('Items', { query: [{ Text: '~は' }] }), ids);
    assert.deepEqual(store.findIds('Items', { query: [{ Text: '~==は' }] }), [ids[0]]);
    assert.deepEqual(store.findIds('Items', { query: [{ Text: '~=は*' }] }), ids.slice(0, 2));
  }
});

test('find requests apply includes and omits in order, starting from all for an initial omit', (t) => {
  const { store } = fixture(t);
  const ids = ['dup', 'dup', 'solo'].map((Text) => store.create('Items', { Text }).recordId);
  for (const [query, expected] of [
    [[{ Text: '!', omit: 'true' }], [ids[2]]],
    [[{ Text: '!', omit: 'true' }, { Text: '*' }], ids],
    [[{ Text: '*' }, { Text: '!', omit: 'true' }], [ids[2]]],
    [[{ Text: '*' }, { Text: '!', omit: 'true' }, { Text: '!' }, { Text: 'solo', omit: 'true' }], ids.slice(0, 2)],
  ] as [FindRequest[], number[]][]) {
    assert.deepEqual(store.findIds('Items', { query }), expected);
    assert.deepEqual(store.find('Items', { query }).records.map((r) => r.recordId), expected);
  }
});

// Keep the slow baseline in a child: a matcher regression must not hang the suite.
test('matching work is shared across the whole find and finishes within eight seconds', (t) => {
  const { store, path } = fixture(t);
  store.create('Items', { Text: 'あ'.repeat(39000) });
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { Store, StoreError } from ${JSON.stringify(join(import.meta.dirname, '../src/index.ts'))};
    const store = new Store(${JSON.stringify(path)});
    const query = Array.from({ length: 100 }, (_, i) => ({ Text: '~' + 'あ'.repeat(98) + 'い' + i }));
    const start = performance.now();
    for (const find of [() => store.find('Items', { query }), () => store.findIds('Items', { query })]) {
      assert.throws(find, (e) => e instanceof StoreError && e.code === 400);
      // Exhaustion must not leak into the next find or a cached pattern.
      assert.equal(store.find('Items', { query: [{ Text: '~あ' }] }).foundCount, 1);
    }
    // The work limit is enforced by FileMaker error 400 above. This wall-time
    // ceiling catches a matcher regression while allowing loaded CI runners
    // time to schedule the child process.
    assert.ok(performance.now() - start < 8000, 'find work must finish within eight seconds');
    store.close();
  `], { encoding: 'utf8', timeout: 12000 });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
});

test('aggregate query complexity rejects 1000 short requests with FileMaker error 400', (t) => {
  const { store } = fixture(t);
  const id = store.create('Items', { Text: 'x' }).recordId;
  const query = Array.from({ length: 1000 }, () => ({ Text: '==x' }));
  for (const find of [() => store.find('Items', { query }), () => store.findIds('Items', { query })]) {
    assert.throws(find, (e: unknown) => e instanceof StoreError && e.code === 400);
  }
  assert.deepEqual(store.findIds('Items', { query: query.slice(0, 100) }), [id]);
});

test('malformed numeric range endpoints return FileMaker find validation error 508', (t) => {
  const { store } = fixture(t);
  const id = store.create('Items', { Number: 30.3 }).recordId;
  for (const Number of ['1...2...3', '1…2…3', '1...bad', 'bad...40', '...2...3', '1...Infinity', '1... NaN ']) {
    const query = [{ Number }];
    for (const find of [() => store.find('Items', { query }), () => store.findIds('Items', { query })]) {
      assert.throws(find, (e: unknown) => e instanceof StoreError && e.code === 508, Number);
    }
  }
  for (const Number of ['1...40', '...40', '1...', '1…40', '1...1,000']) {
    assert.deepEqual(store.findIds('Items', { query: [{ Number }] }), [id], Number);
  }
});

for (const scope of ['records', 'criteria', 'repetitions', 'related fields', 'count and page'] as const) {
  test(`matching work is shared across ${scope}`, (t) => {
    const { store } = fixture(t);
    const Text = 'あ'.repeat(38000) + 'い';
    const pattern = '~*' + 'あ'.repeat(98) + 'い';
    const id = store.create('Items', { Text, 'Tags(1)': Text, 'Tags(2)': Text }).recordId;
    store.create('Links', { Item: Text });
    if (scope === 'records') store.create('Items', { Text });
    // A successful near-end match spends just under one budget by itself.
    const query: FindRequest[] = scope === 'criteria' ? [{ Text: pattern, Calc: pattern }]
      : scope === 'repetitions' ? [{ Tags: pattern + 'x' }]
      : scope === 'related fields' ? [{ 'Items::Text': pattern }, { 'Items::Calc': pattern }]
      : [{ Text: pattern }];
    const layout = scope === 'related fields' ? 'Links' : 'Items';
    if (scope !== 'count and page') {
      assert.throws(() => store.findIds(layout, { query }), (e: unknown) => e instanceof StoreError && e.code === 400);
    } else assert.deepEqual(store.findIds(layout, { query }), [id]);
    assert.throws(() => store.find(layout, { query }), (e: unknown) => e instanceof StoreError && e.code === 400);
  });
}

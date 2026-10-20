import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

type Row = { id: number; group: string; sub: string; amount: number | null; note: string };
const types = ['total', 'average', 'count', 'minimum', 'maximum', 'stdDev', 'stdDevP', 'fractionOfTotal'] as const;
const summaryName = (type: string) => `s${type}`;

function setup(t: TestContext): Store {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-summary-model-'));
  const path = join(dir, 'Report.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Report');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'R', fields: [{ name: 'Group' }, { name: 'Sub' }, { name: 'Amount', type: 'number' }, { name: 'Note' }, { name: 'gBreak', options: { global: true } }] },
    ...types.map((type) => ({ op: 'createField' as const, table: 'R', name: summaryName(type), kind: 'summary' as const, summary: { type, field: 'Amount' } })),
    { op: 'createField', table: 'R', name: 'sList', kind: 'summary', summary: { type: 'list', field: 'Note' } },
    { op: 'createField', table: 'R', name: 'CalculatedGroup', kind: 'calculation', type: 'text', calculation: 'Left ( Group ; 1 )', options: { unstored: true } },
    { op: 'createField', table: 'R', name: 'TwiceTotal', kind: 'calculation', type: 'number', calculation: 'stotal * 2', options: { unstored: true } },
  ] as never);
  return store;
}

function model(rows: Row[], own?: Row) {
  const numbers = rows.flatMap((r) => r.amount === null ? [] : [r.amount]);
  const total = numbers.reduce((n, v) => n + v, 0);
  const mean = numbers.length ? total / numbers.length : 0;
  const sq = numbers.reduce((n, v) => n + (v - mean) ** 2, 0);
  const values: Record<string, string | number> = {
    stotal: total, saverage: numbers.length ? mean : '', scount: numbers.length,
    sminimum: numbers.length ? Math.min(...numbers) : '', smaximum: numbers.length ? Math.max(...numbers) : '',
    sstdDev: numbers.length > 1 ? Math.sqrt(sq / (numbers.length - 1)) : numbers.length ? 0 : '',
    sstdDevP: numbers.length ? Math.sqrt(sq / numbers.length) : '',
    sfractionOfTotal: own?.amount !== null && own?.amount !== undefined && total !== 0 ? own.amount / total : '',
    sList: rows.map((r) => r.note).filter(Boolean).join('\n'),
  };
  return values;
}

function close(actual: string | number, expected: string | number, label: string) {
  if (typeof actual === 'number' && typeof expected === 'number') assert.ok(Math.abs(actual - expected) < 1e-10, `${label}: ${actual} != ${expected}`);
  else assert.equal(actual, expected, label);
}

function check(store: Store, rows: Row[], chosen: Row[], label: string) {
  const ids = chosen.map((r) => r.id);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = store.getMany('R', ids, ids);
  assert.equal(seen.length, ids.length, label);
  for (const rec of seen) {
    const id = Number(rec.recordId);
    const expected = model(chosen, byId.get(id));
    for (const [field, value] of Object.entries(expected)) close(rec.fieldData[field], value, `${label}: record ${id} ${field}`);
    close(rec.fieldData.TwiceTotal, Number(expected.stotal) * 2, `${label}: calculation over summary`);
  }
  const groups = store.groupSummaries('R', ids, ['Group', 'Sub']);
  for (const [level, runs] of groups.entries()) {
    let at = 0;
    for (const run of runs) {
      assert.equal(run.start, at, `${label}: level ${level} starts`);
      const members = chosen.slice(at, at + run.count);
      const prefix = (r: Row) => [r.group, r.sub].slice(0, level + 1).join('\0');
      assert.ok(members.every((r) => prefix(r) === prefix(members[0])), `${label}: same break values`);
      const expected = model(members);
      for (const field of [...types.map(summaryName), 'sList']) {
        // A fraction shown in a sub-summary needs a subtotal option, which the schema does not yet represent.
        if (field === 'sfractionOfTotal') continue;
        close(run.values[field], expected[field], `${label}: level ${level} ${field}`);
      }
      at += run.count;
    }
    assert.equal(at, chosen.length, `${label}: level ${level} covers found set`);
  }
}

function rng(seed: number) {
  let n = seed >>> 0;
  return () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

test('seeded summary model follows finds, omitted records, sorts and edits', (t) => {
  const store = setup(t);
  const rows: Row[] = [];
  for (let seed = 1; seed <= 8; seed++) {
    const random = rng(seed);
    for (let i = 0; i < 6; i++) {
      const group = random() < .5 ? 'A' : 'B';
      const sub = random() < .5 ? '1' : '2';
      const amount = random() < .25 ? null : Math.floor(random() * 19) - 9;
      const note = random() < .25 ? '' : `${seed}:${i}`;
      const id = Number(store.create('R', { Group: group, Sub: sub, Amount: amount === null ? '' : amount, Note: note }).recordId);
      rows.push({ id, group, sub, amount, note });
    }
    const seedRows = rows.slice(-6);
    const sort = [
      { fieldName: 'Group', sortOrder: random() < .5 ? 'ascend' : 'descend' },
      { fieldName: 'Sub', sortOrder: random() < .5 ? 'ascend' : 'descend' },
    ] as { fieldName: string; sortOrder: 'ascend' | 'descend' }[];
    const sorted = store.sortIds('R', seedRows.map((r) => r.id), sort);
    const found = sorted.map((id) => rows.find((r) => r.id === id)!);
    check(store, rows, found, `seed ${seed} full`);
    const reversed = store.sortIds('R', seedRows.map((r) => r.id), sort.map((s) => ({ ...s, sortOrder: s.sortOrder === 'ascend' ? 'descend' as const : 'ascend' as const })));
    check(store, rows, reversed.map((id) => rows.find((r) => r.id === id)!), `seed ${seed} changed sort`);
    const page = store.find('R', { query: [{ Group: '==A' }], sort, limit: 10 });
    const expectedPage = rows.filter((r) => r.group === 'A');
    const pageIds = expectedPage.length ? store.sortIds('R', expectedPage.map((r) => r.id), sort) : [];
    assert.deepEqual(page.records.map((r) => Number(r.recordId)), pageIds.slice(0, 10));
    if (page.records.length) {
      const pageRows = pageIds.map((id) => rows.find((r) => r.id === id)!);
      assert.equal(page.records[0].fieldData.sList, pageRows.map((r) => r.note).filter(Boolean).join('\n'));
      close(page.records[0].fieldData.TwiceTotal, Number(model(pageRows).stotal) * 2, `seed ${seed}: found-set calculation`);
    }
    const omit = Math.floor(random() * 3);
    check(store, rows, found.filter((_, i) => i % 3 !== omit), `seed ${seed} omitted`);
    check(store, rows, found.filter((r) => r.group === 'A'), `seed ${seed} found group`);
    const edited = seedRows[0];
    const newAmount = Math.floor(random() * 27) - 13;
    const newGroup = random() < .5 ? 'A' : 'B';
    store.update('R', edited.id, { Amount: newAmount, Group: newGroup });
    edited.amount = newAmount;
    edited.group = newGroup;
    const again = store.sortIds('R', seedRows.map((r) => r.id), sort);
    check(store, rows, again.map((id) => rows.find((r) => r.id === id)!), `seed ${seed} edited`);
  }
  check(store, rows, [], 'empty');
  check(store, rows, [rows[0]], 'one record');
});

test('each found-set fraction equals its record amount divided by that found-set total', (t) => {
  const store = setup(t);
  const two = Number(store.create('R', { Amount: 2 }).recordId);
  const three = Number(store.create('R', { Amount: 3 }).recordId);
  const seven = Number(store.create('R', { Amount: 7 }).recordId);
  const empty = Number(store.create('R', { Amount: '' }).recordId);
  const read = (ids: number[]) => store.getMany('R', ids, ids).map((record) => record.fieldData.sfractionOfTotal);

  assert.deepEqual(read([two, three, seven, empty]), [2 / 12, 3 / 12, 7 / 12, '']);
  assert.deepEqual(read([three, seven, empty]), [3 / 10, 7 / 10, ''], 'omitting a record changes the denominator');
  store.update('R', seven, { Amount: -3 });
  assert.deepEqual(read([two, three, seven]), [1, 1.5, -1.5], 'an edit changes each fraction');
  assert.deepEqual(read([three, seven, empty]), ['', '', ''], 'a zero found-set total gives an empty fraction');
});

test('sub-summary break values come from calculated and global fields', (t) => {
  const store = setup(t);
  const ids = [
    store.create('R', { Group: 'A-one', Amount: 2 }).recordId,
    store.create('R', { Group: 'A-two', Amount: 3 }).recordId,
    store.create('R', { Group: 'B-one', Amount: 7 }).recordId,
  ].map(Number);
  assert.deepEqual(store.groupSummaries('R', ids, ['CalculatedGroup'])[0].map((r) => [r.count, r.values.stotal]), [[2, 5], [1, 7]]);
  store.setGlobalField('R::gBreak', 'shared');
  assert.deepEqual(store.groupSummaries('R', ids, ['gBreak'])[0].map((r) => [r.count, r.values.stotal]), [[3, 12]]);
  store.setGlobalField('R::gBreak', 'changed');
  assert.deepEqual(store.groupSummaries('R', ids, ['gBreak'])[0].map((r) => [r.count, r.values.stotal]), [[3, 12]]);
});

test('a related summary recomputes over the matching records after an edit', (t) => {
  const store = setup(t);
  store.applyDesign([
    { op: 'createTable', name: 'Parent', fields: [{ name: 'Key' }] },
    { op: 'createField', table: 'R', name: 'ParentKey' },
    { op: 'createRelationship', left: 'Parent', right: 'R', predicates: [{ left: 'Key', right: 'ParentKey' }] },
  ] as never);
  const parent = store.create('Parent', { Key: 'one' }).recordId;
  store.create('R', { ParentKey: 'one', Amount: 2 });
  const changed = store.create('R', { ParentKey: 'one', Amount: 3 }).recordId;
  store.create('R', { ParentKey: 'other', Amount: 17 });
  assert.equal(store.evaluate('Parent', 'R::stotal', parent).value, '5');
  store.update('R', changed, { Amount: 11 });
  assert.equal(store.evaluate('Parent', 'R::stotal', parent).value, '13');
});

test('sub-summary groups canonically equivalent Unicode break values', (t) => {
  const store = setup(t);
  const ids = [
    store.create('R', { Group: 'École', Amount: 2 }).recordId,
    store.create('R', { Group: 'e\u0301cole', Amount: 3 }).recordId,
    store.create('R', { Group: 'école', Amount: 5 }).recordId,
    store.create('R', { Group: 'ecole', Amount: 7 }).recordId,
  ].map(Number);
  const sorted = store.sortIds('R', ids, [{ fieldName: 'Group', sortOrder: 'ascend' }]);
  const runs = store.groupSummaries('R', sorted, ['Group'])[0];
  assert.deepEqual(runs.map((r) => [r.count, r.values.stotal]), [[3, 10], [1, 7]]);
});

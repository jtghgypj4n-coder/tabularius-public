// Masking by privilege: a masked field shows an account only a stand-in (its last four characters, or a fixed
// text), and the real value never reaches it by any other route: find, sort, summaries, calculations, writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, maskValue } from '../src/index.ts';
import { Privileges, validateDefinition, type PrivilegeDefinition } from '../src/privileges.ts';

const SSN = '123-45-6789';
const base = (over: Record<string, unknown> = {}) => ({
  name: 'Clerk', records: { view: true, edit: true, create: true, delete: false },
  tables: {
    People: {
      view: true, edit: true, create: true, delete: false,
      fields: { SSN: 'masked', Card: 'masked', Born: 'masked', Salary: 'masked' },
      masks: { Card: { kind: 'placeholder', text: 'on file' } },
      ...over,
    },
  },
  layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmapp', 'fmrest'],
});

function people(fn: (store: Store, p: Privileges, id: number) => void, set: Record<string, unknown> = base()): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-masking-'));
  const path = join(dir, 'People.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'People');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'People', fields: [
        { name: 'Name', type: 'text' }, { name: 'SSN', type: 'text' }, { name: 'Card', type: 'text' },
        { name: 'Born', type: 'date' }, { name: 'Salary', type: 'number' },
      ] },
      { op: 'createField', table: 'People', name: 'SsnStart', type: 'text', kind: 'calculation', calculation: 'Left ( SSN ; 3 )', options: { unstored: true } },
      { op: 'createField', table: 'People', name: 'sPay', kind: 'summary', summary: { type: 'total', field: 'Salary' } },
    ] as never);
    store.create('People', { Name: 'Ada', SSN, Card: '4111111111111111', Born: '3/4/1990', Salary: '85000' });
    store.savePrivilegeSet(set as never);
    store.setPassword('clerk', 'pw', 'Clerk');
    const id = Number(store.find('People', { limit: 1 }).records[0].recordId);
    fn(store, store.privileges('clerk'), id);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('last4 keeps the last four letters or digits and the punctuation, and never shows more than half of a short value', () => {
  assert.equal(maskValue('123-45-6789'), '•••-••-6789');
  assert.equal(maskValue('4111 1111 1111 1111'), '•••• •••• •••• 1111');
  assert.equal(maskValue('1234'), '••34', 'a 4-digit code is not shown whole');
  assert.equal(maskValue('ab'), '•b');
  assert.equal(maskValue('a'), '•');
  assert.equal(maskValue(''), '', 'masking hides a value, not that there is one');
  assert.equal(maskValue(null), '');
  assert.equal(maskValue(85000), '•••00');
  assert.equal(maskValue('123456789', { kind: 'last4', text: '*' }), '*****6789');
});

test('a placeholder mask shows its text whatever the value, and a long text is refused', () => {
  assert.equal(maskValue('anything', { kind: 'placeholder' }), '••••');
  assert.equal(maskValue('anything', { kind: 'placeholder', text: 'on file' }), 'on file');
  assert.equal(maskValue('', { kind: 'placeholder', text: 'on file' }), '');
  assert.throws(() => validateDefinition({ ...base().tables.People, name: 'x' }), /records|layouts|must/);
  const bad = base({ masks: { SSN: { kind: 'placeholder', text: 'x'.repeat(40) } } });
  assert.throws(() => validateDefinition(bad), /at most 16 characters/);
  const orphan = base({ masks: { Name: { kind: 'last4' } } });
  assert.throws(() => validateDefinition(orphan), /not masked/);
  assert.throws(() => validateDefinition(base({ masks: { SSN: { kind: 'blur' } } })), /last4 or placeholder/);
  assert.doesNotThrow(() => validateDefinition(base()));
});

test('field() hides a masked field from every surface that is not taught about masking; fieldAccess tells them apart', () => people((_store, p) => {
  assert.equal(p.field('People', 'SSN'), 'none');
  assert.equal(p.fieldAccess('People', 'SSN'), 'masked');
  assert.equal(p.fieldAccess('People', 'Name'), 'modifiable');
  assert.deepEqual(p.mask('People', 'SSN'), { kind: 'last4' });
  assert.deepEqual(p.mask('People', 'Card'), { kind: 'placeholder', text: 'on file' });
  assert.equal(p.mask('People', 'Name'), undefined);
  assert.equal(p.readsEverything, false, 'raw SQL and free-form formulas could reveal the real value');
  const full = new Privileges('x', validateDefinition({ name: '[Full Access]', id: 1, extendedPrivileges: [] }) as PrivilegeDefinition, null, () => p);
  assert.equal(full.fieldAccess('People', 'SSN'), 'modifiable');
}));

test('a record read shows the stand-in, never the value', () => people((store, p) => {
  const read = store.find('People', { limit: 1, privileges: p } as never);
  const d = read.records[0].fieldData;
  assert.equal(d.Name, 'Ada');
  assert.equal(d.SSN, '•••-••-6789');
  assert.equal(d.Card, 'on file');
  assert.equal(d.Born, '••••', 'a date is not partly shown');
  assert.equal(d.Salary, '•••00');
  const all = JSON.stringify(read);
  for (const real of [SSN, '4111111111111111', '1990', '85000', '45-6789']) assert.ok(!all.includes(real), `${real} leaked`);
  const one = JSON.stringify(store.get('People', Number(read.records[0].recordId), 'us', undefined, p));
  assert.ok(!one.includes('45-6789') && one.includes('6789'));
}));

test('Full Access still reads the real value', () => people((store) => {
  const d = store.find('People', { limit: 1 }).records[0].fieldData;
  assert.equal(d.SSN, SSN);
}));

test('a masked field cannot be found, sorted or totalled by', () => people((store, p) => {
  for (const q of ['6789', '123-45-6789', '=123-45-6789', '*']) {
    assert.throws(() => store.find('People', { query: [{ SSN: q }], privileges: p } as never), /Field "SSN" is missing/, q);
  }
  assert.throws(() => store.find('People', { sort: [{ fieldName: 'SSN' }], privileges: p } as never), /Field "SSN" is missing/);
  assert.throws(() => store.find('People', { query: [{ Card: '4111*' }], privileges: p } as never), /missing/);
  assert.equal(store.find('People', { query: [{ Name: 'Ada' }], privileges: p } as never).records.length, 1);
}));

test('a summary of a masked field gives the account nothing', () => people((store, p) => {
  const d = store.find('People', { limit: 1, privileges: p } as never).records[0].fieldData;
  assert.ok(!JSON.stringify(d).includes('85000'), 'a total of a masked field is its value');
  assert.ok(!d.sPay, `sPay was ${JSON.stringify(d.sPay)}`);
}));

test('a masked field is never writable, and the stand-in is not written back', () => people((store, p, id) => {
  assert.throws(() => store.update('People', id, { SSN: '•••-••-6789' }, undefined, { privileges: p } as never), /cannot be modified/);
  assert.throws(() => store.update('People', id, { SSN: '999-99-9999' }, undefined, { privileges: p } as never), /cannot be modified/);
  assert.throws(() => store.create('People', { Name: 'Bob', SSN: '111-11-1111' }, { privileges: p } as never), /cannot be modified/);
  store.update('People', id, { Name: 'Ada L' }, undefined, { privileges: p } as never);
  const real = store.find('People', { limit: 1 }).records[0].fieldData;
  assert.equal(real.Name, 'Ada L');
  assert.equal(real.SSN, SSN, 'the real value is untouched by an edit that did not name it');
}));

test('a view-only or hidden field is not turned into a mask, and a table without masks is unchanged', () => people((store, p) => {
  const plain = base({ fields: { SSN: 'none' }, masks: undefined });
  store.savePrivilegeSet(plain as never);
  const d = store.find('People', { limit: 1, privileges: store.privileges('clerk') } as never).records[0].fieldData;
  assert.ok(!('SSN' in d), 'hidden stays hidden');
  assert.equal(p.fieldAccess('People', 'Name'), 'modifiable');
}));

test('a formula reads a masked field of its own record as empty, and a grouped summary gives nothing', () => people((store, p, id) => {
  assert.equal(store.evaluate('People', 'Left ( SSN ; 3 )', id, { account: 'clerk', privileges: p }).value, '');
  assert.equal(store.evaluate('People', 'Name', id, { account: 'clerk', privileges: p }).value, 'Ada');
  const d = store.find('People', { limit: 1, privileges: p } as never).records[0].fieldData;
  assert.ok(!d.SsnStart, `a calculation over a masked field was ${JSON.stringify(d.SsnStart)}`);
  const groups = store.groupSummaries('People', [id], ['Name'], 'us', p);
  assert.ok(!JSON.stringify(groups).includes('85000'), 'a grouped total of a masked field is its value');
  const real = store.groupSummaries('People', [id], ['Name']);
  assert.ok(JSON.stringify(real).includes('85000'), 'Full Access still gets it');
}));

test('marks, symbols and underscores are hidden like letters; only separators stay', () => {
  assert.equal(maskValue('a_b-c'), '\u2022\u2022b-c');
  assert.equal(maskValue('x\u00a9y\u00a9z\u00a9w\u00a9v'), '\u2022\u2022\u2022\u2022\u2022\u00a9w\u00a9v', 'a symbol counts as a character');
  assert.equal(maskValue('e\u0301e\u0301e\u0301e\u0301e\u0301e\u0301').slice(0, 4), '\u2022\u2022\u2022\u2022', 'a combining mark of a hidden letter is hidden with it');
});

// Regression coverage derived from the PR #1204 review probe.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

function setup(t: TestContext, access: 'none' | 'masked' | 'viewOnly', share = false) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-summary-privileges-'));
  const path = join(dir, 'Scratch.sqlite');
  createStore(path);
  const store = new Store(path);
  if (share) store.shareResults();
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'Public' }, { name: 'Secret' }, { name: 'Amount', type: 'number' }] },
    { op: 'createField', table: 'T', name: 'UCalc', type: 'text', kind: 'calculation', calculation: 'Secret & Public', options: { unstored: true } },
    { op: 'createField', table: 'T', name: 'SumU', kind: 'summary', summary: { type: 'list', field: 'UCalc' } },
    { op: 'createField', table: 'T', name: 'SumS', kind: 'summary', summary: { type: 'list', field: 'Secret' } },
    { op: 'createField', table: 'T', name: 'SumP', kind: 'summary', summary: { type: 'list', field: 'Public' } },
    { op: 'createField', table: 'T', name: 'CountS', kind: 'summary', summary: { type: 'count', field: 'Secret' } },
    { op: 'createField', table: 'T', name: 'Fraction', kind: 'summary', summary: { type: 'fractionOfTotal', field: 'Amount' } },
    { op: 'createField', table: 'T', name: 'Leak1', type: 'text', kind: 'calculation', calculation: 'SumS', options: { unstored: true } },
    { op: 'createField', table: 'T', name: 'Leak2', type: 'text', kind: 'calculation', calculation: 'GetSummary ( SumS ; Public )', options: { unstored: true } },
  ]);
  const a = Number(store.create('T', { Public: '|a', Secret: 'TOPSECRETZ', Amount: '25' }).recordId);
  const b = Number(store.create('T', { Public: '|b', Secret: 'TOPSECRETA', Amount: '75' }).recordId);
  store.savePrivilegeSet({
    name: 'Reader', records: { view: true, edit: false, create: false, delete: false, fields: { Secret: access, Amount: access } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: [],
  });
  store.setPassword('reader', 'pw', 'Reader');
  store.setPassword('Admin', 'pw', '[Full Access]');
  return { store, path, a, b, reader: store.privileges('reader'), admin: store.privileges('Admin') };
}

for (const access of ['none', 'masked', 'viewOnly'] as const) {
  test(`${access}: record and found-set summaries respect source field access`, (t) => {
    const { store, a, b, reader, admin } = setup(t, access);
    const visible = access === 'viewOnly';
    for (const privileges of [admin, reader]) {
      const allowed = privileges === admin || visible;
      const row = store.get('T', a, 'us', undefined, privileges).fieldData;
      assert.equal(row.SumS, allowed ? 'TOPSECRETZ\nTOPSECRETA' : '');
      assert.equal(row.CountS, allowed ? 2 : 0);
      assert.equal(row.SumU, allowed ? 'TOPSECRETZ|a\nTOPSECRETA|b' : '|a\n|b');
      assert.equal(row.SumP, '|a\n|b');
      const found = store.find('T', { privileges, query: [{ Public: '|a' }] });
      assert.equal(found.records.length, 1);
      assert.equal(found.records[0].fieldData.SumS, allowed ? 'TOPSECRETZ' : '');
      assert.equal(found.records[0].fieldData.CountS, allowed ? 1 : 0);
      const groups = store.groupSummaries('T', [a, b], ['Public'], 'us', privileges)[0];
      assert.deepEqual(groups.map((g) => g.values.SumS), allowed ? ['TOPSECRETZ', 'TOPSECRETA'] : ['', '']);
    }
  });

  test(`${access}: formulas and GetSummary read hidden summary inputs as empty`, (t) => {
    const { store, a, reader, admin } = setup(t, access);
    const formulas = ['SumS', 'GetSummary ( SumS ; Public )', 'GetSummary ( SumS ; SumS )', 'Leak1', 'Leak2',
      'CountS', 'Fraction', 'GetSummary ( Fraction ; Public )', 'SumP'];
    const full = ['TOPSECRETZ\rTOPSECRETA', '', 'TOPSECRETZ\rTOPSECRETA', 'TOPSECRETZ\rTOPSECRETA', '',
      '2', '0.25', '', '|a\r|b'];
    const hidden = ['', '', '', '', '', '0', '', '', '|a\r|b'];
    for (const [i, formula] of formulas.entries()) {
      assert.equal(store.evaluate('T', formula, a, { privileges: admin }).value, full[i], `Admin: ${formula}`);
      assert.equal(store.evaluate('T', formula, a, { privileges: reader }).value, access === 'viewOnly' ? full[i] : hidden[i], `Reader: ${formula}`);
    }
  });

  test(`${access}: an unstored calculation over a summary cannot act as a find oracle`, (t) => {
    const { store, a, reader, admin } = setup(t, access);
    for (const privileges of [admin, reader]) {
      const allowed = privileges === admin || access === 'viewOnly';
      const row = store.get('T', a, 'us', undefined, privileges).fieldData;
      assert.equal(row.Leak1, allowed ? 'TOPSECRETZ\nTOPSECRETA' : '');
      assert.equal(row.Leak2, '');
      for (const field of ['Leak1', 'Leak2']) {
        const found = store.find('T', { privileges, query: [{ [field]: 'TOPSECRETZ' }] });
        assert.equal(found.records.length, allowed && field === 'Leak1' ? 2 : 0, field);
      }
    }
  });
}

for (const access of ['none', 'masked'] as const) {
  for (const shared of [false, true]) {
    for (const first of ['Admin', 'reader'] as const) {
      test(`${access}: ${shared ? 'shared' : 'local'} summaries stay scoped with ${first} first`, (t) => {
        const { store, path, a } = setup(t, access, shared);
        const read = (s: Store, account: 'Admin' | 'reader') => {
          const privileges = s.privileges(account);
          const allowed = account === 'Admin';
          const expected = allowed ? 'TOPSECRETZ\rTOPSECRETA' : '';
          assert.equal(s.evaluate('T', 'SumS', a, { privileges }).value, expected);
          assert.equal(s.evaluate('T', 'Leak1', a, { privileges }).value, expected);
          assert.equal(s.evaluate('T', 'Leak2', a, { privileges }).value, '');
          assert.equal(s.get('T', a, 'us', undefined, privileges).fieldData.SumS, expected.replaceAll('\r', '\n'));
          const found = s.find('T', { privileges, query: [{ Public: '|a' }] }).records[0].fieldData;
          assert.equal(found.SumS, allowed ? 'TOPSECRETZ' : '');
          assert.equal(found.CountS, allowed ? 1 : 0);
          assert.equal(s.find('T', { privileges, query: [{ Leak2: 'TOPSECRETZ' }] }).records.length, 0);
        };
        const second = first === 'Admin' ? 'reader' : 'Admin';
        read(store, first);
        // A fresh connection can only reuse the persisted shared result.
        const other = shared ? new Store(path) : store;
        try {
          if (shared) other.shareResults();
          read(other, second);
          read(other, first);
          read(store, second);
          read(store, first);
        } finally {
          if (shared) other.close();
        }
      });
    }
  }
}

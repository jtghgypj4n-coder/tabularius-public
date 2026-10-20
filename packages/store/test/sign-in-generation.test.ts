import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

function open() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-signin-gen-'));
  createStore(join(dir, 'F.fmstore'));
  const store = new Store(join(dir, 'F.fmstore'), 'F');
  for (const name of ['Reader', 'Writer']) {
    store.savePrivilegeSet({ name, records: { view: true, edit: name === 'Writer', create: false, delete: false }, layouts: 'viewOnly', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'] } as never);
  }
  store.setPassword('amy', 'generated-sign-in-password', 'Reader');
  return { store, close: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('authority changed and changed back is a different sign-in, even when nothing asked in between', () => {
  const { store, close } = open();
  try {
    const before = store.signInMark('amy');
    assert.equal(store.signInMark('amy'), before, 'unchanged authority keeps the mark');
    store.setAccountPrivilegeSet('amy', 'Writer');
    store.setAccountPrivilegeSet('amy', 'Reader');
    assert.notEqual(store.signInMark('amy'), before);
    const again = store.signInMark('amy');
    assert.equal(store.signInMark('amy'), again, 'and then stays put');
  } finally { close(); }
});

test('editing an assigned set and editing it back is a different sign-in too', () => {
  const { store, close } = open();
  try {
    const before = store.signInMark('amy');
    const set = store.privilegeSet('Reader')!;
    store.savePrivilegeSet({ ...set, exporting: set.exporting === false });
    store.savePrivilegeSet(set);
    assert.notEqual(store.signInMark('amy'), before);
  } finally { close(); }
});

test('assigning the privilege set an account already has changes nothing about the sign-in', () => {
  const { store, close } = open();
  try {
    const before = store.signInMark('amy');
    store.setAccountPrivilegeSet('amy', 'Reader');
    assert.equal(store.signInMark('amy'), before, 'assigning the set it already has changes no one\'s authority');
  } finally { close(); }
});

test('a security change that rolls back leaves nothing that skips a later one', () => {
  const { store, close } = open();
  try {
    const before = store.signInMark('amy');
    assert.throws(() => store.applySecurity([
      { op: 'setAccount', name: 'amy', privilegeSet: 'Writer' },
      { op: 'setAccount', name: 'nonexistent-account', privilegeSet: 'Reader' },
    ] as never));
    assert.equal(store.signInMark('amy'), before, 'a failed batch changes nothing');
    store.setAccountPrivilegeSet('amy', 'Writer');
    store.setAccountPrivilegeSet('amy', 'Reader');
    assert.notEqual(store.signInMark('amy'), before, 'the round trip after it still counts');
  } finally { close(); }
});

test('two connections never leave an older generation over a newer one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-signin-gen-'));
  createStore(join(dir, 'F.fmstore'));
  const one = new Store(join(dir, 'F.fmstore'), 'F');
  const two = new Store(join(dir, 'F.fmstore'), 'F');
  try {
    for (const name of ['Reader', 'Writer']) {
      one.savePrivilegeSet({ name, records: { view: true, edit: name === 'Writer', create: false, delete: false }, layouts: 'viewOnly', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest'] } as never);
    }
    one.setPassword('amy', 'generated-sign-in-password', 'Reader');
    const first = one.signInMark('amy');
    two.setAccountPrivilegeSet('amy', 'Writer');
    const writer = one.signInMark('amy');
    assert.notEqual(writer, first);
    assert.equal(two.signInMark('amy'), writer, 'the other connection sees the same generation');
    one.setAccountPrivilegeSet('amy', 'Reader');
    const generation = (mark: string) => Number(mark.split(':')[0]);
    assert.ok(generation(two.signInMark('amy')) > generation(writer));
    assert.ok(generation(one.signInMark('amy')) >= generation(two.signInMark('amy')));
    assert.notEqual(one.signInMark('amy'), first, 'back to the first authority is a later generation');
  } finally { one.close(); two.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a ledger that cannot be written fails closed: nothing issued matches, and a security change refuses', () => {
  const { store, close } = open();
  try {
    store.signInMark('amy');
    store.sql.exec('DROP TABLE _fm_sign_in_ledger');
    store.sql.exec('CREATE VIEW _fm_sign_in_ledger AS SELECT 1 AS key, 1 AS mark, 1 AS gen');
    const issued = store.signInMark('amy');
    assert.notEqual(store.signInMark('amy'), issued, 'a mark that could not be recorded matches nothing');
    assert.throws(() => store.setAccountPrivilegeSet('amy', 'Writer'));
    assert.equal(store.accountPrivilegeSet('amy'), 'Reader');
  } finally { close(); }
});

test('a generation the ledger cannot count from fails closed instead of starting over', () => {
  for (const seeded of ['9007199254740992', '9223372036854775807', '1e300', '-5', '1.5']) {
    for (const row of ['account', 'floor']) {
      const { store, close } = open();
      try {
        store.setAccountPrivilegeSet('amy', 'Writer'); // a settlement, so the version row exists
        store.setAccountPrivilegeSet('amy', 'Reader');
        const issued = store.signInMark('amy');
        store.sql.exec(`UPDATE _fm_sign_in_ledger SET gen = ${seeded} WHERE key ${row === 'account' ? "!= ''" : "= ''"}`);
        if (row === 'account') {
          const after = store.signInMark('amy');
          assert.notEqual(after, issued, `${seeded}: the earlier mark must not match`);
          assert.match(after, /^unrecorded:/, `${seeded}: an unreadable generation is not "new"`);
        }
        assert.throws(() => store.setAccountPrivilegeSet('amy', 'Writer'), new RegExp('.'), `${row} ${seeded}: a security change refuses`);
        assert.equal(store.accountPrivilegeSet('amy'), 'Reader');
      } finally { close(); }
    }
  }
});

test('only an absent ledger counts as nothing recorded: a read that fails, even with "no such table" in the error, fails closed', () => {
  const { store, close } = open();
  try {
    store.setAccountPrivilegeSet('amy', 'Writer');
    store.setAccountPrivilegeSet('amy', 'Reader');
    const issued = store.signInMark('amy');
    // A read of the ledger that errors (a busy or damaged file) with the same words as a missing table.
    const prepare = store.sql.prepare.bind(store.sql);
    (store.sql as { prepare: unknown }).prepare = (text: string) => {
      if (/FROM main\._fm_sign_in_ledger WHERE key = \?/.test(text)) throw new Error('database is busy: no such table: _fm_sign_in_ledger');
      return prepare(text);
    };
    const after = store.signInMark('amy');
    assert.match(after, /^unrecorded:/, 'not generation 1 of a fresh ledger');
    assert.notEqual(after, issued);
    assert.throws(() => store.setAccountPrivilegeSet('amy', 'Writer'));
    delete (store.sql as { prepare?: unknown }).prepare;
    assert.equal(store.accountPrivilegeSet('amy'), 'Reader');
  } finally { close(); }
});

test('the ledger keeps its generations when the table is renamed by case only, and a temporary table cannot stand in for it', () => {
  const { store, close } = open();
  try {
    store.signInMark('amy');
    store.setAccountPrivilegeSet('amy', 'Writer');
    store.setAccountPrivilegeSet('amy', 'Reader');
    const issued = store.signInMark('amy');
    const generation = (mark: string) => Number(mark.split(':')[0]);
    assert.ok(generation(issued) >= 3);
    store.sql.exec('ALTER TABLE _fm_sign_in_ledger RENAME TO _fm_ledger_aside');
    store.sql.exec('ALTER TABLE _fm_ledger_aside RENAME TO _FM_Sign_In_Ledger');
    assert.equal(store.signInMark('amy'), issued, 'the same ledger under another case is still the ledger');
    store.sql.exec('CREATE TEMP TABLE _fm_sign_in_ledger (key TEXT PRIMARY KEY, mark TEXT NOT NULL, gen INTEGER NOT NULL)');
    assert.equal(store.signInMark('amy'), issued, 'a temporary table of the same name is not consulted');
  } finally { close(); }
});

test('the ledger forgets sign-ins whose accounts are gone', () => {
  const { store, close } = open();
  try {
    store.setPassword('bob', 'generated-sign-in-password-2', 'Reader');
    store.signInMark('amy');
    store.signInMark('bob');
    const keys = () => (store.sql.prepare("SELECT key FROM _fm_sign_in_ledger WHERE key != ''").all() as { key: string }[]).map((r) => JSON.parse(r.key)[0]);
    assert.deepEqual(keys().sort(), ['amy', 'bob']);
    store.deleteAccount('bob');
    assert.deepEqual(keys(), ['amy']);
  } finally { close(); }
});

test('a directory sign-in whose person has no account here keeps its generation while its mapping lives', () => {
  const { store, close } = open();
  try {
    store.setExternalAccount('staff@corp.test', 'Reader');
    const principal = 'jo@corp.test';
    const mark = () => store.signInMark(principal, 'staff@corp.test', principal);
    const before = mark();
    // Settlements for other changes must not forget it: neither the principal nor the person has an account row.
    store.setAccountPrivilegeSet('amy', 'Writer');
    store.setAccountPrivilegeSet('amy', 'Reader');
    store.setAccountPrivilegeSet('staff@corp.test', 'Writer');
    store.setAccountPrivilegeSet('staff@corp.test', 'Reader');
    const after = mark();
    assert.notEqual(after, before, 'an authority round trip is a different sign-in');
    assert.ok(Number(after.split(':')[0]) > Number(before.split(':')[0]), 'the generation only rises');
    // It goes with the mapping, and nothing made later matches what was issued before.
    store.deleteAccount('staff@corp.test');
    assert.equal((store.sql.prepare("SELECT key FROM _fm_sign_in_ledger WHERE key LIKE '%jo@corp.test%'").all() as unknown[]).length, 0);
    store.setExternalAccount('staff@corp.test', 'Reader');
    assert.notEqual(mark(), before);
    assert.notEqual(mark(), after);
    assert.ok(Number(mark().split(':')[0]) > Number(after.split(':')[0]), 'above everything issued before the mapping went');
  } finally { close(); }
});

test('an account made again under the same name is not the one before', () => {
  const { store, close } = open();
  try {
    store.setPassword('bob', 'generated-sign-in-password-2', 'Reader');
    const before = store.signInMark('bob');
    store.deleteAccount('bob');
    store.setPassword('bob', 'generated-sign-in-password-2', 'Reader');
    const again = store.signInMark('bob');
    assert.notEqual(again, before);
    assert.ok(Number(again.split(':')[0]) > Number(before.split(':')[0]), 'above what the first bob was given');
    // A provisioned person (no password, no privilege set of their own) the same: made again, not the same sign-in.
    store.setExternalAccount('staff@corp.test', 'Reader');
    const bare = () => store.sql.prepare("UPDATE _fm_accounts SET identity_id = NULL WHERE name = 'jo@corp.test'").run(); // no identity yet, before and after
    store.addProvisionedAccount('jo@corp.test', 'admin');
    bare();
    const person = () => store.signInMark('jo@corp.test', 'staff@corp.test', 'jo@corp.test');
    const first = person();
    store.deleteAccount('jo@corp.test');
    store.addProvisionedAccount('jo@corp.test', 'admin');
    bare();
    assert.notEqual(person(), first);
  } finally { close(); }
});

test('an account with a non-ASCII name keeps its generation across other settlements', () => {
  const { store, close } = open();
  try {
    store.setPassword('Élodie', 'generated-sign-in-password-3', 'Reader');
    const before = store.signInMark('Élodie');
    store.setAccountPrivilegeSet('amy', 'Writer');
    store.setAccountPrivilegeSet('amy', 'Reader');
    store.setAccountPrivilegeSet('Élodie', 'Writer');
    store.setAccountPrivilegeSet('Élodie', 'Reader');
    const after = store.signInMark('Élodie');
    assert.notEqual(after, before, 'an authority round trip is a different sign-in');
    assert.ok(Number(after.split(':')[0]) > Number(before.split(':')[0]));
    assert.equal((store.sql.prepare("SELECT key FROM _fm_sign_in_ledger WHERE key != ''").all() as { key: string }[]).some((r) => JSON.parse(r.key)[0] === 'élodie'), true);
  } finally { close(); }
});

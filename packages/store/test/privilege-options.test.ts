// The key-10 "other options" (printing, exporting, allow-modify-password,
// idle-disconnect): decoded by the fmp12 reader, they must be carried into the
// store's PrivilegeDefinition and honoured by the Privileges oracle, so a set
// that forbids printing or exporting does not silently regain it on import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromFmp12, validateDefinition, Privileges, type PrivilegeDefinition } from '../src/privileges.ts';
import type { PrivilegeSet } from '../../fmp12/src/index.ts';

const base = {
  name: 'Limited', id: 5,
  records: { view: true, create: true, edit: true, delete: true },
  layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [],
} as unknown as PrivilegeSet;

const oracle = (set: PrivilegeDefinition) => new Privileges('acct', set, null, () => { throw new Error('no other file'); });

test('fromFmp12 carries the decoded key-10 options, and leaves them absent when the reader did not decode them', () => {
  const forbids = fromFmp12({ ...base, printing: false, exporting: false, allowModifyPassword: false, idleDisconnect: false });
  assert.equal(forbids.printing, false);
  assert.equal(forbids.exporting, false);
  assert.equal(forbids.allowModifyPassword, false);
  assert.equal(forbids.idleDisconnect, false);

  const allows = fromFmp12({ ...base, printing: true, exporting: true, allowModifyPassword: true, idleDisconnect: true });
  assert.equal(allows.printing, true);
  assert.equal(allows.exporting, true);

  // A set converted before these bits were decoded: the fields stay absent (so the oracle treats them as allowed).
  const older = fromFmp12(base);
  assert.equal(older.printing, undefined);
  assert.equal(older.exporting, undefined);
  assert.equal(older.allowModifyPassword, undefined);
  assert.equal(older.idleDisconnect, undefined);
});

test('the Privileges oracle treats an absent or true option as allowed and an explicit false as denied', () => {
  const forbids = oracle(fromFmp12({ ...base, printing: false, exporting: false, allowModifyPassword: false, idleDisconnect: false }));
  assert.equal(forbids.canPrint, false);
  assert.equal(forbids.canExport, false);
  assert.equal(forbids.canModifyPassword, false);
  assert.equal(forbids.idleDisconnect, false);

  const absent = oracle(fromFmp12(base));
  assert.equal(absent.canPrint, true);
  assert.equal(absent.canExport, true);
  assert.equal(absent.canModifyPassword, true);
  assert.equal(absent.idleDisconnect, true); // idle-disconnect on by default
});

test('a full-access set may always print, export and change its password', () => {
  const full = oracle({ name: '[Full Access]', id: 1, records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', printing: false, exporting: false, allowModifyPassword: false, extendedPrivileges: [] });
  assert.equal(full.canPrint, true);
  assert.equal(full.canExport, true);
  assert.equal(full.canModifyPassword, true);
});

test('validateDefinition rejects a non-boolean option but accepts a real one', () => {
  assert.throws(() => validateDefinition({ ...(base as unknown as PrivilegeDefinition), printing: 'yes' }), /printing must be true or false/);
  const ok = validateDefinition({ ...(base as unknown as PrivilegeDefinition), exporting: false });
  assert.equal(ok.exporting, false);
});

test('validateDefinition keeps a full-access set\'s idle-disconnect setting (it is honoured even for full access)', () => {
  const full = validateDefinition({ name: '[Full Access]', id: 1, records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: [], idleDisconnect: false } as unknown as PrivilegeDefinition);
  assert.equal(full.idleDisconnect, false, 'the admin-set idle-disconnect is not dropped');
  // Print/export/password are forced-allowed for full access, so they are not carried.
  assert.equal(oracle(full).idleDisconnect, false);
  assert.equal(oracle(full).canExport, true);
});

test('a set saved in Tabularius before these options existed gets the file\'s restrictions filled in', async () => {
  const { privilegeSets } = await import('../src/privileges.ts');
  const { DatabaseSync } = await import('node:sqlite');
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE _fm_privileges (name TEXT PRIMARY KEY, json TEXT NOT NULL)');
  // An older override of the file's "Limited" set: it lacks the four options.
  sql.prepare('INSERT INTO _fm_privileges VALUES (?, ?)').run('Limited', JSON.stringify({ name: 'Limited', id: 5, records: base.records, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [] }));
  const schema = { privilegeSets: [{ ...base, printing: false, exporting: false, allowModifyPassword: false }] } as never;
  const [set] = privilegeSets(sql, schema);
  assert.equal(set.exporting, false, 'the file\'s no-export survives an old override');
  assert.equal(set.printing, false);
  assert.equal(set.allowModifyPassword, false);
  // An override that already states an option keeps its own value.
  sql.prepare('UPDATE _fm_privileges SET json = ?').run(JSON.stringify({ name: 'Limited', id: 5, records: base.records, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [], exporting: true }));
  assert.equal(privilegeSets(sql, schema)[0].exporting, true);
});

test('diffPrivilegeSet reports a change to the print, export and password options', async () => {
  const { diffPrivilegeSet } = await import('../src/access-report.ts');
  const a = fromFmp12({ ...base, exporting: false });
  const b = { ...a, exporting: true, idleDisconnect: false };
  const changes = diffPrivilegeSet(b, a).filter((c) => c.area === 'options').map((c) => c.detail);
  assert.deepEqual(changes, ['exporting records and Save a Copy → allowed', 'disconnecting when idle → not allowed']);
  assert.deepEqual(diffPrivilegeSet(a, a), []);
});

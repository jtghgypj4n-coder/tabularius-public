// Field calculations see the session's $$variables, as in FileMaker: an auto-enter of $$UserName that a login script
// set fills in. A total over a calculation that reads one is worked out for each session, never handed to another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, writer } from '../../store/src/index.ts';
import { runScript, ScriptSession } from '../src/index.ts';

test('auto-enter and unstored calculations read the session\'s $$variables; each session gets its own totals', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-session-vars-'));
  try {
    createStore(join(dir, 'A.sqlite'));
    const store = new Store(join(dir, 'A.sqlite'));
    store.applyDesign([
      { op: 'createTable', name: 'AuditLog', fields: [
        { name: 'Action' },
        { name: 'CreatedBy', calculation: '$$UserName', options: { autoEnter: { calculation: true, prohibitModification: true }, validation: { strict: true, notEmpty: true } } },
        { name: 'Mine', kind: 'calculation', type: 'number', calculation: 'If ( CreatedBy = $$UserName ; 1 ; 0 )', options: { unstored: true } },
        { name: 'MineTotal', kind: 'summary', summary: { field: 'Mine', type: 'total' } },
      ] },
      { op: 'createScript', name: 'Login', text: 'Set Variable [ $$UserName ; Value: Get ( ScriptParameter ) ]' },
      { op: 'createScript', name: 'Log', text: 'Go to Layout [ “AuditLog” ]\nNew Record/Request\nSet Field [ AuditLog::Action ; "x" ]\nCommit Records/Requests [ With dialog: Off ]\nExit Script [ Text Result: Get ( LastError ) & "/" & AuditLog::CreatedBy ]' },
      { op: 'createScript', name: 'SQL mine', text: 'Exit Script [ Text Result: ExecuteSQL ( "SELECT SUM ( Mine ) FROM AuditLog" ; "" ; "" ) ]' },
      { op: 'createScript', name: 'Count mine', text: 'Go to Layout [ “AuditLog” ]\nShow All Records\nExit Script [ Text Result: AuditLog::MineTotal ]' },
    ] as never);
    const run = (name: string, session: ScriptSession, parameter?: string) =>
      runScript(store, store.schema.scripts.find((s) => s.name === name)!, { session, ...(parameter ? { parameter } : {}) });
    const ann = new ScriptSession();
    const bob = new ScriptSession();
    await run('Login', ann, 'ann');
    await run('Login', bob, 'bob');
    assert.equal((await run('Log', ann)).result, '0/ann');
    assert.equal((await run('Log', ann)).result, '0/ann');
    assert.equal((await run('Log', bob)).result, '0/bob');
    // The same total, straight after, for each: Bob's isn't Ann's kept result.
    assert.equal((await run('Count mine', ann)).result, '2');
    assert.equal((await run('Count mine', bob)).result, '1');
    assert.equal((await run('SQL mine', ann)).result, '2');
    assert.equal((await run('SQL mine', bob)).result, '1');
    // No session: nothing set, so the field can't fill in.
    assert.equal((await run('Log', new ScriptSession())).result.split('/')[0], '509');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a record-access rule reading $$variables is worked out for each session, never served from another\'s', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-session-rule-'));
  try {
    createStore(join(dir, 'R.sqlite'));
    const store = new Store(join(dir, 'R.sqlite'));
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Name' }] }] as never);
    for (let i = 0; i < 3; i++) store.create('T', { Name: `r${i}` });
    store.savePrivilegeSet({ name: 'Lim', records: { view: '$$ok = 1', edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'modifiable', scripts: 'modifiable', extendedPrivileges: [] } as never);
    store.setPassword('clerk', 'pw', 'Lim');
    const pv = store.privileges('clerk');
    const allowed = new ScriptSession();
    allowed.writeVariable('$$ok', 1, { type: 'number', value: 1 } as never);
    const none = new ScriptSession();
    const seen = (session: ScriptSession) => writer.run({ globals: session }, () => store.viewableIds('T', pv)!.length);
    assert.equal(seen(allowed), 3);
    assert.equal(seen(none), 0);
    assert.equal(seen(allowed), 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a result over a $$variable follows the variable within one session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-session-stale-'));
  try {
    createStore(join(dir, 'S.sqlite'));
    const store = new Store(join(dir, 'S.sqlite'));
    store.applyDesign([
      { op: 'createTable', name: 'T', fields: [{ name: 'Amt', type: 'number' }, { name: 'Scaled', kind: 'calculation', type: 'number', calculation: 'Amt * $$k', options: { unstored: true } }] },
      { op: 'createScript', name: 'Sum', text: 'Set Variable [ $$k ; Value: Get ( ScriptParameter ) ]\nExit Script [ Text Result: ExecuteSQL ( "SELECT SUM ( Scaled ) FROM T" ; "" ; "" ) ]' },
    ] as never);
    for (const a of [1, 2, 3]) store.create('T', { Amt: a });
    const session = new ScriptSession();
    const sum = async (k: string) => (await runScript(store, store.schema.scripts.find((s) => s.name === 'Sum')!, { session, parameter: k })).result;
    assert.equal(await sum('1'), '6');
    assert.equal(await sum('10'), '60');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

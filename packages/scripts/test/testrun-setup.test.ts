// test-scripts and a file's login globals: a field that fills in from a $$variable the login script sets is reported
// as test setup, not as the script's fault, and --global sets the variable so the script itself can be tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { testScripts } from '../src/index.ts';

test('a field filled from an unset $$variable is test setup; --global fills it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-testrun-setup-'));
  try {
    createStore(join(dir, 'A.sqlite'));
    const store = new Store(join(dir, 'A.sqlite'));
    store.applyDesign([
      { op: 'createTable', name: 'AuditLog', fields: [
        { name: 'Action' },
        { name: 'CreatedBy', calculation: '$$UserName', options: { autoEnter: { calculation: true, prohibitModification: true }, validation: { strict: true, notEmpty: true } } },
      ] },
      { op: 'createScript', name: 'Audit', text: 'Set Error Capture [ On ]\nGo to Layout [ “AuditLog” ]\nNew Record/Request\nSet Field [ AuditLog::Action ; "x" ]\nCommit Records/Requests [ With dialog: Off ]\nExit Script [ Text Result: Get ( LastError ) ]' },
    ] as never);
    const [bare] = await testScripts(store, { scripts: ['Audit'] });
    assert.equal(bare.error, 509, JSON.stringify(bare));
    assert.deepEqual(bare.setup, [`AuditLog::CreatedBy fills in from $$UserName, which nothing in this run set (a login or startup script usually does): run with --global '$$UserName=…' to test the script itself`]);

    const [seeded] = await testScripts(store, { scripts: ['Audit'], globals: { '$$UserName': 'tester' } });
    assert.equal(seeded.outcome, 'ok', JSON.stringify(seeded));
    assert.equal(seeded.setup, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

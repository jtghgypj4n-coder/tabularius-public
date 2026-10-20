import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runScript } from '../../scripts/src/index.ts';
import type { Script, ScriptStep } from '../../fmp12/src/index.ts';
import { SHAPES, ACCOUNT, openMatrix, expected, snapshot, restore, assertMutation, type Operation } from './privilege-matrix.ts';

for (const row of SHAPES) test(`Caller script matrix: ${row.name}`, async (t) => {
  const m = await openMatrix(row);
  try {
    const e = row.expected;
    const options = { layout: 'Items', account: ACCOUNT, executionAccount: ACCOUNT, privileges: m.store.privileges(ACCOUNT), foundSet: [m.own], documents: m.dir };
    const operations: { name: string; op: Operation; script: string | Script; other?: boolean }[] = [
      { name: 'read', op: 'read', script: 'Read' },
      { name: 'named script object', op: 'read', script: m.store.schema.scripts.find((s) => s.name === 'Read')! },
      { name: 'edit', op: 'edit', script: 'Edit' },
      { name: 'edit other record', op: 'edit', script: 'Edit', other: true },
      { name: 'create', op: 'emptyCreate', script: 'Create' },
      { name: 'delete', op: 'delete', script: 'Delete' },
      { name: 'delete other record', op: 'delete', script: 'Delete', other: true },
      { name: 'print', op: 'print', script: 'Print' },
      // Object scripts model individual caller-run steps (e.g. a web button), independent of named-script access.
      { name: 'export step', op: 'export', script: { id: 0, name: '', steps: [{ stepId: 36, name: 'Export Records', enabled: true, params: {
        filePaths: ['matrix.csv'], exportFormat: 'COMS', exportFields: [{ tableOccurrence: { id: 129, name: 'Items' }, field: { id: 1, name: 'Name' }, repetition: 1 }],
      } } as unknown as ScriptStep] } as Script },
    ];
    for (const operation of operations) await t.test(operation.name, async () => {
      const before = snapshot(m.store);
      try {
        // The engine receives an authenticated caller. Extended privileges and lockout
        // govern sign-in, not an already-authorized in-process script's steps.
        const named = typeof operation.script === 'string' || operation.script.id !== 0;
        let want = named && !e.script ? 9 : ['inactive', 'expired'].includes(e.account) ? 212
          : expected(e, 'read') || expected(e, operation.op);
        if (!want && operation.other && e.limited) want = 200;
        let result;
        try {
          result = await runScript(m.store, operation.script, { ...options, foundSet: [operation.other ? m.other : m.own] });
        } catch (error) {
          assert.equal((error as { code?: number }).code, want, String(error));
          assert.notEqual(want, 0);
          assert.deepEqual(snapshot(m.store), before);
          return;
        }
        assert.equal(result.error, want, JSON.stringify(result));
        if (want) assert.deepEqual(snapshot(m.store), before);
        if (!want && operation.name === 'read') assert.equal(result.result, e.field === 'none' ? '' : 'visible');
        if (operation.name === 'export step') {
          const file = join(m.dir, 'matrix.csv');
          assert.equal(existsSync(file), want === 0);
          if (!want && e.field === 'none') assert.ok(!readFileSync(file, 'utf8').includes('visible'));
        }
        if (!want) assertMutation(m, before, operation.op, operation.other ? m.other : m.own);
      } finally { restore(m.store, before); }
    });
  } finally { await m.close(); }
});

test('caller script expiry follows edits to the password policy and password timestamp', async () => {
  const m = await openMatrix(SHAPES[0]);
  try {
    const options = { layout: 'Items', account: ACCOUNT, executionAccount: ACCOUNT, privileges: m.store.privileges(ACCOUNT), foundSet: [m.own] };
    m.store.sql.prepare('UPDATE _fm_accounts SET password_changed = ? WHERE name = ?').run('2000-01-01T00:00:00.000Z', ACCOUNT);
    assert.equal((await runScript(m.store, 'Read', options)).error, 0);
    m.store.setPasswordPolicy({ maxAgeDays: 1 });
    await assert.rejects(runScript(m.store, 'Edit', options), (e: any) => e.code === 212);
    assert.equal(m.store.get('Items', m.own).fieldData.Name, 'visible');
    m.store.setPasswordPolicy({});
    assert.equal((await runScript(m.store, 'Read', options)).error, 0);
    m.store.setPasswordPolicy({ maxAgeDays: 1 });
    m.store.setPassword(ACCOUNT, 'matrix-password', 'Matrix', { mustChange: false });
    assert.equal((await runScript(m.store, 'Read', options)).error, 0);
  } finally { await m.close(); }
});

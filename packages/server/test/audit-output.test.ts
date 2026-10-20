import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, writer } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

test('real audit and security CSV endpoints emit one bounded physical row per event without changing stored evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-audit-output-'));
  createStore(join(dir, 'Test.openhbam.sqlite'));
  const s = await serve({ dir, port: 0, log: () => {} });
  try {
    const store = s.host.get('Test')!;
    const names = ['=1+1', '\t=1+1', 'a\r\nforged\u001b[2J\u202ehidden', 'x'.repeat(100_000)];
    for (const name of names) store.auditSignIn(name, 'synthetic-address', false);
    store.applyDesign([{ op: 'createTable', name: 'Records\u202ename', fields: [{ name: 'Value', type: 'text' }] }]);
    writer.run({ account: '=record actor', surface: 'surface\u202e', script: 'script\r\nforged' }, () =>
      store.create('Records\u202ename', { Value: 'line\n\u202ehidden' }));
    const before = store.verifySecurityAudit();
    for (const route of ['audit', 'security-events']) {
      const r = await fetch(`${s.url}/tabularius/admin/v1/${route}?database=Test&format=csv`);
      assert.equal(r.status, 200);
      const csv = await r.text();
      const rows = csv.trimEnd().split('\r\n');
      assert.equal(rows.length, names.length + (route === 'audit' ? 3 : 2));
      for (const row of rows) {
        assert.equal(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(row), false);
        assert.ok(row.length < 15_000);
      }
      assert.match(csv, /'=1\+1/);
      assert.match(csv, /\\u\{202e\}/);
      assert.match(csv, /truncated/);
      if (route === 'audit') {
        assert.match(csv, /surface\\u\{202e\}/);
        assert.match(csv, /script\\u\{000d\}\\u\{000a\}forged/);
      }
    }
    assert.deepEqual(store.verifySecurityAudit(), before);
    assert.deepEqual(store.auditLog({ kind: 'sign-in-failed' }).map(e => e.account), names);
  } finally {
    await new Promise<void>(resolve => s.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

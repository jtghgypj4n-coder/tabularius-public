// Usage per account: requests counted by where they came from, kept as counts only, added up across flushes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('requests are counted per account and surface, and every account is listed', { skip }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-usage-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  t.after(async () => {
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  const store = s.host.get('Charts')!;
  store.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.setPassword('ruth', 'ruth-pw-1234', 'Reader');
  store.setPassword('idle', 'idle-pw-1234', 'Reader');

  const login = await fetch(`${s.url}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from('ruth:ruth-pw-1234').toString('base64')}`, 'content-type': 'application/json' }, body: '{}' });
  const token = ((await login.json()) as { response: { token: string } }).response.token;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${s.url}/fmi/data/vLatest/databases/Charts/layouts`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
  }
  const u = store.accountUsage(30);
  const ruth = u.accounts.find((a) => a.account === 'ruth')!;
  assert.equal(ruth.bySurface.rest, 3, 'three calls on the Data API');
  assert.equal(ruth.requests, 3);
  assert.equal(ruth.daysActive, 1);
  assert.equal(ruth.signIns, 1);
  const idle = u.accounts.find((a) => a.account === 'idle')!;
  assert.equal(idle.requests, 0, 'an account that did nothing is listed with none');
  assert.equal(idle.daysActive, 0);
  assert.equal(idle.lastDay, undefined);

  // More requests add to the same day's row, not a new one; and the window can leave a day out.
  store.recordUsage('ruth', 'mcp');
  store.recordUsage('RUTH', 'mcp');
  const again = store.accountUsage(30).accounts.find((a) => a.account === 'ruth')!;
  assert.equal(again.bySurface.mcp, 2);
  assert.equal(again.requests, 5);
  assert.equal(store.sql.prepare('SELECT COUNT(*) AS n FROM _fm_usage WHERE account = ?').get('ruth')!.n, 2, 'one row per surface for the day');
  // Counts only: nothing but day, account, surface and a number is stored.
  assert.deepEqual((store.sql.prepare('PRAGMA table_info(_fm_usage)').all() as { name: string }[]).map((c) => c.name), ['day', 'account', 'surface', 'requests']);
});

test('OData and SQL requests are counted too, so least privilege can tell an unused way in', { skip }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-usage-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  t.after(async () => {
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  const store = s.host.get('Charts')!;
  store.savePrivilegeSet({ name: 'Analyst', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmodata', 'fmxdbc'] });
  store.setPassword('ana', 'ana-pw-12345', 'Analyst');
  const auth = { authorization: `Basic ${Buffer.from('ana:ana-pw-12345').toString('base64')}` };
  assert.equal((await fetch(`${s.url}/fmi/odata/v4/Charts`, { headers: auth })).status, 200);
  const sql = await fetch(`${s.url}/tabularius/sql/v1/databases/Charts`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ sql: 'SELECT COUNT(*) AS n FROM Congress' }) });
  assert.equal(sql.status, 200);
  const ana = store.accountUsage(30).accounts.find((a) => a.account === 'ana')!;
  assert.equal(ana.bySurface.odata, 1);
  assert.equal(ana.bySurface.sql, 1);
});

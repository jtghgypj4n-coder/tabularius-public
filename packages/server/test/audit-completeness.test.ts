// Evidence for open findings, not acceptance tests claiming complete auditing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, writer } from '../../store/src/index.ts';
import { serve, setAdminPassword } from '../src/index.ts';

test('audit finding: credential mutations omit actor/address even inside an attributed writer; sampled credentials are absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-audit-completeness-'));
  const path = join(dir, 'Test.openhbam.sqlite'); createStore(path);
  const store = new Store(path);
  try {
    let token = '';
    writer.run({ account: 'synthetic-admin', surface: 'admin' }, () => {
      store.setPassword('member', 'synthetic-first-secret');
      store.setPassword('member', 'synthetic-second-secret');
      token = store.createApiToken('member', { label: 'synthetic-label' });
      store.revokeApiToken(/ohbt_([0-9a-f]+)\./.exec(token)![1]);
    });
    const events = store.auditLog({ security: true });
    assert.equal(events.length, 4);
    assert.equal(events.filter(e => e.account === null).length, 4, 'open finding: writer actor is not inherited');
    assert.equal(events.filter(e => !e.from).length, 4, 'open finding: no address');
    const text = JSON.stringify(events);
    for (const secret of ['synthetic-first-secret', 'synthetic-second-secret', token]) assert.ok(!text.includes(secret));
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('audit finding: admin sign-in outcomes and a configuration write produce no file security events', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-audit-admin-gap-'));
  createStore(join(dir, 'Test.openhbam.sqlite')); setAdminPassword(dir, 'synthetic-console-secret');
  const s = await serve({ dir, port: 0, log: () => {} });
  try {
    const headers = { 'content-type': 'application/json', 'x-tabularius-admin': '1' };
    const login = (password: string) => fetch(s.url + '/tabularius/admin/v1/sign-in', { method: 'POST', headers, body: JSON.stringify({ password }) });
    const before = s.host.get('Test')!.verifySecurityAudit();
    assert.equal((await login('wrong-synthetic-secret')).status, 401);
    const ok = await login('synthetic-console-secret'); assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie')!.split(';')[0];
    const changed = await fetch(s.url + '/tabularius/admin/v1/session-timeout', { method: 'POST', headers: { ...headers, cookie }, body: JSON.stringify({ minutes: 7 }) });
    assert.equal(changed.status, 200);
    assert.deepEqual(s.host.get('Test')!.verifySecurityAudit(), before, 'open finding: no chained event');
  } finally {
    await new Promise<void>(resolve => s.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

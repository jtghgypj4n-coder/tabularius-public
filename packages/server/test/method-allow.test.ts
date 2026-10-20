// A method a route doesn't take is 405 with an Allow header naming the ones it does; the static pages (the web app,
// the guides, the root) take GET and HEAD only, where they used to answer any method with the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, setAdminPassword } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');

test('/app, /docs and / answer GET and HEAD, and 405 with Allow for anything else', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-allow-'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    for (const path of ['/app/', '/app/app.css', '/docs', '/docs/design-mode', '/']) {
      for (const method of ['GET', 'HEAD']) assert.equal((await fetch(`${s.url}${path}`, { method })).status, 200, `${method} ${path}`);
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const r = await fetch(`${s.url}${path}`, { method, body: method === 'DELETE' ? undefined : '{}' });
        assert.equal(r.status, 405, `${method} ${path}`);
        assert.equal(r.headers.get('allow'), 'GET, HEAD', `${method} ${path}`);
        await r.arrayBuffer();
      }
    }
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Admin API says which methods a route takes when it refuses one', { skip: existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-allow-admin-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  setAdminPassword(dir, 'secret');
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    const base = `${s.url}/fmi/admin/api/v2`;
    const login = await fetch(`${base}/user/auth`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('admin:secret') } });
    const auth = { authorization: `Bearer ${(await login.json()).response.token}`, 'content-type': 'application/json' };
    const made = await fetch(`${base}/schedules/filemakerscript`, {
      method: 'POST', headers: auth, body: JSON.stringify({
        name: 'Nightly', enabled: true,
        filemakerScriptType: { resource: 'file:Charts.fmp12', fmScriptName: 'Show House', fmScriptParam: '', fmScriptAccount: 'Admin' },
        everyndaysType: { startTimeStamp: '2026-01-01T02:30:00', dailyDays: 1 },
      }),
    });
    const id = (await made.json()).response.schedule.id;
    const refused = await fetch(`${base}/schedules/${id}`, { method: 'PUT', headers: auth, body: '{}' });
    assert.equal(refused.status, 405);
    assert.equal(refused.headers.get('allow'), 'GET, PATCH, DELETE');
    await refused.arrayBuffer();

  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the admin console says which methods an uploads route takes when it refuses one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-allow-console-'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    const admin = (path: string, method: string) => fetch(`${s.url}/tabularius/admin/v1${path}`, { method, headers: { 'x-tabularius-admin': '1' } });
    for (const [path, method, allow] of [['/uploads', 'DELETE', 'GET, POST'], ['/uploads/abc', 'POST', 'PUT, GET, DELETE'], ['/uploads/abc/finish', 'GET', 'POST']] as const) {
      const r = await admin(path, method);
      assert.equal(r.status, 405, `${method} ${path}`);
      assert.equal(r.headers.get('allow'), allow, `${method} ${path}`);
      await r.arrayBuffer();
    }
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});

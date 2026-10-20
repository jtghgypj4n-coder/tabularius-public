// The admin console's own sign-in page, instead of the browser's password box:
// it says what to type (the admin console password, no user name) and how to
// set a new one on the server when nobody knows it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, setAdminPassword } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('signing in to the console with its password, by cookie, without the browser box', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sign-in-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  setAdminPassword(dir, 'admin secret');
  const s = await serve({ dir, port: 0, log: () => {} });
  const url = (p: string) => `${s.url}${p}`;
  try {
    // The page itself opens for anyone; its data doesn't.
    const page = await fetch(url('/admin/'));
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('www-authenticate'), null);
    assert.match(await page.text(), /Admin console password/);

    // The page's calls get no Basic challenge (no browser box); scripts still do.
    const fromPage = await fetch(url('/tabularius/admin/v1/status'), { headers: { 'x-tabularius-console': '1' } });
    assert.equal(fromPage.status, 401);
    assert.equal(fromPage.headers.get('www-authenticate'), null);
    assert.equal((await fromPage.json()).signIn, true);
    assert.match((await fetch(url('/tabularius/admin/v1/status'))).headers.get('www-authenticate') ?? '', /Basic/);

    const info = await (await fetch(url('/tabularius/admin/v1/sign-in-info'))).json();
    assert.equal(info.passwordSet, true);
    assert.equal(info.command, `tabularius admin-password ${dir}`);
    assert.equal(info.https, false);

    const signIn = (password: string, headers: Record<string, string> = { 'x-tabularius-admin': '1' }) =>
      fetch(url('/tabularius/admin/v1/sign-in'), { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
    assert.equal((await signIn('admin secret', {})).status, 403, 'other sites can\'t sign in for you');
    const wrong = await signIn('nope');
    assert.equal(wrong.status, 401);
    assert.equal((await wrong.json()).error, 'Wrong admin password');

    const ok = await signIn('admin secret');
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie')!;
    assert.match(cookie, /^tabularius_admin=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200$/);
    const jar = cookie.split(';')[0];
    const status = await fetch(url('/tabularius/admin/v1/status'), { headers: { cookie: jar } });
    assert.equal(status.status, 200);
    assert.equal((await status.json()).server.passwordSet, true);

    await fetch(url('/tabularius/admin/v1/sign-out'), { method: 'POST', headers: { cookie: jar, 'x-tabularius-admin': '1' } });
    assert.equal((await fetch(url('/tabularius/admin/v1/status'), { headers: { cookie: jar } })).status, 401, 'signed out');
    assert.equal((await fetch(url('/tabularius/admin/v1/status'), { headers: { cookie: 'tabularius_admin=' + 'a'.repeat(64) } })).status, 401);
  } finally {
    s.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { needsSameOriginCheck } from '../src/browser-request.ts';
import { stubPath } from './cross-origin-support.ts';

const sessionPaths = [
  '/databases/Synthetic/sessions',
  '/databases/Synthetic/sessions/',
  '/databases/Synthetic/sessions//',
  '//databases//Synthetic//sessions///',
  '/%64atabases/Synthetic/%73essions',
  '//%64atabases//%53ynthetic//%73essions//',
];
const versions = ['v1', 'v2', 'vLatest'];

test('invariant: every accepted session POST spelling requires origin checks despite unrelated tokens', () => {
  for (const headers of [{ authorization: 'Bearer unrelated' }, { 'x-fm-data-access-token': 'unrelated' }]) {
    const req = { method: 'POST', headers } as IncomingMessage;
    for (const version of versions) {
      for (const path of sessionPaths) {
        // Passkey/recovery dispatch also accepts extra segments after its action.
        for (const suffix of ['', '/passkey/', '//recovery//', '/passkey-2fa//', '/passkey/extra', '/%72ecovery/extra']) {
          const pathname = `/fmi/data/${version}${path}${suffix}`;
          assert.equal(needsSameOriginCheck(req, pathname), true, pathname);
        }
      }
    }
    assert.equal(needsSameOriginCheck(req, '/fmi/data/vLatest/databases/Synthetic/layouts/Records/records'), false,
      'explicit tokens still authorize non-session APIs without ambient credentials');
    assert.doesNotThrow(() => needsSameOriginCheck(req, '/fmi/data/vLatest/databases/Synthetic/%ZZ'));
  }
});

test('invariant: session path aliases reject hostile origins before authentication and retain same-origin sign-in', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-session-origin-'));
  stubPath(t, dir);
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    const store = s.host.create('Synthetic');
    store.setPassword('Admin', 'synthetic-secret');
    const verify = t.mock.method(store, 'verifyAsync');
    const headers = { authorization: 'Basic ' + btoa('Admin:synthetic-secret'), 'x-fm-data-access-token': 'unrelated' };
    for (const version of versions) {
      for (const path of sessionPaths) {
        const url = `${s.url}/fmi/data/${version}${path}`;
        const before = verify.mock.callCount();
        const denied = await fetch(url, { method: 'POST', headers: { ...headers, origin: 'https://evil.example' } });
        await denied.arrayBuffer();
        assert.equal(denied.status, 403, path);
        assert.equal(denied.headers.get('x-fm-data-access-token'), null, 'rejection must not mint a session');
        assert.equal(verify.mock.callCount(), before, 'rejection must precede password authentication');

        const allowed = await fetch(url, { method: 'POST', headers: { ...headers, origin: s.url } });
        const body = await allowed.json();
        assert.equal(allowed.status, 200, path);
        assert.ok(body.response.token, 'the alias must actually dispatch to session creation');
        const logout = await fetch(`${s.url}/fmi/data/${version}/databases/Synthetic/sessions/${body.response.token}`, { method: 'DELETE' });
        await logout.arrayBuffer();
        assert.equal(logout.status, 200);
      }
    }
    for (const suffix of ['/passkey/', '//%70asskey//extra/']) {
      const url = `${s.url}/fmi/data/vLatest//databases//Synthetic//sessions${suffix}`;
      const denied = await fetch(url, { method: 'POST', headers: { ...headers, origin: 'https://evil.example' } });
      await denied.arrayBuffer();
      assert.equal(denied.status, 403, suffix);
      const allowed = await fetch(url, { method: 'POST', headers: { ...headers, origin: s.url } });
      const body = await allowed.json();
      assert.equal(allowed.status, 200, suffix);
      assert.ok(body.response.challenge, 'accepted passkey aliases also require the origin guard');
    }
  } finally {
    s.server.closeAllConnections();
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
  }
});

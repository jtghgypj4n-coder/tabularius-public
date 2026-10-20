// A token used on the wrong database (a mistyped name) is refused with 952 but is not ended: the next call to the
// database it belongs to still works. Built here, so it runs without the downloaded samples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore } from '../../store/src/index.ts';

test('a Data API token used on another database gets 952 and stays valid on its own', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-wrongdb-'));
  createStore(join(dir, 'Alpha' + STORE_EXT));
  createStore(join(dir, 'Beta' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    for (const name of ['Alpha', 'Beta']) s.host.get(name)!.setPassword('Admin', 'pw');
    const api = (path: string, init: RequestInit = {}) =>
      fetch(`${s.url}/fmi/data/vLatest/databases${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) } })
        .then(async (r) => ({ status: r.status, body: await r.json() }));
    const login = await api('/Alpha/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
    const token = login.body.response.token as string;
    assert.ok(token);
    const auth = { authorization: `Bearer ${token}` };

    assert.equal((await api('/Alpha/layouts', { headers: auth })).body.messages[0].code, '0');
    const wrong = await api('/Beta/layouts', { headers: auth });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.messages[0].code, '952');
    const nowhere = await api('/Nope/layouts', { headers: auth });
    assert.equal(nowhere.body.messages[0].code, '952');
    assert.equal((await api('/Alpha/layouts', { headers: auth })).body.messages[0].code, '0', 'still signed in to Alpha');
    // Signing out still works, and then the token is gone.
    await api(`/Alpha/sessions/${token}`, { method: 'DELETE' });
    assert.equal((await api('/Alpha/layouts', { headers: auth })).body.messages[0].code, '952');
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});

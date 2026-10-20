import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('a new file has an active credential-less Admin; disabling or deleting it blocks execution without schema fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-execution-account-'));
  const path = join(dir, 'Local.sqlite');
  createStore(path);
  const store = new Store(path);
  try {
    assert.equal(store.canonicalAccount('Admin'), 'Admin');
    assert.equal(store.accounts()[0].hasPassword, false);
    assert.equal(store.verify('Admin', ''), false, 'no password authentication was enabled');
    assert.doesNotThrow(() => store.requireActiveAccount('Admin'));
    store.setPassword('Other', 'other-secret', '[Full Access]');
    store.setAccountActive('Admin', false);
    assert.throws(() => store.requireActiveAccount('Admin'), { code: 212 });
    store.setAccountActive('Admin', true);
    assert.doesNotThrow(() => store.requireActiveAccount('Admin'));
    assert.equal(store.deleteAccount('Admin'), true);
    assert.throws(() => store.requireActiveAccount('Admin'), { code: 212 });
    assert.throws(() => store.requireActiveAccount('Missing'), { code: 212 });
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

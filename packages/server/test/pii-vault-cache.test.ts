// The stand-ins a process remembers for an account follow the file: once their rows are gone (the account was
// deleted), a new masker for the same name starts again and cannot turn old stand-ins back into real values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiiMasker } from '../src/pii.ts';
import { createStore, Store } from '../../store/src/index.ts';

test('a masker made after the account\'s stand-ins were deleted does not remember them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pii-cache-'));
  try {
    const path = join(dir, 'Scratch.sqlite');
    createStore(path);
    const store = new Store(path, 'Scratch');
    try {
      const first = new PiiMasker(store, 'leaver');
      const out = first.text('Contact ada@example.com today');
      const token = /<[A-Z_]+_\d+>/.exec(out)?.[0];
      assert.ok(token, out);
      assert.equal(first.unmask(token), 'ada@example.com');
      store.sql.prepare('DELETE FROM _fm_pii_vault WHERE account = ?').run('leaver');
      const second = new PiiMasker(store, 'leaver');
      assert.equal(second.unmask(token), token, 'the old stand-in no longer turns back');
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('account and value cache eviction preserves masking and stable stand-ins from SQLite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-pii-bounds-'));
  const path = join(dir, 'Scratch.sqlite');
  createStore(path);
  const store = new Store(path, 'Scratch');
  const vault = (masker: PiiMasker) => (masker as unknown as { vault: { byId: Map<number, unknown>; byValue: Map<string, string>; words: Map<string, unknown[]> } }).vault;
  try {
    const first = new PiiMasker(store, 'first');
    const old = vault(first);
    const token = first.token('Early Person', 'PERSON');
    for (let i = 0; i < 1100; i++) first.token(`Person ${i}`, 'PERSON');
    assert.ok(vault(first).byId.size <= 1024);
    assert.ok(vault(first).byValue.size <= 1024);
    assert.ok([...vault(first).words.values()].reduce((n, list) => n + list.length, 0) <= 1024);
    assert.equal(first.token('Early Person', 'PERSON'), token, 'eviction never changes a persistent stand-in');
    assert.equal(first.text('Ask Early Person today'), `Ask ${token} today`, 'an evicted name must never be exposed to a model');
    assert.equal(first.unmask(token), 'Early Person');
    for (let i = 0; i < 65; i++) new PiiMasker(store, `other-${i}`);
    const again = new PiiMasker(store, 'first');
    assert.notEqual(vault(again), old, 'account churn evicts the oldest account cache');
    assert.equal(again.text('Ask Early Person today'), `Ask ${token} today`);
    assert.equal(again.unmask(token), 'Early Person');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

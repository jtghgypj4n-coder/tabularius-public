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

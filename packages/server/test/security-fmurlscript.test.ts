// fmurlscript (running a script from a WebDirect-style link) is one of Tabularius's own extended privileges, so
// the Security page offers it in a privilege set's list without any set holding it first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILT_IN_EXTENDED_PRIVILEGES, Store, createStore } from '../../store/src/index.ts';
import { securityOf } from '../src/security.ts';

test('fmurlscript is a built-in extended privilege and the Security page lists it', () => {
  assert.ok((BUILT_IN_EXTENDED_PRIVILEGES as readonly string[]).includes('fmurlscript'));
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-fmurlscript-'));
  try {
    const path = join(dir, 'Real.tabularius');
    createStore(path);
    const store = new Store(path, 'Real');
    try {
      const overview = securityOf(store);
      assert.ok(overview.extendedPrivileges.includes('fmurlscript'));
      // A built-in is not offered as a renamable or deletable custom entry.
      assert.ok(!overview.customExtendedPrivileges.some((e) => e.name === 'fmurlscript'));
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

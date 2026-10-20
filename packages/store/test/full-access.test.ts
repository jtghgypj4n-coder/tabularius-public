import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store } from '../src/index.ts';

// FMburgh's [Full Access] lists only fmreauthenticate10, FileMaker's default.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'FMburgh_2012_11_07_Database.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('[Full Access] gets fmapp and fmrest once, so a converted file opens for its admin', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  try {
    const path = join(dir, 'FMburgh.sqlite');
    importFmp12(fixture, path);
    let store = new Store(path);
    const full = () => store.privilegeSets().find((p) => p.id === 1)!;
    assert.ok(full().extendedPrivileges.includes('fmapp'));
    assert.ok(full().extendedPrivileges.includes('fmrest'));
    assert.ok(full().extendedPrivileges.includes('fmreauthenticate10'), 'what the file had is kept');

    // Revoking sticks across reopening.
    store.savePrivilegeSet({ ...full(), extendedPrivileges: full().extendedPrivileges.filter((e) => e !== 'fmrest') });
    store.close();
    store = new Store(path);
    assert.ok(!full().extendedPrivileges.includes('fmrest'));
    store.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { importFmp12, Store } from '../src/index.ts';

// Privileges and record counts are cached for speed; changes made here or by
// another process (a second connection, as the CLI is) must still show.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('cached privileges and record counts follow changes from any connection', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  const a = new Store(path);
  const b = new Store(path);
  try {
    const sets = a.privilegeSets();
    const full = sets.find((p) => p.id === 1)!.name;
    const readOnly = sets.find((p) => p.id === 3)!.name;
    a.setPassword('Kim', 'pw', full);
    assert.equal(a.privileges('Kim').name, full);

    // Changed here: at once.
    a.setAccountPrivilegeSet('Kim', readOnly);
    assert.equal(a.privileges('Kim').name, readOnly);

    // Changed by another process: within a second.
    b.setAccountPrivilegeSet('Kim', full);
    await sleep(600);
    assert.equal(a.privileges('Kim').name, full);

    const layout = 'Congress';
    const total = () => a.find(layout, { limit: 0 }).totalCount;
    const n = total();
    assert.equal(a.find(layout, { limit: 1 }).foundCount, n);
    const mine = a.create(layout, {}).recordId;
    assert.equal(total(), n + 1);
    const theirs = b.create(layout, {}).recordId;
    assert.equal(total(), n + 2);
    b.delete(layout, theirs);
    a.delete(layout, mine);
    assert.equal(total(), n);
    a.truncate(layout);
    assert.equal(total(), 0);
  } finally {
    a.close();
    b.close();
    rmSync(dir, { recursive: true });
  }
});

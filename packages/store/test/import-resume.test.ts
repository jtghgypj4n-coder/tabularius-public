import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { importFmp12, type ImportProgress } from '../src/index.ts';

// A conversion stopped part way (a crash, the server restarting) picks up
// where it stopped and ends with the same store as one that ran straight through.
const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const skip = existsSync(join(fixtures, 'DEMO_drawers.fmp12')) ? false : 'fixtures missing: run npm run fixtures';

/** Every table's rows, container files included; the import time left out. */
function contents(path: string): Record<string, unknown[]> {
  const sql = new DatabaseSync(path, { readOnly: true });
  const out: Record<string, unknown[]> = {};
  for (const { name } of sql.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[]) {
    const rows = sql.prepare(`SELECT * FROM "${name.replace(/"/g, '""')}"`).all() as Record<string, unknown>[];
    out[name] = rows
      .filter((r) => !(name === '_fm_meta' && r.key === 'source'))
      .map((r) => JSON.stringify(r, (_k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('base64') : v)))
      .sort();
  }
  sql.close();
  return out;
}

for (const file of ['DEMO_drawers.fmp12', 'Charts.fmp12']) {
  test(`an interrupted conversion of ${file} carries on where it stopped`, { skip }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-resume-'));
    const src = join(fixtures, file);
    importFmp12(src, join(dir, 'straight.sqlite'));

    const out = join(dir, 'stopped.sqlite');
    let calls = 0;
    assert.throws(() => importFmp12(src, out, () => {
      if (++calls === 2) throw new Error('stopped');
    }), /stopped/);

    const seen: ImportProgress[] = [];
    importFmp12(src, out, (p) => seen.push(p), { resume: true });
    assert.ok(seen[0].tablesDone > 0 || seen[0].records > 0, 'it picked up, not started over');
    assert.equal(seen.at(-1)!.fraction! > 0, true);
    assert.deepEqual(contents(out), contents(join(dir, 'straight.sqlite')));

    // Without resume, what's there is replaced.
    importFmp12(src, out);
    assert.deepEqual(contents(out), contents(join(dir, 'straight.sqlite')));
  });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FmpDatabase, scriptText, undecodedOptionError } from '../../fmp12/src/index.ts';
import { DESIGN_VERSION, importFmp12, needsDesigns, Store, upgradeDesigns } from '../src/index.ts';
import { importDesigns } from '../src/import.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('diagnostic metadata persists and survives ordinary design refresh', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-option-refresh-'));
  const path = join(dir, 'Charts.sqlite');
  try {
    importFmp12(fixture, path);
    let store = new Store(path, 'Charts');
    const scripts = ['Rollback', 'State', 'Import'];
    store.applyDesign([
      { op: 'createScript', name: scripts[0], steps: [{ name: 'Revert Transaction', params: { undecodedOptions: ['Condition'] } }] },
      { op: 'createScript', name: scripts[1], steps: [{ name: 'Set Revert Transaction on Error', params: { undecodedOptions: ['On/Off'] } }] },
      { op: 'createScript', name: scripts[2], steps: [{ name: 'Import Records', params: { undecodedOptions: ['Import mode'] } }] },
    ]);
    const warnings = () => scripts.map((name) => scriptText(store.schema.scripts.find((s) => s.name === name)!.steps));
    const before = warnings();
    store.close();
    const sql = new DatabaseSync(path);
    sql.prepare("UPDATE _fm_meta SET json = ? WHERE key = 'designVersion'").run(JSON.stringify(DESIGN_VERSION - 1));
    sql.close();
    assert.equal(needsDesigns(path), true);
    upgradeDesigns(path, fixture);
    assert.equal(needsDesigns(path), false);
    store = new Store(path, 'Charts');
    try {
      assert.deepEqual(warnings(), before);
      for (const name of scripts) {
        const step = store.schema.scripts.find((s) => s.name === name)!.steps[0];
        assert.ok(undecodedOptionError(step.stepId, step.params));
      }
    } finally { store.close(); }
  } finally { rmSync(dir, { recursive: true }); }
});

test('refresh of source metadata is not a guarantee against legacy structured snapshot replay', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-option-replay-'));
  const path = join(dir, 'Charts.sqlite');
  const db = FmpDatabase.open(fixture);
  try {
    importFmp12(fixture, path);
    const original = db.schema.scripts[0];
    const refreshed = structuredClone(db.schema);
    refreshed.scripts[0].steps = [{ stepId: 207, name: 'Revert Transaction', enabled: true, params: { undecodedOptions: ['Condition'] } }];
    // A legacy design log saved a snapshot after losing both flags and formulas.
    const store = new Store(path, 'Charts');
    store.applyDesign([{ op: 'updateScript', script: original.id, steps: [{ name: 'Revert Transaction' }] }]);
    store.close();
    const sql = new DatabaseSync(path);
    try {
      importDesigns(sql, { schema: refreshed, file: db.file } as FmpDatabase);
    } finally { sql.close(); }
    const reopened = new Store(path, 'Charts');
    try {
      const step = reopened.schema.scripts.find((s) => s.id === original.id)!.steps[0];
      assert.equal(step.params?.undecodedOptions, undefined, 'replayed snapshots can overwrite refreshed option evidence');
      assert.equal(undecodedOptionError(207, step.params, step.calculations), undefined, 'lost evidence is indistinguishable from unconditional rollback');
      assert.equal(scriptText([step]), 'Revert Transaction');
    } finally { reopened.close(); }
  } finally { db.close(); rmSync(dir, { recursive: true }); }
});

test('importDesigns refreshes open design and account caches without an audit event', { skip }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-live-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  const store = new Store(path);
  const db = FmpDatabase.open(fixture);
  t.after(() => { store.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
  const schema = structuredClone(db.schema);
  schema.scripts.push({ id: 12345, name: 'Imported script', steps: [] });
  const account = schema.accounts[0];
  account.inactive = true;
  store.sql.prepare("UPDATE _fm_accounts SET source = 'fmp12', inactive = 0 WHERE name = ?").run(account.name);
  store.sql.exec("DELETE FROM _fm_meta WHERE key = 'accountStatus'");
  const before = store.schema;
  const audit = store.securityToken();
  importDesigns(store.sql, { schema, file: db.file } as FmpDatabase);
  assert.notEqual(store.schema, before);
  assert.ok(store.schema.scripts.some((s) => s.name === 'Imported script'));
  assert.equal(store.accountInactive(account.name), true);
  assert.equal(store.securityToken(), audit, 'import does not rely on a security event');
});

// A user upgrades the program under stores an older build wrote. Two kinds of input:
//  - snapshots/store-*.sql: stores as an older build made them, checked in and never edited
//    (npm run store:snapshot adds one when the format changes);
//  - a store made now with the columns and tables later builds added taken out again.
// The current build must open each, upgrade it, read the old data, write to it, and open it again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/index.ts';
import { buildSampleStore } from './snapshots/sample-store.ts';

const snapshots = join(import.meta.dirname, 'snapshots');
const files = readdirSync(snapshots).filter((f) => /^store-.*\.sql$/.test(f)).sort();

const columns = (path: string, table: string) => {
  const sql = new DatabaseSync(path, { readOnly: true });
  try {
    return (sql.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);
  } finally {
    sql.close();
  }
};

let noteCount = 0;

/** Opens a store, checks what the sample put in is still readable, writes, and closes. */
function useStore(path: string): void {
  const store = new Store(path, 'Sample');
  try {
    const names = store.find('Clients', { limit: 10 }).records.map((r) => r.fieldData.Name).sort();
    assert.deepEqual(names.slice(0, 2), ['Ann Example', 'Bo Example']);
    const ann = store.find('Clients', { query: [{ Name: 'Ann Example' }] }).records[0];
    assert.equal(Number(ann.fieldData.Balance), 40);
    const photo = store.containerId('Clients', ann.recordId, 'Photo', 1);
    assert.ok(photo !== undefined && store.container(photo), 'the container file is still there');
    assert.ok(store.schema!.scripts.some((s) => s.name === 'Hello'));
    assert.ok(store.schema!.valueLists.some((v) => v.name === 'Tiers'));
    assert.equal(store.verify('Admin', 'sample passphrase 1'), true);
    const { recordId } = store.create('Clients', { Name: 'Cy Example', Balance: 1 }, { account: 'Admin' });
    store.update('Clients', recordId, { Balance: 2 }, undefined, { account: 'Admin' });
    store.applyDesign([{ op: 'createField', table: 'Clients', name: `Note${++noteCount}` }] as never);
    assert.ok(store.auditLog({ limit: 5 }).length > 0);
    store.createApiToken('Admin', { label: 'after upgrade', layouts: ['Clients'] });
  } finally {
    store.close();
  }
}

for (const file of files) {
  test(`${file}: an older store opens, upgrades, takes writes and opens again`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-compat-'));
    try {
      const path = join(dir, 'Sample.sqlite');
      const sql = new DatabaseSync(path);
      sql.exec(readFileSync(join(snapshots, file), 'utf8'));
      sql.close();
      useStore(path);
      useStore(path);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
}

test('a store from before later columns and tables were added is upgraded in place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-compat-'));
  try {
    const path = join(dir, 'Sample.sqlite');
    buildSampleStore(path);
    // What older builds lacked, taken out again.
    const added: [string, string][] = [['_fm_accounts', 'created_by'], ['_fm_accounts', 'needs_approval'], ['_fm_api_tokens', 'surfaces'], ['_fm_api_tokens', 'layouts'], ['_fm_containers', 'external']];
    const sql = new DatabaseSync(path);
    const dropped = added.filter(([t, c]) => columns(path, t).includes(c));
    for (const [t, c] of dropped) sql.exec(`ALTER TABLE "${t}" DROP COLUMN "${c}"`);
    for (const t of ['_fm_pending', '_fm_totp', '_fm_passkeys', '_fm_webauthn_challenges', '_fm_recovery_codes', '_fm_container_chunks']) sql.exec(`DROP TABLE IF EXISTS "${t}"`);
    sql.close();
    assert.ok(dropped.length >= 4, `the sample store should hold the migrated columns (dropped ${dropped.join(', ')})`);
    useStore(path);
    for (const [t, c] of dropped) assert.ok(columns(path, t).includes(c), `${t}.${c} is back after opening`);
    useStore(path);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('there is at least one snapshot, and its name says when it was made', () => {
  assert.ok(files.length >= 1);
  for (const f of files) assert.match(f, /^store-\d{4}-\d{2}-\d{2}\.sql$/);
});

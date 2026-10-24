import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import { prepareCaches } from '../src/preparation.ts';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-wide-open-'));
  const path = join(dir, 'Wide.sqlite');
  createStore(path);
  const store = new Store(path);
  store.applyDesign(Array.from({ length: 30 }, (_, i) => ({ op: 'createTable' as const, name: `T${i}`, fields: [{ name: 'Value', type: 'number' as const }] })));
  return { store, close: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('wide shared version setup batches missing triggers in one transaction and is read-only thereafter', (t) => {
  const { store, close } = fixture();
  t.after(close);
  const exec = store.sql.exec.bind(store.sql);
  let unbatched = 0, writes = 0;
  t.mock.method(store.sql, 'exec', (sql: string) => {
    if (/CREATE TRIGGER/i.test(sql)) {
      writes++;
      if (!store.sql.isTransaction) unbatched++;
    }
    return exec(sql);
  });
  store['versionTriggers']();
  assert.equal(unbatched, 0, 'trigger DDL must not commit once per table/event');
  assert.equal(writes, 1, 'one batch crosses the SQLite boundary');
  const stamp = () => (store.sql.prepare('SELECT n FROM _fm_data_version').get() as { n: number }).n;
  const before = stamp();
  store.sql.exec('INSERT INTO T0 (Value) VALUES (7); UPDATE T0 SET Value = 8; DELETE FROM T0');
  assert.equal(stamp(), before + 3);
  writes = 0;
  store['versionTriggers']();
  assert.equal(writes, 0);
  assert.equal(store.sql.isTransaction, false);
});

test('failed version setup rolls back its whole batch without rolling back its caller', (t) => {
  const { store, close } = fixture();
  t.after(close);
  store.sql.exec('BEGIN; INSERT INTO T0 (Value) VALUES (7)');
  const exec = store.sql.exec.bind(store.sql);
  let injected = false;
  const mock = t.mock.method(store.sql, 'exec', (sql: string) => {
    if (/CREATE TRIGGER/i.test(sql) && !injected) {
      injected = true;
      // Fail after the first DDL succeeded, not before any work was done.
      exec(sql.slice(0, sql.indexOf('END') + 3));
      throw new Error('synthetic trigger failure');
    }
    return exec(sql);
  });
  assert.throws(() => store['versionTriggers'](), /synthetic trigger failure/);
  mock.mock.restore();
  assert.equal(store.sql.isTransaction, true);
  assert.equal(store.sql.prepare("SELECT 1 FROM sqlite_master WHERE name = '_fm_data_version'").get(), undefined);
  assert.equal(store.sql.prepare("SELECT 1 FROM sqlite_master WHERE name GLOB '_fm_dv_*'").get(), undefined);
  assert.equal((store.sql.prepare('SELECT Value FROM T0').get() as { Value: number }).Value, 7);
  store.sql.exec('COMMIT');
  store['versionTriggers']();
  const before = (store.sql.prepare('SELECT n FROM _fm_data_version').get() as { n: number }).n;
  store.sql.exec('UPDATE T0 SET Value = 9');
  assert.equal((store.sql.prepare('SELECT n FROM _fm_data_version').get() as { n: number }).n, before + 1);
});

test('one layout and its theme are parsed once without materializing unrelated designs', (t) => {
  const { store, close } = fixture();
  t.after(close);
  const expected = JSON.parse((store.sql.prepare("SELECT json FROM _fm_meta WHERE key = 'designs'").get() as { json: string }).json);
  store.resetCaches();
  const meta = store['meta'].bind(store);
  let fullReads = 0, parsedLayouts = 0;
  t.mock.method(store as unknown as { meta: (key: string) => unknown }, 'meta', (key: string) => { if (key === 'designs') fullReads++; return meta(key); });
  const parse = JSON.parse;
  t.mock.method(JSON, 'parse', (text: string) => {
    const result = parse(text);
    if (result?.objects && result?.parts) parsedLayouts++;
    return result;
  });
  const first = store.design('T0');
  const themes = store.themes();
  assert.deepEqual(themes, expected.themes);
  for (let i = 0; i < 20; i++) assert.equal(store.themes(), themes);
  for (let i = 0; i < 20; i++) assert.equal(store.design('T0'), first);
  assert.deepEqual(first, expected.layouts[0]);
  assert.equal(fullReads, 0);
  assert.equal(parsedLayouts, 1);
  // A later whole-design request must retain exactly the same objects/output.
  assert.deepEqual(store.designs(), expected);
  assert.equal(store.designs().layouts[0], first);
  assert.equal(store.designs().themes, themes);
  assert.equal(fullReads, 1);
});

test('lazy layouts follow peer edits and rollback, and never retain a failed preparation', (t) => {
  const { store, close } = fixture();
  const peer = new Store(store.path);
  t.after(() => { peer.close(); close(); });
  const old = peer.design('T0')!;
  store.applyDesign([{ op: 'updateLayout', layout: 'T0', design: { width: 900 } }]);
  assert.equal(peer.design('T0')!.width, 900);
  assert.notEqual(peer.design('T0'), old);
  peer.sql.exec('BEGIN');
  peer.sql.exec("UPDATE _fm_meta SET json = json_set(json, '$.layouts[0].width', 777) WHERE key = 'designs'");
  assert.equal(peer.design('T0')!.width, 777);
  peer.sql.exec('ROLLBACK');
  assert.equal(peer.design('T0')!.width, 900);
  const before = peer.design('T0');
  assert.throws(() => prepareCaches(() => {
    store.applyDesign([{ op: 'updateLayout', layout: 'T0', design: { width: 800 } }]);
    assert.equal(peer.design('T0')!.width, 800);
    throw new Error('discard preparation');
  }), /discard preparation/);
  assert.equal(peer.design('T0')!.width, 800);
  assert.notEqual(peer.design('T0'), before);
});

test('themes refresh after peer writes, rollback and local design changes; a second layout promotes once', (t) => {
  const { store, close } = fixture();
  store.applyDesign([{ op: 'createTheme', name: 'First' }]);
  const peer = new Store(store.path);
  t.after(() => { peer.close(); close(); });
  const first = peer.design('T0');
  assert.equal(peer.themes()[0].name, 'First');
  assert.equal(peer['designCache'].value, undefined);
  peer.design('T1');
  assert.ok(peer['designCache'].value);
  assert.equal(peer.designs().layouts[0], first);
  store.sql.exec("UPDATE _fm_meta SET json = json_set(json, '$.themes[0].name', 'Second') WHERE key = 'designs'");
  assert.equal(peer.themes()[0].name, 'Second');
  peer.sql.exec("BEGIN; UPDATE _fm_meta SET json = json_set(json, '$.themes[0].name', 'Transient') WHERE key = 'designs'");
  assert.equal(peer.themes()[0].name, 'Transient');
  peer.sql.exec('ROLLBACK');
  assert.equal(peer.themes()[0].name, 'Second');
  peer.applyDesign([{ op: 'createTheme', name: 'Third' }]);
  assert.deepEqual(peer.themes().map((theme) => theme.name), ['Second', 'Third']);
});

test('valid JSON beyond SQLite JSON nesting limits retains the original layout and theme output', (t) => {
  const { store, close } = fixture();
  t.after(close);
  const designs = store.designs();
  let nested: unknown = 'synthetic';
  for (let i = 0; i < 1100; i++) nested = [nested];
  const layout = { ...designs.layouts[0], extension: nested };
  const saved = JSON.stringify({ ...designs, layouts: [layout, ...designs.layouts.slice(1)] });
  store.sql.prepare("UPDATE _fm_meta SET json = ? WHERE key = 'designs'").run(saved);
  assert.equal(JSON.stringify(store.design('T0')), JSON.stringify(layout));
  store.resetCaches();
  assert.deepEqual(store.themes(), designs.themes);
});

// Tables are named by the file they come from, so a table may be called constructor, toString or __proto__:
// the per-table lists of repeating fields must not read the prototype of a plain object for such a name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import { ownKeyed } from '../src/own-keys.ts';

const NAMES = ['constructor', 'toString', '__proto__', 'hasOwnProperty'];

test('a table named like an inherited key has no repeating fields, and is not an error to ask about', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-repeating-names-'));
  try {
    createStore(join(dir, 't.sqlite'));
    const store = new Store(join(dir, 't.sqlite'), 'T');
    try {
      store.applyDesign(NAMES.map((name) => ({ op: 'createTable', name, fields: [{ name: 'F', type: 'text' }] })) as never);
      for (const name of NAMES) assert.equal(store.isRepeating(name, 'F'), false, name);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ownKeyed keeps a __proto__ key as data, from JSON and on assignment, and survives a JSON round trip', () => {
  const read = ownKeyed(JSON.parse('{"__proto__":["A"],"constructor":["B"]}') as Record<string, string[]>);
  assert.equal(Object.getPrototypeOf(read), null);
  assert.deepEqual(read['__proto__'], ['A']);
  assert.deepEqual(read.constructor, ['B']);
  const list = (read['toString'] ??= []);
  list.push('C');
  assert.equal(Object.getPrototypeOf(Object.prototype), null, 'Object.prototype is untouched');
  assert.deepEqual(JSON.parse(JSON.stringify(read)), { ['__proto__']: ['A'], constructor: ['B'], toString: ['C'] });
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(read)), '__proto__'), true);
  assert.deepEqual(ownKeyed(undefined), Object.create(null));
});

// The meta lists (repeating, globals, serials) are renamed and trashed by name: a table or field named like an
// inherited key must not reach Object.prototype, or lose its own entry.
function withMeta(fn: (store: Store, dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-meta-names-'));
  const original = Object.getOwnPropertyDescriptor(Object.prototype, 'toString')!;
  try {
    createStore(join(dir, 't.sqlite'));
    const store = new Store(join(dir, 't.sqlite'), 'T');
    try {
      store.applyDesign([
        { op: 'createTable', name: 'Other', fields: [{ name: 'x', type: 'text' }] },
        { op: 'createTable', name: '__proto__', fields: [{ name: 'toString', type: 'text' }, { name: 'F', type: 'text' }] },
      ] as never);
      const put = store.sql.prepare('INSERT INTO _fm_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json');
      put.run('repeating', JSON.stringify({ Other: ['x'] }));
      put.run('globals', JSON.stringify({ Other: { x: '1' } }));
      put.run('serials', JSON.stringify({ Other: { x: 1 } }));
      fn(store, dir);
    } finally {
      store.close();
    }
  } finally {
    if (!Object.getOwnPropertyDescriptor(Object.prototype, 'toString')) Object.defineProperty(Object.prototype, 'toString', original);
    rmSync(dir, { recursive: true, force: true });
  }
}
const intact = () => assert.equal(typeof ({}).toString, 'function', 'Object.prototype.toString is still there');

test('renaming a field named toString in a table named __proto__ leaves Object.prototype alone', () => {
  withMeta((store) => {
    store.applyDesign([{ op: 'updateField', table: '__proto__', field: 'toString', name: 'Renamed' }] as never);
    intact();
    assert.equal(store.isRepeating('__proto__', 'Renamed'), false);
  });
});

test('renaming a table named __proto__ does not break isRepeating or leave a bad entry in the saved lists', () => {
  withMeta((store, dir) => {
    store.applyDesign([{ op: 'renameTable', table: '__proto__', name: 'Moved' }] as never);
    intact();
    assert.equal(store.isRepeating('Moved', 'F'), false);
    for (const key of ['repeating', 'globals', 'serials']) {
      const saved = JSON.parse((store.sql.prepare('SELECT json FROM _fm_meta WHERE key = ?').get(key) as { json: string }).json) as Record<string, unknown>;
      assert.deepEqual(Object.keys(saved), ['Other'], key);
    }
    const again = new Store(join(dir, 't.sqlite'), 'T2');
    try { assert.equal(again.isRepeating('Moved', 'F'), false); } finally { again.close(); }
  });
});

test('deleting a table named __proto__ keeps nothing of the prototype and leaves isRepeating working', () => {
  withMeta((store) => {
    store.applyDesign([{ op: 'deleteTable', table: '__proto__' }] as never);
    intact();
    const kept = store.sql.prepare("SELECT meta FROM _fm_deleted WHERE kind = 'table'").get() as { meta: string };
    assert.equal(kept.meta, '{}');
    assert.equal(store.isRepeating('Other', 'x'), true);
  });
});

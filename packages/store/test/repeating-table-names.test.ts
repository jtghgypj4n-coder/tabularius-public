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

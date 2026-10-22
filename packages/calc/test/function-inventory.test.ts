import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FUNCTIONS } from '../src/functions.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateText, NameTable, type CalcContext } from '../src/index.ts';
import { GET_DEFAULT_NAMES } from '../src/get.ts';
import { GET_NAMES } from '../src/get-names.ts';
import { ENGINE_ONLY, GET_FROM_RUN, GET_SERVER_DEFAULT, IMPLEMENTED, INVENTORY, LANGUAGE_FORMS, NOT_IMPLEMENTED, NOT_IMPLEMENTED_REASON } from './function-inventory.data.ts';

test('Claris function inventory is complete and the engine support snapshot has no drift', () => {
  const names = INVENTORY.map(({ name }) => name.toLowerCase());
  assert.equal(new Set(names).size, names.length, 'catalog names must be unique');
  assert.ok(INVENTORY.every(({ pageUrl }) => pageUrl.startsWith('https://help.claris.com/en/pro-help/content/')));

  const actual = [...FUNCTIONS.keys()].sort();
  // Get ( parameter ) is one function; its parameters are implemented when the engine knows the name (see the matrix below).
  const implemented = (name: string) => FUNCTIONS.has(name) || (LANGUAGE_FORMS as readonly string[]).includes(name) || (name.startsWith('get(') && GET_NAMES.has(name.slice(4, -1)));
  assert.deepEqual([...IMPLEMENTED].sort(), names.filter(implemented).sort(), 'implemented catalog membership changed; update the inventory snapshots');
  assert.deepEqual([...NOT_IMPLEMENTED].sort(), names.filter((name) => !implemented(name)).sort(), 'unimplemented catalog membership changed; update the inventory snapshots');
  assert.deepEqual([...new Set([...IMPLEMENTED.filter((name) => FUNCTIONS.has(name)), ...ENGINE_ONLY])].sort(), actual, 'engine function names changed; update the catalog or engine-only snapshot');
});

const ctx = { names: new NameTable({ fields: [], occurrences: [] }), occurrence: 'T', field: () => { throw new Error('no fields'); }, related: () => [], now: () => new Date(2026, 9, 15, 14, 30, 0) } as unknown as CalcContext;

test('Pi and Let are language forms the parser reads, so they count as implemented', () => {
  assert.ok(!FUNCTIONS.has('pi') && !FUNCTIONS.has('let'));
  assert.equal(evaluateText('Pi', ctx), '3.141592653589793');
  assert.equal(evaluateText('Let ( [ x = 2 ; y = 3 ] ; x * y )', ctx), '6');
});

test('every Get parameter on the Claris page is classified once: answered from the run, or a server default', () => {
  const claris = INVENTORY.filter((f) => f.category === 'Get').map((f) => f.name.slice(4, -1).toLowerCase());
  assert.equal(claris.length, 138);
  assert.deepEqual([...GET_FROM_RUN, ...GET_SERVER_DEFAULT].sort(), claris.sort());
  assert.ok(claris.every((name) => GET_NAMES.has(name)));
  // The default answer exists for every name no run supplies; the run supplies the rest.
  for (const name of GET_SERVER_DEFAULT) assert.ok(GET_DEFAULT_NAMES.has(name), `${name} has a server default`);
  for (const name of GET_FROM_RUN) assert.ok(!GET_SERVER_DEFAULT.includes(name as never));
});

test('the Get matrix follows the cases the script engine and the stored calculation answer', () => {
  const root = join(import.meta.dirname, '../../..');
  const read = (file: string, from: string, to: string) => {
    const text = readFileSync(join(root, file), 'utf8');
    return text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));
  };
  const cases = (text: string) => new Set([...text.matchAll(/case '([a-z]+)'/g)].map((m) => m[1]));
  const engine = cases(read('packages/scripts/src/engine.ts', 'private get(f: Frame, name: string)', 'private design(win: Window'));
  const stored = cases(read('packages/store/src/calc.ts', 'get: (name) => {', "// $$variables are the session's"));
  const answered = [...GET_FROM_RUN, ...GET_SERVER_DEFAULT].filter((name) => engine.has(name) || stored.has(name)).sort();
  assert.deepEqual(answered, [...GET_FROM_RUN].sort(), 'a Get parameter moved between "from the run" and "server default"; update the matrix in function-inventory.data.ts');
});

test('every function still not implemented says why', () => {
  assert.deepEqual(Object.keys(NOT_IMPLEMENTED_REASON).sort(), [...NOT_IMPLEMENTED].sort());
  for (const reason of Object.values(NOT_IMPLEMENTED_REASON)) assert.ok(reason.length > 10);
});

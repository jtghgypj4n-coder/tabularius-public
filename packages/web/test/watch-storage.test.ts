import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Api } from '../src/api.ts';
import { openWatches } from '../src/watch-storage.ts';

const session = { db: 'Synthetic', token: 'admin-session' };
const key = 'tabularius.dataviewer.watch.account.' + JSON.stringify([session.db, 'Admin']);
const watches = ['"saved expression"'];

function setup(t: TestContext) {
  for (const name of ['localStorage', 'sessionStorage']) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, name, { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  sessionStorage.setItem('tabularius.session', JSON.stringify(session));
  localStorage.setItem(key, JSON.stringify(watches));
  localStorage.setItem(`${key}.tab`, '"current"');
  t.mock.method(Api.prototype, 'menu', async () => ({ database: session.db, account: 'Admin', layouts: [] }));
  const denied: string[] = [];
  return { denied, deny: (message: string) => { denied.push(message); } };
}

for (const [label, error] of [
  ['network failure', new TypeError('Failed to fetch')],
  ['abort', new DOMException('Request aborted', 'AbortError')],
  ['server failure', Object.assign(new Error('Unavailable'), { status: 500, code: -1 })],
  ['missing endpoint', Object.assign(new Error('Not found'), { status: 404, code: 404 })],
  ['calculation failure', Object.assign(new Error('No records'), { status: 500, code: 401 })],
] as const) {
  test(`opening watches preserves saved expressions and tab after ${label}`, async (t) => {
    const { denied, deny } = setup(t);
    await assert.rejects(openWatches(session, deny, async () => { throw error; }), (e) => e === error);
    assert.deepEqual(denied, []);
    assert.equal(localStorage.getItem(key), JSON.stringify(watches));
    assert.equal(localStorage.getItem(`${key}.tab`), '"current"');
    const storage = await openWatches(session, deny, async () => {});
    assert.deepEqual(storage.get(), watches);
  });
}

for (const fields of [
  { status: 401, code: -1 }, { status: 403, code: 123 },
  { status: 500, code: 9 }, { status: 400, code: 952 },
]) {
  test(`opening watches clears only this account on denial ${JSON.stringify(fields)}`, async (t) => {
    const { denied, deny } = setup(t);
    const otherKey = 'tabularius.dataviewer.watch.account.' + JSON.stringify([session.db, 'Other']);
    localStorage.setItem(otherKey, '["other expression"]');
    const error = Object.assign(new Error('Access denied'), fields);
    await assert.rejects(openWatches(session, deny, async () => { throw error; }), (e) => e === error);
    assert.deepEqual(denied, ['Access denied']);
    assert.equal(localStorage.getItem(key), null);
    assert.equal(localStorage.getItem(`${key}.tab`), null);
    assert.equal(localStorage.getItem(otherKey), '["other expression"]');
  });
}

for (const fails of [false, true]) {
  test(`session change during ${fails ? 'failed' : 'successful'} authorization clears the old watches`, async (t) => {
    const { denied, deny } = setup(t);
    await assert.rejects(openWatches(session, deny, async () => {
      sessionStorage.setItem('tabularius.session', JSON.stringify({ ...session, token: 'other-session' }));
      if (fails) throw new TypeError('Failed to fetch');
    }));
    assert.equal(denied.length, 1);
    assert.equal(localStorage.getItem(key), null);
    assert.equal(localStorage.getItem(`${key}.tab`), null);
  });
}

// What the browser keeps on this device besides an offline copy (saved finds, sorts, recent records, watch lists,
// the tab's session state), and when it is removed: at sign-out, when a session ends, and after 30 days.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { forgetOnSignOut, keptSet, prefStorageKey, purgeExpiredKept } from '../src/device-data.ts';

function stores(t: TestContext) {
  const made: Record<string, Map<string, string>> = {};
  for (const name of ['localStorage', 'sessionStorage']) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    const values = new Map<string, string>();
    made[name] = values;
    Object.defineProperty(globalThis, name, { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
      key: (i: number) => [...values.keys()][i] ?? null,
      get length() { return values.size; },
    } });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  return { local: made.localStorage, session: made.sessionStorage };
}

const DAY = 86_400_000;
const watchKey = (db: string, account: string) => `tabularius.dataviewer.watch.account.${JSON.stringify([db, account])}`;

test('pref keys name the file and the account', () => {
  assert.equal(prefStorageKey('finds', 'Shop', 'Admin'), 'tabularius.finds.Shop.Admin');
  assert.equal(prefStorageKey('recent', 'Shop', 'Ann'), 'tabularius.recent.Shop.Ann');
});

test('signing out removes the account\'s saved finds, sorts, recent records and watch lists, and the tab\'s session state', (t) => {
  const { local, session } = stores(t);
  for (const name of ['finds', 'sorts', 'recent'] as const) {
    keptSet(prefStorageKey(name, 'Shop', 'Admin'), '[{"query":"SYNTHETIC_PRIVATE_TEXT"}]');
    keptSet(prefStorageKey(name, 'Shop', 'Ann'), '[]');
    keptSet(prefStorageKey(name, 'Other', 'Admin'), '[]');
  }
  local.set(watchKey('Shop', 'Admin'), '["expr"]');
  local.set(`${watchKey('Shop', 'Admin')}.tab`, '"t"');
  local.set('tabularius.table.Shop.Items', '[{"key":"Name","width":120}]');
  local.set('openhbam.account', 'Admin');
  for (const k of ['tabularius.session', 'tabularius.return', 'tabularius.layout.Shop', 'tabularius.assistant.Shop', 'tabularius.windowRecord', 'tabularius.menuSet', 'tabularius.opened']) session.set(k, '{"x":"SYNTHETIC_PRIVATE_TEXT"}');
  session.set('unrelated', '1');

  forgetOnSignOut('Shop', 'Admin');

  assert.deepEqual([...local.keys()].filter((k) => k.includes('SYNTHETIC')), []);
  for (const name of ['finds', 'sorts', 'recent']) assert.equal(local.has(prefStorageKey(name, 'Shop', 'Admin')), false, name);
  assert.equal(local.has(watchKey('Shop', 'Admin')), false);
  assert.equal(local.has(`${watchKey('Shop', 'Admin')}.tab`), false);
  // Another account's, another file's, and screen settings are not this account's record data.
  for (const name of ['finds', 'sorts', 'recent']) {
    assert.equal(local.has(prefStorageKey(name, 'Shop', 'Ann')), true, `${name} of another account`);
    assert.equal(local.has(prefStorageKey(name, 'Other', 'Admin')), true, `${name} of another file`);
  }
  assert.equal(local.has('tabularius.table.Shop.Items'), true);
  assert.equal(local.has('openhbam.account'), true);
  assert.deepEqual([...session.keys()], ['unrelated'], 'everything the tab kept for the session, and only that');
});

test('signing out keeps the prefs that never reached the server while an offline copy holds them', (t) => {
  const { local } = stores(t);
  for (const name of ['finds', 'sorts', 'recent'] as const) keptSet(prefStorageKey(name, 'Shop', 'Admin'), '[]');
  forgetOnSignOut('Shop', 'Admin', ['sorts']);
  assert.equal(local.has(prefStorageKey('sorts', 'Shop', 'Admin')), true);
  assert.equal(local.has(prefStorageKey('finds', 'Shop', 'Admin')), false);
  assert.equal(local.has(prefStorageKey('recent', 'Shop', 'Admin')), false);
});

test('signing out works when the browser gives no storage at all', (t) => {
  stores(t);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
  assert.doesNotThrow(() => forgetOnSignOut('Shop', 'Admin'));
  assert.doesNotThrow(() => keptSet('tabularius.finds.Shop.Admin', '[]'));
  assert.doesNotThrow(() => purgeExpiredKept());
});

test('what is kept for later is removed after 30 days without being written again', (t) => {
  const { local } = stores(t);
  const now = Date.now();
  const clock = t.mock.method(Date, 'now', () => now);
  const old = prefStorageKey('finds', 'Shop', 'Admin');
  const fresh = prefStorageKey('recent', 'Shop', 'Admin');
  keptSet(old, '["old"]');
  clock.mock.mockImplementation(() => now + 20 * DAY);
  keptSet(fresh, '["fresh"]');
  clock.mock.mockImplementation(() => now + 29 * DAY);
  purgeExpiredKept();
  assert.equal(local.has(old), true, 'day 29');
  clock.mock.mockImplementation(() => now + 31 * DAY);
  purgeExpiredKept();
  assert.equal(local.has(old), false, 'day 31');
  assert.equal(local.has(fresh), true, 'written 11 days ago');
  clock.mock.mockImplementation(() => now + 51 * DAY);
  purgeExpiredKept();
  assert.equal(local.has(fresh), false);
  assert.deepEqual([...local.keys()], [], 'the list of times does not outlive what it lists');
});

test('what an earlier version kept, with no time written, gets its 30 days from first sight, and what is not a pref is left alone', (t) => {
  const { local } = stores(t);
  const now = Date.now();
  const clock = t.mock.method(Date, 'now', () => now);
  const legacy = prefStorageKey('finds', 'Shop', 'Admin');
  local.set(legacy, '["kept by an earlier version"]');
  local.set('tabularius.table.Shop.Items', '[]');
  purgeExpiredKept();
  assert.equal(local.has(legacy), true);
  clock.mock.mockImplementation(() => now + 31 * DAY);
  purgeExpiredKept();
  assert.equal(local.has(legacy), false);
  assert.equal(local.has('tabularius.table.Shop.Items'), true);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWrite, relayedChange, relayedFrom } from '../src/change-relay.ts';
import { reconnectDelay } from '../src/live.ts';
import { mergeList, mergePrefs } from '../src/prefs-merge.ts';
import { retrying, unreachableRequest, ApiError } from '../src/api.ts';

const records = '/fmi/data/vLatest/databases/Charts/layouts/Congress/records';

test('requests that change data are told to the other windows; reads and plans are not', () => {
  assert.deepEqual(classifyWrite('PATCH', `${records}/7`), { kind: 'update', layout: 'Congress', recordId: '7' });
  assert.deepEqual(classifyWrite('POST', records), { kind: 'create', layout: 'Congress' });
  assert.deepEqual(classifyWrite('DELETE', `${records}/7`), { kind: 'delete', layout: 'Congress', recordId: '7' });
  assert.deepEqual(classifyWrite('POST', `${records}/7/containers/Photo/1`), { kind: 'update', layout: 'Congress', recordId: '7' });
  assert.deepEqual(classifyWrite('DELETE', `${records}/7/containers/Photo/1`), { kind: 'update', layout: 'Congress', recordId: '7' });
  assert.deepEqual(classifyWrite('PATCH', `/fmi/data/vLatest/databases/Charts/layouts/Our%20Layout/records/9%2F1`), { kind: 'update', layout: 'Our Layout', recordId: '9/1' });
  const app = '/tabularius/app/v1/databases/Charts/layouts/Congress';
  assert.deepEqual(classifyWrite('POST', `${app}/button`), { kind: 'reload' });
  assert.deepEqual(classifyWrite('POST', '/tabularius/app/v1/databases/Charts/runs/r1/file'), { kind: 'reload' });
  assert.deepEqual(classifyWrite('POST', `${app}/import?columns=%5B%5D&skipDuplicates=0&skipIssues=0`), { kind: 'reload' });
  assert.deepEqual(classifyWrite('POST', '/tabularius/cleanup/v1/databases/Charts/history/abc/undo'), { kind: 'reload' });
  assert.equal(classifyWrite('GET', `${records}/7`), undefined);
  assert.equal(classifyWrite('POST', `${records.replace('/records', '')}/_find`), undefined);
  assert.equal(classifyWrite('POST', `${app}/import?preview=1`), undefined);
  assert.equal(classifyWrite('POST', `${app}/import?plan=1&ai=1`), undefined);
  for (const read of ['view', 'groups', 'index', 'charts', 'menus', 'refresh', 'position', 'foundset', 'explain', 'history', 'records']) {
    assert.equal(classifyWrite('POST', `${app}/${read}`), undefined, read);
  }
  assert.equal(classifyWrite('PUT', '/tabularius/app/v1/databases/Charts/prefs/finds'), undefined);
  assert.equal(classifyWrite('POST', '/tabularius/app/v1/databases/Charts/runs/stop'), undefined);
});

test('a change heard from a sibling window is someone else\'s, for this session only', () => {
  const heard = relayedFrom({ kind: 'update', layout: 'Congress', recordId: '7', token: 'tok', file: 'Charts', table: 'Congress' }, 'tok')!;
  assert.deepEqual(relayedChange(heard), { kind: 'update', file: 'Charts', table: 'Congress', recordId: 7, self: false });
  assert.deepEqual(relayedChange({ ...heard, kind: 'reload', recordId: undefined }), { kind: 'truncate', file: 'Charts', table: 'Congress', self: false });
  assert.equal(relayedFrom({ kind: 'update', recordId: '7', token: 'other', file: 'Charts', table: 'Congress' }, 'tok'), undefined);
  assert.equal(relayedFrom({ kind: 'bogus', token: 'tok', file: 'Charts', table: 'Congress' }, 'tok'), undefined);
  assert.equal(relayedFrom(null, 'tok'), undefined);
  assert.equal(relayedFrom('x', 'tok'), undefined);
});

test('reconnecting waits longer after each failure, up to 30 seconds', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 20].map((n) => reconnectDelay(n, 0)), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  assert.equal(reconnectDelay(1, 1), 1250);
  assert.ok(reconnectDelay(20, 1) <= 37_500);
});

test('merging a list keeps this window\'s edits and what other windows added, not what this one removed', () => {
  const key = (x: { n: string }) => x.n;
  const a = { n: 'a' }, b = { n: 'b' }, c = { n: 'c' }, d = { n: 'd' };
  // Base [a, b]. This window removed b and added c; another added d: the server holds [a, b, d].
  assert.deepEqual(mergeList([a, b, d], [a, b], [a, c], key), [a, c, d]);
  // Nothing new anywhere.
  assert.deepEqual(mergeList([a, b], [a, b], [a, b], key), [a, b]);
  // No base (first send from a browser that kept its own): the server's extras are kept.
  assert.deepEqual(mergeList([d], undefined, [a], key), [a, d]);
  // The server has nothing (never saved).
  assert.deepEqual(mergeList(undefined, undefined, [a], key), [a]);
  // Mine renames nothing: the same key keeps my version.
  assert.deepEqual(mergeList([{ n: 'a', v: 1 } as { n: string }], [{ n: 'a' }], [{ n: 'a', v: 2 } as { n: string }], key), [{ n: 'a', v: 2 }]);
});

test('merging prefs treats saved finds, recent finds, sorts and recent records by their own keys', () => {
  const find = (name: string, layout = 'L') => ({ name, layout, requests: [] });
  const merged = mergePrefs('finds', { saved: [find('theirs')], recent: [find('r-theirs')] }, { saved: [], recent: [] }, { saved: [find('mine')], recent: [find('r-mine')] }) as { saved: { name: string }[]; recent: { name: string }[] };
  assert.deepEqual(merged.saved.map((f) => f.name), ['mine', 'theirs']);
  assert.deepEqual(merged.recent.map((f) => f.name), ['r-mine', 'r-theirs']);
  // The same name on another layout is another find.
  const two = mergePrefs('finds', { saved: [find('x', 'B')] }, {}, { saved: [find('x', 'A')] }) as { saved: { layout: string }[] };
  assert.deepEqual(two.saved.map((f) => f.layout), ['A', 'B']);
  // Recent finds are cut to ten, newest (this window's) first.
  const many = mergePrefs('finds', { recent: Array.from({ length: 10 }, (_, i) => find(`s${i}`)) }, { recent: [] }, { recent: Array.from({ length: 6 }, (_, i) => find(`m${i}`)) }) as { recent: { name: string }[] };
  assert.equal(many.recent.length, 10);
  assert.deepEqual(many.recent.slice(0, 7).map((f) => f.name), ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 's0']);
  const sorts = mergePrefs('sorts', [{ name: 's', layout: 'L', sort: [] }], [], [{ name: 'q', layout: 'L', sort: [] }]) as { name: string }[];
  assert.deepEqual(sorts.map((x) => x.name), ['q', 's']);
  const recent = mergePrefs('recent', [{ layout: 'L', recordId: '2', title: 't' }], [], [{ layout: 'L', recordId: '1', title: 't' }]) as { recordId: string }[];
  assert.deepEqual(recent.map((x) => x.recordId), ['1', '2']);
  // A server value of the wrong shape is ignored rather than breaking the send.
  assert.deepEqual(mergePrefs('sorts', 'junk', undefined, [{ name: 'q', layout: 'L', sort: [] }]), [{ name: 'q', layout: 'L', sort: [] }]);
});

test('a request that never reached the server is tried again; one the server answered is not', async () => {
  let calls = 0;
  const flaky = () => (++calls < 3 ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve('saved'));
  assert.equal(await retrying(flaky, [1, 1]), 'saved');
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(retrying(() => (calls++, Promise.reject(new TypeError('Failed to fetch'))), [1, 1]), /Failed to fetch/);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(retrying(() => (calls++, Promise.reject(new ApiError(306, 'modified'))), [1, 1]), /modified/);
  assert.equal(calls, 1);
  assert.equal(unreachableRequest(new Error('NetworkError when attempting to fetch resource.')), true);
  assert.equal(unreachableRequest(new Error('Load failed')), true);
  assert.equal(unreachableRequest(new ApiError(-1, 'HTTP 502')), false);
  assert.equal(unreachableRequest(new Error('boom')), false);
});

test('a session that ended stops renewing its locks: dispose clears the timers, and a lock still being taken starts none', async (t) => {
  const { Locks } = await import('../src/live.ts');
  t.mock.timers.enable({ apis: ['setInterval'] });
  const calls: string[] = [];
  let release: (() => void) | undefined;
  t.mock.method(globalThis, 'fetch', async (url: string, init?: { method?: string }) => {
    calls.push(`${init?.method} ${url}`);
    if (url.includes('/records/2/')) await new Promise<void>((ok) => (release = ok));
    return { ok: true, json: async () => ({}) } as Response;
  });
  const locks = new Locks({ db: 'Shop', token: 't' } as never);
  await locks.acquire('Customers', '1');
  t.mock.timers.tick(20_000);
  assert.equal(calls.length, 2, 'renewed while the session lives');
  const pending = locks.acquire('Customers', '2');
  locks.dispose();
  release!();
  await pending;
  const sent = calls.length;
  t.mock.timers.tick(120_000);
  assert.equal(calls.length, sent, 'nothing is renewed after dispose');
  assert.equal(locks.holds('Customers', '1'), false);
});

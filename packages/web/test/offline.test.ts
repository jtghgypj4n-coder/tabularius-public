import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CopyMoved, OfflineCopy, copyKey, deriveBits, exportKey, importKey, memoryShelf, newSalt, type CopyKey } from '../src/offline.ts';

const deriveKey = async (password: string, salt: Uint8Array): Promise<CopyKey> => copyKey(await deriveBits(password, salt));
import { Api, ApiError, OFFLINE, keepable } from '../src/api.ts';

async function copyFor(shelf = memoryShelf(), password = 'secret', db = 'Tasks', account = 'Admin') {
  const salt = newSalt();
  const key = await deriveKey(password, salt);
  return { shelf, salt, key, copy: await OfflineCopy.create(shelf, db, account, salt, key) };
}

test('offline copy: opens only with the password that made it, and removing it deletes everything', async () => {
  const { shelf, salt, copy } = await copyFor();
  await copy.keep('GET /x', { ok: 1 });
  await copy.queue({ layout: 'L', recordId: '1', fieldData: { a: 'x' } });
  assert.deepEqual(await OfflineCopy.list(shelf), [{ db: 'Tasks', account: 'Admin' }]);
  // Account names are matched as FileMaker matches them, without case.
  const again = await OfflineCopy.open(shelf, 'Tasks', 'admin', await deriveKey('secret', salt));
  assert.ok(again instanceof OfflineCopy);
  assert.deepEqual(await again.recall('GET /x'), { ok: 1 });
  assert.equal(await OfflineCopy.open(shelf, 'Tasks', 'Admin', await deriveKey('guess', salt)), 'wrong');
  assert.equal(await OfflineCopy.open(shelf, 'Other', 'Admin', await deriveKey('secret', salt)), undefined);
  // A session's exported key opens it too (a reload).
  const k = await importKey(exportKey('Admin', salt, await deriveBits('secret', salt)));
  assert.ok(await OfflineCopy.open(shelf, 'Tasks', 'Admin', k.key) instanceof OfflineCopy);
  await OfflineCopy.remove(shelf, 'Tasks', 'Admin');
  assert.equal(shelf.data.files.size + shelf.data.responses.size + shelf.data.queue.size, 0);
});

test('offline copy: what is kept is encrypted, named without what was asked, and bound to its name', async () => {
  const { shelf, copy } = await copyFor();
  await copy.keep('POST /fmi/data/vLatest/databases/Tasks/layouts/People/_find\u0000{"query":[{"SSN":"123-45-6789"}]}', { ok: { fieldData: { Title: 'Quarterly plan' } } });
  await copy.keep('GET /records/2', { ok: { fieldData: { Title: 'Other' } } });
  await copy.queue({ layout: 'People', recordId: '42', modId: '1', fieldData: { SSN: '987-65-4321' } });
  const stored = JSON.stringify([...shelf.data.responses.values(), ...shelf.data.queue.values()].map((v) => [...new Uint8Array((v as { data: ArrayBuffer }).data)]));
  assert.doesNotMatch(Buffer.from(stored).toString(), /Quarterly/);
  // Only the file and account names are readable; the rest of each name is an HMAC.
  for (const name of [...shelf.data.responses.keys(), ...shelf.data.queue.keys()]) assert.match(name, /^Tasks\u0000admin\u0000[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await copy.recall('GET /records/2'), { ok: { fieldData: { Title: 'Other' } } });
  const [k1, k2] = [...shelf.data.responses.keys()];
  // Swapping two entries doesn't pass one off as the other.
  const v1 = shelf.data.responses.get(k1);
  shelf.data.responses.set(k1, shelf.data.responses.get(k2));
  shelf.data.responses.set(k2, v1);
  assert.equal(await copy.recall('GET /records/2'), undefined);
});

test('offline copy: changes to one record merge, keep the first modId, and drop formatting of retyped text', async () => {
  const { copy } = await copyFor();
  await copy.queue({ layout: 'L', recordId: '7', modId: '3', fieldData: { Notes: 'a' }, styles: { Notes: [{ start: 0, end: 1, style: 256 }] } });
  await copy.queue({ layout: 'L', recordId: '8', modId: '1', fieldData: { Title: 'b' } });
  await copy.queue({ layout: 'L', recordId: '7', modId: '4', fieldData: { Notes: 'abc', Title: 't' } });
  const pending = await copy.pending();
  assert.equal(pending.length, 2);
  const seven = pending.find((e) => e.recordId === '7')!;
  assert.equal(seven.modId, '3');
  assert.deepEqual(seven.fieldData, { Notes: 'abc', Title: 't' });
  assert.equal(seven.styles, undefined);
  await copy.settle((await copy.pendingFor('L', '8'))!);
  assert.deepEqual((await copy.pending()).map((e) => e.recordId), ['7']);
});

test('offline copy: a change shows in the kept responses of its layout only', async () => {
  const { copy } = await copyFor();
  await copy.keep('GET /fmi/data/vLatest/databases/D/layouts/Tasks/records/5', { ok: { data: [{ recordId: '5', modId: '1', fieldData: { Title: 'old' }, styles: { Title: [] } }] } });
  await copy.keep('GET /fmi/data/vLatest/databases/D/layouts/People/records/5', { ok: { data: [{ recordId: '5', fieldData: { Title: 'person' } }] } });
  await copy.patch('/layouts/Tasks/', '5', { Title: 'new' });
  assert.deepEqual(await copy.recall('GET /fmi/data/vLatest/databases/D/layouts/Tasks/records/5'), { ok: { data: [{ recordId: '5', modId: '1', fieldData: { Title: 'new' }, styles: {} }] } });
  assert.deepEqual(await copy.recall('GET /fmi/data/vLatest/databases/D/layouts/People/records/5'), { ok: { data: [{ recordId: '5', fieldData: { Title: 'person' } }] } });
});

test('offline copy: only reads are kept', () => {
  const d = '/fmi/data/vLatest/databases/D/layouts/L';
  assert.ok(keepable('GET', `${d}/records?_offset=1&_limit=50`));
  assert.ok(keepable('GET', `${d}/records/4`));
  assert.ok(keepable('POST', `${d}/_find`));
  assert.ok(keepable('GET', '/tabularius/app/v1/databases/D/layouts'));
  assert.ok(keepable('POST', '/tabularius/app/v1/databases/D/layouts/L/view'));
  assert.ok(!keepable('POST', `${d}/records`));
  assert.ok(!keepable('PATCH', `${d}/records/4`));
  assert.ok(!keepable('GET', `${d}/script/Send%20Mail`));
  assert.ok(!keepable('GET', `${d}/records?script=Send`));
  assert.ok(!keepable('POST', '/tabularius/app/v1/databases/D/layouts/L/button'));
  assert.ok(!keepable('POST', '/tabularius/app/v1/databases/D/layouts/L/import'));
});

/** Runs fn with fetch answering from `respond`, or failing as a dropped connection when it returns undefined. */
async function withFetch<T>(respond: (method: string, url: string, body: unknown) => { status: number; json: unknown } | undefined, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const r = respond(init?.method ?? 'GET', String(url), init?.body ? JSON.parse(String(init.body)) : undefined);
    if (!r) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const ok = (response: unknown) => ({ status: 200, json: { response, messages: [{ code: '0', message: 'OK' }] } });
const fail = (code: number, message: string) => ({ status: 500, json: { response: {}, messages: [{ code: String(code), message }] } });

test('offline copy: without a connection, reads come from the copy and field changes wait', async () => {
  const { copy } = await copyFor();
  const api = new Api('D', 'tok');
  api.offline = copy;
  const record = { recordId: '5', modId: '2', fieldData: { Title: 'old' }, portalData: {} };
  const writes: Promise<void>[] = [];
  const keep = copy.keep.bind(copy);
  copy.keep = (...args) => {
    const write = keep(...args);
    writes.push(write);
    return write;
  };
  await withFetch(() => ok({ data: [record] }), () => api.record('L', '5'));
  assert.equal(writes.length, 1, 'the online read starts a copy write');
  await Promise.all(writes);
  const offline = await withFetch(() => undefined, async () => {
    const r = await api.record('L', '5');
    assert.equal(api.isOffline, true);
    assert.equal(await api.update('L', '5', { Title: 'mine' }, { modId: '2' }), '2');
    // Not opened before: not in the copy.
    await assert.rejects(api.record('L', '6'), (e) => e instanceof ApiError && e.code === OFFLINE);
    // Anything but a field change has to wait for the connection.
    await assert.rejects(api.remove('L', '5'), (e) => e instanceof ApiError && e.code === OFFLINE);
    await assert.rejects(api.update('L', '5', {}, { portalData: { P: [{ recordId: '1' }] } }), (e) => e instanceof ApiError && e.code === OFFLINE);
    return { before: r, after: await api.record('L', '5') };
  });
  assert.equal(offline.before.fieldData.Title, 'old');
  assert.equal(offline.after.fieldData.Title, 'mine');
  assert.equal(api.waiting, 1);
  // Back online: sent with the modId it was made on.
  const sent: unknown[] = [];
  const clashes = await withFetch((method, _url, body) => { sent.push([method, body]); return ok({ modId: '3' }); }, () => api.sync());
  assert.deepEqual(clashes, []);
  assert.deepEqual(sent, [['PATCH', { fieldData: { Title: 'mine' }, modId: '2' }]]);
  assert.equal(api.waiting, 0);
  assert.equal(api.isOffline, false);
});

test('offline copy: a change that clashes with the server waits for the person to choose', async () => {
  const { copy } = await copyFor();
  const api = new Api('D', 'tok');
  api.offline = copy;
  await copy.queue({ layout: 'L', recordId: '5', modId: '2', fieldData: { Title: 'mine' } });
  await copy.queue({ layout: 'L', recordId: '9', modId: '1', fieldData: { Title: 'lost' } });
  const clashes = await withFetch((method, url) => {
    if (url.endsWith('/records/9')) return fail(101, 'Record is missing');
    if (method === 'PATCH') return fail(306, 'Record modification ID does not match');
    return ok({ data: [{ recordId: '5', modId: '4', fieldData: { Title: 'theirs' } }] });
  }, () => api.sync());
  // Queued in the same millisecond, they may come back in either order.
  clashes.sort((a, b) => a.recordId.localeCompare(b.recordId));
  assert.deepEqual(clashes.map((c) => [c.recordId, c.conflict?.gone ?? false, c.conflict?.server?.Title]), [['5', false, 'theirs'], ['9', true, undefined]]);
  assert.equal(api.waiting, 2);
  // Kept until decided, and not sent again meanwhile.
  let calls = 0;
  await withFetch(() => { calls++; return ok({}); }, () => api.sync());
  assert.equal(calls, 0);
  // Keep mine: sent over what the server has; keep theirs: dropped.
  const sent: unknown[] = [];
  await withFetch((method, _url, body) => { sent.push([method, body]); return ok({ modId: '5' }); }, async () => {
    await api.resolve(clashes[0], true);
    await api.resolve(clashes[1], false);
  });
  assert.deepEqual(sent, [['PATCH', { fieldData: { Title: 'mine' } }]]);
  assert.equal(api.waiting, 0);
});

test('offline copy: a copy opened without signing in sends nothing', async () => {
  const { copy } = await copyFor();
  const api = new Api('D', '');
  api.offline = copy;
  await copy.queue({ layout: 'L', recordId: '5', fieldData: { Title: 'x' } });
  let calls = 0;
  await withFetch(() => { calls++; return ok({}); }, async () => {
    assert.equal(api.copyOnly, true);
    assert.deepEqual(await api.sync(), []);
    await assert.rejects(api.record('L', '5'), (e) => e instanceof ApiError && e.code === OFFLINE);
  });
  assert.equal(calls, 0);
});

test('offline copy: a new password takes the copy over with its waiting changes; a change made meanwhile is not dropped', async () => {
  const { shelf, copy } = await copyFor();
  await copy.keep('GET /x', { ok: 1 });
  await copy.queue({ layout: 'L', recordId: '1', modId: '4', fieldData: { a: 'x' } });
  const salt = (await OfflineCopy.saltOf(shelf, 'Tasks', 'Admin'))!;
  const moved = await copy.moveTo(salt, await deriveKey('new password', salt));
  assert.equal(await OfflineCopy.open(shelf, 'Tasks', 'Admin', await deriveKey('secret', salt)), 'wrong');
  assert.deepEqual(await moved.recall('GET /x'), { ok: 1 });
  const [edit] = await moved.pending();
  assert.deepEqual([edit.modId, edit.fieldData], ['4', { a: 'x' }]);
  // Typing more while it was being sent: settling what was sent leaves the newer change waiting.
  await moved.queue({ layout: 'L', recordId: '1', modId: '5', fieldData: { b: 'y' } });
  await moved.settle(edit);
  await moved.conflict(edit, { message: 'stale' });
  const [now] = await moved.pending();
  assert.deepEqual([now.modId, now.fieldData, now.conflict], ['4', { a: 'x', b: 'y' }, undefined]);
  // Removed: a response still on its way isn't kept.
  await moved.forget();
  await moved.keep('GET /late', { ok: 2 });
  assert.equal(shelf.data.responses.size + shelf.data.queue.size + shelf.data.files.size, 0);
});

test('offline copy: a change made online goes with the one waiting for the same record, on its modId', async () => {
  const { copy } = await copyFor();
  const api = new Api('D', 'tok');
  api.offline = copy;
  await copy.queue({ layout: 'L', recordId: '5', modId: '2', fieldData: { A: 'offline', Notes: 'x' }, styles: { Notes: [{ start: 0, end: 1, style: 256 }], A: [{ start: 0, end: 1, style: 512 }] } });
  await api.countWaiting();
  const sent: unknown[] = [];
  await withFetch((method, _url, body) => { sent.push([method, body]); return ok({ modId: '3' }); }, () => api.update('L', '5', { B: 'online', A: 'again' }, { modId: '7' }));
  assert.deepEqual(sent, [['PATCH', { fieldData: { A: 'again', Notes: 'x', B: 'online' }, styles: { Notes: [{ start: 0, end: 1, style: 256 }] }, modId: '2' }]]);
  assert.equal(api.waiting, 0);
});

test('offline copy: sending stops when the server is down or the record is being edited, and a refusal is not called a clash', async () => {
  const { copy } = await copyFor();
  const api = new Api('D', 'tok');
  api.offline = copy;
  await copy.queue({ layout: 'L', recordId: '5', modId: '2', fieldData: { A: 'x' } });
  // A proxy answering for a server that is down (no Tabularius error code).
  let calls = 0;
  const proxy = await withFetch(() => { calls++; return { status: 502, json: {} }; }, () => api.sync());
  assert.deepEqual([proxy, calls, api.waiting], [[], 1, 1]);
  const locked = await withFetch(() => fail(301, 'Record is in use by another user'), () => api.sync());
  assert.deepEqual([locked, (await copy.pending())[0].conflict], [[], undefined]);
  const [refused] = await withFetch(() => fail(504, 'Value is not unique'), () => api.sync());
  assert.deepEqual(refused.conflict, { message: 'Value is not unique', refused: true });
  // A proxy error answers reads from the copy, as no connection does.
  await copy.keep('GET /fmi/data/vLatest/databases/D/layouts/L/records/5\u0000', { ok: { data: [{ recordId: '5', fieldData: { A: 'kept' } }] } });
  const rec = await withFetch(() => ({ status: 503, json: {} }), () => api.record('L', '5'));
  assert.equal(rec.fieldData.A, 'kept');
});

test('offline copy: a change without the modId it was made on is not kept for later', async () => {
  const { copy } = await copyFor();
  const api = new Api('D', 'tok');
  api.offline = copy;
  await withFetch(() => undefined, async () => {
    await assert.rejects(api.update('L', '5', { A: 'x' }), (e) => e instanceof ApiError && e.code === OFFLINE);
    await api.update('L', '5', { A: 'x' }, { modId: '3' });
    // Added to a change already waiting, it keeps that one's modId.
    await api.update('L', '5', { B: 'y' });
  });
  const [edit] = await copy.pending();
  assert.deepEqual([edit.modId, edit.fieldData], ['3', { A: 'x', B: 'y' }]);
});

// AR-web-client-03: a failed or interrupted password change keeps every waiting change recoverable.
for (const failing of ['queue', 'files'] as const) {
  test(`offline copy: a write that fails while moving to a new password (${failing}) leaves the waiting changes in the old copy`, async () => {
    const { shelf, salt, copy } = await copyFor();
    await copy.keep('GET /x', { ok: 1 });
    await copy.queue({ layout: 'L', recordId: '1', modId: '2', fieldData: { A: 'unsent' } });
    let fail = true;
    const flaky = { ...shelf, put: async (store: Parameters<typeof shelf.put>[0], key: string, value: unknown) => {
      if (fail && store === failing && (failing === 'queue' || shelf.data.queue.size > 1)) { fail = false; throw new Error('storage full'); }
      return shelf.put(store, key, value);
    } };
    const open = await OfflineCopy.open(flaky, 'Tasks', 'Admin', await deriveKey('secret', salt));
    assert.ok(open instanceof OfflineCopy);
    const newSalt2 = newSalt();
    const newKey = await deriveKey('fresh', newSalt2);
    await assert.rejects(open.moveTo(newSalt2, newKey), /storage full/);
    // The old password still opens the copy, with the change and the kept answer in it.
    const old = await OfflineCopy.open(shelf, 'Tasks', 'Admin', await deriveKey('secret', salt));
    assert.ok(old instanceof OfflineCopy);
    assert.deepEqual((await old.pending()).map((e) => e.fieldData), [{ A: 'unsent' }]);
    assert.deepEqual(await old.recall('GET /x'), { ok: 1 });
    assert.equal(shelf.data.queue.size, 1);
    // A second try finishes it: the new password opens everything, the old one no longer opens the copy.
    const moved = await old.moveTo(newSalt2, newKey);
    assert.deepEqual((await moved.pending()).map((e) => e.fieldData), [{ A: 'unsent' }]);
    assert.deepEqual(await moved.recall('GET /x'), { ok: 1 });
    assert.equal(await OfflineCopy.open(shelf, 'Tasks', 'Admin', await deriveKey('secret', salt)), 'wrong');
    assert.equal(shelf.data.queue.size, 1);
    assert.equal(shelf.data.responses.size, 1);
  });
}

// AR-web-client-04: queue updates are serialised, and a version is told apart from a later one whatever the clock says.
test('offline copy: two windows queueing changes to one record at once keep both fields', async () => {
  const { shelf, salt, key } = await copyFor();
  const slow = { ...shelf, get: async (store: Parameters<typeof shelf.get>[0], k: string) => { const v = await shelf.get(store, k); await new Promise((r) => setTimeout(r, 15)); return v; } };
  const a = await OfflineCopy.open(slow, 'Tasks', 'Admin', key) as OfflineCopy;
  const b = await OfflineCopy.open(slow, 'Tasks', 'Admin', key) as OfflineCopy;
  await Promise.all([
    a.queue({ layout: 'L', recordId: '1', modId: '1', fieldData: { A: 'first' } }),
    b.queue({ layout: 'L', recordId: '1', modId: '1', fieldData: { B: 'second' } }),
  ]);
  assert.deepEqual((await a.pending()).map((e) => e.fieldData), [{ A: 'first', B: 'second' }]);
});

test('offline copy: sending an older version of a change never drops a newer one, even within one millisecond', async (t) => {
  const { copy } = await copyFor();
  t.mock.method(Date, 'now', () => 1_700_000_000_000);
  await copy.queue({ layout: 'L', recordId: '1', modId: '1', fieldData: { A: 'one' } });
  const [sent] = await copy.pending();
  await copy.queue({ layout: 'L', recordId: '1', modId: '1', fieldData: { A: 'two' } });
  await copy.settle(sent);
  assert.deepEqual((await copy.pending()).map((e) => e.fieldData), [{ A: 'two' }]);
  await copy.conflict(sent, { message: 'changed' });
  assert.equal((await copy.pending())[0].conflict, undefined);
  const [latest] = await copy.pending();
  await copy.settle(latest);
  assert.deepEqual(await copy.pending(), []);
});

// Review of AR-web-client-04: a window that opened the copy before another moved it must not write under the old key.
test('offline copy: a change made in a window that still has the old password fails loudly once another window moved the copy', async () => {
  const { shelf, salt, key } = await copyFor();
  const a = await OfflineCopy.open(shelf, 'Tasks', 'Admin', key) as OfflineCopy;
  const b = await OfflineCopy.open(shelf, 'Tasks', 'Admin', key) as OfflineCopy;
  await a.queue({ layout: 'L', recordId: '1', modId: '1', fieldData: { A: 'kept' } });
  const next = newSalt();
  const moved = await a.moveTo(next, await deriveKey('new password', next));
  await assert.rejects(b.queue({ layout: 'L', recordId: '2', modId: '1', fieldData: { B: 'late' } }), CopyMoved);
  const [kept] = await b.pending().catch(() => []) as never[];
  assert.equal(kept, undefined, 'the old key reads nothing');
  assert.deepEqual((await moved.pending()).map((e) => e.fieldData), [{ A: 'kept' }]);
  assert.equal(await OfflineCopy.waitingIn(shelf, 'Tasks', 'Admin'), 1, 'nothing was written under the old key');
  const [sent] = await moved.pending();
  await assert.rejects(b.settle(sent), CopyMoved);
  await assert.rejects(b.conflict(sent, { message: 'x' }), CopyMoved);
  assert.equal((await moved.pending()).length, 1);
  // A second window moving the copy that has already moved does not undo it.
  await assert.rejects(b.moveTo(newSalt(), await deriveKey('other', salt)), CopyMoved);
  assert.deepEqual((await moved.pending()).map((e) => e.fieldData), [{ A: 'kept' }]);
});

test('offline copy: creating, removing and forgetting wait for the changes being written, and a copy replaced elsewhere refuses more changes', async () => {
  const { shelf, salt, key } = await copyFor();
  const slow = { ...shelf, put: async (store: Parameters<typeof shelf.put>[0], k: string, v: unknown) => { await new Promise((r) => setTimeout(r, 15)); return shelf.put(store, k, v); } };
  const a = await OfflineCopy.open(slow, 'Tasks', 'Admin', key) as OfflineCopy;
  const writing = a.queue({ layout: 'L', recordId: '1', modId: '1', fieldData: { A: 'x' } });
  const removal = OfflineCopy.remove(slow, 'Tasks', 'Admin');
  await Promise.allSettled([writing, removal]);
  assert.equal(shelf.data.queue.size + shelf.data.files.size, 0, 'a change being written is not left behind by the removal');
  // Replaced by a new copy (a discarded one) in another window.
  const { copy: first } = await copyFor(shelf);
  const fresh = await OfflineCopy.create(shelf, 'Tasks', 'Admin', salt, await deriveKey('different', salt));
  await assert.rejects(first.queue({ layout: 'L', recordId: '1', modId: '1', fieldData: { A: 'y' } }), CopyMoved);
  assert.deepEqual(await fresh.pending(), []);
  await fresh.forget();
  await assert.rejects(fresh.queue({ layout: 'L', recordId: '1', modId: '1', fieldData: { A: 'z' } }), CopyMoved);
  assert.equal(shelf.data.queue.size + shelf.data.files.size, 0);
});

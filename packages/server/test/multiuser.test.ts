import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import { serve, backupFolder, backupSets, parseInterval, restoreBackup, runningServer, setAdminPassword, type Host } from '../src/index.ts';
import { StoreError, writer, type Store } from '../../store/src/index.ts';
import { ScriptSession } from '../../scripts/src/index.ts';
import { asText } from '../../calc/src/index.ts';

// Two people (Ann and Bob) working in Charts at once.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const drawers = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'DEMO_drawers.fmp12');
const skip = existsSync(fixture) && existsSync(drawers) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let host: Host;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-multi-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  copyFileSync(drawers, join(dir, 'Drawers.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {}, listFilesPublicly: true });
  server = s.server;
  host = s.host;
  base = s.url;
  for (const db of ['Charts', 'Drawers']) {
    const store = host.get(db)!;
    const full = store.privilegeSets().find((p) => p.id === 1)!;
    store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
    store.setPassword('Ann', 'pw', full.name);
    store.setPassword('Bob', 'pw', full.name);
  }
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

async function login(account: string, db = 'Charts'): Promise<{ authorization: string; token: string }> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/${db}/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`) } });
  const token = (await r.json()).response.token;
  return { authorization: `Bearer ${token}`, token };
}

const lockUrl = (id: number) => `${base}/tabularius/live/v1/databases/Charts/layouts/Congress/records/${id}/lock`;
const patch = (auth: { authorization: string }, id: number, fieldData: Record<string, string>) =>
  fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records/${id}`, {
    method: 'PATCH', headers: { authorization: auth.authorization, 'content-type': 'application/json' }, body: JSON.stringify({ fieldData }),
  }).then(async (r) => ({ status: r.status, code: (await r.json()).messages[0].code as string }));

test('record locks: others get 301 until the editor is done', { skip }, async () => {
  const ann = await login('Ann');
  const bob = await login('Bob');

  const take = await fetch(lockUrl(1), { method: 'POST', headers: { authorization: ann.authorization } });
  assert.equal(take.status, 200);
  assert.equal((await take.json()).lock.account, 'Ann');

  // Bob can read it, but not lock, edit or delete it.
  const bobLock = await fetch(lockUrl(1), { method: 'POST', headers: { authorization: bob.authorization } });
  assert.equal(bobLock.status, 409);
  const err = (await bobLock.json()).error;
  assert.equal(err.code, 301);
  assert.match(err.message, /Ann/);
  assert.equal((await patch(bob, 1, { Name: 'Bob was here' })).code, '301');
  const del = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records/1`, { method: 'DELETE', headers: { authorization: bob.authorization } });
  assert.equal((await del.json()).messages[0].code, '301');

  // Writers without a session (MCP, scheduled work) are kept out too.
  const store = host.get('Charts')!;
  assert.throws(() => writer.run({}, () => store.update('Congress', 1, { Name: 'AI' })), (e: unknown) => e instanceof StoreError && e.code === 301);

  // Ann edits freely; renewing her lock is fine.
  assert.equal((await patch(ann, 1, { Name: 'Ann was here' })).code, '0');
  assert.equal((await fetch(lockUrl(1), { method: 'POST', headers: { authorization: ann.authorization } })).status, 200);

  // The lock list shows it.
  const locks = await (await fetch(`${base}/tabularius/live/v1/databases/Charts/locks`, { headers: { authorization: bob.authorization } })).json();
  assert.deepEqual(locks.locks, [{ file: 'Charts', table: 'Congress', recordId: 1, account: 'Ann', self: false }]);

  // Released: Bob's turn.
  await fetch(lockUrl(1), { method: 'DELETE', headers: { authorization: ann.authorization } });
  assert.equal((await patch(bob, 1, { Name: 'Bob was here' })).code, '0');

  // Logging out releases a session's locks.
  await fetch(lockUrl(2), { method: 'POST', headers: { authorization: ann.authorization } });
  assert.equal((await patch(bob, 2, { Name: 'x' })).code, '301');
  await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions/${ann.token}`, { method: 'DELETE' });
  assert.equal((await patch(bob, 2, { Name: 'x' })).code, '0');

  const clients = await (await fetch(`${base}/tabularius/live/v1/databases/Charts/clients`, { headers: { authorization: bob.authorization } })).json();
  assert.deepEqual(clients.clients.map((c: { account: string }) => c.account), ['Bob']);
});

/** Reads change events from a live stream until `n` arrive. */
async function events(auth: { authorization: string }, n: number, during: () => Promise<void>): Promise<Record<string, unknown>[]> {
  const ctrl = new AbortController();
  const r = await fetch(`${base}/tabularius/live/v1/databases/Charts/events`, { headers: { authorization: auth.authorization }, signal: ctrl.signal });
  assert.equal(r.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const reader = r.body!.pipeThrough(new TextDecoderStream()).getReader();
  const out: Record<string, unknown>[] = [];
  await during();
  let buf = '';
  while (out.length < n) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    for (const m of buf.matchAll(/event: change\ndata: (.*)\n\n/g)) out.push(JSON.parse(m[1]));
    buf = buf.slice(buf.lastIndexOf('\n\n') + 2);
  }
  ctrl.abort();
  return out;
}

test('live updates: everyone hears about changes, marked when they are their own', { skip }, async () => {
  const ann = await login('Ann');
  const bob = await login('Bob');
  let created = 0;
  const seen = await events(bob, 4, async () => {
    await fetch(lockUrl(3), { method: 'POST', headers: { authorization: ann.authorization } });
    await patch(ann, 3, { Name: 'Changed by Ann' });
    await fetch(lockUrl(3), { method: 'DELETE', headers: { authorization: ann.authorization } });
    const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Congress/records`, {
      method: 'POST', headers: { authorization: bob.authorization, 'content-type': 'application/json' }, body: JSON.stringify({ fieldData: { Name: 'New' } }),
    });
    created = Number((await r.json()).response.recordId);
  });
  assert.deepEqual(seen.map((e) => [e.kind, e.recordId, e.account, e.self]), [
    ['lock', 3, 'Ann', false],
    ['update', 3, 'Ann', false],
    ['unlock', 3, 'Ann', false],
    ['create', created, 'Bob', true],
  ]);
  assert.equal(seen[1].table, 'Congress');
  assert.equal(seen[1].file, 'Charts');
  assert.ok(Number(seen[1].modId) > 0);

  const denied = await fetch(`${base}/tabularius/live/v1/databases/Charts/events`);
  assert.equal(denied.status, 401);
});

test('live updates: an account turned off hears no more changes, and its stream says the session ended', { skip }, async () => {
  const store = host.get('Charts')!;
  store.setPassword('Cy', 'pw', store.privilegeSets().find((p) => p.id === 1)!.name);
  const cy = await login('Cy');
  const ann = await login('Ann');
  const res = await fetch(`${base}/tabularius/live/v1/databases/Charts/events`, { headers: { authorization: cy.authorization } });
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  let text = '';
  const read = async (until: RegExp) => {
    while (!until.test(text)) {
      const { value, done } = await reader.read();
      if (done) return;
      text += new TextDecoder().decode(value);
    }
  };
  try {
    await read(/retry:/);
    store.setAccountActive('Cy', false);
    await patch(ann, 4, { Name: 'Changed while Cy is off' });
    await read(/event: expired/);
    assert.doesNotMatch(text, /event: change/);
    // The stream is closed, and the session with it.
    const { done } = await reader.read();
    assert.equal(done, true);
    const again = await fetch(`${base}/tabularius/live/v1/databases/Charts/events`, { headers: { authorization: cy.authorization } });
    assert.equal(again.status, 401);
    await again.body?.cancel();
  } finally {
    await reader.cancel().catch(() => {});
    store.setAccountActive('Cy', true);
  }
});

test('backups: online copies, pruned to the newest sets; restore needs the server stopped', { skip }, async () => {
  const dest = join(dir, 'Backups');
  const first = await backupFolder(dir, dest, 2);
  assert.deepEqual(first.files, ['Charts.openhbam.sqlite', 'Drawers.openhbam.sqlite']);
  const copy = new DatabaseSync(join(first.dir, 'Charts.openhbam.sqlite'), { readOnly: true });
  const live = host.get('Charts')!.query('SELECT count(*) AS n FROM Congress')[0].n;
  assert.equal((copy.prepare('SELECT count(*) AS n FROM Congress').get() as { n: number }).n, live);
  copy.close();

  await backupFolder(dir, dest, 2);
  const third = await backupFolder(dir, dest, 2);
  assert.equal(backupSets(dest).length, 2);
  assert.equal(third.removed.length, 1);
  assert.ok(!readdirSync(dest).some((n) => n.endsWith('.partial')));

  assert.equal(runningServer(dir), process.pid);
  await assert.rejects(restoreBackup(dir, third.dir), /stop the server first/);
  await assert.rejects(restoreBackup(dir, join(dir, 'no-such-set')), /no backup set/, 'a set that is not there is named as such before the running server is mentioned');
});

test('backup intervals', () => {
  assert.equal(parseInterval('30m'), 30 * 60_000);
  assert.equal(parseInterval('6h'), 6 * 3_600_000);
  assert.equal(parseInterval('1d'), 86_400_000);
  assert.equal(parseInterval('90'), 90 * 60_000);
  assert.throws(() => parseInterval('soon'));
  assert.throws(() => parseInterval('0m'));
});

test('global fields: each session has its own values, starting from the file\'s', { skip }, async () => {
  const ann = await login('Ann', 'Drawers');
  const bob = await login('Bob', 'Drawers');
  // The Data API returns the fields on the layout: one with every field, the global among them.
  host.get('Drawers')!.applyDesign([{ op: 'createLayout', name: 'Every field', occurrence: 'RECORD' }]);
  const url = `${base}/fmi/data/vLatest/databases/Drawers/layouts/${encodeURIComponent('Every field')}/records`;
  const first = await (await fetch(`${url}?_limit=1`, { headers: { authorization: ann.authorization } })).json();
  const id = first.response.data[0].recordId;
  const search = async (auth: { authorization: string }) =>
    (await (await fetch(`${url}/${id}`, { headers: { authorization: auth.authorization } })).json()).response.data[0].fieldData.quick_search;

  const store = host.get('Drawers')!;
  // With no session (tools, MCP), a global is the file's stored value.
  store.update('RECORD', Number(id), { quick_search: 'file default' });
  assert.equal(await search(ann), 'file default');

  const set = await fetch(`${url}/${id}`, {
    method: 'PATCH', headers: { authorization: ann.authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ fieldData: { quick_search: 'ann looks for this' } }),
  });
  assert.equal((await set.json()).messages[0].code, '0');
  assert.equal(await search(ann), 'ann looks for this');
  assert.equal(await search(bob), 'file default');
  assert.equal(store.evaluate('RECORD', 'RECORD::quick_search').value, 'file default');

  // Formulas see the session's value, and scripts share it (same ScriptSession).
  const session = new ScriptSession();
  writer.run({ globals: session }, () => store.update('RECORD', Number(id), { quick_search: 'from a script session' }));
  assert.equal(writer.run({ globals: session }, () => store.evaluate('RECORD', 'RECORD::quick_search').value), 'from a script session');
  assert.equal(asText(session.globalFields.get('drawers::record::quick_search')![0]), 'from a script session');
  assert.equal(store.evaluate('RECORD', 'RECORD::quick_search').value, 'file default');
});

test('admin console: status, back up now, disconnect; password once set', { skip }, async () => {
  const ann = await login('Ann');
  await fetch(lockUrl(5), { method: 'POST', headers: { authorization: ann.authorization } });
  const admin = (path: string, init: RequestInit = {}) => fetch(`${base}/tabularius/admin/v1${path}`, init);

  // No password yet: open to this machine (the test server listens on loopback).
  const status = await (await admin('/status')).json();
  assert.equal(status.server.passwordSet, false);
  assert.ok(status.databases.some((d: { name: string; bytes: number }) => d.name === 'Charts' && d.bytes > 0));
  const client = status.clients.find((c: { account: string; locks: number }) => c.account === 'Ann' && c.locks === 1);
  assert.ok(client);
  assert.ok(!('token' in client));
  assert.deepEqual(status.locks.map((l: { recordId: number; account: string }) => [l.recordId, l.account]), [[5, 'Ann']]);
  const page = await fetch(`${base}/admin/`);
  assert.match(await page.text(), /Tabularius Admin/);

  // Actions need the admin header, so other sites can't trigger them.
  assert.equal((await admin('/backup', { method: 'POST' })).status, 403);
  const backup = await (await admin('/backup', { method: 'POST', headers: { 'x-tabularius-admin': '1' } })).json();
  assert.ok(backup.files.includes('Charts.openhbam.sqlite'));

  // Disconnecting ends the session and releases its locks.
  const off = await admin(`/clients/${client.id}/disconnect`, { method: 'POST', headers: { 'x-tabularius-admin': '1' } });
  assert.equal(off.status, 200);
  assert.equal(host.get('Charts')!.locks.holder('Congress', 5), undefined);
  assert.equal((await patch(ann, 5, { Name: 'x' })).code, '952');

  setAdminPassword(dir, 'secret');
  const locked = await admin('/status');
  assert.equal(locked.status, 401);
  assert.match(locked.headers.get('www-authenticate') ?? '', /Basic/);
  assert.equal((await admin('/status', { headers: { authorization: 'Basic ' + btoa('admin:wrong'), 'x-tabularius-admin': '1' } })).status, 401);
  const ok = await admin('/status', { headers: { authorization: 'Basic ' + btoa('admin:secret'), 'x-tabularius-admin': '1' } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).server.passwordSet, true);
});

test('admin console: repeated wrong passwords lock the address out', { skip }, async () => {
  // The password was set to 'secret' by the previous test.
  const admin = (pw: string) =>
    fetch(`${base}/tabularius/admin/v1/status`, { headers: { authorization: 'Basic ' + btoa('admin:' + pw), 'x-tabularius-admin': '1' } });

  // Five misses trip the cooldown; the fifth answers 429 with a Retry-After.
  let last: Response | undefined;
  for (let i = 0; i < 5; i++) last = await admin('wrong');
  assert.equal(last!.status, 429);
  assert.ok(Number(last!.headers.get('retry-after')) > 0);

  // While locked, even the right password is refused.
  assert.equal((await admin('secret')).status, 429);
});

test('files dropped into the folder are hosted without a restart', { skip }, async () => {
  const flicks = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Flicks.fmp12');
  copyFileSync(flicks, join(dir, 'Dropped.fmp12'));
  assert.equal(host.get('Dropped'), undefined);
  // First pass notes the size (the copy may still be running); the next converts it, off the main thread.
  assert.equal(await host.scan(), undefined);
  assert.equal(await host.scan(), 'Dropped');
  assert.ok(host.get('Dropped')!.schema.tables.length > 0);
  const dbs = await (await fetch(`${base}/fmi/data/vLatest/databases`)).json();
  assert.ok(dbs.response.databases.some((d: { name: string }) => d.name === 'Dropped'));
  // A file that can't be read is reported once, not retried until it changes.
  writeFileSync(join(dir, 'Broken.fmp12'), 'not a FileMaker file');
  const logs: string[] = [];
  await host.scan((m) => logs.push(m));
  await host.scan((m) => logs.push(m));
  await host.scan((m) => logs.push(m));
  assert.equal(logs.filter((m) => m.startsWith("couldn't convert Broken.fmp12")).length, 1);
  assert.equal(host.get('Broken'), undefined);
  assert.ok(!existsSync(join(dir, 'Broken.openhbam.sqlite.tmp')));
});

test('with background conversion the server answers before a file is converted', { skip }, async () => {
  const d = mkdtempSync(join(tmpdir(), 'tabularius-bg-'));
  copyFileSync(fixture, join(d, 'Charts.fmp12'));
  const s = await serve({ dir: d, port: 0, log: () => {}, background: true });
  let settled = false;
  let deadline: ReturnType<typeof setTimeout>;
  let stopWaiting!: () => void;
  const hosted = new Promise<void>((resolve, reject) => {
    const added = (store: Store) => {
      if (store.name !== 'Charts') return;
      finish();
    };
    const removeListener = () => {
      const index = s.host.onAdd.indexOf(added);
      if (index !== -1) s.host.onAdd.splice(index, 1);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      removeListener();
      resolve();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      removeListener();
      reject(error);
    };
    stopWaiting = () => {
      clearTimeout(deadline);
      removeListener();
    };
    deadline = setTimeout(() => fail(new Error('timed out waiting for Charts conversion')), 10_000);
    s.host.onAdd.push(added);
    if (s.host.get('Charts')) {
      finish();
    }
  });
  try {
    assert.equal(s.host.get('Charts'), undefined);
    const up = await fetch(`${s.url}/tabularius/health`);
    assert.equal(up.status, 200);
    await hosted;
    assert.ok(s.host.get('Charts'));
  } finally {
    stopWaiting();
    s.server.close();
    rmSync(d, { recursive: true });
  }
});

test('encrypted backups: unreadable without the passphrase, restored with it', { skip }, async () => {
  const dest = join(mkdtempSync(join(tmpdir(), 'tabularius-enc-')), 'Backups');
  const target = mkdtempSync(join(tmpdir(), 'tabularius-restore-'));
  try {
    const r = await backupFolder(dir, dest, 0, 'correct horse');
    // backup.json.lock.db is the manifest's cross-process lock: a sidecar that is never written, so it holds no data.
    const files = readdirSync(r.dir).filter((f) => f !== 'backup.json' && f !== 'backup.json.lock.db');
    assert.ok(files.length >= 2 && files.every((f) => f.endsWith('.openhbam.sqlite.enc')), files.join());
    const raw = readFileSync(join(r.dir, 'Charts.openhbam.sqlite.enc'));
    assert.ok(!raw.includes('SQLite format 3') && !raw.includes('Congress'), 'nothing readable in the encrypted file');

    await assert.rejects(restoreBackup(target, r.dir, undefined, undefined), /encrypted: set TABULARIUS_BACKUP_KEY/);
    await assert.rejects(restoreBackup(target, r.dir, undefined, 'wrong'), /wrong passphrase/);
    assert.deepEqual(readdirSync(target).filter((f) => f !== '.openhbam-claim.sqlite'), [], 'a failed restore leaves nothing behind but the empty claim lock');

    // A file cut short is refused, not restored half.
    const cut = join(dest, 'cut');
    mkdirSync(cut);
    writeFileSync(join(cut, 'Charts.openhbam.sqlite.enc'), raw.subarray(0, raw.length - 100));
    await assert.rejects(restoreBackup(target, cut, undefined, 'correct horse', { acceptUnsigned: true }), /damaged|cut off/);

    assert.deepEqual(await restoreBackup(target, r.dir, 'Charts', 'correct horse'), ['Charts.openhbam.sqlite']);
    const copy = new DatabaseSync(join(target, 'Charts.openhbam.sqlite'), { readOnly: true });
    const live = host.get('Charts')!.query('SELECT count(*) AS n FROM Congress')[0].n;
    assert.equal((copy.prepare('SELECT count(*) AS n FROM Congress').get() as { n: number }).n, live);
    copy.close();
  } finally {
    rmSync(dirname(dest), { recursive: true });
    rmSync(target, { recursive: true });
  }
});

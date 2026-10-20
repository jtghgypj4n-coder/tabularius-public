// One server as several worker processes: record locks, live updates, the
// admin console and closing files work across them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { clusterRoute, Host, serveCluster, setAdminPassword } from '../src/index.ts';
import { LOCK_TTL_MS } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let cluster: Awaited<ReturnType<typeof serveCluster>>;
let base: string;

const data = `/fmi/data/vLatest/databases/Charts`;
const PEOPLE = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay'];
/** Where each person's sign-in goes with two workers. */
const workerOf = (who: string) => clusterRoute({ url: `${data}/sessions`, method: 'POST', headers: { authorization: 'Basic ' + btoa(`${who}:pw`) } } as unknown as IncomingMessage, 2);
// Ann, and someone whose sessions are on the other worker.
const BOB = PEOPLE.find((p) => workerOf(p) !== workerOf('Ann'))!;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-cluster-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const host = new Host(dir);
  const store = host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  for (const who of PEOPLE) store.setPassword(who, 'pw', full.name);
  store.applyDesign([{ op: 'createScript', name: 'Crash transaction', text: 'Open Transaction\nSet Field [ Congress::Name ; "uncommitted crash edit" ]\nCommit Records/Requests [ With dialog: Off ]\nPause/Resume Script [ Duration (seconds): 120 ]\nCommit Transaction' }]);
  host.close();
  setAdminPassword(dir, 'secret');
  cluster = await serveCluster({ dir, port: 0, listFilesPublicly: true, log: (m) => process.env.CLUSTER_LOG && console.error(m) }, 2);
  base = cluster.url;
});
after(async () => {
  await cluster?.close();
  if (dir) rmSync(dir, { recursive: true });
});

const login = async (account: string) => {
  const r = await fetch(`${base}${data}/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`), 'content-type': 'application/json' }, body: '{}' });
  return (await r.json()).response.token as string;
};
const admin = { authorization: 'Basic ' + btoa('admin:secret'), 'x-tabularius-admin': '1' };

/** A live-updates stream, collecting what it hears. */
function listen(token: string) {
  const heard: string[] = [];
  const abort = new AbortController();
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let settled = false;
  let deadline: ReturnType<typeof setTimeout>;
  const connected = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const settle = (error?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    if (error) rejectReady(error);
    else resolveReady();
  };
  deadline = setTimeout(() => {
    settle(new Error('timed out connecting to the live event stream'));
    abort.abort();
  }, 5000);
  void fetch(`${base}/tabularius/live/v1/databases/Charts/events`, { headers: { authorization: `Bearer ${token}` }, signal: abort.signal }).then(async (r) => {
    if (!r.ok) throw new Error(`live event stream returned HTTP ${r.status}`);
    if (!r.body) throw new Error('live event stream returned no body');
    settle();
    const text = new TextDecoder();
    for await (const chunk of r.body!) heard.push(text.decode(chunk));
  }).catch((error: unknown) => {
    settle(error instanceof Error ? error : new Error(String(error)));
  });
  void connected.catch(() => {});
  return {
    heard: () => heard.join(''),
    ready: connected,
    stop: () => {
      clearTimeout(deadline);
      abort.abort();
    },
  };
}
async function until(what: () => boolean | Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await what()) return;
    await sleep(25);
  }
  assert.fail('timed out');
}

test('requests go to the worker holding their session, the admin console to the leader', () => {
  const req = (url: string, headers: Record<string, string> = {}) => ({ url, headers }) as unknown as IncomingMessage;
  assert.equal(clusterRoute(req('/tabularius/admin/v1/status'), 4), 0);
  assert.equal(clusterRoute(req('/fmi/admin/api/v2/databases'), 4), 0);
  assert.equal(clusterRoute(req('/tabularius/auth/v1/oidc/callback?code=x&state=y'), 4), 0, 'a sign-in through a provider ends where it started');
  assert.equal(clusterRoute(req('/oauth/authorize?provider=microsoft&db=X'), 4), 0, 'an AI app\'s sign-in page can itself start a provider sign-in, finished at the leader, so it begins there too');
  assert.equal(clusterRoute(req('/oauth/register'), 4), 0, 'an AI app registers at the leader, so the per-address limit holds for the whole server');
  assert.equal(clusterRoute(req('/fmi/data/vLatest/databases/X/records', { authorization: 'Bearer 03' + 'a'.repeat(46) }), 4), 3);
  assert.equal(clusterRoute(req('/fmi/data/vLatest/databases/X/sessions/' + '02' + 'b'.repeat(46)), 4), 2);
  assert.equal(clusterRoute(req('/app/'), 4), undefined);
  const signIn = (who: string) => clusterRoute({ url: '/fmi/data/vLatest/databases/X/sessions', method: 'POST', headers: { authorization: 'Basic ' + btoa(who) } } as unknown as IncomingMessage, 4);
  assert.equal(signIn('Ann:pw'), signIn('ann:wrong'), 'every sign-in for an account in one place, so lockout counts them all');
  assert.ok(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) => signIn(`${n}:pw`))).size > 1, 'accounts spread over the workers');
  const api = clusterRoute(req('/fmi/data/vLatest/databases/X/records', { authorization: 'Bearer ohbt_abc' }), 4);
  assert.equal(clusterRoute(req('/fmi/data/vLatest/databases/X/records', { authorization: 'Bearer ohbt_abc' }), 4), api, 'the same API token, the same worker');
});

test('locks, live updates, sign-outs and messages work between people on different workers', { skip }, async () => {
  const ann = await login('Ann');
  let bob = await login(BOB);
  assert.notEqual(ann.slice(0, 2), bob.slice(0, 2), 'Ann and the other person on different workers');
  const as = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
  const lock = (token: string, method: string) => fetch(`${base}/tabularius/live/v1/databases/Charts/layouts/Congress/records/1/lock`, { method, headers: as(token) });

  const annHears = listen(ann);
  try {
    await annHears.ready;

    // The other person edits record 1: Ann can't, and hears about their lock and save.
    assert.equal((await lock(bob, 'POST')).status, 200);
    assert.equal((await lock(ann, 'POST')).status, 409, 'locked by the other worker');
    const saved = await (await fetch(`${base}${data}/layouts/Congress/records/1`, { method: 'PATCH', headers: as(bob), body: JSON.stringify({ fieldData: { Name: 'Edited elsewhere' } }) })).json();
    assert.equal(saved.messages[0].code, '0');
    await until(() => annHears.heard().includes(`"recordId":1,"modId":${saved.response.modId}`));
    assert.match(annHears.heard(), /"kind":"lock"/);
    const read = await (await fetch(`${base}${data}/layouts/Congress/records/1`, { headers: as(ann) })).json();
    assert.equal(read.response.data[0].fieldData.Name, 'Edited elsewhere');

    // They sign out without unlocking: the lock goes with their session.
    await fetch(`${base}${data}/sessions/${bob}`, { method: 'DELETE' });
    assert.equal((await lock(ann, 'POST')).status, 200);
    assert.equal((await lock(ann, 'DELETE')).status, 200);

    // The admin console (the leader) sees both workers' people, and reaches them.
    bob = await login(BOB);
    let clients: { id: string; account: string }[] = [];
    await until(async () => {
      clients = (await (await fetch(`${base}/tabularius/admin/v1/status`, { headers: admin })).json()).clients;
      return clients.length >= 2;
    });
    const annId = clients.find((c) => c.account === 'Ann')!.id;
    const message = await fetch(`${base}/tabularius/admin/v1/clients/${annId}/message`, { method: 'POST', headers: { ...admin, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Closing at five' }) });
    assert.equal(message.status, 200);
    await until(() => annHears.heard().includes('Closing at five'));
    const bobId = clients.find((c) => c.account === BOB)!.id;
    assert.equal((await fetch(`${base}/tabularius/admin/v1/clients/${bobId}/disconnect`, { method: 'POST', headers: admin })).status, 200);
    await until(async () => (await fetch(`${base}${data}/layouts/Congress/records/1`, { headers: as(bob) })).status === 401);
  } finally {
    annHears.stop();
  }
});

test('closing and opening a file from the Admin API happens in every worker', { skip }, async () => {
  const auth = await (await fetch(`${base}/fmi/admin/api/v2/user/auth`, { method: 'POST', headers: admin })).json();
  const bearer = { authorization: `Bearer ${auth.response.token}`, 'content-type': 'application/json' };
  const dbs = await (await fetch(`${base}/fmi/admin/api/v2/databases`, { headers: bearer })).json();
  const id = dbs.response.databases.find((d: { filename: string }) => d.filename === 'Charts.fmp12').id;
  const set = (status: string) => fetch(`${base}/fmi/admin/api/v2/databases/${id}`, { method: 'PATCH', headers: bearer, body: JSON.stringify({ status }) }).then((r) => r.json());

  assert.equal((await set('CLOSED')).response.database.status, 'CLOSED');
  // Every worker has let go of it: nobody can sign in, whichever worker they reach.
  for (const who of ['Ann', BOB]) {
    const r = await fetch(`${base}${data}/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${who}:pw`), 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 404);
  }
  assert.equal((await set('OPENED')).response.database.status, 'NORMAL');
  const tokens = new Set<string>();
  for (const who of ['Ann', BOB]) tokens.add((await login(who)).slice(0, 2));
  assert.equal(tokens.size, 2, 'both workers host it again');
});

test('two workers racing to edit one record have exactly one lock winner', { skip, timeout: 15_000 }, async () => {
  const tokens = await Promise.all([login('Ann'), login(BOB)]);
  assert.notEqual(tokens[0].slice(0, 2), tokens[1].slice(0, 2));
  const headers = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
  const lockUrl = `${base}/tabularius/live/v1/databases/Charts/layouts/Congress/records/2/lock`;
  try {
    const locks = await Promise.all(tokens.map((token) => fetch(lockUrl, { method: 'POST', headers: headers(token) })));
    assert.deepEqual(locks.map((r) => r.status).sort(), [200, 409]);
    const winner = locks.findIndex((r) => r.status === 200);
    const edits = await Promise.all(tokens.map(async (token, i) => (await fetch(`${base}${data}/layouts/Congress/records/2`, {
      method: 'PATCH', headers: headers(token), body: JSON.stringify({ fieldData: { Name: `worker-${i}` } }),
    })).json()));
    assert.equal(edits[winner].messages[0].code, '0');
    assert.equal(edits[1 - winner].messages[0].code, '301');
    const record = await (await fetch(`${base}${data}/layouts/Congress/records/2`, { headers: headers(tokens[0]) })).json();
    assert.equal(record.response.data[0].fieldData.Name, `worker-${winner}`);
  } finally {
    for (const token of tokens) await fetch(`${base}${data}/sessions/${token}`, { method: 'DELETE' });
  }
});

test('a killed worker rolls back its transaction and its record lease expires', { skip, timeout: 90_000 }, async () => {
  const ann = await login('Ann');
  const bob = await login(BOB);
  const headers = (token: string) => ({ authorization: `Bearer ${token}` });
  const recordUrl = `${base}${data}/layouts/Congress/records/1`;
  const lockUrl = `${base}/tabularius/live/v1/databases/Charts/layouts/Congress/records/1/lock`;
  const read = async () => (await (await fetch(recordUrl, { headers: headers(ann) })).json()).response.data[0].fieldData.Name;
  const before = await read();
  const locked = await fetch(lockUrl, { method: 'POST', headers: headers(bob) });
  assert.equal(locked.status, 200);
  const worker = parseInt(bob.slice(0, 2), 16);
  const pid = cluster.pids()[worker]!;
  const abort = new AbortController();
  const probe = new DatabaseSync(join(dir, 'Charts.openhbam.sqlite'));
  probe.exec('PRAGMA busy_timeout = 0');
  const running = fetch(`${base}${data}/layouts/Congress/script/Crash%20transaction`, { headers: headers(bob), signal: abort.signal }).catch(() => undefined);
  try {
    // Wait until the script holds the file's SQLite write lock during its pause.
    await until(() => {
      try { probe.exec('BEGIN IMMEDIATE; ROLLBACK'); return false; }
      catch (e) { if (/locked/.test(String(e))) return true; throw e; }
    }, 5000);
    const expiry = Date.now() + LOCK_TTL_MS;
    process.kill(pid, 'SIGKILL');
    await running;
    assert.equal(await read(), before, 'uncommitted writes from the dead worker are rolled back');
    assert.equal((await fetch(lockUrl, { method: 'POST', headers: headers(ann) })).status, 409, 'crash recovery preserves the existing bounded lease policy');
    await sleep(Math.max(0, expiry - Date.now()) + 25);
    assert.equal((await fetch(lockUrl, { method: 'POST', headers: headers(ann) })).status, 200, 'the orphan cannot block a record past its lease');
  } finally {
    abort.abort();
    await running;
    probe.close();
    await fetch(`${base}${data}/sessions/${ann}`, { method: 'DELETE' });
  }
});

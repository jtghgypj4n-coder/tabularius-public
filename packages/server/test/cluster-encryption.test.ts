// Encryption at rest with several worker processes: the leader unlocks the
// stores before the others open them, and encrypts them again only once the
// others have let go, whether a file is closed from the Admin API or the
// whole server stops. Edits made on any worker are in the encrypted file.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clusterRoute, ENCRYPTED_EXT, Host, serveCluster, setAdminPassword, STORE_EXT } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const KEY = 'correct horse battery staple';
const data = `/fmi/data/vLatest/databases/Charts`;
const PEOPLE = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay'];
const workerOf = (who: string) => clusterRoute({ url: `${data}/sessions`, method: 'POST', headers: { authorization: 'Basic ' + btoa(`${who}:pw`) } } as unknown as IncomingMessage, 2);
const BOB = PEOPLE.find((p) => workerOf(p) !== workerOf('Ann'))!;

let template: string | undefined;

before(async () => {
  if (skip) return;
  template = mkdtempSync(join(tmpdir(), 'tabularius-cluster-template-'));
  copyFileSync(fixture, join(template, 'Charts.fmp12'));
  const setup = new Host(template, () => {}, { encryptionKey: KEY });
  const store = setup.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  for (const who of PEOPLE) store.setPassword(who, 'pw', full.name);
  await setup.close();
  setAdminPassword(template, 'secret');
});

after(() => { if (template) rmSync(template, { recursive: true, force: true }); });

/** A private copy of the same encrypted store and accounts for every cluster test. */
function encryptedFolder() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-cluster-ear-'));
  cpSync(template!, dir, { recursive: true });
  const working = join(dir, 'Charts' + STORE_EXT);
  const locked = working + ENCRYPTED_EXT;
  assert.ok(existsSync(locked) && !existsSync(working));
  return { dir, working, locked };
}

/** Nothing in plaintext is left beside the encrypted store. */
function onlyEncrypted(working: string, locked: string) {
  assert.ok(existsSync(locked), 'the encrypted store is there');
  for (const side of ['', '-wal', '-shm', '.results']) assert.ok(!existsSync(working + side), `no ${working + side}`);
  assert.ok(!existsSync(locked + '.partial'));
}

test('several workers keep the stores encrypted at rest', { skip }, async () => {
  const { dir, working, locked } = await encryptedFolder();
  try {
    const start = () => serveCluster({ dir, port: 0, encryptionKey: KEY, watch: false, log: () => {} }, 2);
    let cluster = await start();
    const base = () => cluster.url;
    const login = async (who: string) => {
      const r = await fetch(`${base()}${data}/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${who}:pw`), 'content-type': 'application/json' }, body: '{}' });
      assert.equal(r.status, 200, `${who} signs in`);
      return (await r.json()).response.token as string;
    };
    const as = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
    const name = async (token: string) => (await (await fetch(`${base()}${data}/layouts/Congress/records/1`, { headers: as(token) })).json()).response.data[0].fieldData.Name as string;
    const edit = async (token: string, value: string) => {
      const r = await fetch(`${base()}${data}/layouts/Congress/records/1`, { method: 'PATCH', headers: as(token), body: JSON.stringify({ fieldData: { Name: value } }) });
      assert.equal(r.status, 200);
    };
    try {
      // Unlocked for both workers while running.
      assert.ok(existsSync(working));
      const ann = await login('Ann');
      const bob = await login(BOB);
      assert.notEqual(ann.slice(0, 2), bob.slice(0, 2), 'on different workers');
      await edit(bob, 'Edited on the other worker');
      assert.equal(await name(ann), 'Edited on the other worker');

      // Closed from the Admin API: every worker lets go, then it is encrypted; opened again, unlocked for both.
      const auth = await (await fetch(`${base()}/fmi/admin/api/v2/user/auth`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('admin:secret'), 'x-tabularius-admin': '1' } })).json();
      const bearer = { authorization: `Bearer ${auth.response.token}`, 'content-type': 'application/json' };
      const dbs = await (await fetch(`${base()}/fmi/admin/api/v2/databases`, { headers: bearer })).json();
      const id = dbs.response.databases.find((d: { filename: string }) => d.filename === 'Charts.fmp12').id;
      const set = (status: string) => fetch(`${base()}/fmi/admin/api/v2/databases/${id}`, { method: 'PATCH', headers: bearer, body: JSON.stringify({ status }) }).then((r) => r.json());
      assert.equal((await set('CLOSED')).response.database.status, 'CLOSED');
      assert.ok(existsSync(locked) && !existsSync(working), 'closed: only the encrypted file is left');
      assert.equal((await set('OPENED')).response.database.status, 'NORMAL');
      const ann2 = await login('Ann');
      const bob2 = await login(BOB);
      assert.equal(await name(ann2), 'Edited on the other worker');
      await edit(ann2, 'Edited after reopening');
      assert.equal(await name(bob2), 'Edited after reopening');
    } finally {
      await cluster.close();
    }
    // Stopped: no plaintext store or write-ahead log is left, and the encrypted file holds the last edit.
    onlyEncrypted(working, locked);
    assert.ok(!readFileSync(locked).subarray(0, 16).toString('latin1').startsWith('SQLite format 3'));
    cluster = await start();
    try {
      assert.equal(await name(await login(BOB)), 'Edited after reopening');
    } finally {
      await cluster.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a leader that crashes is started again without locking the files the others are using', { skip }, async () => {
  const { dir, working, locked } = await encryptedFolder();
  const cluster = await serveCluster({ dir, port: 0, encryptionKey: KEY, watch: false, log: () => {} }, 2);
  const base = cluster.url;
  const follower = PEOPLE.find((p) => workerOf(p) === 1)!;
  const admin = { authorization: 'Basic ' + btoa('admin:secret'), 'x-tabularius-admin': '1' };
  try {
    const r = await fetch(`${base}${data}/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${follower}:pw`), 'content-type': 'application/json' }, body: '{}' });
    const token = (await r.json()).response.token as string;
    assert.equal(parseInt(token.slice(0, 2), 16), 1, 'on the other worker');
    const as = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    process.kill(cluster.pids()[0]!, 'SIGKILL');
    // While it is down, what only the leader does waits, rather than running where there is no key.
    let status = 0;
    for (let i = 0; i < 100 && status !== 503; i++) {
      status = (await fetch(`${base}/fmi/admin/api/v2/user/auth`, { method: 'POST', headers: admin })).status;
      if (status !== 503) await sleep(10);
    }
    assert.equal(status, 503);
    // Back again (its old socket file didn't stop it), with the file still unlocked for the other worker.
    for (let i = 0; i < 300 && (await fetch(`${base}/fmi/admin/api/v2/user/auth`, { method: 'POST', headers: admin })).status !== 200; i++) await sleep(50);
    assert.equal((await fetch(`${base}/fmi/admin/api/v2/user/auth`, { method: 'POST', headers: admin })).status, 200, 'the leader is back');
    assert.ok(existsSync(working));
    const saved = await fetch(`${base}${data}/layouts/Congress/records/1`, { method: 'PATCH', headers: as, body: JSON.stringify({ fieldData: { Name: 'After the leader came back' } }) });
    assert.equal(saved.status, 200);
  } finally {
    await cluster.close();
  }
  try {
    onlyEncrypted(working, locked);
    const again = await serveCluster({ dir, port: 0, encryptionKey: KEY, watch: false, log: () => {} }, 2);
    try {
      const r = await fetch(`${again.url}${data}/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Ann:pw'), 'content-type': 'application/json' }, body: '{}' });
      const token = (await r.json()).response.token as string;
      const read = await (await fetch(`${again.url}${data}/layouts/Congress/records/1`, { headers: { authorization: `Bearer ${token}` } })).json();
      assert.equal(read.response.data[0].fieldData.Name, 'After the leader came back', 'the edit made through the other worker was kept');
    } finally {
      await again.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Ctrl-C or a service manager stopping the whole process group still locks every file', { skip: skip || (process.platform === 'win32' && 'process groups') }, async () => {
  const { dir, working, locked } = await encryptedFolder();
  try {
    const cli = join(import.meta.dirname, '..', '..', 'cli', 'src', 'main.ts');
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      // Its own process group, as a terminal or a service manager gives it.
      const child = spawn(process.execPath, ['--no-warnings', cli, 'serve', dir, '--workers', '2', '--port', '0'], { detached: true, env: { ...process.env, TABULARIUS_ENCRYPTION_KEY: KEY }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout!.on('data', (c) => (out += c));
      child.stderr!.on('data', (c) => (out += c));
      for (let i = 0; i < 600 && !out.includes('Web client:'); i++) await sleep(50);
      assert.match(out, /Web client:/, out);
      assert.ok(existsSync(working), 'unlocked while running');
      const exited = new Promise((r) => child.once('exit', r));
      process.kill(-child.pid!, signal);
      await exited;
      // The workers are gone too.
      await sleep(200);
      onlyEncrypted(working, locked);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

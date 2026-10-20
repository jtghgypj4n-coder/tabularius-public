// `tabularius doctor` names the usual reasons a server won't start, one fix each, and changes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync, utimesSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { createServer } from 'node:net';
import { createServer as createHttp } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store, STORE_FORMAT } from '../../store/src/index.ts';
import { encryptFileSync } from '../../server/src/encrypt.ts';
import { filesNewerThan } from '../src/newer-files.ts';
import { accountChecks, backupCheck, formatChecks, certificateCheck, diskCheck, doctorText, embedCheck, locationCheck, nodeCheck, runDoctor, storageChecks } from '../src/doctor.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const tmp = (t: { after: (fn: () => void) => void }) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-doctor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const byName = (checks: { name: string }[], name: string) => checks.find((c) => c.name === name) as ReturnType<typeof nodeCheck> | undefined;

test('Node older than 22.20 is a problem with a fix', () => {
  assert.equal(nodeCheck('22.20.0').level, 'ok');
  assert.equal(nodeCheck('24.1.0').level, 'ok');
  const old = nodeCheck('20.11.0');
  assert.equal(old.level, 'problem');
  assert.match(old.fix!, /22\.20/);
});

test('disk space has a floor and grows with hosted files, backups, WAL and a backup run', () => {
  const gb = 1024 ** 3;
  assert.equal(diskCheck(gb - 1, 0, 0).level, 'problem');
  assert.equal(diskCheck(gb, 0, 0).level, 'ok');
  assert.equal(diskCheck(gb, 2 * gb, 4 * gb).level, 'problem');
  assert.equal(diskCheck(10 * gb - 1, 2 * gb, 4 * gb).level, 'problem');
  assert.equal(diskCheck(10 * gb, 2 * gb, 4 * gb).level, 'ok');
  assert.equal(diskCheck(10 * gb, 2 * gb, 5 * gb).level, 'problem');
  assert.match(diskCheck(gb, 2 * gb, 4 * gb).message, /10\.0 GB recommended/);
});

test('disk sizing reads metadata for hosted files, containers and configured backups', (t) => {
  const dir = tmp(t);
  const gb = 1024 ** 3;
  const sized = (path: string, size: number) => {
    writeFileSync(path, '');
    truncateSync(path, size);
  };
  sized(join(dir, 'Data.openhbam.sqlite'), gb);
  sized(join(dir, 'Source.fmp12'), gb);
  sized(join(dir, 'Locked.openhbam.sqlite.enc'), gb);
  sized(join(dir, 'Data.openhbam.sqlite-wal'), gb);
  sized(join(dir, 'unrelated.txt'), 20 * gb);
  mkdirSync(join(dir, 'Files', 'Data'), { recursive: true });
  sized(join(dir, 'Files', 'Data', 'container'), gb);
  mkdirSync(join(dir, 'Backups', 'set'), { recursive: true });
  sized(join(dir, 'Backups', 'set', 'Data.openhbam.sqlite.enc'), gb);
  const opts = { path: '/data', statfs: () => ({ type: 0xef53, bavail: 16 * gb, bsize: 1 }) };
  assert.equal(byName(storageChecks(dir, opts), 'Disk')!.level, 'ok');
  assert.match(byName(storageChecks(dir, opts), 'Disk')!.message, /16\.0 GB recommended/);
  const backups = tmp(t);
  sized(join(backups, 'Data.openhbam.sqlite'), 2 * gb);
  writeFileSync(join(dir, '.openhbam-settings.json'), JSON.stringify({ backupDir: backups }));
  assert.equal(byName(storageChecks(dir, opts), 'Disk')!.level, 'problem');
  assert.match(byName(storageChecks(dir, opts), 'Disk')!.message, /17\.0 GB recommended/);
});

test('synced paths warn on Windows, macOS and Linux without inspecting the machine', () => {
  for (const path of [
    '/home/u/Dropbox/data', '/home/u/Dropbox (Personal)/data',
    'C:\\Users\\u\\OneDrive\\data', 'C:\\Users\\u\\OneDrive - Company\\data',
    '/Users/u/Library/CloudStorage/OneDrive-Personal/data',
    '/Users/u/Library/Mobile Documents/com~apple~CloudDocs/data',
    'C:\\Users\\u\\iCloudDrive\\data', '/Users/u/iCloud Drive/data',
    '/Users/u/Google Drive/data', '/Users/u/Library/CloudStorage/GoogleDrive-u@example.org/My Drive/data',
  ]) {
    const c = locationCheck(path, 0xef53)!;
    assert.equal(c.level, 'warn', path);
    assert.match(c.message, /write-ahead log is unsafe/);
    assert.match(c.fix!, /local disk/);
  }
  for (const path of ['/data', '/data/Dropbox-notes', '/data/OneDriveBackup', '/data/Google Drive notes', 'C:\\data', '\\\\?\\C:\\data']) {
    assert.equal(locationCheck(path, 0xef53), undefined, path);
  }
});

test('network paths and statfs types warn, while local and unknown types do not', () => {
  for (const path of ['\\\\server\\share\\data', '//server/share/data', '\\\\?\\UNC\\server\\share\\data']) {
    assert.match(locationCheck(path)!.message, /network share/);
  }
  for (const type of [0x6969, 0x517b, 0xff534d42, 0xfe534d42, 0xff534d42 | 0, 0x5346414f, 0x73757245, 0x00c36400, 0x01021997]) {
    assert.equal(locationCheck('/mnt/data', type)!.level, 'warn');
  }
  for (const type of [undefined, 0, 0xef53, 0x9123683e, 0x65735546]) assert.equal(locationCheck('/data', type), undefined);
});

test('doctor accepts injected path and statfs; path warnings survive a failed statfs', async (t) => {
  const dir = tmp(t);
  const r = await runDoctor(dir, { home: tmp(t), port: 0, storage: {
    path: '/Users/u/Dropbox/data', statfs: () => ({ type: 0xef53, bavail: 1, bsize: 4096 }),
  } });
  assert.equal(byName(r, 'Storage')!.level, 'warn');
  assert.equal(byName(r, 'Disk')!.level, 'problem');
  const failed = storageChecks(dir, { path: '/Users/u/Dropbox/data', statfs: () => { throw new Error('unavailable'); } });
  assert.equal(byName(failed, 'Storage')!.level, 'warn');
  assert.equal(byName(failed, 'Disk')!.level, 'warn');
});

test('a symlink into a synced folder warns, and backup symlink loops are not followed', (t) => {
  const dir = tmp(t);
  const target = join(dir, 'Dropbox');
  mkdirSync(target);
  const alias = join(dir, 'data');
  symlinkSync(target, alias, 'junction');
  mkdirSync(join(target, 'Backups'));
  symlinkSync(target, join(target, 'Backups', 'loop'), 'junction');
  const r = storageChecks(alias, { statfs: () => ({ type: 0xef53, bavail: 1024 ** 3, bsize: 1 }) });
  assert.equal(byName(r, 'Storage')!.level, 'warn');
  assert.equal(byName(r, 'Disk')!.level, 'ok');
});

test('a missing folder, an empty folder and a taken port', async (t) => {
  const dir = tmp(t);
  const home = tmp(t);
  let r = await runDoctor(join(dir, 'nope'), { home, port: 0 });
  assert.equal(byName(r, 'Folder')!.level, 'problem');
  r = await runDoctor(dir, { home, port: 0 });
  assert.equal(byName(r, 'Folder')!.level, 'ok');
  assert.equal(byName(r, 'Files')!.level, 'warn');
  assert.equal(byName(r, 'Backups')!.level, 'warn');
  // A port something holds.
  const held = createServer();
  await new Promise<void>((done) => held.listen(0, '127.0.0.1', done));
  t.after(() => held.close());
  const port = (held.address() as { port: number }).port;
  r = await runDoctor(dir, { home, port });
  assert.equal(byName(r, 'Port')!.level, 'warn');
  assert.match(byName(r, 'Port')!.fix!, new RegExp(`--port ${port + 1}`));
});

test('--port is checked even when a service is installed, if it names another port', async (t) => {
  const dir = tmp(t);
  const home = tmp(t);
  const held = createServer();
  await new Promise<void>((done) => held.listen(0, '127.0.0.1', done));
  t.after(() => held.close());
  const port = (held.address() as { port: number }).port;
  writeFileSync(join(home, 'service.json'), JSON.stringify({ platform: 'linux', folder: dir, port: port + 1, host: '127.0.0.1', system: false, extra: [] }));
  const r = await runDoctor(dir, { home, port });
  assert.equal(byName(r, 'Port')!.level, 'warn');
  assert.match(byName(r, 'Port')!.message, new RegExp(`port ${port} is in use`));
  // Without --port, or naming the service's own port, only the service is asked about.
  assert.equal(byName(await runDoctor(dir, { home }), 'Port'), undefined);
  assert.equal(byName(await runDoctor(dir, { home, port: port + 1 }), 'Port'), undefined);
});

test('the newest backup set gives the backups check', (t) => {
  const dir = tmp(t);
  const sets = join(dir, 'Backups');
  mkdirSync(sets);
  assert.equal(backupCheck(dir).level, 'warn');
  const set = join(sets, '2026-10-01_030000');
  mkdirSync(set);
  const old = new Date(Date.now() - 30 * 86_400_000);
  utimesSync(set, old, old);
  const stale = backupCheck(dir);
  assert.equal(stale.level, 'warn', stale.message);
  assert.match(stale.message, /days old/);
  const fresh = new Date();
  utimesSync(set, fresh, fresh);
  assert.equal(backupCheck(dir).level, 'ok');
});

test('a certificate named in the settings: missing, unreadable', (t) => {
  const dir = tmp(t);
  assert.equal(certificateCheck(dir), undefined);
  writeFileSync(join(dir, '.openhbam-settings.json'), JSON.stringify({ tlsCert: 'cert.pem', tlsKey: 'key.pem' }));
  assert.match(certificateCheck(dir)!.message, /doesn't exist/);
  writeFileSync(join(dir, 'cert.pem'), 'not a certificate');
  assert.match(certificateCheck(dir)!.message, /isn't a certificate/);
  writeFileSync(join(dir, '.openhbam-settings.json'), '{ broken');
  assert.equal(certificateCheck(dir)!.name, 'Settings');
});

test('the CLI prints the checks, exits 1 on a problem, and changes nothing', (t) => {
  const dir = tmp(t);
  const home = tmp(t);
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const before = statSync(dir).mtimeMs;
  let r = spawnSync(process.execPath, ['--no-warnings', main, 'doctor', join(dir, 'missing')], { encoding: 'utf8', env });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /PROBLEM Folder: .*doesn't exist/);
  assert.match(r.stdout, /1 problem to fix/);
  r = spawnSync(process.execPath, ['--no-warnings', main, 'doctor', dir, '--port', '1'], { encoding: 'utf8', env });
  assert.match(r.stdout, /ok\s+Folder/);
  assert.equal(statSync(dir).mtimeMs, before, 'the folder was not touched');
  assert.match(doctorText([{ name: 'X', level: 'warn', message: 'm', fix: 'do this' }]), /-> do this/);
});

test('doctor --port reads the number given, with the folder before or after it', async (t) => {
  const dir = tmp(t);
  const home = tmp(t);
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const held = createServer();
  await new Promise<void>((res) => held.listen(0, '127.0.0.1', res));
  t.after(() => held.close());
  const port = (held.address() as { port: number }).port;
  for (const args of [[dir, '--port', String(port)], ['--port', String(port), dir]]) {
    const r = spawnSync(process.execPath, ['--no-warnings', main, 'doctor', ...args], { encoding: 'utf8', env });
    assert.match(r.stdout, new RegExp(`port ${port} is in use`), args.join(' '));
  }
});

// A throwaway self-signed certificate (no key kept), valid for five days from when it was made.
const CERT = `-----BEGIN CERTIFICATE-----
MIIBbTCCAROgAwIBAgIUfpOg+tQVCqhFGRfKrrz6NyHDkdgwCgYIKoZIzj0EAwIw
DDEKMAgGA1UEAwwBdDAeFw0yNjEwMTUwMDMyMjFaFw0yNjEwMjAwMDMyMjFaMAwx
CjAIBgNVBAMMAXQwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAR+IIE0HiJ+3o1T
P2uDCvyFqwbdaUUwo8x9qNApWybWe0wq/cYWmY7sN78kRIoyR0PwrkYDaDJmIdaQ
D9WRRizgo1MwUTAdBgNVHQ4EFgQUCWASIGAHsrmhfMrtBpyRxFr3cjcwHwYDVR0j
BBgwFoAUCWASIGAHsrmhfMrtBpyRxFr3cjcwDwYDVR0TAQH/BAUwAwEB/zAKBggq
hkjOPQQDAgNIADBFAiEAv1ww/XOigLmokqcwWIlAVar5s6uKZTT/fGao0NouCRAC
IFVzo7XkBt4HWjy+esFEYcxGihJIvlgla0ik735Qo2jp
-----END CERTIFICATE-----
`;

test('a certificate near its end or past it is called out', (t) => {
  const dir = tmp(t);
  writeFileSync(join(dir, '.openhbam-settings.json'), JSON.stringify({ tlsCert: 'cert.pem', tlsKey: 'key.pem' }));
  writeFileSync(join(dir, 'cert.pem'), CERT);
  const start = new Date(new X509Certificate(CERT).validFrom);
  const at = (days: number) => new Date(start.getTime() + days * 86_400_000);
  assert.equal(certificateCheck(dir, at(0))!.level, 'warn');
  assert.match(certificateCheck(dir, at(0))!.message, /runs out in 4 days|runs out in 5 days/);
  assert.equal(certificateCheck(dir, at(-30))!.level, 'ok');
  const expired = certificateCheck(dir, at(40))!;
  assert.equal(expired.level, 'problem');
  assert.match(expired.message, /expired \d+ days ago/);
});

test('the embedding check asks the endpoint for a vector, and is silent when none is set', async (t) => {
  const http = createHttp((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const model = JSON.parse(b).model;
      if (model === 'missing') return void res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'model "missing" not found, try pulling it first' } }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ index: 0, embedding: new Array(768).fill(0.5) }] }));
    });
  });
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  t.after(() => http.close());
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}/v1`;
  assert.equal(await embedCheck(undefined, undefined, {}), undefined);
  const ok = await embedCheck(url, 'nomic-embed-text', {});
  assert.equal(ok!.level, 'ok');
  assert.match(ok!.message, /768-number vectors/);
  const missing = await embedCheck(url, 'missing', {});
  assert.equal(missing!.level, 'problem');
  assert.match(missing!.fix!, /embedding model/);
  const down = await embedCheck('http://127.0.0.1:1/v1', 'm', {});
  assert.equal(down!.level, 'problem');
  assert.match(down!.fix!, /Start the embedding server/);
  // The variables the server reads are the ones checked, and a half setting is named.
  assert.equal((await embedCheck(undefined, undefined, { TABULARIUS_AI_EMBED_URL: url, TABULARIUS_AI_EMBED_MODEL: 'x' }))!.level, 'ok');
  assert.match((await embedCheck('http://localhost:9/v1', undefined, {}))!.message, /go together/);
});

test('accounts that share a sign-in lockout bucket are named, and a file without such a pair says nothing', (t) => {
  const dir = tmp(t);
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Shop');
  for (const name of ['Stra\u00dfe', 'STRASSE', 'Other']) store.sql.prepare("INSERT INTO _fm_accounts (name, source, privilege_set) VALUES (?, 'openhbam', 'Staff')").run(name);
  assert.deepEqual(store.accountsSharingLockout(), [['STRASSE', 'Straße']]);
  store.close();
  const checks = accountChecks(dir);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].level, 'warn');
  assert.match(checks[0].message, /Shop: "STRASSE" and "Straße" share one sign-in lockout/);
  assert.match(checks[0].fix!, /Rename or delete/);

  const clean = tmp(t);
  createStore(join(clean, 'Plain.openhbam.sqlite'));
  assert.deepEqual(accountChecks(clean), []);
});

test('a file written by a newer Tabularius is named, with what to do, and a current one says nothing', (t) => {
  const dir = tmp(t);
  const newer = join(dir, 'Later.openhbam.sqlite');
  createStore(newer);
  new Store(newer, 'Later').close();
  assert.deepEqual(formatChecks(dir), []);
  const sql = new DatabaseSync(newer);
  sql.prepare("INSERT INTO _fm_meta VALUES ('storeFormat', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json").run(JSON.stringify(STORE_FORMAT + 1));
  sql.close();
  const checks = formatChecks(dir);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].level, 'problem');
  assert.match(checks[0].message, /^Later was written by a newer Tabularius \(file format \d+; this version reads up to format \d+\), so this version does not open it$/);
  assert.match(checks[0].fix!, /tabularius upgrade.*tabularius restore/);
});

test('a newer file is found in an encrypted store too, with the key; without it the store is named as unchecked', (t) => {
  const dir = tmp(t);
  const plain = join(dir, 'Later.openhbam.sqlite');
  createStore(plain);
  new Store(plain, 'Later').close();
  const sql = new DatabaseSync(plain);
  sql.prepare("INSERT INTO _fm_meta VALUES ('storeFormat', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json").run(JSON.stringify(STORE_FORMAT + 1));
  sql.close();
  encryptFileSync(plain, plain + '.enc', 'secret');
  rmSync(plain);
  assert.deepEqual(filesNewerThan(dir, STORE_FORMAT, undefined), []);
  assert.deepEqual(filesNewerThan(dir, STORE_FORMAT, 'secret').map((f) => f.name), ['Later']);
  const saved = process.env.TABULARIUS_ENCRYPTION_KEY;
  delete process.env.TABULARIUS_ENCRYPTION_KEY;
  t.after(() => { if (saved !== undefined) process.env.TABULARIUS_ENCRYPTION_KEY = saved; });
  const without = formatChecks(dir);
  assert.equal(without.length, 1);
  assert.equal(without[0].name, 'Encrypted files');
  assert.match(without[0].message, /^Later is encrypted/);
  process.env.TABULARIUS_ENCRYPTION_KEY = 'secret';
  const withKey = formatChecks(dir);
  assert.equal(withKey.length, 1);
  assert.equal(withKey[0].name, 'Newer file');
});

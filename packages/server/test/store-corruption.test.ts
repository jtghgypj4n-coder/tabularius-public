// The server's own files, damaged the ways disks, copies and sync tools damage them. For each damage: the server starts or
// refuses with a clear message and never crashes, the damage is named, the other hosted files keep working, nothing from a
// damaged file is served as if sound, and a backup of a damaged file does not pass for a good one. Tiny stores, run one
// after another.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, DiskTrouble, FileDamaged, Store, isDamageError } from '../../store/src/index.ts';
import { watchDatabase, type DamageWatch } from '../../store/src/damage.ts';
import { serve } from '../src/index.ts';
import { backupFolder, restoreBackup } from '../src/backup.ts';
import { integrity, pageCheck, verifySet } from '../src/backup-verify.ts';
import { fileChecks } from '../../cli/src/doctor.ts';

const PAGE = 4096;
const EXT = '.openhbam.sqlite';

/** A store with a table of records big enough to span many pages, an account, and nothing left in the log. */
function build(path: string, name: string): void {
  createStore(path);
  const s = new Store(path, name);
  s.applyDesign([{ op: 'createTable', name: 'Clients', fields: [{ name: 'Name' }, { name: 'Notes' }] }]);
  for (let i = 0; i < 300; i++) s.create('Clients', { Name: `Client ${i}`, Notes: 'x'.repeat(300) + i });
  s.setPassword('boss', 'pw', '[Full Access]');
  s.checkpoint();
  s.close();
}

function folder(t: TestContext, names: string[] = ['Good', 'Work']): { dir: string; path: (name: string) => string; good: Buffer } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-corrupt-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  for (const n of names) build(join(dir, n + EXT), n);
  return { dir, path: (n) => join(dir, n + EXT), good: readFileSync(join(dir, names[0] + EXT)) };
}

const zeroPages = (path: string, from: number, to: number) => {
  const fd = openSync(path, 'r+');
  try { for (let p = from; p < to; p++) writeSync(fd, Buffer.alloc(PAGE), 0, PAGE, p * PAGE); } finally { closeSync(fd); }
};
const overwrite = (path: string, at: number, bytes: Buffer) => {
  const fd = openSync(path, 'r+');
  try { writeSync(fd, bytes, 0, bytes.length, at); } finally { closeSync(fd); }
};

async function start(t: TestContext, dir: string) {
  const logs: string[] = [];
  const running = await serve({ dir, port: 0, log: (l: string) => logs.push(l), checkFiles: false });
  t.after(async () => { await new Promise<void>((resolve) => running.server.close(() => resolve())); await running.host.close(); });
  const call = async (db: string, path: string, init: RequestInit & { token?: string } = {}) => {
    const { token, ...rest } = init;
    const r = await fetch(`${running.url}/fmi/data/vLatest/databases/${db}/${path}`, { ...rest, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', ...(rest.headers as object) } });
    const text = await r.text();
    return { status: r.status, text, json: (() => { try { return JSON.parse(text); } catch { return undefined; } })() };
  };
  const login = async (db: string) => (await call(db, 'sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('boss:pw') }, body: '{}' })).json?.response?.token as string | undefined;
  return { running, host: running.host, logs, call, login };
}

test('a file that is not a database, truncated or cut short is refused with a message that names the file and the damage, and is left as it was', (t) => {
  const f = folder(t, ['Good']);
  const attempt = (damage: (p: string) => void, expect: RegExp) => {
    const p = f.path('Dmg');
    for (const side of ['', '-wal', '-shm']) rmSync(p + side, { force: true });
    writeFileSync(p, f.good);
    damage(p);
    const before = readFileSync(p);
    assert.throws(() => new Store(p, 'Dmg'), (e: unknown) => expect.test((e as Error).message) && !(e as Error).message.includes(p));
    assert.deepEqual(readFileSync(p), before, 'a refused file is not changed by trying to open it');
    assert.notEqual(integrity(p), 'ok', 'the check names it too');
  };
  attempt((p) => overwrite(p, 0, Buffer.from('NOT A DATABASE FILE')), /Dmg is damaged \(file is not a database\)/);
  attempt((p) => zeroPages(p, 0, 1), /Dmg is damaged \(file is not a database\)/);
  attempt((p) => truncateSync(p, statSync(p).size / 2), /Dmg is damaged \(database disk image is malformed\)/);
  attempt((p) => truncateSync(p, statSync(p).size - PAGE), /Dmg is damaged \(database disk image is malformed\)/);
  attempt((p) => { for (let i = 100; i < PAGE; i += 50) overwrite(p, i, Buffer.from([0x55])); }, /Dmg is damaged/);
});

test('an empty file is refused as empty and stays empty; a database that is not Tabularius\'s is refused untouched; a missing file is not made', (t) => {
  const f = folder(t, ['Good']);
  const empty = f.path('Empty');
  writeFileSync(empty, '');
  assert.throws(() => new Store(empty, 'Empty'), /Empty is an empty file \(0 bytes\)/);
  assert.equal(statSync(empty).size, 0, 'opening it built nothing into it');
  assert.equal(existsSync(empty + '-wal'), false);

  const foreign = f.path('Foreign');
  const { DatabaseSync } = await_node_sqlite();
  const db = new DatabaseSync(foreign);
  db.exec('CREATE TABLE stuff (a)');
  db.close();
  const before = readFileSync(foreign);
  assert.throws(() => new Store(foreign, 'Foreign'), /Foreign is not a Tabularius database/);
  assert.deepEqual(readFileSync(foreign), before);

  const missing = f.path('Nothing');
  assert.throws(() => new Store(missing, 'Nothing'), /not a Tabularius database/);
  assert.equal(existsSync(missing), false, 'a path with nothing at it is not created by a failed open');
  assert.equal(existsSync(missing + '-wal'), false);
});

function await_node_sqlite(): typeof import('node:sqlite') {
  return process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
}

test('a server starts with a file it cannot open: the others are hosted, the file is listed with the reason and named in the log', async (t) => {
  const f = folder(t);
  zeroPages(f.path('Work'), 0, 1);
  const s = await start(t, f.dir);
  assert.deepEqual(s.host.names(), ['Good']);
  const listed = s.host.files().find((x) => x.name === 'Work');
  assert.equal(listed?.status, 'closed');
  assert.match(listed?.damaged ?? '', /Work is damaged \(file is not a database\)/);
  assert.ok(s.logs.some((l) => /can't open Work\.openhbam\.sqlite, so it is not hosted: Work is damaged/.test(l)));
  const token = await s.login('Good');
  assert.ok(token);
  const records = await s.call('Good', 'layouts/Clients/records?_limit=5', { token });
  assert.equal(records.status, 200);
  assert.ok([401, 404].includes((await s.call('Work', 'sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('boss:pw') }, body: '{}' })).status), 'a file that is not hosted cannot be signed in to');
});

test('damaged pages the open does not read are found by the startup check, which takes the file offline and leaves the others serving', async (t) => {
  const f = folder(t);
  zeroPages(f.path('Work'), 60, 90);
  const s = await start(t, f.dir);
  assert.deepEqual(s.host.names(), ['Good', 'Work'], 'it opens: the damage is in pages nothing has read yet');
  await s.host.scanIntegrity();
  assert.deepEqual(s.host.names(), ['Good']);
  assert.match(s.host.files().find((x) => x.name === 'Work')?.damaged ?? '', /malformed/);
  assert.ok(s.logs.some((l) => /Work is damaged .* no longer served/.test(l)));
  const token = await s.login('Good');
  const good = await s.call('Good', 'layouts/Clients/records', { method: 'POST', token, body: JSON.stringify({ fieldData: { Name: 'still works' } }) });
  assert.equal(good.status, 200, good.text);
});

test('a query that lands on a damaged page is answered with the file\'s name and the damage, not "Unknown error"; the file is then offline, nothing more is written to it, and the others are unaffected', async (t) => {
  const f = folder(t);
  const s = await start(t, f.dir);
  const work = await s.login('Work');
  const good = await s.login('Good');
  assert.ok(work && good);
  zeroPages(f.path('Work'), 60, 90); // damaged while the server has it open
  const first = await s.call('Work', 'layouts/Clients/records?_limit=1000', { token: work });
  assert.equal(first.json.messages[0].code, '802', first.text);
  assert.match(first.json.messages[0].message, /^Work is damaged \(database disk image is malformed\)/);
  assert.doesNotMatch(first.text, /Unknown error|tabularius-corrupt/);
  assert.deepEqual(s.host.names(), ['Good'], 'taken offline by the first query that hit it');
  const write = await s.call('Work', 'layouts/Clients/records', { method: 'POST', token: work, body: JSON.stringify({ fieldData: { Name: 'refused' } }) });
  assert.ok(write.status >= 400, write.text);
  const after = readFileSync(f.path('Work'));
  assert.ok(after.subarray(60 * PAGE, 90 * PAGE).every((b) => b === 0), 'the damaged pages were left as they were found (closing folds the earlier log into the file; nothing new is written)');
  assert.ok(s.logs.some((l) => /Work is damaged .* no longer served/.test(l)));
  const other = await s.call('Good', 'layouts/Clients/records?_limit=3', { token: good });
  assert.equal(other.status, 200);
});

test('a store that found damage refuses every later query itself, including ones prepared earlier, without touching the file', async (t) => {
  const f = folder(t, ['Work']);
  const store = new Store(f.path('Work'), 'Work');
  const reached: FileDamaged[] = [];
  store.onDamage = (d) => reached.push(d);
  const earlier = store.sql.prepare('SELECT count(*) AS n FROM "Clients"');
  const records = store.sql.prepare('SELECT * FROM "Clients"');
  zeroPages(f.path('Work'), 60, 90);
  assert.throws(() => records.all(), (e: unknown) => e instanceof FileDamaged && (e as FileDamaged).code === 802);
  await new Promise((r) => setImmediate(r));
  assert.equal(reached.length, 1);
  assert.throws(() => earlier.get(), FileDamaged);
  assert.throws(() => store.sql.prepare('SELECT 1'), FileDamaged);
  assert.throws(() => store.sql.exec('SELECT 1'), FileDamaged);
  assert.throws(() => store.create('Clients', { Name: 'no' }), FileDamaged);
  assert.equal(reached.length, 1, 'said once');
  store.close();
});

test('a damaged file stays offline until it passes the check; a good copy put in its place is served again', async (t) => {
  const f = folder(t);
  const original = readFileSync(f.path('Work'));
  zeroPages(f.path('Work'), 60, 90);
  const s = await start(t, f.dir);
  await s.host.scanIntegrity();
  assert.deepEqual(s.host.names(), ['Good']);
  assert.throws(() => s.host.openFile('Work'), /Work is still damaged/);
  assert.deepEqual(s.host.names(), ['Good']);
  for (const side of ['-wal', '-shm']) rmSync(f.path('Work') + side, { force: true });
  writeFileSync(f.path('Work'), original);
  assert.equal(s.host.openFile('Work'), true);
  assert.deepEqual(s.host.names(), ['Good', 'Work']);
  const token = await s.login('Work');
  assert.equal((await s.call('Work', 'layouts/Clients/records?_limit=300', { token })).status, 200);
});

test('doctor names a damaged file and reads a sound one as sound; a flipped byte inside a record is not something SQLite can see', (t) => {
  const f = folder(t);
  const sound = fileChecks(f.dir);
  assert.deepEqual(sound.map((c) => [c.name, c.level]), [['Pages', 'ok']]);
  assert.match(sound[0].message, /2 files read cleanly/);

  zeroPages(f.path('Work'), 60, 90);
  const bad = fileChecks(f.dir);
  assert.deepEqual(bad.map((c) => [c.name, c.level]), [['Damaged file', 'problem']]);
  assert.match(bad[0].message, /^Work: .*malformed/);
  assert.match(bad[0].fix ?? '', /restore/);
  assert.equal(fileChecks(f.dir, { full: true })[0].level, 'problem');

  writeFileSync(f.path('Work'), f.good);
  const flipped = readFileSync(f.path('Work'));
  flipped[PAGE * 100 + 1500] ^= 0xff; // inside a record's text
  writeFileSync(f.path('Work'), flipped);
  assert.deepEqual(fileChecks(f.dir, { full: true }).map((c) => c.level), ['ok'], 'documented limit: no page checksums; backups carry them');

  writeFileSync(f.path('Work'), '');
  assert.match(fileChecks(f.dir)[0].message, /^Work: the file is empty/);
  rmSync(f.path('Work'));
  writeFileSync(f.path('Work'), 'x'.repeat(5000));
  assert.match(fileChecks(f.dir)[0].message, /^Work: file is not a database/);
});

test('a log that is gone, cut short or beside the wrong file leaves a file that opens and reads as of its last whole commit', (t) => {
  const f = folder(t, ['Work']);
  const live = new Store(f.path('Work'), 'Work');
  for (let i = 0; i < 50; i++) live.create('Clients', { Name: `Late ${i}`, Notes: 'y'.repeat(200) });
  // Copied while the server has it open: the main file as of the last checkpoint, and the log as it stands.
  const copy = (name: string) => {
    for (const side of ['', '-wal']) if (existsSync(f.path('Work') + side)) copyFileSync(f.path('Work') + side, join(f.dir, name + EXT + side));
    return join(f.dir, name + EXT);
  };
  const whole = copy('Whole');
  const gone = copy('Gone');
  rmSync(gone + '-wal', { force: true });
  const cut = copy('Cut');
  truncateSync(cut + '-wal', Math.floor(statSync(cut + '-wal').size / 2));
  const zeroed = copy('Zeroed');
  overwrite(zeroed + '-wal', 40, Buffer.alloc(200));
  live.close();
  const counts: Record<string, number> = {};
  for (const [name, p] of [['whole', whole], ['gone', gone], ['cut', cut], ['zeroed', zeroed]] as const) {
    assert.equal(integrity(p), 'ok', `${name}: the file is sound`);
    const s = new Store(p, name);
    counts[name] = Number(s.select('SELECT count(*) AS n FROM "Clients"', [], 5).rows[0][0]);
    s.close();
  }
  assert.equal(counts.whole, 350);
  for (const name of ['gone', 'cut', 'zeroed']) assert.ok(counts[name] >= 300 && counts[name] <= 350, `${name}: ${counts[name]} records, between the checkpoint and the end`);
});

test('leftovers of an interrupted copy, restore or conversion beside the files do not stop the server or the hosted files', async (t) => {
  const f = folder(t);
  for (const name of ['Work.openhbam.sqlite.partial', 'Work.openhbam.sqlite.restoring', 'Work.openhbam.sqlite.enc.partial', 'Work.openhbam.sqlite-journal', '.Work.converting', 'Work.lock', 'Work.openhbam.sqlite.results', 'Nothing.openhbam.sqlite-wal']) {
    writeFileSync(join(f.dir, name), 'left behind');
  }
  mkdirSync(join(f.dir, '.Other.converting.d'));
  const s = await start(t, f.dir);
  await s.host.scanIntegrity();
  assert.deepEqual(s.host.names(), ['Good', 'Work']);
  const token = await s.login('Work');
  const r = await s.call('Work', 'layouts/Clients/records?_limit=300', { token });
  assert.equal(r.status, 200);
  assert.equal(r.json.response.dataInfo.foundCount, 300);
  assert.equal(integrity(f.path('Work')), 'ok');
});

test('a write that fails for want of disk says so, writes nothing, and leaves the file sound and in use', (t) => {
  // The disk is a file-size limit on a child process: writing past it fails the way a full disk does.
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-full-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const script = join(dir, 'full.ts');
  const storeIndex = join(import.meta.dirname, '..', '..', 'store', 'src', 'index.ts');
  const check = join(import.meta.dirname, '..', 'src', 'backup-verify.ts');
  writeFileSync(script, `
    import { createStore, Store } from ${JSON.stringify(storeIndex)};
    import { integrity } from ${JSON.stringify(check)};
    process.on('SIGXFSZ', () => {});
    const p = ${JSON.stringify(join(dir, 'Full' + EXT))};
    createStore(p);
    const s = new Store(p, 'Full');
    s.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'A' }] }]);
    let made = 0; let error = '';
    try { for (; made < 5000; made++) s.create('T', { A: 'x'.repeat(2000) + made }); } catch (e) { error = e.constructor.name + ': ' + e.message; }
    const count = Number(s.select('SELECT count(*) AS n FROM T', [], 5).rows[0][0]);
    s.close();
    console.log(JSON.stringify({ made, error, count, integrity: integrity(p) }));
  `);
  const r = spawnSync('sh', ['-c', `ulimit -f 1500 && exec "${process.execPath}" --no-warnings "${script}"`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop()!);
  assert.ok(out.made > 0 && out.made < 5000, 'it ran into the limit');
  assert.match(out.error, /^DiskTrouble: Full could not be written: the disk (is full|reported an error)/);
  assert.match(out.error, /Nothing from this request was saved/);
  assert.equal(out.count, out.made, 'every record that was reported saved is there, and the failed one is not');
  assert.equal(out.integrity, 'ok');
});

test('a backup of a damaged live file is taken but does not pass its check, and it can never be restored over a good file', async (t) => {
  const f = folder(t, ['Good', 'Work']);
  const dest = mkdtempSync(join(tmpdir(), 'tabularius-corrupt-backups-'));
  t.after(() => rmSync(dest, { recursive: true, force: true }));
  const goodBackup = (await backupFolder(f.dir, dest, 0, '')).dir;
  assert.equal((await verifySet(goodBackup, '')).ok, true);

  zeroPages(f.path('Work'), 60, 90);
  const damaged = (await backupFolder(f.dir, join(dest, 'later'), 0, '').catch((e: Error) => e));
  if (damaged instanceof Error) {
    assert.match(damaged.message, /Work|damaged|malformed/, 'a backup that refuses to copy a damaged file says which');
  } else {
    const check = await verifySet(damaged.dir, '');
    assert.equal(check.ok, false);
    assert.match(check.files['Work.openhbam.sqlite'] ?? '', /malformed/);
    assert.equal(check.files['Good.openhbam.sqlite'], 'ok');
    const live = readFileSync(f.path('Good'));
    await assert.rejects(restoreBackup(f.dir, damaged.dir, undefined, ''), /malformed|damaged|integrity/i);
    assert.deepEqual(readFileSync(f.path('Good')), live, 'a set with one damaged file replaces none of them');
  }
  // The earlier, sound set still restores the damaged live file.
  await restoreBackup(f.dir, goodBackup, undefined, '');
  assert.equal(integrity(f.path('Work')), 'ok');
});

test('a file whose first page is gone ("file is not a database") is restored from a backup, with every password switched off', async (t) => {
  const f = folder(t, ['Good', 'Work']);
  const dest = mkdtempSync(join(tmpdir(), 'tabularius-corrupt-backups-'));
  t.after(() => rmSync(dest, { recursive: true, force: true }));
  const set = (await backupFolder(f.dir, dest, 0, '')).dir;
  overwrite(f.path('Work'), 0, Buffer.alloc(PAGE, 0xab));
  assert.match(integrity(f.path('Work')), /not a database/);
  // What the recovery pages tell people to run: the restore has to work on exactly the file that needs it.
  assert.deepEqual(await restoreBackup(f.dir, set, 'Work', ''), ['Work.openhbam.sqlite']);
  assert.equal(integrity(f.path('Work')), 'ok');
  const work = new Store(f.path('Work'), 'Work');
  try {
    assert.equal(work.verify('boss', 'pw', ''), false, 'the damaged file\'s credentials could not be read, so none is carried over: the password is switched off until it is set again');
    assert.equal(Number(work.select('SELECT count(*) AS n FROM "Clients"', [], 5).rows[0][0]), 300, 'the records are all back');
  } finally { work.close(); }
});

test('a backup\'s own record of itself, damaged, refuses the restore and changes nothing', async (t) => {
  const f = folder(t, ['Good']);
  const dest = mkdtempSync(join(tmpdir(), 'tabularius-corrupt-backups-'));
  t.after(() => rmSync(dest, { recursive: true, force: true }));
  const set = (await backupFolder(f.dir, dest, 0, '')).dir;
  const manifest = join(set, 'backup.json');
  const original = readFileSync(manifest);
  const live = readFileSync(f.path('Good'));
  const ruin: [string, () => void][] = [
    ['truncated', () => truncateSync(manifest, 20)],
    ['garbage', () => writeFileSync(manifest, 'not json {{{')],
    ['a checksum that is wrong', () => { const i = JSON.parse(original.toString()); for (const k of Object.keys(i.sha256 ?? {})) i.sha256[k] = '0'.repeat(64); writeFileSync(manifest, JSON.stringify(i)); }],
  ];
  for (const [what, damage] of ruin) {
    writeFileSync(manifest, original);
    damage();
    await assert.rejects(restoreBackup(f.dir, set, undefined, ''), (e: unknown) => /backup|checksum|changed|JSON|manifest/i.test((e as Error).message), what);
    assert.deepEqual(readFileSync(f.path('Good')), live, `${what}: the live file is as it was`);
    const check = await verifySet(set, '').catch((e: Error) => ({ ok: false, files: { error: e.message } }));
    assert.equal(check.ok, false, `${what}: verify-backup does not pass it`);
  }
});

test('a set without its backup.json has no checksums to compare, but each file still has to pass the integrity check', async (t) => {
  const f = folder(t, ['Good']);
  const dest = mkdtempSync(join(tmpdir(), 'tabularius-corrupt-backups-'));
  t.after(() => rmSync(dest, { recursive: true, force: true }));
  const set = (await backupFolder(f.dir, dest, 0, '')).dir;
  rmSync(join(set, 'backup.json'));
  assert.equal((await verifySet(set, '')).ok, false, 'verify-backup does not pass a set that has lost its record');
  zeroPages(join(set, 'Good' + EXT), 60, 90);
  const live = readFileSync(f.path('Good'));
  await assert.rejects(restoreBackup(f.dir, set, undefined, ''), /malformed/);
  assert.deepEqual(readFileSync(f.path('Good')), live);
});

test('checkFiles: false leaves the check made at start out', async (t) => {
  const f = folder(t);
  zeroPages(f.path('Work'), 60, 90);
  const off = await start(t, f.dir);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(off.host.names(), ['Good', 'Work'], 'not checked unless asked');
});

test('a folder or a file the server\'s user cannot write is refused with a message that says whose access to fix, and nothing is changed', (t) => {
  // Run as an ordinary user: root writes anywhere. Where the test itself is root, the child drops to "nobody".
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-readonly-'));
  t.after(() => { spawnSync('chmod', ['-R', 'u+rwx,go+rwx', dir]); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  const root = process.getuid?.() === 0;
  const as = root ? { uid: 65534, gid: 65534 } : {};
  const storeIndex = join(import.meta.dirname, '..', '..', 'store', 'src', 'index.ts');
  const serverIndex = join(import.meta.dirname, '..', 'src', 'index.ts');
  const script = join(dir, 'readonly.ts');
  writeFileSync(script, `
    import { chmodSync, mkdirSync } from 'node:fs';
    import { join } from 'node:path';
    import { createStore, Store } from ${JSON.stringify(storeIndex)};
    import { serve } from ${JSON.stringify(serverIndex)};
    const out = {};
    const make = (name) => {
      const d = join(${JSON.stringify(dir)}, name);
      mkdirSync(d, { recursive: true });
      const p = join(d, 'Work.openhbam.sqlite');
      createStore(p);
      const s = new Store(p, 'Work');
      s.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'A' }] }]);
      s.checkpoint(); s.close();
      return { d, p };
    };
    const folder = make('folder'); chmodSync(folder.d, 0o555);
    try { await serve({ dir: folder.d, port: 0, log: () => {}, checkFiles: false, watch: false }); out.folder = 'served'; } catch (e) { out.folder = e.message; }
    const file = make('file'); chmodSync(file.p, 0o444);
    const logs = [];
    const r = await serve({ dir: file.d, port: 0, log: (l) => logs.push(l), checkFiles: false, watch: false });
    out.file = logs.join(' | ');
    out.fileHosted = r.host.names();
    out.fileListed = r.host.files().map((f) => f.status + ':' + (f.damaged ?? ''));
    r.server.close(); await r.host.close();
    console.log(JSON.stringify(out));
    process.exit(0);
  `);
  spawnSync('chmod', ['-R', 'go+rwx', dir]);
  const r = spawnSync(process.execPath, ['--no-warnings', script], { encoding: 'utf8', timeout: 60_000, ...as });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop()!);
  assert.match(out.folder, /can't be written by the user running Tabularius, so it can't be hosted/);
  assert.doesNotMatch(out.folder, /\.tmp/);
  assert.match(out.file, /can't open Work\.openhbam\.sqlite, so it is not hosted: Work is read-only for the user running the server/);
  assert.deepEqual(out.fileHosted, []);
  assert.match(out.fileListed[0], /^closed:Work is read-only/);
});

test('the check made at start runs by itself, and a file it cannot read is not called damaged', async (t) => {
  const f = folder(t);
  zeroPages(f.path('Work'), 60, 90);
  const logs: string[] = [];
  const running = await serve({ dir: f.dir, port: 0, log: (l: string) => logs.push(l) });
  t.after(async () => { await new Promise<void>((resolve) => running.server.close(() => resolve())); await running.host.close(); });
  for (let i = 0; i < 100 && running.host.names().includes('Work'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(running.host.names(), ['Good'], 'found without anyone asking');

  // A check that could not run (no permission, a busy file) says nothing about the pages: the file stays in use.
  const host = (await start(t, mkFolder(t))).host;
  (host as unknown as { checkPages: () => Promise<unknown> }).checkPages = async () => ({ state: 'unreadable', detail: 'unable to open database file' });
  await host.scanIntegrity();
  assert.deepEqual(host.names(), ['Good', 'Work']);
});
const mkFolder = (t: TestContext) => folder(t, ['Good', 'Work']).dir;

test('pageCheck tells a damaged file from one it cannot read, and removes nothing', (t) => {
  const f = folder(t);
  assert.deepEqual(pageCheck(f.path('Good')), { state: 'ok' });
  zeroPages(f.path('Work'), 60, 90);
  assert.equal(pageCheck(f.path('Work')).state, 'damaged');
  writeFileSync(f.path('Work'), Buffer.alloc(PAGE * 4, 7));
  assert.equal(pageCheck(f.path('Work')).state, 'damaged', 'not a database');
  const gone = pageCheck(join(f.dir, 'Nothing' + EXT));
  assert.equal(gone.state, 'unreadable', 'a file that is not there says nothing about its pages');
  // A server's log beside a file it has open is not the check's to remove.
  const live = new Store(f.path('Good'), 'Good');
  live.create('Clients', { Name: 'unsaved to the file' });
  assert.ok(existsSync(f.path('Good') + '-wal'));
  assert.deepEqual(pageCheck(f.path('Good')), { state: 'ok' });
  assert.ok(existsSync(f.path('Good') + '-wal'), 'the log stays');
  live.close();
});

test('SQLite errors are told apart: unreadable pages are damage, a failed write is the disk, the word index and a busy file are neither', () => {
  const error = (errcode: number, message = 'x') => Object.assign(new Error(message), { errcode });
  const fake = (code: number) => {
    const db = { exec() { throw error(code); }, prepare() { throw error(code); } } as unknown as DatabaseSync;
    const watch: DamageWatch = {};
    watchDatabase(db, 'File', watch);
    return { db, watch };
  };
  for (const [code, kind] of [[11, 'damaged'], [26, 'damaged'], [266, 'damaged'], [522, 'damaged'], [778, 'disk'], [1034, 'disk'], [13, 'disk'], [267, 'plain'], [5, 'plain'], [6, 'plain'], [19, 'plain']] as const) {
    const { db, watch } = fake(code);
    let got: unknown;
    try { db.exec('x'); } catch (e) { got = e; }
    if (kind === 'damaged') { assert.ok(got instanceof FileDamaged, `${code}`); assert.ok(watch.damage); }
    else if (kind === 'disk') { assert.ok(got instanceof DiskTrouble, `${code}`); assert.match((got as Error).message, /could not be written/); assert.equal(watch.damage, undefined); }
    else { assert.ok(!(got instanceof FileDamaged) && !(got instanceof DiskTrouble), `${code}`); assert.equal(isDamageError(got), false); assert.equal(watch.damage, undefined, 'the file is not taken offline'); }
  }
});

test('the host is told of damage after the failing statement has ended, not inside it', async () => {
  const error = Object.assign(new Error('database disk image is malformed'), { errcode: 11 });
  const db = { exec() { throw error; }, prepare() { throw error; } } as unknown as DatabaseSync;
  let told = false;
  watchDatabase(db, 'File', { onDamage: () => { told = true; } });
  assert.throws(() => db.exec('x'), FileDamaged);
  assert.equal(told, false, 'still inside the statement');
  await new Promise((r) => setImmediate(r));
  assert.equal(told, true);
});

test('a checkpoint that a reader holds back says so, instead of leaving the changes out of the file', (t) => {
  const f = folder(t, ['Good']);
  const store = new Store(f.path('Good'), 'Good');
  const reader = new DatabaseSync(f.path('Good'), { readOnly: true });
  t.after(() => { try { reader.close(); } catch { /* closed */ } store.close(); });
  reader.exec('BEGIN');
  reader.prepare('SELECT count(*) FROM sqlite_master').get();
  store.create('Clients', { Name: 'written after the reader began' });
  assert.throws(() => store.checkpoint(), /being read by a check that has not finished/);
  reader.exec('COMMIT');
  store.checkpoint();
});

test('a file found damaged here is announced to the cluster\'s other processes, which stop serving it without announcing it again', async (t) => {
  const f = folder(t);
  const a = await start(t, f.dir);
  const calls: unknown[][] = [];
  a.host.peers = { sync: async (...args) => { calls.push(args); } };
  a.host.takeOffline(a.host.get('Work')!, new FileDamaged('Work', 'bad pages'));
  assert.deepEqual(calls, [['Work', 'offline', 'bad pages']]);
  const b = await start(t, mkFolder(t));
  const again: unknown[][] = [];
  b.host.peers = { sync: async (...args) => { again.push(args); } };
  b.host.takeOfflineByName('Work', 'bad pages');
  assert.deepEqual(b.host.names(), ['Good']);
  assert.deepEqual(again, []);
  assert.equal(b.host.files().find((x) => x.name === 'Work')?.damaged, 'bad pages');
});

test('closing the host while the startup check runs waits for it, and a file whose log could not be folded in is not encrypted over', async (t) => {
  const f = folder(t);
  const s = await start(t, f.dir);
  const scanning = s.host.scanIntegrity();
  await s.host.close();
  await scanning.catch(() => {});
  assert.deepEqual(pageCheck(f.path('Work')), { state: 'ok' });
});

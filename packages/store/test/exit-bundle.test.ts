// The portable copy of a whole file: layout, restart after a crash, the frozen snapshot, tampering and discard.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, chownSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, discardExitBundle, exitBundle, ExitBundleError, Store, totpCode } from '../src/index.ts';

const PASSWORD = ['correct', 'horse', 'battery', 'staple'].join(' ');
const ROWS = 10_500;
let dir: string;
let store: Store;
let inside: number;
let outside: number;
let outsideBytes: Buffer;
const externalDirectory = 'private-container-directory-358';

const files = (root: string, rel = ''): string[] =>
  readdirSync(join(root, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(root, join(rel, e.name)) : [join(rel, e.name).split('\\').join('/')]));
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const asAdmin = (extra: Parameters<typeof exitBundle>[2] extends infer O ? Partial<O> : never = {}) => ({ account: 'Admin', password: PASSWORD, ...extra });

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-exit-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  store = new Store(path, 'Shop');
  store.applyDesign([
    {
      op: 'createTable', name: 'Customers', fields: [
        { name: 'Name', type: 'text' },
        { name: 'Credit', type: 'number' },
        { name: 'Photo', type: 'container' },
        { name: 'Scan', type: 'container' },
        { name: 'Motto', type: 'text', options: { global: true } },
        { name: 'Number', type: 'number', options: { autoEnter: { serial: { next: '500', increment: 5 } } } },
      ],
    },
  ]);
  store.setPassword('Admin', PASSWORD);
  inside = store.addContainer({ filename: 'photo one.png', mime: 'image/png', data: Buffer.from('inside the file') });
  // An externally stored file: the folder beside the hosted file holds the bytes.
  outsideBytes = Buffer.from('%PDF-1.4 outside the file, '.repeat(100));
  mkdirSync(join(dir, 'RC_Data_FMS', 'Shop', externalDirectory), { recursive: true });
  writeFileSync(join(dir, 'RC_Data_FMS', 'Shop', externalDirectory, 'scan.pdf'), outsideBytes);
  const sql = (store as unknown as { sql: DatabaseSync }).sql;
  sql.prepare("INSERT INTO _fm_containers (filename, mime, kind, data, external, external_size) VALUES ('scan.pdf', 'application/pdf', 'file', x'', ?, ?)").run(`${externalDirectory}/scan.pdf`, outsideBytes.length);
  outside = Number((sql.prepare('SELECT max(id) AS id FROM _fm_containers').get() as { id: number }).id);
  sql.exec('BEGIN');
  const add = sql.prepare('INSERT INTO Customers (Name, Credit, Photo, Scan, Number) VALUES (?, ?, ?, ?, ?)');
  for (let i = 1; i <= ROWS; i++) add.run(i === 1 ? 'Ann, "the first"\nline two' : `Customer ${i}`, i % 7 === 0 ? null : i * 1.5, i === 2 ? inside : null, i === 3 ? outside : null, i * 5);
  sql.exec('COMMIT');
  sql.prepare("INSERT INTO _fm_meta VALUES ('globals', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json").run(JSON.stringify({ Customers: { Motto: 'hello' } }));
});

after(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const events = (kind: string) => store.securityEvents({ kind }).length;

test('a crash after the first committed batch leaves only the stage, and a resume finishes from the frozen snapshot', async () => {
  const target = join(dir, 'crash');
  let batches = 0;
  await assert.rejects(exitBundle(store, target, asAdmin({ afterBatch: () => { if (++batches === 1) throw new Error('crash'); } })), /crash/);
  assert.equal(existsSync(target), false);
  assert.equal(existsSync(`${target}.partial`), true);
  assert.equal(existsSync(`${target}.lock`), false);
  assert.equal(statSync(`${target}.partial`).mode & 0o777, 0o700);
  // A record created after the snapshot does not appear in the resumed copy.
  const sql = (store as unknown as { sql: DatabaseSync }).sql;
  sql.prepare("INSERT INTO Customers (Name) VALUES ('Added after the crash')").run();
  try {
    const report = await exitBundle(store, target, asAdmin());
    assert.equal(report.folder, target);
    assert.equal(report.tables, 1);
    assert.equal(report.rows, ROWS);
    assert.equal(report.containers, 2);
    assert.equal(existsSync(`${target}.partial`), false);

    const db = new DatabaseSync(join(target, 'data.sqlite'));
    try {
      assert.equal((db.prepare('SELECT count(*) AS n FROM Customers').get() as { n: number }).n, ROWS);
      assert.equal((db.prepare("SELECT count(*) AS n FROM Customers WHERE Name = 'Added after the crash'").get() as { n: number }).n, 0);
      assert.equal((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      const checks = readFileSync(join(target, 'checks.sql'), 'utf8');
      db.exec('SELECT 1'); // the file opens
      for (const statement of checks.split(';').map((s) => s.trim()).filter((s) => /^SELECT/.test(s))) {
        for (const row of db.prepare(statement).all() as Record<string, unknown>[]) if ('missing' in row) assert.equal(row.missing, 0, statement);
      }
      assert.deepEqual(db.prepare('SELECT id, path, size FROM _exit_containers ORDER BY id').all().map((r) => ({ ...r })), [
        { id: inside, path: `containers/${inside}-photo_one.png`, size: 15 },
        { id: outside, path: `containers/${outside}-scan.pdf`, size: outsideBytes.length },
      ]);
    } finally {
      db.close();
    }
    // schema.sql loads into an empty database.
    const empty = new DatabaseSync(':memory:');
    empty.exec(readFileSync(join(target, 'schema.sql'), 'utf8'));
    assert.ok(empty.prepare("SELECT name FROM sqlite_master WHERE name = 'Customers'").get());
    empty.close();
    // Container bytes equal the source bytes, inside and outside the file.
    assert.equal(readFileSync(join(target, 'containers', `${inside}-photo_one.png`), 'utf8'), 'inside the file');
    assert.deepEqual(readFileSync(join(target, 'containers', `${outside}-scan.pdf`)), outsideBytes);
    // CSV: header, quoting, an empty cell for NULL.
    const csv = readFileSync(join(target, 'csv', '001-Customers.csv'), 'utf8').split('\r\n');
    assert.equal(csv[0], '_fm_record_id,Name,Credit,Photo,Scan,Number');
    assert.equal(csv.slice(1, 3).join('\r\n'), `1,"Ann, ""the first""\nline two",1.5,,,5\r\n2,Customer 2,3,${inside},,10`);
    assert.equal(csv.length, ROWS + 2);
    // Globals and serials.
    assert.deepEqual(JSON.parse(readFileSync(join(target, 'globals.json'), 'utf8')), { Customers: { Motto: 'hello' } });
    assert.ok(JSON.parse(readFileSync(join(target, 'serials.json'), 'utf8')).Customers.Number);
    // Manifest hashes equal the real hashes; nothing transient is left; modes are private.
    const manifest = JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8')) as { format: number; files: Record<string, string>; tables: Record<string, number> };
    assert.equal(manifest.format, 1);
    assert.equal(manifest.tables.Customers, ROWS);
    for (const [rel, hash] of Object.entries(manifest.files)) assert.equal(sha(join(target, rel)), hash, rel);
    const all = files(target);
    assert.deepEqual(all.filter((f) => /pending|\.source|stage\.json|\.work/.test(f)), []);
    assert.deepEqual(all.filter((f) => f !== 'manifest.json' && !(f in manifest.files)), []);
    for (const f of all) assert.equal(statSync(join(target, f)).mode & 0o077, 0, f);
    // No secrets in the design or the schema.
    const design = all.filter((f) => f.startsWith('design/')).map((f) => readFileSync(join(target, f), 'utf8')).join('\n');
    assert.match(design, /Admin/);
    assert.ok(!design.includes(PASSWORD));
    assert.ok(!readFileSync(join(target, 'schema.json'), 'utf8').includes('passwordVerifier'));
    assert.match(readFileSync(join(target, 'NOTES.txt'), 'utf8'), /PLAINTEXT/);
  } finally {
    sql.prepare("DELETE FROM Customers WHERE Name = 'Added after the crash'").run();
  }
});

test('a copy stopped between deleting the snapshot and the last rename publishes after the hashes check out; a tampered file is refused', async () => {
  const first = join(dir, 'whole');
  await exitBundle(store, first, asAdmin());
  const before = readFileSync(join(first, 'manifest.json'), 'utf8');
  renameSync(first, `${first}.partial`);
  await exitBundle(store, first, asAdmin());
  assert.equal(readFileSync(join(first, 'manifest.json'), 'utf8'), before);
  assert.equal(existsSync(`${first}.partial`), false);

  renameSync(first, `${first}.partial`);
  writeFileSync(join(`${first}.partial`, 'globals.json'), '{"tampered":true}\n');
  await assert.rejects(exitBundle(store, first, asAdmin()), (e: ExitBundleError) => e.status === 409 && /does not match its manifest/.test(e.message));
  assert.equal(existsSync(first), false);
});

test('an existing target is refused with 409, a table named _exit_containers is refused, and a second run for the same folder is refused while one runs', async () => {
  await assert.rejects(exitBundle(store, join(dir, 'missing-parent', 'copy'), asAdmin()), (e: ExitBundleError) => e.status === 400 && /does not exist/.test(e.message));
  const target = join(dir, 'exists');
  mkdirSync(target);
  await assert.rejects(exitBundle(store, target, asAdmin()), (e: ExitBundleError) => e.status === 409 && /already exists/.test(e.message));

  const busy = join(dir, 'busy');
  // The first request holds the folder while its rows are copied; a second one arriving then is told so.
  let second: Promise<unknown> | undefined;
  await exitBundle(store, busy, asAdmin({ afterBatch: () => { second ??= exitBundle(store, busy, asAdmin()); second.catch(() => {}); } }));
  await assert.rejects(second!, (e: ExitBundleError) => e.status === 409 && /already running/.test(e.message));

  store.applyDesign([{ op: 'createTable', name: '_exit_containers', fields: [{ name: 'A', type: 'text' }] }]);
  try {
    await assert.rejects(exitBundle(store, join(dir, 'clash'), asAdmin()), (e: ExitBundleError) => e.status === 400);
  } finally {
    store.applyDesign([{ op: 'deleteTable', table: '_exit_containers' }]);
  }
});

test('a stage whose snapshot does not match its record refuses to resume', async () => {
  const target = join(dir, 'mismatch');
  let batches = 0;
  await assert.rejects(exitBundle(store, target, asAdmin({ afterBatch: () => { if (++batches === 1) throw new Error('crash'); } })), /crash/);
  writeFileSync(join(`${target}.partial`, '.source.openhbam.sqlite'), 'not the snapshot');
  await assert.rejects(exitBundle(store, target, asAdmin()), (e: ExitBundleError) => e.status === 409 && /not the one that was recorded/.test(e.message));
  assert.equal(existsSync(target), false);
});

test('a container file that is missing outside the database stops the copy with a message that says which', async () => {
  const sql = (store as unknown as { sql: DatabaseSync }).sql;
  const filenameDirectory = 'private-filename-directory-358';
  sql.prepare('UPDATE _fm_containers SET filename = ? WHERE id = ?').run(`${filenameDirectory}/scan.pdf`, outside);
  rmSync(join(dir, 'RC_Data_FMS', 'Shop', externalDirectory, 'scan.pdf'));
  try {
    await assert.rejects(exitBundle(store, join(dir, 'gone'), asAdmin()), (e: ExitBundleError) => e.status === 409 && e.message.includes(`container ${outside}`) && e.message.includes('scan.pdf') && /missing/.test(e.message) && /put the file back where the solution keeps it and run again/.test(e.message) && !e.message.includes(externalDirectory) && !e.message.includes(filenameDirectory) && !e.message.includes(dir));
    assert.equal(existsSync(join(dir, 'gone')), false);
  } finally {
    sql.prepare('UPDATE _fm_containers SET filename = ? WHERE id = ?').run('scan.pdf', outside);
    writeFileSync(join(dir, 'RC_Data_FMS', 'Shop', externalDirectory, 'scan.pdf'), outsideBytes);
    rmSync(`${join(dir, 'gone')}.partial`, { recursive: true, force: true });
  }
});

test('a changed external container reports its file name without exposing the storage directory', async () => {
  const path = join(dir, 'RC_Data_FMS', 'Shop', externalDirectory, 'scan.pdf');
  writeFileSync(path, Buffer.from('changed size'));
  try {
    await assert.rejects(exitBundle(store, join(dir, 'changed-external'), asAdmin()), (e: ExitBundleError) => e.status === 409 && e.message.includes(`container ${outside}`) && e.message.includes('scan.pdf') && /not the size/.test(e.message) && !e.message.includes(externalDirectory) && !e.message.includes(dir));
  } finally {
    writeFileSync(path, outsideBytes);
    rmSync(`${join(dir, 'changed-external')}.partial`, { recursive: true, force: true });
  }
});

test('account password hashes and second-factor secrets are absent from every finished bundle file', async () => {
  const enrollment = store.enrollTotp('Admin');
  assert.equal(store.confirmTotp('Admin', totpCode(enrollment.secret)), true);
  const sql = (store as unknown as { sql: DatabaseSync }).sql;
  const hash = (sql.prepare('SELECT password_hash FROM _fm_accounts WHERE name = ?').get('Admin') as { password_hash: string }).password_hash;
  const secrets = [hash, enrollment.secret];
  const target = join(dir, 'no-account-secrets');
  try {
    await exitBundle(store, target, asAdmin());
    for (const rel of files(target)) {
      const path = join(target, rel);
      const contents = rel.endsWith('.sqlite') ? (() => {
        const db = new DatabaseSync(path);
        try {
          return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[])
            .map(({ name }) => JSON.stringify(db.prepare(`SELECT * FROM "${name.replace(/"/g, '""')}"`).all())).join('\n');
        } finally { db.close(); }
      })() : readFileSync(path, 'utf8');
      for (const secret of secrets) assert.equal(contents.includes(secret), false, rel);
    }
  } finally {
    store.disableTotp('Admin');
  }
});

test('hostile container filenames remain inside the bundle containers folder', async () => {
  const sql = (store as unknown as { sql: DatabaseSync }).sql;
  const target = join(dir, 'safe-container-names');
  const names = ['../../x', '..\\..\\x', '/absolute/x', `name${String.fromCharCode(0)}nul`, 'folder/..'];
  const ids = names.map((filename) => store.addContainer({ filename, mime: 'text/plain', data: Buffer.from('safe bytes') }));
  const insert = sql.prepare('INSERT INTO Customers (Name, Photo) VALUES (?, ?)');
  try {
    for (const id of ids) insert.run('filename check', id);
    await exitBundle(store, target, asAdmin());
    const containerRoot = resolve(target, 'containers');
    const written = files(target).filter((rel) => rel.startsWith('containers/'));
    for (const id of ids) assert.ok(written.some((rel) => rel.startsWith(`containers/${id}-`)), String(id));
    for (const rel of files(target)) {
      const path = resolve(target, rel);
      assert.equal(isAbsolute(rel), false, rel);
      assert.ok(path.startsWith(`${resolve(target)}${sep}`), rel);
      if (rel.startsWith('containers/')) assert.ok(path.startsWith(`${containerRoot}${sep}`), rel);
    }
  } finally {
    sql.prepare("DELETE FROM Customers WHERE Name = 'filename check'").run();
  }
});

test('a stale process lock is replaced and a live process lock refuses the same folder', async () => {
  const target = join(dir, 'stale-lock');
  const lock = `${target}.lock`;
  const old = JSON.stringify({ pid: process.pid, startedAt: Date.now() - 7 * 60 * 60 * 1000 });
  writeFileSync(lock, old, { mode: 0o600 });
  let observed = false;
  await exitBundle(store, target, asAdmin({ afterBatch: () => {
    const held = JSON.parse(readFileSync(lock, 'utf8')) as { pid: number; startedAt: number };
    assert.equal(held.pid, process.pid);
    assert.ok(held.startedAt > Date.now() - 60_000);
    observed = true;
  } }));
  assert.equal(observed, true);
  assert.equal(existsSync(lock), false);

  const busy = join(dir, 'live-process-lock');
  const busyLock = `${busy}.lock`;
  writeFileSync(busyLock, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { mode: 0o600 });
  try {
    await assert.rejects(exitBundle(store, busy, asAdmin()), (e: ExitBundleError) => e.status === 409 && e.message === 'an export to that folder is already running');
    await assert.rejects(discardExitBundle(store, busy, asAdmin()), (e: ExitBundleError) => e.status === 409 && /running; wait/.test(e.message));
    assert.equal(existsSync(busy), false);
  } finally { rmSync(busyLock); }

  const dead = join(dir, 'dead-process-lock');
  const deadLock = `${dead}.lock`;
  writeFileSync(deadLock, JSON.stringify({ pid: 99_999_999, startedAt: Date.now() }), { mode: 0o600 });
  await exitBundle(store, dead, asAdmin());
  assert.equal(existsSync(deadLock), false);
});

test('discard removes the stage, audits it, and refuses a missing stage, a symlink and a stage another user owns', async () => {
  const target = join(dir, 'discard');
  await assert.rejects(discardExitBundle(store, target, asAdmin()), (e: ExitBundleError) => e.status === 404);
  let batches = 0;
  await assert.rejects(exitBundle(store, target, asAdmin({ afterBatch: () => { if (++batches === 1) throw new Error('crash'); } })), /crash/);
  const before = events('data-exported');
  await discardExitBundle(store, target, asAdmin());
  assert.equal(existsSync(`${target}.partial`), false);
  assert.equal(events('data-exported'), before + 1);
  assert.ok(store.securityEvents({ kind: 'data-exported' }).some((e) => /discarded/.test(e.description)));

  const real = join(dir, 'real-folder');
  mkdirSync(real, { mode: 0o700 });
  symlinkSync(real, `${target}.partial`);
  await assert.rejects(discardExitBundle(store, target, asAdmin()), (e: ExitBundleError) => e.status === 409);
  await assert.rejects(exitBundle(store, target, asAdmin()), (e: ExitBundleError) => e.status === 409);
  assert.equal(existsSync(real), true);
  rmSync(`${target}.partial`);

  mkdirSync(`${target}.partial`, { mode: 0o700 });
  chmodSync(`${target}.partial`, 0o755);
  await assert.rejects(discardExitBundle(store, target, asAdmin()), (e: ExitBundleError) => e.status === 409 && /other users/.test(e.message));
  chmodSync(`${target}.partial`, 0o700);
  let chowned = true;
  try { chownSync(`${target}.partial`, 12345, 12345); } catch { chowned = false; }
  if (chowned) await assert.rejects(discardExitBundle(store, target, asAdmin()), (e: ExitBundleError) => e.status === 409 && /another user/.test(e.message));
  if (chowned) chownSync(`${target}.partial`, process.getuid!(), process.getgid!());
  rmSync(`${target}.partial`, { recursive: true, force: true });
});

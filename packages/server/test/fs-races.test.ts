import '../../store/test/support/stub-path.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { withFilesystemHook } from '../../store/src/fs-boundary.ts';
import { createStore, Store } from '../../store/src/index.ts';
import { ContainerFiles } from '../src/containers.ts';
import { ContainerUploads } from '../src/container-uploads.ts';
import { Uploads } from '../src/uploads.ts';
import { Host } from '../src/host.ts';
import { backupFolder } from '../src/backup.ts';
import { backupExternal } from '../src/backup-external.ts';
import { commitRestore } from '../src/restore-files.ts';
import { encryptFile, encryptFileSync, decryptFile } from '../src/encrypt.ts';
import { ServerLogs } from '../src/server-logs.ts';
import { placeServiceFile } from '../../cli/src/service.ts';
import { installPackage, packPlugin } from '../../plugins/src/package.ts';
import { readPlugin } from '../../plugins/src/sandboxed.ts';
import { procDiskBytes } from '../src/stats-log.ts';

function setup(t: import('node:test').TestContext) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tabularius-fs-integration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const outside = join(dir, 'outside'); fs.mkdirSync(outside);
  const secret = join(outside, 'secret'); fs.writeFileSync(secret, 'unchanged');
  return { dir, outside, secret };
}

test('invariant: process disk counters remain readable through a stable self directory alias', (t) => {
  const { dir } = setup(t), processDir = join(dir, '12345');
  fs.mkdirSync(processDir);
  fs.writeFileSync(join(processDir, 'io'), 'read_bytes: 42\nwrite_bytes: 17\n');
  fs.symlinkSync('12345', join(dir, 'self'));
  assert.deepEqual(procDiskBytes(join(dir, 'self', 'io')), { read: 42, write: 17 });
});

test('invariant: external-container creation retains 0666 permissions filtered by the process umask', (t) => {
  const { dir } = setup(t), db = join(dir, 'Synthetic.openhbam.sqlite');
  createStore(db); const store = new Store(db, 'Synthetic'); t.after(() => store.close());
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Doc', type: 'container' }] },
    { op: 'updateField', table: 'Items', field: 'Doc', options: { externalStorage: { path: '"Docs/"' } } },
  ] as never);
  const id = Number(store.create('Items', {}).recordId);
  for (const mask of [0o022, 0o027, 0o077]) {
    const previous = process.umask(mask);
    try {
      const filename = `mask-${mask}.txt`;
      store.setContainer('Items', id, 'Doc', 1, { filename, mime: 'text/plain', data: Buffer.from('contents') });
      const file = join(dir, 'RC_Data_FMS', 'Synthetic', 'Docs', filename);
      assert.equal(fs.statSync(file).mode & 0o777, 0o666 & ~mask);
      assert.equal(fs.readFileSync(file, 'utf8'), 'contents');
    } finally { process.umask(previous); }
  }
});

test('container upload spools are private and reject a link swapped before the next piece', (t) => {
  const { dir, secret } = setup(t), uploads = new ContainerUploads({ tmp: dir, idleMs: 0 });
  t.after(() => uploads.stop());
  const who = { db: 'Synthetic', account: 'Admin' };
  let path = '';
  const u = withFilesystemHook((e) => { if (e.phase === 'opened') path = e.path; }, () =>
    uploads.start(who, { layout: 'Items', recordId: 1, field: 'Doc', repetition: 1 }, { size: 4 }));
  assert.equal(fs.statSync(path).mode & 0o777, 0o600);
  assert.equal(fs.statSync(dirname(path)).mode & 0o777, 0o700);
  let hit = false;
  assert.throws(() => withFilesystemHook((e) => {
    if (e.phase !== 'checked') return;
    hit = true; fs.unlinkSync(path); fs.symlinkSync(secret, path);
  }, () => uploads.beginPiece(u.id, who, 'Items', 0, 4)));
  assert.ok(hit);
  assert.equal(uploads.get(u.id, who, 'Items').received, 0);
  assert.equal(fs.readFileSync(secret, 'utf8'), 'unchanged');
});

test('admin uploads reject a hard link before opening a piece without advancing received', async (t) => {
  const { dir, outside } = setup(t), uploads = new Uploads(new Host(dir), () => {}, { idleMs: 0 });
  const u = uploads.start({ name: 'Synthetic.fmp12', size: 4 });
  const path = join(dir, '.openhbam-uploads', u.id + '.part');
  assert.equal(fs.statSync(path).mode & 0o777, 0o600);
  const req = Object.assign(Readable.from([Buffer.from('data')]), { headers: { 'content-length': '4' } }) as unknown as IncomingMessage;
  let hit = false;
  await assert.rejects(withFilesystemHook((e) => {
    if (e.phase !== 'checked') return;
    hit = true; fs.linkSync(path, join(outside, 'alias'));
  }, () => uploads.write(u.id, 0, req)));
  assert.ok(hit);
  assert.equal(uploads.get(u.id).received, 0);
  assert.equal(fs.statSync(path).size, 0);
});

test('external containers reject parent replacement and leaf swaps without committing field changes', (t) => {
  // Retain the private-file assertion under an explicitly restrictive umask;
  // compatibility with other masks is independently covered above.
  const previous = process.umask(0o077);
  t.after(() => process.umask(previous));
  const { dir, outside, secret } = setup(t), db = join(dir, 'Synthetic.openhbam.sqlite');
  createStore(db); const store = new Store(db, 'Synthetic'); t.after(() => store.close());
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Doc', type: 'container' }] },
    { op: 'updateField', table: 'Items', field: 'Doc', options: { externalStorage: { path: '"Docs/"' } } },
  ] as never);
  const id = Number(store.create('Items', {}).recordId);
  let moved = '';
  assert.throws(() => withFilesystemHook((e) => {
    if (e.phase !== 'checked' || !e.path.endsWith('data.txt')) return;
    moved = dirname(e.path); fs.renameSync(moved, moved + '-old'); fs.symlinkSync(outside, moved);
  }, () => store.setContainer('Items', id, 'Doc', 1, { filename: 'data.txt', mime: 'text/plain', data: Buffer.from('private') })));
  assert.ok(moved);
  assert.equal(store.containerId('Items', id, 'Doc'), undefined);
  assert.equal(fs.existsSync(join(outside, 'data.txt')), false);
  fs.unlinkSync(moved); fs.renameSync(moved + '-old', moved);
  store.setContainer('Items', id, 'Doc', 1, { filename: 'data.txt', mime: 'text/plain', data: Buffer.from('private') });
  assert.equal(fs.statSync(join(moved, 'data.txt')).mode & 0o777, 0o600);
  const cid = store.containerId('Items', id, 'Doc')!;
  let hit = false;
  assert.throws(() => withFilesystemHook((e) => {
    if (e.phase !== 'checked' || !e.path.endsWith('data.txt')) return;
    hit = true; fs.unlinkSync(e.path); fs.symlinkSync(secret, e.path);
  }, () => store.container(cid)));
  assert.ok(hit);
});

test('backup external copy refuses a swapped destination parent', async (t) => {
  const { dir, outside } = setup(t), source = join(dir, 'RC_Data_FMS', 'Synthetic');
  fs.mkdirSync(source, { recursive: true }); fs.writeFileSync(join(source, 'data'), 'private');
  const backup = join(dir, 'backup'); fs.mkdirSync(backup);
  let hit = false;
  await assert.rejects(withFilesystemHook((e) => {
    if (hit || e.phase !== 'checked' || !e.path.startsWith(backup) || !e.path.endsWith('data')) return;
    hit = true; fs.renameSync(dirname(e.path), dirname(e.path) + '-old'); fs.symlinkSync(outside, dirname(e.path));
  }, () => backupExternal(dir, ['Synthetic'], backup)));
  assert.ok(hit);
  assert.equal(fs.existsSync(join(outside, 'data')), false);
});

test('restore keeps the old target when its staged file disappears before publication', (t) => {
  const { dir } = setup(t), staged = join(dir, 'staged'), target = join(dir, 'live');
  fs.writeFileSync(staged, 'new'); fs.writeFileSync(target, 'old');
  let hit = false;
  assert.throws(() => withFilesystemHook((e) => {
    if (e.operation !== 'rename' || e.path !== staged) return;
    hit = true; fs.unlinkSync(staged);
  }, () => commitRestore(dir, [{ staged, target }])));
  assert.ok(hit);
  assert.equal(fs.readFileSync(target, 'utf8'), 'old');
  assert.equal(fs.existsSync(join(dir, '.restore-journal.json')), false);
});

test('encrypted backup and restore use private files and reject swapped output links', async (t) => {
  const { dir, secret } = setup(t), plain = join(dir, 'plain'), encrypted = join(dir, 'encrypted'), restored = join(dir, 'restored');
  fs.writeFileSync(plain, 'private');
  await encryptFile(plain, encrypted, 'synthetic-passphrase');
  assert.equal(fs.statSync(encrypted).mode & 0o777, 0o600);
  let hit = false;
  await assert.rejects(withFilesystemHook((e) => {
    if (e.phase !== 'checked' || e.path !== restored) return;
    hit = true; fs.symlinkSync(secret, restored);
  }, () => decryptFile(encrypted, restored, 'synthetic-passphrase')));
  assert.ok(hit);
  assert.equal(fs.readFileSync(secret, 'utf8'), 'unchanged');
});

test('log rotation refuses a swapped source and does not append to its link target', async (t) => {
  const { dir, secret } = setup(t), logs = new ServerLogs(dir, { limit: 1 });
  logs.event('Information', 'first'); await logs.flush();
  assert.equal(fs.statSync(logs.file('Event')).mode & 0o777, 0o600);
  logs.event('Information', 'second');
  let hit = false;
  await withFilesystemHook((e) => {
    if (e.operation !== 'rename') return;
    hit = true; fs.unlinkSync(e.path); fs.symlinkSync(secret, e.path);
  }, () => logs.flush());
  assert.ok(hit);
  assert.equal(fs.readFileSync(secret, 'utf8'), 'unchanged');
  fs.unlinkSync(logs.file('Event'));
  await logs.flush(); logs.close();
  assert.match(fs.readFileSync(logs.file('Event'), 'utf8'), /second/);
});

test('service file placement refuses swapped links and restricts existing mode bits without running a service command', (t) => {
  const { dir, secret } = setup(t), path = join(dir, 'service-file');
  fs.writeFileSync(path, 'old', { mode: 0o644 });
  let hit = false;
  assert.throws(() => withFilesystemHook((e) => {
    if (e.phase !== 'checked') return;
    hit = true; fs.unlinkSync(path); fs.symlinkSync(secret, path);
  }, () => placeServiceFile(path, 'configuration', false)));
  assert.ok(hit);
  assert.equal(fs.readFileSync(secret, 'utf8'), 'unchanged');
  fs.unlinkSync(path); fs.writeFileSync(path, 'old', { mode: 0o644 });
  placeServiceFile(path, 'configuration', false);
  assert.equal(fs.statSync(path).mode & 0o777, 0o600);
});

function packageSource(dir: string) {
  const source = join(dir, 'source'); fs.mkdirSync(source);
  const code = 'const functions = { Test_Value: () => "original" };';
  fs.writeFileSync(join(source, 'plugin.json'), JSON.stringify({ id: 'org.example.races', name: 'Races', version: '1.0.0', api: '^1.0', publisher: 'Synthetic', main: 'main.js', functions: [{ name: 'Test_Value', min: 0, max: 0 }] }));
  fs.writeFileSync(join(source, 'main.js'), code);
  return { code, bytes: packPlugin(source).bytes };
}

test('plug-in staging is private and unique; a full disk leaves the installed version intact', (t) => {
  const { dir } = setup(t), { bytes } = packageSource(dir);
  installPackage(dir, bytes, { allowUnsigned: true });
  let hit = false;
  assert.throws(() => withFilesystemHook((e) => {
    if (hit || e.operation !== 'open' || e.phase !== 'checked' || !e.path.includes('.installing-')) return;
    hit = true;
    assert.equal(fs.statSync(dirname(e.path)).mode & 0o777, 0o700);
    throw Object.assign(new Error('injected full disk'), { code: 'ENOSPC' });
  }, () => installPackage(dir, bytes, { allowUnsigned: true })));
  assert.ok(hit);
  assert.equal(readPlugin(join(dir, 'plugins', 'org.example.races')).manifest.version, '1.0.0');
  assert.deepEqual(fs.readdirSync(join(dir, 'plugins')).filter((n) => n.startsWith('.')), []);
});

test('plug-in integrity applies to the exact buffers loaded, even if main changes during verification', (t) => {
  const { dir } = setup(t), { code, bytes } = packageSource(dir);
  installPackage(dir, bytes, { allowUnsigned: true });
  const plugin = join(dir, 'plugins', 'org.example.races');
  let hit = false;
  const loaded = withFilesystemHook((e) => {
    if (e.phase !== 'checked' || !e.path.endsWith('install.json')) return;
    hit = true; fs.writeFileSync(join(plugin, 'main.js'), 'const functions = { Test_Value: () => "changed" };');
  }, () => readPlugin(plugin));
  assert.ok(hit);
  assert.ok(loaded.calls.Test_Value.cacheKey?.endsWith(createHash('sha256').update(code).digest('hex').slice(0, 16)));
  assert.throws(() => readPlugin(plugin), /has changed since/);
});


test('backup reuse copies permissive old files into private files and never links symlink sources', async (t) => {
  const { dir, secret } = setup(t), source = join(dir, 'RC_Data_FMS', 'Synthetic');
  fs.mkdirSync(source, { recursive: true }); fs.writeFileSync(join(source, 'data'), 'private');
  const first = join(dir, 'first'), second = join(dir, 'second'), third = join(dir, 'third');
  for (const path of [first, second, third]) fs.mkdirSync(path);
  await backupExternal(dir, ['Synthetic'], first);
  const old = join(first, 'RC_Data_FMS', 'Synthetic', 'data');
  fs.chmodSync(old, 0o644);
  await backupExternal(dir, ['Synthetic'], second, first);
  const fresh = join(second, 'RC_Data_FMS', 'Synthetic', 'data');
  assert.equal(fs.statSync(fresh).mode & 0o777, 0o600);
  assert.notEqual(fs.statSync(fresh).ino, fs.statSync(old).ino);
  assert.equal(fs.statSync(old).mode & 0o777, 0o644);
  fs.unlinkSync(old); fs.symlinkSync(secret, old);
  await assert.rejects(backupExternal(dir, ['Synthetic'], third, first));
  assert.equal(fs.existsSync(join(third, 'RC_Data_FMS', 'Synthetic', 'data')), false);
});

test('native SQLite backups keep staging and published plaintext private', async (t) => {
  const { dir } = setup(t), db = join(dir, 'Synthetic.openhbam.sqlite');
  createStore(db); new Store(db, 'Synthetic').close();
  const dest = join(dir, 'Backups'); fs.mkdirSync(dest);
  let hit = false;
  const result = await withFilesystemHook((e) => {
    if (e.operation !== 'native' || !e.path.includes('.partial/')) return;
    hit = true;
    assert.equal(fs.statSync(e.path).mode & 0o777, 0o600);
    assert.equal(fs.statSync(dirname(e.path)).mode & 0o777, 0o700);
  }, () => backupFolder(dir, dest, 1));
  assert.ok(hit);
  assert.equal(fs.statSync(join(result.dir, 'Synthetic.openhbam.sqlite')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(result.dir).mode & 0o777, 0o700);
});


test('encrypted copy closes its input when opening the output is refused', async (t) => {
  const { dir } = setup(t), source = join(dir, 'source'); fs.writeFileSync(source, 'synthetic');
  for (const sync of [false, true]) {
    const target = join(dir, sync ? 'sync-output' : 'async-output');
    let input: number | undefined;
    const hook = (e: import('../../store/src/fs-boundary.ts').FilesystemBoundary) => {
      if (e.operation === 'open' && e.path === source && e.phase === 'opened') input = e.fd;
      if (e.operation === 'open' && e.path === target && e.phase === 'checked') throw Object.assign(new Error('injected full disk'), { code: 'ENOSPC' });
    };
    if (sync) assert.throws(() => withFilesystemHook(hook, () => encryptFileSync(source, target, 'synthetic')));
    else await assert.rejects(withFilesystemHook(hook, () => encryptFile(source, target, 'synthetic')));
    assert.notEqual(input, undefined);
    assert.throws(() => fs.fstatSync(input!), { code: 'EBADF' });
  }
});

test('thumbnail tool output rejects a swapped link and removes only its private scratch folder', async (t) => {
  const { dir, secret } = setup(t), executable = join(dir, 'synthetic-converter.mjs');
  fs.writeFileSync(executable, `#!${process.execPath}
import fs from 'node:fs';
fs.writeFileSync(process.argv.at(-1), 'synthetic image', {mode: 0o600});
`, { mode: 0o700 });
  const thumbnails = new ContainerFiles(); t.after(() => thumbnails.stop());
  const tool = thumbnails as unknown as {
    tools: { sips: string };
    withTool(data: Uint8Array, pdf: boolean, size: number): Promise<Uint8Array | undefined>;
  };
  tool.tools = { sips: executable };
  let path = '';
  const result = await withFilesystemHook((e) => {
    if (e.operation !== 'open' || e.phase !== 'checked' || !e.path.endsWith('/out.png')) return;
    path = e.path;
    assert.equal(fs.statSync(dirname(path)).mode & 0o777, 0o700);
    fs.unlinkSync(path); fs.symlinkSync(secret, path);
  }, () => tool.withTool(Buffer.from('synthetic'), false, 64));
  assert.ok(path);
  assert.equal(result, undefined);
  assert.equal(fs.existsSync(dirname(path)), false);
  assert.equal(fs.readFileSync(secret, 'utf8'), 'unchanged');
});

test('backup link race refusal is not retried as a fresh copy', async (t) => {
  const { dir, secret } = setup(t), source = join(dir, 'RC_Data_FMS', 'Synthetic');
  fs.mkdirSync(source, { recursive: true }); fs.writeFileSync(join(source, 'data'), 'private');
  const first = join(dir, 'first'), second = join(dir, 'second'); fs.mkdirSync(first); fs.mkdirSync(second);
  await backupExternal(dir, ['Synthetic'], first);
  let hit = false;
  await assert.rejects(withFilesystemHook((e) => {
    if (e.operation !== 'link') return;
    hit = true; fs.unlinkSync(e.path); fs.linkSync(secret, e.path);
  }, () => backupExternal(dir, ['Synthetic'], second, first)));
  assert.ok(hit);
  assert.equal(fs.existsSync(join(second, 'RC_Data_FMS', 'Synthetic', 'data')), false);
});

test('upload cleanup does not remove a file under a swapped spool parent', (t) => {
  const { dir, outside } = setup(t), uploads = new Uploads(new Host(dir), () => {}, { idleMs: 0 });
  const u = uploads.start({ name: 'Synthetic.fmp12', size: 4 });
  const spool = join(dir, '.openhbam-uploads'), sentinel = join(outside, u.id + '.part');
  fs.writeFileSync(sentinel, 'outside cleanup sentinel');
  fs.renameSync(spool, spool + '-old'); fs.symlinkSync(outside, spool);
  uploads.remove(u.id);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'outside cleanup sentinel');
});

test('a full disk during external container writing removes its private partial file', (t) => {
  const { dir } = setup(t), db = join(dir, 'Synthetic.openhbam.sqlite');
  createStore(db); const store = new Store(db, 'Synthetic'); t.after(() => store.close());
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Doc', type: 'container' }] },
    { op: 'updateField', table: 'Items', field: 'Doc', options: { externalStorage: { path: '"Docs/"' } } },
  ] as never);
  const id = Number(store.create('Items', {}).recordId); let hit = false;
  assert.throws(() => withFilesystemHook((e) => {
    if (e.operation !== 'write') return;
    hit = true; throw Object.assign(new Error('injected full disk'), { code: 'ENOSPC' });
  }, () => store.setContainer('Items', id, 'Doc', 1, { filename: 'data', mime: 'text/plain', data: Buffer.from('private') })));
  assert.ok(hit);
  assert.equal(store.containerId('Items', id, 'Doc'), undefined);
  assert.equal(fs.existsSync(join(dir, 'RC_Data_FMS', 'Synthetic', 'Docs', 'data')), false);
});

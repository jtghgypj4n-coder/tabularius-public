import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';
import { holdContainerBackup } from '../src/container-backup-lease.ts';
import { ContainerUploads, MAX_CONTAINER_FILE } from '../../server/src/container-uploads.ts';
import { runScript } from '../../scripts/src/index.ts';

const bytes = (text: string) => Buffer.from(text);
const file = (text: string, filename = 'same.bin') => ({ filename, mime: 'application/octet-stream', data: bytes(text) });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-container-chaos-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Media');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Pic', type: 'container' }] }] as never);
  return { dir, path, store, close: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function stubPath(dir: string) {
  const stub = join(dir, 'stub-path');
  const marker = join(dir, 'spawned-command');
  mkdirSync(stub);
  for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    const at = join(stub, name);
    writeFileSync(at, `#!/bin/sh\nprintf x >> '${marker}'\nexit 99\n`);
    chmodSync(at, 0o755);
  }
  return { stub, marker };
}

test('same hash shares bytes across records; replacement, duplicate and deletion keep live bytes after reopen and purge', () => {
  const f = fixture();
  try {
    const a = Number(f.store.create('Items', { Name: 'A' }).recordId);
    const b = Number(f.store.create('Items', { Name: 'B' }).recordId);
    const original = file('shared payload');
    f.store.setContainer('Items', a, 'Pic', 1, original);
    f.store.setContainer('Items', b, 'Pic', 1, original);
    const shared = f.store.containerId('Items', a, 'Pic')!;
    const oldVersion = f.store.containerInfo(shared)!.version;
    assert.equal(f.store.containerId('Items', b, 'Pic'), shared);
    assert.equal(f.store.containerIntegrityReport().shared, 1);
    // Repeated uploads of the same content do not grow the container table.
    for (let i = 0; i < 16; i++) f.store.setContainer('Items', a, 'Pic', 1, original);
    assert.equal(Number((f.store.sql.prepare('SELECT count(*) AS n FROM _fm_containers').get() as { n: number }).n), 1);
    f.store.setContainer('Items', a, 'Pic', 1, file('replacement'));
    assert.notEqual(f.store.containerInfo(f.store.containerId('Items', a, 'Pic')!)!.version, oldVersion, 'replacement invalidates cached previews');
    assert.equal(Buffer.from(f.store.container(shared)!.data).toString(), 'shared payload');
    assert.equal(Buffer.from(f.store.container(f.store.containerId('Items', a, 'Pic')!)!.data).toString(), 'replacement');
    f.store.delete('Items', b);
    assert.equal(f.store.purgeOrphanContainers().removed, 0, 'undo history still owns the deleted record');
    const before = f.store.containerIntegrityReport();
    f.store.close();
    const reopened = new Store(f.path, 'Media');
    try {
      assert.deepEqual(reopened.containerIntegrityReport(), before, 'references are rebuilt from durable records and history');
      assert.equal(Buffer.from(reopened.container(reopened.containerId('Items', a, 'Pic')!)!.data).toString(), 'replacement');
      assert.equal(Buffer.from(reopened.container(shared)!.data).toString(), 'shared payload');
      reopened.sql.prepare("DELETE FROM _fm_audit WHERE tbl = 'Items'").run();
      assert.equal(reopened.purgeOrphanContainers().removed, 1);
      assert.equal(Buffer.from(reopened.container(reopened.containerId('Items', a, 'Pic')!)!.data).toString(), 'replacement');
    } finally { reopened.close(); }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('two store connections writing the same hash resolve to one embedded payload', async () => {
  const f = fixture();
  try {
    const a = Number(f.store.create('Items', { Name: 'A' }).recordId);
    const b = Number(f.store.create('Items', { Name: 'B' }).recordId);
    const other = new Store(f.path, 'Media');
    try {
      await Promise.all([
        new Promise<void>((resolve, reject) => setImmediate(() => { try { f.store.setContainer('Items', a, 'Pic', 1, file('same from both')); resolve(); } catch (e) { reject(e); } })),
        new Promise<void>((resolve, reject) => setImmediate(() => { try { other.setContainer('Items', b, 'Pic', 1, file('same from both')); resolve(); } catch (e) { reject(e); } })),
      ]);
      assert.equal(f.store.containerId('Items', a, 'Pic'), other.containerId('Items', b, 'Pic'));
      assert.equal(Number((f.store.sql.prepare('SELECT count(*) AS n FROM _fm_containers').get() as { n: number }).n), 1);
    } finally { other.close(); }
  } finally { f.close(); }
});

test('concurrent processes writing the same hash keep one payload and both records', async () => {
  const f = fixture();
  try {
    const a = Number(f.store.create('Items', { Name: 'A' }).recordId);
    const b = Number(f.store.create('Items', { Name: 'B' }).recordId);
    f.store.close();
    const { stub, marker } = stubPath(f.dir);
    const storeUrl = new URL('../src/index.ts', import.meta.url).href;
    const script = `import { Store } from ${JSON.stringify(storeUrl)}; const s = new Store(process.argv[1], 'Media'); s.setContainer('Items', Number(process.argv[2]), 'Pic', 1, { filename: 'same.bin', mime: 'application/octet-stream', data: Buffer.from('parallel payload') }); s.close();`;
    const write = (id: number) => new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script, f.path, String(id)], { env: { ...process.env, PATH: stub }, stdio: 'ignore' });
      child.once('error', reject);
      child.once('close', (code) => resolve(code ?? -1));
    });
    assert.deepEqual(await Promise.all([write(a), write(b)]), [0, 0]);
    assert.equal(existsSync(marker), false);
    const reopened = new Store(f.path, 'Media');
    try {
      assert.equal(reopened.containerId('Items', a, 'Pic'), reopened.containerId('Items', b, 'Pic'));
      assert.equal(Number((reopened.sql.prepare('SELECT count(*) AS n FROM _fm_containers').get() as { n: number }).n), 1);
    } finally { reopened.close(); }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('dedupe verifies stored bytes before reusing a hash-labelled row', () => {
  const f = fixture();
  try {
    const a = Number(f.store.create('Items', { Name: 'A' }).recordId);
    const b = Number(f.store.create('Items', { Name: 'B' }).recordId);
    f.store.setContainer('Items', a, 'Pic', 1, file('safe'));
    const first = f.store.containerId('Items', a, 'Pic')!;
    f.store.sql.prepare('UPDATE _fm_containers SET data = ? WHERE id = ?').run(bytes('evil'), first);
    f.store.setContainer('Items', b, 'Pic', 1, file('safe'));
    const second = f.store.containerId('Items', b, 'Pic')!;
    assert.notEqual(second, first);
    assert.equal(Buffer.from(f.store.container(second)!.data).toString(), 'safe');
  } finally { f.close(); }
});

test('orphan size and purge byte count include all chunks', () => {
  const f = fixture();
  try {
    const data = Buffer.alloc(2 * 1024 * 1024 + 19, 7);
    const id = f.store.addContainer({ filename: 'large.bin', mime: 'application/octet-stream', data });
    assert.equal(f.store.orphanContainerReport().containers.find((c) => c.id === id)?.size, data.length);
    assert.deepEqual(f.store.purgeOrphanContainers(), { removed: 1, bytes: data.length, externalFiles: 0 });
  } finally { f.close(); }
});

test('GC defers while a backup holds the hosted folder', () => {
  const f = fixture();
  try {
    f.store.addContainer(file('unreferenced'));
    const release = holdContainerBackup(f.dir);
    try {
      assert.throws(() => f.store.purgeOrphanContainers(), /backup is in progress/);
      assert.equal(f.store.orphanContainerReport().count, 1);
    } finally { release(); }
    assert.equal(f.store.purgeOrphanContainers().removed, 1);
  } finally { f.close(); }
});

test('GC leaves an open resumable upload alone; size cap and resumed bytes are preserved', () => {
  const f = fixture();
  const uploads = new ContainerUploads({ tmp: f.dir, idleMs: 0 });
  try {
    const id = Number(f.store.create('Items', { Name: 'A' }).recordId);
    const who = { db: 'Media', account: 'Admin' };
    const target = { layout: 'Items', recordId: id, field: 'Pic', repetition: 1 };
    assert.throws(() => uploads.start(who, target, { filename: 'large.bin', size: MAX_CONTAINER_FILE + 1 }), /at most/);
    const started = uploads.start(who, target, { filename: 'resumed.bin', size: 6 });
    const first = uploads.beginPiece(started.id, who, 'Items', 0, 3);
    first.append(bytes('abc')); first.end();
    assert.equal(uploads.get(started.id, who, 'Items').received, 3);
    f.store.purgeOrphanContainers();
    assert.equal(uploads.get(started.id, who, 'Items').received, 3);
    const second = uploads.beginPiece(started.id, who, 'Items', 3, 3);
    second.append(bytes('def')); second.end();
    const completed = uploads.complete(started.id, who, 'Items');
    f.store.setContainer('Items', id, 'Pic', 1, completed.file);
    uploads.done(started.id);
    assert.equal(Buffer.from(f.store.container(f.store.containerId('Items', id, 'Pic')!)!.data).toString(), 'abcdef');
  } finally { uploads.stop(); f.close(); }
});

test('Save a Copy embeds external containers and refuses a missing source without leaving a copy', async () => {
  const f = fixture();
  try {
    f.store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Pic', options: { externalStorage: { path: '"Items/Pic/"' } } }] as never);
    const id = Number(f.store.create('Items', { Name: 'A' }).recordId);
    const payload = Buffer.alloc(2 * 1024 * 1024 + 13, 9);
    f.store.setContainer('Items', id, 'Pic', 1, { filename: 'large.bin', mime: 'application/octet-stream', data: payload });
    const script = (name: string, copyKind: string) => ({ id: 9001, name: 'copy', steps: [{ stepId: 37, name: 'Save a Copy as', enabled: true, params: { filePaths: [name], copyKind } }] });
    const result = await runScript(f.store, script('copy.fmp12', 'self-contained') as never, { layout: 'Items', foundSet: [id], documents: f.dir });
    assert.equal(result.error, 0);
    const at = join(f.dir, 'copy.openhbam.sqlite');
    const copy = new Store(at, 'copy');
    try {
      const cid = copy.containerId('Items', id, 'Pic')!;
      assert.equal(copy.containerInfo(cid)?.external, undefined);
      assert.deepEqual(Buffer.from(copy.container(cid)!.data), payload);
      assert.ok(copy.schema.tables[0].fields.find((x) => x.name === 'Pic')?.options?.externalStorage, 'the design setting is retained');
    } finally { copy.close(); }
    assert.equal((await runScript(f.store, script('clone.fmp12', 'clone') as never, { layout: 'Items', foundSet: [id], documents: f.dir })).error, 0);
    const clone = new Store(join(f.dir, 'clone.openhbam.sqlite'), 'clone');
    try {
      assert.equal(clone.findIds('Items').length, 0);
      assert.equal(Number((clone.sql.prepare('SELECT count(*) AS n FROM _fm_containers').get() as { n: number }).n), 0);
    } finally { clone.close(); }
    rmSync(f.store.externalFile('Items/Pic/large.bin')!);
    await assert.rejects(f.store.selfContainedCopy(join(f.dir, 'missing.openhbam.sqlite')), /missing/);
    assert.equal(existsSync(join(f.dir, 'missing.openhbam.sqlite')), false);
  } finally { f.close(); }
});

test('Export Field Contents and Insert File round-trip generated container bytes', async () => {
  const f = fixture();
  try {
    const a = Number(f.store.create('Items', { Name: 'A' }).recordId);
    const b = Number(f.store.create('Items', { Name: 'B' }).recordId);
    const payload = Buffer.from('synthetic export import payload');
    f.store.setContainer('Items', a, 'Pic', 1, { filename: 'payload.bin', mime: 'application/octet-stream', data: payload });
    const field = { tableOccurrence: { id: 0, name: 'Items' }, field: { id: 0, name: 'Pic' } };
    const run = (stepId: number, name: string, params: object, id: number) => runScript(f.store,
      { id: 9002, name: 'roundtrip', steps: [{ stepId, name, enabled: true, params }] } as never,
      { layout: 'Items', foundSet: [id], documents: f.dir });
    assert.equal((await run(132, 'Export Field Contents', { field, filePaths: ['file:roundtrip.bin'] }, a)).error, 0);
    assert.deepEqual(readFileSync(join(f.dir, 'roundtrip.bin')), payload);
    assert.equal((await run(131, 'Insert File', { field, filePaths: ['file:roundtrip.bin'] }, b)).error, 0);
    assert.deepEqual(Buffer.from(f.store.container(f.store.containerId('Items', b, 'Pic')!)!.data), payload);
  } finally { f.close(); }
});

test('a short spooled external write fails atomically and removes the partial file', () => {
  const f = fixture();
  try {
    f.store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Pic', options: { externalStorage: { path: '"Items/Pic/"' } } }] as never);
    const id = Number(f.store.create('Items', { Name: 'A' }).recordId);
    f.store.setContainer('Items', id, 'Pic', 1, file('good', 'good.bin'));
    const original = f.store.containerId('Items', id, 'Pic')!;
    const spool = join(f.dir, 'upload.part');
    writeFileSync(spool, 'short');
    assert.throws(() => f.store.setContainer('Items', id, 'Pic', 1, { filename: 'broken.bin', mime: 'application/octet-stream', path: spool, size: 20 }), /ended early/);
    assert.equal(f.store.containerId('Items', id, 'Pic'), original);
    assert.equal(Buffer.from(f.store.container(original)!.data).toString(), 'good');
    assert.deepEqual(readdirSync(join(f.dir, 'RC_Data_FMS', 'Media', 'Items', 'Pic')), ['good.bin']);
    assert.equal(f.store.containerIntegrityReport().orphans, 0);
  } finally { f.close(); }
});

test('SQLite full during replacement preserves the previous container and record pointer', () => {
  const f = fixture();
  try {
    const id = Number(f.store.create('Items', { Name: 'A' }).recordId);
    f.store.setContainer('Items', id, 'Pic', 1, file('original'));
    const original = f.store.containerId('Items', id, 'Pic')!;
    const pages = Number((f.store.sql.prepare('PRAGMA page_count').get() as { page_count: number }).page_count);
    f.store.sql.exec(`PRAGMA max_page_count = ${pages + 1}`);
    assert.throws(() => f.store.setContainer('Items', id, 'Pic', 1, { filename: 'big.bin', mime: 'application/octet-stream', data: Buffer.alloc(2 * 1024 * 1024, 7) }), /full|SQLITE_FULL/i);
    assert.equal(f.store.containerId('Items', id, 'Pic'), original);
    assert.equal(Buffer.from(f.store.container(original)!.data).toString(), 'original');
    assert.equal(f.store.containerIntegrityReport().orphans, 0);
  } finally { f.close(); }
});

test('integrity counts missing referenced rows, changed external bytes, dangling chunks and safe orphans', () => {
  const f = fixture();
  try {
    f.store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Pic', options: { externalStorage: { path: '"Items/Pic/"' } } }] as never);
    const a = Number(f.store.create('Items', { Name: 'A' }).recordId);
    const b = Number(f.store.create('Items', { Name: 'B' }).recordId);
    f.store.setContainer('Items', a, 'Pic', 1, file('good', 'good.bin'));
    f.store.setContainer('Items', b, 'Pic', 1, file('lost', 'lost.bin'));
    const aId = f.store.containerId('Items', a, 'Pic')!;
    const bId = f.store.containerId('Items', b, 'Pic')!;
    writeFileSync(f.store.externalFile('Items/Pic/good.bin')!, 'wrong length');
    rmSync(f.store.externalFile('Items/Pic/lost.bin')!);
    assert.deepEqual({ changed: f.store.containerIntegrityReport().changedExternal, missing: f.store.containerIntegrityReport().missingExternal }, { changed: 1, missing: 1 });
    f.store.sql.prepare('DELETE FROM _fm_containers WHERE id = ?').run(bId);
    f.store.sql.prepare('INSERT INTO _fm_container_chunks (id, n, data) VALUES (?, 0, ?)').run(bId, bytes('dangling'));
    f.store.sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data) VALUES (9999, 'orphan', 'text/plain', 'file', x'01')").run();
    const report = f.store.containerIntegrityReport();
    assert.equal(report.missingRows, 1);
    assert.equal(report.changedExternal, 1);
    assert.equal(report.danglingChunks, 1);
    assert.equal(report.orphans, 1);
    assert.equal(f.store.purgeOrphanContainers().removed, 1);
    assert.ok(f.store.containerInfo(aId), 'a referenced row survives GC even when its external file changed');
  } finally { f.close(); }
});

test('a killed move recovers its staged file while retaining the embedded original', () => {
  const f = fixture();
  try {
    const id = Number(f.store.create('Items', { Name: 'A' }).recordId);
    const data = file('survives crash', 'crash.bin');
    f.store.setContainer('Items', id, 'Pic', 1, data);
    const cid = f.store.containerId('Items', id, 'Pic')!;
    f.store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Pic', options: { externalStorage: { path: '"Items/Pic/"' } } }] as never);
    f.store.close();
    const { stub, marker } = stubPath(f.dir);
    const storeUrl = new URL('../src/index.ts', import.meta.url).href;
    const crashUrl = new URL('../src/crash-point.ts', import.meta.url).href;
    const script = `import { Store } from ${JSON.stringify(storeUrl)}; import { armCrashPointForTest } from ${JSON.stringify(crashUrl)}; const s = new Store(process.argv[1], 'Media'); armCrashPointForTest('containers-out:after-write'); s.moveContainersOut('Items', 'Pic');`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, f.path], { env: { ...process.env, PATH: stub }, encoding: 'utf8' });
    assert.equal(result.status, 73, result.stderr);
    assert.equal(existsSync(marker), false, 'no service, install, network, git or package command was run');
    const reopened = new Store(f.path, 'Media');
    try {
      assert.equal(Buffer.from(reopened.container(cid)!.data).toString(), 'survives crash');
      assert.equal(reopened.containerInfo(cid)?.external, undefined);
      assert.equal(reopened.containerIntegrityReport().missingExternal, 0);
      assert.equal(readdirSync(join(f.dir, 'RC_Data_FMS', 'Media', 'Items', 'Pic')).length, 0);
    } finally { reopened.close(); }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('identical bytes are never shared between fields, so moving one field out leaves the other in the database', () => {
  const f = fixture();
  try {
    f.store.applyDesign([{ op: 'createField', table: 'Items', name: 'Secret', type: 'container' }] as never);
    f.store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Pic', options: { externalStorage: { path: '"Items/Pic/"' } } }] as never);
    // Upload before the setting is applied to Secret: both embedded, same bytes, name and MIME.
    f.store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Pic', options: { externalStorage: null } }] as never);
    const a = Number(f.store.create('Items', { Name: 'A' }).recordId);
    const b = Number(f.store.create('Items', { Name: 'B' }).recordId);
    f.store.setContainer('Items', a, 'Secret', 1, file('same bytes'));
    f.store.setContainer('Items', b, 'Pic', 1, file('same bytes'));
    const secret = f.store.containerId('Items', a, 'Secret')!;
    const pic = f.store.containerId('Items', b, 'Pic')!;
    assert.notEqual(secret, pic);
    f.store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Pic', options: { externalStorage: { path: '"Items/Pic/"' } } }] as never);
    assert.equal(f.store.moveContainersOut('Items', 'Pic').moved, 1);
    assert.ok(!f.store.containerInfo(secret)!.external, 'the other field keeps its file in the database');
    assert.ok(f.store.containerInfo(pic)!.external);
  } finally { f.close(); }
});

test('purge keeps undo references that name a table or field now in design trash', () => {
  for (const trash of ['field', 'table'] as const) {
    const f = fixture();
    try {
      const a = Number(f.store.create('Items', { Name: 'A' }).recordId);
      f.store.setContainer('Items', a, 'Pic', 1, file('first'));
      const first = f.store.containerId('Items', a, 'Pic')!;
      const seq = Number((f.store.sql.prepare('SELECT max(seq) AS n FROM _fm_audit').get() as { n: number }).n);
      if (trash === 'field') f.store.setContainer('Items', a, 'Pic', 1, file('second'));
      else f.store.delete('Items', a);
      f.store.applyDesign([trash === 'field' ? { op: 'deleteField', table: 'Items', field: 'Pic' } : { op: 'deleteTable', table: 'Items' }] as never);
      f.store.purgeOrphanContainers();
      f.store.applyDesign([{ op: 'restoreDeleted', deleted: f.store.deletedDesigns()[0].id }] as never);
      f.store.restoreRecord('Items', a, seq);
      assert.ok(f.store.containerInfo(first), `${trash} trash: the file the restored record points at survives a purge`);
      assert.equal(f.store.containerId('Items', a, 'Pic'), first);
    } finally { f.close(); }
  }
});

test('moving files back into the database is refused while a backup holds the container folder', () => {
  const f = fixture();
  try {
    f.store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Pic', options: { externalStorage: { path: '"Items/Pic/"' } } }] as never);
    const a = Number(f.store.create('Items', { Name: 'A' }).recordId);
    f.store.setContainer('Items', a, 'Pic', 1, file('external bytes'));
    const id = f.store.containerId('Items', a, 'Pic')!;
    const external = (f.store.sql.prepare('SELECT external FROM _fm_containers WHERE id = ?').get(id) as { external: string }).external;
    const release = holdContainerBackup(f.dir);
    try {
      assert.throws(() => f.store.moveContainersIn([id]), /backup is in progress/);
      assert.ok(f.store.externalFile(external), 'the external file is untouched');
    } finally { release(); }
    assert.equal(f.store.moveContainersIn([id]).moved, 1);
  } finally { f.close(); }
});

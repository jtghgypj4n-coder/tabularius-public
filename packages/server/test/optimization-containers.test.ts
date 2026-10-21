// Moving a converted file's embedded container files out to managed external storage, from the optimization report:
// the preview, the move and its undo through the admin API and MCP, and the same on a small store of our own.
// Measured on a public Beezwax sample (DEMO_drawers: six pictures kept inside the file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStore, Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { createMcpServer } from '../src/mcp.ts';
import { containerMoves, moveContainersToManagedStorage, planContainerMove, undoContainerMove } from '../src/optimization-containers.ts';
import type { optimizationReport } from '../src/optimization.ts';

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const skipFixtures = existsSync(join(fixtures, 'DEMO_drawers.fmp12')) ? false : 'fixtures missing: run npm run fixtures';

function ours(): { dir: string; store: Store; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-opt-move-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Media');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Pic', type: 'container' }] }] as never);
  return { dir, store, done: () => { store.close(); rmSync(dir, { recursive: true }); } };
}

test('a move is described first, refused when the file changed, made all at once and undone', () => {
  const { dir, store, done } = ours();
  try {
    const bytes = new Uint8Array(2 * 1024 * 1024 + 5).map((_, i) => (i * 7) % 251);
    for (const name of ['a.jpg', 'b.jpg']) {
      const id = Number(store.create('Items', { Name: name }).recordId);
      store.setContainer('Items', id, 'Pic', 1, { filename: name, mime: 'image/jpeg', data: bytes });
    }
    assert.throws(() => planContainerMove(store, 'Items', 'Name'), /not a container/);
    assert.throws(() => planContainerMove(store, 'Items', 'Nope'), /missing/);

    const plan = planContainerMove(store, 'Items', 'Pic');
    assert.equal(plan.files, 2);
    assert.equal(plan.bytes, 2 * bytes.length);
    assert.equal(plan.setsStorage, true);
    assert.equal(plan.folder, 'RC_Data_FMS/Media/Items/Pic/');
    assert.ok(plan.preview.some((l) => /Set Items::Pic to store its files outside the file/.test(l)));

    // Asking changes nothing: not the design, not the folder, not the history.
    assert.equal(moveContainersToManagedStorage(store, 'Items', 'Pic', { preview: true }).move, undefined);
    assert.equal(store.schema.tables[0]!.fields.find((f) => f.name === 'Pic')!.options?.externalStorage, undefined);
    assert.equal(existsSync(join(dir, 'RC_Data_FMS')), false);
    assert.deepEqual(containerMoves(store), []);

    // The person was shown 3 files; there are 2 now.
    assert.throws(() => moveContainersToManagedStorage(store, 'Items', 'Pic', { expect: 3 }), /changed since the report: Items::Pic now keeps 2 files inside it, not 3/);
    assert.equal(existsSync(join(dir, 'RC_Data_FMS')), false);

    const before = statSync(join(dir, 'Media.openhbam.sqlite')).size;
    const { move } = moveContainersToManagedStorage(store, 'Items', 'Pic', { expect: 2 });
    assert.ok(move && move.id === 1 && move.moved === 2 && move.setStorage && move.compacted);
    assert.deepEqual(readdirSync(join(dir, 'RC_Data_FMS', 'Media', 'Items', 'Pic')).sort(), ['a.jpg', 'b.jpg']);
    assert.ok(statSync(join(dir, 'Media.openhbam.sqlite')).size < before - 3 * 1024 * 1024, 'the file gave back the space');
    assert.ok(store.schema.tables[0]!.fields.find((f) => f.name === 'Pic')!.options?.externalStorage);
    assert.equal(containerMoves(store).length, 1);
    // Nothing left to move.
    assert.throws(() => planContainerMove(store, 'Items', 'Pic'), /keeps no files inside the file/);

    const back = undoContainerMove(store, 1);
    assert.deepEqual({ moved: back.moved, bytes: back.bytes, missing: back.missing }, { moved: 2, bytes: 2 * bytes.length, missing: 0 });
    assert.equal(store.schema.tables[0]!.fields.find((f) => f.name === 'Pic')!.options?.externalStorage, undefined, 'the setting the move added is taken off');
    assert.deepEqual(readdirSync(join(dir, 'RC_Data_FMS', 'Media', 'Items', 'Pic')), []);
    assert.deepEqual(store.embeddedContainerCount('Items', 'Pic'), { files: 2, bytes: 2 * bytes.length });
    assert.deepEqual(containerMoves(store), []);
    assert.throws(() => undoContainerMove(store, 1), /No move #1/);
  } finally {
    done();
  }
});

test('a field already set to store outside the file keeps its setting through a move and its undo', () => {
  const { store, done } = ours();
  try {
    store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Pic', options: { externalStorage: { path: '"Pictures/"' } } }] as never);
    // Files that came in with the records, before the setting took effect: put in the database directly.
    const id = Number(store.create('Items', { Name: 'x' }).recordId);
    store.sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data) VALUES (9001, 'x.png', 'image/png', 'image', ?)").run(new Uint8Array(1500));
    store.sql.prepare('UPDATE "Items" SET "Pic" = 9001 WHERE _fm_record_id = ?').run(id);
    const plan = planContainerMove(store, 'Items', 'Pic');
    assert.equal(plan.setsStorage, false);
    const { move } = moveContainersToManagedStorage(store, 'Items', 'Pic', { compact: false });
    assert.equal(move!.setStorage, false);
    assert.equal(move!.compacted, false);
    undoContainerMove(store, move!.id);
    assert.ok(store.schema.tables[0]!.fields.find((f) => f.name === 'Pic')!.options?.externalStorage, 'it was theirs, so it stays');
  } finally {
    done();
  }
});

test('AR-server-containers-media-09: partial undo remains retryable', () => {
  const { dir, store, done } = ours();
  try {
    for (const name of ['a.bin', 'b.bin']) {
      const id = Number(store.create('Items', { Name: name }).recordId);
      store.setContainer('Items', id, 'Pic', 1, { filename: name, mime: 'application/octet-stream', data: Buffer.from(name) });
    }
    const move = moveContainersToManagedStorage(store, 'Items', 'Pic', { compact: false }).move!;
    const external = store.sql.prepare('SELECT external FROM _fm_containers WHERE id = ?').get(move.containerIds[1]) as { external: string };
    const file = join(dir, 'RC_Data_FMS', 'Media', external.external);
    renameSync(file, `${file}.held`);
    const first = undoContainerMove(store, move.id);
    assert.deepEqual([first.moved, first.missing], [1, 1]);
    assert.deepEqual(containerMoves(store)[0]?.containerIds, [move.containerIds[1]]);
    renameSync(`${file}.held`, file);
    const second = undoContainerMove(store, move.id);
    assert.deepEqual([second.moved, second.missing], [1, 0]);
    assert.deepEqual(containerMoves(store), []);
    assert.equal(store.embeddedContainerCount('Items', 'Pic').files, 2);
  } finally { done(); }
});

test('AR-server-containers-media-10: undo restores the original secure storage setting', () => {
  const { store, done } = ours();
  try {
    const original = { directoryId: 0, secure: true };
    store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Pic', options: { externalStorage: original } }] as never);
    const id = Number(store.create('Items', { Name: 'secure' }).recordId);
    store.sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data) VALUES (9001, 's.bin', 'application/octet-stream', 'file', ?)").run(Buffer.from('data'));
    store.sql.prepare('UPDATE "Items" SET "Pic" = 9001 WHERE _fm_record_id = ?').run(id);
    const move = moveContainersToManagedStorage(store, 'Items', 'Pic', { compact: false }).move!;
    assert.deepEqual(store.schema.tables[0]!.fields.find((f) => f.name === 'Pic')!.options?.externalStorage?.secure, undefined);
    undoContainerMove(store, move.id);
    assert.deepEqual(store.schema.tables[0]!.fields.find((f) => f.name === 'Pic')!.options?.externalStorage, original);
  } finally { done(); }
});

test('AR-server-containers-media-10: failed move restores the original secure storage setting', (t) => {
  const { store, done } = ours();
  try {
    const original = { directoryId: 0, secure: true };
    store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Pic', options: { externalStorage: original } }] as never);
    const id = Number(store.create('Items', { Name: 'secure' }).recordId);
    store.sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data) VALUES (9002, 's.bin', 'application/octet-stream', 'file', ?)").run(Buffer.from('data'));
    store.sql.prepare('UPDATE "Items" SET "Pic" = 9002 WHERE _fm_record_id = ?').run(id);
    t.mock.method(store, 'moveContainersOut', () => { throw new Error('write failed'); });
    assert.throws(() => moveContainersToManagedStorage(store, 'Items', 'Pic', { compact: false }), /write failed/);
    assert.deepEqual(store.schema.tables[0]!.fields.find((f) => f.name === 'Pic')!.options?.externalStorage, original);
    assert.deepEqual(containerMoves(store), []);
  } finally { done(); }
});

test('AR-server-containers-media-10: older move history refuses to guess the original setting', () => {
  const { store, done } = ours();
  try {
    const id = Number(store.create('Items', { Name: 'old' }).recordId);
    store.setContainer('Items', id, 'Pic', 1, { filename: 'old.bin', mime: 'application/octet-stream', data: Buffer.from('old') });
    const move = moveContainersToManagedStorage(store, 'Items', 'Pic', { compact: false }).move!;
    const legacy = { ...move } as Partial<typeof move>;
    delete legacy.previousStorage;
    store.sql.prepare("UPDATE _fm_meta SET json = ? WHERE key = 'containerMoves'").run(JSON.stringify([legacy]));
    assert.throws(() => undoContainerMove(store, move.id), /original field setting cannot be restored safely/);
    assert.equal(store.embeddedContainerCount('Items', 'Pic').files, 0);
    assert.equal(containerMoves(store)[0]?.id, move.id);
  } finally { done(); }
});

test('AR-server-backup-ops-07 case 5', () => {
  const { store, done } = ours();
  try {
    const id = Number(store.create('Items', { Name: 'x' }).recordId);
    store.setContainer('Items', id, 'Pic', 1, { filename: 'x.png', mime: 'image/png', data: new Uint8Array(100) });
    store.compactFile = () => { throw new Error('injected compaction failure'); };
    const result = moveContainersToManagedStorage(store, 'Items', 'Pic');
    assert.equal(result.move?.moved, 1);
    assert.equal(result.move?.compacted, false);
    assert.deepEqual(containerMoves(store).map((m) => m.id), [result.move!.id]);
    assert.equal(undoContainerMove(store, result.move!.id).moved, 1);
  } finally { done(); }
});

test('AR-server-backup-ops-07 case 6', () => {
  const { store, done } = ours();
  try {
    const id = Number(store.create('Items', { Name: 'x' }).recordId);
    store.setContainer('Items', id, 'Pic', 1, { filename: 'x.png', mime: 'image/png', data: new Uint8Array(100) });
    store.sql.exec("CREATE TRIGGER reject_move BEFORE INSERT ON _fm_meta WHEN NEW.key = 'containerMoves' BEGIN SELECT RAISE(FAIL, 'injected'); END");
    assert.throws(() => moveContainersToManagedStorage(store, 'Items', 'Pic', { compact: false }), /injected/);
    assert.equal(store.embeddedContainerCount('Items', 'Pic').files, 1);
    assert.equal(store.schema.tables.find((t) => t.name === 'Items')!.fields.find((f) => f.name === 'Pic')!.options?.externalStorage, undefined);
    assert.deepEqual(containerMoves(store), []);
  } finally { done(); }
});

test('AR-server-backup-ops-07 case 8', () => {
  const { store, done } = ours();
  try {
    const id = Number(store.create('Items', { Name: 'x' }).recordId);
    store.setContainer('Items', id, 'Pic', 1, { filename: 'x.png', mime: 'image/png', data: new Uint8Array(100) });
    const moved = moveContainersToManagedStorage(store, 'Items', 'Pic', { compact: false }).move!;
    store.sql.exec("CREATE TRIGGER reject_move_undo BEFORE UPDATE ON _fm_meta WHEN NEW.key = 'containerMoves' BEGIN SELECT RAISE(FAIL, 'injected'); END");
    assert.throws(() => undoContainerMove(store, moved.id), /injected/);
    assert.equal(store.embeddedContainerCount('Items', 'Pic').files, 0);
    assert.ok(store.schema.tables.find((t) => t.name === 'Items')!.fields.find((f) => f.name === 'Pic')!.options?.externalStorage);
    assert.deepEqual(containerMoves(store).map((m) => m.id), [moved.id]);
  } finally { done(); }
});

test('the admin console and MCP preview, make and undo a move on a converted file', { skip: skipFixtures }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-opt-move-serve-'));
  copyFileSync(join(fixtures, 'DEMO_drawers.fmp12'), join(dir, 'Drawers.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  const mcp = createMcpServer(s.host, { admin: true });
  const client = new Client({ name: 'optimization-move-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await mcp.close();
    await new Promise<void>((r) => s.server.close(() => r()));
    rmSync(dir, { recursive: true });
  });
  const call = async (path: string, body?: unknown) => {
    const r = await fetch(`${s.url}/tabularius/admin/v1/optimization/Drawers${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: await r.json() as Record<string, any> };
  };

  const first = (await call('')).json as ReturnType<typeof optimizationReport> & { containerMoves: unknown[] };
  const finding = first.findings[0]!;
  assert.equal(finding.id, 'embedded-container:RECORD::field_container_01');
  const action = finding.actions!.find((a) => a.id === 'container-to-managed-storage')!;
  assert.equal(action.available, true);
  assert.equal(action.request!.path, '/tabularius/admin/v1/optimization/Drawers/containers');
  assert.deepEqual(action.request!.body, { table: 'RECORD', field: 'field_container_01', expect: 6 });
  assert.match(action.confirm!, /Move the 6 files of RECORD::field_container_01/);
  // Moving to S3 still waits on a connection.
  assert.equal(finding.actions!.find((a) => a.id === 'container-to-s3')!.available, false);
  assert.deepEqual(first.containerMoves, []);

  const store = s.host.get('Drawers')!;
  const bytesBefore = first.containers.bytes;
  const sizes = () => store.embeddedContainerCount('RECORD', 'field_container_01').bytes;

  const preview = await call('/containers', { ...action.request!.body, preview: true });
  assert.equal(preview.status, 200);
  assert.equal(preview.json.plan.files, 6);
  assert.equal(preview.json.move, undefined);
  assert.equal(sizes(), bytesBefore, 'a preview changes nothing');

  assert.equal((await call('/containers', { ...action.request!.body, expect: 5 })).status, 400);
  assert.equal((await call('/containers', { table: 'RECORD' })).status, 400);
  assert.equal((await call('/containers', { table: 'RECORD', field: 'Nope' })).status, 400);
  assert.equal((await fetch(`${s.url}/tabularius/admin/v1/optimization/Drawers/containers`, { method: 'POST', body: '{}' })).status, 403);

  const done = await call('/containers', action.request!.body);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.move.moved, 6);
  assert.equal(sizes(), 0, 'the files are no longer in the database');
  const folder = join(dir, 'RC_Data_FMS', 'Drawers');
  assert.equal(readdirSync(folder, { recursive: true }).filter((f) => /\.\w+$/.test(String(f))).length, 6);

  const after = (await call('')).json as ReturnType<typeof optimizationReport> & { containerMoves: { id: number }[] };
  assert.equal(after.containers.files, 0);
  assert.ok(!after.findings.some((f) => f.id.startsWith('embedded-container:')));
  assert.deepEqual(after.containerMoves.map((m) => m.id), [1]);
  assert.deepEqual((await call('/containers')).json.moves.map((m: { id: number }) => m.id), [1]);

  // MCP describes first and changes nothing until confirm; undo goes the other way.
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await mcp.connect(st);
  await client.connect(ct);
  const listed = JSON.parse(((await client.callTool({ name: 'optimization_move_containers', arguments: { database: 'Drawers' } })).content as { text: string }[])[0].text);
  assert.equal(listed.moves.length, 1);
  const unconfirmed = JSON.parse(((await client.callTool({ name: 'optimization_move_containers', arguments: { database: 'Drawers', undo: 1 } })).content as { text: string }[])[0].text);
  assert.match(unconfirmed.message, /Nothing was changed/);
  assert.equal(sizes(), 0);
  const undone = JSON.parse(((await client.callTool({ name: 'optimization_move_containers', arguments: { database: 'Drawers', undo: 1, confirm: true } })).content as { text: string }[])[0].text);
  assert.equal(undone.moved, 6);
  assert.equal(undone.missing, 0);
  assert.equal(sizes(), bytesBefore);
  assert.deepEqual((await call('')).json.containerMoves, []);

  // The same move through MCP: described, then made.
  const args = { database: 'Drawers', table: 'RECORD', field: 'field_container_01', expect: 6 };
  const described = JSON.parse(((await client.callTool({ name: 'optimization_move_containers', arguments: args })).content as { text: string }[])[0].text);
  assert.equal(described.plan.files, 6);
  assert.match(described.message, /Nothing was changed/);
  assert.equal(sizes(), bytesBefore);
  const made = JSON.parse(((await client.callTool({ name: 'optimization_move_containers', arguments: { ...args, confirm: true } })).content as { text: string }[])[0].text);
  assert.equal(made.move.moved, 6);
  assert.equal(sizes(), 0);
});

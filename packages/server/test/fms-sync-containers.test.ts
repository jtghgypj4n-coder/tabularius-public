// Bringing container files from FileMaker with a pull, against Tabularius's own Data API standing in for FileMaker
// Server (as fms-sync-apply.test.ts does): opt-in, a size limit, compared before it is replaced, and only ever
// fetched from the server that was signed in to.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve, dataApiSource, dataApiClient, describeApply, parseSyncConfig, CONTAINER_PULL_MAX_BYTES } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { applySync, createStore, openForPlanning, readSyncLog, Store, type DesignOp, type Resolution, type TableSyncConfig } from '../../store/src/index.ts';

let dir: string;
let server: Server;
let base: string;
let remote: Store;
let local: Store;

const design: DesignOp[] = [{ op: 'createTable', name: 'Contacts', fields: [
  { name: 'uuid' }, { name: 'modts', type: 'timestamp' }, { name: 'Name' }, { name: 'Photo', type: 'container' },
] } as DesignOp];
const table: TableSyncConfig = { localTable: 'Contacts', remoteLayout: 'Contacts', uuidField: 'uuid', modTimestampField: 'modts' };
const login = { database: 'Remote', user: 'Admin', password: 'pw', tables: [table] };
const png = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, n, n, n, n]);

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-fms-containers-'));
  const served = join(dir, 'served');
  mkdirSync(served);
  createStore(join(served, 'Remote' + STORE_EXT));
  const s = await serve({ dir: served, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  remote = s.host.get('Remote')!;
  remote.applyDesign(design);
  remote.setPassword('Admin', 'pw', '[Full Access]');
  createStore(join(dir, 'Local' + STORE_EXT));
  local = new Store(join(dir, 'Local' + STORE_EXT), 'Local');
  local.applyDesign(design);
});
after(() => {
  local?.close();
  server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const run = async (o: { pull?: boolean; write?: boolean; containers?: number; table?: TableSyncConfig; resolutions?: Resolution[] }) => {
  const client = o.write ? dataApiClient({ server: base, ...login }) : undefined;
  const source = client ?? dataApiSource({ server: base, ...login });
  try {
    return await applySync(local, 'Local', [o.table ?? table], source, client ?? source, { write: !!o.write, pull: !!o.pull, ...(o.containers ? { containers: { maxBytes: o.containers } } : {}), ...(o.resolutions ? { resolutions: o.resolutions } : {}) });
  } finally {
    await source.close();
  }
};
const remoteId = (uuid: string) => Number(remote.query(`SELECT _fm_record_id id FROM "Contacts" WHERE uuid = '${uuid}'`, 1)[0].id);
const localRow = (uuid: string) => local.query(`SELECT _fm_record_id id, _fm_mod_id mod, Name, Photo FROM "Contacts" WHERE uuid = '${uuid}'`, 1)[0] as { id: number; mod: number; Name: string; Photo: number | null } | undefined;
const remoteFile = (uuid: string) => {
  const id = remote.query(`SELECT Photo FROM "Contacts" WHERE uuid = '${uuid}'`, 1)[0]?.Photo;
  return id ? remote.container(Number(id)) : undefined;
};
const localFile = (uuid: string) => {
  const id = localRow(uuid)?.Photo;
  return id ? local.container(Number(id)) : undefined;
};

test('without the option a pull brings the record and leaves its container alone; a dry run counts what would be fetched', async () => {
  const a = remote.create('Contacts', { uuid: 'u1', Name: 'Ann' });
  remote.setContainer('Contacts', a.recordId, 'Photo', 1, { filename: 'ann.png', mime: 'image/png', data: png(1) });

  let res = await run({ pull: false, containers: CONTAINER_PULL_MAX_BYTES });
  assert.deepEqual([res.tables[0].pulled.created, res.tables[0].containers.checked, res.tables[0].containers.pulled], [1, 1, 0], 'counted, not fetched');
  assert.match(describeApply(res, 'fms.example.com').join('\n'), /up to 1 file would be fetched, compared or sent/);
  assert.equal(localRow('u1'), undefined, 'a dry run changes nothing');
  assert.equal(readSyncLog(local).length, 0);

  res = await run({ pull: true });
  assert.equal(res.tables[0].pulled.created, 1);
  assert.deepEqual(res.tables[0].containers, { checked: 0, pulled: 0, cleared: 0, unchanged: 0, toSend: 0, sent: 0, skipped: [] });
  assert.equal(localRow('u1')!.Name, 'Ann');
  assert.equal(localFile('u1'), undefined, 'no file came');
});

test('with the option it brings the file, compares before replacing, and empties what FileMaker emptied', async () => {
  // The record is already here (from the pull above), so the file arrives as an update.
  let res = await run({ pull: true, containers: CONTAINER_PULL_MAX_BYTES });
  // Nothing on FileMaker changed since the last pull, so there is nothing to pull at all.
  assert.deepEqual([res.tables[0].pulled.updated, res.tables[0].containers.checked], [0, 0]);

  // A change that is only the file: the record is updated here and the file replaced.
  const a = remoteId('u1');
  remote.setContainer('Contacts', a, 'Photo', 1, { filename: 'ann.png', mime: 'image/png', data: png(2) });
  res = await run({ pull: true, containers: CONTAINER_PULL_MAX_BYTES });
  assert.deepEqual([res.tables[0].pulled.updated, res.tables[0].containers.checked, res.tables[0].containers.pulled, res.tables[0].failed.length], [1, 1, 1, 0]);
  const got = localFile('u1')!;
  assert.deepEqual([...got.data], [...png(2)]);
  assert.equal(got.filename, 'ann.png');
  assert.equal(got.mime, 'image/png');
  const log = readSyncLog(local).filter((r) => r.op === 'pull-update');
  assert.deepEqual(log.at(-1)!.fields, ['Photo'], 'the log names the field, never its contents');
  assert.equal(log.at(-1)!.status, 'ok');

  // The name changes on FileMaker but the file is the same: it is fetched, found the same, and not replaced.
  remote.update('Contacts', a, { Name: 'Annie' });
  const before = localRow('u1')!.Photo;
  res = await run({ pull: true, containers: CONTAINER_PULL_MAX_BYTES });
  assert.deepEqual([res.tables[0].pulled.updated, res.tables[0].containers.unchanged, res.tables[0].containers.pulled], [1, 1, 0]);
  assert.equal(localRow('u1')!.Name, 'Annie');
  assert.equal(localRow('u1')!.Photo, before, 'the same stored file');

  // FileMaker empties the container: it is emptied here.
  remote.setContainer('Contacts', a, 'Photo', 1, null);
  res = await run({ pull: true, containers: CONTAINER_PULL_MAX_BYTES });
  assert.deepEqual([res.tables[0].containers.cleared, res.tables[0].containers.checked], [1, 0]);
  assert.equal(localFile('u1'), undefined);
  assert.match(describeApply(res, 'fms.example.com').join('\n'), /container files: 0 brought here, 1 emptied/);
});

test('a new record comes with its file in one step; a file over the limit is left out and listed, the record still comes', async () => {
  const b = remote.create('Contacts', { uuid: 'u2', Name: 'Bo' });
  remote.setContainer('Contacts', b.recordId, 'Photo', 1, { filename: 'bo.png', mime: 'image/png', data: png(3) });
  const c = remote.create('Contacts', { uuid: 'u3', Name: 'Cy' });
  remote.setContainer('Contacts', c.recordId, 'Photo', 1, { filename: 'cy.bin', mime: 'application/octet-stream', data: new Uint8Array(100) });

  const res = await run({ pull: true, containers: 50 });
  const t = res.tables[0];
  assert.deepEqual([t.pulled.created, t.containers.pulled, t.containers.skipped.length, t.failed.length], [2, 1, 1, 0]);
  assert.equal(t.containers.skipped[0].uuid, 'u3');
  assert.equal(t.containers.skipped[0].field, 'Photo');
  assert.match(t.containers.skipped[0].reason, /over the 50-byte limit|is 100 bytes, over/);
  assert.deepEqual([...localFile('u2')!.data], [...png(3)]);
  assert.equal(localRow('u3')!.Name, 'Cy');
  assert.equal(localFile('u3'), undefined);
  assert.match(describeApply(res, 'fms.example.com').join('\n'), /file left out: Photo of u3: .*50-byte limit/);
});

test('only the signed-in server is fetched from; a refused or missing file is skipped with the reason', async () => {
  const source = dataApiSource({ server: base, ...login });
  try {
    for (const away of ['https://elsewhere.example/Streaming_SSL/x.png', 'http://169.254.169.254/latest/meta-data/', `${base.replace('http:', 'https:')}/x.png`]) {
      const r = await source.fetchContainer!('Contacts', away, 1000);
      assert.ok('skipped' in r, away);
      assert.match((r as { skipped: string }).skipped, /wasn't fetched/, away);
    }
    assert.deepEqual(await source.fetchContainer!('Contacts', 'not an address', 1000), { skipped: 'the field holds no address to fetch' });
    const refused = await source.fetchContainer!('Contacts', `${base}/tabularius/containers/Remote/99999/x.png?sig=bad`, 1000);
    assert.ok('skipped' in refused);
    assert.match((refused as { skipped: string }).skipped, /no longer has the file|HTTP 4\d\d/);
    await assert.rejects(() => source.fetchContainer!('Nope', `${base}/x`, 10), /no table is set up/);
  } finally {
    await source.close();
  }
});

test('the configuration file says whether container files may come', () => {
  const t = [{ localTable: 'Contacts', uuidField: 'uuid', modTimestampField: 'modts' }];
  assert.equal(parseSyncConfig({ server: 's', database: 'd', tables: t }).allowContainers, undefined);
  assert.equal(parseSyncConfig({ server: 's', database: 'd', allowContainers: true, tables: t }).allowContainers, true);
  assert.throws(() => parseSyncConfig({ server: 's', database: 'd', allowContainers: 'yes', tables: t }), /"allowContainers" is true or false/);
});

test('sending: a new record takes its file with it, a changed file replaces FileMaker\'s, and nothing is sent without the option', async () => {
  const plain = local.create('Contacts', { uuid: 's0', Name: 'Sam' });
  local.setContainer('Contacts', plain.recordId, 'Photo', 1, { filename: 'sam.png', mime: 'image/png', data: png(4) });
  const sue = local.create('Contacts', { uuid: 's1', Name: 'Sue' });
  local.setContainer('Contacts', sue.recordId, 'Photo', 1, { filename: 'sue.png', mime: 'image/png', data: png(5) });

  // A dry run counts the local files and sends nothing.
  let res = await run({ containers: CONTAINER_PULL_MAX_BYTES });
  assert.equal(res.tables[0].containers.toSend, 2);
  assert.match(describeApply(res, 'fms.example.com').join('\n'), /up to 2 files would be fetched, compared or sent/);
  assert.equal(remote.query(`SELECT COUNT(*) n FROM "Contacts" WHERE uuid IN ('s0', 's1')`, 1)[0].n, 0);

  // Without the option, records go and files stay.
  res = await run({ write: true });
  assert.equal(res.tables[0].created, 2);
  assert.deepEqual(res.tables[0].containers, { checked: 0, pulled: 0, cleared: 0, unchanged: 0, toSend: 0, sent: 0, skipped: [] });
  assert.equal(remoteFile('s0'), undefined);
  assert.equal(remoteFile('s1'), undefined);
  assert.match(res.tables[0].unsentFields.join(','), /Photo/);

  // The files are not planned records any more (they are in step), so change them to send: a files-only update.
  local.setContainer('Contacts', sue.recordId, 'Photo', 1, { filename: 'sue.png', mime: 'image/png', data: png(6) });
  local.setContainer('Contacts', plain.recordId, 'Photo', 1, { filename: 'sam.png', mime: 'image/png', data: png(4) });
  res = await run({ write: true, containers: CONTAINER_PULL_MAX_BYTES });
  const t = res.tables[0];
  assert.deepEqual([t.updated, t.containers.sent, t.failed.length, t.containers.skipped.length], [2, 2, 0, 0]);
  assert.deepEqual([...remoteFile('s1')!.data], [...png(6)]);
  assert.equal(remoteFile('s1')!.filename, 'sue.png');
  assert.equal(remoteFile('s1')!.mime, 'image/png');
  assert.deepEqual([...remoteFile('s0')!.data], [...png(4)]);
  assert.match(describeApply(res, 'fms.example.com').join('\n'), /container files: 2 sent to FileMaker, 0 already the same/);
  const log = readSyncLog(local).filter((r) => r.op === 'update' && r.uuid === 's1');
  assert.deepEqual(log.at(-1)!.fields, ['Photo'], 'the log names the field, never its contents');

  // In step now: another run has nothing to do.
  res = await run({ write: true, containers: CONTAINER_PULL_MAX_BYTES });
  assert.deepEqual([res.tables[0].updated, res.tables[0].created, res.tables[0].containers.sent], [0, 0, 0]);
});

test('sending: an unchanged file is compared and not sent again; a new record with a file over the limit still goes, file left out', async () => {
  // The name changes here but the file is the same one FileMaker has.
  const sue = Number(local.query(`SELECT _fm_record_id id FROM "Contacts" WHERE uuid = 's1'`, 1)[0].id);
  local.update('Contacts', sue, { Name: 'Susan' });
  let res = await run({ write: true, containers: CONTAINER_PULL_MAX_BYTES });
  assert.deepEqual([res.tables[0].updated, res.tables[0].containers.unchanged, res.tables[0].containers.sent], [1, 1, 0]);
  assert.equal(remote.query(`SELECT Name FROM "Contacts" WHERE uuid = 's1'`, 1)[0].Name, 'Susan');

  const big = local.create('Contacts', { uuid: 's2', Name: 'Big' });
  local.setContainer('Contacts', big.recordId, 'Photo', 1, { filename: 'big.bin', mime: 'application/octet-stream', data: new Uint8Array(100) });
  res = await run({ write: true, containers: 50 });
  const t = res.tables[0];
  assert.deepEqual([t.created, t.containers.sent, t.containers.skipped.length, t.failed.length], [1, 0, 1, 0]);
  assert.match(t.containers.skipped[0].reason, /over the 50-byte limit/);
  assert.equal(remote.query(`SELECT Name FROM "Contacts" WHERE uuid = 's2'`, 1)[0].Name, 'Big');
  assert.equal(remoteFile('s2'), undefined);
  assert.match(describeApply(res, 'fms.example.com').join('\n'), /file left out: Photo of s2/);
});

/** A record both sides have, in step with the same file, then a different file put in on each side. */
async function bothChangedFile(uuid: string, name: string): Promise<{ localId: number; remoteId: number }> {
  const made = remote.create('Contacts', { uuid, Name: name });
  remote.setContainer('Contacts', made.recordId, 'Photo', 1, { filename: `${name}.png`, mime: 'image/png', data: png(20) });
  await run({ pull: true, containers: CONTAINER_PULL_MAX_BYTES });
  assert.deepEqual([...localFile(uuid)!.data], [...png(20)]);
  remote.setContainer('Contacts', made.recordId, 'Photo', 1, { filename: `${name}.png`, mime: 'image/png', data: png(21) });
  const localId = localRow(uuid)!.id;
  local.setContainer('Contacts', localId, 'Photo', 1, { filename: `${name}.png`, mime: 'image/png', data: png(22) });
  return { localId, remoteId: made.recordId };
}

test('a file changed on both sides is a conflict like any other field, held for review with the choice per record', async () => {
  await bothChangedFile('c1', 'Cat');
  // The check, with the option, shows it; the rest of the record is the same on both sides.
  const check = await run({ containers: CONTAINER_PULL_MAX_BYTES });
  const c = check.plans[0].conflicts.find((x) => x.uuid === 'c1')!;
  assert.deepEqual(c.clashes.map((x) => x.field), ['Photo']);
  assert.match(String(c.clashes[0].local), /Cat\.png \(8 bytes\)/);
  assert.match(String(c.clashes[0].remote), /Cat\.png \(8 bytes\)/);
  assert.match(describeApply(check, 'fms.example.com').join('\n'), /1 conflict held/);

  // Held: nothing is written, files stay as they are.
  let res = await run({ pull: true, write: true, containers: CONTAINER_PULL_MAX_BYTES });
  assert.match(res.refused ?? '', /c1: changed on both sides \(Photo\)/);
  assert.deepEqual([...localFile('c1')!.data], [...png(22)]);
  assert.deepEqual([...remoteFile('c1')!.data], [...png(21)]);

  // Keep FileMaker's file: it comes here.
  const token = check.plans[0].conflicts.find((x) => x.uuid === 'c1')!.reviewToken!;
  res = await run({ pull: true, containers: CONTAINER_PULL_MAX_BYTES, resolutions: [{ table: 'Contacts', uuid: 'c1', keep: 'theirs', reviewToken: token }] });
  assert.equal(res.refused, undefined, res.refused);
  assert.deepEqual([...localFile('c1')!.data], [...png(21)]);
  assert.deepEqual([res.tables[0].containers.pulled, res.tables[0].failed.length], [1, 0]);
});

test('a table\'s policy settles a file changed on both sides: filemaker-wins brings it, tabularius-wins sends it', async () => {
  await bothChangedFile('c2', 'Cob');
  let res = await run({ pull: true, containers: CONTAINER_PULL_MAX_BYTES, table: { ...table, policy: 'filemaker-wins' } });
  assert.equal(res.refused, undefined);
  assert.deepEqual([...localFile('c2')!.data], [...png(21)]);

  await bothChangedFile('c3', 'Cam');
  res = await run({ write: true, containers: CONTAINER_PULL_MAX_BYTES, table: { ...table, policy: 'tabularius-wins' } });
  assert.equal(res.refused, undefined);
  assert.deepEqual([...remoteFile('c3')!.data], [...png(22)]);
  assert.equal(res.tables[0].containers.sent, 1);
});

test('a file emptied on one side and changed on the other is a conflict too; unchanged files are not', async () => {
  const made = remote.create('Contacts', { uuid: 'c4', Name: 'Cid' });
  remote.setContainer('Contacts', made.recordId, 'Photo', 1, { filename: 'cid.png', mime: 'image/png', data: png(30) });
  await run({ pull: true, containers: CONTAINER_PULL_MAX_BYTES });
  // Both sides edit the name to the same thing and keep the same file: nothing to settle.
  remote.update('Contacts', made.recordId, { Name: 'Cid B' });
  local.update('Contacts', localRow('c4')!.id, { Name: 'Cid B' });
  let res = await run({ pull: true, write: true, containers: CONTAINER_PULL_MAX_BYTES });
  assert.equal(res.plans[0].conflicts.some((x) => x.uuid === 'c4'), false);
  // Now FileMaker empties its file while the file here is replaced.
  remote.setContainer('Contacts', made.recordId, 'Photo', 1, null);
  local.setContainer('Contacts', localRow('c4')!.id, 'Photo', 1, { filename: 'cid.png', mime: 'image/png', data: png(31) });
  res = await run({ containers: CONTAINER_PULL_MAX_BYTES });
  const c = res.plans[0].conflicts.find((x) => x.uuid === 'c4')!;
  assert.deepEqual([c.clashes[0].field, c.clashes[0].remote], ['Photo', '']);
});

test('a dry run on the read-only file says it did not compare container files; a run on the live file does', async () => {
  const readOnly = openForPlanning(join(dir, 'Local' + STORE_EXT));
  try {
    const source = dataApiSource({ server: base, ...login });
    let res;
    try {
      res = await applySync(readOnly, 'Local', [table], source, source, { write: false, containers: { maxBytes: CONTAINER_PULL_MAX_BYTES } });
    } finally {
      await source.close();
    }
    assert.equal(res.containersCompared, false);
    assert.match(describeApply(res, 'fms.example.com').join('\n'), /Container files here were not compared.*A run with --pull or --write compares them/);
    // Without the option there is nothing to say: containers were not asked for.
    const plain = await applySync(readOnly, 'Local', [table], dataApiSource({ server: base, ...login }), dataApiSource({ server: base, ...login }), { write: false });
    assert.equal(plain.containersCompared, undefined);
    assert.doesNotMatch(describeApply(plain, 'fms.example.com').join('\n'), /not compared/);
  } finally {
    readOnly.close();
  }
  const live = await run({ containers: CONTAINER_PULL_MAX_BYTES });
  assert.equal(live.containersCompared, true);
  assert.doesNotMatch(describeApply(live, 'fms.example.com').join('\n'), /not compared/);
});

test('a container emptied here is not emptied on FileMaker, and the run lists it instead of saying nothing', async () => {
  const made = remote.create('Contacts', { uuid: 'e1', Name: 'Eve' });
  remote.setContainer('Contacts', made.recordId, 'Photo', 1, { filename: 'eve.png', mime: 'image/png', data: png(40) });
  // (The conflict left over from the test before is settled by the policy, so it doesn't hold this run.)
  await run({ pull: true, containers: CONTAINER_PULL_MAX_BYTES, table: { ...table, policy: 'filemaker-wins' } });
  assert.deepEqual([...localFile('e1')!.data], [...png(40)]);
  // The file is emptied here and the name changed, so the record goes to FileMaker.
  local.setContainer('Contacts', localRow('e1')!.id, 'Photo', 1, null);
  local.update('Contacts', localRow('e1')!.id, { Name: 'Eve B' });
  const res = await run({ write: true, containers: CONTAINER_PULL_MAX_BYTES });
  assert.equal(res.tables[0].updated, 1);
  assert.deepEqual([...remoteFile('e1')!.data], [...png(40)], 'FileMaker keeps its file');
  assert.deepEqual(res.tables[0].containers.skipped.map((k) => [k.uuid, k.field]), [['e1', 'Photo']]);
  assert.match(res.tables[0].containers.skipped[0].reason, /FileMaker has one: it is left as it is/);
  assert.match(describeApply(res, 'fms.example.com').join('\n'), /file left out: Photo of e1: no file here, but FileMaker has one/);
});

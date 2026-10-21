// Sync from the admin console: the saved setup, a check, conflicts settled one record at a time, applying (opt-in
// twice), and the log. Two servers on 127.0.0.1 in this process: the console's, hosting the local copy, and one
// standing in for FileMaker Server with Tabularius's own Data API. Nothing can reach a real server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { setCaptureOnlyDefaults, captureOnlyDefaults } from '../../scripts/src/index.ts';
import { serve, setAdminPassword, SyncConsole, SyncConsoleError, type Host } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, type DesignOp, type Store } from '../../store/src/index.ts';

const wasHeld = [...captureOnlyDefaults()];
setCaptureOnlyDefaults(['Held'], true);

let dir: string;
let consoleServer: Server;
let fmServer: Server;
let host: Host;
let fmHost: Host;
let base: string;
let fmBase: string;
let remote: Store;
let local: Store;
let passwordFile: string;
const wasEnv = { hosts: process.env.TABULARIUS_SYNC_HOSTS, secrets: process.env.TABULARIUS_SYNC_SECRETS, password: process.env.TABULARIUS_FMS_PASSWORD };

const design: DesignOp[] = [{ op: 'createTable', name: 'Contacts', fields: [{ name: 'uuid' }, { name: 'modts', type: 'timestamp' }, { name: 'Name' }] } as DesignOp];
const tables = [{ localTable: 'Contacts', uuidField: 'uuid', modTimestampField: 'modts' }];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-sync-console-'));
  const fmDir = join(dir, 'fm');
  mkdirSync(fmDir);
  createStore(join(fmDir, 'Remote' + STORE_EXT));
  const fm = await serve({ dir: fmDir, port: 0, watch: false, log: () => {} });
  fmServer = fm.server;
  fmHost = fm.host;
  fmBase = fm.url;
  // What the operator of this server says: where passwords are kept, and which FileMaker Server it may reach (a stand-in, here).
  process.env.TABULARIUS_SYNC_SECRETS = dir;
  process.env.TABULARIUS_SYNC_HOSTS = new URL(fm.url).host;
  remote = fm.host.get('Remote')!;
  remote.applyDesign(design);
  remote.setPassword('Admin', 'pw', '[Full Access]');

  const own = join(dir, 'console');
  mkdirSync(own);
  setAdminPassword(own, 'secret');
  const s = await serve({ dir: own, port: 0, log: () => {}, mcpToken: 'sync-console-admin' });
  consoleServer = s.server;
  host = s.host;
  base = s.url;
  local = host.create('Shop');
  local.applyDesign(design);
  host.create('Held_Books').applyDesign(design);
  passwordFile = join(dir, 'fm-password');
  writeFileSync(passwordFile, 'pw\n', { mode: 0o600 });
});
after(async () => {
  for (const [k, v] of [['TABULARIUS_SYNC_HOSTS', wasEnv.hosts], ['TABULARIUS_SYNC_SECRETS', wasEnv.secrets], ['TABULARIUS_FMS_PASSWORD', wasEnv.password]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  setCaptureOnlyDefaults(wasHeld, true);
  await new Promise<void>((resolve) => (consoleServer ? consoleServer.close(() => resolve()) : resolve()));
  await new Promise<void>((resolve) => (fmServer ? fmServer.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const admin = (method: string, path: string, body?: unknown) =>
  fetch(`${base}/tabularius/admin/v1${path}`, {
    method,
    headers: { 'x-tabularius-admin': '1', authorization: 'Basic ' + btoa('admin:secret'), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

const setup = (extra: Record<string, unknown> = {}) => ({ server: fmBase, database: 'Remote', user: 'Admin', passwordFile, tables, ...extra });
const names = (s: Store) => s.query('SELECT uuid, Name FROM "Contacts" ORDER BY uuid', 100).map((r) => ({ ...r }));
const remoteId = (uuid: string) => Number(remote.query(`SELECT _fm_record_id id FROM "Contacts" WHERE uuid = '${uuid}'`, 1)[0].id);
const localId = (uuid: string) => Number(local.query(`SELECT _fm_record_id id FROM "Contacts" WHERE uuid = '${uuid}'`, 1)[0].id);

test('a setup is checked before it is saved, and never holds the password', async () => {
  assert.equal((await admin('PUT', '/sync/Nowhere', setup())).status, 404);
  const held = await admin('PUT', '/sync/Held_Books', setup());
  assert.equal(held.status, 400);
  assert.match(held.body.error, /"Held_Books" is capture-only/);
  assert.match((await admin('PUT', '/sync/Shop', setup({ password: 'pw' }))).body.error, /unknown setting: password/);
  assert.match((await admin('PUT', '/sync/Shop', setup({ checkEveryMinutes: 2 }))).body.error, /checkEveryMinutes/);
  assert.match((await admin('PUT', '/sync/Shop', setup({ passwordFile: '../relative/path' }))).body.error, /has to be a file in/);
  assert.match((await admin('PUT', '/sync/Shop', setup({ user: '' }))).body.error, /needs "user"/);

  const saved = await admin('PUT', '/sync/Shop', setup({ allowWrites: true }));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.passwordSaved, true);
  assert.equal(saved.body.setup.allowWrites, true);
  assert.equal(saved.body.setup.allowPulls, undefined);
  assert.equal(JSON.stringify(saved.body).includes('"pw"'), false);
  // The file is readable by its owner only (not on Windows, which has no such bits).
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'console', '.openhbam-sync.json')).mode & 0o077, 0);
  assert.deepEqual((await admin('GET', '/sync')).body.sync.map((s: { database: string }) => s.database), ['Shop']);
});

test('a check reads both sides, lists the conflicts, and changes neither', async () => {
  remote.create('Contacts', { uuid: 'same', Name: 'Same' });
  local.create('Contacts', { uuid: 'same', Name: 'Same' });
  remote.create('Contacts', { uuid: 'both', Name: 'FileMaker version' });
  local.create('Contacts', { uuid: 'both', Name: 'Local version' });
  local.create('Contacts', { uuid: 'new-here', Name: 'Only here' });
  remote.create('Contacts', { uuid: 'new-there', Name: 'Only there' });
  const before = JSON.stringify([names(local), names(remote)]);

  const r = await admin('POST', '/sync/Shop/check');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.trigger, 'manual');
  assert.equal(typeof r.body.conflicts[0].reviewToken, 'string');
  assert.deepEqual(r.body.conflicts.map(({ reviewToken: _token, ...c }: { reviewToken: string }) => c), [{ table: 'Contacts', uuid: 'both', kind: 'both-changed', clashes: [{ field: 'Name', here: 'Local version', filemaker: 'FileMaker version' }] }]);
  const t = r.body.tables[0];
  assert.deepEqual([t.created, t.pulled.created], [1, 1]);
  assert.equal(JSON.stringify([names(local), names(remote)]), before);
  assert.equal((await admin('GET', '/sync/Shop')).body.last.conflicts.length, 1);
  assert.equal((await admin('GET', '/sync/Shop/log')).body.log.length, 0, 'a check logs nothing: it sends nothing');
});

test('the AI tool sync_status shows where syncing stands without record values, and only to the administrator', async () => {
  const call = (name: string, args: Record<string, unknown> = {}) => fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: 'Bearer sync-console-admin' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }).then(async (r) => (await r.json()).result.content[0].text as string);
  const text = await call('sync_status', { log: true });
  const status = JSON.parse(text);
  const shop = status.files.find((f: { database: string }) => f.database === 'Shop');
  assert.equal(shop.server, new URL(fmBase).host);
  assert.equal(shop.remoteDatabase, 'Remote');
  assert.deepEqual(shop.tables, ['Contacts']);
  assert.equal(shop.passwordSaved, true);
  assert.equal(shop.last.conflicts, 1);
  assert.deepEqual(shop.last.conflictsListed, [{ table: 'Contacts', uuid: 'both', kind: 'both-changed', fields: ['Name'] }]);
  assert.deepEqual(shop.log, []);
  // Neither record values, nor the password, nor where the password file is.
  for (const secret of ['Local version', 'FileMaker version', passwordFile, '"pw"']) assert.equal(text.includes(secret), false, secret);
  assert.match(await call('sync_status', { database: 'Nowhere' }), /no sync setup/);
});

test('applying needs the setup to allow it and the request to ask for it', async () => {
  assert.match((await admin('POST', '/sync/Shop/apply', {})).body.error, /say what to do/);
  const pull = await admin('POST', '/sync/Shop/apply', { pull: true });
  assert.equal(pull.status, 403);
  assert.match(pull.body.error, /allowPulls/);
  assert.match((await admin('POST', '/sync/Shop/apply', { write: true, resolutions: [{ table: 'Contacts', uuid: 'both', keep: 'theirs', reviewToken: 'test' }] })).body.error, /ask for "pull" too/);
  assert.match((await admin('POST', '/sync/Shop/apply', { write: true, resolutions: [{ table: 'Contacts', uuid: 'both' }] })).body.error, /needs "table", "uuid" and "keep"/);
  const unreviewed = await admin('POST', '/sync/Shop/apply', { write: true, resolutions: [{ table: 'Contacts', uuid: 'both', keep: 'mine' }] });
  assert.equal(unreviewed.status, 400);
  assert.match(unreviewed.body.error, /needs the "reviewToken" from a check/);
  assert.equal((await admin('PUT', '/sync/Shop', setup({ allowWrites: false }))).status, 200);
  const write = await admin('POST', '/sync/Shop/apply', { write: true });
  assert.equal(write.status, 403);
  assert.match(write.body.error, /allowWrites/);
  assert.equal(names(remote).some((r) => r.uuid === 'new-here'), false);
  assert.equal((await admin('PUT', '/sync/Shop', setup({ allowWrites: true, allowPulls: true }))).status, 200);
});

test('an unresolved conflict stops the apply with nothing changed; a choice per record settles it', async () => {
  const before = JSON.stringify([names(local), names(remote)]);
  const held = await admin('POST', '/sync/Shop/apply', { write: true, pull: true });
  assert.equal(held.status, 200);
  assert.match(held.body.refused, /1 conflict held for review/);
  assert.equal(JSON.stringify([names(local), names(remote)]), before);

  // A choice that no longer matches a conflict refuses the run too.
  const stale = await admin('POST', '/sync/Shop/apply', { write: true, pull: true, resolutions: [{ table: 'Contacts', uuid: 'gone', keep: 'mine', reviewToken: 'unreviewed' }] });
  assert.match(stale.body.refused, /no longer matches a conflict/);
  assert.equal(JSON.stringify([names(local), names(remote)]), before);

  // Keep FileMaker's version of the conflict: it comes here; the two new records move each way.
  const review = await admin('POST', '/sync/Shop/check');
  const done = await admin('POST', '/sync/Shop/apply', { write: true, pull: true, resolutions: [{ table: 'Contacts', uuid: 'both', keep: 'theirs', reviewToken: review.body.conflicts[0].reviewToken }] });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.refused, undefined);
  assert.equal(done.body.trigger, 'apply');
  assert.deepEqual(names(local), [{ uuid: 'both', Name: 'FileMaker version' }, { uuid: 'new-here', Name: 'Only here' }, { uuid: 'new-there', Name: 'Only there' }, { uuid: 'same', Name: 'Same' }]);
  assert.deepEqual(names(remote), names(local));
  assert.equal(done.body.conflicts.length, 0);

  // The log has each change, and a run can be read on its own.
  const log = (await admin('GET', '/sync/Shop/log')).body.log as { op: string; status: string; runId: string; uuid: string | null }[];
  assert.deepEqual(log.filter((l) => l.status === 'ok' && l.op !== 'run' && l.op !== 'adopt').map((l) => [l.op, l.uuid]).sort(), [['create', 'new-here'], ['pull-create', 'new-there'], ['pull-update', 'both']]);
  const one = (await admin('GET', `/sync/Shop/log?run=${done.body.runId}`)).body.log;
  assert.ok(one.length >= 5 && one.every((l: { runId: string }) => l.runId === done.body.runId));
});

test('keeping this file\'s version sends it to FileMaker; deletions wait for allowDeletes', async () => {
  local.update('Contacts', localId('same'), { Name: 'Edited here' });
  remote.update('Contacts', remoteId('same'), { Name: 'Edited there' });
  const check = await admin('POST', '/sync/Shop/check');
  assert.equal(check.body.conflicts[0].uuid, 'same');
  const mine = await admin('POST', '/sync/Shop/apply', { write: true, resolutions: [{ table: 'Contacts', uuid: 'same', keep: 'mine', reviewToken: check.body.conflicts[0].reviewToken }] });
  assert.equal(mine.body.refused, undefined, JSON.stringify(mine.body));
  assert.equal(names(remote).find((r) => r.uuid === 'same')?.Name, 'Edited here');

  // Deleted on FileMaker: held until deletes are allowed.
  remote.delete('Contacts', remoteId('new-there'));
  let r = await admin('POST', '/sync/Shop/apply', { pull: true });
  assert.equal(r.body.tables[0].heldPullDeletes, 1);
  assert.equal(names(local).some((x) => x.uuid === 'new-there'), true);
  r = await admin('POST', '/sync/Shop/apply', { pull: true, allowDeletes: true });
  assert.equal(r.body.tables[0].pulled.deleted, 1);
  assert.equal(names(local).some((x) => x.uuid === 'new-there'), false);
});

test('the password comes from the file, the environment or the request, and a wrong one is a clear error', async () => {
  assert.equal((await admin('PUT', '/sync/Shop', setup({ passwordFile: 'missing' }))).body.passwordSaved, false);
  const none = await admin('POST', '/sync/Shop/check');
  assert.equal(none.status, 400);
  assert.match(none.body.error, /can't read the password file/);
  const typed = await admin('POST', '/sync/Shop/check', { password: 'pw' });
  assert.equal(typed.status, 200);
  assert.match((await admin('POST', '/sync/Shop/check', { password: 'wrong' })).body.error, /couldn't sign in to Remote/);
  assert.match((await admin('GET', '/sync/Shop')).body.last.error, /couldn't sign in to Remote/);
  assert.equal((await admin('PUT', '/sync/Shop', setup({ allowWrites: true, allowPulls: true }))).status, 200);
});

test('one run at a time per file', async () => {
  const sc = new SyncConsole(host);
  sc.put('Shop', setup());
  const first = sc.check('Shop');
  await assert.rejects(sc.check('Shop'), (e: unknown) => e instanceof SyncConsoleError && e.status === 409);
  await first;
});

test('removing a setup forgets it', async () => {
  assert.equal((await admin('DELETE', '/sync/Shop')).status, 200);
  assert.equal((await admin('GET', '/sync/Shop')).status, 404);
  assert.equal((await admin('DELETE', '/sync/Shop')).status, 404);
  assert.deepEqual((await admin('GET', '/sync')).body.sync, []);
});

test('a setup can only send a password to where its operator allows', async () => {
  const hosts = process.env.TABULARIUS_SYNC_HOSTS;
  // A password file has to be in the secrets folder, whatever path it is given by, links included.
  for (const bad of ['/etc/passwd', '../outside', join(dir, '..', 'elsewhere')]) {
    const r = await admin('PUT', '/sync/Shop', setup({ passwordFile: bad }));
    assert.equal(r.status, 400, bad);
    assert.match(r.body.error, /has to be a file in/);
  }
  writeFileSync(join(dir, 'outside-secret'), 'top secret\n');
  mkdirSync(join(dir, 'vault'));
  symlinkSync(join(dir, 'outside-secret'), join(dir, 'vault', 'link'));
  try {
    process.env.TABULARIUS_SYNC_SECRETS = join(dir, 'vault');
    assert.equal((await admin('PUT', '/sync/Shop', setup({ passwordFile: 'link' }))).body.passwordSaved, false, 'a link out of the folder is not followed');
    assert.equal((await admin('POST', '/sync/Shop/check')).status, 400);
  } finally {
    process.env.TABULARIUS_SYNC_SECRETS = dir;
  }

  // The server's own password goes only to a server the operator named.
  process.env.TABULARIUS_FMS_PASSWORD = 'pw';
  const noFile = setup();
  delete (noFile as { passwordFile?: string }).passwordFile;
  assert.equal((await admin('PUT', '/sync/Shop', noFile)).body.passwordSaved, true);
  process.env.TABULARIUS_SYNC_HOSTS = 'fms.example.com';
  const elsewhere = await admin('PUT', '/sync/Shop', noFile);
  assert.equal(elsewhere.status, 400);
  assert.match(elsewhere.body.error, /isn't a FileMaker Server this server may reach/);
  delete process.env.TABULARIUS_FMS_PASSWORD;

  // With no list, this machine and link-local addresses (cloud metadata) are refused, by address and by name.
  delete process.env.TABULARIUS_SYNC_HOSTS;
  for (const server of ['https://127.0.0.1', 'https://localhost:8443', 'https://169.254.169.254', 'https://[::1]', 'https://0.0.0.0', 'https://db.localhost']) {
    const r = await admin('PUT', '/sync/Shop', setup({ server }));
    assert.equal(r.status, 400, server);
    assert.match(r.body.error, /this machine or a link-local address/);
  }
  // A private address is where a FileMaker Server usually is.
  assert.equal((await admin('PUT', '/sync/Shop', setup({ server: 'https://192.168.1.20', passwordFile: 'fm-password' }))).status, 200);
  // And a setup saved before the list was set doesn't get around it when it runs.
  process.env.TABULARIUS_SYNC_HOSTS = 'fms.example.com';
  const run = await admin('POST', '/sync/Shop/check', { password: 'pw' });
  assert.equal(run.status, 400);
  assert.match(run.body.error, /isn't a FileMaker Server this server may reach/);
  process.env.TABULARIUS_SYNC_HOSTS = hosts;
  assert.equal((await admin('PUT', '/sync/Shop', setup({ allowWrites: true, allowPulls: true }))).status, 200);
});

test('a refusal from the other end is worded here, and a failed connection says only that it failed', async () => {
  // Another server answers as FileMaker would, with text of its own choosing.
  const evil = createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ messages: [{ code: '<script>alert(1)</script>', message: 'SECRET FROM SOMEWHERE ELSE' }], response: {} })));
  await new Promise<void>((r) => evil.listen(0, '127.0.0.1', r));
  const port = (evil.address() as { port: number }).port;
  const saved = process.env.TABULARIUS_SYNC_HOSTS;
  process.env.TABULARIUS_SYNC_HOSTS = `127.0.0.1:${port}`;
  try {
    assert.equal((await admin('PUT', '/sync/Shop', setup({ server: `http://127.0.0.1:${port}` }))).status, 200);
    const r = await admin('POST', '/sync/Shop/check');
    assert.equal(r.status, 502);
    assert.doesNotMatch(JSON.stringify(r.body), /SECRET FROM SOMEWHERE|script/);
    assert.match(r.body.error, /couldn't sign in to Remote on 127\.0\.0\.1:\d+: HTTP 200/);

    // Nothing is listening: one sentence, not the network's own words.
    await new Promise<void>((resolve) => evil.close(() => resolve()));
    const gone = await admin('POST', '/sync/Shop/check');
    assert.equal(gone.status, 502);
    assert.equal(gone.body.error, `couldn't reach 127.0.0.1:${port}`);
  } finally {
    process.env.TABULARIUS_SYNC_HOSTS = saved;
    assert.equal((await admin('PUT', '/sync/Shop', setup({ allowWrites: true, allowPulls: true }))).status, 200);
  }
});

/** Each regression gets its own pair of files and setup. */
function pair(database: string) {
  const here = host.create(database);
  const there = fmHost.create(database);
  here.applyDesign(design); there.applyDesign(design);
  there.setPassword('Admin', 'pw', '[Full Access]');
  const config = setup({ database, allowWrites: true, allowPulls: true });
  const sc = new SyncConsole(host);
  sc.put(database, config);
  return { here, there, config, sc };
}

test('closing a file during an awaited Check gives a clean retry error', async () => {
  const database = 'InterruptedCheck';
  const { there, sc } = pair(database);
  there.create('Contacts', { uuid: 'remote', Name: 'Remote' });
  let closed = false;
  const interrupt = (req: import('node:http').IncomingMessage) => {
    if (!req.url?.includes(`/databases/${database}/layouts/`)) return;
    fmServer.removeListener('request', interrupt);
    closed = host.closeFile(database);
  };
  fmServer.prependListener('request', interrupt);
  try {
    await assert.rejects(sc.check(database), (e: unknown) => e instanceof SyncConsoleError && e.status === 409 && e.message === 'the file was closed or changed; run Check again');
    assert.equal(closed, true);
    assert.equal(sc.get(database).last?.error, 'the file was closed or changed; run Check again');
  } finally {
    fmServer.removeListener('request', interrupt);
    host.openFile(database);
  }
});

for (const change of ['remote-edit', 'remote-delete', 'local-delete', 'setup'] as const) {
  test(`console review binding refuses ${change} after /check`, async () => {
    const database = `Review_${change}`;
    const { here, there, config, sc } = pair(database);
    const a = here.create('Contacts', { uuid: 'x', Name: 'Original' });
    const b = there.create('Contacts', { uuid: 'x', Name: 'Original' });
    // Use the routes' own console throughout, so a check and apply share exactly the public contract.
    await admin('PUT', `/sync/${database}`, config);
    await admin('POST', `/sync/${database}/apply`, { write: true });
    here.update('Contacts', a.recordId, { Name: 'Mine' });
    there.update('Contacts', b.recordId, { Name: 'Theirs' });
    const review = await admin('POST', `/sync/${database}/check`);
    assert.equal(review.status, 200);
    if (change === 'remote-edit') there.update('Contacts', b.recordId, { Name: 'Newer FileMaker edit' });
    if (change === 'remote-delete') there.delete('Contacts', b.recordId);
    if (change === 'local-delete') here.delete('Contacts', a.recordId);
    if (change === 'setup') await admin('PUT', `/sync/${database}`, { ...config, user: 'Other' });
    // A setup identity change with the same access to the same records must invalidate the token too.
    if (change === 'setup') there.setPassword('Other', 'pw', '[Full Access]');
    here.create('Contacts', { uuid: 'unrelated', Name: 'Do not send' });
    const before = JSON.stringify([names(here), names(there)]);
    const result = await admin('POST', `/sync/${database}/apply`, { write: true, pull: true, allowDeletes: true,
      resolutions: [{ table: 'Contacts', uuid: 'x', keep: 'mine', reviewToken: review.body.conflicts[0].reviewToken }],
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.match(result.body.refused ?? '', /changed since it was reviewed/);
    assert.equal(JSON.stringify([names(here), names(there)]), before);
  });
}

for (const change of ['database', 'server', 'mapping'] as const) {
  test(`replacing the destination ${change} keeps the previous baseline out of the new sync`, async () => {
    const database = `Destination_${change}`;
    const { here, there, config, sc } = pair(database);
    try {
      here.create('Contacts', { uuid: 'x', Name: 'Preserve me' });
      there.create('Contacts', { uuid: 'x', Name: 'Preserve me' });
      await sc.apply(database, { write: true });
      // A held table and its watermark must not carry over either.
      here.sql.prepare("INSERT INTO _fm_sync_state (table_key, paused, paused_reason, last_pull_ts) SELECT DISTINCT table_key, 1, 'old destination', '2099-01-01' FROM _fm_sync_map").run();
      const other = fmHost.create(database + '_empty'); other.applyDesign(design);
      other.setPassword('Admin', 'pw', '[Full Access]');
      let replacement: Record<string, unknown> = { ...config, database: database + '_empty' };
      if (change === 'mapping') {
        there.applyDesign([{ op: 'createTable', name: 'Other', fields: [{ name: 'uuid' }, { name: 'modts', type: 'timestamp' }, { name: 'Name' }] }] as DesignOp[]);
        replacement = { ...config, tables: [{ ...tables[0], remoteLayout: 'Other' }] };
      }
      if (change === 'server') {
        // A separate server origin pointing to the empty file, with the original remote database name.
        // The proxy below changes only the origin, and forwards to that empty file.
        const proxy = createServer(async (req, res) => {
          const upstream = await fetch(fmBase + req.url!.replace(`/databases/${database}/`, `/databases/${database}_empty/`), {
            method: req.method, headers: { authorization: req.headers.authorization ?? '' },
            ...(req.method === 'POST' ? { body: '{}' } : {}),
          });
          res.writeHead(upstream.status, { 'content-type': 'application/json' }).end(await upstream.text());
        });
        await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
        const server = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
        const hosts = process.env.TABULARIUS_SYNC_HOSTS;
        process.env.TABULARIUS_SYNC_HOSTS += ',' + new URL(server).host;
        try {
          sc.put(database, { ...config, server });
          const result = await sc.apply(database, { pull: true, allowDeletes: true });
          assert.equal(result.tables[0].pulled.deleted, 0);
          assert.equal(names(here)[0]?.Name, 'Preserve me');
        } finally {
          process.env.TABULARIUS_SYNC_HOSTS = hosts;
          await new Promise<void>((r) => proxy.close(() => r()));
        }
      } else {
        sc.put(database, replacement);
        const restarted = new SyncConsole(host);
        try {
          const result = await restarted.apply(database, { pull: true, allowDeletes: true });
          assert.equal(result.tables[0].pulled.deleted, 0);
          assert.equal(names(here)[0]?.Name, 'Preserve me');
          assert.equal((await restarted.apply(database, { write: true })).tables[0].skipped, undefined);
        } finally {}
      }
    } finally {}
  });
}

for (const write of [false, true]) {
  test(`an already paused database refuses ${write ? 'push' : 'pull'} applies before any bookkeeping`, async () => {
    const database = write ? 'PausedPush' : 'PausedPull';
    const { here, there, sc } = pair(database);
    try {
      there.create('Contacts', { uuid: 'x', Name: 'Remote' });
      host.pauseFile(database);
      const before = here.sql.prepare("SELECT name FROM sqlite_master WHERE name LIKE '_fm_sync%'").all();
      await assert.rejects(sc.apply(database, write ? { write: true } : { pull: true }), (e: unknown) => e instanceof SyncConsoleError && e.status === 409);
      assert.deepEqual(names(here), []);
      assert.deepEqual(here.sql.prepare("SELECT name FROM sqlite_master WHERE name LIKE '_fm_sync%'").all(), before);
    } finally { host.openFile(database);}
  });
}

for (const action of ['pause', 'pause-reopen', 'close-reopen'] as const) {
  for (const stage of ['read', 'write'] as const) {
    test(`${action} during an awaited sync ${stage} prevents every later local write`, async () => {
      const database = `Interrupted_${action}_${stage}`;
      const { here, there, sc } = pair(database);
      there.create('Contacts', { uuid: 'remote', Name: 'Remote' });
      if (stage === 'write') here.create('Contacts', { uuid: 'local', Name: 'Local' });
      let frozen: string | undefined;
      const snapshot = () => JSON.stringify([
        here.sql.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all(), names(here),
        ...['_fm_sync_log', '_fm_sync_map', '_fm_sync_state'].map((table) => here.sql.prepare('SELECT name FROM sqlite_master WHERE name = ?').get(table) ? here.sql.prepare(`SELECT * FROM ${table}`).all() : []),
      ]);
      const interrupt = (req: import('node:http').IncomingMessage) => {
        if (!req.url?.includes(`/databases/${database}/`) || (stage === 'read' ? !req.url.includes('/layouts/') : req.method !== 'POST' || !req.url.includes('/records'))) return;
        fmServer.removeListener('request', interrupt);
        if (action === 'close-reopen') host.closeFile(database); else host.pauseFile(database);
        if (action !== 'pause') host.openFile(database);
        if (action !== 'close-reopen') frozen = snapshot();
      };
      fmServer.prependListener('request', interrupt);
      try {
        await assert.rejects(sc.apply(database, { write: stage === 'write', pull: true }), (e: unknown) => e instanceof SyncConsoleError && e.status === 409);
        if (action !== 'close-reopen') assert.equal(snapshot(), frozen, 'no data, schema or log writes after pausing, even after reopening');
        assert.equal(names(host.storeOf(database)!).some((r) => r.uuid === 'remote'), stage === 'write', 'the pull precedes the awaited push');
      } finally { fmServer.removeListener('request', interrupt); host.openFile(database);}
    });
  }
}

test('case aliases share one setup, baseline and running lock; reconfiguration cannot race a run', async () => {
  const { here, there, config, sc } = pair('CaseShop');
  try {
    sc.put('caseshop', config);
    assert.equal(sc.list().filter((s) => s.database.toLowerCase() === 'caseshop').length, 1);
    assert.equal(sc.get('CASESHOP').database, 'CaseShop');
    here.create('Contacts', { uuid: 'x', Name: 'Once' });
    const first = sc.apply('CaseShop', { write: true });
    await assert.rejects(sc.apply('caseshop', { write: true }), (e: unknown) => e instanceof SyncConsoleError && e.status === 409);
    assert.throws(() => sc.put('CASESHOP', { ...config, database: 'Remote' }), (e: unknown) => e instanceof SyncConsoleError && e.status === 409);
    assert.throws(() => sc.remove('caseshop'), (e: unknown) => e instanceof SyncConsoleError && e.status === 409);
    await first;
    assert.deepEqual(names(there), [{ uuid: 'x', Name: 'Once' }]);
    const repeated = await sc.apply('CASESHOP', { write: true });
    assert.equal(repeated.tables[0].created, 0);
    assert.equal(repeated.tables[0].adopted, 0, 'the same baseline was reused');
  } finally {}
});

test('concurrent applies through different case aliases cannot both plan a create', async () => {
  const { here, there, config, sc } = pair('CaseRun');
  try {
    sc.put('caserun', config);
    here.create('Contacts', { uuid: 'x', Name: 'Once' });
    const results = await Promise.allSettled([sc.apply('CaseRun', { write: true }), sc.apply('caserun', { write: true })]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    if (results[1].status === 'rejected') assert.equal((results[1].reason as SyncConsoleError).status, 409);
    assert.deepEqual(names(there), [{ uuid: 'x', Name: 'Once' }]);
  } finally {}
});

test('PUT and DELETE refuse reconfiguration while an apply is awaiting the network', async () => {
  const { config, sc } = pair('Reconfigure');
  const running = sc.apply('Reconfigure', { pull: true });
  try {
    assert.throws(() => sc.put('Reconfigure', { ...config, database: 'Remote' }), (e: unknown) => e instanceof SyncConsoleError && e.status === 409);
    assert.throws(() => sc.remove('Reconfigure'), (e: unknown) => e instanceof SyncConsoleError && e.status === 409);
  } finally { await running;}
});

test('saved case aliases are consolidated, and conflicting destinations require a fresh setup', () => {
  const { config, sc } = pair('SavedAlias');
  const path = join(host.dir, '.openhbam-sync.json');
  const original = readFileSync(path, 'utf8');
  try {
    writeFileSync(path, JSON.stringify({ setups: { savedalias: config, SAVEDALIAS: config } }));
    const same = new SyncConsole(host);
    try { assert.deepEqual(same.list().map((s) => s.database), ['SavedAlias']); } finally {}
    writeFileSync(path, JSON.stringify({ setups: { savedalias: config, SAVEDALIAS: { ...config, database: 'Remote' } } }));
    const different = new SyncConsole(host);
    try {
      assert.deepEqual(different.list(), []);
      different.put('savedalias', config);
      assert.equal(different.get('SAVEDALIAS').database, 'SavedAlias');
    } finally {}
  } finally { writeFileSync(path, original); }
});

test('sync routes require admin authentication and the mutation header', async () => {
  const before = JSON.stringify((await admin('GET', '/sync')).body);
  for (const [method, path, body] of [
    ['GET', '/sync', undefined], ['PUT', '/sync/Shop', setup()], ['DELETE', '/sync/Shop', undefined],
    ['POST', '/sync/Shop/check', {}], ['POST', '/sync/Shop/apply', { write: true, pull: true }],
    ['GET', '/sync/Shop/log', undefined],
  ] as const) {
    const unauthenticated = await fetch(`${base}/tabularius/admin/v1${path}`, {
      method, headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(unauthenticated.status, 401, `${method} ${path} requires admin authentication`);
    await unauthenticated.text();
    if (method === 'GET') continue;
    const noHeader = await fetch(`${base}/tabularius/admin/v1${path}`, {
      method, headers: { authorization: 'Basic ' + btoa('admin:secret'), 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(noHeader.status, 403, `${method} ${path} requires the mutation header`);
    await noHeader.text();
  }
  assert.equal(JSON.stringify((await admin('GET', '/sync')).body), before);
});

test('sync apply caps conflict resolutions at 100000 before opening a remote session', async () => {
  await admin('PUT', '/sync/Shop', setup({ allowWrites: true }));
  const resolution = { table: 'Contacts', uuid: 'x', keep: 'mine', reviewToken: 'token' };
  const exact = await admin('POST', '/sync/Shop/apply', { write: true, resolutions: Array(100_000).fill(resolution) });
  assert.equal(exact.status, 200);
  const tooMany = await admin('POST', '/sync/Shop/apply', { write: true, resolutions: Array(100_001).fill(resolution) });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.error, /resolutions.*at most 100000/);
});

test('sync respects missing fmrest and restricted FileMaker record access', async () => {
  const { here, there, config, sc } = pair('Privileges');
  const privilege = {
    name: 'SyncLimited', records: { view: true, edit: false, create: false, delete: false },
    layouts: 'viewOnly' as const, valueLists: 'viewOnly' as const, scripts: 'none' as const,
    extendedPrivileges: [] as string[],
  };
  try {
    here.create('Contacts', { uuid: 'x', Name: 'Local' });
    there.create('Contacts', { uuid: 'x', Name: 'Remote' });
    there.create('Contacts', { uuid: 'hidden', Name: 'Private value' });
    there.savePrivilegeSet(privilege);
    there.setPassword('Limited', 'pw', privilege.name);
    sc.put('Privileges', { ...config, user: 'Limited' });
    await assert.rejects(sc.check('Privileges'), /couldn't sign in/);
    there.savePrivilegeSet({ ...privilege, extendedPrivileges: ['fmrest'], tables: { Contacts: { view: 'uuid = "x"', edit: false, create: false, delete: false } } });
    const review = await sc.check('Privileges');
    assert.deepEqual(review.conflicts.map((c) => c.uuid), ['x']);
    assert.equal(JSON.stringify(review).includes('Private value'), false);
    const result = await sc.apply('Privileges', { write: true, resolutions: [{ table: 'Contacts', uuid: 'x', keep: 'mine', reviewToken: review.conflicts[0].reviewToken }] });
    assert.equal(result.refused, undefined);
    assert.equal(result.tables[0].updated, 0);
    assert.equal(result.tables[0].failed.length, 1);
    assert.deepEqual(names(there), [{ uuid: 'hidden', Name: 'Private value' }, { uuid: 'x', Name: 'Remote' }]);
    assert.deepEqual(names(here), [{ uuid: 'x', Name: 'Local' }]);
  } finally {}
});

test('a manufactured review token without /check cannot authorize a conflicting write', async () => {
  const database = 'ManufacturedReview';
  const { here, there, config, sc } = pair(database);
  await admin('PUT', `/sync/${database}`, config);
  const local = here.create('Contacts', { uuid: 'x', Name: 'Mine' });
  const remote = there.create('Contacts', { uuid: 'x', Name: 'Theirs' });
  const saved = (await admin('GET', `/sync/${database}`)).body.setup;
  const mappings = saved.tables.map(({ policy: _policy, ...mapping }: { policy?: string }) => mapping);
  const history = `${database}@${createHash('sha256').update(JSON.stringify([new URL(saved.server).href, saved.database, mappings])).digest('hex')}`;
  const reviewToken = createHash('sha256').update(JSON.stringify([
    history, JSON.stringify(saved), saved.tables, 'Contacts', 'x',
    [local.recordId, local.modId], [String(remote.recordId), String(remote.modId)],
  ])).digest('hex');
  const before = JSON.stringify([names(here), names(there)]);
  const result = await admin('POST', `/sync/${database}/apply`, { write: true, resolutions: [
    { table: 'Contacts', uuid: 'x', keep: 'mine', reviewToken },
  ] });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.match(result.body.refused ?? '', /changed since it was reviewed/);
  assert.equal(JSON.stringify([names(here), names(there)]), before);
  const review = await admin('POST', `/sync/${database}/check`);
  const accepted = await admin('POST', `/sync/${database}/apply`, { write: true, resolutions: [
    { table: 'Contacts', uuid: 'x', keep: 'mine', reviewToken: review.body.conflicts[0].reviewToken },
  ] });
  assert.equal(accepted.body.refused, undefined);
  assert.equal(accepted.body.tables[0].updated, 1);
});

test('the last run is still shown after a restart, for the same setup only', async () => {
  const { config, sc, here, there } = pair('LastRun');
  here.create('Contacts', { uuid: 'both', Name: 'Local version' });
  there.create('Contacts', { uuid: 'both', Name: 'FileMaker version' });
  const status = await sc.check('LastRun');
  assert.equal(status.conflicts.length, 1);

  const restarted = new SyncConsole(host);
  const last = restarted.get('LastRun').last;
  assert.equal(last?.at, status.at);
  assert.deepEqual(last?.conflicts, status.conflicts);
  if (process.platform !== 'win32') assert.equal(statSync(join(host.dir, '.openhbam-sync-last.json')).mode & 0o077, 0);

  // A setup saved again (different mapping, or the same one) starts blank, and so does a file that can't be read.
  restarted.put('LastRun', { ...config, tables: [{ ...config.tables[0], modTimestampField: 'Name' }] });
  assert.equal(restarted.get('LastRun').last, undefined);
  assert.equal(new SyncConsole(host).get('LastRun').last, undefined);
  await sc.check('LastRun');
  writeFileSync(join(host.dir, '.openhbam-sync-last.json'), '{ broken');
  assert.equal(new SyncConsole(host, () => {}).get('LastRun').last, undefined);
  restarted.remove('LastRun');
  assert.equal(new SyncConsole(host).list().some((s) => s.database === 'LastRun'), false);
});

test('AR-server-observability-04', async () => {
  const database = 'FailedSetupSave';
  const { sc, config } = pair(database);
  sc.put(database, { ...config, allowWrites: false });
  const status = await sc.check(database);
  const saved = readFileSync(join(host.dir, '.openhbam-sync.json'), 'utf8');
  const lock = join(host.dir, '.openhbam-sync.json.lock.db');
  rmSync(lock, { force: true });
  mkdirSync(lock);
  try {
    assert.throws(() => sc.put(database, { ...config, allowWrites: true }));
    assert.equal(sc.get(database).setup.allowWrites, undefined);
    assert.deepEqual(sc.get(database).last, status);
    assert.throws(() => sc.remove(database));
    assert.equal(sc.get(database).setup.allowWrites, undefined);
    assert.deepEqual(sc.get(database).last, status);
    assert.equal(readFileSync(join(host.dir, '.openhbam-sync.json'), 'utf8'), saved);
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
});

test('an unreadable sync setup is renamed before a later save replaces it', () => {
  const file = join(host.dir, '.openhbam-sync.json');
  const original = readFileSync(file);
  try {
    writeFileSync(file, '{ broken setup');
    const restarted = new SyncConsole(host);
    const damaged = readdirSync(host.dir).find((name) => name.startsWith('.openhbam-sync.json.damaged-'));
    assert.ok(damaged, 'the unreadable setup is preserved under a damaged timestamped name');
    restarted.put('Shop', setup());
    assert.match(readFileSync(file, 'utf8'), /"setups"/);
    assert.match(readFileSync(join(host.dir, damaged!), 'utf8'), /broken setup/);
  } finally {
    writeFileSync(file, original);
  }
});

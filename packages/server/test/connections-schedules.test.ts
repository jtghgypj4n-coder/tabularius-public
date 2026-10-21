// A schedule's script uses a connection by name, with the schedule's network switch on: the nightly script puts a file
// in S3 without holding a key. With the switch off, or in a capture-only file, it gets nothing. Local stand-in only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createServer as netServer, type Server as NetServer } from 'node:net';
import { serve, setAdminPassword } from '../src/index.ts';
import type { Host } from '../src/host.ts';
import { fakeS3 } from './fake-s3.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const KEYS = { accessKey: 'AKIA' + 'IOSFODNN7EXAMPLE', secretKey: 'wJalr' + 'XUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
let dir: string;
let server: Server;
let host: Host;
let base: string;
let s3: Awaited<ReturnType<typeof fakeS3>>;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-connection-schedules-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  copyFileSync(fixture, join(dir, 'Lib.fmp12'));
  setAdminPassword(dir, 'secret');
  s3 = await fakeS3({ bucket: 'reports', ...KEYS });
  const s = await serve({ dir, port: 0, scriptNetwork: true, log: () => {} });
  server = s.server;
  host = s.host;
  base = s.url;
  const c = host.connections!;
  c.create({ name: 'reports', type: 's3', config: { bucket: 'reports', endpoint: s3.endpoint, prefix: 'nightly' } });
  c.setSecret('reports', 'accessKey', KEYS.accessKey);
  c.setSecret('reports', 'secretKey', KEYS.secretKey);
  c.approve('reports');
  host.get('Charts')!.applyDesign([{ op: 'createScript', name: 'Upload report', text: [
    'Set Variable [ $body ; "report" ]',
    'Insert from URL [ $r ; "connection://reports/today.txt" ]',
    'Exit Script [ Text Result: Get ( LastError ) ]',
  ].join('\n') }] as never);
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  await s3?.close();
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const api = (method: string, path: string, body?: unknown) =>
  fetch(`${base}/tabularius/admin/v1/schedules${path}`, {
    method,
    headers: { 'x-tabularius-admin': '1', authorization: 'Basic ' + btoa('admin:secret'), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('a schedule with the network switch on reaches its connection; one without it does not', { skip }, async () => {
  const add = (network: boolean) => api('POST', '', { name: `Upload ${network}`, database: 'Charts', script: 'Upload report', account: 'Admin', everyMinutes: 60, network });
  const off = (await add(false)).body.id as string;
  const on = (await add(true)).body.id as string;

  const blocked = await api('POST', `/${off}/run`);
  assert.equal(blocked.status, 200);
  assert.equal(s3.requests.length, 0, 'no request without the schedule\'s network switch');

  const run = await api('POST', `/${on}/run`);
  assert.equal(run.status, 200);
  assert.equal(run.body.result, '0', JSON.stringify(run.body));
  assert.equal(s3.requests.length, 1);
  assert.equal(s3.requests[0].key, 'nightly/today.txt');
  assert.equal(s3.seen.rejected, 0);
});

test('in outbound test mode a schedule with the network switch off still gets no connection', { skip }, async () => {
  const before = s3.requests.length;
  const id = (await api('POST', '', { name: 'Upload quiet', database: 'Charts', script: 'Upload report', account: 'Admin', everyMinutes: 60 })).body.id as string;
  host.testOutbound({ allowHosts: ['127.0.0.1'] });
  try {
    const run = await api('POST', `/${id}/run`);
    assert.equal(run.status, 200);
    assert.notEqual(run.body.result, '0', 'the script was refused');
    assert.equal(s3.requests.length, before, 'nothing reached the connection');
  } finally {
    host.outbound = undefined;
  }
});

test('scripts changed after a person approved them (the AI can edit them) get no connections until a person approves again', { skip }, async () => {
  const id = (await api('POST', '', { name: 'Upload approved', database: 'Charts', script: 'Upload report', account: 'Admin', everyMinutes: 60, network: true })).body.id as string;
  const listed = async () => ((await api('GET', '')).body.schedules as { id: string; connectionsHeld?: boolean }[]).find((x) => x.id === id)!;
  assert.equal((await listed()).connectionsHeld, undefined, 'a person just turned the switch on');
  const before = s3.requests.length;
  assert.equal((await api('POST', `/${id}/run`)).body.result, '0');
  assert.equal(s3.requests.length, before + 1);

  // The AI edits the script (here: the target key) and saves it.
  host.get('Charts')!.applyDesign([{ op: 'updateScript', script: 'Upload report', text: [
    'Insert from URL [ $r ; "connection://reports/other.txt" ]',
    'Exit Script [ Text Result: Get ( LastError ) ]',
  ].join('\n') }] as never);
  assert.equal((await listed()).connectionsHeld, true);
  const held = await api('POST', `/${id}/run`);
  assert.equal(held.status, 200);
  assert.equal(s3.requests.length, before + 1, 'the changed script reached nothing');
  assert.match(held.body.message, /ran without its connections/);
  assert.notEqual(held.body.result, '0');

  // A rename, or turning it off and on, does not approve anything.
  await api('PATCH', `/${id}`, { name: 'Upload approved, renamed', network: true });
  await api('PATCH', `/${id}`, { enabled: false });
  await api('PATCH', `/${id}`, { enabled: true });
  assert.equal((await listed()).connectionsHeld, true);
  // A copy of a held schedule through the FileMaker-style admin API is held as well; a copy of one in good standing is not.
  const copyHeld = await adminCopy(id);
  assert.equal(copyHeld, true);

  // A person approves the scripts as they are, and the schedule reaches its connection again.
  const approved = await api('PATCH', `/${id}`, { approveScripts: true });
  assert.equal(approved.status, 200);
  assert.equal((await listed()).connectionsHeld, undefined);
  assert.equal(await adminCopy(id), false);
  assert.equal((await api('POST', `/${id}/run`)).body.result, '0');
  assert.equal(s3.requests.length, before + 2);
  assert.equal(s3.requests[s3.requests.length - 1].key, 'nightly/other.txt');
  // An edit to a custom function counts too: any code in the file can build the address.
  host.get('Charts')!.applyDesign([{ op: 'createCustomFunction', name: 'Elsewhere', parameters: [], formula: '"connection://reports/x.txt"' }] as never);
  assert.equal((await listed()).connectionsHeld, true);
  await api('PATCH', `/${id}`, { approveScripts: true });
  // Switching the network off and on again approves, because a person did it.
  await api('PATCH', `/${id}`, { network: false });
  host.get('Charts')!.applyDesign([{ op: 'deleteCustomFunction', customFunction: 'Elsewhere' }] as never);
  await api('PATCH', `/${id}`, { network: true });
  assert.equal((await listed()).connectionsHeld, undefined);
});

/** Copies a schedule through the Admin API (the FileMaker Server one) and says whether the copy is held. */
async function adminCopy(consoleId: string): Promise<boolean> {
  const call = (path: string, init: RequestInit = {}) => fetch(`${base}/fmi/admin/api/v2${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) } }).then((r) => r.json() as Promise<{ response: { token?: string; schedules?: { id: string; name: string }[]; schedule?: { id: string; name: string } } }>);
  const login = await call('/user/auth', { method: 'POST', headers: { authorization: 'Basic ' + btoa('admin:secret') } });
  const auth = { authorization: `Bearer ${login.response.token}` };
  const name = (await api('GET', '')).body.schedules.find((x: { id: string }) => x.id === consoleId).name as string;
  const mine = (await call('/schedules', { headers: auth })).response.schedules!.find((x) => x.name === name)!;
  const copy = (await call(`/schedules?source=${mine.id}`, { method: 'POST', headers: auth })).response.schedule!;
  const made = ((await api('GET', '')).body.schedules as { name: string; connectionsHeld?: boolean }[]).filter((x) => x.name === copy.name).pop()!;
  return made.connectionsHeld === true;
}

test('the hold covers every hosted file a run can reach, is checked at every request, and takes connection mail with it', { skip }, async () => {
  // A stand-in mail server that only counts the recipients it is given.
  let rcpts = 0;
  const smtp: NetServer = netServer((socket) => {
    socket.write('220 test\r\n');
    let data = false;
    socket.on('data', (chunk) => {
      for (const line of chunk.toString().split('\r\n')) {
        if (data) { if (line === '.') { data = false; socket.write('250 queued\r\n'); } continue; }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') socket.write('250-test\r\n250 AUTH PLAIN\r\n');
        else if (cmd === 'AUTH') socket.write('235 ok\r\n');
        else if (cmd === 'RCPT') { rcpts++; socket.write('250 ok\r\n'); }
        else if (cmd === 'DATA') { data = true; socket.write('354 go\r\n'); }
        else if (cmd === 'QUIT') socket.end('221 bye\r\n');
        else if (cmd) socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>((ok) => smtp.listen(0, '127.0.0.1', ok));
  try {
    const c = host.connections!;
    c.create({ name: 'office', type: 'smtp', config: { host: '127.0.0.1', port: String((smtp.address() as { port: number }).port), from: 'a@example.com', mail: 'yes' } });
    c.setSecret('office', 'username', 'u');
    c.setSecret('office', 'password', 'p');
    c.approve('office');
    const charts = host.get('Charts')!;
    host.get('Lib')!.applyDesign([{ op: 'createScript', name: 'Helper', text: 'Exit Script [ Text Result: "fine" ]' }] as never);
    charts.applyDesign([
      { op: 'createDataSource', name: 'Lib', paths: ['file:Lib'] },
      { op: 'createScript', name: 'Calls Lib', text: ['Perform Script [ Specified: By name ; "Lib::Helper" ]', 'Exit Script [ Text Result: Get ( ScriptResult ) ]'].join('\n') },
      { op: 'createScript', name: 'Mail it', text: ['Send Mail [ Send via SMTP Server ; With dialog: Off ; To: "client@customer.example" ; Subject: "Hi" ; Message: "x" ]', 'Exit Script [ Text Result: Get ( LastError ) ]'].join('\n') },
      { op: 'createScript', name: 'Sub', text: 'Exit Script [ Text Result: "fine" ]' },
      { op: 'createScript', name: 'Slow', text: ['Pause/Resume Script [ Duration (seconds): 1 ]', 'Perform Script [ Specified: From list ; "Sub" ]', 'Exit Script [ Text Result: Get ( ScriptResult ) ]'].join('\n') },
    ] as never);
    const add = async (script: string) => (await api('POST', '', { name: script, database: 'Charts', script, account: 'Admin', everyMinutes: 60, network: true })).body.id as string;
    const idOf = { lib: await add('Calls Lib'), mail: await add('Mail it'), slow: await add('Slow') };
    const heldOf = async (id: string) => ((await api('GET', '')).body.schedules as { id: string; connectionsHeld?: boolean; connectionsChanged?: string[] }[]).find((x) => x.id === id)!;
    assert.equal((await heldOf(idOf.lib)).connectionsHeld, undefined);

    // Connection mail goes out while nothing changed: one recipient.
    assert.equal((await api('POST', `/${idOf.mail}/run`)).body.result, '0');
    assert.equal(rcpts, 1);

    // The AI edits a script of the OTHER file, which the approved script calls.
    host.get('Lib')!.applyDesign([{ op: 'updateScript', script: 'Helper', text: ['Insert from URL [ $r ; "connection://reports/exfil.txt" ]', 'Exit Script [ Text Result: "lib:" & Get ( LastError ) ]'].join('\n') }] as never);
    const held = await heldOf(idOf.lib);
    assert.equal(held.connectionsHeld, true);
    assert.ok(held.connectionsChanged!.some((x) => x.includes('Lib: script Helper')), JSON.stringify(held.connectionsChanged));
    const before = s3.requests.length;
    const run = await api('POST', `/${idOf.lib}/run`);
    assert.equal(s3.requests.length, before, 'the other file\'s edited script reached nothing');
    assert.match(run.body.message, /ran without its connections/);
    assert.notEqual(run.body.result, 'lib:0');
    // The email connection is held with it; mail on the operator's own flag is not a connection (not tested here).
    const mailRun = await api('POST', `/${idOf.mail}/run`);
    assert.equal(rcpts, 1, 'no mail went out through the connection');
    assert.notEqual(mailRun.body.result, '0');

    // Approved again (a person read the list), then an edit made WHILE the run is under way is caught at its next request.
    for (const id of Object.values(idOf)) await api('PATCH', `/${id}`, { approveScripts: true });
    assert.equal((await heldOf(idOf.lib)).connectionsHeld, undefined);
    host.get('Lib')!.applyDesign([{ op: 'updateScript', script: 'Helper', text: 'Exit Script [ Text Result: "fine" ]' }] as never);
    for (const id of Object.values(idOf)) await api('PATCH', `/${id}`, { approveScripts: true });
    charts.applyDesign([{ op: 'updateScript', script: 'Sub', text: 'Exit Script [ Text Result: "fine" ]' }] as never);
    await api('PATCH', `/${idOf.slow}`, { approveScripts: true });
    const mid = s3.requests.length;
    const pending = api('POST', `/${idOf.slow}/run`);
    await new Promise((r) => setTimeout(r, 300));
    charts.applyDesign([{ op: 'updateScript', script: 'Sub', text: ['Insert from URL [ $r ; "connection://reports/midrun.txt" ]', 'Exit Script [ Text Result: "sub:" & Get ( LastError ) ]'].join('\n') }] as never);
    const done = await pending;
    assert.equal(s3.requests.length, mid, 'the edit made during the run reached nothing');
    assert.notEqual(done.body.result, 'sub:0');

    // A formula the scripts read counts as well: a new field changes what an approved script could build an address from.
    await api('PATCH', `/${idOf.slow}`, { approveScripts: true });
    const table = charts.schema.tables[0].name;
    charts.applyDesign([{ op: 'createField', table, name: 'Endpoint', type: 'text', kind: 'calculation', calculation: '"connection://reports/x.txt"' }] as never);
    assert.ok(((await heldOf(idOf.slow)).connectionsChanged ?? []).some((x) => x.includes(`fields of ${table}`)));
  } finally {
    await new Promise<void>((r) => smtp.close(() => r()));
  }
});

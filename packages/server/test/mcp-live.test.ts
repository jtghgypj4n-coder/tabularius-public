// An AI app against a real `tabularius serve` process, not an in-process server: a token made through the admin
// console's route signs a real MCP client in; read-only and layout-limited tokens keep to their limits; a file with AI
// turned off (by the command line, while the server runs) refuses every call and says so when the token is made; and a
// script an AI runs stays offline.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const main = join(import.meta.dirname, '..', '..', 'cli', 'src', 'main.ts');
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let child: ChildProcess | undefined;
let base = '';
let log = '';
const open: Client[] = [];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async <T>(what: string, f: () => T | undefined, ms = 60_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v !== undefined) return v;
    if (child && child.exitCode !== null) throw new Error(`the server exited (${child.exitCode})\n${log}`);
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}\n${log}`);
    await wait(100);
  }
};

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-live-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  copyFileSync(fixture, join(dir, 'Archive.fmp12'));
  child = spawn(process.execPath, ['--no-warnings', main, 'serve', dir, '--port', '0', '--host', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout!.on('data', (d) => (log += d));
  child.stderr!.on('data', (d) => (log += d));
  base = await until('the server URL and both files to be hosted', () => {
    if (!/now hosting Charts/.test(log) || !/now hosting Archive/.test(log)) return undefined;
    return /Web client: (http:\/\/127\.0\.0\.1:\d+)\/app\//.exec(log)?.[1];
  });
  // Turned off from the command line while the server runs, as an administrator would.
  const off = spawnSync(process.execPath, ['--no-warnings', main, 'ai', dir, 'Archive', 'off'], { encoding: 'utf8' });
  assert.equal(off.status, 0, off.stderr);
  // The running server notices; wait for it rather than assume it's instant.
  for (let i = 0; ; i++) {
    const files = (await (await fetch(`${base}/tabularius/admin/v1/mcp`)).json()).files as { name: string; aiOff?: boolean }[];
    if (files.find((f) => f.name === 'Archive')?.aiOff) break;
    if (i > 300) throw new Error(`the server never saw AI turned off\n${log}`);
    await wait(100);
  }
});
after(async () => {
  // A client a failed test left open would keep the server waiting to shut down, so close them, and stop it for good if it still lingers.
  await Promise.all(open.map((c) => c.close().catch(() => {})));
  if (child && child.exitCode === null) {
    const exited = new Promise((r) => child!.on('exit', r));
    child.kill();
    const hard = setTimeout(() => child!.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(hard);
  }
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const admin = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}/tabularius/admin/v1/mcp${path}`, {
    method, headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
};
const connect = async (token: string): Promise<Client> => {
  const client = new Client({ name: 'live-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  open.push(client);
  return client;
};
const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? '');
const tokenFor = async (body: Record<string, unknown>) => {
  const made = await admin('POST', '/tokens', body);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  return made.body as { token: string; warning?: string };
};

test('a read-only token reads over the wire and its writes, scripts, SQL and design changes are refused', { skip }, async () => {
  const client = await connect((await tokenFor({ database: 'Charts', account: 'Admin', readOnly: true })).token);
  const found = JSON.parse(textOf(await client.callTool({ name: 'find_records', arguments: { database: 'Charts', layout: 'Congress', limit: 1 } })));
  const { recordId, fieldData } = found.records[0];
  for (const [name, args] of [
    ['update_record', { database: 'Charts', layout: 'Congress', recordId, fieldData: { Party: 'X' } }],
    ['run_script', { database: 'Charts', script: 'anything' }],
    ['sql_query', { database: 'Charts', sql: 'SELECT 1' }],
    ['change_design', { database: 'Charts', changes: [{ op: 'createTable', name: 'Sneaky' }] }],
  ] as const) {
    const r = await client.callTool({ name, arguments: args });
    assert.equal(r.isError, true, `${name}: ${textOf(r)}`);
  }
  const again = JSON.parse(textOf(await client.callTool({ name: 'get_record', arguments: { database: 'Charts', layout: 'Congress', recordId } })));
  assert.equal(again.fieldData.Party, fieldData.Party, 'nothing changed');
  await client.close();
});

test('a layout-limited token reads its layout, is refused the others, and a script starts on one of its layouts', { skip }, async () => {
  const full = await connect((await tokenFor({ database: 'Charts', account: 'Admin' })).token);
  const made = await full.callTool({ name: 'change_design', arguments: { database: 'Charts', changes: [
    { op: 'createScript', name: 'Where', text: 'Exit Script [ Get ( LayoutName ) ]' },
    { op: 'createScript', name: 'Wander', text: 'Go to Layout [ "Grades" ]\nExit Script [ Get ( LayoutName ) ]' },
  ] } });
  assert.notEqual(made.isError, true, textOf(made));
  await full.close();

  const client = await connect((await tokenFor({ database: 'Charts', account: 'Admin', layouts: ['Congress'] })).token);
  assert.ok(JSON.parse(textOf(await client.callTool({ name: 'find_records', arguments: { database: 'Charts', layout: 'Congress', limit: 1 } }))).records.length);
  assert.equal((await client.callTool({ name: 'find_records', arguments: { database: 'Charts', layout: 'Grades', limit: 1 } })).isError, true);
  // No layout named: it starts on the one it may use, not the file's first layout.
  const where = JSON.parse(textOf(await client.callTool({ name: 'run_script', arguments: { database: 'Charts', script: 'Where' } })));
  assert.equal(where.error, 0, JSON.stringify(where));
  assert.equal(where.result, 'Congress');
  // A script can't carry it to a layout outside its limits.
  const wander = JSON.parse(textOf(await client.callTool({ name: 'run_script', arguments: { database: 'Charts', script: 'Wander' } })));
  assert.equal(wander.error, 105);
  assert.equal(wander.result, 'Congress');
  await client.close();
});

test('a file with AI turned off: the token says so when made, and every call on the file is refused', { skip }, async () => {
  const listed = (await admin('GET', '')).body.files as { name: string; aiOff?: boolean }[];
  assert.equal(listed.find((f) => f.name === 'Archive')?.aiOff, true);
  assert.equal(listed.find((f) => f.name === 'Charts')?.aiOff, undefined);
  assert.equal((await tokenFor({ database: 'Charts', account: 'Admin' })).warning, undefined);
  const made = await tokenFor({ database: 'Archive', account: 'Admin' });
  assert.match(made.warning ?? '', /AI is turned off for Archive/);
  const client = await connect(made.token);
  for (const [name, args] of [
    ['find_records', { database: 'Archive', layout: 'Congress', limit: 1 }],
    ['describe_database', { database: 'Archive' }],
    ['sql_query', { database: 'Archive', sql: 'SELECT COUNT(*) FROM Congress' }],
    ['run_script', { database: 'Archive', script: 'x' }],
  ] as const) {
    const r = await client.callTool({ name, arguments: args });
    assert.equal(r.isError, true, name);
    assert.match(textOf(r), /AI is turned off for Archive/, name);
  }
  assert.deepEqual(JSON.parse(textOf(await client.callTool({ name: 'list_databases', arguments: {} }))), [], 'the file is not even named');
  await client.close();
});

test('a script an AI runs stays offline even on a server that lets people\'s scripts use the network', { skip }, async () => {
  // This server wasn't started with --allow-script-network; the in-process sandbox test covers a server that was.
  const client = await connect((await tokenFor({ database: 'Charts', account: 'Admin' })).token);
  const made = await client.callTool({ name: 'change_design', arguments: { database: 'Charts', changes: [
    { op: 'createScript', name: 'Fetch', text: `Insert from URL [ $r ; "${base}/tabularius/admin/v1/mcp" ]\nExit Script [ Get ( LastError ) ]` },
    { op: 'createScript', name: 'Mail', text: 'Send Mail [ Send via SMTP Server ; With dialog: Off ; To: "someone@example.com" ; Subject: "Hi" ; Message: "x" ]' },
  ] } });
  assert.notEqual(made.isError, true, textOf(made));
  const fetched = JSON.parse(textOf(await client.callTool({ name: 'run_script', arguments: { database: 'Charts', script: 'Fetch', trace: true } })));
  assert.equal(fetched.error, 3);
  assert.match(JSON.stringify(fetched.trace), /Network access is off/);
  const mailed = JSON.parse(textOf(await client.callTool({ name: 'run_script', arguments: { database: 'Charts', script: 'Mail', trace: true } })));
  assert.equal(mailed.error, 3);
  await client.close();
});

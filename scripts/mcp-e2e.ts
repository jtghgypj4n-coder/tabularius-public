// An AI app against the built single-file program (scripts/build-release.ts), the way a person connects Claude to a
// hosted file: the program serves a copy of Charts.fmp12, a real MCP client signs in with tokens made through the
// admin console, and each step is checked against what the file holds and what the audit log says:
//   - /mcp with no token is refused with an OAuth challenge that points at the sign-in;
//   - a full token finds a record, edits it, runs a script it made, and the audit log lists the edit (account, surface,
//     old and new value) and the design history lists the script;
//   - a read-only token reads, is refused the same write, and the record and the log are unchanged;
//   - a layout-limited token reads its layout and is refused another;
//   - a file with AI turned off never appears, and its calls are refused.
//
//   node --no-warnings scripts/mcp-e2e.ts dist/tabularius-<version>-<os>-<cpu>
//
// release-smoke.ts runs it on the built program after its other checks; packages/server/test/mcp-e2e.test.ts runs
// the same check on the source in the test suite.
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? '');

/**
 * Runs the whole check against a program, on a port nothing else is using. Throws on the first thing wrong. The program is
 * the built file's path, or a command and its leading arguments (the test suite runs the same check on the source:
 * [process.execPath, '--no-warnings', 'packages/cli/src/main.ts']).
 */
export async function runMcpE2E(program: string | string[], port = 0): Promise<void> {
  const [exe, ...lead] = typeof program === 'string' ? [program] : program;
  const fixture = join(import.meta.dirname, '..', 'fixtures', 'fmp12', 'Charts.fmp12');
  assert.ok(existsSync(exe!), `no program at ${exe}`);
  assert.ok(existsSync(fixture), 'run npm run fixtures first');
  const work = mkdtempSync(join(tmpdir(), 'tabularius-mcp-e2e-'));
  const env = { ...process.env, TABULARIUS_HOME: join(work, 'home') };
  const folder = join(work, 'Databases');
  mkdirSync(folder, { recursive: true });
  copyFileSync(fixture, join(folder, 'Charts.fmp12'));
  copyFileSync(fixture, join(folder, 'Archive.fmp12'));
  let log = '';
  const server: ChildProcess = spawn(exe!, [...lead, 'serve', folder, '--port', String(port), '--host', '127.0.0.1', '--no-backups'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout!.on('data', (d) => (log += d));
  server.stderr!.on('data', (d) => (log += d));
  const open: Client[] = [];
  try {
    for (let i = 0; !(/now hosting Charts/.test(log) && /now hosting Archive/.test(log) && /Web client: http:\/\/127\.0\.0\.1:\d+\/app\//.test(log)); i++) {
      if (server.exitCode !== null) assert.fail(`the server stopped (exit ${server.exitCode})\n${log}`);
      if (i > 480) assert.fail(`the files were never hosted\n${log}`);
      await sleep(250);
    }
    // Let the child bind an ephemeral port. Its Web client line is written after listen(), so it is also a readiness signal.
    const base = /Web client: (http:\/\/127\.0\.0\.1:\d+)\/app\//.exec(log)![1];

    // 1. No token: refused, and the refusal says where to sign in. (From this computer itself a request with no token is the
    // administrator's; a request a proxy passed on, which says whom it is for, is a stranger's.)
    const ask = (headers: Record<string, string>) => fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', connection: 'close', 'x-forwarded-for': '203.0.113.9', ...headers }, body: '{}' });
    const bare = await ask({});
    assert.equal(bare.status, 401, 'no token is refused');
    const challenge = bare.headers.get('www-authenticate') ?? '';
    assert.match(challenge, /^Bearer .*resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/);
    const meta = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`, { headers: { connection: 'close' } })).json() as { resource?: string; authorization_servers?: string[] };
    assert.ok(meta.authorization_servers?.length, 'the challenge points at a sign-in');
    const stale = await ask({ authorization: 'Bearer ohbt_not-a-real-token' });
    assert.equal(stale.status, 401, 'a token that is not valid is refused');
    assert.match(stale.headers.get('www-authenticate') ?? '', /error="invalid_token"/, 'and the app is told to sign in again');

    const admin = async (path: string, body: unknown) => {
      const r = await fetch(`${base}/tabularius/admin/v1/mcp${path}`, { method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify(body) });
      const text = await r.text();
      assert.equal(r.status, 201, `${path}: ${text}`);
      return JSON.parse(text) as { token: string; warning?: string };
    };
    const connect = async (token: string): Promise<Client> => {
      const client = new Client({ name: 'mcp-e2e', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}`, connection: 'close' } } }));
      open.push(client);
      return client;
    };
    const call = async (c: Client, name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args });
    const json = (r: unknown) => JSON.parse(textOf(r));

    // 2. AI off for Archive, from the command line while the server runs.
    const off = spawnSync(exe!, [...lead, 'ai', folder, 'Archive', 'off'], { env, encoding: 'utf8' });
    assert.equal(off.status, 0, off.stderr);

    // 3. A full token: find, edit, run a script, and the log lists them.
    const full = await connect((await admin('/tokens', { database: 'Charts', account: 'Admin' })).token);
    const tools = (await full.listTools()).tools.map((t) => t.name);
    for (const t of ['find_records', 'update_record', 'run_script', 'audit_log', 'design_history']) assert.ok(tools.includes(t), `${t} is offered`);
    const found = json(await call(full, 'find_records', { database: 'Charts', layout: 'Congress', limit: 1 }));
    assert.ok(found.records.length, 'a find returns a record');
    const { recordId, fieldData } = found.records[0];
    const before = String(fieldData['Party']);
    const after = before === 'Zed' ? 'Yan' : 'Zed';
    const edited = await call(full, 'update_record', { database: 'Charts', layout: 'Congress', recordId, fieldData: { Party: after } });
    assert.notEqual(edited.isError, true, textOf(edited));
    assert.equal(json(await call(full, 'get_record', { database: 'Charts', layout: 'Congress', recordId })).fieldData['Party'], after);
    const made = await call(full, 'change_design', { database: 'Charts', changes: [{ op: 'createScript', name: 'E2E where', text: 'Exit Script [ Get ( LayoutName ) ]' }] });
    assert.notEqual(made.isError, true, textOf(made));
    const ran = json(await call(full, 'run_script', { database: 'Charts', script: 'E2E where', layout: 'Congress' }));
    assert.equal(ran.error, 0, JSON.stringify(ran));
    assert.equal(ran.result, 'Congress');

    const entries = json(await call(full, 'audit_log', { database: 'Charts', recordId })) as { account?: string; surface?: string; changes?: Record<string, unknown> }[];
    const entry = entries.find((e) => JSON.stringify(e.changes ?? {}).includes(after));
    assert.ok(entry, `the audit log lists the edit: ${JSON.stringify(entries).slice(0, 600)}`);
    assert.equal(entry.account, 'Admin');
    assert.equal(entry.surface, 'mcp');
    assert.match(JSON.stringify(entry.changes), new RegExp(before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'with the old value');
    assert.match(JSON.stringify(json(await call(full, 'design_history', { database: 'Charts' }))), /E2E where/, 'the design history lists the script');
    const entriesAfterFull = entries.length;
    await full.close();

    // 4. A read-only token: reads, is refused the same write; the record and the log do not change.
    const readOnly = await connect((await admin('/tokens', { database: 'Charts', account: 'Admin', readOnly: true })).token);
    assert.equal(json(await call(readOnly, 'get_record', { database: 'Charts', layout: 'Congress', recordId })).fieldData['Party'], after);
    const refused = await call(readOnly, 'update_record', { database: 'Charts', layout: 'Congress', recordId, fieldData: { Party: 'Refused' } });
    assert.equal(refused.isError, true, 'a read-only token cannot edit');
    assert.equal((await call(readOnly, 'run_script', { database: 'Charts', script: 'E2E where' })).isError, true, 'or run a script');
    assert.equal(json(await call(readOnly, 'get_record', { database: 'Charts', layout: 'Congress', recordId })).fieldData['Party'], after, 'the record is unchanged');
    await readOnly.close();

    // 5. A layout-limited token.
    const limited = await connect((await admin('/tokens', { database: 'Charts', account: 'Admin', layouts: ['Congress'] })).token);
    assert.ok(json(await call(limited, 'find_records', { database: 'Charts', layout: 'Congress', limit: 1 })).records.length);
    assert.equal((await call(limited, 'find_records', { database: 'Charts', layout: 'Grades', limit: 1 })).isError, true, 'another layout is refused');
    await limited.close();

    // 6. The refused attempts left nothing in the audit log; the file with AI off is invisible and refuses calls.
    const check = await connect((await admin('/tokens', { database: 'Charts', account: 'Admin' })).token);
    const entriesNow = json(await call(check, 'audit_log', { database: 'Charts', recordId })) as unknown[];
    assert.equal(entriesNow.length, entriesAfterFull, 'refused writes are not changes');
    assert.doesNotMatch(JSON.stringify(entriesNow), /Refused/);
    await check.close();
    const archive = await admin('/tokens', { database: 'Archive', account: 'Admin' });
    assert.match(archive.warning ?? '', /AI is turned off for Archive/);
    const blocked = await connect(archive.token);
    assert.deepEqual(json(await call(blocked, 'list_databases', {})), [], 'the file with AI off is not even named');
    const noFind = await call(blocked, 'find_records', { database: 'Archive', layout: 'Congress', limit: 1 });
    assert.equal(noFind.isError, true);
    assert.match(textOf(noFind), /AI is turned off for Archive/);
    await blocked.close();
  } catch (e) {
    if (e instanceof Error) e.message += `\n--- server log ---\n${log.slice(-2000)}`;
    throw e;
  } finally {
    await Promise.all(open.map((c) => c.close().catch(() => {})));
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f']);
    else server.kill();
    if (server.exitCode === null && server.signalCode === null) await new Promise((r) => server.once('exit', r));
    rmSync(work, { recursive: true, force: true, maxRetries: 10 });
  }
}

if (import.meta.main) {
  await runMcpE2E(resolve(process.argv[2] ?? ''));
  console.log('mcp end-to-end: ok');
}

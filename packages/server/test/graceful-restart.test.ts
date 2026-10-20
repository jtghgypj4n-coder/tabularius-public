// Stopping the server for a restart or an upgrade: requests that are running finish (within a bound), new ones are told to
// come back, event streams hear that the server is going, the files are saved and closed, and a second signal stops at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { containerFixture, type ContainerFixture } from './container-fixture.ts';
import { createStore, Store, type DesignOp } from '../../store/src/index.ts';
import { STORE_EXT } from '../src/host.ts';

const STAMP = (seconds: number) => `Pause/Resume Script [ Duration (seconds): ${seconds} ]\nNew Record/Request\nSet Field [ Contacts::Name ; "finished after the stop was asked" ]\nCommit Records/Requests [ With dialog: Off ]\nExit Script [ Text Result: "done" ]`;

async function withServer(drainMs: number, body: (f: ContainerFixture, auth: string) => Promise<void>): Promise<void> {
  const f = await containerFixture({ drainMs });
  try {
    f.store.applyDesign([
      { op: 'createScript', name: 'Slow', text: STAMP(3) },
      { op: 'createScript', name: 'Quick', text: STAMP(1) },
    ] as DesignOp[]);
    await body(f, await f.login('Admin'));
  } finally {
    await f.close();
  }
}

const runScript = (f: ContainerFixture, auth: string, name: string) =>
  fetch(`${f.api}/layouts/Contacts/script/${name}`, { headers: { authorization: auth } });

test('a request that is running finishes and is answered, the next one on its connection is told to come back, and the server then closes', async () => {
  await withServer(20_000, async (f, auth) => {
    // One connection carrying two requests one behind the other: the script, then a health check.
    const socket = connect(new URL(f.base).port as unknown as number, '127.0.0.1');
    let got = '';
    socket.on('data', (c) => { got += c; });
    socket.on('error', () => {});
    const closedSocket = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
    socket.write(`GET /fmi/data/vLatest/databases/C/layouts/Contacts/script/Slow HTTP/1.1\r\nHost: x\r\nAuthorization: ${auth}\r\n\r\nGET /tabularius/health HTTP/1.1\r\nHost: x\r\n\r\n`);
    await sleep(800);
    let closed = false;
    const started = performance.now();
    f.server.close(() => { closed = true; });
    await sleep(200);
    // Not accepted any more: nobody can connect, and the server waits for the request that is running.
    await assert.rejects(fetch(`${f.base}/tabularius/health`), /fetch failed/);
    assert.equal(closed, false, 'the server waits for the request that is running');
    await closedSocket;
    // The running request ran to its end (and was saved); what came after it on the connection was refused with a hint to retry.
    const [first, second] = got.split(/(?=HTTP\/1\.1 \d{3} )/);
    assert.match(first, /^HTTP\/1\.1 200 /);
    assert.match(first, /"scriptResult":"done"/);
    assert.match(second, /^HTTP\/1\.1 503 /);
    assert.match(second, /retry-after: \d+/i);
    assert.match(second, /connection: close/i);
    assert.doesNotMatch(second, /server is starting/i, 'a browser is not told the server is starting');
    while (!closed) await sleep(50);
    assert.ok(performance.now() - started < 8000, 'and then closes');
  });
});

test('after the grace period a request that has not finished is cut, and the files still close', async () => {
  const f = await containerFixture({ drainMs: 1000 });
  try {
    f.store.applyDesign([{ op: 'createScript', name: 'Stuck', text: STAMP(6) }] as DesignOp[]);
    const auth = await f.login('Admin');
    const stuck = runScript(f, auth, 'Stuck').then((r) => r.status, (e: Error) => e.message);
    await sleep(600);
    const started = performance.now();
    await new Promise<void>((resolve) => f.server.close(() => resolve()));
    const took = performance.now() - started;
    assert.ok(took >= 700 && took < 5000, `closed after the grace period, not at once or never (${Math.round(took)} ms)`);
    const result = await stuck;
    assert.notEqual(result, 200, 'the request that was cut did not complete');
    // The file is whole and shows nothing from the script that was cut.
    const again = new Store(f.store.path, 'C');
    try {
      assert.equal(again.find('Contacts', { query: [{ Name: 'finished after the stop was asked' }], limit: 5 }).records.length, 0);
      assert.equal(again.find('Contacts', { limit: 10 }).records.length, 3);
    } finally {
      again.close();
    }
  } finally {
    rmSync(f.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('an open event stream hears that the server is going before it ends', async () => {
  await withServer(5_000, async (f, auth) => {
    const res = await fetch(`${f.base}/tabularius/live/v1/databases/C/events`, { headers: { authorization: auth } });
    assert.equal(res.status, 200);
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = '';
    const read = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        text += value;
      }
    })();
    await sleep(200);
    f.server.close();
    await read;
    assert.match(text, /^retry: 3000/);
    assert.match(text, /event: shutdown\ndata: \{"reason":"restart"\}\n\n$/, text);
  });
});

test('what was committed before the stop is in the file when the server starts again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-restart-'));
  try {
    createStore(join(dir, 'R' + STORE_EXT));
    const { serve } = await import('../src/index.ts');
    const s = await serve({ dir, port: 0, watch: false, log: () => {} });
    const store = s.host.get('R')!;
    store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'Text' }] }] as DesignOp[]);
    for (let i = 0; i < 50; i++) store.create('Notes', { Text: `note ${i}` });
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
    const again = new Store(join(dir, 'R' + STORE_EXT), 'R');
    try {
      assert.equal(again.find('Notes', { limit: 100 }).records.length, 50);
    } finally {
      again.close();
    }
    // Nothing is left behind that says the file was not closed: its log is folded in.
    assert.equal(existsSync(join(dir, 'R' + STORE_EXT + '-wal')) && readFileSync(join(dir, 'R' + STORE_EXT + '-wal')).length > 0, false);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('a connection that goes idle during the drain is closed at once, not kept until the keep-alive timeout', async () => {
  await withServer(20_000, async (f, auth) => {
    const port = Number(new URL(f.base).port);
    const open = async () => {
      const socket = connect(port, '127.0.0.1');
      let got = '';
      socket.on('data', (c) => { got += c; });
      socket.on('error', () => {});
      const closedAt = new Promise<number>((resolve) => socket.once('close', () => resolve(performance.now())));
      await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
      return { socket, got: () => got, closedAt };
    };
    const slow = await open();
    const quick = await open();
    const call = (name: string) => `GET /fmi/data/vLatest/databases/C/layouts/Contacts/script/${name} HTTP/1.1\r\nHost: x\r\nAuthorization: ${auth}\r\n\r\n`;
    slow.socket.write(call('Slow'));
    quick.socket.write(call('Quick'));
    await sleep(500);
    f.server.close();
    // The quick request ends about a second in and its connection is then idle, as a keep-alive connection is: it must go,
    // while the slow request (three seconds) is still being answered.
    const quickClosed = await quick.closedAt;
    const slowClosed = await slow.closedAt;
    assert.match(quick.got(), /^HTTP\/1\.1 200 /);
    assert.ok(quickClosed < slowClosed - 500, `the idle connection closed ${Math.round(slowClosed - quickClosed)} ms before the busy one`);
    assert.match(slow.got(), /"scriptResult":"done"/);
  });
});

test('closing a second time waits for the first close and does not hang', async () => {
  await withServer(20_000, async (f, auth) => {
    const running = runScript(f, auth, 'Quick');
    await sleep(300);
    const order: string[] = [];
    f.server.close(() => order.push('first'));
    f.server.close(() => order.push('second'));
    assert.equal((await running).status, 200);
    await new Promise<void>((resolve) => f.server.close(() => resolve()));
    assert.deepEqual(order, ['first', 'second']);
  });
});

test('an open MCP event stream is ended at once, and does not hold the stop for the whole grace period', async () => {
  const token = 'tok-123456789012345678901234567890';
  const f = await containerFixture({ drainMs: 15_000, mcpToken: token });
  try {
    const res = await fetch(`${f.base}/mcp`, { headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' } });
    assert.equal(res.status, 200);
    const reading = (async () => { try { for await (const _ of res.body!) { /* events */ } } catch { /* ended by the server */ } })();
    await sleep(300);
    const started = performance.now();
    await new Promise<void>((resolve) => f.server.close(() => resolve()));
    await reading;
    assert.ok(performance.now() - started < 5000, `closed in ${Math.round(performance.now() - started)} ms`);
  } finally {
    rmSync(f.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('a drain time that cannot be honoured is replaced by the default instead of cutting everything at once', async () => {
  for (const drainMs of [0, -5, Number.NaN, 3e9]) {
    const f = await containerFixture({ drainMs });
    try {
      f.store.applyDesign([{ op: 'createScript', name: 'Quick', text: STAMP(1) }] as DesignOp[]);
      const auth = await f.login('Admin');
      const running = runScript(f, auth, 'Quick');
      await sleep(300);
      f.server.close();
      assert.equal((await running).status, 200, `drainMs ${drainMs}: the running request finished`);
      await new Promise<void>((resolve) => f.server.close(() => resolve()));
    } finally {
      rmSync(f.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }
});

/** The CLI as a service manager runs it: `tabularius serve`, stopped with signals. */
async function cli(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-signal-'));
  createStore(join(dir, 'S' + STORE_EXT));
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('TABULARIUS_')));
  const child = spawn(process.execPath, ['--no-warnings', join(import.meta.dirname, '../../cli/src/main.ts'), 'serve', dir, '--port', '0', '--host', '127.0.0.1'], {
    env: { ...clean, TABULARIUS_HOME: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (c) => { output += c; });
  child.stderr.on('data', (c) => { output += c; });
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const started = Date.now();
  let port = 0;
  while (!port) {
    const m = /Web client: http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
    if (m) port = Number(m[1]);
    else if (child.exitCode !== null) throw new Error(`the server did not start: ${output}`);
    else if (Date.now() - started > 30_000) throw new Error(`the server did not start in time: ${output}`);
    else await sleep(50);
  }
  return { child, exited, port, output: () => output, dir, done: () => { child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } };
}

test('a stop signal ends an idle server cleanly and at once, with exit code 0', { timeout: 60_000 }, async () => {
  const s = await cli();
  try {
    s.child.kill('SIGTERM');
    const end = await Promise.race([s.exited, sleep(15_000).then(() => 'late' as const)]);
    assert.notEqual(end, 'late', s.output());
    assert.deepEqual(end, { code: 0, signal: null });
    assert.match(s.output(), /stopping: finishing running requests/);
  } finally {
    s.done();
  }
});

test('a second signal stops a server that is waiting for a running request, with exit code 1', { timeout: 60_000 }, async () => {
  const s = await cli({ TABULARIUS_DRAIN_SECONDS: '30' });
  try {
    // A request that never ends: headers promise a body that does not arrive (the transport's own timers are far longer).
    const held = connect(s.port, '127.0.0.1');
    held.on('error', () => {});
    held.write('POST /fmi/data/vLatest/databases/none/sessions HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 50\r\nAuthorization: Basic YTpi\r\n\r\n{');
    await sleep(500);
    s.child.kill('SIGTERM');
    const waiting = await Promise.race([s.exited.then(() => 'exited'), sleep(2_000).then(() => 'waiting')]);
    assert.equal(waiting, 'waiting', 'the first signal waits for the request that is running');
    const forced = Date.now();
    s.child.kill('SIGTERM');
    const end = await Promise.race([s.exited, sleep(10_000).then(() => 'late' as const)]);
    held.destroy();
    assert.notEqual(end, 'late', s.output());
    assert.deepEqual(end, { code: 1, signal: null });
    assert.ok(Date.now() - forced < 5_000);
    assert.match(s.output(), /stopping now without closing the files/);
  } finally {
    s.done();
  }
});

test('TABULARIUS_DRAIN_SECONDS must be a number of seconds', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-grace-'));
  try {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('TABULARIUS_')));
    const child = spawn(process.execPath, ['--no-warnings', join(import.meta.dirname, '../../cli/src/main.ts'), 'serve', dir, '--port', '0'], { env: { ...clean, TABULARIUS_HOME: dir, TABULARIUS_DRAIN_SECONDS: 'soon' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (c) => { output += c; });
    child.stdout.on('data', (c) => { output += c; });
    const code = await new Promise((resolve) => child.once('exit', resolve));
    assert.equal(code, 1);
    assert.match(output, /TABULARIUS_DRAIN_SECONDS is a number of seconds \(1 to 86400\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

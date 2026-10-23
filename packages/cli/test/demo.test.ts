// `tabularius demo`: a starter app for this computer only, an Admin account with a random password shown once, and nothing
// left behind when it stops. Run in-process (startDemo) and as the real command.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { demoPassword, notLoopback, startDemo, type Demo } from '../src/demo.ts';
import { runCli } from './cli-run.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');

// The tests below count the demo folders in the temporary directory, so they get one of their own: other test files run
// the demo at the same time, and their folders would show up as leftovers. Child processes started here inherit it.
const sandbox = mkdtempSync(join(tmpdir(), 'tabularius-demo-sandbox-'));
process.env.TMPDIR = sandbox;
const stubPath = join(sandbox, 'bin');
const commandMarker = join(sandbox, 'unexpected-command');
mkdirSync(stubPath);
for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
  writeFileSync(join(stubPath, name), '#!/bin/sh\nprintf x >> "$TABULARIUS_TEST_COMMAND_MARKER"\nexit 99\n', { mode: 0o755 });
}
process.env.PATH = stubPath;
process.env.TABULARIUS_TEST_COMMAND_MARKER = commandMarker;
after(() => {
  try {
    assert.equal(existsSync(commandMarker), false, 'a service, upgrade, install or network command was run');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

async function signIn(demo: Demo, password: string): Promise<number> {
  const r = await fetch(`${demo.url}/fmi/data/vLatest/databases/${demo.database}/sessions`, {
    method: 'POST', headers: { authorization: 'Basic ' + btoa(`${demo.account}:${password}`), 'content-type': 'application/json' }, body: '{}',
  });
  return r.status;
}

test('it serves the starter on this computer, and only the printed password signs in', async () => {
  const lines: string[] = [];
  const demo = await startDemo({ starter: 'tasks', log: (l) => lines.push(l) });
  try {
    assert.match(demo.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(demo.database, 'Tasks');
    assert.equal(demo.account, 'Admin');
    assert.equal((await fetch(demo.app)).status, 200);
    assert.equal(await signIn(demo, demo.password), 200);
    assert.notEqual(await signIn(demo, demo.password + 'x'), 200);
    assert.notEqual(await signIn(demo, ''), 200, 'a blank password does not sign in');
    // The sample records are there for the first screen.
    const token = ((await (await fetch(`${demo.url}/fmi/data/vLatest/databases/Tasks/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`Admin:${demo.password}`), 'content-type': 'application/json' }, body: '{}' })).json()) as { response: { token: string } }).response.token;
    const layouts = (await (await fetch(`${demo.url}/fmi/data/vLatest/databases/Tasks/layouts`, { headers: { authorization: `Bearer ${token}` } })).json()) as { response: { layouts: { name: string }[] } };
    const first = layouts.response.layouts.find((l) => !('folderLayoutNames' in l))!;
    const records = (await (await fetch(`${demo.url}/fmi/data/vLatest/databases/Tasks/layouts/${encodeURIComponent(first.name)}/records?_limit=5`, { headers: { authorization: `Bearer ${token}` } })).json()) as { response: { data: unknown[] } };
    assert.ok(records.response.data.length > 0, 'sample records');
    assert.ok(lines.every((l) => !l.includes(demo.password)), 'the password is not in what the server says');
  } finally {
    await demo.stop();
  }
});

test('the password is twenty characters of letters and digits, different every time, and not made of anything guessable', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const p = demoPassword();
    assert.match(p, /^([a-hjkmnp-z2-9]{4}-){4}[a-hjkmnp-z2-9]{4}$/);
    seen.add(p);
  }
  assert.equal(seen.size, 2000);
  // Every character of the alphabet turns up, in every position: nothing is fixed or favoured.
  const counts = new Map<string, number>();
  for (let i = 0; i < 20000; i++) for (const c of demoPassword().replace(/-/g, '')) counts.set(c, (counts.get(c) ?? 0) + 1);
  assert.equal(counts.size, 31);
  const mean = (20000 * 20) / 31;
  for (const n of counts.values()) assert.ok(n > mean * 0.9 && n < mean * 1.1, `a character appears ${n} times, expected about ${Math.round(mean)}`);
});

test('stopping deletes the files; --keep leaves them, and will not use a folder that has anything in it', async () => {
  const gone = await startDemo({});
  const folder = gone.folder;
  assert.ok(existsSync(join(folder, 'CRM.openhbam.sqlite')));
  await gone.stop();
  await gone.stop();
  assert.equal(existsSync(folder), false, 'the temporary folder is deleted');

  const base = mkdtempSync(join(tmpdir(), 'tabularius-demo-test-'));
  try {
    const keep = join(base, 'kept');
    const kept = await startDemo({ keep, starter: 'booking' });
    assert.equal(kept.kept, true);
    await kept.stop();
    assert.ok(existsSync(join(keep, 'Booking.openhbam.sqlite')), 'the files stay');

    // Not empty: refused, and not one file of it touched.
    writeFileSync(join(keep, 'mine.txt'), 'mine');
    await assert.rejects(startDemo({ keep }), /is not empty, and demo will not put its files among yours/);
    assert.equal(readFileSync(join(keep, 'mine.txt'), 'utf8'), 'mine');

    const empty = join(base, 'empty');
    mkdirSync(empty);
    const again = await startDemo({ keep: empty });
    await again.stop();
    assert.ok(readdirSync(empty).includes('CRM.openhbam.sqlite'));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a start that fails leaves nothing behind', async () => {
  const taken = createServer();
  await new Promise<void>((done) => taken.listen(0, '127.0.0.1', done));
  const port = (taken.address() as { port: number }).port;
  const before = readdirSync(tmpdir()).filter((f) => f.startsWith('tabularius-demo-'));
  try {
    await assert.rejects(startDemo({ port }), /EADDRINUSE|in use|already/i);
    assert.deepEqual(readdirSync(tmpdir()).filter((f) => f.startsWith('tabularius-demo-')), before, 'the temporary folder is gone');

    const base = mkdtempSync(join(tmpdir(), 'tabularius-demo-test-'));
    try {
      const keep = join(base, 'kept');
      await assert.rejects(startDemo({ port, keep }));
      assert.equal(existsSync(keep), false, 'a --keep folder this run made is removed again');
      mkdirSync(keep);
      await assert.rejects(startDemo({ port, keep }));
      assert.deepEqual(readdirSync(keep), [], 'a --keep folder that was there is left empty');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  } finally {
    taken.close();
  }
});

test('it will not listen anywhere but this computer', async () => {
  for (const host of ['0.0.0.0', '::', '192.168.1.20', '10.0.0.5', 'example.com', '127.0.0.1.evil.example', '0', '', '[::1', '::1]']) {
    assert.match(notLoopback(host) ?? '', /only listens on this computer/, `"${host}"`);
  }
  for (const host of ['127.0.0.1', 'localhost', 'LOCALHOST', '::1', '[::1]', '127.1.2.3']) assert.equal(notLoopback(host), undefined, host);
  const before = readdirSync(tmpdir()).filter((f) => f.startsWith('tabularius-demo-'));
  await assert.rejects(startDemo({ host: '0.0.0.0' }), /only listens on this computer/);
  assert.deepEqual(readdirSync(tmpdir()).filter((f) => f.startsWith('tabularius-demo-')), before, 'refused before anything was made');
});

test('a bracketed IPv6 loopback host serves a usable bracketed URL', async (t) => {
  const probe = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(0, '::1', resolve);
    });
  } catch (error) {
    t.skip(`IPv6 loopback is unavailable: ${(error as Error).message}`);
    return;
  } finally {
    if (probe.listening) await new Promise<void>((resolve) => probe.close(() => resolve()));
  }

  const demo = await startDemo({ host: '[::1]', port: 0 });
  try {
    assert.match(demo.url, /^http:\/\/\[::1\]:\d+$/);
    assert.equal(demo.app, `${demo.url}/app/`);
    assert.equal((await fetch(demo.app)).status, 200);
  } finally {
    await demo.stop();
  }
});

test('the command refuses a public host, an unknown starter and stray arguments, with a sentence and no leftover', async () => {
  const before = readdirSync(tmpdir()).filter((f) => f.startsWith('tabularius-demo-'));
  const run = (...args: string[]) => runCli(main, ['demo', '--no-open', ...args], { timeout: 30_000 });
  const pub = await run('--host', '0.0.0.0');
  assert.equal(pub.status, 1);
  assert.match(pub.stderr, /demo: it only listens on this computer, so --host takes 127\.0\.0\.1, localhost or ::1, not "0\.0\.0\.0"/);
  const bad = await run('--starter', 'shop');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /demo: --starter takes one of crm, inventory, invoicing, tasks, booking \(not "shop"\)/);
  const port = await run('--port', 'abc');
  assert.match(port.stderr, /demo: --port takes a port number, not "abc"/);
  const folder = await run('somewhere');
  assert.match(folder.stderr, /demo: takes no folder or file \(found somewhere\); it makes its own/);
  assert.deepEqual(readdirSync(tmpdir()).filter((f) => f.startsWith('tabularius-demo-')), before);
  for (const r of [pub, bad, port, folder]) assert.doesNotMatch(r.stderr, / at .*\.ts:\d+/, 'no stack trace');
});

test('the real command prints the address and the password once, answers, and deletes the files on Ctrl-C and on SIGTERM', async () => {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const child = spawn(process.execPath, ['--no-warnings', main, 'demo', '--no-open', '--starter', 'inventory'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (c: string) => { out += c; });
    child.stderr.setEncoding('utf8').on('data', (c: string) => { err += c; });
    const exited = new Promise<number | null>((done) => child.on('close', done));
    const started = Date.now();
    while (!/Password\s+\S+/.test(out) && Date.now() - started < 30_000) await new Promise((r) => setTimeout(r, 100));
    try {
      const password = /Password\s+(\S+)/.exec(out)?.[1];
      const url = /Open\s+(http:\/\/127\.0\.0\.1:\d+)\/app\//.exec(out)?.[1];
      assert.ok(password && url, `output was:\n${out}\n${err}`);
      assert.equal(out.split(password).length - 1, 1, 'the password appears once');
      assert.equal(err.includes(password), false);
      assert.match(out, /Sign in\s+Admin/);
      const ok = await fetch(`${url}/fmi/data/vLatest/databases/Inventory/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`Admin:${password}`), 'content-type': 'application/json' }, body: '{}' });
      assert.equal(ok.status, 200);
      const folder = readdirSync(tmpdir()).filter((f) => f.startsWith('tabularius-demo-')).find((f) => existsSync(join(tmpdir(), f, 'Inventory.openhbam.sqlite')));
      assert.ok(folder, 'the demo folder exists while it runs');
      child.kill(signal);
      assert.equal(await exited, 0, `exit after ${signal}`);
      assert.equal(existsSync(join(tmpdir(), folder!)), false, `the folder is gone after ${signal}`);
      assert.equal(out.split(password).length - 1, 1, 'still once, after stopping');
    } finally {
      child.kill('SIGKILL');
    }
  }
});

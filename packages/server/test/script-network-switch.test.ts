import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { offlineScriptOptions, runScript } from '../../scripts/src/index.ts';
import { serve } from '../src/index.ts';
import { itemNetwork } from '../src/item-network.ts';

const admin = { 'x-tabularius-admin': '1', 'content-type': 'application/json' };

test('a file starts with script network access off; the console turns it on and off, and the file keeps it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'script-network-'));
  const answers = createServer((_req, res) => res.end('hi'));
  await new Promise<void>((r) => answers.listen(0, '127.0.0.1', r));
  const target = `http://127.0.0.1:${(answers.address() as { port: number }).port}/`;
  const path = join(dir, 'Shop.openhbam.sqlite');
  createStore(path);
  const hosted = await serve({ dir, port: 0, log: () => {}, scriptNetworkAllow: ['127.0.0.1'] });
  try {
    const { host } = hosted;
    const store = host.get('Shop')!;
    store.applyDesign([{ op: 'createScript', name: 'Fetch', text: `Set Error Capture [ On ]\nInsert from URL [ $r ; "${target}" ]\nExit Script [ Get ( LastError ) & "|" & $r ]` }]);
    const fetchIt = (options = host.scriptOptions('Shop')) => runScript(store, 'Fetch', { ...options, trace: true });
    const status = async (body?: unknown) => {
      const r = await fetch(`${hosted.url}/tabularius/admin/v1/script-network/Shop`, body === undefined ? {} : { method: 'POST', headers: admin, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    };

    // Off to begin with: error 3, and the message and the server log say how to turn it on.
    assert.equal(store.scriptNetwork, false);
    assert.deepEqual((await status()).body, { on: false, serverWide: false });
    const refused = await fetchIt();
    assert.equal(refused.result, '3|');
    assert.match(JSON.stringify(refused.trace), /Turn it on in the admin console \(Files, \\"Script network\\", Turn on\), or start the server with --allow-script-network/);
    await host.logs!.flush();
    const logged = (await host.logs!.read('ScriptEvent')).entries.map((e) => e.message);
    assert.ok(logged.some((m) => m.includes('refused network access') && m.includes('--allow-script-network')), logged.join('\n'));

    // The console switch: bad requests change nothing, a good one turns it on for this file.
    for (const invalid of [{ on: 'true' }, null, [], {}]) assert.equal((await status(invalid)).status, 400);
    assert.equal(store.scriptNetwork, false);
    assert.equal((await fetch(`${hosted.url}/tabularius/admin/v1/script-network/Nope`)).status, 404);
    assert.deepEqual((await status({ on: true })).body, { on: true, serverWide: false });
    assert.equal(host.scriptOptions('Shop').network, true);
    assert.equal(host.scriptOptions().network, false, 'a run with no file in mind is not allowed by one file\'s switch');
    assert.equal((await fetchIt()).result, '0|hi');

    // It is kept in the file, and the security log says who changed what.
    assert.equal(new Store(path, 'Shop').scriptNetwork, true);
    assert.ok(store.securityEvents({ kind: 'script-network-on' }).length === 1);

    // What an AI app, a debug run or a dry run does stays offline whatever the switch says, and says so.
    const offline = await fetchIt(offlineScriptOptions({ ...host.scriptOptions('Shop') }) as ReturnType<typeof host.scriptOptions>);
    assert.equal(offline.result, '3|');
    assert.match(JSON.stringify(offline.trace), /Network access is off: scripts an AI app runs, and debug and dry runs, never reach the network/);

    // Turned off again.
    assert.deepEqual((await status({ on: false })).body, { on: false, serverWide: false });
    assert.equal((await fetchIt()).result, '3|');
    assert.equal(store.securityEvents({ kind: 'script-network-off' }).length, 1);
  } finally {
    await new Promise<void>((r) => hosted.server.close(() => r()));
    await new Promise<void>((r) => answers.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a script cannot borrow the network of a file whose access is off, and the server flag allows every file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'script-network-files-'));
  createStore(join(dir, 'Open.openhbam.sqlite'));
  createStore(join(dir, 'Closed.openhbam.sqlite'));
  const hosted = await serve({ dir, port: 0, log: () => {} });
  try {
    const { host } = hosted;
    host.get('Open')!.setScriptNetwork(true);
    const opts = host.scriptOptions('Open');
    assert.equal(opts.network, true);
    assert.equal(opts.networkFiles('Open'), true);
    assert.equal(opts.networkFiles('Closed'), false);
    assert.match(opts.networkOff('Closed'), /"Closed"/);
    // The server-wide flag (--allow-script-network) allows every file.
    host.scriptNetwork = true;
    assert.equal(host.scriptOptions('Closed').network, true);
    assert.equal(host.scriptOptions('Closed').networkFiles('Closed'), true);
  } finally {
    await new Promise<void>((r) => hosted.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('schedules, automations and hooks need both the file\'s switch and their own network option', () => {
  const on = { network: true, networkFiles: () => true, networkOff: () => 'off' } as unknown as Parameters<typeof itemNetwork>[0];
  const off = { ...on, network: false } as Parameters<typeof itemNetwork>[0];
  assert.equal(itemNetwork(on, true, 'schedule').network, true);
  assert.equal(itemNetwork(on, undefined, 'schedule').network, false);
  assert.equal(itemNetwork(off, true, 'schedule').network, false);
  assert.match(itemNetwork(on, false, 'automation').networkOff!('Shop'), /this automation: its network option is off\. Turn them on in the admin console/);
  assert.match(itemNetwork(off, false, 'inbound hook').networkOff!('Shop'), /its file's Script network switch/);
  assert.equal(itemNetwork(on, true, 'schedule').networkOff!('Shop'), 'off');
});

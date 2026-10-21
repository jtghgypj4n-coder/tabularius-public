// A script uses a connection by name (Insert from URL with connection://name/path): the server signs the request with
// credentials the script never sees, the connection keeps it inside its bucket and folder, and a capture-only file
// never gets one. Tested against a local stand-in for S3; nothing here reaches a real service.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '../../fmp12/src/index.ts';
import { createStore, parseScriptText, Store } from '../../store/src/index.ts';
import { runScript, setCaptureOnlyDefaults, type OutboxEntry, type RunOptions } from '../../scripts/src/index.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../../scripts/src/test-only.ts';
import { Connections, scriptConnections } from '../src/index.ts';
import { fakeS3 } from './fake-s3.ts';

// The process names its capture-only files (TABULARIUS_CAPTURE_ONLY / --capture-only); here, every file that starts with Held.
setCaptureOnlyDefaults(['Held']);
const KEYS = { accessKey: 'AKIA' + 'IOSFODNN7EXAMPLE', secretKey: 'wJalr' + 'XUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let dir: string;
let s3: Awaited<ReturnType<typeof fakeS3>>;
let connections: Connections;
let stores: Record<string, Store>;
let options: RunOptions;
const captureOnlyExtra: string[] = [];

/** A stand-in web that has the one picture scripts seed their containers with. */
const web = (async (url: string | URL) => String(url) === 'https://example.com/scan.png'
  ? new Response(PNG, { headers: { 'content-type': 'image/png' } })
  : new Response('missing', { status: 404 })) as typeof fetch;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-connection-scripts-'));
  s3 = await fakeS3({ bucket: 'invoices', ...KEYS });
  connections = new Connections(dir);
  connections.create({ name: 'invoices', type: 's3', config: { bucket: 'invoices', endpoint: s3.endpoint, prefix: 'acme' } });
  connections.setSecret('invoices', 'accessKey', KEYS.accessKey);
  connections.setSecret('invoices', 'secretKey', KEYS.secretKey);
  connections.approve('invoices');
  stores = {};
  for (const name of ['Shop', 'Orders', 'Held_Sample']) {
    createStore(join(dir, `${name}.sqlite`));
    const s = new Store(join(dir, `${name}.sqlite`), name);
    s.applyDesign([{ op: 'createTable', name: 'Files', fields: [{ name: 'Scan', type: 'container' }, { name: 'Note', type: 'text' }] }] as never);
    s.create('Files', { Note: '' });
    stores[name] = s;
  }
  options = { [TEST_ONLY_CUSTOM_FETCH]: true, network: web, connections: scriptConnections(connections, { captureOnly: () => captureOnlyExtra }) };
});
after(async () => {
  for (const s of Object.values(stores ?? {})) s.close();
  await s3?.close();
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

/** Runs a script; `curl` gives each Insert from URL step's cURL options, in order (a calculation, as in the step's dialog). */
const run = (name: string, text: string, opts: RunOptions = {}, curl: (string | undefined)[] = []) => {
  const steps = parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), stores[name].schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params }));
  steps.filter((x) => x.stepId === 160).forEach((x, i) => {
    if (curl[i] !== undefined) x.params = { ...x.params, slots: { 129: JSON.stringify(curl[i]) } } as never;
  });
  return runScript(stores[name], { id: 9999, name: 'test', steps } as Script, { layout: 'Files', foundSet: stores[name].findIds('Files'), trace: true, ...options, ...opts });
};
const failure = (r: Awaited<ReturnType<typeof run>>) => r.trace?.find((t) => t.message)?.message ?? JSON.stringify(r).slice(0, 600);

test('a container is stored in S3, fetched back into a container field, listed and deleted, all without the script holding a key', async () => {
  const put = await run('Shop', `
    Insert from URL [ $scan ; "https://example.com/scan.png" ]
    Insert from URL [ $r ; "connection://invoices/2026/scan.png" ]
    Exit Script [ Text Result: Get ( LastError ) ]
  `, {}, [undefined, '-X PUT --data-binary @$scan']);
  assert.equal(put.error, 0, failure(put));
  assert.equal(put.result, '0');
  const stored = s3.objects.get('acme/2026/scan.png');
  assert.ok(stored, [...s3.objects.keys()].join());
  assert.deepEqual(stored.body, PNG);
  assert.equal(stored.type, 'image/png');
  assert.equal(s3.seen.rejected, 0);

  const got = await run('Shop', `
    Insert from URL [ Files::Scan ; "connection://invoices/2026/scan.png" ]
    Commit Records/Requests [ With dialog: Off ]
    Exit Script [ Text Result: GetContainerAttribute ( Files::Scan ; "filename" ) & "|" & Substitute ( Base64Encode ( Files::Scan ) ; ¶ ; "" ) ]
  `);
  assert.equal(got.error, 0, failure(got));
  assert.equal(got.result, `scan.png|${PNG.toString('base64')}`);

  // The listing names objects as the script knows them, inside the connection's folder.
  s3.objects.set('acme/2026/b.txt', { body: Buffer.from('b') });
  s3.objects.set('acme/2027/c.txt', { body: Buffer.from('c') });
  s3.objects.set('other/data.txt', { body: Buffer.from('not for scripts') });
  const list = await run('Shop', `
    Insert from URL [ $list ; "connection://invoices/?prefix=2026/" ]
    Exit Script [ Text Result: $list ]
  `);
  assert.equal(list.error, 0, failure(list));
  assert.match(list.result, /<Key>2026\/scan\.png<\/Key>/);
  assert.match(list.result, /<Key>2026\/b\.txt<\/Key>/);
  assert.ok(!/2027|secret|acme\//.test(list.result), list.result);
  assert.equal(s3.requests.at(-1)!.query.includes('prefix=acme%2F2026%2F'), true, s3.requests.at(-1)!.query);
  const all = await run('Shop', `
    Insert from URL [ $list ; "connection://invoices/" ]
    Exit Script [ Text Result: $list ]
  `);
  assert.ok(!/secret|acme\//.test(all.result) && /<Key>2027\/c\.txt<\/Key>/.test(all.result), all.result);

  const del = await run('Shop', `
    Insert from URL [ $r ; "connection://invoices/2026/b.txt" ]
    Exit Script [ Text Result: Get ( LastError ) ]
  `, {}, ['-X DELETE']);
  assert.equal(del.result, '0');
  assert.ok(!s3.objects.has('acme/2026/b.txt'));
});

test('the script is never given a credential, in its results, its error messages or its trace', async () => {
  const r = await run('Shop', `
    Insert from URL [ $r ; "connection://invoices/2026/scan.png" ]
    Exit Script [ Text Result: $headers ]
  `, {}, ['-D $headers']);
  const everything = JSON.stringify([r.result, r.trace, r.error]);
  for (const secret of [...Object.values(KEYS), 'AWS4-HMAC', 'x-amz-content-sha256']) assert.ok(!everything.includes(secret), secret);
  const bad = await run('Shop', 'Insert from URL [ $r ; "connection://invoices/missing.txt" ]', {}, ['-f']);
  assert.equal(bad.error, 1631, failure(bad));
  assert.ok(!JSON.stringify(bad.trace).includes(KEYS.secretKey));
});

test('a script can\'t leave the connection\'s bucket and folder, or ask S3 for anything else', async () => {
  s3.requests.length = 0;
  const attempts: [string, string, RegExp][] = [
    ['connection://invoices/../other/data.txt', '', /can't contain/],
    ['connection://invoices/%2e%2e/other/data.txt', '', /can't contain/],
    ['connection://invoices/a/..%2Fb', '', /can't contain/],
    ['connection://invoices/2026/scan.png?acl', '', /isn't an option for GET/],
    ['connection://invoices/2026/scan.png', '-X PUT -d x -H "x-amz-acl: public-read"', /isn't passed through a connection/],
    ['connection://invoices/2026/copy.png', '-X PUT -H "x-amz-copy-source: /other/data.txt"', /isn't passed through a connection/],
    ['connection://invoices/2026/scan.png', '-X POST -d x', /takes GET, HEAD, PUT and DELETE/],
    ['connection://invoices/?location', '', /isn't a listing option/],
    ['connection://invoices/?prefix=../other/', '', /can't contain/],
    ['connection://invoices/', '-X DELETE', /Name an object/],
    ['connection://invoices/2026/x', '-F a=b', /not a form upload/],
    ['connection://nothere/a', '', /no connection "nothere"/],
  ];
  for (const [url, curl, why] of attempts) {
    const r = await run('Shop', `Insert from URL [ $r ; "${url}" ]`, {}, [curl || undefined]);
    // A form upload is a step that can't be done here (3); everything else the connection refuses is a network error.
    assert.equal(r.error, why.test('not a form upload') ? 3 : 1631, `${url}: ${failure(r)}`);
    assert.match(failure(r), why, url);
  }
  assert.deepEqual(s3.requests, []);
  assert.ok(s3.objects.has('other/data.txt'));
});

test('a capture-only file never gets a connection, nor does a script it calls', async () => {
  s3.requests.length = 0;
  const script = 'Insert from URL [ $r ; "connection://invoices/?prefix=" ]\nExit Script [ Text Result: $r ]';
  const r = await run('Held_Sample', script);
  assert.equal(r.error, 3);
  assert.match(failure(r), /capture-only/);
  // Run for a file that is fine, but started from the capture-only file's script.
  const viaCaller = await run('Shop', script, { callerFiles: ['Held_Sample'] });
  assert.equal(viaCaller.error, 3);
  // A file the operator named (--test-outbound captures) counts as well, in the server's own check.
  captureOnlyExtra.push('Orders');
  const named = await run('Orders', script);
  assert.equal(named.error, 1631, failure(named));
  assert.match(failure(named), /capture-only/);
  captureOnlyExtra.length = 0;
  assert.deepEqual(s3.requests, []);
  assert.equal((await run('Orders', script)).error, 0);
});

test('a connection is for the files it names, and a draft or a turned-off one does nothing', async () => {
  s3.requests.length = 0;
  const script = 'Insert from URL [ $r ; "connection://invoices/?prefix=" ]';
  connections.update('invoices', { files: ['Orders'] });
  assert.equal((await run('Orders', script)).error, 0);
  const refused = await run('Shop', script);
  assert.equal(refused.error, 1631);
  assert.match(failure(refused), /not set up for Shop/);
  // Every file the run involves must be allowed.
  assert.match(failure(await run('Orders', script, { callerFiles: ['Shop'] })), /not set up for Shop/);
  connections.update('invoices', { files: [] });
  connections.update('invoices', { enabled: false });
  assert.match(failure(await run('Shop', script)), /turned off/);
  connections.update('invoices', { enabled: true });
  assert.equal((await run('Shop', script)).error, 0);
  const requests = s3.requests.length;
  connections.create({ name: 'drafted', type: 's3', config: { bucket: 'invoices', endpoint: s3.endpoint } }, 'ai');
  assert.match(failure(await run('Shop', 'Insert from URL [ $r ; "connection://drafted/x" ]')), /not been approved at the console/);
  assert.equal(s3.requests.length, requests);
});

test('scripts that run offline (the AI\'s, schedules, debugging) have no connection', async () => {
  s3.requests.length = 0;
  const r = await run('Shop', 'Insert from URL [ $r ; "connection://invoices/?prefix=" ]', { network: false });
  assert.equal(r.error, 3);
  assert.match(failure(r), /Network access is off/);
  assert.deepEqual(s3.requests, []);
});

test('in outbound test mode a connection\'s request is recorded, and sent only to an allowed host', async () => {
  s3.requests.length = 0;
  const entries: OutboxEntry[] = [];
  const script = 'Insert from URL [ $r ; "connection://invoices/2026/scan.png" ]\nExit Script [ Text Result: $r ]';
  const blocked = await run('Shop', script, { network: false, outbound: { allowHosts: ['example.com'], record: (e) => entries.push(e), fetch: web } });
  assert.equal(blocked.error, 0, failure(blocked));
  assert.equal(blocked.result, '');
  assert.deepEqual(s3.requests, []);
  assert.equal(entries.length, 1);
  assert.deepEqual([entries[0].kind, (entries[0] as { allowed: boolean }).allowed, (entries[0] as { host: string }).host], ['http', false, '127.0.0.1']);
  assert.match((entries[0] as { url: string }).url, /^connection:\/\/127\.0\.0\.1\/2026\/scan\.png/);
  assert.match((entries[0] as { via: string }).via, /connection invoices/);

  entries.length = 0;
  const sent = await run('Shop', 'Insert from URL [ $r ; "connection://invoices/2026/scan.png" ]', { network: false, outbound: { allowHosts: ['127.0.0.1'], record: (e) => entries.push(e), fetch: web } });
  assert.equal(sent.error, 0, failure(sent));
  assert.equal(s3.requests.length, 1);
  assert.equal((entries[0] as { allowed: boolean; status: number }).allowed, true);
  assert.equal((entries[0] as { status: number }).status, 200);

  // A capture-only file's request is recorded and never sent, even to an allowed host.
  s3.requests.length = 0;
  entries.length = 0;
  await run('Held_Sample', 'Insert from URL [ $r ; "connection://invoices/2026/scan.png" ]', { network: false, outbound: { allowHosts: ['127.0.0.1'], record: (e) => entries.push(e), fetch: web } });
  assert.deepEqual(s3.requests, []);
  assert.equal((entries[0] as { allowed: boolean }).allowed, false);
});

test('Insert from URL sends a container as it is with --data-binary, to any address', async () => {
  const sent: { url: string; type?: string; body?: Uint8Array }[] = [];
  const network = (async (url: string | URL, init?: RequestInit) => {
    if (String(url) === 'https://example.com/scan.png') return new Response(PNG, { headers: { 'content-type': 'image/png' } });
    sent.push({ url: String(url), type: new Headers(init?.headers).get('content-type') ?? undefined, body: init?.body as Uint8Array });
    return new Response('ok');
  }) as typeof fetch;
  const r = await run('Shop', `
    Insert from URL [ $scan ; "https://example.com/scan.png" ]
    Insert from URL [ $r ; "https://upload.example.com/in" ]
  `, { network, connections: undefined }, [undefined, '-X PUT --data-binary @$scan']);
  assert.equal(r.error, 0, failure(r));
  assert.equal(sent.length, 1);
  assert.deepEqual(Buffer.from(sent[0].body!), PNG);
  assert.equal(sent[0].type, 'image/png');
});

test('an error from the service reaches the script as its code and message only, never the key it echoes', async () => {
  const wrong = connections.create({ name: 'wrongkeys', type: 's3', config: { bucket: 'invoices', endpoint: s3.endpoint } });
  connections.setSecret('wrongkeys', 'accessKey', KEYS.accessKey);
  connections.setSecret('wrongkeys', 'secretKey', 'not+the+right+secret');
  connections.setSecret('wrongkeys', 'sessionToken', 'SESSION-TOKEN-VALUE');
  connections.approve('wrongkeys');
  try {
    const r = await run('Shop', `
      Insert from URL [ $r ; "connection://wrongkeys/x.pdf" ]
      Exit Script [ Text Result: $r ]
    `);
    assert.equal(r.error, 0, failure(r));
    assert.match(String(r.result), /SignatureDoesNotMatch/);
    for (const secret of [KEYS.accessKey, 'SESSION-TOKEN-VALUE', 'StringToSign', 'CanonicalRequest', 'SignatureProvided']) assert.ok(!String(r.result).includes(secret), `${secret} reached the script: ${r.result}`);
    assert.ok(!JSON.stringify(r).includes('SESSION-TOKEN-VALUE'));
  } finally {
    connections.remove(wrong.id);
  }
});

test('a header with characters S3 would read differently is refused, not signed and sent', async () => {
  s3.requests.length = 0;
  const r = await run('Shop', `
    Insert from URL [ $r ; "connection://invoices/2026/scan.png" ]
    Exit Script [ Text Result: Get ( LastError ) ]
  `, {}, ['-X PUT -d x -H "x-amz-meta-a: a b"']);
  assert.notEqual(r.result, '0');
  assert.deepEqual(s3.requests, []);
});

test('a service that redirects is not followed, so the signed headers go nowhere else', async () => {
  const { createServer } = await import('node:http');
  let reached = 0;
  const other = createServer((_req, res) => { reached++; res.end('secret-internal-data'); });
  await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
  const to = `http://127.0.0.1:${(other.address() as { port: number }).port}/latest/meta-data/`;
  const bounce = createServer((_req, res) => res.writeHead(307, { location: to }).end());
  await new Promise<void>((r) => bounce.listen(0, '127.0.0.1', r));
  const c = connections.create({ name: 'bouncy', type: 's3', config: { bucket: 'invoices', endpoint: `http://127.0.0.1:${(bounce.address() as { port: number }).port}` } });
  connections.setSecret('bouncy', 'accessKey', KEYS.accessKey);
  connections.setSecret('bouncy', 'secretKey', KEYS.secretKey);
  connections.setSecret('bouncy', 'sessionToken', 'SESSION-TOKEN-VALUE');
  connections.approve('bouncy');
  try {
    const r = await run('Shop', `
      Insert from URL [ $r ; "connection://bouncy/x.pdf" ]
      Exit Script [ Text Result: $r ]
    `);
    assert.ok(!String(r.result).includes('secret-internal-data'), String(r.result));
    assert.equal(reached, 0);
  } finally {
    connections.remove(c.id);
    bounce.close();
    other.close();
  }
});

test('a request whose time limit has run out is not sent at all', async () => {
  const gate = scriptConnections(connections);
  const stop = new AbortController();
  stop.abort();
  s3.requests.length = 0;
  await assert.rejects(gate.request('invoices', { method: 'PUT', path: '/late.txt', query: '', headers: {}, body: Buffer.from('late'), signal: stop.signal }, []));
  assert.deepEqual(s3.requests, []);
});

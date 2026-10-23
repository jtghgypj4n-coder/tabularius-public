// Real feature entry points, generated stores and loopback only. No child processes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { NAME_LOOKUP } from '../../scripts/src/net-guard.ts';
import { runScript } from '../../scripts/src/engine.ts';
import { generatedStore, script } from '../../scripts/test/outbound-engine-helpers.ts';
import { createStore } from '../../store/src/index.ts';
import { embedRequest } from '../src/embed-endpoint.ts';
import { Assistant } from '../src/assistant.ts';
import type { Host } from '../src/host.ts';
import type { DataApi } from '../src/dataapi.ts';
import { S3 } from '../src/s3.ts';
import { serve } from '../src/index.ts';
import { listen, stubCommands } from './edge-test-helpers.ts';

for (const feature of ['embedding', 'S3'] as const) test(`${feature} resolves again after a successful request and refuses metadata`, async t => {
  let lookups = 0, hits = 0;
  const port = await listen(t, createServer((req, res) => {
    hits++;
    req.resume(); req.once('end', () => res.end('{}'));
  }));
  t.mock.method(NAME_LOOKUP, 'lookup', async () => [{ address: ++lookups === 1 ? '127.0.0.1' : '169.254.169.254', family: 4 }]);
  const endpoint = `http://features.invalid:${port}`;
  const s3 = new S3({ url: 's3://generated', endpoint, accessKey: 'synthetic', secretKey: 'synthetic' });
  const call = feature === 'S3' ? () => s3.raw('GET', 'key')
    : () => embedRequest({ url: endpoint, model: 'generated', key: 'synthetic' }, ['generated'], AbortSignal.timeout(3000));
  assert.equal(await (await call()).text(), '{}');
  await assert.rejects(call(), /link-local/);
  assert.equal(hits, 1);
  assert.equal(lookups, 2);
});

test('AI provider model probe refuses a metadata DNS answer', async t => {
  let lookups = 0, hits = 0;
  const port = await listen(t, createServer((_req, res) => { hits++; res.end('{}'); }));
  t.mock.method(NAME_LOOKUP, 'lookup', async () => { lookups++; return [{ address: '169.254.169.254', family: 4 }]; });
  const assistant = new Assistant({} as Host, {} as DataApi, { apiKey: 'synthetic', baseUrl: `http://ai.invalid:${port}` });
  const until = performance.now() + 3000;
  while (assistant.state.state === 'checking' && performance.now() < until) await sleep(5);
  assert.equal(assistant.state.state, 'unreachable');
  assert.equal(lookups, 1);
  assert.equal(hits, 0);
});

test('OIDC discovery rechecks DNS on a same-origin redirect', async t => {
  stubCommands(t);
  let lookups = 0, hits = 0;
  const port = await listen(t, createServer((_req, res) => {
    hits++; res.writeHead(302, { location: '/changed-discovery' }).end();
  }));
  t.mock.method(NAME_LOOKUP, 'lookup', async () => [{ address: ++lookups === 1 ? '127.0.0.1' : '169.254.169.254', family: 4 }]);
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-r26-oidc-'));
  const app = await serve({ dir, port: 0, hostname: '127.0.0.1', watch: false, checkFiles: false, statsInterval: 0, log: () => {},
    oidc: { name: 'Generated', issuer: `http://oidc.invalid:${port}`, clientId: 'synthetic' } });
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise<void>(resolve => app.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });
  const errors: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { errors.push(args); });
  const res = await fetch(`${app.url}/tabularius/auth/v1/oidc/start/generated?db=Generated`, { redirect: 'manual' });
  await res.arrayBuffer();
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location')!, /^\/app\/#error=/);
  assert.equal(lookups, 2);
  assert.equal(hits, 1);
  assert.ok(errors.some(args => String(args[0]).includes('link-local')));
});

test('calendar URL/ATTACH properties and URL query inputs are data, never server-side fetches', async t => {
  stubCommands(t);
  let hits = 0;
  const trap = await listen(t, createServer((_req, res) => { hits++; res.end('unexpected'); }));
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-r26-calendar-'));
  createStore(join(dir, 'Generated.openhbam.sqlite'));
  const app = await serve({ dir, port: 0, hostname: '127.0.0.1', watch: false, checkFiles: false, statsInterval: 0, log: () => {} });
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise<void>(resolve => app.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });
  const store = app.host.get('Generated')!;
  store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Title', type: 'text' }, { name: 'Day', type: 'date' }] }]);
  const token = store.createApiToken('Admin');
  const target = `http://127.0.0.1:${trap}/source.ics`;
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:synthetic', 'DTSTART;VALUE=DATE:20261018', 'SUMMARY:Generated',
    `URL:${target}`, `ATTACH;VALUE=URI:${target}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  const res = await fetch(`${app.url}/tabularius/calendar/v1/databases/Generated/layouts/Events/calendar-import?start=Day&title=Title&url=${encodeURIComponent(target)}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'text/calendar' }, body,
  });
  const result = await res.json() as { imported: number };
  assert.equal(res.status, 200, JSON.stringify(result));
  assert.equal(result.imported, 1);
  assert.equal(hits, 0);
});

test('Import Records URL source is refused as an absent local document without outbound traffic', async t => {
  let hits = 0;
  const port = await listen(t, createServer((_req, res) => { hits++; res.end('Title\nInjected'); }));
  const store = generatedStore(t, 'Imports');
  store.applyDesign([{ op: 'createTable', name: 'Records', fields: [{ name: 'Title', type: 'text' }] }]);
  const result = await runScript(store, { id: 1, name: 'Generated import', steps: [{ stepId: 35, name: 'Import Records', enabled: true,
    params: { filePaths: [`http://127.0.0.1:${port}/absent.csv`], importFormat: 'CSV' } }] },
  { layout: 'Records', documents: dirname(store.path), network: true, networkAllow: ['127.0.0.1'] });
  assert.equal(result.error, 100);
  assert.equal(store.find('Records', {}).foundCount, 0);
  assert.equal(hits, 0);
});

for (const mode of ['forbidden', 'malformed', 'over budget']) test(`MBS CURL closes a ${mode} redirect's unread body`, async t => {
  let hits = 0, closed = 0;
  const port = await listen(t, createServer((_req, res) => {
    hits++;
    res.writeHead(302, { location: mode === 'malformed' ? 'http://[' : mode === 'over budget' ? '/again' : 'http://169.254.169.254/latest/meta-data/' });
    res.write('held');
    res.once('close', () => closed++);
  }));
  t.mock.method(NAME_LOOKUP, 'lookup', async () => [{ address: '127.0.0.1', family: 4 }]);
  const store = generatedStore(t, 'CurlRedirect');
  const probe = script(store, [
    'Set Variable [ $h ; Value: MBS("CURL.New") ]',
    `Set Variable [ $r ; Value: MBS("CURL.SetOptionURL"; $h; "http://curl.invalid:${port}/") ]`,
    'Set Variable [ $r ; Value: MBS("CURL.SetOptionFollowLocation"; $h; 1) ]',
    ...(mode === 'over budget' ? ['Set Variable [ $r ; Value: MBS("CURL.SetOptionMaxRedirs"; $h; 0) ]'] : []),
    'Exit Script [ Text Result: MBS("CURL.Perform"; $h) ]',
  ].join('\n'));
  const result = await runScript(store, probe, { network: true, networkAllow: ['curl.invalid'] });
  if (mode === 'over budget') assert.equal(result.result, '47');
  else assert.match(result.result ?? '', /ERROR:/);
  const until = performance.now() + 3000;
  while (!closed && performance.now() < until) await sleep(5);
  assert.equal(hits, 1);
  assert.equal(closed, 1, 'refusing a redirect must release its response/socket without waiting for the request deadline');
});

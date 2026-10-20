import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript, type RunOptions } from '../src/index.ts';
import { NAME_LOOKUP } from '../src/net-guard.ts';
import { redactCredentialStep } from '../src/redaction.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../src/test-only.ts';

let server: Server;
let base: string;
let dir: string;
let store: Store;
const seen: { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string }[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mbs-curl-'));
  createStore(join(dir, 'A.sqlite'));
  store = new Store(join(dir, 'A.sqlite'), 'A');
  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/final' }); res.end(); return; }
    res.writeHead(req.url === '/missing' ? 404 : 200, { 'Content-Type': 'text/plain', 'X-Answer': 'yes' });
    res.end(req.url === '/final' ? 'final' : 'reply\nline');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  store?.close();
  rmSync(dir, { recursive: true, force: true });
});

function run(lines: string[], opts: RunOptions = { network: fetch }) {
  const steps = parseScriptText(lines.join('\n'), store.schema).map((s, i) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params, line: lines[i] }));
  return runScript(store, { id: 88001, name: 'MBS CURL test', steps } as Script, { ...opts, [TEST_ONLY_CUSTOM_FETCH]: true });
}
const set = (name: string, ...args: string[]) => `Set Variable [ $r ; Value: MBS("CURL.${name}"; $h${args.map((a) => `; ${JSON.stringify(a)}`).join('')}) ]`;

test('CURL.SetupAWS hides literal and variable signing credentials in traces and profiles', async () => {
  const marker = 'K7m2Q8v5SyntheticValue';
  const lines = [
    `Set Variable [ $input ; Value: "${marker}" ]`,
    'Set Variable [ $h ; Value: MBS("CURL.New") ]',
    'Set Variable [ $r ; Value: MBS("CURL.SetupAWS"; $h; "AKIDEXAMPLE"; $input; "us-east-1"; "s3"; "/"; "s3.example.invalid"; "GET") ]',
    `Set Variable [ $r ; Value: MBS("CURL.SetupAWS"; $h; "AKIDEXAMPLE"; "${marker}"; "us-east-1"; "s3"; "/"; "s3.example.invalid"; "GET") ]`,
  ];
  const profiled: string[] = [];
  const result = await run(lines, { trace: true, profile: { step: (_file, _script, _index, line) => { profiled.push(line); }, run: () => {} } });
  assert.equal(result.error, 0);
  assert.doesNotMatch(JSON.stringify([result.trace, profiled]), new RegExp(marker));
  assert.doesNotMatch(JSON.stringify([result.trace, profiled]), /AKIDEXAMPLE/);
  assert.doesNotMatch(redactCredentialStep(lines[3]), new RegExp(marker));
});

test('CURL.SetOptionPassword hides an innocently named input assignment in traces and profiles', async () => {
  const marker = 'T4n6L2z8SyntheticValue';
  const lines = [
    `Set Variable [ $input ; Value: "${marker}" ]`,
    'Set Variable [ $h ; Value: MBS("CURL.New") ]',
    'Set Variable [ $r ; Value: MBS("CURL.SetOptionPassword"; $h; $input) ]',
  ];
  const profiled: string[] = [];
  const result = await run(lines, { trace: true, profile: { step: (_file, _script, _index, line) => { profiled.push(line); }, run: () => {} } });
  assert.equal(result.error, 0);
  assert.doesNotMatch(JSON.stringify([result.trace, profiled]), new RegExp(marker));
});

test('GET, response code, headers, undocumented debug format and release', async () => {
  seen.length = 0;
  const r = await run([
    'Set Variable [ $h ; Value: MBS("CURL.New") ]', set('SetOptionURL', `${base}/get`),
    'Set Variable [ $p ; Value: MBS("CURL.Perform"; $h) ]',
    'Exit Script [ Text Result: $h & "|" & $p & "|" & MBS("CURL.GetResponseCode"; $h) & "|" & MBS("CURL.GetResultAsText"; $h) & "|" & MBS("CURL.GetHeaderAsText"; $h) & "|" & MBS("CURL.GetDebugMessages"; $h) & "|" & MBS("CURL.Release"; $h) ]',
  ]);
  assert.equal(r.error, 0);
  assert.match(r.result ?? '', /^16000\|0\|200\|reply\rline\|HTTP\/1\.1 200/);
  assert.match(r.result ?? '', /x-answer: yes/i);
  assert.match(r.result ?? '', /\[MBS\] ERROR:.*debug transcript/i);
  assert.match(r.result ?? '', /\|OK$/);
  assert.equal(seen.length, 1);
});

test('a request inside one calculation replays without allocating a second handle', async () => {
  const formula = `Let ( [ h = MBS("CURL.New") ; a = MBS("CURL.SetOptionURL"; h; "${base}/get") ; p = MBS("CURL.Perform"; h) ] ; h & "|" & p )`;
  const r = await run([`Set Variable [ $first ; Value: ${formula} ]`, 'Exit Script [ Text Result: $first & "|" & MBS("CURL.New") ]']);
  assert.equal(r.result, '16000|0|16001');
});

test('POST fields and headers, custom method, and basic auth', async () => {
  seen.length = 0;
  const r = await run([
    'Set Variable [ $h ; Value: MBS("CURL.New") ]', set('SetOptionURL', `${base}/post`),
    set('SetOptionHTTPHeader', 'X-Test: value'), set('SetOptionPostFields', 'a=1'),
    set('SetOptionUserName', 'ann'), set('SetOptionPassword', 'secret'),
    'Set Variable [ $p ; Value: MBS("CURL.Perform"; $h) ]',
    set('SetOptionCustomRequest', 'PATCH'),
    'Set Variable [ $q ; Value: MBS("CURL.Perform"; $h) ]',
    'Exit Script [ Text Result: $p & "|" & $q ]',
  ]);
  assert.equal(r.result, '0|0');
  assert.deepEqual(seen.map((x) => [x.method, x.body, x.headers['x-test']]), [['POST', 'a=1', 'value'], ['PATCH', 'a=1', 'value']]);
  assert.equal(seen[0].headers.authorization, 'Basic ' + Buffer.from('ann:secret').toString('base64'));
});

test('upload text uses PUT and preserves result line endings when asked', async () => {
  seen.length = 0;
  const r = await run([
    'Set Variable [ $h ; Value: MBS("CURL.New") ]', set('SetOptionURL', `${base}/upload`),
    set('SetInputText', 'generated input'), set('SetOptionUpload', '1'), set('SetDebugWithData', '1'),
    'Set Variable [ $p ; Value: MBS("CURL.Perform"; $h) ]',
    'Exit Script [ Text Result: $p & "|" & MBS("CURL.GetResultAsText"; $h; "UTF-8"; 1) & "|" & MBS("CURL.GetDebugAsText"; $h) ]',
  ]);
  assert.equal(r.error, 0);
  assert.match(r.result ?? '', /^0\|reply\nline\|/);
  assert.match(r.result ?? '', /\[MBS\] ERROR:.*debug transcript/i);
  assert.deepEqual(seen.map((x) => [x.method, x.body]), [['PUT', 'generated input']]);
});

test('redirects are optional and max redirs returns curl code 47', async () => {
  seen.length = 0;
  const r = await run([
    'Set Variable [ $h ; Value: MBS("CURL.New") ]', set('SetOptionURL', `${base}/redirect`),
    'Set Variable [ $a ; Value: MBS("CURL.Perform"; $h) ]',
    'Set Variable [ $before ; Value: MBS("CURL.GetResponseCode"; $h) ]',
    set('SetOptionFollowLocation', '1'), set('SetOptionMaxRedirs', '0'),
    'Set Variable [ $b ; Value: MBS("CURL.Perform"; $h) ]',
    set('SetOptionMaxRedirs', '1'),
    'Set Variable [ $c ; Value: MBS("CURL.Perform"; $h) ]',
    'Exit Script [ Text Result: $a & "|" & $before & "|" & $b & "|" & $c & "|" & MBS("CURL.GetResultAsText"; $h) ]',
  ]);
  assert.equal(r.result, '0|302|47|0|final');
  assert.deepEqual(seen.map((x) => x.url), ['/redirect', '/redirect', '/redirect', '/final']);
});

test('released handle errors and live handle cap', async () => {
  const r = await run([
    'Set Variable [ $h ; Value: MBS("CURL.New") ]',
    'Set Variable [ $ok ; Value: MBS("CURL.Cleanup"; $h) ]',
    'Exit Script [ Text Result: $ok & "|" & MBS("CURL.Perform"; $h) ]',
  ]);
  assert.match(r.result ?? '', /^OK\|\[MBS\] ERROR:/);
  const many = await run([
    ...Array.from({ length: 17 }, (_, i) => `Set Variable [ $h${i} ; Value: MBS("CURL.New") ]`),
    'Exit Script [ Text Result: $h15 & "|" & $h16 ]',
  ]);
  assert.match(many.result ?? '', /^16015\|\[MBS\] ERROR:/);
  assert.equal((await run(['Exit Script [ Text Result: MBS("CURL.New") ]'])).result, '16000', 'handles end with the script run');
});

test('HTTP error response is still a successful transfer with its response code', async () => {
  const r = await run([
    'Set Variable [ $h ; Value: MBS("CURL.New") ]', set('SetOptionURL', `${base}/missing`),
    'Exit Script [ Text Result: MBS("CURL.Perform"; $h) & "|" & MBS("CURL.GetResponseCode"; $h) ]',
  ]);
  assert.equal(r.result, '0|404');
});

test('malformed and unsupported URL protocols use documented curl codes', async () => {
  const malformed = await run(['Set Variable [ $h ; Value: MBS("CURL.New") ]', set('SetOptionURL', 'not a URL'), 'Exit Script [ Text Result: MBS("CURL.Perform"; $h) ]']);
  const unsupported = await run(['Set Variable [ $h ; Value: MBS("CURL.New") ]', set('SetOptionURL', 'ftp://example.invalid/file'), 'Exit Script [ Text Result: MBS("CURL.Perform"; $h) ]']);
  assert.equal(malformed.result, '3');
  assert.equal(unsupported.result, '1');
});

test('offline Perform gives MBS error and never contacts server', async () => {
  seen.length = 0;
  const r = await run(['Set Variable [ $h ; Value: MBS("CURL.New") ]', set('SetOptionURL', `${base}/offline`), 'Exit Script [ Text Result: MBS("CURL.Perform"; $h) ]'], {});
  assert.match(r.result ?? '', /^\[MBS\] ERROR:.*(?:offline|off)/i);
  assert.equal(seen.length, 0);
});

test('link-local metadata address is refused before fetch', async () => {
  let calls = 0;
  const fake = (async () => { calls++; return new Response('should not happen'); }) as typeof fetch;
  const r = await run([
    'Set Variable [ $h ; Value: MBS("CURL.New") ]', set('SetOptionURL', 'http://169.254.169.254/latest/meta-data/'),
    'Exit Script [ Text Result: MBS("CURL.Perform"; $h) ]',
  ], { network: fake });
  assert.match(r.result ?? '', /^\[MBS\] ERROR:/);
  assert.equal(calls, 0);
});

test('CURL checks DNS answers before a live connection', async () => {
  const original = NAME_LOOKUP.lookup;
  let lookups = 0;
  NAME_LOOKUP.lookup = async () => [{ address: ++lookups === 1 ? '127.0.0.1' : '127.0.0.2' }];
  try {
    seen.length = 0;
    const r = await run([
      'Set Variable [ $h ; Value: MBS("CURL.New") ]', set('SetOptionURL', `http://rebind.invalid:${new URL(base).port}/`),
      'Exit Script [ Text Result: MBS("CURL.Perform"; $h) ]',
    ], { network: true });
    assert.match(r.result ?? '', /^\[MBS\] ERROR:/);
    assert.equal(lookups, 1);
    assert.equal(seen.length, 0);
  } finally {
    NAME_LOOKUP.lookup = original;
  }
});

test('CURL checks a redirect destination before sending the next hop', async () => {
  const sent: string[] = [];
  const fake = (async (input: string | URL | Request) => {
    sent.push(String(input));
    return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
  }) as typeof fetch;
  const r = await run([
    'Set Variable [ $h ; Value: MBS("CURL.New") ]', set('SetOptionURL', 'https://public.example.invalid/start'),
    set('SetOptionFollowLocation', '1'), 'Exit Script [ Text Result: MBS("CURL.Perform"; $h) ]',
  ], { network: fake });
  assert.match(r.result ?? '', /^\[MBS\] ERROR:.*redirect address is not allowed/);
  assert.deepEqual(sent, ['https://public.example.invalid/start']);
});

test('a redirect to another origin carries no credentials, not even custom ones', async () => {
  const sent: { url: string; headers: Record<string, string> }[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers)) });
    return sent.length === 1
      ? new Response(null, { status: 302, headers: { location: 'https://other.example.invalid/next' } })
      : new Response('done');
  }) as typeof fetch;
  const r = await run([
    'Set Variable [ $h ; Value: MBS("CURL.New") ]', set('SetOptionURL', 'https://public.example.invalid/start'),
    set('SetOptionHTTPHeader', 'X-Api-Key: secret'),
    set('SetOptionUserName', 'ann'), set('SetOptionPassword', 'pw'),
    set('SetOptionFollowLocation', '1'),
    'Set Variable [ $p ; Value: MBS("CURL.Perform"; $h) ]', 'Exit Script [ Text Result: $p ]',
  ], { network: fake });
  assert.equal(r.result, '0');
  assert.equal(sent.length, 2);
  assert.equal(sent[0].headers['x-api-key'], 'secret');
  assert.equal(sent[1].headers['x-api-key'], undefined, 'a custom credential header stays with the first origin');
  assert.equal(sent[1].headers.authorization, undefined);
});

test('TLS verification cannot be disabled by either MBS option', async () => {
  const r = await run([
    'Set Variable [ $h ; Value: MBS("CURL.New") ]',
    'Set Variable [ $peer ; Value: MBS("CURL.SetOptionSSLVerifyPeer"; $h; 0) ]',
    'Set Variable [ $host ; Value: MBS("CURL.SetOptionSSLVerifyHost"; $h; 0) ]',
    'Exit Script [ Text Result: $peer & "|" & $host ]',
  ]);
  assert.match(r.result ?? '', /^\[MBS\] ERROR:.*\|\[MBS\] ERROR:/);
});

test('SetupAWS signs a GET to a local fake with generated credentials', async () => {
  seen.length = 0;
  const r = await run([
    'Set Variable [ $h ; Value: MBS("CURL.New") ]',
    `Set Variable [ $setup ; Value: MBS("CURL.SetupAWS"; $h; "TESTKEY"; "testsecret"; "us-east-1"; "execute-api"; "/aws"; "127.0.0.1:${new URL(base).port}"; "GET") ]`,
    set('SetOptionURL', `${base}/aws`),
    'Exit Script [ Text Result: $setup & "|" & MBS("CURL.Perform"; $h) ]',
  ]);
  assert.equal(r.result, 'OK|0');
  assert.match(String(seen[0].headers.authorization), /^AWS4-HMAC-SHA256 Credential=TESTKEY\//);
  assert.equal(seen[0].url, '/aws');
});

// Insert from URL: what a response becomes in its target. Binary responses (an
// image, a PDF) keep their bytes as container data, named after the address;
// text is decoded by its charset. No network: a stand-in fetch answers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript, type RunOptions } from '../src/index.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../src/test-only.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-insert-url-'));
  createStore(join(dir, 'U.sqlite'));
  store = new Store(join(dir, 'U.sqlite'), 'U');
  store.applyDesign([{ op: 'createTable', name: 'Files', fields: [{ name: 'Photo', type: 'container' }, { name: 'Note', type: 'text' }] }] as never);
  store.create('Files', { Note: '' });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const run = (text: string, opts: RunOptions = {}) => runScript(store, {
  id: 9999, name: 'test',
  steps: parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params })),
} as Script, { layout: 'Files', foundSet: store.findIds('Files'), [TEST_ONLY_CUSTOM_FETCH]: true, ...opts });

// A 1×1 PNG: bytes that aren't valid UTF-8, so a text round trip would change them.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const answers: Record<string, () => Response> = {
  'https://example.com/pics/a%20dot.png': () => new Response(PNG, { headers: { 'content-type': 'image/png' } }),
  'https://example.com/download?id=7': () => new Response(PNG, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="report.pdf"' } }),
  'https://example.com/latin1': () => new Response(Buffer.from('café', 'latin1'), { headers: { 'content-type': 'text/plain; charset=ISO-8859-1' } }),
  'https://example.com/latin1-name': () => new Response(PNG, { headers: { 'content-type': 'image/png', 'content-disposition': "attachment; filename*=ISO-8859-1''scan.png" } }),
  'https://example.com/data.json': () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }),
};
const network = (async (url: string | URL) => answers[String(url)]?.() ?? new Response('missing', { status: 404 })) as typeof fetch;

test('a binary response keeps its bytes as a file in a variable, named after the address or Content-Disposition', async () => {
  const r = await run(`
    Insert from URL [ $img ; "https://example.com/pics/a%20dot.png" ]
    Insert from URL [ $pdf ; "https://example.com/download?id=7" ]
    Exit Script [ Text Result: GetContainerAttribute ( $img ; "filename" ) & "|" & Substitute ( Base64Encode ( $img ) ; ¶ ; "" ) & "|" & GetContainerAttribute ( $pdf ; "filename" ) ]
  `, { network });
  assert.equal(r.error, 0);
  assert.equal(r.result, `a dot.png|${PNG.toString('base64')}|report.pdf`);
});

test('into a container field the response is the file, whatever its type says', async () => {
  const r = await run(`
    Insert from URL [ Files::Photo ; "https://example.com/pics/a%20dot.png" ]
    Commit Records/Requests [ With dialog: Off ]
    Exit Script [ Text Result: GetContainerAttribute ( Files::Photo ; "filename" ) & "|" & Substitute ( Base64Encode ( Files::Photo ) ; ¶ ; "" ) ]
  `, { network });
  assert.equal(r.error, 0);
  assert.equal(r.result, `a dot.png|${PNG.toString('base64')}`);
});

test('text is decoded by its charset; JSON stays text', async () => {
  const r = await run(`
    Insert from URL [ $t ; "https://example.com/latin1" ]
    Insert from URL [ Files::Note ; "https://example.com/data.json" ]
    Exit Script [ Text Result: $t & "|" & JSONGetElement ( Files::Note ; "ok" ) ]
  `, { network });
  assert.equal(r.error, 0);
  assert.equal(r.result, 'café|1'); // a JSON true comes back as 1, as on Claris's JSONGetElement page
});

test('with no field named, the active container field takes the file; a charset-prefixed filename* loses its prefix', async () => {
  const r = await run(`
    Go to Field [ Files::Photo ]
    Insert from URL [ "https://example.com/latin1-name" ]
    Commit Records/Requests [ With dialog: Off ]
    Exit Script [ Text Result: Get ( LastError ) & "|" & GetContainerAttribute ( Files::Photo ; "filename" ) ]
  `, { network });
  assert.equal(r.error, 0);
  assert.equal(r.result, '0|scan.png');
});

test('a response over the size limit fails the step (error 1631) without reading it all', async () => {
  let sent = 0;
  const chunk = new Uint8Array(1024 * 1024);
  const endless = (async () => new Response(new ReadableStream({
    pull(c) { sent += chunk.length; c.enqueue(chunk); },
  }), { headers: { 'content-type': 'application/octet-stream' } })) as unknown as typeof fetch;
  const r = await run(`
    Set Error Capture [ On ]
    Insert from URL [ $big ; "https://example.com/huge" ]
    Exit Script [ Text Result: Get ( LastError ) & "|" & IsEmpty ( $big ) ]
  `, { network: endless });
  assert.equal(r.result, '1631|1');
  assert.ok(sent <= 66 * 1024 * 1024, `stopped near the limit, not after ${sent} bytes`);
  // A declared length over the limit is refused before reading.
  const declared = (async () => new Response('x', { headers: { 'content-length': String(200 * 1024 * 1024) } })) as unknown as typeof fetch;
  const d = await run(`
    Set Error Capture [ On ]
    Insert from URL [ $big ; "https://example.com/huge" ]
    Exit Script [ Text Result: Get ( LastError ) ]
  `, { network: declared });
  assert.equal(d.result, '1631');
});

// The first Insert from URL step takes these cURL options (a calculation, as in the step's dialog).
const runCurl = (curl: string, text: string, opts: RunOptions = {}) => {
  const steps = parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params }));
  const step = steps.find((s) => s.stepId === 160)!;
  step.params = { ...step.params, slots: { 129: curl } } as never;
  return runScript(store, { id: 9998, name: 'curl', steps } as Script, { layout: 'Files', foundSet: store.findIds('Files'), [TEST_ONLY_CUSTOM_FETCH]: true, ...opts });
};
const echo = (seen: { url?: string; init?: RequestInit }[]) => (async (url: string | URL, init?: RequestInit) => {
  seen.push({ url: String(url), init });
  return new Response('ok', { headers: { 'content-type': 'text/plain', 'x-trace': 'abc' } });
}) as typeof fetch;

test('cURL -G sends the data in the query; --data-urlencode encodes only the value', async () => {
  const seen: { url?: string; init?: RequestInit }[] = [];
  const r = await runCurl(`"-G --data-urlencode \\"q=a b&c\\" --data-urlencode =x/y -d n=1"`, `
    Insert from URL [ $r ; "https://example.com/search?lang=en" ]
    Exit Script [ Text Result: $r ]
  `, { network: echo(seen) });
  assert.equal(r.error, 0);
  assert.equal(seen[0].url, 'https://example.com/search?lang=en&q=a%20b%26c&x%2Fy&n=1');
  assert.equal(seen[0].init?.method, 'GET');
  assert.equal(seen[0].init?.body, undefined);
});

test('cURL -F uploads a container variable as a file part, beside plain fields; a file on disk is never read', async () => {
  const seen: { url?: string; init?: RequestInit }[] = [];
  const r2 = await runCurl(`"-F title=Scan -F \\"upload=@$img\\" -F \\"note=<$note\\" -F \\"path=@/etc/passwd\\""`, `
    Set Variable [ $note ; Value: "hello" ]
    Set Variable [ $img ; Value: Base64Decode ( "${PNG.toString('base64')}" ; "scan.png" ) ]
    Insert from URL [ $r ; "https://example.com/upload" ]
    Exit Script [ Text Result: $r ]
  `, { network: echo(seen) });
  assert.equal(r2.error, 0);
  const form = seen[0].init?.body as FormData;
  assert.equal(seen[0].init?.method, 'POST');
  assert.equal(form.get('title'), 'Scan');
  assert.equal(form.get('note'), 'hello');
  assert.equal(form.get('path'), null, 'a file on disk is never read');
  const upload = form.get('upload') as File;
  assert.equal(upload.name, 'scan.png');
  assert.deepEqual(Buffer.from(await upload.arrayBuffer()), PNG);
});

test('cURL -I gives the headers as text; -A, -e, -b and --oauth2-bearer set request headers', async () => {
  const seen: { url?: string; init?: RequestInit }[] = [];
  const r = await runCurl(`"-I -A Tab/1 -e https://ref.example -b a=1 --oauth2-bearer T0K"`, `
    Insert from URL [ Files::Note ; "https://example.com/pics/a%20dot.png" ]
    Exit Script [ Text Result: Files::Note ]
  `, { network: echo(seen) });
  assert.equal(r.error, 0);
  assert.equal(seen[0].init?.method, 'HEAD');
  assert.deepEqual(seen[0].init?.headers, { 'User-Agent': 'Tab/1', Referer: 'https://ref.example', Cookie: 'a=1', Authorization: 'Bearer T0K' });
  assert.match(String(r.result), /^HTTP\/1\.1 200[^\r]*\r[\s\S]*x-trace: abc/);
});

test('cURL --max-time stops a slow response (error 1631)', async () => {
  // The timeout's own timer doesn't keep the process alive (a real request would), so this one does.
  const slow = (async (_url: string | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
    const alive = setTimeout(() => reject(new Error('never stopped')), 5000);
    init?.signal?.addEventListener('abort', () => { clearTimeout(alive); reject(init.signal!.reason); });
  })) as typeof fetch;
  const r = await runCurl(`"-m 0.05"`, `
    Insert from URL [ $r ; "https://example.com/slow" ]
  `, { network: slow });
  assert.equal(r.error, 1631);
});

test('cURL details: fragments, part options, a boundary-less multipart type, form data type and odd timeouts', async () => {
  const seen: { url?: string; init?: RequestInit }[] = [];
  const once = async (curl: string, url: string, pre = '') => {
    const r = await runCurl(curl, `${pre}\nInsert from URL [ $r ; "${url}" ]\nExit Script [ Text Result: $r ]`, { network: echo(seen) });
    assert.equal(r.error, 0, String(r.result));
    return seen[seen.length - 1];
  };
  assert.equal((await once(`"-G -d q=1"`, 'https://example.com/a#top')).url, 'https://example.com/a?q=1');
  const up = await once(`"-H \\"Content-Type: multipart/form-data\\" -F \\"f=@$img;type=image/png;filename=x.png\\" -F \\"a=b;type=text/plain\\""`, 'https://example.com/up',
    `Set Variable [ $img ; Value: Base64Decode ( "${PNG.toString('base64')}" ; "scan.png" ) ]`);
  const form = up.init?.body as FormData;
  const f = form.get('f') as File;
  assert.deepEqual([f.name, f.type, f.size, form.get('a')], ['x.png', 'image/png', PNG.length, 'b']);
  assert.deepEqual(up.init?.headers, {}, 'fetch writes the multipart type with its boundary');
  const posted = await once(`"--data-urlencode \\"n=a b\\" -m 2.01"`, 'https://example.com/form');
  assert.deepEqual([posted.init?.method, posted.init?.body, (posted.init?.headers as Record<string, string>)['Content-Type']], ['POST', 'n=a%20b', 'application/x-www-form-urlencoded']);
  const json = await once(`"-H \\"content-type: application/json\\" -d {}"`, 'https://example.com/json');
  assert.deepEqual(json.init?.headers, { 'content-type': 'application/json' });
});

test('cURL --no-compressed asks for the body as it is; a header the script gave is kept', async () => {
  const seen: { url?: string; init?: RequestInit }[] = [];
  await runCurl(`"--no-compressed"`, `Insert from URL [ $r ; "https://example.com/a" ]`, { network: echo(seen) });
  assert.deepEqual(seen[0].init?.headers, { 'Accept-Encoding': 'identity' });
  seen.length = 0;
  await runCurl(`"--no-compressed -H 'Accept-Encoding: gzip'"`, `Insert from URL [ $r ; "https://example.com/a" ]`, { network: echo(seen) });
  assert.deepEqual(seen[0].init?.headers, { 'Accept-Encoding': 'gzip' });
  seen.length = 0;
  await runCurl(`"-H 'X-A: 1'"`, `Insert from URL [ $r ; "https://example.com/a" ]`, { network: echo(seen) });
  assert.deepEqual(seen[0].init?.headers, { 'X-A': '1' }, 'compressed is asked for by default: nothing is added');
});

test('cURL --connect-timeout gives up on a server that does not begin to answer (error 1631), and stops once it has', async () => {
  const silent = (async (_url: string | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
    const alive = setTimeout(() => reject(new Error('never stopped')), 5000);
    init?.signal?.addEventListener('abort', () => { clearTimeout(alive); reject(init.signal!.reason); });
  })) as typeof fetch;
  const r = await runCurl(`"--connect-timeout 0.05"`, `Insert from URL [ $r ; "https://example.com/slow" ]`, { network: silent });
  assert.equal(r.error, 1631);
  // Once the headers are in, the body may take longer than that (it is --max-time that bounds all of it).
  const late = (async (_url: string | URL, init?: RequestInit) => {
    await new Promise((ok) => setTimeout(ok, 10));
    return new Response(new ReadableStream({ start(c) { setTimeout(() => { c.enqueue(new TextEncoder().encode('late body')); c.close(); }, 120); } }), { headers: { 'content-type': 'text/plain' } });
  }) as typeof fetch;
  const ok = await runCurl(`"--connect-timeout 0.08"`, `
    Insert from URL [ $r ; "https://example.com/late" ]
    Exit Script [ Text Result: $r ]
  `, { network: late });
  assert.equal(ok.error, 0);
  assert.equal(ok.result, 'late body');
});

test('cURL --max-filesize refuses a response over it, by its stated length or as it arrives (error 1631)', async () => {
  const sized = (async () => new Response('x'.repeat(100), { headers: { 'content-type': 'text/plain', 'content-length': '100' } })) as typeof fetch;
  let r = await runCurl(`"--max-filesize 50"`, `Insert from URL [ $r ; "https://example.com/big" ]`, { network: sized });
  assert.equal(r.error, 1631);
  const streamed = (async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(30)); c.enqueue(new Uint8Array(30)); c.close(); } }), { headers: { 'content-type': 'text/plain' } })) as typeof fetch;
  r = await runCurl(`"--max-filesize 50"`, `Insert from URL [ $r ; "https://example.com/big" ]`, { network: streamed });
  assert.equal(r.error, 1631);
  r = await runCurl(`"--max-filesize 100"`, `
    Insert from URL [ $r ; "https://example.com/big" ]
    Exit Script [ Text Result: Length ( $r ) ]
  `, { network: sized });
  assert.deepEqual([r.error, r.result], [0, '100']);
});

test('cURL --FM-return-container-variable stores a text response in a variable as a container', async () => {
  const text = (async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const asText = await runCurl(`""`, `
    Insert from URL [ $r ; "https://example.com/data.json" ]
    Exit Script [ Text Result: GetValue ( $r ; 1 ) ]
  `, { network: text });
  assert.equal(asText.result, '{"ok":true}');
  const asContainer = await runCurl(`"--FM-return-container-variable"`, `
    Insert from URL [ $r ; "https://example.com/data.json" ]
    Exit Script [ Text Result: GetContainerAttribute ( $r ; "filename" ) ]
  `, { network: text });
  assert.equal(asContainer.error, 0);
  assert.equal(asContainer.result, 'data.json');
});

test('--aws-sigv4 signs the request with --user, in place of Basic', async () => {
  const seen: { url?: string; init?: RequestInit }[] = [];
  const r = await runCurl(`"--aws-sigv4 aws:amz:us-east-1:service -u AKIDEXAMPLE:secret"`, `Insert from URL [ $r ; "https://example.amazonaws.com/" ]`, { network: echo(seen) });
  assert.equal(r.error, 0);
  const h = seen[0].init?.headers as Record<string, string>;
  assert.match(h.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/service\/aws4_request, SignedHeaders=host;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.match(h['x-amz-date'], /^\d{8}T\d{6}Z$/);
  const bad = await runCurl(`"--aws-sigv4 aws:amz -u a:b"`, `Insert from URL [ $r ; "https://example.com/" ]`, { network: echo(seen) });
  assert.equal(bad.error, 1630);
});

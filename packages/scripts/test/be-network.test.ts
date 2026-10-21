// BaseElements' web and mail functions run where scripts may reach the network (the file's Script network switch), through the
// same guarded transport as Insert from URL, and give ? and error 3 where they may not.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { runScript, type OutgoingMail } from '../src/index.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../src/test-only.ts';
import { fakeFtp } from './fake-ftp.ts';

let dir: string;
let store: Store;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'be-network-'));
  createStore(join(dir, 'Shop.sqlite'));
  store = new Store(join(dir, 'Shop.sqlite'), 'Shop');
});
after(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const script = (n: string, text: string) => store.applyDesign([{ op: 'createScript', name: n, text }]);

function net() {
  const seen: { url: string; method?: string; headers: Record<string, string>; body?: unknown }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), method: init?.method, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body });
    return new Response('{"ok":true}', { status: 201, headers: { 'x-thing': 'yes' } });
  }) as typeof globalThis.fetch;
  return { seen, fetch };
}

test('BE_HTTP_GET and POST make real requests where scripts may reach the network, and the response functions read them', async () => {
  script('Web', [
    'Set Variable [ $get ; Value: BE_HTTP_GET ( "https://api.example.com/a" ; "" ; "ann" ; "pw" ) ]',
    'Set Variable [ $code ; Value: BE_HTTP_ResponseCode ]',
    'Set Variable [ $has ; Value: BE_HTTP_ResponseHeaders ( "X-Thing" ) ]',
    'Set Variable [ $h ; Value: BE_HTTP_SetCustomHeader ( "X-Key" ; "k1" ) ]',
    'Set Variable [ $post ; Value: BE_HTTP_POST ( "https://api.example.com/b" ; "a=1&b=2" ) & "|" & BE_GetLastError ]',
    'Exit Script [ Text Result: $get & "|" & $code & "|" & $has & "|" & $post ]',
  ].join('\n'));
  const { seen, fetch } = net();
  const r = await runScript(store, 'Web', { [TEST_ONLY_CUSTOM_FETCH]: true, network: fetch, trace: true });
  assert.equal(r.result, '{"ok":true}|201|1|{"ok":true}|0', JSON.stringify(r.trace));
  assert.equal(seen.length, 2);
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].headers.authorization, `Basic ${Buffer.from('ann:pw').toString('base64')}`);
  assert.equal(seen[1].method, 'POST');
  assert.equal(seen[1].body, 'a=1&b=2');
  assert.equal(seen[1].headers['x-key'], 'k1');
  assert.equal(seen[1].headers['content-type'], 'application/x-www-form-urlencoded');
});

test('where scripts may not reach the network the web functions give ?, and nothing is sent', async () => {
  script('WebOff', 'Set Variable [ $r ; Value: BE_HTTP_GET ( "https://api.example.com/a" ) & "|" & BE_GetLastError ]\nExit Script [ Text Result: $r ]');
  const { seen, fetch } = net();
  assert.equal((await runScript(store, 'WebOff', { [TEST_ONLY_CUSTOM_FETCH]: true, network: false })).result, '?|3');
  // The network is on for the run but a file it reaches is not allowed it.
  assert.equal((await runScript(store, 'WebOff', { [TEST_ONLY_CUSTOM_FETCH]: true, network: fetch, networkFiles: () => false })).result, '?');
  assert.deepEqual(seen, []);
});

test('BE_SMTPSend sends through the server\'s mail where sending is set up and scripts may use the network', async () => {
  script('Mail', 'Set Variable [ $r ; Value: BE_SMTPSend ( "me@example.com" ; "you@example.com" ; "Hi" ; "Body" ) & "|" & BE_GetLastError ]\nExit Script [ Text Result: $r ]');
  const sent: OutgoingMail[] = [];
  const mail = async (m: OutgoingMail) => { sent.push(m); };
  const { fetch } = net();
  const on = await runScript(store, 'Mail', { [TEST_ONLY_CUSTOM_FETCH]: true, network: fetch, mail });
  assert.equal(on.result, '|0');
  assert.deepEqual(sent.map((m) => [m.to, m.subject, m.text]), [[['you@example.com'], 'Hi', 'Body']]);
  // No network for the run, or no mail set up: nothing is sent.
  assert.equal((await runScript(store, 'Mail', { network: false, mail })).result, '?|3');
  assert.equal((await runScript(store, 'Mail', { [TEST_ONLY_CUSTOM_FETCH]: true, network: fetch })).result, '?|3');
  assert.equal(sent.length, 1);
});

test('BE_HTTP_GET_File saves the answer, bytes and all, in the documents folder; BE_HTTP_PUTFile sends a file from there', async () => {
  const docs = join(dir, 'Documents');
  mkdirSync(docs, { recursive: true });
  const picture = Uint8Array.from([0, 255, 128, 10, 13, 200, 0x89, 0x50]);
  writeFileSync(join(docs, 'up.bin'), picture);
  script('GetFile', [
    'Set Variable [ $save ; Value: BE_HTTP_GET_File ( "https://files.example.com/p.png" ; Get ( DocumentsPath ) & "p.png" ; "ann" ; "pw" ) ]',
    'Set Variable [ $code ; Value: BE_HTTP_ResponseCode ]',
    'Set Variable [ $put ; Value: BE_HTTP_PUTFile ( "https://files.example.com/up" ; Get ( DocumentsPath ) & "up.bin" ) ]',
    'Set Variable [ $err ; Value: BE_GetLastError ]',
    'Exit Script [ Text Result: $save & "|" & $code & "|" & $put & "|" & $err ]',
  ].join('\n'));
  const seen: { url: string; method?: string; body?: unknown; headers: Record<string, string> }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), method: init?.method, body: init?.body, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return new Response(init?.method === 'GET' ? picture : 'stored', { status: 200 });
  }) as typeof globalThis.fetch;
  const r = await runScript(store, 'GetFile', { [TEST_ONLY_CUSTOM_FETCH]: true, network: fetch, documents: docs, trace: true });
  assert.equal(r.result, '|200|stored|0', JSON.stringify(r.trace));
  assert.deepEqual([...readFileSync(join(docs, 'p.png'))], [...picture], 'the answer is saved byte for byte');
  assert.equal(seen[0].headers.authorization, `Basic ${Buffer.from('ann:pw').toString('base64')}`);
  assert.equal(seen[1].method, 'PUT');
  assert.deepEqual([...(seen[1].body as Uint8Array)], [...picture], 'the file is sent byte for byte');
  assert.equal(seen.length, 2);
});

test('the file variants say what is wrong: a missing file, a path outside the documents folder, and an address that is not http', async () => {
  const docs = join(dir, 'Documents');
  mkdirSync(docs, { recursive: true });
  const { seen, fetch } = net();
  let n = 0;
  const run = async (formula: string) => {
    const name = `Variant${++n}`;
    script(name, `Set Variable [ $r ; Value: ${formula} & "|" & BE_GetLastError ]\nExit Script [ Text Result: $r ]`);
    return (await runScript(store, name, { [TEST_ONLY_CUSTOM_FETCH]: true, network: fetch, documents: docs })).result;
  };
  assert.equal(await run('BE_HTTP_PUTFile ( "https://files.example.com/up" ; Get ( DocumentsPath ) & "nothing.bin" )'), '2|2');
  assert.equal(await run('BE_HTTP_GET_File ( "https://files.example.com/p" ; Get ( DocumentsPath ) & "../escape.txt" )'), '2|2');
  assert.equal(existsSync(join(dir, 'escape.txt')), false);
  assert.equal(await run('BE_HTTP_GET_File ( "https://files.example.com/p" )'), '2|2', 'a path is needed');
  assert.equal(await run('BE_HTTP_GET_File ( "sftp://files.example.com/p" ; Get ( DocumentsPath ) & "x" )'), '?|3');
  assert.equal(await run('BE_HTTP_GET ( "ftp://files.example.com/p" )'), '?|3');
  // A bad path is found after the answer, so that request went out.
  assert.deepEqual(seen.map((x) => x.url), ['https://files.example.com/p']);
  // Where scripts may not reach the network they give ? and send nothing.
  script('FileOff', 'Set Variable [ $r ; Value: BE_HTTP_GET_File ( "https://files.example.com/p" ; Get ( DocumentsPath ) & "y" ) & "|" & BE_GetLastError ]\nExit Script [ Text Result: $r ]');
  assert.equal((await runScript(store, 'FileOff', { network: false, documents: docs })).result, '?|3');
});

test('BE_HTTP_PUTFile refuses a file over 10 MB without sending it', async () => {
  const docs = join(dir, 'Documents');
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(docs, 'big.bin'), '');
  truncateSync(join(docs, 'big.bin'), 10 * 1024 * 1024 + 1); // sparse
  script('PutBig', 'Set Variable [ $r ; Value: BE_HTTP_PUTFile ( "https://files.example.com/up" ; Get ( DocumentsPath ) & "big.bin" ) & "|" & BE_GetLastError ]\nExit Script [ Text Result: $r ]');
  const { seen, fetch } = net();
  assert.equal((await runScript(store, 'PutBig', { [TEST_ONLY_CUSTOM_FETCH]: true, network: fetch, documents: docs })).result, '7|7');
  assert.deepEqual(seen, []);
});

test('BE_FTP_UploadFile and BE_FTP_Delete go to an FTP server where scripts may reach the network, and give ? where they may not', async () => {
  const docs = join(dir, 'Documents');
  mkdirSync(docs, { recursive: true });
  const bytes = Uint8Array.from([1, 2, 3, 0, 255]);
  writeFileSync(join(docs, 'send.bin'), bytes);
  const f = await fakeFtp();
  try {
    script('Ftp', [
      `Set Variable [ $up ; Value: BE_FTP_UploadFile ( "ftp://127.0.0.1:${f.port}/in/send.bin" ; Get ( DocumentsPath ) & "send.bin" ; "ann" ; "pw" ) & "|" & BE_GetLastError ]`,
      `Set Variable [ $del ; Value: BE_FTP_Delete ( "ftp://127.0.0.1:${f.port}/old/file.txt" ; "ann" ; "pw" ) & "|" & BE_GetLastError ]`,
      `Set Variable [ $bad ; Value: BE_FTP_Delete ( "ftp://127.0.0.1:${f.port}/missing" ; "ann" ; "wrong" ) & "|" & BE_GetLastError ]`,
      `Set Variable [ $sftp ; Value: BE_FTP_Delete ( "sftp://127.0.0.1/x" ; "ann" ; "pw" ) & "|" & BE_GetLastError ]`,
      'Exit Script [ Text Result: $up & "," & $del & "," & $bad & "," & $sftp ]',
    ].join('\n'));
    const { fetch } = net();
    const options = { [TEST_ONLY_CUSTOM_FETCH]: true as const, network: fetch, networkAllow: ['127.0.0.1'], documents: docs, trace: true };
    const r = await runScript(store, 'Ftp', options);
    assert.equal(r.result, '|0,|0,67|67,?|3', JSON.stringify(r.trace));
    assert.deepEqual([...f.uploads.get('/in/send.bin')!], [...bytes]);
    assert.ok(f.commands.includes('DELE old/file.txt'));
    // Not allowed to reach the own network: the server is not spoken to.
    f.commands.length = 0;
    const closed = await runScript(store, 'Ftp', { [TEST_ONLY_CUSTOM_FETCH]: true, network: fetch, documents: docs });
    assert.equal(closed.result, '7|7,7|7,7|7,?|3');
    assert.deepEqual(f.commands, []);
    // No network for the run: ? and error 3, nothing sent.
    assert.equal((await runScript(store, 'Ftp', { network: false, documents: docs })).result, '?|3,?|3,?|3,?|3');
    assert.deepEqual(f.commands, []);
  } finally { await f.close(); }
});

test('in outbound test mode, the file variants and FTP calls go to the Outbox with their size, and nothing is sent', async () => {
  const docs = join(dir, 'Documents');
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(docs, 'five.bin'), Uint8Array.from([1, 2, 3, 4, 5]));
  script('Boxed', [
    'Set Variable [ $a ; Value: BE_HTTP_PUTFile ( "https://files.example.com/up" ; Get ( DocumentsPath ) & "five.bin" ) ]',
    'Set Variable [ $b ; Value: BE_HTTP_GET_File ( "https://files.example.com/down" ; Get ( DocumentsPath ) & "got.bin" ) ]',
    'Set Variable [ $c ; Value: BE_FTP_UploadFile ( "ftp://ftp.example.com/in/five.bin" ; Get ( DocumentsPath ) & "five.bin" ; "ann" ; "pw" ) ]',
    'Set Variable [ $d ; Value: BE_FTP_Delete ( "ftp://ftp.example.com/in/five.bin" ; "ann" ; "pw" ) ]',
    'Exit Script [ Text Result: "done" ]',
  ].join('\n'));
  const entries: { method?: string; url?: string; requestBytes?: number }[] = [];
  const r = await runScript(store, 'Boxed', { documents: docs, outbound: { allowHosts: [], record: (e) => entries.push(e as never) } });
  assert.equal(r.result, 'done');
  assert.deepEqual(entries.map((e) => [e.method, e.url, e.requestBytes]), [
    ['PUT', 'https://files.example.com/up', 5], ['GET', 'https://files.example.com/down', 0],
    ['STOR', 'ftp://ftp.example.com/in/five.bin', 5], ['DELE', 'ftp://ftp.example.com/in/five.bin', 0],
  ]);
});

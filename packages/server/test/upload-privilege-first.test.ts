// A container upload is turned away on the account's privileges before its body is read, and its file name is just a
// name: no folder in front of it, and broken percent-encoding is a 400.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, type DesignOp, type Store } from '../../store/src/index.ts';

let dir: string;
let server: Server;
let base: string;
let store: Store;
let recordId: number;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-upload-first-'));
  createStore(join(dir, 'U' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('U')!;
  store.applyDesign([{ op: 'createTable', name: 'Docs', fields: [{ name: 'Title' }, { name: 'File', type: 'container' }] }] as DesignOp[]);
  recordId = Number(store.create('Docs', { Title: 'one' }).recordId);
  store.setPassword('Admin', 'pw', '[Full Access]');
  store.savePrivilegeSet({
    name: 'Viewer', records: { view: true, edit: true, create: true, delete: false }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest', 'fmodata'],
    tables: { Docs: { view: true, edit: true, create: true, delete: false, fields: { File: 'viewOnly' } } },
  } as never);
  store.setPassword('Limited', 'pw', 'Viewer');
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function login(account: string): Promise<string> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/U/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`), 'content-type': 'application/json' }, body: '{}' });
  return 'Bearer ' + (await r.json()).response.token;
}

/** Sends the headers of a huge upload and a few bytes of it, then waits for the answer: it comes without the rest of the body, or not at all. */
function early(path: string, method: string, headers: Record<string, string>, announced: number): Promise<{ status: number | 'waiting'; text: string }> {
  return new Promise((resolve) => {
    const req = request(`${base}${path}`, { method, headers: { ...headers, 'content-length': String(announced) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        resolve({ status: res.statusCode!, text });
        req.destroy();
      });
    });
    req.on('error', () => {});
    req.write(Buffer.alloc(1024));
    setTimeout(() => {
      resolve({ status: 'waiting', text: '' });
      req.destroy();
    }, 3000).unref();
  });
}

const boundary = 'xBoundaryx';
const multipart = { 'content-type': `multipart/form-data; boundary=${boundary}` };

test('Data API: an account that may not change the field is answered before any of the file is read', async () => {
  const limited = await login('Limited');
  const denied = await early(`/fmi/data/vLatest/databases/U/layouts/Docs/records/${recordId}/containers/File/1`, 'POST', { authorization: limited, ...multipart }, 500 * 1024 * 1024);
  assert.notEqual(denied.status, 'waiting', 'the answer does not wait for the rest of the body');
  assert.match(denied.text, /"code":"201"/, 'field not modifiable');
  const missing = await early(`/fmi/data/vLatest/databases/U/layouts/Docs/records/99999/containers/File/1`, 'POST', { authorization: await login('Admin'), ...multipart }, 500 * 1024 * 1024);
  assert.notEqual(missing.status, 'waiting', 'a record that is not there is answered at once too');
  assert.match(missing.text, /"code":"101"/);
  assert.equal(store.containerId('Docs', recordId, 'File'), undefined);
});

test('OData: the same for a PATCH of a container', async () => {
  const limited = 'Basic ' + btoa('Limited:pw');
  const r = await early(`/fmi/odata/v4/U/Docs(${recordId})/File`, 'PATCH', { authorization: limited, 'content-type': 'image/png' }, 60 * 1024 * 1024);
  assert.ok([401, 403, 405].includes(r.status as number), `answered ${r.status} without the body`);
});

test('Data API: a file name loses any folder, and broken percent-encoding is a 400', async () => {
  const admin = await login('Admin');
  const send = async (disposition: string) => {
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="upload"; ${disposition}\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`;
    return fetch(`${base}/fmi/data/vLatest/databases/U/layouts/Docs/records/${recordId}/containers/File/1`, { method: 'POST', headers: { authorization: admin, ...multipart }, body });
  };
  const nameOf = () => store.containerInfo(store.containerId('Docs', recordId, 'File')!)!.filename;
  assert.equal((await send('filename="..\\..\\evil\\a.txt"')).status, 200);
  assert.equal(nameOf(), 'a.txt');
  assert.equal((await send('filename="/etc/passwd"')).status, 200);
  assert.equal(nameOf(), 'passwd');
  assert.equal((await send(`filename*=UTF-8''..%2F..%2Fb.txt`)).status, 200);
  assert.equal(nameOf(), 'b.txt');
  const broken = await send(`filename*=UTF-8''%E0%A4%A`);
  assert.equal(broken.status, 400);
});

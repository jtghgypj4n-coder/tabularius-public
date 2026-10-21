import { after, before, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { request, type IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Assistant } from '../src/assistant.ts';
import { serve, setAdminPassword } from '../src/index.ts';
import { makeAuthenticator, forgeRegistration } from '../../store/test/forge-webauthn.ts';

let app: Awaited<ReturnType<typeof serve>>;
let dir: string;
let fullBearer: string;
const basic = 'Basic ' + btoa('Limited:pw');
const admin = { authorization: 'Basic ' + btoa(':secret'), 'x-tabularius-admin': '1' };
const seen = new Map<string, { readers: number; bytes: number; req: IncomingMessage }>();
let sequence = 0;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'upload-auth-body-'));
  setAdminPassword(dir, 'secret');
  app = await serve({ dir, port: 0, watch: false, log: () => {}, mcpToken: 'server-secret',
    oidc: { name: 'Test', issuer: 'https://example.invalid', clientId: 'test' } });
  const store = app.host.create('U');
  store.applyDesign([
    { op: 'createTable', name: 'Docs', fields: [{ name: 'Title' }, { name: 'File', type: 'container' }] },
    { op: 'createScript', name: 'Hidden', text: 'Exit Script [ Text Result: "ok" ]' },
  ]);
  store.create('Docs', { Title: 'one' });
  store.setPassword('Admin', 'pw');
  store.savePrivilegeSet({ name: 'Limited', records: { view: true, create: false, edit: false, delete: false },
    layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest', 'fmodata', 'fmmcp', 'fmxml', 'fmxdbc'] } as never);
  store.setPassword('Limited', 'pw', 'Limited');
  const login = await fetch(app.url + '/fmi/data/vLatest/databases/U/sessions', { method: 'POST', headers: { authorization: basic }, body: '{}' });
  assert.equal(login.status, 200);
  const opts = await (await fetch(app.url + '/tabularius/admin/v1/passkeys/register/options', { method: 'POST', headers: admin })).json();
  const u = new URL(app.url);
  const auth = makeAuthenticator(u.hostname, u.origin);
  const registered = await fetch(app.url + '/tabularius/admin/v1/passkeys/register', { method: 'POST', headers: admin,
    body: JSON.stringify({ response: { ...forgeRegistration(auth, opts.challenge), challenge: opts.challenge } }) });
  assert.equal(registered.status, 200);
  const challenge = store.issueWebauthnChallenge('register', 'Limited');
  store.registerPasskey('Limited', forgeRegistration(auth, challenge), { rpId: u.hostname, origin: u.origin, challenge });
  const other = app.host.create('Other');
  other.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Title' }] }]);
  other.create('Items', { Title: 'foreign' });
  other.setPassword('Owner', 'pw', '[Full Access]');
  other.savePrivilegeSet(store.privilegeSet('Limited')!);
  other.setPassword('Admin', 'pw', 'Limited');
  store.applyDesign([
    { op: 'createDataSource', name: 'Other', paths: ['file:Other'] },
    { op: 'createOccurrence', name: 'External', file: 'Other', externalTable: other.schema.tables.find(t => t.name === 'Items')!.id },
    { op: 'createLayout', name: 'External', occurrence: 'External' },
  ]);
  const fullLogin = await fetch(app.url + '/fmi/data/vLatest/databases/U/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') }, body: '{}' });
  fullBearer = 'Bearer ' + (await fullLogin.json()).response.token;
  mock.getter(Assistant.prototype, 'available', () => true);
  app.server.prependListener('request', (req, res) => {
    const id = String(req.headers['x-body-probe'] ?? '');
    if (!id) return;
    const probe = { readers: 0, bytes: 0, req };
    seen.set(id, probe);
    // Observe consumption without adding a data listener (which itself would start reading).
    const on = req.on;
    req.on = function (event, listener) {
      if (event === 'data' && !res.headersSent) probe.readers++;
      return on.call(this, event, listener);
    };
    const emit = req.emit;
    req.emit = function (event: string | symbol, ...args: unknown[]) {
      if (event === 'data' && !res.headersSent) probe.bytes += (args[0] as Buffer).length;
      return emit.call(this, event, ...args);
    };
  });
});

after(async () => {
  app?.server.closeAllConnections();
  if (app) await new Promise<void>((resolve) => app.server.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Never ends the request: a denial must arrive without waiting for the remaining megabyte. */
async function probe(path: string, method: string, headers: Record<string, string>, chunked = false) {
  const id = String(++sequence);
  let client: ReturnType<typeof request>;
  let timer: NodeJS.Timeout;
  let drip: NodeJS.Timeout;
  const result = await new Promise<{ status: number; connection?: string; closed: boolean; text: string }>((resolve, reject) => {
    client = request(app.url + path, { method, headers: { 'content-type': 'application/json', ...headers,
      'x-body-probe': id, ...(chunked ? { 'transfer-encoding': 'chunked' } : { 'content-length': String(1024 * 1024) }) } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        // Do not close the client until we have observed whether the server closed its socket. The server closes it once
        // the answer is flushed, which on a slow or busy machine is later than any fixed pause could promise, so this waits
        // for the close itself; a server that keeps the connection open runs into the timer below.
        const socket = seen.get(id)!.req.socket;
        const done = () => resolve({ status: res.statusCode!, connection: res.headers.connection, closed: true, text });
        if (socket.destroyed) done();
        else socket.once('close', done);
      });
    });
    client.on('error', () => {});
    timer = setTimeout(() => reject(new Error('server waited for the rest of the unauthorised body, or kept the connection open after answering')), 1500);
    if (chunked) {
      let sent = 0;
      drip = setInterval(() => {
        client.write(Buffer.alloc(4096, 32));
        sent += 4096;
        if (sent >= 68 * 1024) clearInterval(drip);
      }, 1);
    } else client.write(Buffer.alloc(1024, 32));
  }).finally(() => { clearTimeout(timer); clearInterval(drip); client.destroy(); });
  return { ...result, ...seen.get(id)! };
}

const unauthenticated: [string, string][] = [
  ['/fmi/odata/v4/U/Docs', 'POST'],
  ['/fmi/odata/v4/U/Docs(1)', 'PATCH'],
  ['/fmi/odata/v4/U/$batch', 'POST'],
  ['/fmi/data/vLatest/databases/U/globals', 'PATCH'],
  ['/fmi/data/vLatest/databases/U/layouts/Docs/records', 'POST'],
  ['/fmi/data/vLatest/databases/U/layouts/Docs/records/1', 'PATCH'],
  ['/fmi/data/vLatest/databases/U/layouts/Docs/records/1', 'POST'],
  ['/fmi/data/vLatest/databases/U/layouts/Docs/_find', 'POST'],
  ['/tabularius/app/v1/databases/U/layouts/Docs/import', 'POST'],
  ['/tabularius/app/v1/databases/U/layouts/Docs/button', 'POST'],
  ['/tabularius/agent/v1/databases/U/dry-run', 'POST'],
  ['/tabularius/agent/v1/databases/U/step', 'POST'],
  ['/tabularius/cleanup/v1/databases/U/scan', 'POST'],
  ['/tabularius/cleanup/v1/databases/U/apply', 'POST'],
  ['/tabularius/digests/v1/databases/U', 'POST'],
  ['/tabularius/assistant/v1/databases/U', 'POST'],
  ['/tabularius/sql/v1/databases/U', 'POST'],
  ['/tabularius/scim/v2/databases/U/Groups/TGltaXRlZA', 'PUT'],
  ['/tabularius/scim/v2/databases/U/Users', 'POST'],
  ['/tabularius/assistant/v1/databases/U', 'POST'],
  ['/tabularius/app/v1/databases/U/layouts/Docs/refresh', 'POST'],
  ['/tabularius/admin/v1/uploads', 'POST'], ['/tabularius/admin/v1/uploads/no-such-upload', 'PUT'],
  ['/tabularius/admin/v1/uploads/no-such-upload/finish', 'POST'], ['/tabularius/admin/v1/files/U/reconvert', 'POST'],
  ['/fmi/admin/api/v2/server/config', 'PATCH'],
  ['/fmi/data/vLatest/databases/U/layouts/Docs/records/1/containers/File/1', 'POST'],
  ['/fmi/odata/v4/U/Docs(1)/File', 'PATCH'],
  ['/tabularius/app/v1/databases/U/layouts/Docs/import', 'POST'],
  ['/tabularius/app/v1/databases/U/runs/abcdef/file', 'POST'],
  ['/tabularius/agent/v1/databases/U/step', 'POST'], ['/mcp', 'POST'],
  ['/tabularius/hooks/v1/unknown', 'POST'],
];
for (const [path, method] of unauthenticated) test(`unread body is closed: ${method} ${path}`, async () => {
  for (const chunked of [false, true]) {
    const r = await probe(path, method, {}, chunked);
    assert.ok(r.status >= 400, String(r.status));
    assert.equal(r.readers, 0, 'no body reader attached');
    assert.ok(r.bytes <= 64 * 1024, 'no application body is retained before authentication');
    assert.equal(r.connection, 'close');
    assert.equal(r.closed, true, 'connection closed after delivering the response');
  }
});

const bounded: [string, string, 'public' | 'basic', Record<string, string>?][] = [
  ['/tabularius/admin/v1/sign-in', 'POST', 'public', { 'x-tabularius-admin': '1' }],
  ['/tabularius/admin/v1/passkey-sign-in', 'POST', 'public', { 'x-tabularius-admin': '1' }],
  ['/fmi/data/vLatest/databases/U/sessions', 'POST', 'public'],
  ['/fmi/data/vLatest/databases/U/sessions/passkey', 'POST', 'public'],
  ['/fmi/data/vLatest/databases/U/sessions/recovery', 'POST', 'public'],
  ['/fmi/data/vLatest/databases/U/sessions/passkey-2fa', 'POST', 'basic'],
  ['/fmi/xml/fmresultset.xml', 'POST', 'public', { 'content-type': 'application/x-www-form-urlencoded' }],
  ['/tabularius/auth/v1/oidc/callback', 'POST', 'public'],
  ['/mcp', 'POST', 'basic', { accept: 'application/json, text/event-stream' }],
  ['/fmi/odata/v4/U/FileMaker_Tables', 'POST', 'basic'],
  ['/fmi/odata/v4/U/Script.Hidden', 'POST', 'basic'],

];
for (const [path, method, auth, headers] of bounded) test(`bounded while authenticating, or refused by header-only permissions: ${method} ${path}`, async () => {
  for (const chunked of [false, true]) {
    const r = await probe(path, method, { ...(auth === 'public' ? {} : { authorization: basic }), ...headers }, chunked);
    assert.ok(r.status >= 400 || r.status === 302 || (path.startsWith('/fmi/xml/') && /960/.test(r.text)), String(r.status));
    assert.ok(r.bytes <= (chunked ? 68 * 1024 : 64 * 1024), `consumed ${r.bytes} bytes`);
    assert.equal(r.connection, 'close');
    assert.equal(r.closed, true);
  }
});

for (const [path, method] of [
  ['/fmi/data/vLatest/databases/U/layouts/External/records', 'POST'],
  ['/fmi/data/vLatest/databases/U/layouts/External/records/1', 'PATCH'],
  ['/fmi/data/vLatest/databases/U/layouts/External/records/1', 'POST'],
]) test(`Full Access in the entry file still cannot write to a limited external file: ${method} ${path}`, async () => {
  const r = await fetch(app.url + path, { method, headers: { authorization: fullBearer, 'content-type': 'application/json' },
    body: JSON.stringify({ fieldData: { Title: 'x'.repeat(80 * 1024) } }),
  });
  assert.equal(r.status, 500, await r.clone().text()); // Data API maps record-denied code 200 to HTTP 500.
  assert.equal((await r.json()).messages[0].code, '200');
  assert.equal(app.host.get('Other')!.find('Items').records[0].fieldData.Title, 'foreign');
});

test('Full Access in a file without external sources still accepts JSON larger than 64 KiB', async () => {
  const login = await fetch(app.url + '/fmi/data/vLatest/databases/Other/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Owner:pw') }, body: '{}' });
  const token = (await login.json()).response.token;
  const r = await fetch(app.url + '/fmi/data/vLatest/databases/Other/layouts/Items/records', {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ fieldData: { Title: 'x'.repeat(80 * 1024) } }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).messages[0].code, '0');
});

test('library publish authenticates before reading the component selector', async () => {
  const r = await probe('/tabularius/design/v1/databases/U/library', 'POST', {});
  assert.equal(r.status, 401);
  assert.equal(r.readers, 0);
});

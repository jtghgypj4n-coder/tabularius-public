import { deleteBeforeStateLock } from './state-lock-race.ts';
// Connections: S3-compatible storage set up once in the console, with its secrets sealed on the server. Tested
// against a local stand-in for S3; nothing here reaches a real service.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { Connections, serve } from '../src/index.ts';
import { guardedFetch } from '../src/connections.ts';
import { fakeS3 } from './fake-s3.ts';

const KEYS = { accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
let dir: string;
let s3: Awaited<ReturnType<typeof fakeS3>>;
let server: Server;
let base: string;
const logs: string[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-connections-'));
  s3 = await fakeS3({ bucket: 'invoices', ...KEYS });
  const s = await serve({ dir, port: 0, log: (m: string) => logs.push(m) });
  server = s.server;
  base = s.url;
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  await s3.close();
  if (dir) rmSync(dir, { recursive: true });
});

const admin = (method: string, path: string, body?: unknown) =>
  fetch(`${base}/tabularius/admin/v1${path}`, { method, headers: { 'x-tabularius-admin': '1', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

test('a connection is made, its secrets set in the console, tested against the service and approved', async () => {
  const types = await admin('GET', '/connections');
  assert.equal(types.status, 200);
  assert.deepEqual(types.body.types.map((t: { id: string }) => t.id), ['s3', 'rest', 'smtp']);

  const made = await admin('POST', '/connections', { name: 'invoices', type: 's3', config: { bucket: 'invoices', endpoint: s3.endpoint, prefix: '/acme//2026/' } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.status, 'draft');
  assert.equal(made.body.config.prefix, 'acme/2026');
  assert.equal(made.body.ready, false);
  const id = made.body.id;

  // Can't be approved or tested before the secrets are in.
  assert.equal((await admin('POST', `/connections/${id}/approve`)).status, 400);
  const early = await admin('POST', `/connections/${id}/test`);
  assert.equal(early.body.ok, false);
  assert.match(early.body.message, /Set Access key ID and Secret access key first/);

  await admin('PUT', `/connections/${id}/secrets/accessKey`, { value: KEYS.accessKey });
  const set = await admin('PUT', `/connections/${id}/secrets/secretKey`, { value: KEYS.secretKey });
  assert.equal(set.status, 200);
  assert.equal(set.body.ready, true);
  assert.deepEqual(set.body.secrets.map((s: { name: string; set: boolean }) => [s.name, s.set]), [['accessKey', true], ['secretKey', true], ['sessionToken', false]]);

  // The service sees a correctly signed request limited to the connection's folder.
  s3.objects.set('acme/2026/a.pdf', { body: Buffer.from('x') });
  const ok = await admin('POST', `/connections/${id}/test`);
  assert.equal(ok.body.ok, true, ok.body.message);
  assert.match(ok.body.message, /Reached bucket invoices under acme\/2026\//);
  assert.equal(s3.requests.at(-1)!.query.includes('prefix=acme%2F2026%2F'), true, s3.requests.at(-1)!.query);

  const approved = await admin('POST', `/connections/${id}/approve`);
  assert.equal(approved.body.status, 'active');
  assert.ok(approved.body.approved);
  assert.equal((await admin('POST', `/connections/${id}/approve`)).status, 400);
});

test('secrets are never returned, written in the clear, or logged', async () => {
  const listed = JSON.stringify((await admin('GET', '/connections')).body);
  for (const secret of Object.values(KEYS)) assert.ok(!listed.includes(secret));
  assert.ok(!logs.join('\n').includes(KEYS.secretKey) && !logs.join('\n').includes(KEYS.accessKey));
  assert.match(logs.join('\n'), /secret secretKey set from the console/);
  for (const name of readdirSync(dir).filter((n) => n.startsWith('.openhbam-connection'))) {
    const text = readFileSync(join(dir, name), 'utf8');
    for (const secret of Object.values(KEYS)) assert.ok(!text.includes(secret), `${name} holds a secret in the clear`);
  }
  // Readable by the server's user alone.
  if (process.platform !== 'win32') {
    for (const name of ['.openhbam-connection-secrets.json', '.openhbam-connections.key']) assert.equal(statSync(join(dir, name)).mode & 0o077, 0, name);
  }
});

test('the server uses a connection without handing out its secrets, and respects the files it is set up for', async () => {
  const c = new Connections(dir);
  const { connection, secrets } = c.use('invoices', ['Charts']);
  assert.equal(connection.name, 'invoices');
  assert.equal(secrets.accessKey, KEYS.accessKey);
  c.update('invoices', { files: ['Orders'] });
  assert.throws(() => c.use('invoices', ['Charts']), /not set up for Charts/);
  assert.throws(() => c.use('invoices', []), /not set up for this file/);
  assert.equal(c.use('INVOICES', ['orders']).connection.name, 'invoices');
  c.update('invoices', { files: [] });
  c.update('invoices', { enabled: false });
  assert.throws(() => c.use('invoices'), /turned off/);
  c.update('invoices', { enabled: true });
});

test('a draft is unusable until approved, and a secret is refused as a setting', async () => {
  const c = new Connections(dir);
  assert.throws(() => c.create({ name: 'k', type: 's3', config: { bucket: 'my-bucket', prefix: KEYS.accessKey } }), /looks like an AWS access key/);
  assert.throws(() => c.create({ name: 'k', type: 's3', config: { bucket: 'my-bucket', prefix: KEYS.secretKey } }), /looks like a secret key/);
  assert.throws(() => c.create({ name: 'k', type: 's3', config: { bucket: 'my-bucket', secretKey: 'abc' } }), /secretKey is a secret: it is typed into the console/);
  assert.throws(() => c.create({ name: 'k', type: 's3', config: { bucket: 'my-bucket', endpoint: 'https://AKIAIOSFODNN7EXAMPLE:abc@s3.example.com' } }), /looks like|Put no credentials/);
  assert.throws(() => c.create({ name: 'k', type: 's3', config: { bucket: 'my-bucket', endpoint: 'http://169.254.169.254' } }), /link-local/);
  assert.throws(() => c.create({ name: 'k', type: 's3', config: { bucket: 'my-bucket', endpoint: 'http://storage.example.com' } }), /Use https/);
  // Plain http only for a machine of your own, judged on the whole name, not its start.
  for (const e of ['http://10.attacker.example', 'http://localhost.attacker.example', 'http://192.168.attacker.example', 'http://127.0.0.1.nip.io', 'http://8.8.8.8', 'http://[2606:4700::1111]']) {
    assert.throws(() => c.create({ name: 'k', type: 's3', config: { bucket: 'my-bucket', endpoint: e } }), /Use https/, e);
  }
  // Cloud metadata services, however they are spelled.
  for (const e of ['http://[::ffff:169.254.169.254]/latest', 'http://[::ffff:a9fe:a9fe]/latest/meta-data', 'http://[fd00:ec2::254]', 'http://instance-data/latest', 'http://metadata.google.internal/computeMetadata', 'https://169.254.169.254']) {
    assert.throws(() => c.create({ name: 'k', type: 's3', config: { bucket: 'my-bucket', endpoint: e } }), /link-local/, e);
  }
  for (const e of ['http://localhost:9000', 'http://127.0.0.1:9000', 'http://[::1]:9000', 'http://10.1.2.3', 'http://minio:9000', 'http://nas.local', 'http://172.20.1.1', 'https://s3.example.com']) {
    const ok = c.create({ name: 'fine', type: 's3', config: { bucket: 'my-bucket', endpoint: e } });
    assert.equal(c.remove(ok.id), true, e);
  }
  assert.throws(() => c.create({ name: 'k', type: 's3', config: { bucket: 'my-bucket', prefix: 'a/../b' } }), /can't contain/);
  assert.throws(() => c.create({ name: 'invoices', type: 's3', config: { bucket: 'my-bucket' } }), /already a connection named invoices/);
  assert.throws(() => c.create({ name: '1bad', type: 's3', config: { bucket: 'my-bucket' } }), /Name it with letters/);
  assert.throws(() => c.create({ name: 'k', type: 'ftp', config: {} }), /no connection type "ftp"/);
  const draft = c.create({ name: 'by-ai', type: 's3', config: { bucket: 'my-bucket' } }, 'ai');
  assert.equal(draft.status, 'draft');
  assert.equal(draft.createdBy, 'ai');
  assert.throws(() => c.use('by-ai'), /has not been approved at the console yet/);
  assert.throws(() => c.approve('by-ai'), /Set Access key ID and Secret access key first/);
  assert.equal(c.remove('by-ai'), true);
});

test('a change that fails any check changes nothing, in memory or on disk', () => {
  const c = new Connections(dir);
  const draft = c.create({ name: 'half', type: 's3', config: { bucket: 'one' } }, 'ai');
  assert.throws(() => c.update('half', { name: 'renamed', config: { bucket: 'two' }, note: 'hi', enabled: true }), /Approve a draft/);
  const now = c.get('half')!;
  assert.equal(now.name, 'half');
  assert.equal(now.config.bucket, 'one');
  assert.equal(now.note, undefined);
  assert.throws(() => c.update('half', { name: 'renamed', config: { bucket: 'two', endpoint: 'http://8.8.8.8' } }), /Use https/);
  assert.equal(c.get('half')!.name, 'half');
  assert.equal(new Connections(dir).get('half')!.config.bucket, 'one');
  c.update('half', { note: 'ok' });
  assert.equal(c.get('half')!.note, 'ok');
  assert.equal(c.remove(draft.id), true);
});

test('a wrong secret is refused by the service in its own words, and a changed secrets file is noticed', async () => {
  const c = new Connections(dir);
  const made = c.create({ name: 'wrong', type: 's3', config: { bucket: 'invoices', endpoint: s3.endpoint } });
  c.setSecret('wrong', 'accessKey', KEYS.accessKey);
  c.setSecret('wrong', 'secretKey', 'not-the-secret');
  const t = await c.test('wrong');
  assert.equal(t.ok, false);
  assert.match(t.message, /403 SignatureDoesNotMatch/);
  assert.equal(c.get('wrong').lastTest?.ok, false);
  c.approve('wrong');
  // The same secret, sealed for another connection, opens nothing here.
  const file = join(dir, '.openhbam-connection-secrets.json');
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const other = Object.keys(doc.items).find((k) => !k.startsWith(made.id + '/'))!;
  doc.items[`${made.id}/secretKey`] = doc.items[other];
  writeFileSync(file, JSON.stringify(doc), { mode: 0o600 });
  assert.throws(() => c.use('wrong'), /can't be opened/);
  assert.equal(c.remove('wrong'), true);
});

test('with a passphrase the key stays out of the folder, and a missing passphrase is explained', async () => {
  const d = mkdtempSync(join(tmpdir(), 'tabularius-connections-pass-'));
  try {
    process.env.TABULARIUS_SECRETS_KEY = 'correct horse battery staple';
    const c = new Connections(d);
    c.create({ name: 'r2', type: 's3', config: { bucket: 'files', region: 'auto' } });
    c.setSecret('r2', 'accessKey', 'ak');
    assert.ok(!existsSync(join(d, '.openhbam-connections.key')));
    assert.equal(new Connections(d).list()[0].secrets[0].set, true);
    process.env.TABULARIUS_SECRETS_KEY = 'a different passphrase';
    const wrong = new Connections(d);
    assert.equal(wrong.list()[0].secrets[0].set, false);
    assert.match(wrong.problem ?? '', /doesn't open/);
    assert.throws(() => wrong.setSecret('r2', 'secretKey', 'sk'), /doesn't open/);
    delete process.env.TABULARIUS_SECRETS_KEY;
    assert.match(new Connections(d).problem ?? '', /TABULARIUS_SECRETS_KEY/);
  } finally {
    delete process.env.TABULARIUS_SECRETS_KEY;
    rmSync(d, { recursive: true });
  }
});

test('deleting a connection deletes its secrets', async () => {
  const listed = (await admin('GET', '/connections')).body.connections;
  const id = listed[0].id;
  assert.equal((await admin('DELETE', `/connections/${id}`)).status, 200);
  assert.equal((await admin('GET', `/connections/${id}`)).status, 404);
  const doc = JSON.parse(readFileSync(join(dir, '.openhbam-connection-secrets.json'), 'utf8'));
  assert.deepEqual(Object.keys(doc.items).filter((k) => k.startsWith(id + '/')), []);
});

test('a redirect is never followed: the signed headers would go to another host', async () => {
  let reached = 0;
  const other = createServer((req, res) => { reached++; res.end('secret-internal-data'); });
  await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
  const to = `http://127.0.0.1:${(other.address() as { port: number }).port}/latest/meta-data/`;
  const first = createServer((req, res) => res.writeHead(307, { location: to }).end());
  await new Promise<void>((r) => first.listen(0, '127.0.0.1', r));
  try {
    const res = await guardedFetch(`http://127.0.0.1:${(first.address() as { port: number }).port}/x`, { headers: { 'x-amz-security-token': 'T' } });
    assert.equal(res.status, 307);
    assert.equal(reached, 0);
  } finally {
    first.close();
    other.close();
  }
});

test('an edit does not resurrect a connection deleted by another store', () => {
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-connection-delete-'));
  try {
    const editor = new Connections(folder);
    const made = editor.create({ name: 'DeleteRace', type: 'rest', config: { baseUrl: 'https://example.com', auth: 'none' } });
    const remover = new Connections(folder);
    deleteBeforeStateLock(join(folder, '.openhbam-connections.json'), () => {
      assert.equal(remover.remove(made.id), true);
    }, () => { editor.update(made.id, { note: 'late edit' }); });
    assert.deepEqual(editor.list(), []);
    assert.deepEqual(new Connections(folder).list(), []);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('a connection test completing after deletion does not restore the connection or its secrets', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-connection-test-delete-'));
  try {
    const editor = new Connections(folder);
    const made = editor.create({ name: 'TestDeleteRace', type: 'rest', config: { baseUrl: 'https://example.com', auth: 'bearer' } });
    editor.setSecret(made.id, 'token', 'test-secret');
    const remover = new Connections(folder);
    let finish!: (response: Response) => void;
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => { started = resolve; });
    editor.io.fetch = async () => {
      started();
      return new Promise<Response>((resolve) => { finish = resolve; });
    };
    const pending = editor.test(made.id);
    await requestStarted;
    assert.equal(remover.remove(made.id), true);
    finish(new Response(null, { status: 200 }));
    assert.equal((await pending).ok, true);
    assert.deepEqual(editor.list(), []);
    assert.deepEqual(new Connections(folder).list(), []);
    const vault = JSON.parse(readFileSync(join(folder, '.openhbam-connection-secrets.json'), 'utf8'));
    assert.equal(Object.keys(vault.items).some((key) => key.startsWith(`${made.id}/`)), false);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

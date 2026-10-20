// A webhook URL must not point at a link-local / cloud-metadata endpoint
// (169.254.169.254, the classic server-side-request credential-theft target):
// such hosts are refused when a webhook is created. Loopback and private LAN
// ranges stay allowed, since a local or internal collector is legitimate.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { ChangeFeed, Webhooks, WebhookError, isInternalHost, NAME_LOOKUP } from '../src/changes.ts';
import type { Host } from '../src/host.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let host: Host;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-ssrf-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  host = s.host;
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

test('isInternalHost spots link-local and unspecified addresses, but not loopback, public or private-LAN hosts', () => {
  for (const h of ['169.254.169.254', '169.254.0.1', '0.0.0.0', '::', 'fe80::1', '[fe80::1]', '::ffff:169.254.169.254', '[::ffff:a9fe:a9fe]', 'fd00:ec2::254', 'metadata.google.internal', 'instance-data', 'METADATA.', '100.100.100.200']) {
    assert.equal(isInternalHost(h), true, `${h} is link-local/unspecified`);
  }
  for (const h of ['example.com', '93.184.216.34', '127.0.0.1', 'localhost', '10.0.0.5', '172.16.0.1', '192.168.1.10', '2606:4700::1111', '::ffff:7f00:1']) {
    assert.equal(isInternalHost(h), false, `${h} is allowed`);
  }
});

test('creating a webhook refuses link-local / metadata targets, allows ordinary ones', { skip }, () => {
  const hooks = new Webhooks(host, new ChangeFeed(host, { authorize() { throw new Error('unused'); } } as never), false);
  const refused = (url: string) => assert.throws(() => hooks.create({ url, database: 'Charts' }),
    (e) => e instanceof WebhookError && /link-local|metadata/i.test(e.message), `${url} should be refused`);
  refused('http://169.254.169.254/latest/meta-data/');
  refused('http://[fe80::1]/hook');
  // A public destination is accepted.
  const made = hooks.create({ url: 'https://example.invalid/hook', database: 'Charts' });
  assert.ok(made.id && made.secret);
  hooks.remove(made.id);
});

test('delivery refuses a name that resolves to the link-local range, without sending anything', async () => {
  const seen: string[] = [];
  const before = NAME_LOOKUP.lookup;
  NAME_LOOKUP.lookup = async (name) => {
    seen.push(name);
    return [{ address: '169.254.169.254' }];
  };
  try {
    const hooks = new Webhooks({ dir: tmpdir() } as Host, { subscribe() {} } as unknown as ChangeFeed, true);
    await assert.rejects(hooks.fetch('http://metadata-alias.example.invalid/hook', { method: 'POST', body: '{}' }), /link-local/);
    assert.deepEqual(seen, ['metadata-alias.example.invalid']);
  } finally {
    NAME_LOOKUP.lookup = before;
  }
});

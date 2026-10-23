// `tabularius doctor --exposure`: what a running server is open to. The checks ask through probes, so each case here
// answers for a made-up network; one case starts a real server on loopback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createStore } from '../../store/src/index.ts';
import { serve } from '../../server/src/index.ts';
import { doctorText } from '../src/doctor.ts';
import { realProbes, runExposure, type Answer, type Probes } from '../src/exposure.ts';

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Answer => ({ status, headers, body: JSON.stringify(body) });
const HEADERS = { 'permissions-policy': 'camera=(self)', 'referrer-policy': 'no-referrer' };

/** A server as the probes see it. `routes` is keyed by "METHOD path". */
function fake(o: { origin?: string; routes?: Record<string, Answer>; open?: string[]; addresses?: string[]; ssl?: 'S' | 'N' } = {}): Probes {
  const origin = o.origin ?? 'http://127.0.0.1:8080';
  const routes: Record<string, Answer> = {
    'GET /tabularius/health': json(200, { status: 'ok' }, HEADERS),
    'GET /.well-known/oauth-protected-resource': json(200, { authorization_servers: [origin] }),
    'GET /tabularius/admin/v1/sign-in-info': json(200, { passwordSet: true }),
    'GET /tabularius/admin/v1/status': json(401, { error: 'sign in' }),
    'POST /mcp': json(401, { error: 'unauthorized' }),
    ...o.routes,
  };
  return {
    ask: async (url, init) => routes[`${init?.method ?? 'GET'} ${new URL(url).pathname}`],
    open: async (host, port) => (o.open ?? []).includes(`${host}:${port}`),
    sslAnswer: async () => o.ssl,
    addresses: () => o.addresses ?? ['192.168.1.5'],
  };
}
const by = (checks: { name: string }[], name: string) => checks.find((c) => c.name === name) as { name: string; level: string; message: string; fix?: string };

test('a server on loopback with a password, no token for the connector and nothing else open: what was seen is ok, what was not seen is never ok', async () => {
  const checks = await runExposure({ probes: fake(), env: {} });
  assert.deepEqual(checks.filter((c) => c.level !== 'ok').map((c) => c.name).sort(), ['Console cookie', 'SQL port', 'Trusted proxies']);
  for (const name of ['Console cookie', 'SQL port', 'Trusted proxies']) assert.equal(by(checks, name).level, 'warn', name);
  assert.match(by(checks, 'Console cookie').message, /not observed/);
  assert.match(by(checks, 'SQL port').message, /not checked/);
  assert.match(by(checks, 'Trusted proxies').message, /not checked/);
  assert.match(by(checks, 'Listening').message, /only this computer/);
  assert.match(by(checks, 'MCP').message, /refuses/);
  assert.match(by(checks, 'Admin console').message, /answered 401/);
});

test('nothing answering is one problem that says what to do, and nothing else is asked', async () => {
  const checks = await runExposure({ probes: fake({ routes: { 'GET /tabularius/health': undefined as never } }) });
  assert.equal(checks.length, 1);
  assert.equal(checks[0].level, 'problem');
  assert.match(checks[0].fix!, /--url/);
});

test('a server that also listens on a network address, over plain HTTP, is a problem with the fix to serve HTTPS or loop back', async () => {
  const checks = await runExposure({ probes: fake({ open: ['192.168.1.5:8080'] }) });
  assert.equal(by(checks, 'Listening').level, 'warn');
  assert.match(by(checks, 'Listening').message, /192\.168\.1\.5:8080/);
  assert.match(by(checks, 'Listening').fix!, /--host 127\.0\.0\.1/);
  assert.equal(by(checks, 'Plain HTTP').level, 'problem');
  assert.match(by(checks, 'Plain HTTP').fix!, /--https/);
  assert.equal(by(checks, 'Console cookie').level, 'problem');
  assert.equal(by(checks, 'Admin console').level, 'warn');
});

test('HTTPS: HSTS present is ok, missing is a warning; the console cookie is Secure and __Host-', async () => {
  const origin = 'https://files.example.test:8443';
  const withHsts = await runExposure({ url: origin, probes: fake({ origin, addresses: ['10.0.0.2'], routes: { 'GET /tabularius/health': json(200, { status: 'ok' }, { ...HEADERS, 'strict-transport-security': 'max-age=31536000' }) } }) });
  assert.equal(by(withHsts, 'HSTS').level, 'ok');
  assert.equal(by(withHsts, 'Plain HTTP').message, 'HTTPS');
  // Nothing signs in, so the cookie's flags are what the server is built to set, not something seen.
  assert.equal(by(withHsts, 'Console cookie').level, 'warn');
  assert.match(by(withHsts, 'Console cookie').message, /not observed.*__Host-tabularius_admin/);
  const without = await runExposure({ url: origin, probes: fake({ origin, addresses: ['10.0.0.2'] }) });
  assert.equal(by(without, 'HSTS').level, 'warn');
  // Not this computer: the check says it cannot tell what the server listens on, instead of saying it is safe.
  assert.equal(by(without, 'Listening').level, 'warn');
  assert.match(by(without, 'Listening').message, /not this computer/);
});

test('no admin password, and a console that answers without a sign-in when there is one', async () => {
  const none = await runExposure({ probes: fake({ routes: { 'GET /tabularius/admin/v1/sign-in-info': json(200, { passwordSet: false }), 'GET /tabularius/admin/v1/status': json(200, {}) } }) });
  assert.equal(by(none, 'Admin console').level, 'warn');
  assert.match(by(none, 'Admin console').fix!, /admin-password/);
  const open = await runExposure({ probes: fake({ routes: { 'GET /tabularius/admin/v1/status': json(200, {}) } }) });
  assert.equal(by(open, 'Admin console').level, 'problem');
});

test('the console API is only called protected when it was seen to answer 401', async () => {
  for (const status of [undefined, json(500, {}), json(404, {})]) {
    const checks = await runExposure({ probes: fake({ routes: { 'GET /tabularius/admin/v1/status': status as never } }) });
    assert.equal(by(checks, 'Admin console').level, 'warn', String(status?.status));
    assert.match(by(checks, 'Admin console').message, /could not confirm/);
    assert.doesNotMatch(by(checks, 'Admin console').message, /needs the password/);
  }
  // Open, and nobody can say whether a password is set.
  const unknown = await runExposure({ probes: fake({ routes: { 'GET /tabularius/admin/v1/sign-in-info': undefined as never, 'GET /tabularius/admin/v1/status': json(200, {}) } }) });
  assert.equal(by(unknown, 'Admin console').level, 'warn');
  assert.match(by(unknown, 'Admin console').message, /without a sign-in/);
  // Seen to refuse, even when the sign-in page did not say whether a password is set.
  const refused = await runExposure({ probes: fake({ routes: { 'GET /tabularius/admin/v1/sign-in-info': undefined as never } }) });
  assert.equal(by(refused, 'Admin console').level, 'ok');
});

test('a connector that does not answer is reported, not left out', async () => {
  const checks = await runExposure({ probes: fake({ routes: { 'POST /mcp': undefined as never } }) });
  assert.equal(by(checks, 'MCP').level, 'warn');
  assert.match(by(checks, 'MCP').message, /did not answer.*not checked/);
});

test('a connector that answers without a token is a problem', async () => {
  const checks = await runExposure({ probes: fake({ routes: { 'POST /mcp': json(200, { result: {} }) } }) });
  assert.equal(by(checks, 'MCP').level, 'problem');
  assert.match(by(checks, 'MCP').fix!, /mcp-token/);
});

test('the public URL: links that name another address, with no --public-url, are a warning that gives the flag', async () => {
  const checks = await runExposure({ probes: fake({ routes: { 'GET /.well-known/oauth-protected-resource': json(200, { authorization_servers: ['http://10.1.1.1:8080'] }) } }) });
  assert.equal(by(checks, 'Public URL').level, 'warn');
  assert.match(by(checks, 'Public URL').fix!, /--public-url http:\/\/127\.0\.0\.1:8080/);
});

test('the SQL port: on this computer only is ok; on the network with no TLS is a problem; named by the service or by --sql-port', async () => {
  const quiet = await runExposure({ sqlPort: 5433, probes: fake({ open: ['127.0.0.1:5433'], ssl: 'N' }) });
  assert.equal(by(quiet, 'SQL port').level, 'ok');
  const exposed = await runExposure({ sqlPort: 5433, probes: fake({ open: ['127.0.0.1:5433', '192.168.1.5:5433'], ssl: 'N' }) });
  assert.equal(by(exposed, 'SQL port').level, 'problem');
  assert.match(by(exposed, 'SQL port').message, /unencrypted/);
  const tls = await runExposure({ sqlPort: 5433, probes: fake({ open: ['127.0.0.1:5433', '192.168.1.5:5433'], ssl: 'S' }) });
  assert.equal(by(tls, 'SQL port').level, 'warn');
  const named = await runExposure({ service: { platform: 'linux', folder: '/f', port: 8080, host: '127.0.0.1', system: false, extra: ['--sql-port', '5433'] }, probes: fake({ open: ['127.0.0.1:5433'] }) });
  assert.match(by(named, 'SQL port').message, /5433/);
  const unnamed = by(await runExposure({ probes: fake() }), 'SQL port');
  assert.equal(unnamed.level, 'warn');
  assert.match(unnamed.message, /not checked.*--sql-port/);
});

test('the SQL port is tried where the server is: the address in --url, the service host, another computer', async () => {
  // A server on one network address is not on 127.0.0.1, and the check must not say the port is closed.
  const onAddress = await runExposure({ url: 'http://192.168.1.5:8080', sqlPort: 5433, probes: fake({ origin: 'http://192.168.1.5:8080', open: ['192.168.1.5:8080', '192.168.1.5:5433'], ssl: 'N' }) });
  assert.equal(by(onAddress, 'SQL port').level, 'problem');
  assert.match(by(onAddress, 'SQL port').message, /192\.168\.1\.5/);
  // Another computer: the port is tried at that host, and an open one is reached over the network.
  const remote = await runExposure({ url: 'http://db.example.test:8080', sqlPort: 5433, probes: fake({ origin: 'http://db.example.test:8080', open: ['db.example.test:5433'], ssl: 'N' }) });
  assert.equal(by(remote, 'SQL port').level, 'problem');
  const closed = await runExposure({ url: 'http://db.example.test:8080', sqlPort: 5433, probes: fake({ origin: 'http://db.example.test:8080' }) });
  assert.equal(by(closed, 'SQL port').level, 'ok');
  assert.match(by(closed, 'SQL port').message, /db\.example\.test/);
  // The installed service says which address it listens on, and that is where the checks go.
  const service = { platform: 'linux' as const, folder: '/f', port: 8080, host: '192.168.1.5', system: false, extra: ['--sql-port', '5433'] };
  const hosted = await runExposure({ service, probes: fake({ open: ['192.168.1.5:8080', '192.168.1.5:5433'], ssl: 'S' }) });
  assert.match(by(hosted, 'Server').message, /192\.168\.1\.5:8080/);
  assert.equal(by(hosted, 'SQL port').level, 'warn');
  // Loopback IPv6 only.
  const v6 = await runExposure({ sqlPort: 5433, probes: fake({ open: ['::1:5433'], ssl: 'N' }) });
  assert.equal(by(v6, 'SQL port').level, 'ok');
});

test('trusted proxies come from the installed service: a /0 range is a problem, a named proxy is ok, none says so', async () => {
  const service = (extra: string[]) => ({ platform: 'linux' as const, folder: '/f', port: 8080, host: '127.0.0.1', system: false, extra });
  assert.equal(by(await runExposure({ service: service(['--trusted-proxies', '10.0.0.0/0']), probes: fake() }), 'Trusted proxies').level, 'problem');
  assert.match(by(await runExposure({ service: service(['--trusted-proxies', '10.0.0.7']), probes: fake() }), 'Trusted proxies').message, /10\.0\.0\.7 only/);
  assert.match(by(await runExposure({ service: service([]), probes: fake() }), 'Trusted proxies').message, /^none/);
  const without = by(await runExposure({ probes: fake(), env: {} }), 'Trusted proxies');
  assert.equal(without.level, 'warn');
  assert.match(without.message, /not checked/);
});

test('trusted proxies are also read from TABULARIUS_TRUSTED_PROXIES, and every /0 range is a problem', async () => {
  const service = (extra: string[]) => ({ platform: 'linux' as const, folder: '/f', port: 8080, host: '127.0.0.1', system: false, extra });
  const env = { TABULARIUS_TRUSTED_PROXIES: '10.0.0.7, ::/0' };
  const fromEnv = by(await runExposure({ probes: fake(), env }), 'Trusted proxies');
  assert.equal(fromEnv.level, 'problem');
  assert.match(fromEnv.message, /::\/0/);
  assert.match(fromEnv.message, /TABULARIUS_TRUSTED_PROXIES/);
  // The service's flag wins over the environment, as it does at start.
  assert.equal(by(await runExposure({ service: service(['--trusted-proxies=10.0.0.9']), probes: fake(), env }), 'Trusted proxies').level, 'ok');
  assert.equal(by(await runExposure({ service: service([]), probes: fake(), env }), 'Trusted proxies').level, 'problem');
  assert.equal(by(await runExposure({ probes: fake(), env: { TABULARIUS_TRUSTED_PROXIES: '10.0.0.7' } }), 'Trusted proxies').level, 'ok');
  // A whole address space written without the /0.
  assert.equal(by(await runExposure({ probes: fake(), env: { TABULARIUS_TRUSTED_PROXIES: '0.0.0.0/0' } }), 'Trusted proxies').level, 'problem');
});

test('a real server on loopback: reachable only from this computer, the connector refuses, and the text names what to do about the missing password', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-exposure-'));
  createStore(join(dir, 'Demo.openhbam.sqlite'), { mode: 'native' });
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    const checks = await runExposure({ url: s.url, probes: realProbes });
    assert.equal(by(checks, 'Server').level, 'ok');
    assert.equal(by(checks, 'Plain HTTP').level, 'ok');
    assert.equal(by(checks, 'MCP').level, 'ok');
    assert.equal(by(checks, 'Browser headers').level, 'ok');
    assert.equal(by(checks, 'Admin console').level, 'warn');
    assert.equal(checks.some((c) => c.level === 'problem'), false);
    assert.match(doctorText(checks), /admin-password/);
  } finally { await new Promise<void>((r) => s.server.close(() => r())); rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

test('the command runs, prints the findings and exits 1 only on a problem', () => {
  const main = join(import.meta.dirname, '../src/main.ts');
  const r = spawnSync(process.execPath, ['--no-warnings', main, 'doctor', '--exposure', '--url', 'http://127.0.0.1:1'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /PROBLEM Server: nothing answers at http:\/\/127\.0\.0\.1:1/);
});

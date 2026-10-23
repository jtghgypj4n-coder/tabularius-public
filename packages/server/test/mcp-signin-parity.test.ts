import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { serve, type ServeOptions } from '../src/index.ts';
import { McpTokens } from '../src/mcp-tokens.ts';
import { totpCode } from '../../store/src/index.ts';
import { expiryClock, ExpiryClock } from '../../store/src/clock.ts';

async function setup(t: TestContext, options: Partial<ServeOptions> = {}) {
  const dir = mkdtempSync(join(import.meta.dirname, '.mcp-signin-parity-'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, ...options });
  t.after(async () => {
    await new Promise<void>((resolve) => s.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });
  const a = s.host.create('A');
  a.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Title' }] }]);
  a.create('Items', { Title: 'AUDIT_PROTECTED_RECORD' });
  a.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest', 'fmapp', 'fmmcp'] });
  a.setPassword('alice', 'alice-password', 'Reader');
  return { ...s, a, dir };
}

const basic = (account: string, password: string) => `Basic ${Buffer.from(`${account}:${password}`).toString('base64')}`;
async function login(base: string, database: string, authorization: string, body: object = {}) {
  return fetch(`${base}/fmi/data/vLatest/databases/${database}/sessions`, {
    method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
async function tool(base: string, authorization: string, name: string, args: object, otp?: string) {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST', headers: { authorization, ...(otp ? { 'x-tabularius-otp': otp } : {}), 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  return { status: response.status, body: await response.json() };
}

test('MCP password cache lasts five elapsed minutes through wall-clock jumps', async (t) => {
  const { a, url } = await setup(t, { mcpToken: 'separate-admin-secret' });
  let wall = Date.now(), mono = performance.now();
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => mono);
  const verify = t.mock.method(a, 'verify');
  const call = () => tool(url, basic('alice', 'alice-password'), 'get_record', { database: 'A', layout: 'Items', recordId: 1 });
  assert.equal((await call()).body.result?.isError, undefined);
  const checked = verify.mock.callCount();
  assert.ok(checked > 0);
  wall += 3600_000;
  mono += 1000;
  assert.equal((await call()).body.result?.isError, undefined);
  assert.equal(verify.mock.callCount(), checked, 'a forward jump does not expire the proof');
  wall -= 7200_000;
  mono += 5 * 60_000;
  assert.equal((await call()).body.result?.isError, undefined);
  assert.ok(verify.mock.callCount() > checked, 'a backward jump cannot extend the proof');
});

test('MCP Bearer expiry cannot be revived by rolling back the wall clock', async (t) => {
  const { a, host, dir, url } = await setup(t);
  let wall = Date.now(), mono = performance.now();
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => mono);
  const clock = new ExpiryClock();
  t.mock.method(expiryClock, 'now', () => clock.now());
  const tokens = new McpTokens(dir, undefined, (database, account) => { const s = host.get(database); return s?.identityAllowed(account) ? s.accountIdentityId(account) : undefined; });
  const issued = tokens.create({ database: a.name, account: 'alice', days: 1 / 1440 });
  const call = () => tool(url, `Bearer ${issued.token}`, 'get_record', { database: 'A', layout: 'Items', recordId: 1 });
  assert.equal((await call()).status, 200);
  wall += 120_000;
  mono += 120_000;
  assert.equal((await call()).status, 401);
  wall -= 3600_000;
  assert.equal((await call()).status, 401);
});

test('MCP Basic requires the enrolled second factor before reading data', async (t) => {
  const { a, url } = await setup(t, { mcpToken: 'separate-admin-secret' });
  const { secret } = a.enrollTotp('alice');
  a.confirmTotp('alice', totpCode(secret));
  const auth = basic('alice', 'alice-password');
  const rest = await login(url, 'A', auth);
  assert.equal(rest.status, 401);
  assert.equal((await rest.json()).messages[0].code, '1211');
  const mcp = await tool(url, auth, 'get_record', { database: 'A', layout: 'Items', recordId: 1 });
  t.diagnostic(`Data API without OTP: 401/1211; MCP without OTP: ${JSON.stringify(mcp)}`);
  assert.ok(mcp.status === 401 || mcp.body.result?.isError, 'MCP accepted the password alone and returned the protected record');
  const withOtp = await tool(url, auth, 'get_record', { database: 'A', layout: 'Items', recordId: 1 }, totpCode(secret));
  assert.equal(withOtp.body.result?.isError, undefined, 'MCP should accept the enrolled second factor');
  assert.match(JSON.stringify(withOtp.body), /AUDIT_PROTECTED_RECORD/);
});

test('MCP Basic refuses a wrong or replayed one-time code', async (t) => {
  const { a, url } = await setup(t, { mcpToken: 'separate-admin-secret' });
  const { secret } = a.enrollTotp('alice');
  assert.equal(a.confirmTotp('alice', totpCode(secret)), true);
  const auth = basic('alice', 'alice-password');
  const args = { database: 'A', layout: 'Items', recordId: 1 };

  const wrong = await tool(url, auth, 'get_record', args, 'not-a-code');
  assert.equal(wrong.body.result?.isError, true);
  assert.doesNotMatch(JSON.stringify(wrong.body), /AUDIT_PROTECTED_RECORD/);

  const code = totpCode(secret);
  const first = await tool(url, auth, 'get_record', args, code);
  assert.equal(first.body.result?.isError, undefined);
  assert.match(JSON.stringify(first.body), /AUDIT_PROTECTED_RECORD/);
  const replay = await tool(url, auth, 'get_record', args, code);
  assert.equal(replay.body.result?.isError, true);
  assert.doesNotMatch(JSON.stringify(replay.body), /AUDIT_PROTECTED_RECORD/);
});

test('MCP Basic rejects an old code after TOTP reset', async (t) => {
  const { a, url } = await setup(t, { mcpToken: 'separate-admin-secret' });
  const { secret } = a.enrollTotp('alice');
  assert.equal(a.confirmTotp('alice', totpCode(secret)), true);
  const auth = basic('alice', 'alice-password');
  const args = { database: 'A', layout: 'Items', recordId: 1 };
  const oldCode = totpCode(secret);
  assert.equal((await tool(url, auth, 'get_record', args, oldCode)).body.result?.isError, undefined);

  assert.equal(a.disableTotp('alice'), true);
  const replacement = a.enrollTotp('alice');
  assert.equal(a.confirmTotp('alice', totpCode(replacement.secret)), true);
  const stale = await tool(url, auth, 'get_record', args, oldCode);
  assert.equal(stale.body.result?.isError, true);
  assert.doesNotMatch(JSON.stringify(stale.body), /AUDIT_PROTECTED_RECORD/);
  const current = await tool(url, auth, 'get_record', args, totpCode(replacement.secret));
  assert.equal(current.body.result?.isError, undefined);
});

test('MCP Basic loses access after password change or account disable', async (t) => {
  const { a, url } = await setup(t, { mcpToken: 'separate-admin-secret' });
  const { secret } = a.enrollTotp('alice');
  assert.equal(a.confirmTotp('alice', totpCode(secret)), true);
  const args = { database: 'A', layout: 'Items', recordId: 1 };
  const code = totpCode(secret);
  assert.equal((await tool(url, basic('alice', 'alice-password'), 'get_record', args, code)).body.result?.isError, undefined);

  a.setPassword('alice', 'replacement-password');
  const oldPassword = await tool(url, basic('alice', 'alice-password'), 'get_record', args, code);
  assert.equal(oldPassword.body.result?.isError, true);
  const replay = await tool(url, basic('alice', 'replacement-password'), 'get_record', args, code);
  assert.equal(replay.body.result?.isError, true);

  assert.equal(a.setAccountActive('alice', false), true);
  const disabled = await tool(url, basic('alice', 'replacement-password'), 'get_record', args, totpCode(secret, Math.floor(Date.now() / 30_000) + 1));
  assert.equal(disabled.body.result?.isError, true);
  assert.doesNotMatch(JSON.stringify(disabled.body), /AUDIT_PROTECTED_RECORD/);
});

test('an arbitrary OTP does not reveal hosted file names', async (t) => {
  const { a, url } = await setup(t, { mcpToken: 'separate-admin-secret' });
  const { secret } = a.enrollTotp('alice');
  assert.equal(a.confirmTotp('alice', totpCode(secret)), true);
  const result = await tool(url, basic('alice', 'alice-password'), 'find_records', { database: 'Missing', layout: 'Items' }, 'not-a-code');
  assert.equal(result.body.result?.isError, true);
  assert.doesNotMatch(JSON.stringify(result.body), /Hosted: A|AUDIT_PROTECTED_RECORD/);
});

test('a configured ohm_-prefixed MCP administrator token works', async (t) => {
  const token = 'ohm_operator-configured-secret';
  const { url } = await setup(t, { mcpToken: token });
  const result = await tool(url, `Bearer ${token}`, 'get_record', { database: 'A', layout: 'Items', recordId: 1 });
  assert.equal(result.body.result?.isError, undefined);
  assert.match(JSON.stringify(result.body), /AUDIT_PROTECTED_RECORD/);
});

test('revoked and expired ohm tokens keep their next request signed out', async (t) => {
  const { a, host, dir, url } = await setup(t);
  const b = host.create('B');
  b.applyDesign([{ op: 'createTable', name: 'Vault', fields: [{ name: 'Secret' }] }]);
  b.create('Vault', { Secret: 'OTHER_FILE_ADMIN_SECRET' });
  const tokens = new McpTokens(dir, undefined, (database, account) => { const s = host.get(database); return s?.identityAllowed(account) ? s.accountIdentityId(account) : undefined; });
  const issued = tokens.create({ database: a.name, account: 'alice' });
  const auth = `Bearer ${issued.token}`;
  const denied = await tool(url, auth, 'get_record', { database: 'B', layout: 'Vault', recordId: 1 });
  assert.equal(denied.body.result.isError, true);
  assert.equal(tokens.revoke(issued.id), true);
  const after = await tool(url, auth, 'get_record', { database: 'B', layout: 'Vault', recordId: 1 });
  t.diagnostic(`Before revoke: ${JSON.stringify(denied)}; after revoke: ${JSON.stringify(after)}`);
  assert.equal(after.status, 401, 'revoked scoped credential was promoted to loopback administrator');
  const expiring = tokens.create({ database: a.name, account: 'alice', days: 0.000001 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const expired = await tool(url, `Bearer ${expiring.token}`, 'get_record', { database: 'B', layout: 'Vault', recordId: 1 });
  assert.equal(expired.status, 401, 'expired scoped credential was promoted to loopback administrator');
});

import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { join } from 'node:path';
import { serve, type ServeOptions } from '../src/index.ts';
import { totpCode } from '../../store/src/index.ts';

async function setup(t: TestContext, options: Partial<ServeOptions> = {}) {
  const dir = mkdtempSync(join(import.meta.dirname, '.signin-parity-'));
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
test('fmDataSource login must enforce the target account second factor', async (t) => {
  const { a, host, url } = await setup(t);
  const b = host.create('B');
  b.applyDesign([{ op: 'createTable', name: 'Vault', fields: [{ name: 'Secret' }] }]);
  b.create('Vault', { Secret: 'SECOND_FACTOR_PROTECTED_SECRET' });
  const full = b.privilegeSets().find((p) => p.id === 1)!;
  b.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest'])] });
  b.setPassword('victim', 'victim-password', full.name);
  const { secret } = b.enrollTotp('victim');
  b.confirmTotp('victim', totpCode(secret));
  const direct = await login(url, 'B', basic('victim', 'victim-password'));
  assert.equal(direct.status, 401);
  assert.equal((await direct.json()).messages[0].code, '1211');
  const table = b.schema.tables.find((x) => x.name === 'Vault')!;
  a.applyDesign([
    { op: 'createDataSource', name: 'B', paths: ['file:B'] },
    { op: 'createOccurrence', name: 'BVault', file: 'B', externalTable: table.id },
  ]);
  // The layout must show the field, else an empty fieldData proves nothing.
  const occ = a.schema.tableOccurrences.find((x) => x.name === 'BVault')!;
  const secretField = table.fields.find((f) => f.name === 'Secret')!;
  a.applyDesign([{ op: 'createLayout', name: 'ExternalVault', occurrence: occ.id, design: { objects: [
    { id: 1, kind: 'field', type: 1, bounds: { top: 10, left: 10, bottom: 32, right: 200 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {},
      field: { tableOccurrenceId: occ.id, fieldId: secretField.id, tableOccurrence: 'BVault', field: 'Secret', display: 'edit', repetitions: 1 } },
  ] } } as never]);
  const indirect = await login(url, 'A', basic('alice', 'alice-password'), { fmDataSource: [{ database: 'B', username: 'victim', password: 'victim-password' }] });
  const body = await indirect.json();
  let leaked = '';
  if (body.response?.token) {
    const read = await fetch(`${url}/fmi/data/vLatest/databases/A/layouts/ExternalVault/records`, { headers: { authorization: `Bearer ${body.response.token}` } });
    leaked = await read.text();
  }
  t.diagnostic(`Direct B login: 401/1211; fmDataSource login: ${indirect.status}; external read: ${leaked}`);
  assert.equal(indirect.status, 401, 'fmDataSource accepted the MFA-enrolled account on its password alone');
  assert.ok(!leaked.includes('SECOND_FACTOR_PROTECTED_SECRET'), 'password-only fmDataSource authentication exposed the MFA-protected file');
});

async function provider(t: TestContext) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let issuer = '';
  let claims: Record<string, unknown> = {};
  const codes = new Map<string, { nonce: string; challenge: string }>();
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const idp = createServer(async (req, res) => {
    const send = (body: object) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (req.url === '/.well-known/openid-configuration') return void send({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    if (req.url === '/jwks') return void send({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'audit', alg: 'RS256', use: 'sig' }] });
    if (req.url === '/token') {
      let body = ''; for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      const pending = codes.get(form.get('code')!);
      if (!pending || createHash('sha256').update(form.get('code_verifier')!).digest('base64url') !== pending.challenge) return void res.writeHead(400).end();
      const now = Math.floor(Date.now() / 1000);
      const signed = `${b64({ alg: 'RS256', kid: 'audit' })}.${b64({ iss: issuer, aud: 'audit-client', sub: 'subject-7', exp: now + 300, iat: now, nonce: pending.nonce, ...claims })}`;
      return void send({ id_token: `${signed}.${sign('sha256', Buffer.from(signed), privateKey).toString('base64url')}` });
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => idp.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(idp.address() as { port: number }).port}`;
  t.after(() => new Promise<void>((resolve) => idp.close(() => resolve())));
  const config = { name: 'Audit IdP', issuer, clientId: 'audit-client', dataApiReturnUrls: ['https://app.example/callback'] };
  async function grant(base: string, person: Record<string, unknown>) {
    claims = person;
    const start = await fetch(`${base}/oauth/getoauthurl?trackingID=audit&provider=Audit%20IdP`, { headers: { 'x-fms-application-type': '9', 'x-fms-application-version': '15', 'x-fms-return-url': 'https://app.example/callback' } });
    assert.equal(start.status, 200, await start.clone().text());
    const auth = new URL(await start.text());
    const code = `code-${codes.size}`;
    codes.set(code, { nonce: auth.searchParams.get('nonce')!, challenge: auth.searchParams.get('code_challenge')! });
    const callback = await fetch(`${base}/tabularius/auth/v1/oidc/callback?state=${auth.searchParams.get('state')}&code=${code}`, { redirect: 'manual' });
    assert.equal(callback.status, 302);
    const back = new URL(callback.headers.get('location')!);
    assert.ok(back.searchParams.get('identifier'), back.toString());
    return { 'x-fm-data-oauth-request-id': start.headers.get('x-fms-request-id')!, 'x-fm-data-oauth-identifier': back.searchParams.get('identifier')! };
  }
  return { config, grant };
}

test('Data API OAuth requires a trusted email and binds mapped sessions to that person', async (t) => {
  const idp = await provider(t);
  const { a, url } = await setup(t, { oidc: idp.config });
  a.setExternalAccount('Staff', 'Reader');
  a.setPassword('offboarded@example.test', 'not-used', 'Reader');
  a.setAccountActive('offboarded@example.test', true);
  const headers = await idp.grant(url, { email: 'offboarded@example.test', email_verified: false, groups: ['Staff'] });
  const response = await fetch(`${url}/fmi/data/vLatest/databases/A/sessions`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' });
  const body = await response.json();
  let read = '';
  if (body.response?.token) read = await (await fetch(`${url}/fmi/data/vLatest/databases/A/layouts/Items/records`, { headers: { authorization: `Bearer ${body.response.token}` } })).text();
  t.diagnostic(`Signed unverified email with Staff group: login ${response.status}; read ${read}`);
  assert.equal(response.status, 401, 'group-only Data API OAuth bypassed trusted-person and deactivation requirements');

  const verifiedHeaders = await idp.grant(url, { email: 'offboarded@example.test', email_verified: true, groups: ['Staff'] });
  const verified = await fetch(`${url}/fmi/data/vLatest/databases/A/sessions`, { method: 'POST', headers: { ...verifiedHeaders, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(verified.status, 200);
  const token = (await verified.json()).response.token;
  a.setAccountActive('offboarded@example.test', false);
  const afterDeactivation = await fetch(`${url}/fmi/data/vLatest/databases/A/layouts/Items/records`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(afterDeactivation.status, 401, 'a Data API OAuth session remained usable after its person was deactivated');
});

test('identity provider sessions must not manage local account credentials', async (t) => {
  const idp = await provider(t);
  const { a, url } = await setup(t, { oidc: idp.config });
  const full = a.privilegeSets().find((p) => p.id === 1)!;
  a.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmrest'])] });
  a.setPassword('person@example.test', 'local-secret-not-known-to-idp-user', full.name);
  a.setExternalAccount('@example.test', 'Reader');
  const headers = await idp.grant(url, { email: 'person@example.test', email_verified: true, groups: [] });
  const response = await fetch(`${url}/fmi/data/vLatest/databases/A/sessions`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200);
  const token = (await response.json()).response.token;
  const issued = await fetch(`${url}/fmi/data/vLatest/databases/A/recovery-codes`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
  const codes = await issued.json();
  const options = await fetch(`${url}/fmi/data/vLatest/databases/A/passkey/register/options`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  const optionsBody = await options.json();
  let escalation = '';
  if (codes.response?.codes?.length) {
    const recovered = await fetch(`${url}/fmi/data/vLatest/databases/A/sessions/recovery`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: 'person@example.test', code: codes.response.codes[0] }) });
    const local = await recovered.json();
    if (local.response?.token) {
      const write = await fetch(`${url}/fmi/data/vLatest/databases/A/layouts/Items/records/1`, { method: 'PATCH', headers: { authorization: `Bearer ${local.response.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ fieldData: { Title: 'ESCALATED_WRITE' } }) });
      escalation = `${write.status} ${await write.text()}`;
    }
  }
  t.diagnostic(`Reader SSO recovery-code issue: ${issued.status}; passkey registration options: ${options.status}; recovered local-account write: ${escalation}; final record: ${a.get('Items', 1).fieldData.Title}`);
  assert.equal(issued.status, 403);
  assert.equal(codes.messages?.[0]?.code, '9');
  assert.match(codes.messages?.[0]?.message ?? '', /identity provider/i);
  assert.equal(options.status, 403);
  assert.equal(optionsBody.messages?.[0]?.code, '9');
  assert.notEqual(a.get('Items', 1).fieldData.Title, 'ESCALATED_WRITE', 'SSO mapping privileges escalated to the separate local account');
});

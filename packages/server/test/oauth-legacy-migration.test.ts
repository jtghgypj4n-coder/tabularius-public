// Synthetic OAuth/MCP conformance probes: generated hosted file, no corpus or child processes.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import { createStore, type Store } from '../../store/src/index.ts';
import { OAuthServer } from '../src/oauth.ts';
import type { Host } from '../src/host.ts';
import { serve } from '../src/index.ts';

let dir: string, base: string, server: Server, store: Store, host: Host;
const redirect = 'https://client.example/callback';
const encode = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) => fetch(`${base}${path}`, {
  method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: encode(fields),
});
const register = async (extra: Record<string, unknown> = {}) => {
  const response = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Synthetic client', redirect_uris: [redirect], ...extra }) });
  assert.equal(response.status, 201, await response.clone().text());
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return (await response.json()) as { client_id: string; client_secret?: string };
};
const params = (client_id: string, challenge: string, target = redirect, resource = `${base}/mcp`) => ({
  client_id, redirect_uri: target, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource, state: 's', scope: 'mcp',
});
const hidden = (html: string) => Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&')]));
async function authorize(client_id: string, challenge: string, overrides: Record<string, string> = {}) {
  const p = { ...params(client_id, challenge), ...overrides };
  const page = await fetch(`${base}/oauth/authorize?${encode(p)}`, { redirect: 'manual' });
  const html = await page.text();
  const cookie = page.headers.get('set-cookie')?.split(';')[0] ?? '';
  return { page, html, cookie, fields: hidden(html), p };
}
async function grant(client_id: string, challenge: string, overrides: Record<string, string> = {}) {
  const a = await authorize(client_id, challenge, overrides);
  assert.equal(a.page.status, 200);
  const response = await post('/oauth/authorize', { ...a.fields, database: 'Synthetic', account: 'ann', password: 'ann-pw' }, { cookie: a.cookie });
  assert.equal(response.status, 302, await response.clone().text());
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const location = response.headers.get('location')!;
  assert.equal(new URL(location).searchParams.get('state'), 's');
  return new URL(location).searchParams.get('code')!;
}
const exchange = (client_id: string, code: string, verifier: string, extra: Record<string, string> = {}) => post('/oauth/token', {
  grant_type: 'authorization_code', client_id, code, code_verifier: verifier, redirect_uri: redirect, resource: `${base}/mcp`, ...extra,
});
const refresh = (client_id: string, refresh_token: string, extra: Record<string, string> = {}) => post('/oauth/token', {
  grant_type: 'refresh_token', client_id, refresh_token, resource: `${base}/mcp`, ...extra,
});
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-oauth-legacy-'));
  createStore(join(dir, 'Synthetic.openhbam.sqlite'));
  const running = await serve({ dir, port: 0, watch: false, listFilesPublicly: true, log: () => {} });
  host = running.host; server = running.server; base = running.url; store = running.host.get('Synthetic')!;
  store.savePrivilegeSet({ name: 'Bot', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmmcp'] });
  store.setPassword('ann', 'ann-pw', 'Bot');
});
after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

for (const scenario of ['local', 'federated', 'changed password', 'unreadable identity'] as const) {
  test(`legacy migration: ${scenario}`, async () => {
    const { client_id } = await register();
    const p = pkce();
    const response = await exchange(client_id, await grant(client_id, p.challenge), p.verifier);
    assert.equal(response.status, 200);
    const issued = await response.json() as { access_token: string; refresh_token: string };
    const db = new DatabaseSync(join(dir, '.openhbam-oauth.sqlite'));
    let migrated: OAuthServer | undefined;
    try {
      const refreshHash = hash(issued.refresh_token);
      const row = db.prepare('SELECT access_id FROM refresh WHERE hash = ?').get(refreshHash) as { access_id: string };
      let account = 'ann';
      const identity = { issuer: 'https://issuer.example', sub: 's1', person: 'p@example.test', mapping: 'ai-staff' };
      if (scenario === 'federated') {
        store.setExternalAccount(identity.mapping, 'Bot');
        store.setPassword(identity.person, 'person-password', 'Bot');
        account = identity.mapping;
      }
      const credentials = store.sql.prepare('SELECT rowid AS id, password_hash FROM _fm_accounts WHERE name = ?').get(account) as { id: number; password_hash: string | null };
      const legacy = hash(`${credentials.id}:${credentials.password_hash ?? ''}`);
      db.prepare('UPDATE refresh SET account = ?, password = ?, identity = ? WHERE hash = ?')
        .run(account, legacy, scenario === 'federated' ? JSON.stringify(identity) : scenario === 'unreadable identity' ? '{broken' : null, refreshHash);
      store.sql.prepare("UPDATE _fm_api_tokens SET account = ?, provenance = 'service' WHERE id = ?").run(account, row.access_id);
      if (scenario === 'changed password') store.setPassword('ann', 'changed-pw', 'Bot');

      assert.doesNotThrow(() => { migrated = new OAuthServer(host, dir); });
      const retained = db.prepare('SELECT password FROM refresh WHERE hash = ?').get(refreshHash) as { password: string } | undefined;
      const access = store.sql.prepare('SELECT provenance FROM _fm_api_tokens WHERE id = ?').get(row.access_id);
      if (scenario === 'changed password') {
        assert.equal(retained, undefined);
        assert.equal(access, undefined);
        const denied = await refresh(client_id, issued.refresh_token);
        assert.equal(denied.status, 400);
        assert.equal((await denied.json()).error, 'invalid_grant');
      } else {
        assert.equal(access?.provenance, 'delegated');
        assert.ok(retained);
        const person = scenario === 'federated' ? identity.person : undefined;
        const expected = hash(`${store.signInMark(account, undefined, person)}:${JSON.stringify(store.privileges(account, undefined, person).set.extendedPrivileges)}`);
        // Unreadable persisted JSON is tolerated during construction and binds without a person.
        if (scenario === 'unreadable identity') assert.equal(retained.password, expected);
        else {
          const renewed = await refresh(client_id, issued.refresh_token);
          assert.equal(renewed.status, 200, await renewed.clone().text());
          const next = await renewed.json() as { access_token: string; refresh_token: string };
          assert.notEqual(next.refresh_token, issued.refresh_token);
          assert.equal(store.apiToken(next.access_token)?.provenance, 'delegated');
          if (scenario === 'federated') assert.deepEqual(store.apiToken(next.access_token)?.identity, identity);
          assert.equal(retained.password, expected);
        }
      }
    } finally {
      migrated?.close();
      db.close();
      if (scenario === 'changed password') store.setPassword('ann', 'ann-pw', 'Bot');
    }
  });
}

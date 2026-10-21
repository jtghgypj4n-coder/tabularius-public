import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { Host, DataApi } from '../src/index.ts';
import { OAuthServer } from '../src/oauth.ts';
import type { Oidc } from '../src/oidc.ts';
import { AutomationRunner, saveAutomation } from '../src/automations.ts';
import { ScriptQueue } from '../src/server-queue.ts';
import { Dashboards } from '../src/dashboards.ts';
import { Digests, DigestRunner } from '../src/digests.ts';

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-account-credentials-'));
  const host = new Host(dir, () => {});
  const store = host.create('Local');
  store.setPassword('Admin', 'synthetic-admin-password', '[Full Access]');
  store.savePrivilegeSet({ name: 'Staff', records: { view: true, edit: false, create: false, delete: false },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmapp', 'fmrest', 'fmmcp'] });
  store.createAccount('ReviewUser', 'synthetic-password', 'Staff');
  store.setExternalAccount('Team', 'Staff');
  return { dir, host, store, async done() { await host.close(); rmSync(dir, { recursive: true, force: true }); } };
}

for (const on of ['create', 'delete']) {
  test(`AR-store-core-01: queued automation lifecycle ${on}`, async () => {
    const f = fresh();
    const queue = new ScriptQueue(1);
    let release!: () => void;
    const held = queue.run(() => new Promise<void>((resolve) => { release = resolve; }));
    try {
      f.store.setAccountPrivilegeSet('ReviewUser', '[Full Access]');
      const options = f.host.scriptOptions();
      f.host.scriptOptions = () => ({ ...options, serverQueue: queue });
      f.store.applyDesign([
        { op: 'createTable', name: 'T', fields: [{ name: 'Value' }] },
        { op: 'createScript', name: 'Write', text: 'New Record/Request\nSet Field [ T::Value ; "written" ]\nCommit Records/Requests [ With dialog: Off ]' },
      ]);
      const record = f.store.create('T', { Value: 'before' }).recordId;
      saveAutomation(f.store, { name: 'Synthetic', layout: 'T', on, script: 'Write', account: 'ReviewUser' }, 'Admin', []);
      const runner = new AutomationRunner(f.host);
      if (on === 'delete') f.store.delete('T', record);
      else f.store.create('T', { Value: 'trigger' });
      for (let i = 0; i < 600 && !queue.queued; i++) await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(queue.queued, 1);
      f.store.deleteAccount('ReviewUser');
      f.store.setPassword('ReviewUser', 'replacement-password', '[Full Access]');
      release();
      await held;
      await runner.idle(f.store);
      assert.equal(f.store.sql.prepare("SELECT COUNT(*) AS n FROM T WHERE Value = 'written'").get()!.n, 0);
      f.store.create('T', { Value: 'after' });
      await runner.idle(f.store);
      assert.equal(f.store.sql.prepare("SELECT COUNT(*) AS n FROM T WHERE Value = 'written'").get()!.n, 0);
    } finally { release(); await held; await f.done(); }
  });
}

test('AR-store-core-01: pending digest lifecycle', async () => {
  const f = fresh();
  try {
    const dashboard = new Dashboards(f.store).create({ name: 'Synthetic', widgets: [] }, 'ReviewUser');
    const digests = new Digests(f.store);
    const digest = digests.create({ name: 'Synthetic', dashboard: dashboard.id, account: 'ReviewUser', days: [1], at: '08:00', enabled: true, webhook: 'synthetic' });
    const runner = new DigestRunner(f.host);
    let sent = 0;
    runner.poster = { allowed: true, async post() { sent++; } };
    runner.writer = { async summarize() {
      f.store.deleteAccount('ReviewUser');
      f.store.createAccount('ReviewUser', 'replacement-password', 'Staff');
      return { summary: 'Synthetic summary' };
    } };
    const run = await runner.run(f.store, digest);
    assert.equal(sent, 0);
    assert.equal(run.outcome, 'error');
    assert.equal(run.summary, undefined);
    assert.deepEqual(run.data, []);
    assert.equal(digests.get(digest.id), undefined);
    assert.equal(digests.runs(digest.id).length, 0);
  } finally { await f.done(); }
});

for (const alias of [false, true]) {
  test(`AR-store-core-01: federated session lifecycle ${alias ? 'alias' : 'principal'}`, async () => {
    const f = fresh();
    try {
      const api = new DataApi(f.host);
      const token = api.open(f.store, alias ? 'directory-alias' : 'ReviewUser', 'web', 'Team', '', undefined, undefined,
        { person: 'ReviewUser', mapping: 'Team' });
      const delayed = api.open(f.store, alias ? 'directory-alias' : 'ReviewUser', 'web', 'Team', '', undefined, undefined,
        { person: 'ReviewUser', mapping: 'Team' });
      assert.equal(api.alive(token), true);
      f.store.deleteAccount('ReviewUser');
      assert.equal(api.alive(token), false);
      f.store.createAccount('ReviewUser', 'replacement-password', 'Staff');
      assert.equal(api.alive(token), false);
      assert.equal(api.alive(delayed), false);
    } finally { await f.done(); }
  });
}

for (const stage of ['consent', 'code'] as const) {
  for (const account of ['Team', 'ReviewUser']) {
    test(`AR-store-core-01: OAuth ${stage} lifecycle ${account}`, async () => {
      const f = fresh();
      const oauth = new OAuthServer(f.host, f.dir);
      oauth.useOidc({
        async begin(_provider, _database, _req, res, flow) {
          await flow!.done(res, { store: f.store, via: 'Team', email: 'ReviewUser', issuer: 'https://example.test',
            sub: 'synthetic-person', provider: 'Synthetic', from: '127.0.0.1' });
        },
      } as Oidc);
      const server = createServer((req, res) => {
        void oauth.handle(req, res, new URL(req.url!, 'http://localhost')).catch(() => res.writeHead(500).end());
      });
      try {
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        // The approval page's anti-forgery cookie goes back with the person's "Allow", as a browser sends it.
        let approvalCookie = '';
        const post = (path: string, values: Record<string, string>) => fetch(base + path, { method: 'POST', redirect: 'manual',
          headers: { 'content-type': 'application/x-www-form-urlencoded', ...(path === '/oauth/authorize' ? { cookie: approvalCookie } : {}) }, body: new URLSearchParams(values) });
        const redirect = 'https://example.test/callback';
        const registered = await fetch(base + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ client_name: 'Synthetic', redirect_uris: [redirect] }) });
        assert.equal(registered.status, 201);
        const { client_id } = await registered.json() as { client_id: string };
        const verifier = randomBytes(32).toString('base64url');
        const params = { client_id, redirect_uri: redirect, response_type: 'code', code_challenge_method: 'S256',
          code_challenge: createHash('sha256').update(verifier).digest('base64url'), database: 'Local', oidc: 'synthetic' };
        const page = await fetch(base + '/oauth/authorize?' + new URLSearchParams(params));
        assert.equal(page.status, 200);
        approvalCookie = page.headers.get('set-cookie')?.split(';')[0] ?? '';
        assert.ok(approvalCookie);
        const fields = Object.fromEntries([... (await page.text()).matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)]
          .map((m) => [m[1], m[2].replace(/&amp;/g, '&')]));
        assert.ok(fields.consent);
        const replace = () => {
          f.store.deleteAccount(account);
          if (account === 'Team') f.store.setExternalAccount(account, 'Staff');
          else f.store.createAccount(account, 'replacement-password', 'Staff');
        };
        if (stage === 'consent') {
          replace();
          assert.equal((await post('/oauth/authorize', fields)).status, 400);
        } else {
          const allowed = await post('/oauth/authorize', fields);
          assert.equal(allowed.status, 302);
          const code = new URL(allowed.headers.get('location')!).searchParams.get('code')!;
          replace();
          const response = await post('/oauth/token', { grant_type: 'authorization_code', client_id, code,
            code_verifier: verifier, redirect_uri: redirect });
          assert.equal(response.status, 400);
          assert.equal((await response.json()).error, 'invalid_grant');
        }
        assert.equal(f.store.apiTokens().length, 0);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        oauth.close();
        await f.done();
      }
    });
  }
}

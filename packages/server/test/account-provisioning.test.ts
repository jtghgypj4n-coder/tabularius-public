import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { createStore, totpCode, type Store } from '../../store/src/index.ts';

const csv = (row: string) => 'account,privilegeSet,active\n' + row;
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-http-'));
  createStore(join(dir, 'Local.openhbam.sqlite'));
  createStore(join(dir, 'Other.openhbam.sqlite'));
  const served = await serve({ dir, port: 0, watch: false, log: () => {} });
  const store = served.host.get('Local')!;
  store.setPassword('Admin', 'admin-secret', '[Full Access]');
  store.savePrivilegeSet({ name: 'Staff', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.setPassword('User', 'user-secret', 'Staff');
  const login = async (account = 'Admin', password = 'admin-secret') => {
    const r = await fetch(`${served.url}/fmi/data/vLatest/databases/Local/sessions`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${account}:${password}`).toString('base64')}` }, body: '{}' });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    return body.response.token as string;
  };
  const request = (token: string, action: 'preview' | 'apply', body: unknown, db = 'Local', method = 'POST') => fetch(`${served.url}/tabularius/security/v1/databases/${db}/accounts/import/${action}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  return { ...served, store, login, request, async done() { await new Promise<void>((r) => served.server.close(() => r())); rmSync(dir, { recursive: true, force: true }); } };
}
const receipts = (s: Store) => Number(s.sql.prepare('SELECT COUNT(*) AS n FROM _fm_account_import_receipts').get()!.n);

test('account import rejects deep JSON with its normal invalid-body error', async () => {
  const f = await fixture();
  try {
    const token = await f.login();
    const deep = '['.repeat(64) + '0' + ']'.repeat(64);
    const r = await fetch(`${f.url}/tabularius/security/v1/databases/Local/accounts/import/preview`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: `{"csv":"${csv('New,Staff,true').replace('\n', '\\n')}","extra":${deep}}`,
    });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: { code: 960, message: 'Invalid JSON or UTF-8' } });
    assert.equal(f.store.accounts().some((a) => a.name === 'New'), false);
  } finally { await f.done(); }
});

test('HTTP preview/apply match, replay is durable, changed payload and stale preview conflict without mutations', async () => {
  const f = await fixture();
  try {
    const token = await f.login();
    const source = csv('New,Staff,true\nUser,Staff,false');
    const r = await f.request(token, 'preview', { csv: source });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const preview = await r.json();
    assert.equal(preview.valid, true);
    assert.equal(f.store.accounts().some((a) => a.name === 'New'), false);
    const body = { csv: source, previewToken: preview.previewToken, idempotencyKey: 'http-first' };
    const applied = await f.request(token, 'apply', body);
    assert.equal(applied.status, 200, await applied.clone().text());
    const result = await applied.json();
    assert.deepEqual(result.rows, preview.rows);
    const eventCount = f.store.auditLog({ security: true }).length;
    assert.deepEqual(await (await f.request(token, 'apply', body)).json(), result);
    assert.equal(f.store.auditLog({ security: true }).length, eventCount);
    assert.equal((await f.request(token, 'apply', { ...body, csv: csv('Another,Staff,true') })).status, 409);
    const next = await (await f.request(token, 'preview', { csv: csv('Next,Staff,true') })).json();
    f.store.setAccountActive('New', false);
    assert.equal((await f.request(token, 'apply', { csv: csv('Next,Staff,true'), previewToken: next.previewToken, idempotencyKey: 'stale' })).status, 409);
    assert.equal(f.store.accounts().some((a) => a.name === 'Next'), false);
    assert.equal(receipts(f.store), 1);
    const safe = JSON.stringify([preview, result, f.store.auditLog({ security: true })]);
    assert.ok(!safe.includes('admin-secret'));
    assert.ok(!safe.includes('user-secret'));
    assert.ok(!safe.includes('password_hash'));
    assert.ok(!JSON.stringify(result).includes('previewToken'));
  } finally { await f.done(); }
});

test('HTTP rejects unauthenticated, wrong-file, expired, disabled, must-change, restricted and non-Full-Access credentials', async () => {
  const f = await fixture();
  try {
    const input = { csv: csv('New,Staff,true') };
    let admin = await f.login();
    assert.equal((await f.request('', 'preview', input)).status, 401);
    assert.equal((await f.request('invalid-session', 'preview', input)).status, 401);
    assert.equal((await f.request(admin, 'preview', input, 'Other')).status, 401);
    admin = await f.login();
    const viewer = await f.login('User', 'user-secret');
    assert.equal((await f.request(viewer, 'preview', input)).status, 403);
    f.store.applyDesign([{ op: 'createTable', name: 'OnlyThis', fields: [{ name: 'Value' }] }]);
    for (const opts of [{}, { readOnly: true }, { layouts: ['OnlyThis'] }, { surfaces: ['fmrest'] }]) {
      const apiToken = f.store.createApiToken('Admin', opts);
      assert.equal((await f.request(apiToken, 'preview', input)).status, 403);
      assert.equal((await f.request(apiToken, 'apply', { ...input, previewToken: 'x', idempotencyKey: 'x' })).status, 403);
    }
    f.store.setPassword('Second', 'second-secret', '[Full Access]');
    const disabled = await f.login('Second', 'second-secret');
    f.store.setAccountActive('Second', false);
    assert.equal((await f.request(disabled, 'preview', input)).status, 401);
    f.store.setMustChangePassword('Admin', true);
    assert.equal((await f.request(admin, 'preview', input)).status, 403);
    const restricted = await f.login();
    assert.equal((await f.request(restricted, 'apply', { ...input, previewToken: 'x', idempotencyKey: 'x' })).status, 403);
    f.store.setMustChangePassword('Admin', false);
    // A session already issued with the owed-change restriction stays restricted.
    assert.equal((await f.request(restricted, 'preview', input)).status, 403);
    const expired = await f.login();
    const now = Date.now, mono = performance.now;
    try {
      Date.now = () => now() + 60 * 60_000;
      performance.now = () => mono.call(performance) + 60 * 60_000;
      assert.equal((await f.request(expired, 'preview', input)).status, 401);
    } finally { Date.now = now; performance.now = mono; }
    assert.equal(f.store.accounts().some((a) => a.name === 'New'), false);
    assert.equal(receipts(f.store), 0);
  } finally { await f.done(); }
});

test('apply rechecks Full Access after preview, including a change from another SQLite connection', async () => {
  const f = await fixture();
  try {
    f.store.setPassword('Second', 'second-secret', '[Full Access]');
    const token = await f.login('Second', 'second-secret');
    const input = csv('New,Staff,true');
    const preview = await (await f.request(token, 'preview', { csv: input })).json();
    const { Store } = await import('../../store/src/index.ts');
    const other = new Store(f.store.path, 'Local');
    try { other.setAccountPrivilegeSet('Second', 'Staff'); }
    finally { other.close(); }
    const ended = await f.request(token, 'apply', { csv: input, previewToken: preview.previewToken, idempotencyKey: 'demoted' });
    assert.equal(ended.status, 401, 'the demotion changed the account\'s authority and ended its session');
    const response = await f.request(await f.login('Second', 'second-secret'), 'apply', { csv: input, previewToken: preview.previewToken, idempotencyKey: 'demoted' });
    assert.equal(response.status, 403);
    assert.equal(f.store.accounts().some((a) => a.name === 'New'), false);
  } finally { await f.done(); }
});

test('CSV deactivation ends existing sessions and blocks password and API-token access; reactivation preserves the password but not the tokens', async () => {
  const f = await fixture();
  try {
    const admin = await f.login();
    const user = await f.login('User', 'user-secret');
    const apiToken = f.store.createApiToken('User');
    const input = csv('User,Staff,false');
    const preview = await (await f.request(admin, 'preview', { csv: input })).json();
    const response = await f.request(admin, 'apply', { csv: input, previewToken: preview.previewToken, idempotencyKey: 'deactivate' });
    assert.equal(response.status, 200);
    const layouts = (tok: string) => fetch(`${f.url}/fmi/data/vLatest/databases/Local/layouts`, { headers: { authorization: `Bearer ${tok}` } });
    assert.equal((await layouts(user)).status, 401);
    assert.equal((await layouts(apiToken)).status, 401);
    assert.equal(f.store.verify('User', 'user-secret', ''), false);
    assert.equal(f.store.apiToken(apiToken), undefined);
    const enabled = csv('User,Staff,true');
    const next = await (await f.request(admin, 'preview', { csv: enabled })).json();
    assert.equal((await f.request(admin, 'apply', { csv: enabled, previewToken: next.previewToken, idempotencyKey: 'reactivate' })).status, 200);
    assert.equal(f.store.verify('User', 'user-secret', ''), true);
    assert.equal(f.store.apiToken(apiToken), undefined, 'tokens revoked on deactivation do not return on reactivation');
    assert.equal((await layouts(apiToken)).status, 401);
    assert.equal((await layouts(user)).status, 401, 'ended session does not return on reactivation');
    assert.ok(await f.login('User', 'user-secret'));
    const fresh = f.store.createApiToken('User');
    assert.equal((await layouts(fresh)).status, 200, 'a token created after reactivation works');
  } finally { await f.done(); }
});

test('limits, strict envelope, password columns, self guard and validation errors never echo credentials', async () => {
  const f = await fixture();
  try {
    const token = await f.login();
    const bad = await f.request(token, 'preview', { csv: 'account,password,active\nnew,DO-NOT-ECHO,true' });
    assert.equal(bad.status, 400);
    assert.ok(!(await bad.text()).includes('DO-NOT-ECHO'));
    assert.equal((await f.request(token, 'preview', { csv: csv('new,Staff,true'), password: 'DO-NOT-ECHO' })).status, 400);
    const self = await (await f.request(token, 'preview', { csv: csv('ADMIN,Staff,false') })).json();
    assert.equal(self.valid, false);
    assert.ok(self.errors.some((e: { code: string }) => e.code === 'self-account'));
    const invalid = await (await f.request(token, 'preview', { csv: csv('Good,Staff,true\nBad,Missing,false') })).json();
    assert.equal(invalid.valid, false);
    assert.equal((await f.request(token, 'apply', { csv: csv('Good,Staff,true\nBad,Missing,false'), previewToken: '', idempotencyKey: 'bad' })).status, 409);
    assert.equal(f.store.accounts().some((a) => a.name === 'Good'), false);
    const huge = await f.request(token, 'preview', { csv: 'x'.repeat(1024 * 1024) });
    assert.equal(huge.status, 413);
    assert.equal((await f.request(token, 'preview', {}, 'Local', 'GET')).status, 405);
    assert.equal((await f.request(token, 'preview', { csv: csv('New,Staff,true') }, 'Missing')).status, 401); // with the file list off an unhosted file answers like a wrong password (r10 item 1)
    assert.ok(!JSON.stringify(f.store.auditLog({ security: true })).includes('DO-NOT-ECHO'));
    // Durable counters are shared with a second process/connection and return Retry-After.
    f.store.sql.prepare("INSERT OR REPLACE INTO _fm_account_import_limits VALUES ('admin', 'preview', ?, 20)").run(Math.floor(Date.now() / 60_000));
    const limited = await f.request(token, 'preview', { csv: csv('New,Staff,true') });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '60');
    f.store.sql.prepare("INSERT OR REPLACE INTO _fm_account_import_limits VALUES ('admin', 'apply', ?, 5)").run(Math.floor(Date.now() / 60_000));
    assert.equal((await f.request(token, 'apply', { csv: csv('New,Staff,true'), previewToken: '', idempotencyKey: 'rate' })).status, 429);
    const { Store } = await import('../../store/src/index.ts');
    const other = new Store(f.store.path, 'Local');
    try { assert.throws(() => other.limitAccountImport('Admin', 'preview'), /import-rate-limit/); }
    finally { other.close(); }
    f.store.sql.prepare("UPDATE _fm_account_import_limits SET count = 60 WHERE kind = 'ip'").run();
    assert.equal((await f.request('', 'preview', {})).status, 429, 'IP limit precedes authentication');
  } finally { await f.done(); }
});

test('an MFA-blocked backup cannot replace the administrator under account or file policy', async () => {
  for (const policy of ['account', 'file']) {
    const f = await fixture();
    try {
      const token = await f.login();
      if (policy === 'file') {
        const { secret } = f.store.enrollTotp('Admin');
        assert.equal(f.store.confirmTotp('Admin', totpCode(secret)), true);
        f.store.setRequireTotpForFullAccess(true);
      }
      f.store.setPassword('Backup', 'backup-secret', '[Full Access]');
      if (policy === 'account') f.store.setAccountRequire2fa('Backup', true);
      const denied = await fetch(`${f.url}/fmi/data/vLatest/databases/Local/sessions`, {
        method: 'POST', headers: { authorization: 'Basic ' + Buffer.from('Backup:backup-secret').toString('base64') }, body: '{}',
      });
      assert.equal(denied.status, 403);
      assert.match((await denied.json()).messages[0].message, /second factor/);
      // Normal account management must enforce the same safeguard as CSV planning.
      const demotion = await fetch(`${f.url}/tabularius/security/v1/databases/Local`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ changes: [{ op: 'setAccount', name: 'Admin', privilegeSet: 'Staff' }] }),
      });
      assert.equal(demotion.status, 400);
      assert.match((await demotion.json()).error.message, /last account with full access/);
      assert.equal(f.store.accountPrivilegeSet('Admin'), '[Full Access]');
      assert.equal(f.store.accountInactive('Admin'), false);
    } finally { await f.done(); }
  }
});

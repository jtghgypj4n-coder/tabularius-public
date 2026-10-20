import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataApi, Host } from '../src/index.ts';
import { expiryClock, ExpiryClock } from '../../store/src/clock.ts';
import { McpTokens } from '../src/mcp-tokens.ts';
import { makeAuthenticator, forgeRegistration } from '../../store/test/forge-webauthn.ts';

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-session-clock-'));
  const host = new Host(dir, () => {});
  const store = host.create('Clock');
  store.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  t.after(() => { host.close(); rmSync(dir, { recursive: true, force: true }); });
  const api = new DataApi(host);
  let wall = Date.now(), monotonic = performance.now();
  t.mock.timers.enable({ apis: ['Date'], now: wall });
  t.mock.method(performance, 'now', () => monotonic);
  const clock = new ExpiryClock();
  t.mock.method(expiryClock, 'now', () => clock.now());
  return { store, api, host, dir, jump: (wallMs: number, elapsedMs: number) => {
    wall += wallMs; monotonic += elapsedMs; t.mock.timers.setTime(wall);
  } };
}

for (const client of ['rest', 'web'] as const) {
  test(`${client}: a forward wall-clock jump does not end an active session`, (t) => {
    const { store, api, jump } = setup(t);
    const token = api.open(store, 'Admin', client);
    const since = api.list()[0].since;
    jump(3600_000, 1000);
    assert.equal(api.alive(token), true);
    assert.equal(api.list()[0].idleSeconds, 1);
    assert.equal(api.list()[0].since, since, 'the displayed sign-in time stays an epoch timestamp');
  });

  test(`${client}: a backward wall-clock jump does not extend idle expiry`, (t) => {
    const { store, api, jump } = setup(t);
    const token = api.open(store, 'Admin', client);
    jump(-3600_000, 16 * 60_000);
    assert.equal(api.alive(token), false);
    api.open(store, 'Admin', client);
    assert.equal(api.sessionCount, 1, 'the sweep uses elapsed time too');
  });
}

test('an API token past its absolute expiry stays expired after a backward jump', (t) => {
  const { store, jump } = setup(t);
  const token = store.createApiToken('Admin', { expires: new Date(Date.now() + 60_000) });
  assert.ok(store.apiToken(token));
  jump(120_000, 120_000);
  assert.equal(store.apiToken(token), undefined);
  jump(-3600_000, 1000);
  assert.equal(store.apiToken(token), undefined);
});

test('absolute expiry still passes when no token check observes the backward jump', (t) => {
  const { store, jump } = setup(t);
  const token = store.createApiToken('Admin', { expires: new Date(Date.now() + 60_000) });
  jump(-3600_000, 60_000);
  assert.equal(store.apiToken(token), undefined, 'the startup reference protects the first check, including equality');
});

test('an API token recovers from a corrected forward jump and still expires on elapsed time', (t) => {
  const { store, jump } = setup(t);
  const token = store.createApiToken('Admin', { expires: new Date(Date.now() + 30 * 60_000) });
  jump(3600_000, 0);
  assert.equal(store.apiToken(token), undefined);
  jump(-3600_000, 0);
  assert.ok(store.apiToken(token), 'the corrected jump no longer counts');
  jump(-3600_000, 30 * 60_000 - 1);
  assert.ok(store.apiToken(token));
  jump(1, 1);
  assert.equal(store.apiToken(token), undefined);
});

test('an MCP token issued during rollback retains its 30-minute lifetime', (t) => {
  const { dir, jump } = setup(t);
  const tokens = new McpTokens(dir);
  jump(-3600_000, 0);
  const issued = tokens.create({ database: 'Clock', account: 'Admin', days: 1 / 48 });
  assert.ok(tokens.check(issued.token));
  jump(30 * 60_000 - 1, 30 * 60_000 - 1);
  assert.ok(tokens.check(issued.token));
  jump(1, 1);
  assert.equal(tokens.check(issued.token), undefined);
});

test('signed container URLs issued during rollback remain usable until expiry', (t) => {
  const { host, jump } = setup(t);
  jump(-3600_000, 0);
  const params = new URLSearchParams(host.signed('Clock', 7));
  assert.ok(host.checkUrl('Clock', 7, params));
  jump(3600_000, 3600_000);
  assert.equal(host.checkUrl('Clock', 7, params), false);
});

test('account import previews issued during rollback can be applied', (t) => {
  const { store, jump } = setup(t);
  jump(-3600_000, 0);
  const csv = 'account,privilegeSet,active\nNew,Reader,true';
  const preview = store.previewAccountImport(csv, 'Admin');
  assert.ok(preview.previewToken);
  assert.doesNotThrow(() => store.applyAccountImport(csv, 'Admin', preview.previewToken!, 'rollback-issuance'));
});

test('WebAuthn challenges issued during rollback can complete registration', (t) => {
  const { store, jump } = setup(t);
  jump(-3600_000, 0);
  const rpId = 'example.com', origin = 'https://example.com';
  const auth = makeAuthenticator(rpId, origin);
  const challenge = store.issueWebauthnChallenge('register', 'Admin');
  assert.doesNotThrow(() => store.registerPasskey('Admin', forgeRegistration(auth, challenge), { rpId, origin, challenge }));
});

for (const create of [false, true]) {
  test(`${create ? 'creating' : 'resetting'} a password during rollback starts a full maximum age`, (t) => {
    const { store, jump } = setup(t);
    store.setPasswordPolicy({ maxAgeDays: 1 });
    jump(-2 * 86_400_000, 0);
    if (create) store.createAccount('ClockUser', 'pw', 'Reader');
    else store.setPassword('ClockUser', 'pw');
    assert.equal(store.mustChangePassword('ClockUser'), false);
    jump(86_400_001, 86_400_001);
    assert.equal(store.mustChangePassword('ClockUser'), true);
  });
}

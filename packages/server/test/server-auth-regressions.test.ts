import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createStore, Store, StoreError } from '../../store/src/index.ts';
import { Host, STORE_EXT } from '../src/host.ts';
import { DataApi } from '../src/dataapi.ts';
import { SecurityApi, applySecurityChanges } from '../src/security.ts';
import { ScimDirectory, ScimEndpoint } from '../src/scim.ts';
import { Connections } from '../src/connections.ts';
import { OAuthServer } from '../src/oauth.ts';
import { Admin } from '../src/admin.ts';
import { McpTokens } from '../src/mcp-tokens.ts';

function setup(t: TestContext) {
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-auth-regression-'));
  createStore(join(folder, 'A' + STORE_EXT));
  const host = new Host(folder, () => {}, { background: false });
  const api = new DataApi(host);
  const store = host.get('A')!;
  store.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', scripts: 'none', valueLists: 'viewOnly', extendedPrivileges: ['fmrest', 'fmmcp'] });
  t.after(async () => { api.endByDb('A'); await host.close(); rmSync(folder, { recursive: true, force: true }); });
  return { folder, host, api, store };
}

type Handler = { handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> };
function begin(handler: Handler, path: string, method: string, headers: Record<string, string> = {}) {
  const stream = new PassThrough();
  const req = Object.assign(stream, { method, url: path, headers: { host: 'localhost', ...headers }, socket: { remoteAddress: '127.0.0.1' } }) as unknown as IncomingMessage;
  let status = 0, text = '';
  const res = Object.assign(new EventEmitter(), { writeHead(code: number) { status = code; return this; }, end(value?: string) { text = value ?? ''; res.emit('finish'); }, setHeader() {} }) as unknown as ServerResponse;
  const done = handler.handle(req, res, new URL(path, 'http://localhost')).then(() => ({ status, text, json: () => JSON.parse(text) }));
  return { stream, done };
}
async function call(handler: Handler, path: string, method: string, body?: unknown, headers?: Record<string, string>) {
  const request = begin(handler, path, method, headers);
  request.stream.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  return request.done;
}
const securityPath = '/tabularius/security/v1/databases/A';
const scimPath = '/tabularius/scim/v2/databases/A';
async function login(api: DataApi) {
  const response = await call(api, '/fmi/data/vLatest/databases/A/sessions', 'POST', {}, { authorization: 'Basic ' + Buffer.from('Admin:synthetic-password').toString('base64') });
  assert.equal(response.status, 200, response.text);
  return response.json().response.token as string;
}

for (const action of ['demote', 'end', 'replace'] as const) test(`AR-server-auth-01 security ${action}`, async (t) => {
  const { host, api, store } = setup(t);
  store.setPassword('Admin', 'synthetic-password', '[Full Access]');
  store.setPassword('Owner', 'synthetic-password', '[Full Access]');
  const token = await login(api);
  const pending = begin(new SecurityApi(host, api), securityPath, 'POST', { authorization: `Bearer ${token}` });
  pending.stream.write('{"changes":');
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (action === 'demote') store.setAccountPrivilegeSet('Admin', 'Reader');
  else if (action === 'end') api.end(token);
  else { store.deleteAccount('Admin'); store.setPassword('Admin', 'replacement-password', 'Reader'); }
  pending.stream.end(JSON.stringify([{ op: 'setAccount', name: 'Admin', privilegeSet: '[Full Access]' }]) + '}');
  const response = await pending.done;
  assert.ok([401, 403].includes(response.status), response.text);
  assert.equal(store.accountPrivilegeSet('Admin'), action === 'end' ? '[Full Access]' : 'Reader');
});

for (const resource of ['Users', 'Groups']) test(`AR-server-auth-01 SCIM ${resource}`, async (t) => {
  const { host, api, store } = setup(t);
  const dir = new ScimDirectory(store);
  const token = dir.issueToken();
  const user = dir.create({ userName: 'member@example.test', active: true });
  const pending = begin(new ScimEndpoint(host, api), `${scimPath}/${resource}`, 'POST', { authorization: `Bearer ${token}` });
  pending.stream.write('{');
  await new Promise<void>((resolve) => setImmediate(resolve));
  dir.revokeToken();
  const body = resource === 'Users' ? { userName: 'new@example.test', active: true } : { displayName: 'Reader', members: [{ value: user.id }] };
  pending.stream.end(JSON.stringify(body).slice(1));
  assert.equal((await pending.done).status, 401);
  assert.equal(store.accounts().some((a) => a.name === 'new@example.test'), false);
  assert.deepEqual(dir.members('Reader'), []);
});

test('AR-server-auth-02', async (t) => {
  const { folder } = setup(t);
  const first = new Connections(folder);
  const made = first.create({ name: 'Service', type: 'rest', config: { baseUrl: 'https://example.test', auth: 'none' } });
  first.approve(made.id);
  const second = new Connections(folder);
  let finish!: (response: Response) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  first.io.fetch = async () => { entered(); return new Promise<Response>((resolve) => { finish = resolve; }); };
  const pending = first.test(made.id);
  await started;
  second.update(made.id, { enabled: false, files: ['Restricted'] });
  finish(new Response(null, { status: 200 }));
  const result = await pending;
  const current = new Connections(folder).get(made.id)!;
  assert.equal(current.status, 'disabled');
  assert.deepEqual(current.files, ['Restricted']);
  assert.deepEqual(current.lastTest, result);
});

for (const replacement of ['local', 'external']) test(`AR-server-auth-03 ${replacement}`, async (t) => {
  const { host, api, store } = setup(t);
  const dir = new ScimDirectory(store);
  const token = dir.issueToken({ defaultPrivilegeSet: 'Reader' });
  const user = dir.create({ userName: 'member@example.test', active: true });
  const identity = store.accountIdentityId(user.account);
  store.deleteAccount(user.account);
  if (replacement === 'local') store.setPassword(user.account, 'replacement-password', 'Reader');
  else store.setExternalAccount(user.account, 'Reader');
  assert.notEqual(store.accountIdentityId(user.account), identity);
  const response = await call(new ScimEndpoint(host, api), `${scimPath}/Users/${user.id}`, 'PATCH', { Operations: [{ op: 'replace', path: 'active', value: false }] }, { authorization: `Bearer ${token}` });
  assert.ok([403, 404].includes(response.status), response.text);
  assert.equal(store.accountInactive(user.account), false);
});

test('AR-server-auth-04', (t) => {
  const { store } = setup(t);
  const before = store.securityToken();
  assert.throws(() => applySecurityChanges(store, [{ op: 'createExtendedPrivilege', name: 'synthetic_atomic' }, { op: 'setAccount', name: 'missing-account', privilegeSet: 'Reader' }]));
  assert.equal(store.schema.extendedPrivileges.some((p) => p.name === 'synthetic_atomic'), false);
  assert.equal(store.securityToken(), before);
});

for (const catalogFirst of [true, false]) test(`AR-server-auth-04 mixed create and grant over HTTP, catalog first ${catalogFirst}`, async (t) => {
  const { host, api, store } = setup(t);
  store.setPassword('Admin', 'synthetic-password', '[Full Access]');
  const token = await login(api);
  const set = { ...store.privilegeSet('Reader')!, extendedPrivileges: ['fmrest', 'fmmcp', 'synthetic_sync'] };
  const catalog = { op: 'createExtendedPrivilege', name: 'synthetic_sync' };
  const security = [
    { op: 'savePrivilegeSet', set },
    { op: 'setExternalAccount', name: 'member@example.test', privilegeSet: 'Reader' },
  ];
  const before = store.securityToken();
  let published = 0;
  store.onDesignChange = () => {
    published++;
    assert.equal(store.sql.isTransaction, false);
    assert.equal(store.accountPrivilegeSet('member@example.test'), 'Reader');
  };
  const response = await call(new SecurityApi(host, api), securityPath, 'POST', {
    changes: catalogFirst ? [catalog, ...security] : [...security, catalog],
  }, { authorization: `Bearer ${token}` });
  assert.equal(response.status, 200, response.text);
  assert.equal(published, 1);
  assert.ok(response.json().extendedPrivileges.includes('synthetic_sync'));
  assert.ok(store.privilegeSet('Reader')!.extendedPrivileges.includes('synthetic_sync'));
  assert.notEqual(store.securityToken(), before);
  assert.equal(store.designHistory().at(-1)!.account, 'Admin');
  const reopened = new Store(store.path);
  try {
    assert.ok(reopened.schema.extendedPrivileges.some((p) => p.name === 'synthetic_sync'));
    assert.ok(reopened.privilegeSet('Reader')!.extendedPrivileges.includes('synthetic_sync'));
    assert.equal(reopened.accountPrivilegeSet('member@example.test'), 'Reader');
  } finally { reopened.close(); }
});

for (const action of ['rename', 'delete'] as const) test(`AR-server-auth-04 mixed catalog ${action} preserves grants`, (t) => {
  const { store } = setup(t);
  store.applyDesign([{ op: 'createExtendedPrivilege', name: 'synthetic_sync' }]);
  const set = { ...store.privilegeSet('Reader')!, extendedPrivileges: ['fmrest', 'synthetic_sync'] };
  store.savePrivilegeSet(set);
  applySecurityChanges(store, [
    { op: 'setExternalAccount', name: 'member@example.test', privilegeSet: 'Reader' },
    action === 'rename'
      ? { op: 'updateExtendedPrivilege', extendedPrivilege: 'synthetic_sync', name: 'synthetic_sync_v2' }
      : { op: 'deleteExtendedPrivilege', extendedPrivilege: 'synthetic_sync' },
  ]);
  assert.equal(store.accountPrivilegeSet('member@example.test'), 'Reader');
  assert.deepEqual(store.privilegeSet('Reader')!.extendedPrivileges, action === 'rename' ? ['fmrest', 'synthetic_sync_v2'] : ['fmrest']);
  assert.equal(store.schema.extendedPrivileges.some((p) => p.name === 'synthetic_sync'), false);
  assert.equal(store.schema.extendedPrivileges.some((p) => p.name === 'synthetic_sync_v2'), action === 'rename');
});

for (const action of ['create', 'rename', 'delete'] as const) test(`AR-server-auth-04 mixed catalog ${action} rolls back schema, caches and audit`, (t) => {
  const { store } = setup(t);
  store.applyDesign([{ op: 'createExtendedPrivilege', name: 'synthetic_sync' }]);
  store.savePrivilegeSet({ ...store.privilegeSet('Reader')!, extendedPrivileges: ['fmrest', 'synthetic_sync'] });
  const snapshot = (s: Store) => ({
    schema: structuredClone(s.schema),
    sets: s.privilegeSets(),
    reader: s.privilegeSet('Reader'),
    accounts: s.accounts(),
    history: s.designHistory(),
    audit: s.auditLog(),
    token: s.securityToken(),
  });
  const before = snapshot(store);
  let published = 0;
  store.onDesignChange = () => { published++; };
  store.listeners.add(() => { published++; });
  assert.throws(() => applySecurityChanges(store, [
    action === 'create' ? { op: 'createExtendedPrivilege', name: 'synthetic_new' }
      : action === 'rename' ? { op: 'updateExtendedPrivilege', extendedPrivilege: 'synthetic_sync', name: 'synthetic_sync_v2' }
        : { op: 'deleteExtendedPrivilege', extendedPrivilege: 'synthetic_sync' },
    { op: 'savePrivilegeSet', set: { ...before.reader!, extendedPrivileges: ['fmrest'] } },
    { op: 'setExternalAccount', name: 'transient@example.test', privilegeSet: 'Reader' },
    { op: 'setAccount', name: 'missing-account', privilegeSet: 'Reader' },
  ]), /No account "missing-account"/);
  assert.equal(store.sql.isTransaction, false);
  assert.equal(published, 0, 'failed batches must not publish design changes');
  assert.deepEqual(snapshot(store), before);
  const reopened = new Store(store.path);
  try { assert.deepEqual(snapshot(reopened), before); } finally { reopened.close(); }
});

test('AR-server-auth-04 mixed batch failure preserves an outer transaction', (t) => {
  const { store } = setup(t);
  const before = store.securityToken();
  const trial = store.trial();
  try {
    store.setExternalAccount('outer@example.test', 'Reader');
    const outerToken = store.securityToken();
    assert.throws(() => applySecurityChanges(store, [
      { op: 'createExtendedPrivilege', name: 'synthetic_failed' },
      { op: 'setAccount', name: 'missing-account', privilegeSet: 'Reader' },
    ]), /No account "missing-account"/);
    assert.equal(store.sql.isTransaction, true);
    assert.equal(store.securityToken(), outerToken);
    assert.equal(store.accountPrivilegeSet('outer@example.test'), 'Reader');
    assert.equal(store.schema.extendedPrivileges.some((p) => p.name === 'synthetic_failed'), false);
    applySecurityChanges(store, [
      { op: 'createExtendedPrivilege', name: 'synthetic_trial' },
      { op: 'savePrivilegeSet', set: { ...store.privilegeSet('Reader')!, extendedPrivileges: ['synthetic_trial'] } },
    ]);
    assert.ok(store.privilegeSet('Reader')!.extendedPrivileges.includes('synthetic_trial'));
  } finally { trial.undo(); }
  assert.equal(store.sql.isTransaction, false);
  assert.equal(store.securityToken(), before);
  assert.equal(store.accountPrivilegeSet('outer@example.test'), undefined);
  assert.equal(store.schema.extendedPrivileges.some((p) => p.name === 'synthetic_trial'), false);
  assert.equal(store.privilegeSet('Reader')!.extendedPrivileges.includes('synthetic_trial'), false);
});

test('AR-server-auth-05', async (t) => {
  const { host, api, store } = setup(t);
  const dir = new ScimDirectory(store);
  const token = dir.issueToken();
  const first = dir.create({ userName: 'first@example.test', active: true });
  const protectedUser = dir.create({ userName: 'protected@example.test', active: true });
  store.sql.prepare('UPDATE _fm_scim_users SET created = ? WHERE id = ?').run('2000-01-01', first.id);
  dir.setMembers('Reader', [first.id, protectedUser.id]);
  store.setAccountPrivilegeSet(protectedUser.account, '[Full Access]');
  const before = store.securityToken();
  const response = await call(new ScimEndpoint(host, api), `${scimPath}/Groups/${Buffer.from('Reader').toString('base64url')}`, 'DELETE', undefined, { authorization: `Bearer ${token}` });
  assert.equal(response.status, 403, response.text);
  assert.deepEqual(dir.members('Reader').map((r) => r.id), [first.id, protectedUser.id]);
  assert.equal(store.accountPrivilegeSet(first.account), 'Reader');
  assert.equal(store.accountPrivilegeSet(protectedUser.account), '[Full Access]');
  assert.equal(store.securityToken(), before);
});

for (const scenario of ['initial', 'locked', 'blocked']) test(`AR-server-auth-06 ${scenario}`, async (t) => {
  const { folder, host } = setup(t);
  const oauth = new OAuthServer(host, folder);
  t.after(() => oauth.close());
  host.listFilesPublicly = false;
  const registered = await call(oauth, '/oauth/register', 'POST', { client_name: 'Synthetic', redirect_uris: ['http://localhost/callback'], token_endpoint_auth_method: 'none' });
  assert.equal(registered.status, 201, registered.text);
  const attempt = (database: string) => call(oauth, '/oauth/authorize', 'POST', new URLSearchParams({ client_id: registered.json().client_id, redirect_uri: 'http://localhost/callback', response_type: 'code', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', database, account: 'missing-account', password: 'wrong-password' }).toString(), { 'content-type': 'application/x-www-form-urlencoded' });
  if (scenario === 'locked') for (let i = 0; i < 5; i++) await attempt('A');
  if (scenario === 'blocked') host.config.setBlockNewUsers(true);
  const present = await attempt('A');
  const absent = await attempt('Absent');
  assert.equal(present.status, 401, present.text);
  assert.equal(absent.status, present.status);
  assert.equal(present.text.replaceAll('value="A"', 'value="FILE"'), absent.text.replaceAll('value="Absent"', 'value="FILE"'));
});

for (const failure of ['days', 'token', 'after-token'] as const) test(`AR-server-auth-07 ${failure}`, async (t) => {
  const { folder, host, api, store } = setup(t);
  const admin = new Admin(host, api);
  admin.mcpTokens = new McpTokens(folder);
  const createToken = store.createApiToken.bind(store);
  if (failure !== 'days') t.mock.method(store, 'createApiToken', (...args: Parameters<typeof createToken>) => {
    if (failure === 'after-token') createToken(...args);
    throw new StoreError(960, 'synthetic token failure');
  });
  const before = store.securityToken();
  const response = await call(admin, '/tabularius/admin/v1/mcp/tokens', 'POST', { database: 'A', agent: { name: 'synthetic-agent', privilegeSet: 'Reader' }, days: failure === 'days' ? 0 : 1 }, { 'x-tabularius-admin': '1' });
  assert.equal(response.status, 400, response.text);
  assert.equal(store.accounts().some((a) => a.name === 'synthetic-agent'), false);
  assert.deepEqual(store.apiTokens(), []);
  assert.equal(store.securityToken(), before);
});

for (const [path, body] of [
  ['/tokens', { account: 'Owner' }],
  ['/migrate', { accounts: ['Owner'] }],
  ['/record-rule/preview', { table: 'Missing', rule: '1' }],
  ['/totp/Owner/confirm', { code: '000000' }],
] as const) test(`AR-server-auth-01 security ${path}`, async (t) => {
  const { host, api, store } = setup(t);
  store.setPassword('Admin', 'synthetic-password', '[Full Access]');
  store.setPassword('Owner', 'synthetic-password', '[Full Access]');
  const token = await login(api);
  const pending = begin(new SecurityApi(host, api), securityPath + path, 'POST', { authorization: `Bearer ${token}` });
  pending.stream.write('{');
  await new Promise<void>((resolve) => setImmediate(resolve));
  store.setAccountPrivilegeSet('Admin', 'Reader');
  const before = store.securityToken();
  pending.stream.end(JSON.stringify(body).slice(1));
  assert.equal((await pending.done).status, 403);
  assert.equal(store.securityToken(), before);
});

for (const resource of ['Users', 'Groups']) for (const method of ['PUT', 'PATCH']) test(`AR-server-auth-01 SCIM ${resource} ${method}`, async (t) => {
  const { host, api, store } = setup(t);
  const dir = new ScimDirectory(store);
  const token = dir.issueToken({ defaultPrivilegeSet: 'Reader' });
  const user = dir.create({ userName: 'member@example.test', active: true });
  dir.setMembers('Reader', [user.id]);
  const id = resource === 'Users' ? user.id : Buffer.from('Reader').toString('base64url');
  const pending = begin(new ScimEndpoint(host, api), `${scimPath}/${resource}/${id}`, method, { authorization: `Bearer ${token}` });
  pending.stream.write('{');
  await new Promise<void>((resolve) => setImmediate(resolve));
  dir.revokeToken();
  const before = store.securityToken();
  const body = resource === 'Users'
    ? method === 'PUT' ? { userName: user.account, active: false } : { Operations: [{ op: 'replace', path: 'active', value: false }] }
    : method === 'PUT' ? { members: [] } : { Operations: [{ op: 'remove', path: 'members' }] };
  pending.stream.end(JSON.stringify(body).slice(1));
  assert.equal((await pending.done).status, 401);
  assert.equal(store.accountInactive(user.account), false);
  assert.deepEqual(dir.members('Reader').map((r) => r.id), [user.id]);
  assert.equal(store.securityToken(), before);
});

test('AR-server-auth-02 configuration', async (t) => {
  const { folder } = setup(t);
  const connections = new Connections(folder);
  const made = connections.create({ name: 'Service', type: 'rest', config: { baseUrl: 'https://example.test', auth: 'none' } });
  connections.approve(made.id);
  let finish!: (response: Response) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  connections.io.fetch = async () => { entered(); return new Promise<Response>((resolve) => { finish = resolve; }); };
  const pending = connections.test(made.id);
  await started;
  connections.update(made.id, { config: { baseUrl: 'https://replacement.test', auth: 'none' } });
  finish(new Response(null, { status: 200 }));
  assert.equal((await pending).ok, true);
  const current = new Connections(folder).get(made.id)!;
  assert.equal(current.config.baseUrl, 'https://replacement.test');
  assert.equal(current.status, 'draft');
  assert.equal(current.lastTest, undefined);
});

for (const mutation of ['update', 'remove', 'group']) test(`AR-server-auth-03 eligibility ${mutation}`, (t) => {
  const { store } = setup(t);
  const dir = new ScimDirectory(store);
  const user = dir.create({ userName: 'member@example.test', active: true });
  store.setPassword(user.account, 'local-password', 'Reader');
  const before = store.securityToken();
  assert.throws(() => {
    if (mutation === 'update') dir.update(user, { userName: user.account, active: false });
    else if (mutation === 'remove') dir.remove(user);
    else dir.setMembers('Reader', [user.id]);
  });
  assert.equal(store.accountInactive(user.account), false);
  assert.equal(store.securityToken(), before);
  assert.deepEqual(dir.members('Reader'), []);
});

test('AR-server-auth-03 legacy', (t) => {
  const { store } = setup(t);
  store.setExternalAccount('legacy@example.test', 'Reader');
  store.sql.exec(`CREATE TABLE _fm_scim_users (id TEXT PRIMARY KEY, account TEXT NOT NULL UNIQUE COLLATE NOCASE,
    external_id TEXT, attrs TEXT, groups TEXT, created TEXT NOT NULL, modified TEXT NOT NULL)`);
  store.sql.prepare('INSERT INTO _fm_scim_users VALUES (?, ?, NULL, NULL, ?, ?, ?)').run('legacy-id', 'legacy@example.test', '[]', '2000-01-01', '2000-01-01');
  const dir = new ScimDirectory(store);
  assert.equal(dir.row('legacy-id'), undefined);
  assert.equal(store.accountInactive('legacy@example.test'), false);
  const fresh = dir.create({ userName: 'legacy@example.test', active: true });
  assert.equal(dir.row(fresh.id)?.account_identity, store.accountIdentityId(fresh.account));
});

test('AR-server-auth-07 existing agent', async (t) => {
  const { folder, host, api, store } = setup(t);
  store.savePrivilegeSet({ ...store.privilegeSet('Reader')!, name: 'Other' });
  store.setAgentAccount('synthetic-agent', 'Reader', { needsApproval: true });
  const before = store.securityToken();
  t.mock.method(store, 'createApiToken', () => { throw new StoreError(960, 'synthetic token failure'); });
  const admin = new Admin(host, api);
  admin.mcpTokens = new McpTokens(folder);
  const response = await call(admin, '/tabularius/admin/v1/mcp/tokens', 'POST', { database: 'A', agent: { name: 'synthetic-agent', privilegeSet: 'Other', needsApproval: false } }, { 'x-tabularius-admin': '1' });
  assert.equal(response.status, 400);
  assert.equal(store.accountPrivilegeSet('synthetic-agent'), 'Reader');
  assert.equal(store.accounts().find((a) => a.name === 'synthetic-agent')?.needsApproval, true);
  assert.equal(store.securityToken(), before);
});

test('AR-server-auth-03 persisted identity', (t) => {
  const { store } = setup(t);
  const dir = new ScimDirectory(store);
  const user = dir.create({ userName: 'member@example.test', active: true });
  assert.equal(new ScimDirectory(store).row(user.id)?.account_identity, store.accountIdentityId(user.account));
  store.sql.prepare('DELETE FROM _fm_accounts WHERE name = ?').run(user.account);
  store.setExternalAccount(user.account, 'Reader');
  assert.throws(() => dir.update(user, { userName: user.account, active: false }));
  assert.equal(new ScimDirectory(store).row(user.id), undefined);
  assert.equal(store.accountInactive(user.account), false);
});

test('AR-server-auth-07 inactive agent', async (t) => {
  const { folder, host, api, store } = setup(t);
  store.setAgentAccount('synthetic-agent', 'Reader', { needsApproval: true });
  store.setAccountActive('synthetic-agent', false);
  const before = store.securityToken();
  const admin = new Admin(host, api);
  admin.mcpTokens = new McpTokens(folder);
  const response = await call(admin, '/tabularius/admin/v1/mcp/tokens', 'POST', { database: 'A', agent: { name: 'synthetic-agent', privilegeSet: 'Reader', needsApproval: false } }, { 'x-tabularius-admin': '1' });
  assert.equal(response.status, 400);
  assert.equal(store.accountInactive('synthetic-agent'), true);
  assert.equal(store.accounts().find((a) => a.name === 'synthetic-agent')?.needsApproval, true);
  assert.deepEqual(store.apiTokens(), []);
  assert.equal(store.securityToken(), before);
});

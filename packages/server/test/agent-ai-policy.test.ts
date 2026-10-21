import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { applySecurityChanges } from '../src/security.ts';
import { checkPlan } from '../src/agent.ts';

test('explicit agent accounts cannot bypass policy through Data API tokens; legacy and human access are unchanged', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-api-policy-'));
  createStore(join(dir, 'Shop.openhbam.sqlite'));
  const hosted = await serve({ dir, port: 0, log: () => {} });
  try {
    const store = hosted.host.get('Shop')!;
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Password' }] }]);
    store.create('Items', { Name: 'visible', Password: 'private-value' });
    const bot = { name: 'Bot', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest', 'fmmcp'] };
    store.savePrivilegeSet(bot); store.setAgentAccount('bot', 'Bot', { createdBy: 'Admin' });
    let token = store.createApiToken('bot', { surfaces: ['fmrest'] });
    const read = async (bearer = token) => {
      const r = await fetch(`${hosted.url}/fmi/data/vLatest/databases/Shop/layouts/Items/records`, { headers: { authorization: `Bearer ${bearer}` } });
      return { status: r.status, body: await r.json() };
    };
    const refused = await read(); assert.notEqual(refused.status, 200); assert.match(JSON.stringify(refused.body), /AI policy.*refused/i);
    assert.doesNotMatch(JSON.stringify(refused.body), /private-value/);
    const full = store.privileges('Admin').set;
    store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
    const human = store.createApiToken('Admin', { surfaces: ['fmrest'] });
    assert.equal((await read(human)).status, 200, 'human API is unchanged');
    for (const route of ['dry-run', 'step', 'runs/000000000000/undo']) await t.test(`agent ${route} refuses before its action`, async () => {
      const response = await fetch(`${hosted.url}/tabularius/agent/v1/databases/Shop/${route}`, { method: 'POST', headers: { authorization: `Bearer ${human}`, 'content-type': 'application/json' }, body: JSON.stringify({ plan: { layout: 'Items', steps: [{ kind: 'find' }] }, step: 0 }) });
      assert.match(JSON.stringify(await response.json()), /AI policy.*refused/i);
    });
    store.setAiPolicy(false);
    const before = store.privilegeSets();
    assert.throws(() => applySecurityChanges(store, [{ op: 'savePrivilegeSet', set: { ...bot, aiVisible: { Items: true } } }], 'bot'), /AI.visibility/);
    assert.deepEqual(store.privilegeSets(), before);
    assert.throws(() => checkPlan(store, { layout: 'Items', steps: [{ kind: 'savePrivilegeSet', set: { ...bot, aiVisible: { Items: true } } }] }, store.privileges('bot')), /a step is find, set, create, delete or script/);
    const security = await fetch(`${hosted.url}/tabularius/security/v1/databases/Shop`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ changes: [{ op: 'savePrivilegeSet', set: { ...bot, aiVisible: { Items: true } } }] }) });
    assert.notEqual(security.status, 200);
    assert.deepEqual(store.privilegeSets(), before);
    store.sql.exec("DELETE FROM _fm_meta WHERE key = 'aiPolicy'");
    const absent = await read(); assert.equal(absent.status, 200);
    store.sql.exec("INSERT INTO _fm_meta VALUES ('aiPolicy', 'false')");
    assert.deepEqual(await read(), absent);
    store.setAiPolicy(true);
    store.savePrivilegeSet({ ...bot, aiVisible: { Items: ['Password'] } });
    assert.equal((await read()).status, 401, 'the changed authority revoked the bot\'s token');
    token = store.createApiToken('bot', { surfaces: ['fmrest'] });
    assert.equal((await read()).status, 200);

    // New create-only store ops must receive the same AI visibility checks as
    // their update counterparts, and AI cannot provision an empty-password login.
    await t.test('createAccount cannot bind an AI account to an AI-visible set', () => {
      const accountsBefore = store.accounts();
      assert.throws(
        () => applySecurityChanges(store, [{ op: 'createAccount', kind: 'external', name: 'NewBot', privilegeSet: 'Bot' }], 'bot'),
        /AI visibility can only be changed by a human/,
      );
      assert.deepEqual(store.accounts(), accountsBefore);
    });
    await t.test('createPrivilegeSet cannot target an existing AI-visible set', () => {
      const accountsBefore = store.accounts();
      assert.throws(
        () => applySecurityChanges(store, [{ op: 'createPrivilegeSet', set: { name: 'Bot' } }], 'bot'),
        /AI visibility can only be changed by a human/,
      );
      assert.deepEqual(store.accounts(), accountsBefore);
    });
    await t.test('AI cannot create a password account without an explicit password', () => {
      const accountsBefore = store.accounts();
      assert.throws(
        () => applySecurityChanges(store, [{ op: 'createAccount', kind: 'password', name: 'NoPassword', privilegeSet: '[Full Access]' }], 'bot'),
        /AI tools cannot create password accounts/,
      );
      assert.deepEqual(store.accounts(), accountsBefore);
    });
    store.savePrivilegeSet({ name: 'AgentPasswordTarget', records: { view: false, edit: false, create: false, delete: false }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [] });
    store.setPassword('ExistingBotBound', 'existing-password', 'Bot');
    for (const [label, password, present] of [
      ['missing', undefined, false], ['empty', '', true], ['whitespace', ' \t ', true], ['non-string', 42, true],
    ] as const) {
      await t.test(`agent password policy refuses ${label} on create and set`, () => {
        const accountsBefore = store.accounts();
        const create = { op: 'createAccount', kind: 'password', name: `Agent_${label}`, privilegeSet: 'AgentPasswordTarget', ...(present ? { password } : {}) };
        const set = { op: 'setAccount', name: `AgentSet_${label}`, ...(present ? { password } : {}) };
        assert.throws(() => applySecurityChanges(store, [create as never], 'bot'), /cannot create password accounts/i);
        assert.throws(() => applySecurityChanges(store, [set as never], 'bot'), /cannot create password accounts/i);
        if (present) assert.throws(() => applySecurityChanges(store, [{ op: 'setAccount', name: 'ExistingBotBound', password } as never], 'bot'), /cannot create password accounts/i);
        assert.deepEqual(store.accounts(), accountsBefore);
      });
    }
  } finally { await new Promise<void>((r) => hosted.server.close(() => r())); rmSync(dir, { recursive: true, force: true }); }
});

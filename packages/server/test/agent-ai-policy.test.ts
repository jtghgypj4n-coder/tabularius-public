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
  } finally { await new Promise<void>((r) => hosted.server.close(() => r())); rmSync(dir, { recursive: true, force: true }); }
});

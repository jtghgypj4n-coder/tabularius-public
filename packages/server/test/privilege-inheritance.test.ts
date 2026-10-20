import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Host } from '../src/host.ts';
import { Schedules } from '../src/schedules.ts';
import { InboundHooks, hookSignature } from '../src/inbound-hooks.ts';
import { createMcpServer } from '../src/mcp.ts';
import { runApprovedStep, type AgentPlan } from '../src/agent.ts';
import { AutomationRunner, cleanAutomation, dryRunAutomation, saveAutomation } from '../src/automations.ts';
import type { OutboxEntry } from '../../scripts/src/index.ts';
import { IDENTITIES, IDENTITY, SECRET, covering, context, identityText, populate, installChain, expectedChain, putScript } from '../../scripts/test/privilege-inheritance-model.ts';

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-inheritance-automation-'));
  const host = new Host(dir, () => {}, { background: false });
  t.after(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
  const store = host.create('Generated'); populate(store);
  return { host, store };
}

for (const formula of ['condition', 'parameter'] as const) test(`automation ${formula} cannot launder hidden fields into a restricted script`, async (t) => {
  const { host, store } = setup(t);
  const entries: OutboxEntry[] = [];
  host.outbound = { allowHosts: [], record: (entry) => entries.push(entry), fetch: async () => { assert.fail('network must not run'); } };
  putScript(store, 'Capture', `Send Mail [ Send via SMTP Server ; To: "synthetic@example.invalid" ; Subject: ${IDENTITY} ; Message: Get ( ScriptParameter ) ]`);
  const runner = new AutomationRunner(host);
  for (const full of [false, true]) {
    store.schema.scripts.find((s) => s.name === 'Capture')!.fullAccess = full;
    for (const who of IDENTITIES) {
      saveAutomation(store, { name: 'Probe', replace: true, layout: 'Items', on: 'update', fields: ['Public'], script: 'Capture', account: who.account,
        ...(formula === 'condition' ? { condition: `Secret = "${SECRET}"`, parameter: '"constant"' } : { parameter: 'Evaluate ( "Secret" )' }),
      }, 'Admin', []);
      entries.length = 0;
      store.update('Items', 1, { Public: `${who.account}-${full}` }, undefined, { account: 'Admin' });
      await runner.idle(store);
      assert.equal(entries.length, formula === 'condition' && !who.read ? 0 : 1);
      if (entries[0]?.kind === 'mail') {
        assert.equal(entries[0].body, formula === 'condition' ? 'constant' : who.read ? SECRET : '');
        assert.equal(entries[0].subject, identityText(context(who, { ownFull: full, edge: 'local' }, 0)));
      }
    }
  }
});

for (const formula of ['condition', 'parameter'] as const) test(`automation dry-run ${formula} uses the same restricted context as live execution`, async (t) => {
  const { store } = setup(t);
  store.savePrivilegeSet({ ...store.privilegeSet('Editing')!, records: { view: true, edit: true, create: false, delete: false, fields: { Secret: 'none' } } });
  putScript(store, 'Mark', 'If [ Get ( ScriptParameter ) <> "" ]\nSet Field [ Items::Public ; "observed-hidden-input" ]\nCommit Records/Requests [ With dialog: Off ]\nEnd If');
  const spec = cleanAutomation(store, { name: 'Probe', layout: 'Items', on: 'update', script: 'Mark', account: 'Editor',
    ...(formula === 'condition' ? { condition: `Secret = "${SECRET}"`, parameter: '"constant"' } : { parameter: 'Secret' }),
  }, 'Admin', []);
  const result = await dryRunAutomation(store, spec);
  assert.equal(result.conditionTrue, formula !== 'condition');
  assert.equal(result.outcome, formula === 'condition' ? 'skipped' : 'ok');
  assert.deepEqual(result.changes, []);
  assert.equal(store.get('Items', 1).fieldData.Public, 'visible');
});

test('record automations enter generated script, server and trigger chains as the configured account', async (t) => {
  const { host, store } = setup(t);
  const entries: OutboxEntry[] = [];
  host.outbound = { allowHosts: [], record: (entry) => entries.push(entry), fetch: async () => { assert.fail('network must not run'); } };
  const runner = new AutomationRunner(host);
  for (const [index, frames] of covering().entries()) {
    installChain(store, frames);
    putScript(store, `Frame${frames.length - 1}`, `Send Mail [ Send via SMTP Server ; To: "synthetic@example.invalid" ; Subject: ${IDENTITY} ; Message: Items::Secret ]`, frames.at(-1)!.ownFull);
    for (const who of IDENTITIES) {
      entries.length = 0;
      saveAutomation(store, { name: 'Generated', replace: true, layout: 'Items', on: 'update', fields: ['Public'], script: 'Frame0', account: who.account }, 'Admin', []);
      store.update('Items', 1, { Public: `${index}-${who.account}` }, undefined, { account: 'Admin' });
      await runner.idle(store);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].kind, 'mail');
      if (entries[0].kind === 'mail') {
        const expected = context(who, frames.at(-1)!, frames.length - 1);
        assert.equal(entries[0].subject, identityText(expected));
        assert.equal(entries[0].body, expected.full || who.read ? SECRET : '');
      }
    }
  }
});

test('schedules and signed inbound hooks enter seeded compositions as their configured account', async (t) => {
  const { host, store } = setup(t);
  const schedules = new Schedules(host); t.after(() => schedules.stop());
  const hooks = new InboundHooks(host, true);
  const schedule = schedules.create({ name: 'Generated', database: store.name, script: 'Forbidden', account: 'Admin', enabled: false, everyMinutes: 1440, at: '01:00' });
  const hook = hooks.create({ name: 'Generated', database: store.name, script: 'Forbidden', account: 'Admin', layout: 'Items', perMinute: 100 });
  let sequence = 0;
  for (const [index, frames] of covering().entries()) {
    installChain(store, frames);
    for (const who of IDENTITIES) await t.test(`graph ${index}, ${who.account}`, async () => {
      // Editing account and schedule time must take effect on the next run.
      schedules.update(schedule.id, { script: 'Frame0', account: who.account, at: index % 2 ? '02:00' : '03:00' });
      const scheduled = await schedules.run(schedule.id);
      assert.equal(scheduled.error, 0);
      assert.equal(scheduled.result, expectedChain(who, frames, 'read'));
      hooks.update(hook.id, { script: 'Frame0', account: who.account });
      const body = JSON.stringify({ sequence: sequence++ });
      const stamp = String(Math.floor(Date.now() / 1000));
      const req = Object.assign(Readable.from([Buffer.from(body)]), {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-timestamp': stamp, 'x-tabularius-signature': hookSignature(hook.secret, stamp, body) },
        socket: { remoteAddress: '127.0.0.1' },
      }) as unknown as IncomingMessage;
      let status = 0, response = '';
      const res = { writeHead(code: number) { status = code; }, end(text: string) { response = text; } } as unknown as ServerResponse;
      assert.equal(await hooks.handle(req, res, new URL(hook.path, 'http://localhost')), true);
      assert.equal(status, 200);
      assert.deepEqual(JSON.parse(response), { ok: true, result: expectedChain(who, frames, 'read') });
    });
  }
});

test('MCP run_script composes contexts and cannot bypass a token write ceiling', async (t) => {
  const { host, store } = setup(t);
  for (const who of IDENTITIES) for (const readOnly of [false, true]) await t.test(`${who.account}, readOnly=${readOnly}`, async () => {
    const server = createMcpServer(host, { account: who.account, database: store.name, scope: { readOnly } });
    const client = new Client({ name: 'inheritance-test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      for (const frames of covering()) {
        installChain(store, frames);
        // Identity probes avoid MCP's separate credential-value masking policy.
        putScript(store, `Frame${frames.length - 1}`, `Set Variable [ $$result${frames.length - 1} ; Value: ${IDENTITY} ]\nExit Script [ Text Result: ${IDENTITY} ]`, frames.at(-1)!.ownFull);
        const reply = await client.callTool({ name: 'run_script', arguments: { database: store.name, layout: 'Items', script: 'Frame0' } });
        assert.equal(!!reply.isError, readOnly, JSON.stringify(reply));
        const payload = JSON.parse((reply.content as { text: string }[])[0].text);
        if (readOnly) assert.equal(payload.code, 9, 'a read-only token forbids all script execution');
        else {
          let expected = identityText(context(who, frames.at(-1)!, frames.length - 1));
          for (let i = frames.length - 2; i >= 0; i--) { const id = identityText(context(who, frames[i], i)); expected = `${id}>${expected}<${id}`; }
          assert.equal(payload.result, expected);
        }
      }
      store.update('Items', 1, { Secret: SECRET });
      putScript(store, 'ElevatedWrite', 'Set Field [ Items::Secret ; "changed" ]\nCommit Records/Requests [ With dialog: Off ]\nExit Script [ Text Result: Get ( LastError ) ]', true);
      await client.callTool({ name: 'run_script', arguments: { database: store.name, layout: 'Items', script: 'ElevatedWrite' } });
      assert.equal(store.get('Items', 1).fieldData.Secret, readOnly ? SECRET : 'changed');
      const denied = await client.callTool({ name: 'run_script', arguments: { database: store.name, layout: 'Items', script: 'Forbidden' } });
      assert.equal(!!denied.isError, readOnly || !who.full);
    } finally { await client.close(); await server.close(); }
  });
});

test('AI approved steps use account privileges after elevated scripts and reject forged record state', async (t) => {
  const { store } = setup(t);
  for (const who of IDENTITIES) for (const full of [false, true]) await t.test(`${who.account}, script full=${full}`, async () => {
    store.sql.exec('DELETE FROM Items');
    const id = store.create('Items', { Public: 'visible', Secret: SECRET }).recordId;
    installChain(store, [{ ownFull: full, edge: 'server' }, { ownFull: full, edge: 'local' }], 'write');
    const plan: AgentPlan = { summary: 'Synthetic privilege probe', layout: 'Items', steps: [
      { kind: 'script', script: 'Frame0' }, { kind: 'set', field: 'Public', value: 'after' }, { kind: 'delete' },
    ] };
    const identity = { account: who.account, privileges: store.privileges(who.account) };
    await runApprovedStep(store, plan, 0, undefined, undefined, identity);
    assert.equal(store.get('Items', id).fieldData.Secret, full || who.write ? 'changed' : SECRET);
    const next = await runApprovedStep(store, plan, 1, { layout: 'Items', foundSet: [id, 999_999] }, undefined, identity);
    assert.equal(next.result.outcome, who.write ? 'ok' : 'error');
    assert.equal(store.get('Items', id).fieldData.Public, who.write ? 'after' : 'visible');
    const deleted = await runApprovedStep(store, plan, 2, { layout: 'Items', foundSet: [id] }, undefined, identity);
    assert.equal(deleted.result.outcome, who.delete ? 'ok' : 'error');
    assert.equal(store.query('SELECT * FROM Items').length, who.delete ? 0 : 1);
    if (!who.read && !full) assert.ok(!JSON.stringify(next).includes(SECRET));
  });
});

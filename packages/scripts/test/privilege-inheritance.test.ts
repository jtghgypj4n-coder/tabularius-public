import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript, type OutboxEntry } from '../src/index.ts';
import { checkFormula } from '../../calc/src/index.ts';
import { IDENTITIES, IDENTITY, SECRET, generated, coverage, covering, context, identityText, openSynthetic, installChain, expectedChain, putScript } from './privilege-inheritance-model.ts';

test('fixed seeds cover every edge and elevation transition at bounded nesting', () => {
  const graphs = [0x2411, 0x17_01].flatMap((seed) => generated(seed));
  assert.deepEqual(generated(0x2411), generated(0x2411));
  assert.deepEqual(new Set(graphs.map((g) => g.length)), new Set([2, 3, 4]));
  assert.deepEqual(coverage(graphs), [], 'all caller/callee elevation pairs on every edge');
  assert.deepEqual(coverage(covering()), [], 'the subset the server surfaces walk covers them too');
});

test('PrivilegeSetName is not silently treated as either supported identity getter', () => {
  assert.equal(checkFormula('Get ( PrivilegeSetName )').ok, false);
  assert.equal(checkFormula('Get ( AccountPrivilegeSetName )').ok, true);
  assert.equal(checkFormula('Get ( CurrentPrivilegeSetName )').ok, true);
});

test('a denied named entry cannot authorize itself with its own full-access setting', async (t) => {
  const s = openSynthetic(); t.after(s.close);
  putScript(s.store, 'Forbidden', 'Set Field [ Items::Secret ; "changed" ]\nCommit Records/Requests [ With dialog: Off ]', true);
  for (const who of IDENTITIES.filter((who) => !who.full)) {
    await assert.rejects(runScript(s.store, 'Forbidden', { layout: 'Items', account: who.account, privileges: s.store.privileges(who.account), network: false }),
      (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === 9);
    assert.equal(s.store.get('Items', 1).fieldData.Secret, SECRET);
  }
});

for (const seed of [0x2411, 0x17_01]) test(`seed ${seed}: composed privilege contexts`, async (t) => {
  const s = openSynthetic();
  t.after(s.close);
  for (const [index, frames] of generated(seed).entries()) {
    for (const operation of ['read', 'write', 'delete', 'run'] as const) {
      installChain(s.store, frames, operation);
      for (const who of IDENTITIES) await t.test(`graph ${index}, ${operation}, ${who.account}`, async () => {
        s.store.sql.exec('DELETE FROM Items');
        s.store.create('Items', { Public: 'visible', Secret: SECRET });
        const result = await runScript(s.store, 'Frame0', { layout: 'Items', account: who.account, privileges: s.store.privileges(who.account), network: false });
        assert.equal(result.result, expectedChain(who, frames, operation));
        const full = context(who, frames.at(-1)!, frames.length - 1).full;
        const rows = s.store.query('SELECT Secret FROM Items');
        assert.equal(rows.length, operation === 'delete' && (full || who.delete) ? 0 : 1);
        if (rows.length) assert.equal(rows[0].Secret, operation === 'write' && (full || who.write) ? 'changed' : SECRET);
        if (!full && !who.read) assert.ok(!JSON.stringify(result).includes(SECRET), 'results and error envelopes cannot disclose denied values');
      });
    }
  }
});

test('unstored identity calculation follows the reader, including script-local elevation', async (t) => {
  const s = openSynthetic(); t.after(s.close);
  for (const who of IDENTITIES) {
    const privileges = s.store.privileges(who.account);
    const expected = identityText(context(who, { ownFull: false, edge: 'local' }, 0));
    assert.equal(s.store.evaluate('Items', IDENTITY, 1, { account: who.account, privileges }).value, expected);
    assert.equal(s.store.get('Items', 1, 'us', undefined, privileges).fieldData.Viewer, expected);
    for (const ownFull of [false, true]) {
      putScript(s.store, 'ViewerProbe', 'Exit Script [ Text Result: Items::Viewer ]', ownFull);
      const result = await runScript(s.store, 'ViewerProbe', { layout: 'Items', account: who.account, privileges, network: false });
      assert.equal(result.result, identityText(context(who, { ownFull, edge: 'local' }, 0)));
    }
  }
});

test('saved privilege-set reassignment changes calculation identity without changing the writer', (t) => {
  const s = openSynthetic(); t.after(s.close);
  s.store.setPassword('Reader', 'synthetic-password', 'Editing');
  const privileges = s.store.privileges('Reader');
  assert.equal(s.store.evaluate('Items', IDENTITY, 1, { account: 'Reader', privileges }).value, 'Reader|Editing|Editing');
  assert.equal(s.store.get('Items', 1, 'us', undefined, privileges).fieldData.Viewer, 'Reader|Editing|Editing');
});

test('denied data cannot influence nested calculation results or Get(LastError) diagnostics', async (t) => {
  const s = openSynthetic(); t.after(s.close);
  putScript(s.store, 'Errors', `Set Error Capture [ On ]
Set Variable [ $probe ; Value: Evaluate ( "Items::Secret" ) & ExecuteSQL ( "SELECT Public FROM Items WHERE Secret = 'first-hidden-value'" ; "" ; "" ) ]
Set Field [ Items::Secret ; "changed" ]
Commit Records/Requests [ With dialog: Off ]
Exit Script [ Text Result: $probe & "|" & Get ( LastError ) & "|" & Get ( LastErrorDetail ) ]`);
  putScript(s.store, 'ErrorParent', 'Perform Script on Server [ "Errors" ; Wait for completion: On ]\nExit Script [ Text Result: Get ( ScriptResult ) ]', true);
  const seen: string[] = [];
  for (const value of ['first-hidden-value', 'second-hidden-value']) {
    s.store.update('Items', 1, { Secret: value });
    const result = await runScript(s.store, 'ErrorParent', { layout: 'Items', account: 'Reader', privileges: s.store.privileges('Reader'), network: false });
    assert.equal(s.store.get('Items', 1).fieldData.Secret, value);
    assert.ok(!JSON.stringify(result).includes(value));
    seen.push(JSON.stringify({ result: result.result, error: result.error, actions: result.actions }));
  }
  assert.equal(seen[0], seen[1], 'changing denied inputs leaves results and diagnostics unchanged');
});

test('outbound capture callbacks see only the current frame data and never grant authority on return', async (t) => {
  const s = openSynthetic(); t.after(s.close);
  for (const who of IDENTITIES) for (const full of [false, true]) {
    putScript(s.store, 'Send', `Send Mail [ Send via SMTP Server ; To: "synthetic@example.invalid" ; Subject: ${IDENTITY} ; Message: Items::Secret ]\nExit Script [ Text Result: Get ( LastError ) ]`, full);
    putScript(s.store, 'OutboundParent', `Perform Script [ "Send" ]\nExit Script [ Text Result: ${IDENTITY} & "|" & Items::Secret ]`);
    const entries: OutboxEntry[] = [];
    const result = await runScript(s.store, 'OutboundParent', {
      layout: 'Items', account: who.account, privileges: s.store.privileges(who.account), network: false,
      outbound: { allowHosts: [], record: (entry) => entries.push(entry), fetch: async () => { assert.fail('outbound network must not run'); } },
    });
    assert.equal(entries.length, 1);
    const mail = entries[0]; assert.equal(mail.kind, 'mail');
    if (mail.kind === 'mail') {
      assert.equal(mail.subject, identityText(context(who, { ownFull: full, edge: 'local' }, 1)));
      assert.equal(mail.body, full || who.read ? SECRET : '');
    }
    assert.equal(result.result, `${identityText(context(who, { ownFull: false, edge: 'local' }, 0))}|${who.read ? SECRET : ''}`);
  }
});

test('a script run with no explicit privileges still reports the account\'s saved set', async (t) => {
  const s = openSynthetic(); t.after(s.close);
  putScript(s.store, 'WhoAmI', 'Exit Script [ Text Result: Get ( AccountPrivilegeSetName ) ]', false);
  for (const who of IDENTITIES) {
    const result = await runScript(s.store, 'WhoAmI', { layout: 'Items', account: who.account, network: false });
    assert.equal(result.result, who.set);
  }
});

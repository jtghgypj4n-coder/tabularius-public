import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStore, type PrivilegeDefinition } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';
import { createMcpServer, type McpIdentity } from '../src/mcp.ts';
import { PiiMasker } from '../src/pii.ts';

const OPEN = { view: true, edit: true, create: true, delete: true };
const SUBMITTED = 'submitted-value-a05fb294';

interface ToolResult { isError?: boolean; content: { type: string; text: string }[] }

async function setup(t: TestContext, changes: Partial<PrivilegeDefinition> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-denial-mcp-'));
  createStore(join(dir, 'Scratch.openhbam.sqlite'));
  const host = new Host(dir);
  const store = host.get('Scratch')!;
  store.setAiPolicy(false); // the denial messages under test, not the AI policy's refusal
  store.applyDesign([
    { op: 'createTable', name: 'T', fields: [{ name: 'A' }, { name: 'Secret' }] },
    { op: 'createScript', name: 'Blocked' },
  ]);
  const id = store.create('T', { A: 'readable', Secret: 'hidden-value-sentinel' }).recordId;
  store.savePrivilegeSet({ name: 'Clerk', records: { ...OPEN }, layouts: 'modifiable', valueLists: 'none', scripts: 'none',
    extendedPrivileges: ['fmmcp'], ...changes });
  store.setPassword('clerk', 'pw', changes.name ?? 'Clerk');
  const server = createMcpServer(host, { account: 'clerk', password: 'pw' });
  const client = new Client({ name: 'access-denial-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await server.close();
    await host.close();
    rmSync(dir, { recursive: true });
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const tool = async (name: string, args: object): Promise<ToolResult> =>
    await client.callTool({ name, arguments: { database: 'Scratch', ...args } }) as ToolResult;
  return { store, id, tool };
}

function noLeaks(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of [SUBMITTED, 'hidden-value-sentinel', 'policyFingerprint', 'location', 'outcome', '_fm_record_id']) {
    assert.ok(!text.includes(secret), `unexpected disclosure: ${secret}`);
  }
}

test('tagged MCP errors retain original messages, including describe_record', async (t) => {
  const { store, id, tool } = await setup(t, { records: { ...OPEN, view: '0' } });
  for (const name of ['get_record', 'describe_record']) {
    const result = await tool(name, { layout: 'T', recordId: id });
    assert.equal(result.isError, true);
    const error = JSON.parse(result.content[0].text);
    assert.equal(error.code, 200);
    assert.equal(error.message, 'Record access is denied');
    assert.match(error.denial.explanation, /record-view rule is limited/);
  }
  store.savePrivilegeSet({ ...store.privilegeSet('Clerk')!, records: { ...OPEN, fields: { A: 'viewOnly' } } });
  const field = JSON.parse((await tool('update_record', { layout: 'T', recordId: id, fieldData: { A: SUBMITTED } })).content[0].text);
  assert.equal(field.code, 201);
  assert.equal(field.message, 'Field "A" cannot be modified');
  store.savePrivilegeSet({ ...store.privilegeSet('Clerk')!, layoutAccess: { T: { layout: 'viewOnly', records: 'viewOnly' } } });
  const layout = JSON.parse((await tool('update_record', { layout: 'T', recordId: id, fieldData: { A: SUBMITTED } })).content[0].text);
  assert.equal(layout.code, 200);
  assert.equal(layout.message, 'Record access is denied: layout "T" is view only');
  const script = JSON.parse((await tool('run_script', { layout: 'T', script: 'Blocked' })).content[0].text);
  assert.equal(script.code, 9);
  assert.equal(script.message, 'Insufficient privileges to run script "Blocked"');
  store.savePrivilegeSet({ ...store.privilegeSet('Clerk')!, extendedPrivileges: [] });
  const gate = JSON.parse((await tool('get_record', { layout: 'T', recordId: id })).content[0].text);
  assert.equal(gate.code, 9);
  assert.equal(gate.message, 'Insufficient privileges: the "Clerk" privilege set needs the fmmcp extended privilege (AI access) in Scratch');
});

test('isolated denial messages and explanations mask emails and vaulted personal values in set names, including surface gates', async (t) => {
  const email = 'alice@example.com';
  const person = 'Amelia Vaultsentinel';
  const name = `Client ${email} ${person}`;
  const { store, id, tool } = await setup(t, { name, records: { ...OPEN, view: false } });
  store.setPiiIsolation(true);
  const masker = new PiiMasker(store, 'clerk');
  const personToken = masker.token(person, 'PERSON');
  const check = (result: ToolResult, code: number, permission: string) => {
    assert.equal(result.isError, true);
    const text = JSON.stringify(result);
    assert.ok(!text.includes(email), text);
    assert.ok(!text.includes(person), text);
    const error = JSON.parse(result.content[0].text);
    assert.equal(error.code, code);
    assert.equal(error.denial.permission, permission);
    assert.match(error.denial.explanation, /<EMAIL_\d+>/);
    assert.ok(error.denial.explanation.includes(personToken));
    return error;
  };
  const read = check(await tool('get_record', { layout: 'T', recordId: id }), 200, 'view');
  assert.equal(read.message, 'Record access is denied');
  const script = await tool('run_script', { script: 'Blocked', layout: 'T' });
  assert.match(script.content[0].text, /isn't available/);
  assert.ok(!JSON.stringify(script).includes('denial'));
  store.savePrivilegeSet({ ...store.privilegeSet(name)!, extendedPrivileges: ['fmrest', 'fmapp'] });
  const gate = check(await tool('get_record', { layout: 'T', recordId: id }), 9, 'extended-privilege');
  assert.match(gate.message, /<EMAIL_\d+>/);
  assert.ok(gate.message.includes(personToken));
  // A denied write at the surface gate is suppressed just like a denied record write.
  const write = await tool('update_record', { layout: 'T', recordId: id, fieldData: { A: SUBMITTED } });
  assert.match(write.content[0].text, /The details aren't sent/);
  assert.ok(!JSON.stringify(write).includes('denial'));
  assert.ok(!JSON.stringify(write).includes(email));
  assert.ok(!JSON.stringify(write).includes(person));
});

test('hidden and nonexistent create/update targets stay equivalent and unlogged in either payload order', async (t) => {
  const { store, id, tool } = await setup(t, { records: { ...OPEN, edit: false, create: false, fields: { Secret: 'none', A: 'viewOnly' } } });
  const normalize = (value: unknown) => JSON.stringify(value).replace(/Secret|Absent/g, 'target');
  for (const edit of [false, true]) {
    store.savePrivilegeSet({ ...store.privilegeSet('Clerk')!, records: { ...OPEN, edit, create: false, fields: { Secret: 'none', A: 'viewOnly' } } });
    for (const isolation of [false, true]) {
      store.setPiiIsolation(isolation);
      for (const name of ['update_record', 'create_record']) {
        for (const order of ['alone', 'first', 'last']) {
          const payload = (target: string) => order === 'alone' ? { [target]: SUBMITTED }
            : order === 'first' ? { [target]: SUBMITTED, A: SUBMITTED } : { A: SUBMITTED, [target]: SUBMITTED };
          const args = { layout: 'T', ...(name === 'update_record' ? { recordId: id } : {}) };
          const hidden = await tool(name, { ...args, fieldData: payload('Secret') });
          const absent = await tool(name, { ...args, fieldData: payload('Absent') });
          assert.equal(hidden.isError, true); assert.equal(absent.isError, true);
          assert.equal(normalize(hidden), normalize(absent));
          assert.ok(!JSON.stringify(hidden).includes('denial')); assert.ok(!JSON.stringify(absent).includes('denial'));
          if (isolation) assert.match(hidden.content[0].text, /The details aren't sent/);
          else assert.deepEqual(JSON.parse(hidden.content[0].text), { code: 201, message: 'Field "Secret" cannot be modified' });
          noLeaks(hidden); noLeaks(absent);
          assert.equal(store.securityEvents({ kind: 'privilege-denied' }).length, 0);
        }
      }
    }
  }
});

test('cross-file denials use the owning file vault for accounts and layout-scoped tokens', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-denial-files-'));
  createStore(join(dir, 'A.openhbam.sqlite'));
  createStore(join(dir, 'B.openhbam.sqlite'));
  const host = new Host(dir);
  t.after(async () => { await host.close(); rmSync(dir, { recursive: true }); });
  const a = host.get('A')!;
  const b = host.get('B')!;
  a.setAiPolicy(false); b.setAiPolicy(false);
  const person = 'Amelia Vaultsentinel';
  const setName = `Client ${person}`;
  b.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Secret' }] }]);
  const id = b.create('T', { Secret: 'hidden-value-sentinel' }).recordId;
  b.savePrivilegeSet({ name: setName, records: { ...OPEN, view: false }, layouts: 'modifiable', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmmcp'] });
  b.setPassword('clerk', 'pw', setName);
  a.applyDesign([
    { op: 'createDataSource', name: 'B', paths: ['file:B'] },
    { op: 'createOccurrence', name: 'External', file: 'B', externalTable: b.schema.tables[0].id },
    { op: 'createLayout', name: 'External', occurrence: 'External' },
  ]);
  a.savePrivilegeSet({ name: 'RequestRules', records: { ...OPEN }, layouts: 'modifiable', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmmcp'] });
  a.setPassword('clerk', 'pw', 'RequestRules');
  b.setPiiIsolation(true);
  assert.equal(a.piiIsolation, false);
  const scope = { layouts: ['External'] };
  for (const who of [
    { account: 'clerk', password: 'pw' },
    { account: 'clerk', database: 'A', scope },
  ] satisfies McpIdentity[]) {
    const account = 'scope' in who ? `clerk\u0001${JSON.stringify(scope)}` : 'clerk';
    const requestMasker = new PiiMasker(a, account);
    requestMasker.token('RequestOnly Vaultsentinel', 'PERSON');
    const ownerMasker = new PiiMasker(b, account);
    ownerMasker.token('OwnerOnly Vaultsentinel', 'PERSON');
    const personToken = ownerMasker.token(person, 'PERSON');
    const server = createMcpServer(host, who);
    const client = new Client({ name: 'access-denial-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({ name: 'get_record', arguments: { database: 'A', layout: 'External', recordId: id } }) as ToolResult;
      assert.equal(result.isError, true);
      const text = JSON.stringify(result);
      assert.ok(!text.includes(person), text);
      assert.ok(text.includes(personToken), text);
      const error = JSON.parse(result.content[0].text);
      assert.equal(error.code, 200);
      assert.equal(error.message, 'Record access is denied');
      assert.equal(error.denial.permission, 'view');
      assert.deepEqual(Object.keys(error.denial).sort(), ['explanation', 'operation', 'permission']);
      noLeaks(result);
    } finally {
      await client.close();
      await server.close();
    }
  }
});

for (const channel of ['direct', 'variable', 'subscript']) {
  for (const handled of [false, true]) {
    for (const isolatedAtEntry of [false, true]) test(`dynamic script ${channel}, ${handled ? 'handled' : 'terminal'}: ${isolatedAtEntry ? 'isolation blocks entry' : 'owner vault survives isolation enabled before serialization'}`, async (t) => {
      const dir = mkdtempSync(join(tmpdir(), 'tabularius-denial-script-files-'));
      createStore(join(dir, 'A.openhbam.sqlite')); createStore(join(dir, 'B.openhbam.sqlite'));
      const host = new Host(dir);
      const a = host.get('A')!, b = host.get('B')!;
      a.setAiPolicy(false); b.setAiPolicy(false);
      const person = 'Amelia DiagnosticVaultsentinel';
      const name = `Client ${person}`;
      for (const [store, setName] of [[a, 'Entry rules'], [b, name]] as const) {
        store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'A' }] }]);
        store.create('T', { A: 'row-value-sentinel' });
        store.savePrivilegeSet({ name: setName, records: { ...OPEN, delete: false }, layouts: 'modifiable', scripts: 'viewOnly', valueLists: 'none', extendedPrivileges: ['fmmcp'] });
        store.setPassword('clerk', 'pw', setName);
      }
      const owner = new PiiMasker(b, 'clerk'); owner.token('Other owner sentinel', 'PERSON');
      const token = owner.token(person, 'PERSON');
      const entry = new PiiMasker(a, 'clerk'); const wrongToken = entry.token(person, 'PERSON');
      assert.notEqual(token, wrongToken);
      const tail = channel === 'variable' ? 'Set Variable [ $detail ; Value: Get ( LastErrorDetail ) ]\nExit Script [ Text Result: $detail ]'
        : channel === 'subscript' ? 'Perform Script [ “Detail” ]\nExit Script [ Text Result: Get ( ScriptResult ) ]'
        : 'Exit Script [ Text Result: Get ( LastErrorDetail ) ]';
      b.applyDesign([
        { op: 'createScript', name: 'Detail', text: 'Exit Script [ Text Result: Get ( LastErrorDetail ) ]' },
        { op: 'createScript', name: 'Child', text: 'Delete Record/Request [ With dialog: Off ]\n' + tail },
      ]);
      a.applyDesign([{ op: 'createScript', name: 'Caller', text: 'Perform Script [ Specified: By name ; "B::Child" ]\n' + (handled
        ? 'Set Variable [ $detail ; Value: Get ( ScriptResult ) ]\nExit Script [ Text Result: $detail ]'
        : 'Exit Script [ Text Result: Get ( ScriptResult ) ]') }]);
      assert.equal(a.schema.dataSources.length, 0);
      let entered = 0;
      const remove = b.delete.bind(b);
      t.mock.method(b, 'delete', (...args: Parameters<typeof remove>) => {
        entered++;
        return remove(...args);
      });
      const options = host.scriptOptions.bind(host);
      t.mock.method(host, 'scriptOptions', () => ({ ...options(), profile: {
        step: () => {}, run: () => {},
        leave: (file: string, script: string) => {
          if (file === 'B' && script === 'Child') b.setPiiIsolation(true);
          // Finish capturing the caller's safe result before its next context would be blocked too.
          if (file === 'A' && script === 'Caller') a.setPiiIsolation(true);
        },
      } }));
      b.setPiiIsolation(isolatedAtEntry);
      const server = createMcpServer(host, { account: 'clerk', password: 'pw' });
      const client = new Client({ name: 'script-denial-test', version: '1.0.0' });
      t.after(async () => { await client.close(); await server.close(); await host.close(); rmSync(dir, { recursive: true }); });
      const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
      const result = await client.callTool({ name: 'run_script', arguments: { database: 'A', script: 'Caller', layout: 'T', trace: true } }) as ToolResult;
      const json = JSON.stringify(result); assert.ok(!json.includes(person), json); noLeaks(result);
      const run = JSON.parse(result.content[0].text);
      // The file is hosted but not declared as a data source, so a by-name call never reaches it: nothing runs in it,
      // nothing of its vault is read, and the refusal says the same thing whether or not isolation is on.
      assert.equal(entered, 0);
      assert.equal(run.error, handled ? 0 : 100); assert.equal(run.result, ''); assert.ok(!run.denial);
      assert.equal(b.securityEvents({ kind: 'privilege-denied' }).length, 0);
      assert.equal(a.securityEvents({ kind: 'privilege-denied' }).length, 0);
    });
  }
}

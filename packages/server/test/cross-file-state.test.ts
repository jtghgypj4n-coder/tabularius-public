import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp.ts';
import { Assistant } from '../src/assistant.ts';
import { DataApi } from '../src/dataapi.ts';
import { PiiMasker } from '../src/pii.ts';
import { runScript } from '../../scripts/src/index.ts';
import { openIsolation, rest, type Isolation } from './cross-file-matrix.ts';

let m: Isolation;
before(async () => {
  m = await openIsolation();
  for (const [i, store] of m.stores.entries()) store.applyDesign([
    { op: 'createLayout', name: `Private${i}`, occurrence: 'Items' },
    { op: 'createScript', name: 'PluginState', text: 'If [ not IsEmpty ( Get ( ScriptParameter ) ) ]\nSet Variable [ $$regex ; Value: MBS ( "RegEx.Compile" ; Get ( ScriptParameter ) ; 0 ) ]\nEnd If\nExit Script [ Text Result: MBS ( "RegEx.List" ) ]' },
    { op: 'createScript', name: 'LocalSQL', text: 'Exit Script [ Text Result: ExecuteSQL ( "SELECT Value FROM Items" ; "" ; "" ) ]' },
    { op: 'createScript', name: 'ExternalSQL', text: 'Exit Script [ Text Result: ExecuteSQL ( "SELECT Value FROM ExternalItems" ; "" ; "" ) ]' },
  ]);
});
after(async () => { await m?.close(); });

for (const surface of ['Data API', 'OData', 'MCP']) test(`${surface}: same account and script ids retain separate globals and plug-in handles`, async () => {
  const clients: Client[] = [], servers: ReturnType<typeof createMcpServer>[] = [];
  try {
    if (surface === 'MCP') for (const store of m.stores) {
      const server = createMcpServer(m.host, { database: store.name, account: 'Shared' });
      const client = new Client({ name: 'state-matrix', version: '1' });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(a), client.connect(b)]);
      clients.push(client); servers.push(server);
    }
    const call = async (i: number, script: string, parameter = ''): Promise<string> => {
      const db = encodeURIComponent(m.stores[i].name);
      if (surface === 'MCP') {
        const result = await clients[i].callTool({ name: 'run_script', arguments: { database: m.stores[i].name, script, layout: 'Items', parameter } });
        assert.ok(!result.isError, JSON.stringify(result));
        return JSON.parse((result.content as { text: string }[])[0].text).result;
      }
      const r = surface === 'OData'
        ? await m.request(`/fmi/odata/v4/${db}/Script.${script}`, m.tokens[i], 'POST', { scriptParameterValue: parameter })
        : await m.request(rest(db) + `/layouts/Items/script/${script}?script.param=${encodeURIComponent(parameter)}`, m.sessions[i]);
      assert.equal(r.status, 200, r.text);
      return surface === 'OData' ? r.data.scriptResult.resultParameter : r.data.response.scriptResult;
    };
    assert.equal(await call(0, 'PluginState'), '');
    assert.notEqual(await call(0, 'PluginState', 'file-zero'), '');
    assert.equal(await call(1, 'PluginState'), '', 'foreign plug-in handles are absent');
    assert.equal(await call(0, 'State', 'state-zero'), 'state-zero');
    assert.equal(await call(1, 'State'), '', 'foreign global is absent');
    assert.equal(await call(1, 'State', 'state-one'), 'state-one');
    assert.equal(await call(0, 'State'), 'state-zero');
  } finally {
    for (const client of clients) await client.close();
    for (const server of servers) await server.close();
  }
});

test('ExecuteSQL and warmed calculation caches use the owning file and current destination privileges', async () => {
  const run = (i: number, script: string, account = 'Shared') => runScript(m.stores[i], script, { layout: 'Items', account, privileges: m.stores[i].privileges(account) });
  for (let warm = 0; warm < 3; warm++) {
    for (const i of [0, 1]) assert.equal((await run(i, 'LocalSQL')).result, `SENTINEL_${i}`);
    assert.equal((await run(0, 'ExternalSQL')).result, 'SENTINEL_1');
    assert.equal((await run(1, 'ExternalSQL')).result, '?', 'no reverse occurrence');
    assert.equal((await run(0, 'ExternalSQL', 'Only0')).result, '', 'no B account: no visible rows');
  }
  const b = m.stores[1], original = b.privilegeSet('Reader')!;
  try {
    b.savePrivilegeSet({ ...original, records: { view: false, edit: false, create: false, delete: false } });
    assert.equal((await run(0, 'ExternalSQL')).result, '', 'warm data cannot outlive B read privileges');
  } finally { b.savePrivilegeSet(original); }
  assert.equal((await run(0, 'ExternalSQL')).result, 'SENTINEL_1');
});

test('AI stand-in and plug-in configuration caches remain file-local with equal account and numeric ids', () => {
  const maskers = m.stores.map((store) => new PiiMasker(store, 'Shared'));
  const tokens = maskers.map((masker, i) => masker.text(`person${i}@example.test`));
  assert.equal(tokens[0], tokens[1], 'same local vault id intentionally collides');
  for (const i of [0, 1]) {
    assert.equal(new PiiMasker(m.stores[i], 'Shared').unmask(tokens[1 - i]), `person${i}@example.test`);
    const plugins = m.host.plugins, id = 'com.openhbam.baseelements';
    plugins.setBuiltin(m.stores[i].name.toUpperCase(), id, false);
    try {
      assert.equal(plugins.builtinOff(m.stores[i].name.toLowerCase(), 'BE_VariableGet'), true);
      assert.equal(plugins.builtinOff(m.stores[1 - i].name, 'BE_VariableGet'), false);
    } finally { plugins.setBuiltin(m.stores[i].name, id, true); }
  }
});

test('assistant internal AI tools cannot switch the authenticated file', async () => {
  let destination = '';
  let targetLayout = '';
  const requests: any[] = [];
  const model = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => raw += chunk);
    req.on('end', () => {
      const sent = JSON.parse(raw); requests.push(sent);
      const last = sent.messages.at(-1).content;
      const result = Array.isArray(last) ? last.find((b: any) => b.type === 'tool_result') : undefined;
      const answer = result
        ? { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' }
        : { content: [{ type: 'tool_use', id: 'foreign-read', name: 'get_record', input: { database: destination, layout: targetLayout, recordId: 1 } }], stop_reason: 'tool_use' };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...answer, usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  try {
    const assistant = new Assistant(m.host, new DataApi(m.host), { apiKey: 'fake', model: 'fake', fastModel: 'fake', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}` });
    for (const from of [0, 1]) {
      requests.length = 0; destination = m.stores[1 - from].name;
      targetLayout = `Private${1 - from}`;
      const own = m.stores[from];
      const response = await assistant.chat(own, 'Shared', [{ role: 'user', content: 'Read the requested record' }], { layout: 'Items' }, own.privileges('Shared'));
      assert.equal(requests.length, 2);
      const result = requests[1].messages.at(-1).content.find((b: any) => b.type === 'tool_result');
      assert.equal(result.is_error, true, JSON.stringify(result));
      assert.doesNotMatch(JSON.stringify([result, response]), new RegExp(`SENTINEL_${1 - from}`));
    }
  } finally { await new Promise<void>((resolve) => model.close(() => resolve())); }
});

for (const from of [0, 1]) test(`live stream ${from}: a local event fences a refused foreign event`, async () => {
  const own = m.stores[from], other = m.stores[1 - from];
  const auth = await m.login(from, `Only${from}`, `only-${from}`);
  const abort = new AbortController();
  const response = await fetch(m.url + `/tabularius/live/v1/databases/${encodeURIComponent(own.name)}/events`, { headers: { authorization: auth }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]) });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  try {
    await reader.read(); // stream has subscribed
    other.update('Items', 1, { Value: 'foreign-event' });
    own.update('Items', 1, { Value: 'local-event' });
    let events = '';
    while (!events.includes(`"file":"${own.name}"`)) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      events += new TextDecoder().decode(chunk.value);
    }
    assert.ok(!events.includes(`"file":"${other.name}"`), events);
    const clients = await m.request(`/tabularius/live/v1/databases/${encodeURIComponent(own.name)}/clients`, auth);
    assert.equal(clients.status, 200);
    assert.doesNotMatch(clients.text, new RegExp(`Only${1 - from}`));
  } finally {
    abort.abort(); await reader.cancel().catch(() => {});
    for (const [i, store] of m.stores.entries()) store.update('Items', 1, { Value: `SENTINEL_${i}` });
  }
});

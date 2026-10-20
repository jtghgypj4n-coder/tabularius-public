// The MCP tool semantic_find: records ranked by how close their stored embedding is to the question's. It exists only
// on a server with an embedding model, and it is held to the same rules as every other tool: the file's AI switch, the
// account's privileges (layout, records, the vector field), personal data isolation, and the read log.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStore } from '../../store/src/index.ts';
import { embeddingFile } from '../../calc/src/index.ts';
import { Host } from '../src/host.ts';
import { createMcpServer, type McpIdentity } from '../src/mcp.ts';

// A toy embedding model: one number per topic, counting the words about it.
const TOPICS = [['late', 'delay', 'slow'], ['broken', 'damaged', 'crack'], ['thanks', 'great', 'love']];
const vectorOf = (t: string) => TOPICS.map((words) => words.filter((w) => t.toLowerCase().includes(w)).length);

interface Setup { client: Client; host: Host; embedCalls: { file: string; account?: string; texts: string[] }[] }

async function setup(t: TestContext, opts: { embed?: boolean; who?: McpIdentity; model?: (t: string) => number[] } = {}): Promise<Setup> {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-semantic-'));
  createStore(join(dir, 'Support.openhbam.sqlite'));
  const host = new Host(dir);
  const embedCalls: Setup['embedCalls'] = [];
  if (opts.embed !== false) {
    host.scriptAi = {
      refusal: () => undefined,
      generate: async () => '',
      embed: async ({ file, account, texts }) => { embedCalls.push({ file, ...(account ? { account } : {}), texts }); return texts.map(opts.model ?? vectorOf); },
    };
  }
  const s = host.get('Support')!;
  // Existing-file compatibility: absent policy keeps the original redaction behavior.
  s.sql.exec("DELETE FROM _fm_meta WHERE key = 'aiPolicy'");
  s.applyDesign([{ op: 'createTable', name: 'Tickets', fields: [{ name: 'Body' }, { name: 'Vec', type: 'container' }, { name: 'VecText' }, { name: 'Secret' }, { name: 'Region' }, { name: 'Qty', type: 'number' }] }]);
  const tickets: [string, string][] = [
    ['The parcel was late again, a slow delay', 'West'], ['It arrived broken, a crack in the lid', 'West'],
    ['Thanks, great service, love it', 'East'], ['Late and also damaged', 'East'],
  ];
  for (const [body, region] of tickets) {
    const { recordId } = s.create('Tickets', { Body: body, Region: region, Secret: 'x', VecText: JSON.stringify(vectorOf(body)) });
    s.setContainer('Tickets', recordId, 'Vec', 1, { filename: 'embedding.fve', mime: 'application/octet-stream', data: (embeddingFile(vectorOf(body)) as { data: Uint8Array }).data });
  }
  s.create('Tickets', { Body: 'No vector here', Region: 'West' });
  // An account that may use AI but see only the West region and never the Secret field.
  s.savePrivilegeSet({
    name: 'Agent', records: { view: false, edit: false, create: false, delete: false },
    tables: { Tickets: { view: 'Region = "West"', edit: false, create: false, delete: false, fields: { Secret: 'none', VecText: 'none' } } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp'],
  });
  s.setPassword('Agent', 'pw', 'Agent');
  const server = createMcpServer(host, opts.who ?? { admin: true });
  const client = new Client({ name: 'semantic-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await server.close();
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  return { client, host, embedCalls };
}

async function find(client: Client, args: Record<string, unknown>) {
  const r = await client.callTool({ name: 'semantic_find', arguments: { database: 'Support', layout: 'Tickets', field: 'Vec', text: 'delivery was late', ...args } });
  const text = (r.content as { text: string }[])[0]!.text;
  return { isError: !!r.isError, text, data: r.isError ? undefined : (r.structuredContent as Record<string, any>) };
}

test('without an embedding model the tool is not offered', async (t) => {
  const { client } = await setup(t, { embed: false });
  assert.ok(!(await client.listTools()).tools.some((x) => x.name === 'semantic_find'));
});

test('matches come best first, from a container field or from text holding a vector', async (t) => {
  const { client, embedCalls } = await setup(t);
  assert.ok((await client.listTools()).tools.some((x) => x.name === 'semantic_find'));
  for (const field of ['Vec', 'VecText']) {
    const r = await find(client, { field, limit: 2 });
    assert.ok(r.data, r.text);
    // "late" is closest to the two tickets about lateness; the cracked lid and the thanks follow.
    assert.equal(r.data.matches.length, 2);
    assert.ok(r.data.matches[0].similarity >= r.data.matches[1].similarity);
    const bodies = r.data.matches.map((m: { recordId: number }) => m.recordId);
    assert.equal(new Set(bodies).size, 2);
    assert.equal(r.data.scored, 4);
    assert.equal(r.data.noEmbedding, 1, 'the record with no vector is counted, not hidden');
    assert.equal(r.data.layout, 'Tickets');
  }
  assert.deepEqual(embedCalls.map((c) => c.texts), [['delivery was late'], ['delivery was late']]);
  assert.equal(embedCalls[0].file, 'Support');
  assert.equal(embedCalls[0].account, '(administrator)');
  const top = await find(client, { limit: 1 });
  const record = await client.callTool({ name: 'get_record', arguments: { database: 'Support', layout: 'Tickets', recordId: top.data!.matches[0].recordId } });
  assert.match((record.content as { text: string }[])[0]!.text, /late/i);
});

test('a threshold leaves out weaker matches', async (t) => {
  const { client } = await setup(t);
  const all = await find(client, { limit: 100 });
  const strong = await find(client, { limit: 100, threshold: 0.9 });
  assert.ok(strong.data!.matches.length < all.data!.matches.length);
  assert.ok(strong.data!.matches.every((m: { similarity: number }) => m.similarity >= 0.9));
});

test('vectors of another length are refused with the way out, not answered as "no matches"', async (t) => {
  const { client } = await setup(t, { model: () => [1, 0, 0, 0, 0] });
  const r = await find(client, {});
  assert.equal(r.isError, true);
  assert.match(r.text, /different length.*5 numbers.*Embed them again/);
});

test('an unknown field, a field of another type and an empty question are refused plainly', async (t) => {
  const { client } = await setup(t);
  assert.match(JSON.parse((await find(client, { field: 'Nope' })).text).message, /Field "Nope" is missing\. Fields of layout Tickets: .*Body/);
  assert.match((await find(client, { field: 'Qty' })).text, /number field.*container field/);
  assert.match((await find(client, { text: '  ' })).text, /empty/);
});

test('an account sees only the records and fields it may: the East records are never compared, a hidden vector field is refused', async (t) => {
  const { client } = await setup(t, { who: { account: 'Agent', database: 'Support' } });
  const r = await find(client, { limit: 100 });
  assert.ok(r.data, r.text);
  // Three West records exist; two hold vectors, one holds none.
  assert.equal(r.data.scored, 2);
  assert.equal(r.data.noEmbedding, 1);
  const hidden = await find(client, { field: 'VecText' });
  assert.equal(hidden.isError, true);
  // As if it did not exist: the same answer as a field that isn't there, and no hidden field in the list.
  const message = JSON.parse(hidden.text).message as string;
  assert.match(message, /Field "VecText" is missing/);
  assert.equal(/Secret|VecText,|, VecText/.test(message.replace('Field "VecText" is missing', '')), false, hidden.text);
  const nope = await find(client, { field: 'nope' });
  assert.equal(nope.text.replace('nope', 'VecText'), hidden.text);
});

test('a layout the account has no access to is answered like find_records does, and nothing is sent to the model', async (t) => {
  const { client, host, embedCalls } = await setup(t, { who: { account: 'Agent', database: 'Support' } });
  const s = host.get('Support')!;
  // Existing-file compatibility: absent policy keeps the original redaction behavior.
  s.sql.exec("DELETE FROM _fm_meta WHERE key = 'aiPolicy'");
  s.applyDesign([{ op: 'createTable', name: 'Payroll', fields: [{ name: 'Salary' }, { name: 'V' }] }]);
  const r = await find(client, { layout: 'Payroll', field: 'V' });
  assert.equal(r.isError, true);
  assert.doesNotMatch(r.text, /Salary/);
  assert.equal(embedCalls.length, 0);
});

test('the AI usage limits that hold scripts hold the tool: a refused account sends nothing to the model', async (t) => {
  const { client, host, embedCalls } = await setup(t);
  const ai = host.scriptAi!;
  host.scriptAi = { ...ai, refusal: (_file, account) => `${account} is over the daily limit` };
  const server = (await import('../src/mcp.ts')).createMcpServer(host, { admin: true });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const limited = new Client({ name: 'limited', version: '1.0.0' });
  await server.connect(b);
  await limited.connect(a);
  const r = await find(limited, {});
  assert.equal(r.isError, true);
  assert.match(r.text, /over the daily limit/);
  assert.equal(embedCalls.length, 0);
  await limited.close();
  await server.close();
  void client;
});

test('a vector that is not a finite number, a file that is too big to be a vector and a very long question do not disturb the rest', async (t) => {
  const { client, host } = await setup(t);
  const s = host.get('Support')!;
  // Existing-file compatibility: absent policy keeps the original redaction behavior.
  s.sql.exec("DELETE FROM _fm_meta WHERE key = 'aiPolicy'");
  const { recordId } = s.create('Tickets', { Body: 'poisoned', Region: 'West', VecText: '[1e400,1,0]' });
  s.setContainer('Tickets', recordId, 'Vec', 1, { filename: 'big.bin', mime: 'application/octet-stream', data: new Uint8Array(200_000) });
  const text = await find(client, { field: 'VecText', limit: 100 });
  assert.ok(text.data, text.text);
  assert.ok(text.data.matches.every((m: { recordId: number }) => m.recordId !== recordId));
  assert.ok(text.data.matches.every((m: { similarity: number }) => Number.isFinite(m.similarity)));
  assert.equal(text.data.noEmbedding, 2);
  const files = await find(client, { limit: 100 });
  assert.ok(files.data, files.text);
  assert.equal(files.data.noEmbedding, 2, 'the 200 KB file is skipped, not read as a vector');
  assert.equal(files.data.scored, 4);
  const long = await client.callTool({ name: 'semantic_find', arguments: { database: 'Support', layout: 'Tickets', field: 'Vec', text: 'x'.repeat(8001) } });
  assert.equal(long.isError, true);
});

test('a file with AI turned off is closed to the tool', async (t) => {
  const { client, host, embedCalls } = await setup(t);
  host.get('Support')!.setAiAllowed(false, { account: 'test' });
  const r = await find(client, {});
  assert.equal(r.isError, true);
  assert.match(r.text, /AI/);
  assert.equal(embedCalls.length, 0, 'the question is never sent to the embedding model');
});

test('personal data isolation refuses the tool', async (t) => {
  const { client, host, embedCalls } = await setup(t);
  host.get('Support')!.setPiiIsolation(true, { account: 'test' });
  const r = await find(client, {});
  assert.equal(r.isError, true);
  assert.match(r.text, /isolation/i);
  assert.equal(embedCalls.length, 0);
});

test('the records it returns are in the read log, as ids only', async (t) => {
  const { client, host } = await setup(t);
  const s = host.get('Support')!;
  // Existing-file compatibility: absent policy keeps the original redaction behavior.
  s.sql.exec("DELETE FROM _fm_meta WHERE key = 'aiPolicy'");
  s.setAuditSettings({ logReads: true });
  const r = await find(client, { limit: 2 });
  assert.ok(r.data, r.text);
  const [entry] = s.auditLog({ kind: 'read' });
  assert.equal(entry.table, 'Tickets');
  assert.equal(JSON.stringify(entry).includes('late'), false, 'never the values read');
  assert.equal(s.auditLog({ kind: 'read' }).length, 1);
});

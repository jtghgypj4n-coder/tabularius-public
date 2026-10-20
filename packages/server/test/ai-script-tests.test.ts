// AI-written test cases for a script: the model (a stand-in for the Messages API here) sees the script with its
// secrets hidden and the file's outline, never a record; each case it proposes runs offline on a copy and comes
// back passed or not, with what the script did instead, so the person keeps the ones they want. Nothing is saved.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { asRuns } from '../src/design.ts';

let dir: string;
let server: Server;
let model: Server;
let base: string;
let store: Store;
const asked: { system: string; content: string }[] = [];

const proposed = [
  { name: 'Closes the item named', why: 'The item would stay open.', given: { parameter: 'b' }, expect: { result: '1', error: 0, fields: { 'Items::Status': 'closed' } } },
  { name: 'No parameter does nothing', why: 'It would close every item.', given: {}, expect: { result: 'nothing to close', error: 0 } },
  { name: 'Unknown name finds nothing', why: 'It would close the wrong item.', given: { parameter: 'zzz' }, expect: { result: '0', error: 0 } },
  { name: 'Broken case', given: { record: 'first' }, expect: {} },
  { name: 'Starts on a layout that is not there', given: { layout: 'Nowhere' }, expect: { result: 'x' } },
];

before(async () => {
  model = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      const system = Array.isArray(body.system) ? body.system.map((b: { text: string }) => b.text).join('\n') : body.system ?? '';
      const last = body.messages.at(-1).content;
      const content = typeof last === 'string' ? last : last.map((b: { text?: string }) => b.text ?? '').join('');
      asked.push({ system, content });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        content: [{ type: 'text', text: JSON.stringify({ cases: proposed }) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 },
      }));
    });
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-tests-'));
  const s = await serve({ dir, port: 0, log: () => {}, ai: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}` } });
  server = s.server;
  base = s.url;
  store = s.host.create('Shop');
  store.setPassword('Admin', 'pw');
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Status' }] },
    { op: 'createScript', name: 'Close item', text: [
      'Set Variable [ $apiPassword ; Value: "hunter2-secret" ]',
      'Set Variable [ $apiToken ; Value: "tok-abc123" ]',
      'Set Variable [ $login ; Value: Let ( [',
      '\tpw = "multiline-pw-777" ;',
      '\tuser = "ann"',
      '] ; user & ":" & pw ) ]',
      'If [ IsEmpty ( Get ( ScriptParameter ) ) ]',
      '\tExit Script [ Text Result: "nothing to close" ]',
      'End If',
      'Set Error Capture [ On ]',
      'Perform Find [ Restore ; Find: Items::Name: “==b” ]',
      'Set Field [ Items::Status ; "closed" ]',
      'Exit Script [ Text Result: Get ( FoundCount ) ]',
    ].join('\n') },
    { op: 'createScript', name: 'Clear items', text: 'Truncate Table [ Table: “Items” ]' },
  ] as never);
  for (const n of ['a', 'b', 'PrivateRowValue']) store.create('Items', { Name: n, Status: 'open' });
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  model?.close();
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const json = (path: string, init: RequestInit = {}) =>
  fetch(base + path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) } })
    .then(async (r) => ({ status: r.status, body: await r.json() }));

test('the AI proposes cases; each runs offline on a copy and says whether the script did what it expected', async () => {
  const login = await json('/fmi/data/vLatest/databases/Shop/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const auth = { authorization: `Bearer ${login.body.response.token}` };
  const id = store.schema.scripts.find((x) => x.name === 'Close item')!.id;
  const r = await json('/tabularius/design/v1/databases/Shop/script-tests/suggest', { method: 'POST', headers: auth, body: JSON.stringify({ script: id }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const cases = r.body.cases as { name: string; passed: boolean; failures: { what: string; expected: string; actual: string }[]; asRuns: Record<string, unknown>; changes?: { update: number } }[];
  assert.deepEqual(cases.map((c) => [c.name, c.passed]), [['Closes the item named', true], ['No parameter does nothing', true], ['Unknown name finds nothing', false], ['Starts on a layout that is not there', false]]);
  // A case that couldn't run has nothing to keep "as it runs now" (it would save the AI's guess as the run's).
  assert.equal(cases[3].asRuns, undefined);
  // The script ignores its parameter when it finds: the case shows what it did instead, ready to keep as it runs now.
  assert.deepEqual(cases[2].failures, [{ what: 'result', expected: '0', actual: '1' }]);
  assert.equal(cases[2].asRuns.result, '1');
  assert.equal(cases[0].changes?.update, 1);
  assert.equal(r.body.skipped.length, 1);
  assert.match(r.body.skipped[0], /Broken case/);
  // What the model saw: the script with its secret hidden and the file's outline; no record values.
  const sent = asked.at(-1)!.content;
  assert.match(sent, /Close item/);
  assert.match(sent, /Items::Status/);
  assert.doesNotMatch(sent, /hunter2-secret|tok-abc123|multiline-pw-777/);
  assert.doesNotMatch(sent, /PrivateRowValue/);
  // Nothing was saved, and the hosted records are as they were.
  assert.equal(store.scriptTests(id).length, 0);
  assert.deepEqual(store.find('Items', { limit: 10 }).records.map((x) => x.fieldData.Status), ['open', 'open', 'open']);

  // A script that empties a table says so, rather than "changes no records".
  const clear = store.schema.scripts.find((x) => x.name === 'Clear items')!.id;
  const cleared = await json('/tabularius/design/v1/databases/Shop/script-tests/suggest', { method: 'POST', headers: auth, body: JSON.stringify({ script: clear }) });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.deepEqual(cleared.body.cases[0].changes.emptied, ['Items (3)']);

  // A file kept from AI is never sent.
  store.setAiAllowed(false);
  const before = asked.length;
  const off = await json('/tabularius/design/v1/databases/Shop/script-tests/suggest', { method: 'POST', headers: auth, body: JSON.stringify({ script: id }) });
  assert.equal(off.status, 400);
  assert.equal(asked.length, before);
  store.setAiAllowed(true);
});

test('keeping a case as it runs now takes what the run did for each expectation it missed', () => {
  assert.deepEqual(asRuns({ result: '0', error: 0, foundCount: 2, variables: { $$n: '1' }, fields: { 'T::F': 'x' } }, [
    { what: 'result', actual: '1' }, { what: 'found count', actual: '3' }, { what: '$$n', actual: '2' }, { what: 'T::F', actual: 'y' },
  ]), { result: '1', error: 0, foundCount: 3, variables: { $$n: '2' }, fields: { 'T::F': 'y' } });
  // A field expectation named like one of the run's own checks can't be told apart from it: nothing to keep as it runs.
  assert.equal(asRuns({ result: '0', fields: { result: 'x' } }, [{ what: 'result', actual: '1' }]), undefined);
});

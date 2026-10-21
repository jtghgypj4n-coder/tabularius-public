// "Explain this file": a handover memo written from the design alone. The model gets the solution's outline, what
// won't work here, risky spots and unused objects, never a record or a record count; only [Full Access] may ask.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { handoverFacts, scriptDocFacts, unusedObjects } from '../src/handover.ts';
import { redactSecrets } from '../src/ai-output.ts';
import { docsHtml } from '../src/docs.ts';
import type { Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let model: Server;
let base: string;
let store: Store;
const requests: { system: unknown; messages: { content: unknown }[] }[] = [];
let failDocs = false;
let reply = '## What it does\nTracks members of Congress.';

before(async () => {
  if (skip) return;
  model = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      requests.push(JSON.parse(raw));
      if (failDocs && JSON.stringify(JSON.parse(raw).system).includes('document the scripts')) return void res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'boom' } }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 } }));
    });
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'tabularius-handover-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {}, ai: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}` } });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.applyDesign([
    { op: 'createValueList', name: 'Never Used', values: ['a', 'b'] },
    { op: 'createTable', name: 'Secrets', fields: [{ name: 'Api Key', type: 'text' }, { name: 'Note', type: 'text' }] },
  ] as never);
  store.create('Secrets', { 'Api Key': 'sk' + '-ant-api03-zzzzzzzzzzzzzzzzzzzzzzzz', Note: 'a private note about Smithers' });
  const set = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...set, extendedPrivileges: [...set.extendedPrivileges, 'fmrest', 'fmmcp'] });
  store.setPassword('Admin', 'pw');
  store.savePrivilegeSet({ name: 'Viewer', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest', 'fmmcp'] });
  store.setPassword('Viewer', 'pw', 'Viewer');
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  model?.close();
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function login(account: string): Promise<string> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa(`${account}:pw`) }, body: '{}',
  });
  return (await r.json()).response.token;
}
const memo = (token: string, format: string, body: unknown = {}) => fetch(`${base}/tabularius/assistant/v1/databases/Charts/handover?format=${format}`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
});

test('handover facts: the design only, with what looks unused', { skip }, () => {
  const facts = handoverFacts(store);
  assert.match(facts, /## Tables/);
  assert.match(facts, /\*\*Congress\*\*: \d+ data/);
  assert.doesNotMatch(facts, /\d+ records;/);
  assert.doesNotMatch(facts, /Smithers/);
  assert.match(facts, /## Migration readiness \(severity; uses\)/);
  assert.ok(unusedObjects(store).valueLists.includes('Never Used'));
  assert.match(facts, /Value lists no field or layout uses: .*Never Used/);
});

test('handover memo: written from the design with no tools, secrets hidden, saved as Markdown or a page; [Full Access] only', { skip }, async () => {
  const admin = await login('Admin');
  const r = await memo(admin, 'md');
  assert.equal(r.status, 200, await r.clone().text());
  assert.match(r.headers.get('content-disposition')!, /Charts_handover\.md/);
  const text = await r.text();
  assert.match(text, /^# Charts: handover\n\n## What it does\nTracks members of Congress\./);
  const sent = JSON.stringify(requests.at(-1));
  assert.equal((requests.at(-1) as { tools?: unknown[] }).tools?.length ?? 0, 0);
  assert.doesNotMatch(sent, /zzzzzzzz|Smithers/);
  assert.match(JSON.stringify(requests.at(-1)!.system), /handover memo/);
  // A memo the model writes with a secret in it is hidden before it is shown.
  reply = 'The key is sk' + '-ant-api03-abcdefghijklmnopqrstuvwxyz.';
  assert.doesNotMatch(await (await memo(admin, 'md')).text(), /abcdefghijklmnop/);
  // The memo given back comes as a page, without asking the model again.
  const asked = requests.length;
  const page = await memo(admin, 'html', { memo: text });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type')!, /text\/html/);
  assert.match(await page.text(), /Tracks members of Congress/);
  assert.equal(requests.length, asked);
  // An account without [Full Access] can't.
  assert.equal((await memo(await login('Viewer'), 'md')).status, 403);
  // Nor with AI off for the file.
  store.setAiAllowed(false, { account: 'test' });
  assert.equal((await memo(admin, 'md')).status, 403);
  store.setAiAllowed(true, { account: 'test' });
});

test('handover facts: container file names from records stay out; a function called by another, and a value list named in a formula, are used', { skip }, () => {
  store.applyDesign([
    { op: 'createCustomFunction', name: 'Tax', parameters: ['x'], formula: 'x * .1' },
    { op: 'createCustomFunction', name: 'SalesTax', parameters: ['x'], formula: 'Tax ( x )' },
    { op: 'createValueList', name: 'Colors', values: ['Red'] },
    { op: 'createScript', name: 'Pick a colour', text: 'Set Variable [ $c ; Value: ValueListItems ( Get ( FileName ) ; "Colors" ) ]' },
  ] as never);
  const unused = unusedObjects(store);
  assert.ok(!unused.functions.includes('Tax'), JSON.stringify(unused.functions));
  assert.ok(unused.functions.includes('SalesTax'));
  assert.ok(!unused.valueLists.includes('Colors'));
  const original = store.externalContainerCheck.bind(store);
  store.externalContainerCheck = () => ({ files: 2, missing: 1, examples: ['Contracts/JaneDoe_passport.pdf'] });
  try {
    assert.doesNotMatch(handoverFacts(store), /JaneDoe|Container files/);
  } finally {
    store.externalContainerCheck = original;
  }
});

test('API keys with a known prefix are hidden wherever they appear; names that only look like them are not', () => {
  // Built from parts at runtime so the source never holds a provider-shaped literal that secret scanners flag.
  for (const key of ['sk' + '-ant-' + 'api03-abcdefghijklmnopqrstuvwxyz0123', 'sk_' + 'live_51Habcdefghijklmnopqrstuvwxyz0123', 'github_' + 'pat_11ABCDEFG0123456789abcdefghijklmnop',
    'AIza' + 'SyA1234567890abcdefghijklmnopqrstu', 'xo' + 'xe-1-abcdefghijklmnopqrstuvwxyz0123456']) assert.doesNotMatch(redactSecrets(`key ${key} here`), /abcdefghij|1234567890/, key);
  for (const text of ['task-sk-abcdefghijklmnopqrstuvwxyz', 'Go to Layout [ "sk-customer-detail-layout-v2" ]']) assert.equal(redactSecrets(text), text);
});

test('a memo page links only within itself or this server', () => {
  const page = docsHtml('[here](//evil.example/a) and [there](/tabularius/app/)', 'x');
  assert.doesNotMatch(page, /href="\/\/evil/);
  assert.match(page, /href="\/tabularius\/app\/"/);
});

test('handover memo with every script written up: the steps go with secrets hidden, a call per group, under its own heading', { skip }, async () => {
  store.applyDesign([{ op: 'createScript', name: 'Call the API', text: 'Set Variable [ $apiKey ; Value: "sk' + '-ant-api03-yyyyyyyyyyyyyyyyyyyyyyyy" ]\nInsert from URL [ $r ; "https://example.com/x?token=abc123secret" ]' }] as never);
  reply = '### Call the API\nCalls a web service.';
  const before = requests.length;
  const r = await memo(await login('Admin'), 'md', { scripts: true });
  assert.equal(r.status, 200, await r.clone().text());
  const text = await r.text();
  assert.match(text, /\n## Scripts\n\n### Call the API\nCalls a web service\./);
  const sent = requests.slice(before);
  assert.ok(sent.length >= 2);
  const docs = JSON.stringify(sent.slice(1));
  assert.match(docs, /### Call the API/);
  assert.match(docs, /Started by: /);
  assert.doesNotMatch(docs, /yyyyyyyy|abc123secret|Smithers/);
  assert.equal((sent[1] as { tools?: unknown[] }).tools?.length ?? 0, 0);
  // A write-up call that fails is noted; the memo itself is kept.
  failDocs = true;
  const kept = await memo(await login('Admin'), 'md', { scripts: true });
  failDocs = false;
  assert.equal(kept.status, 200);
  assert.match(await kept.text(), /^# Charts: handover[\s\S]*## Scripts\n\n_\d+ scripts? not written up: /);
  // Without asking, the memo has no Scripts section.
  assert.doesNotMatch(await (await memo(await login('Admin'), 'md')).text(), /## Scripts/);
});

test('script doc facts group the scripts and cut a long one short', { skip }, () => {
  const groups = scriptDocFacts(store, 2000);
  assert.ok(groups.length > 1);
  assert.equal(groups.join('\n').match(/^### /gm)?.length, store.schema.scripts.filter((s) => s.name).length);
});

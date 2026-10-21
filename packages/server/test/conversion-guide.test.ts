// The conversion guide: a plain-English account of a converted file (what won't work, what works differently, what
// to use instead), kept with the file, with the assistant's overview on top (a stand-in for the Messages API here),
// and never a secret from the file's scripts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { ConversionGuides, SEVERITIES, conversionGuide, convertedAt, urlTargets } from '../src/conversion-guide.ts';
import { conversionReport } from '../src/conversion.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let model: Server;
let base: string;
let store: Store;
const sent: { system: string; content: string }[] = [];
const SECRET = 'Pa55-word-never-shown';

test('AR-server-containers-media-11: structured and saved guide strings redact the same secret as Markdown', () => {
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-guide-redaction-'));
  const path = join(folder, 'Guide.openhbam.sqlite');
  createStore(path);
  const local = new Store(path, 'Guide');
  const key = 'sk-test_1234567890abcdef1234567890abcdef';
  try {
    const report = conversionReport(local, []);
    report.unparsed.push({ where: 'Script "Example"', error: 'unparsed', text: `Bad ( "${key}" )` });
    const guide = conversionGuide(local, [], report);
    assert.ok(!JSON.stringify(guide).includes(key));
    const guides = new ConversionGuides(() => []);
    const legacy = structuredClone(guide);
    legacy.breaks[0]!.where.push(key);
    legacy.breaks[0]!.title = 'Password issue';
    legacy.breaks[0]!.what = 'Contains "woodchuck"';
    local.sql.exec('CREATE TABLE _fm_conversion_guide (id INTEGER PRIMARY KEY, converted TEXT, spec TEXT NOT NULL)');
    local.sql.prepare('INSERT INTO _fm_conversion_guide VALUES (1, NULL, ?)').run(JSON.stringify(legacy));
    assert.ok(!JSON.stringify(guides.saved(local)).includes(key));
    assert.ok(!JSON.stringify(guides.saved(local)).includes('woodchuck'));
    const persisted = local.sql.prepare('SELECT spec FROM _fm_conversion_guide WHERE id = 1').get() as { spec: string };
    assert.ok(!persisted.spec.includes(key));
    assert.ok(!persisted.spec.includes('woodchuck'));
  } finally {
    local.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

const SEND = [
  `Set Variable [ $password ; Value: "${SECRET}" ]`,
  'Set Variable [ $m ; Value: EmailCreate ( "office@example.com" ; "client@example.com" ; "Your invoice" ) ]',
  'Set Variable [ $sent ; Value: EmailSend ( "" ) ]',
  'Send Mail [ Send via SMTP Server ; With dialog: Off ; To: "client@example.com" ; Subject: "Invoice" ]',
  'Insert from URL [ $reply ; "https://example.com/api" ]',
].join('\n');

before(async () => {
  if (skip) return;
  model = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      const system = Array.isArray(body.system) ? body.system.map((b: { text: string }) => b.text).join('\n') : body.system;
      const last = body.messages.at(-1).content;
      sent.push({ system, content: typeof last === 'string' ? last : last.map((b: { text?: string }) => b.text ?? '').join('') });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        content: [{ type: 'text', text: 'The 360Works Email plug-in stops "Send invoice" sending; use Send Mail instead.' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 },
      }));
    });
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'tabularius-conversion-guide-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ mcpToken: 'test-admin-token', dir, port: 0, log: () => {}, ai: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}` } });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.applyDesign([{ op: 'createScript', name: 'Send invoice', text: SEND }]);
});
after(async () => {
  // Closed (background warming stopped, files closed) before the folder is removed.
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  model?.close();
  if (dir) rmSync(dir, { recursive: true });
});

test('what won\'t work, what works differently, and what to use instead, with no secrets', { skip }, () => {
  const g = conversionGuide(store, ['Charts']);
  const plugIn = g.breaks.find((i) => i.title === '360Works Email plug-in')!;
  assert.ok(plugIn, JSON.stringify(g.breaks.map((i) => i.title)));
  assert.match(plugIn.what, /2 calls in 1 script/);
  assert.match(plugIn.instead!, /Send Mail \[ Send via SMTP Server/);
  assert.deepEqual(plugIn.where.map((w) => w.replace(/, line \d+/, '')), ['Script "Send invoice"', 'Script "Send invoice"'].slice(0, plugIn.where.length));
  assert.match(g.differs.find((i) => i.title === 'Send Mail')!.what, /sends only when the server's administrator switches sending on/);
  assert.match(g.differs.find((i) => i.title === 'Insert from URL')!.what, /Script network/);
  assert.ok(g.todo.some((t) => /plug-ins one script at a time/.test(t)));
  assert.match(g.text, /^# Charts: what to know after converting/);
  assert.match(g.text, /## Won't work until changed\n- \*\*360Works Email plug-in\*\*/);
  assert.match(g.text, /\n  Instead: Send Mail/);
  assert.ok(!g.text.includes(SECRET));
  assert.equal(g.convertedAt, convertedAt(store));
});

test('formulas that don\'t parse are named with the reason and how the formula starts, once each', { skip }, () => {
  const item = conversionGuide(store, ['Charts']).breaks.find((i) => i.title === 'Formulas that don\'t parse')!;
  assert.ok(item, 'Charts has formulas that do not parse');
  assert.ok(item.where.length > 0);
  for (const w of item.where) assert.match(w, /^.+: .+ \(.+\)$/, w);
  assert.equal(new Set(item.where).size, item.where.length);
});

test('web viewers that load internet pages are named, with the data: URL way instead', { skip }, () => {
  const designs = store.designs.bind(store);
  store.designs = () => ({ themes: [], layouts: [
    { id: 1, name: 'Map', style: {}, parts: [], objects: [{ kind: 'web-viewer', webUrl: '"https://maps.example.com/?q=" & Customers::City' }] },
    { id: 2, name: 'Receipt', style: {}, parts: [], objects: [{ kind: 'group', children: [{ kind: 'web-viewer', webUrl: '"data:text/html," & $$html' }] }] },
  ] } as unknown as ReturnType<Store['designs']>);
  try {
    const viewers = conversionGuide(store, ['Charts']).differs.find((i) => i.title === 'Web viewers')!;
    assert.equal(viewers.count, 2);
    assert.match(viewers.what, /^1 web viewer loads a page from the internet.*1 other show a page made in the file/);
    assert.deepEqual(viewers.where, ['Layout "Map"']);
    assert.match(viewers.instead!, /data:text\/html/);
  } finally {
    store.designs = designs;
  }
});

test('kept with the file for its conversion, with the assistant\'s overview, and given to MCP clients', { skip }, async () => {
  const res = await (await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: 'Bearer test-admin-token' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'conversion_guide', arguments: { database: 'Charts' } } }),
  })).json();
  const text = res.result.content[0].text as string;
  assert.match(text, /^# Charts: what to know after converting\n\nThe 360Works Email plug-in stops "Send invoice" sending/);
  const asked = sent.at(-1)!;
  assert.match(asked.system, /overview at the top of a conversion guide/);
  assert.ok(asked.content.includes('360Works Email plug-in') && !asked.content.includes(SECRET), 'the model sees the guide, never the secret');

  // Made once per conversion: asked again, the saved guide comes back without asking the model.
  const guides = new ConversionGuides(() => ['Charts']);
  const before = sent.length;
  const saved = await guides.get(store);
  assert.equal(sent.length, before);
  assert.equal(saved.convertedAt, convertedAt(store));
  assert.match(saved.overview!, /use Send Mail instead/);
});

test('a file starting to be hosted gets its guide in the background, once', { skip }, async () => {
  store.sql.exec('DELETE FROM _fm_conversion_guide');
  const logged: string[] = [];
  const guides = new ConversionGuides(() => ['Charts'], (m) => logged.push(m));
  guides.delayMs = 0;
  guides.hosting(store);
  guides.hosting(store);
  for (let i = 0; i < 100 && !guides.saved(store); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(guides.saved(store)?.convertedAt, convertedAt(store));
  assert.equal(logged.length, 1);
  assert.match(logged[0], /^conversion guide for Charts: \d+ things? won't work until changed/);
  guides.hosting(store);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(logged.length, 1, 'not again for the same conversion');
  guides.stop();
});

test('the overview is asked for once per conversion: not again on a restart, nor twice at once', { skip }, async () => {
  let calls = 0;
  const overview = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return 'An overview.';
  };
  store.sql.exec('DELETE FROM _fm_conversion_guide');
  const guides = new ConversionGuides(() => ['Charts']);
  guides.overview = overview;
  const [a, b] = await Promise.all([guides.make(store), guides.get(store)]);
  assert.equal(calls, 1);
  assert.equal(a.overview, 'An overview.');
  assert.equal(b.overview, 'An overview.');
  // A server starting again (a new process) finds the guide kept in the file and asks nothing.
  const again = new ConversionGuides(() => ['Charts']);
  again.overview = overview;
  again.delayMs = 0;
  again.hosting(store);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await again.get(store)).overview, 'An overview.');
  assert.equal(calls, 1);
  again.stop();
});

test('every item has a severity, worst first, and Insert from URL names the sites it calls', { skip }, () => {
  const g = conversionGuide(store, ['Charts']);
  for (const list of [g.breaks, g.differs]) {
    assert.ok(list.every((i) => SEVERITIES.includes(i.severity)), JSON.stringify(list.map((i) => [i.title, i.severity])));
    const ranks = list.map((i) => SEVERITIES.indexOf(i.severity));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  }
  assert.deepEqual(urlTargets(store), { hosts: ['https://example.com'], computed: false });
  assert.doesNotMatch(g.differs.find((i) => i.title === 'Insert from URL')!.what, /worked out when the script runs/);
  assert.match(g.differs.find((i) => i.title === 'Insert from URL')!.what, /https:\/\/example\.com/);
  assert.match(g.text, /\*\*360Works Email plug-in\*\* \((high|low); /);
});

test('container file paths come from the records, so the overview the model sees leaves them out', { skip }, async () => {
  const check = store.externalContainerCheck.bind(store);
  const PATH = 'Invoices/Invoice_Doc/acme-secret-client.pdf';
  store.externalContainerCheck = () => ({ files: 3, missing: 1, examples: [PATH] });
  try {
    const g = conversionGuide(store, ['Charts']);
    const item = g.breaks.find((i) => i.title === 'Container files stored outside the file')!;
    assert.ok(item?.fromRecords);
    assert.ok(g.text.includes(PATH), 'the admin\'s own guide still lists it');
    const guides = new ConversionGuides(() => ['Charts']);
    let asked = '';
    guides.overview = async (_s, text) => ((asked = text), 'An overview.');
    await guides.make(store);
    assert.ok(asked.includes('360Works Email plug-in'));
    assert.ok(!asked.includes(PATH) && !asked.includes('Container files stored outside'), asked);
  } finally {
    store.externalContainerCheck = check;
    store.sql.exec('DELETE FROM _fm_conversion_guide');
  }
});

test('Insert from URL targets: never a user name, one host per step, disabled steps and cURL options left out', { skip }, () => {
  store.applyDesign([{ op: 'createScript', name: 'Calls', text: [
    'Insert from URL [ $a ; "https://bob:pa/ss@api.example.org/v1" ]',
    'Insert from URL [ $b ; "https://carol:pass word@files.example.net:8443/x" ]',
    'Insert from URL [ $c ; "https://example.com/again" ; cURL options: "--proxy http://proxy.corp" ]',
    'Insert from URL [ $f ; "https://social.example.com/users/@me" ]',
    '// Insert from URL [ $d ; "https://old.example.io" ]',
    '// Perform Script on Server [ "Send invoice" ]',
  ].join('\n') }]);
  try {
    const t = urlTargets(store);
    assert.deepEqual(t.hosts, ['https://api.example.org', 'https://example.com', 'https://files.example.net', 'https://social.example.com']);
    assert.equal(t.computed, false);
    assert.ok(!JSON.stringify(t).includes('bob') && !JSON.stringify(t).includes('carol'));
    assert.ok(!conversionGuide(store, ['Charts']).differs.some((i) => i.title === 'Perform Script on Server'));
    store.applyDesign([{ op: 'createScript', name: 'Computed', text: 'Insert from URL [ $e ; $$baseUrl & "/x" ]' }]);
    assert.equal(urlTargets(store).computed, true);
    store.applyDesign([{ op: 'deleteScript', script: 'Computed' }]);
  } finally {
    store.applyDesign([{ op: 'deleteScript', script: 'Calls' }]);
  }
});

test('MCP clients get the guide without container file names from the records', { skip }, async () => {
  const check = store.externalContainerCheck.bind(store);
  const PATH = 'Invoices/Invoice_Doc/acme-secret-client.pdf';
  store.externalContainerCheck = () => ({ files: 3, missing: 1, examples: [PATH] });
  store.sql.exec('DELETE FROM _fm_conversion_guide');
  try {
    const res = await (await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: 'Bearer test-admin-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'conversion_guide', arguments: { database: 'Charts' } } }),
    })).json();
    const text = res.result.content[0].text as string;
    assert.match(text, /360Works Email plug-in/);
    assert.ok(!text.includes(PATH) && !text.includes('Container files stored outside'), text);
  } finally {
    store.externalContainerCheck = check;
    store.sql.exec('DELETE FROM _fm_conversion_guide');
  }
});

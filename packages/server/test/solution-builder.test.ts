// A new solution from a description: planned by the assistant against a scratch file (an error goes back to it to
// fix), shown in the admin console with nothing created, then created all at once, or not at all.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { solutionName } from '../src/solution-builder.ts';
import { loadHostedRecord } from '../src/hosted-record.ts';
import type { Host } from '../src/host.ts';

let dir: string;
let server: Server;
let model: Server;
let base: string;
let host: Host;
const requests: { system: unknown; messages: { role: string; content: unknown }[] }[] = [];
let script: (string | { cut: string })[] = [];
const answer = (t: string | { cut: string }) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : t.cut }], stop_reason: typeof t === 'string' ? 'end_turn' : 'max_tokens', usage: { input_tokens: 1000, output_tokens: 500 } });

before(async () => {
  model = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      requests.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer(script.shift() ?? '(no more answers)')));
    });
  });
  await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
  dir = mkdtempSync(join(tmpdir(), 'tabularius-solution-'));
  const s = await serve({ dir, port: 0, log: () => {}, ai: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}` } });
  server = s.server;
  base = s.url;
  host = s.host;
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  model?.close();
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const admin = async (path: string, body: unknown) => {
  const r = await fetch(`${base}/tabularius/admin/v1/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

const id = (name: string) => ({ name, type: 'number', options: { autoEnter: { serial: { next: '1', increment: 1 }, prohibitModification: true } } });
const crm = [
  { op: 'createTable', name: 'Companies', fields: [id('CompanyID'), { name: 'Name', type: 'text' }] },
  { op: 'createTable', name: 'Deals', fields: [id('DealID'), { name: 'CompanyID', type: 'number' }, { name: 'Stage', type: 'text' }, { name: 'Amount', type: 'number' }] },
  { op: 'createRelationship', left: 'Companies', right: 'Deals', predicates: [{ left: 'CompanyID', right: 'CompanyID' }], rightCreate: true, leftCreate: false },
  { op: 'createValueList', name: 'Stages', values: ['Lead', 'Proposal', 'Won', 'Lost'] },
  { op: 'createLayout', name: 'Pipeline', occurrence: 'Deals', design: { view: 'list' } },
  { op: 'createScript', name: 'Show Pipeline', text: 'Go to Layout [ "Pipeline" ]\nShow All Records' },
];

test('a solution is planned on a scratch file, mistakes sent back to fix, and nothing is created until Create', async () => {
  script = [
    JSON.stringify({ summary: 'A CRM', changes: [{ op: 'deleteTable', table: 'Nope' }] }),
    `Here it is: ${JSON.stringify({ summary: 'A small CRM with companies and a deals pipeline.', changes: crm })}`,
  ];
  const plan = await admin('solutions/plan', { name: 'Sales CRM', description: 'A small CRM with companies, deals and a pipeline view' });
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  assert.equal(plan.body.summary, 'A small CRM with companies and a deals pipeline.');
  assert.ok(plan.body.preview.some((l: string) => /New table Companies/.test(l)), plan.body.preview.join('\n'));
  assert.deepEqual(plan.body.dryRuns.map((d: { script: string }) => d.script), ['Show Pipeline']);
  assert.equal(plan.body.dryRuns[0].run.outcome, 'ok', JSON.stringify(plan.body.dryRuns));
  // The first try didn't apply, so the model was told why and asked again.
  assert.equal(requests.length, 2);
  assert.match(JSON.stringify(requests[0].system), /starter scripts/);
  assert.match(JSON.stringify(requests[1].messages.at(-1)), /would not apply/);
  // Nothing hosted or on disk yet, and the scratch file is gone.
  assert.equal(host.get('Sales CRM'), undefined);
  assert.deepEqual(readdirSync(dir).filter((f) => /Sales CRM/.test(f)), []);

  const made = await admin('solutions', { name: 'Sales CRM', changes: plan.body.changes, password: 'pw' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const store = host.get('Sales CRM')!;
  assert.equal(loadHostedRecord(dir)?.files['sales crm'].by, 'admin console');
  assert.deepEqual(store.schema.tables.map((t) => t.name).sort(), ['Companies', 'Deals']);
  assert.ok(store.schema.scripts.some((x) => x.name === 'Show Pipeline'));
  const login = await fetch(`${base}/fmi/data/vLatest/databases/Sales%20CRM/sessions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Admin:pw') }, body: '{}' });
  assert.equal(login.status, 200);
  // The name is taken now.
  assert.equal((await admin('solutions', { name: 'Sales CRM', changes: crm })).status, 400);
});

test('a plan that fails part way creates no file; a plan is refused for a taken or bad name before the model is asked', async () => {
  const bad = await admin('solutions', { name: 'Broken', changes: [...crm, { op: 'deleteTable', table: 'Nope' }] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /no file was made/);
  assert.equal(host.get('Broken'), undefined);
  assert.deepEqual(readdirSync(dir).filter((f) => /Broken/.test(f)), []);
  assert.equal(existsSync(join(dir, 'Broken.openhbam.sqlite')), false);
  const asked = requests.length;
  assert.equal((await admin('solutions/plan', { name: 'Sales CRM', description: 'again' })).status, 400);
  assert.equal((await admin('solutions/plan', { name: '../x', description: 'a CRM' })).status, 400);
  assert.equal((await admin('solutions/plan', { name: 'Fine', description: ' ' })).status, 400);
  assert.equal(requests.length, asked);
});

test('a plan cut off at the length limit is asked for again, smaller', async () => {
  script = [{ cut: '{"summary": "A CRM", "changes": [{"op": "createTable", "name": "Comp' }, JSON.stringify({ summary: 'A smaller CRM.', changes: crm.slice(0, 2) })];
  requests.length = 0;
  const plan = await admin('solutions/plan', { name: 'Small CRM', description: 'A CRM' });
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  assert.equal(plan.body.summary, 'A smaller CRM.');
  assert.match(JSON.stringify(requests[1].messages.at(-1)), /too long to finish/);
});

test('a name taken by a FileMaker file waiting in the folder is refused', () => {
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-solution-names-'));
  try {
    writeFileSync(join(folder, 'Waiting.fmp12'), '');
    const fake = { dir: folder, get: () => undefined } as unknown as Host;
    assert.throws(() => solutionName(fake, 'waiting'), /already exists/);
    assert.equal(solutionName(fake, 'Other'), 'Other');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

// A large table through the Data API: reading one record, a page, or a find
// must not load the whole table into memory. The server runs in its own
// process with a small heap, as a busy server with a 270,000-record table
// would be, so a request that held every record would crash it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { importFmp12, Store } from '../../store/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const ROWS = 120_000;
// Enough for the server itself, far too little for a table's records as objects
// (before the fix, a one-record read of this table ran out of it).
const HEAP_MB = 96;
let dir: string;
let child: ChildProcess | undefined;
let base: string;
let auth: string;
let layouts: string[] = [];

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-big-'));
  const path = join(dir, 'Charts.openhbam.sqlite');
  importFmp12(fixture, path);
  const setup = new Store(path, 'Charts');
  const full = setup.privilegeSets().find((p) => p.id === 1)!;
  setup.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest'] });
  setup.setPassword('Ann', 'pw', full.name);
  layouts = setup.schema.layouts.map((l) => l.name).filter((l) => setup.layout(l).table === 'Congress');
  setup.close();
  // Copies of the sample's records until the table is large.
  const sql = new DatabaseSync(path);
  const cols = (sql.prepare('PRAGMA table_info(Congress)').all() as { name: string }[]).map((c) => `"${c.name}"`).filter((c) => c !== '"_fm_record_id"');
  sql.exec('BEGIN');
  while ((sql.prepare('SELECT count(*) AS n FROM Congress').get() as { n: number }).n < ROWS) {
    sql.exec(`INSERT INTO Congress (${cols.join(', ')}) SELECT ${cols.join(', ')} FROM Congress LIMIT ${ROWS}`);
  }
  sql.exec('COMMIT');
  sql.close();

  const server = join(import.meta.dirname, '..', 'src', 'index.ts');
  child = spawn(process.execPath, [`--max-old-space-size=${HEAP_MB}`, '--no-warnings', '--input-type=module', '-e',
    `import { serve } from ${JSON.stringify(server)}; const s = await serve({ dir: ${JSON.stringify(dir)}, port: 0, log: () => {} }); console.log(s.url);`],
  { stdio: ['ignore', 'pipe', 'inherit'] });
  base = await new Promise<string>((resolve, reject) => {
    child!.stdout!.on('data', (d: Buffer) => resolve(String(d).trim()));
    child!.on('exit', (code) => reject(new Error(`server exited (${code})`)));
  });
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Ann:pw') } });
  auth = `Bearer ${(await r.json()).response.token}`;
});
after(() => {
  child?.kill();
  // Retried: the server can still be writing into the folder in the background (shared results) as it goes.
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

async function api(path: string, init: RequestInit = {}): Promise<{ status: number; body: { response: { data?: unknown[]; dataInfo?: { foundCount: number; totalRecordCount: number } }; messages: { code: string; message: string }[] } }> {
  const r = await fetch(`${base}/fmi/data/vLatest/databases/Charts${path}`, { ...init, headers: { authorization: auth, 'content-type': 'application/json', ...init.headers } });
  return { status: r.status, body: await r.json() };
}

test('a large table: one record, a page, a sort and a find each read only what they return', { skip, timeout: 120_000 }, async () => {
  assert.ok(layouts.length, 'the sample has Congress layouts');
  for (const layout of layouts) {
    const L = encodeURIComponent(layout);
    // Twice: the second read is served from the summaries kept from the first.
    for (let i = 0; i < 2; i++) {
      const one = await api(`/layouts/${L}/records?_limit=1`);
      assert.equal(one.status, 200, `${layout}: ${JSON.stringify(one.body.messages)}`);
      assert.equal(one.body.response.data!.length, 1);
      assert.ok(one.body.response.dataInfo!.foundCount >= ROWS);
    }
    const deep = await api(`/layouts/${L}/records?_limit=50&_offset=${ROWS - 100}`);
    assert.equal(deep.status, 200, JSON.stringify(deep.body.messages));
    assert.equal(deep.body.response.data!.length, 50);
  }
  const L = encodeURIComponent(layouts[0]);
  const first = (await api(`/layouts/${L}/records?_limit=1`)).body.response.data![0] as { fieldData: Record<string, unknown> };
  const field = Object.keys(first.fieldData).find((f) => !f.includes('::'))!;
  const sorted = await api(`/layouts/${L}/records?_limit=5&_sort=${encodeURIComponent(JSON.stringify([{ fieldName: field, sortOrder: 'descend' }]))}`);
  assert.equal(sorted.status, 200, JSON.stringify(sorted.body.messages));
  const found = await api(`/layouts/${L}/_find`, { method: 'POST', body: JSON.stringify({ query: [{ [field]: '*' }], limit: 3 }) });
  assert.equal(found.status, 200, JSON.stringify(found.body.messages));
  assert.equal(found.body.response.data!.length, 3);
  assert.equal(child!.exitCode, null, 'the server is still running');
});

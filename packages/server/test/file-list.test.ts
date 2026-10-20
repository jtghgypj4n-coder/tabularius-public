// The file lists (the root, the Data API's and OData's) name no file unless the server was started with
// --list-files-publicly (listFilesPublicly), and the AI-app sign-in page asks for the file's name instead of offering a list.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
type Served = Awaited<ReturnType<typeof serve>>;
let dirs: string[] = [];
let closed: Served;
let open: Served;

const start = async (listFilesPublicly: boolean): Promise<Served> => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-file-list-'));
  dirs.push(dir);
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  return serve({ dir, port: 0, watch: false, log: () => {}, ...(listFilesPublicly ? { listFilesPublicly } : {}) });
};

before(async () => {
  if (skip) return;
  closed = await start(false);
  open = await start(true);
});
after(async () => {
  for (const s of [closed, open]) await new Promise<void>((r) => (s ? s.server.close(() => r()) : r()));
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});

const names = (b: { response?: { databases: { name: string }[] } }) => (b.response?.databases ?? []).map((d) => d.name);

test('by default the root, the Data API list and the OData root name no file', { skip }, async () => {
  assert.deepEqual(await (await fetch(`${closed.url}/`)).json(), { name: 'tabularius' });
  const dataApi = await fetch(`${closed.url}/fmi/data/vLatest/databases`);
  assert.equal(dataApi.status, 404);
  assert.doesNotMatch(await dataApi.text(), /Charts/);
  const odata = await fetch(`${closed.url}/fmi/odata/v4`);
  assert.equal(odata.status, 404);
  assert.doesNotMatch(await odata.text(), /Charts/);
  // Credentials don't change that: nothing is checked against every file to build a list.
  const basic = { authorization: 'Basic ' + btoa('Admin:') };
  assert.equal((await fetch(`${closed.url}/fmi/data/vLatest/databases`, { headers: basic })).status, 404);
});

test('listFilesPublicly lists every file to anyone', { skip }, async () => {
  assert.deepEqual(await (await fetch(`${open.url}/`)).json(), { name: 'tabularius', databases: ['Charts'] });
  assert.deepEqual(names(await (await fetch(`${open.url}/fmi/data/vLatest/databases`)).json() as never), ['Charts']);
  const odata = await (await fetch(`${open.url}/fmi/odata/v4`)).json() as { value: { name: string }[] };
  assert.deepEqual(odata.value.map((v) => v.name), ['Charts']);
});

// A registered AI app's sign-in page: the file is typed by default, so a stranger who registers an app learns no name.
const registered = async (base: string) => {
  const reg = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Test app', redirect_uris: ['https://app.example/cb'] }) });
  const { client_id } = await reg.json() as { client_id: string };
  const q = new URLSearchParams({ client_id, response_type: 'code', redirect_uri: 'https://app.example/cb', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' });
  return fetch(`${base}/oauth/authorize?${q}`);
};

test('the AI-app sign-in page asks for the file name unless files are listed publicly', { skip }, async () => {
  const hidden = await registered(closed.url);
  assert.equal(hidden.status, 200);
  const html = await hidden.text();
  assert.match(html, /<input name="database"/);
  assert.doesNotMatch(html, /Charts/);
  const listed = await (await registered(open.url)).text();
  assert.match(listed, /<select name="database"/);
  assert.match(listed, /Charts/);
});

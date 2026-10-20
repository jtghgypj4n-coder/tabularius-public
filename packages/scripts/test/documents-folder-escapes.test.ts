// The documents folder is a sandbox for the file steps: a link inside it can't lead out, a named pipe can't hold the
// server, and Perform RAG Action's Add Data can't be made to embed an enormous amount of text before it is refused.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep, StepParams } from '@tabularius/fmp12';
import { createStore, Store } from '@tabularius/store';
import { runScript, ScriptSession, type RunOptions, type ScriptAi } from '../src/index.ts';

let dir: string;
let docs: string;
let outside: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-docs-escape-'));
  docs = join(dir, 'Documents');
  outside = join(dir, 'outside');
  mkdirSync(docs);
  mkdirSync(outside);
  createStore(join(dir, 'Shop.sqlite'));
  store = new Store(join(dir, 'Shop.sqlite'), 'Shop');
  store.applyDesign([{ op: 'createTable', name: 'Shop', fields: [{ name: 'Name', type: 'text' }] }]);
  writeFileSync(join(docs, 'inside.txt'), 'Office chairs are in aisle 4.');
  writeFileSync(join(outside, 'secret.txt'), 'the outside secret');
  symlinkSync(join(outside, 'secret.txt'), join(docs, 'link.txt'));
  symlinkSync(outside, join(docs, 'folder'));
  symlinkSync(join(docs, 'inside.txt'), join(docs, 'alias.txt'));
  symlinkSync(join(outside, 'not-yet.txt'), join(docs, 'dangling.txt'));
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true, force: true });
});

const raw = (stepId: number, name: string, params: StepParams): ScriptStep => ({ stepId, name, enabled: true, params });
const script = (steps: ScriptStep[]): Script => ({ id: 9999, name: 'test', steps } as Script);
const embedded: string[][] = [];
const ai: ScriptAi = {
  refusal: () => undefined,
  generate: async () => 'x',
  embed: async (r) => { embedded.push(r.texts); return r.texts.map(() => [1, 0]); },
};
const rag = { add: () => 'id', remove: () => 0, search: () => [], count: () => 0 } as unknown as NonNullable<ScriptAi['rag']>;
const run = (steps: ScriptStep[], opts: RunOptions = {}) => runScript(store, script(steps), { layout: 'Shop', trace: true, session: new ScriptSession(), documents: docs, ...opts });
const configure = raw(212, 'Configure AI Account', { ai: { accountName: '"acct"' } });
const ragConfigure = raw(227, 'Configure RAG Account', { ai: { ragAccountName: '"rag"' } });
const add = (path: string, extra: NonNullable<StepParams['ai']> = {}) => run([
  configure, ragConfigure,
  raw(219, 'Perform RAG Action', { filePaths: [path], ai: { ragAccountName: '"rag"', spaceId: '"s"', ragAction: 'add data', dataSource: 'from file', responseVariable: '$r', ...extra } }),
], { ai: { ...ai, rag } });

test('a link inside the documents folder that leads outside it is not read', async () => {
  for (const path of ['link.txt', 'folder/secret.txt', 'dangling.txt']) {
    embedded.length = 0;
    const r = await add(path);
    assert.equal(r.error, 100, `${path}: ${JSON.stringify(r.trace?.find((t) => t.message)?.message)}`);
    assert.equal(embedded.length, 0, `${path}: nothing was sent to the embedding model`);
  }
  // A link to a file inside the folder is just another name for it.
  assert.equal((await add('alias.txt')).error, 0);
});

test('a data file step clearly refuses a file link in Documents', async () => {
  const r = await run([raw(191, 'Open Data File', { filePaths: ['file:/Documents/link.txt'], variable: '$file' })]);
  assert.notEqual(r.error, 0);
  assert.match(String(r.trace?.find((t) => t.message)?.message), /link\.txt is a link/);
});

test('a named pipe in the folder is refused without waiting on it', { skip: process.platform === 'win32' ? 'no named pipes' : false }, async () => {
  const made = spawnSync('mkfifo', [join(docs, 'pipe.txt')]);
  if (made.status !== 0) return;
  const t = Date.now();
  const r = await add('pipe.txt');
  assert.equal(r.error, 100);
  assert.ok(Date.now() - t < 5000, 'it did not wait');
});

test('Add Data refuses too many chunks before anything is sent to an embedding model', async () => {
  embedded.length = 0;
  writeFileSync(join(docs, 'huge.txt'), 'word '.repeat(4_200_000));
  const r = await add('huge.txt', { tokensPerChunk: '75' });
  assert.equal(r.error, 812);
  assert.match(String(r.trace?.find((t) => t.message)?.message), /at most 50000/);
  assert.equal(embedded.length, 0);
});

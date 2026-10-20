// Perform Semantic Find by image: the picture in Text goes to the server's image embedding model, and the records
// closest to its vector are found. Without that model the step stops saying so.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script, ScriptStep, StepParams } from '@tabularius/fmp12';
import { createStore, Store } from '@tabularius/store';
import { runScript, type ScriptAi } from '../src/index.ts';

let dir: string;
let store: Store;
const ids: number[] = [];

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-semantic-image-'));
  createStore(join(dir, 'Pics.sqlite'));
  store = new Store(join(dir, 'Pics.sqlite'));
  store.applyDesign([{ op: 'createTable', name: 'PICS', fields: [{ name: 'embedding', type: 'text' }] }]);
  for (const v of [[0, 1], [1, 0], [0.9, 0.1]]) ids.push(store.create('PICS', { embedding: JSON.stringify(v) }).recordId);
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

const step = (stepId: number, name: string, params?: StepParams): ScriptStep => ({ stepId, name, enabled: true, params });
const script = (...steps: ScriptStep[]): Script => ({ id: 9999, name: 'test', steps } as Script);
const configure = step(212, 'Configure AI Account', { ai: { accountName: '"acct"', apiKey: '"k"', endpoint: '"https://example.invalid"' } });
const find = (input: string) => step(218, 'Perform Semantic Find', {
  field: { tableOccurrence: { id: 0, name: 'PICS' }, field: { id: 0, name: 'embedding' } },
  ai: { queryBy: 'image', accountName: '"acct"', model: '"voyage-multimodal-3"', input, recordSet: 'all records', returnCount: '2' },
});
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64').toString('base64');
const picture = `Base64Decode ( "${PNG}" ; "query.png" )`;

function withImages() {
  const calls: { model: string; mime: string; bytes: number }[] = [];
  const ai: ScriptAi = {
    refusal: () => undefined,
    generate: async () => '',
    embedImage: async (r) => {
      for (const i of r.images) calls.push({ model: r.model, mime: i.mime, bytes: i.data.length });
      return r.images.map(() => [1, 0]);
    },
  };
  return { ai, calls };
}

test('Perform Semantic Find by image finds the records closest to the picture\'s vector', async () => {
  const { ai, calls } = withImages();
  const r = await runScript(store, script(configure, find(picture)), { layout: 'PICS', ai });
  assert.equal(r.error, 0);
  assert.deepEqual(r.foundSet, [ids[1], ids[2]]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mime, 'image/png');
  assert.equal(calls[0].model, 'voyage-multimodal-3');
});

test('Perform Semantic Find by image stops when the server has no image embedding model', async () => {
  const r = await runScript(store, script(configure, find(picture)), { layout: 'PICS', trace: true, ai: { refusal: () => undefined, generate: async () => '' } });
  assert.notEqual(r.error, 0);
  assert.match(r.trace?.find((t) => t.message)?.message ?? '', /image embedding model/);
});

test('Perform Semantic Find by image needs a picture, not text', async () => {
  const { ai, calls } = withImages();
  const r = await runScript(store, script(configure, find('"hello"')), { layout: 'PICS', trace: true, ai });
  assert.notEqual(r.error, 0);
  assert.match(r.trace?.find((t) => t.message)?.message ?? '', /needs a picture/);
  assert.equal(calls.length, 0);
});

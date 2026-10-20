// Formatting kept with text data through the Data API: "styles" beside "fieldData" in a PATCH (what the web client's
// Format menu sends) is checked, kept with the value, and returned with the record, only for fields the account sees.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;
let store: Store;
let id: number;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-text-styles-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  store = s.host.get('Charts')!;
  store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'Body', type: 'text' }, { name: 'Count', type: 'number' }] }] as never);
  id = store.create('Notes', { Body: 'Hello world' }).recordId;
  const set = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...set, extendedPrivileges: [...set.extendedPrivileges, 'fmrest'] });
  store.setPassword('Admin', 'Admin-pw-123456');
});
after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const signIn = async () => (await (await fetch(`${base}/fmi/data/vLatest/databases/Charts/sessions`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa('Admin:Admin-pw-123456') }, body: '{}',
})).json()).response.token as string;
const patch = async (token: string, body: unknown) => {
  const res = await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Notes/records/${id}`, {
    method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const read = async (token: string) => (await (await fetch(`${base}/fmi/data/vLatest/databases/Charts/layouts/Notes/records/${id}`, {
  headers: { authorization: `Bearer ${token}` },
})).json()).response.data[0];

test('a PATCH with styles keeps the formatting with the value, and the record returns it', { skip }, async () => {
  const token = await signIn();
  const r = await patch(token, { fieldData: { Body: 'Hello world' }, styles: { Body: [{ start: 0, end: 5, style: 256, color: '#cc0000' }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rec = await read(token);
  assert.deepEqual(rec.styles, { Body: [{ start: 0, end: 5, style: 256, color: '#CC0000' }] });
  // Typing through the Data API keeps it around the change.
  await patch(token, { fieldData: { Body: 'Oh, Hello world' } });
  assert.deepEqual((await read(token)).styles, { Body: [{ start: 4, end: 9, style: 256, color: '#CC0000' }] });
});

test('styles that aren\'t runs, or without the value, or on a number field are refused, and nothing is written', { skip }, async () => {
  const token = await signIn();
  const before = store.get('Notes', id);
  for (const [body, pattern] of [
    [{ fieldData: { Body: 'x' }, styles: { Body: [{ start: 0, end: 1, color: 'javascript:alert(1)' }] } }, /not valid/],
    [{ fieldData: { Body: 'x' }, styles: { Body: [{ start: 0, end: 1, font: 'A"><script>', size: 12 }] } }, /not valid/],
    [{ fieldData: { Body: 'x' }, styles: [1] }, /object of fields/],
    [{ fieldData: { Count: '2' }, styles: { Body: [] } }, /need its value/],
    // Found by review: with no fieldData, styles were ignored rather than refused.
    [{ fieldData: {}, styles: { Body: [] } }, /need its value/],
    [{ fieldData: { Count: '2' }, styles: { Count: [{ start: 0, end: 1, style: 256 }] } }, /can't keep formatting/],
  ] as const) {
    const r = await patch(token, body);
    assert.notEqual(r.status, 200, JSON.stringify(body));
    assert.match(r.body.messages[0].message, pattern);
  }
  const now = store.get('Notes', id);
  assert.equal(now.fieldData.Count, before.fieldData.Count);
});

// Layout Setup's fixed page margins saved through design mode and read back by the layout editor and the web client,
// and the server's PDF with them; Page Setup scale leaves the server's PDF as it was (it prints at 100%).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { LayoutDesign, LayoutObject, LayoutPart } from '../../fmp12/src/index.ts';
import { LayoutPrinter, type PrintSource } from '../../scripts/src/print.ts';
import { serve, designOf, type Host } from '../src/index.ts';

let dir: string;
let server: Server;
let base: string;
let host: Host;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-print-'));
  const s = await serve({ dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
  host = s.host;
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

const json = (path: string, init: RequestInit = {}) =>
  fetch(base + path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) } })
    .then(async (r) => ({ status: r.status, body: await r.json() }));

const src: PrintSource = {
  field: () => ({ text: '' }), merge: (t) => t, hidden: () => false, conditions: () => [], image: () => undefined, portalCount: () => 0, portalRow: () => {},
};
const part = (kind: string, top: number, height: number) => ({ kind, top, height, style: {} }) as LayoutPart;
const text = (id: number, top: number, left: number, right: number) =>
  ({ id, kind: 'text', type: 0, text: `t${id}`, bounds: { top, left, bottom: top + 18, right }, anchors: { left: true, top: true, right: false, bottom: false }, style: {} }) as LayoutObject;
/** Each page's size and its texts' positions, as the server's PDF draws them. */
const geometry = (design: LayoutDesign, setup?: unknown, rows = 1) => new LayoutPrinter(design, undefined, src, { setup: setup as never })
  .print(Array.from({ length: rows }, () => ({ part: design.parts.find((p) => p.kind === 'body')! })))
  .map((pg) => ({ size: [pg.width, pg.height], texts: pg.ops.filter((o) => o.kind === 'text').map((o) => { const t = o as { text: string; left: number; top: number }; return `${t.text}@${t.left},${t.top}`; }) }));

test('fixed page margins: saved in design mode, read back by the layout editor and the web client, and used by the server PDF', async () => {
  host.create('Margins').setPassword('Admin', 'pw');
  const login = await json('/fmi/data/vLatest/databases/Margins/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw') } });
  const auth = { authorization: `Bearer ${login.body.response.token}` };
  const save = (design: unknown) => json('/tabularius/design/v1/databases/Margins', { method: 'POST', headers: auth, body: JSON.stringify({ changes: [{ op: 'updateLayout', layout: 'People', design }] }) });
  const made = await json('/tabularius/design/v1/databases/Margins', { method: 'POST', headers: auth, body: JSON.stringify({ changes: [{ op: 'createTable', name: 'People', fields: [{ name: 'Name' }] }] }) });
  assert.equal(made.status, 200);
  const id = made.body.design.layouts.find((l: { name: string }) => l.name === 'People').id;

  const fixed = { top: 12, left: 18, bottom: 24, right: 30 };
  const saved = await save({ fixedMargins: fixed });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  // The layout editor's load, and the web client's (what Preview mode reads).
  assert.deepEqual((await json(`/tabularius/design/v1/databases/Margins/layouts/${id}`, { headers: auth })).body.design.fixedMargins, fixed);
  assert.deepEqual((await json('/tabularius/app/v1/databases/Margins/layouts/People', { headers: auth })).body.design.fixedMargins, fixed);

  // The server PDF from the stored design: the printable area starts at the fixed margins.
  const store = host.get('Margins')!;
  const design: LayoutDesign = { ...store.design(id)!, parts: [part('body', 0, 50)], objects: [text(1, 5, 10, 100)], width: 400 };
  assert.deepEqual(geometry(design), [{ size: [612, 792], texts: ['t1@28,17'] }]);

  // Refused: a negative margin, a side missing, text. null clears them.
  for (const bad of [{ ...fixed, top: -1 }, { top: 1, left: 1, bottom: 1 }, { ...fixed, left: 'x' }]) assert.equal((await save({ fixedMargins: bad })).status, 400, JSON.stringify(bad));
  assert.deepEqual(store.design(id)!.fixedMargins, fixed);
  assert.equal((await save({ fixedMargins: null })).status, 200);
  assert.equal(store.design(id)!.fixedMargins, undefined);

  // The layout editor gets the file's page setup, to start fixed margins from the file's own.
  assert.equal('pageSetup' in designOf(store), false);
  const setup = { orientation: 'portrait' as const, width: 612, height: 792, margins: { top: 20, left: 22, bottom: 20, right: 22 } };
  store.schema.pageSetup = setup;
  try {
    assert.deepEqual(designOf(store).pageSetup, setup);
  } finally {
    delete store.schema.pageSetup;
  }
});

test('server PDF: a 50% Page Setup scale prints the same pages as 100% (the scale is Preview\'s only)', () => {
  const margins = { top: 36, left: 36, bottom: 36, right: 36 };
  const at100 = { orientation: 'portrait', width: 612, height: 792, margins };
  const at50 = { ...at100, scale: 0.5 };
  // Two 300-tall bodies on a 720-tall printable page; a 500-wide layout on 540 printable.
  const design = { id: 1, name: 'L', parts: [part('body', 0, 300)], objects: [text(1, 5, 10, 100), text(2, 40, 480, 500)], width: 500 } as LayoutDesign;
  const before = [{ size: [612, 792], texts: ['t1@46,41', 't2@516,76', 't1@46,341', 't2@516,376'] }, { size: [612, 792], texts: ['t1@46,41', 't2@516,76'] }];
  assert.deepEqual(geometry(design, at100, 3), before);
  assert.deepEqual(geometry(design, at50, 3), before);
  // In two columns, each 270 wide at 100% and still at 50%.
  const columns = { ...design, objects: [text(1, 5, 10, 100)], printColumns: { count: 2 } } as LayoutDesign;
  const two = [{ size: [612, 792], texts: ['t1@46,41', 't1@316,41', 't1@46,341', 't1@316,341'] }];
  assert.deepEqual(geometry(columns, at100, 4), two);
  assert.deepEqual(geometry(columns, at50, 4), two);
});

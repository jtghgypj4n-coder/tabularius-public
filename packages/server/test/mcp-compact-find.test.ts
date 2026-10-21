import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { PORTAL_ROWS, compactPortals } from '../src/ai-output.ts';

// find_records keeps an AI session's context small: each record shows its first few portal rows and says how many
// there are, unless the caller asks for more.

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const skip = existsSync(join(fixtures, 'BeezwaxSemanticSearch.fmp12')) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let base: string;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-compact-'));
  copyFileSync(join(fixtures, 'BeezwaxSemanticSearch.fmp12'), join(dir, 'BeezwaxSemanticSearch.fmp12'));
  const s = await serve({ mcpToken: 'test-admin-token', dir, port: 0, log: () => {} });
  server = s.server;
  base = s.url;
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true });
});

let id = 0;
async function find(args: Record<string, unknown>): Promise<{ text: string; value: any }> {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: 'Bearer test-admin-token' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'find_records', arguments: { database: 'BeezwaxSemanticSearch', layout: 'Projects', ...args } } }),
  });
  const text = (await r.json()).result.content[0].text as string;
  return { text, value: JSON.parse(text) };
}

test('find_records: portal rows are capped and counted, and a bigger cap or named fields give them all', { skip }, async () => {
  const compact = await find({ limit: 3 });
  const rec = compact.value.records[0];
  assert.equal(rec.portalData.PROJECT.length, PORTAL_ROWS);
  assert.equal(rec.portalTotals.PROJECT, 15);
  assert.ok(!('modId' in rec.portalData.PROJECT[0]));
  assert.ok(compact.text.length < 15_000, `${compact.text.length} characters`);

  const all = await find({ limit: 3, portalRows: 1000 });
  assert.equal(all.value.records[0].portalData.PROJECT.length, 15);
  assert.equal(all.value.records[0].portalTotals, undefined);
  assert.ok(all.text.length > 3 * compact.text.length / 2);

  // Naming fields is asking for exactly those: portal rows come whole.
  const named = await find({ limit: 1, fields: ['title', 'PROJECT::title'] });
  assert.equal(named.value.records[0].portalData.PROJECT.length, 15);
  // A record without portals comes back as it was.
  const bare = { recordId: '1', fieldData: {} };
  assert.equal(compactPortals(bare), bare);
});

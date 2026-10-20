import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';

test('MCP hides values copied from secret fields across record, summary, search and calculation reads', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-secret-value-'));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.create('Shop');
  // Existing-file compatibility: absent policy keeps the original redaction behavior.
  store.sql.exec("DELETE FROM _fm_meta WHERE key = 'aiPolicy'");
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Password' }, { name: 'Public' }, { name: 'Note' }] },
    { op: 'createField', table: 'Items', name: 'Hint', kind: 'calculation', type: 'text', calculation: 'Password' },
    { op: 'createField', table: 'Items', name: 'Live Hint', kind: 'calculation', type: 'text', calculation: 'Password', options: { unstored: true } },
  ]);
  const layout = store.schema.layouts[0].name;
  const secret = 'vaultlight2026';
  const id = store.create(layout, { Password: secret, Public: 'ordinary', Note: `Copied: ${secret}` }).recordId;
  const empty = store.create(layout, { Password: '', Public: '' }).recordId;
  const short = store.create(layout, { Password: 'abc', Public: 'abc' }).recordId;
  const server = createMcpServer(host, { admin: true });
  const client = new Client({ name: 'secret-value-test', version: '1' });
  t.after(async () => { await client.close(); await server.close(); await host.close(); rmSync(dir, { recursive: true, force: true }); });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: { database: 'Shop', ...args } });
    assert.ok(!result.isError, JSON.stringify(result.content));
    const text = (result.content as { text: string }[])[0].text;
    const value = JSON.parse(text) as Record<string, any>;
    // search_records repeats the caller's query; inspect its returned matches, not the supplied input.
    const checked = name === 'search_records' ? value.hits : value;
    assert.ok(!JSON.stringify(checked).includes(secret), `${name} exposed the secret: ${text}`);
    if (result.structuredContent) assert.ok(!JSON.stringify(result.structuredContent).includes(secret), `${name} exposed a structured secret`);
    return value;
  };

  const one = await call('get_record', { layout, recordId: id });
  assert.match(one.fieldData.Hint, /hidden/i);
  assert.match(one.fieldData['Live Hint'], /hidden/i);
  assert.match(one.fieldData.Note, /hidden/i);
  assert.match((await call('get_record', { layout, recordId: id, fields: ['Hint'] })).fieldData.Hint, /hidden/i);
  const found = await call('find_records', { layout });
  assert.match(found.records.find((r: { recordId: number }) => r.recordId === id).fieldData.Hint, /hidden/i);
  const summary = await call('summarize_records', { layout, groupBy: ['Hint'] });
  assert.ok(summary.groups.some((g: { values: { Hint: string } }) => /hidden/i.test(g.values.Hint)));
  const liveSummary = await call('summarize_records', { layout, groupBy: ['Live Hint'] });
  assert.ok(liveSummary.groups.some((g: { values: Record<string, string> }) => /hidden/i.test(g.values['Live Hint'])));
  const dashboard = await call('save_dashboard', { name: 'Secret hint preview', preview: true, widgets: [
    { title: 'Secret hints', kind: 'table', layout, query: [{ Public: 'ordinary' }], groupBy: ['Hint'], top: { field: 'Hint', n: 1 } },
  ] });
  assert.equal(dashboard.data[0].foundCount, 1);
  assert.match(dashboard.data[0].top.values[0], /hidden/i);
  assert.match(dashboard.data[0].rows[0][0], /hidden/i);
  // Neither the secret field nor its copies are searched: a hit on them, even with hidden text, would show the secret by prefix.
  assert.equal((await call('search_records', { text: secret })).hits.length, 0);
  assert.equal((await call('search_records', { text: 'vaul' })).hits.length, 0);
  assert.equal((await call('search_records', { text: 'ordinary' })).hits.length, 1);
  const evaluated = await call('evaluate_calculation', { layout, recordId: id, formula: 'GetField ( "Pass" & "word" )' });
  assert.match(evaluated.value, /hidden/i);
  const measured = await call('summarize_records', { layout, measures: [{ fn: 'max', field: 'Hint' }, { fn: 'min', field: 'Password' }, { fn: 'count', field: 'Password' }] });
  assert.equal(measured.totals['max(Hint)'], 'abc');
  assert.match(measured.totals['min(Password)'], /hidden/i);
  const liveMeasured = await call('summarize_records', { layout, measures: [{ fn: 'max', field: 'Live Hint' }] });
  assert.equal(liveMeasured.totals['max(Live Hint)'], 'abc');
  // The same value in other case is still the copy.
  assert.match((await call('evaluate_calculation', { layout, recordId: id, formula: 'Upper ( Hint )' })).value, /copy of a password/);
  const blank = await call('get_record', { layout, recordId: empty });
  assert.equal(blank.fieldData.Public, '');
  assert.equal(blank.fieldData.Hint, '');
  assert.equal((await call('get_record', { layout, recordId: short })).fieldData.Public, 'abc');
});

test('MCP hides a short secret (a PIN) only where the whole value is a copy, not where it is part of ordinary text', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-secret-pin-'));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.create('Shop');
  // Existing-file compatibility: absent policy keeps the original redaction behavior.
  store.sql.exec("DELETE FROM _fm_meta WHERE key = 'aiPolicy'");
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'PIN' }, { name: 'Amount' }, { name: 'Year' }, { name: 'Copy' }] }]);
  const layout = store.schema.layouts[0].name;
  const id = store.create(layout, { PIN: '2024', Amount: '120245', Year: 'Founded 2024', Copy: '2024' }).recordId;
  const server = createMcpServer(host, { admin: true });
  const client = new Client({ name: 'secret-pin-test', version: '1' });
  t.after(async () => { await client.close(); await server.close(); await host.close(); rmSync(dir, { recursive: true, force: true }); });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: { database: 'Shop', ...args } });
    assert.ok(!result.isError, JSON.stringify(result.content));
    return JSON.parse((result.content as { text: string }[])[0].text) as Record<string, any>;
  };
  const r = (await call('get_record', { layout, recordId: id })).fieldData;
  assert.equal(r.Amount, '120245');
  assert.equal(r.Year, 'Founded 2024');
  assert.match(r.Copy, /hidden/i);
  assert.match(r.PIN, /hidden/i);
  assert.equal((await call('evaluate_calculation', { layout, recordId: id, formula: 'Year' })).value, 'Founded 2024');
});

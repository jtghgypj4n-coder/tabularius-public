import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Host } from '../src/host.ts';
import { createMcpServer } from '../src/mcp.ts';
import { checkPlan, runApprovedStep } from '../src/agent.ts';
import { cleanupHistory } from '../src/cleanup.ts';
import type { DesignOp } from '../../store/src/index.ts';

test('AR-server-mcp-ai-06', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-atomic-'));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.create('Shop');
  let client: Client | undefined;
  let server: ReturnType<typeof createMcpServer> | undefined;
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Parents', fields: [{ name: 'Id', type: 'number' }, { name: 'Label', options: { validation: { notEmpty: true } } }] },
      { op: 'createTable', name: 'Children', fields: [{ name: 'ParentId', type: 'number' }, { name: 'Label' }] },
      { op: 'createRelationship', left: 'Parents', right: 'Children', predicates: [{ left: 'Id', right: 'ParentId' }] },
    ] as DesignOp[]);
    const design = store.design('Parents')!;
    const childOccurrence = store.schema.tableOccurrences.find((o) => o.name === 'Children')!;
    store.applyDesign([{ op: 'updateLayout', layout: 'Parents', design: { objects: [...design.objects, {
      id: 900, kind: 'portal', type: 3, anchors: { left: true, top: true, right: false, bottom: false },
      bounds: { top: 200, left: 20, bottom: 300, right: 300 }, style: {},
      portal: { tableOccurrenceId: childOccurrence.id, tableOccurrence: 'Children', rows: 3, initialRow: 1 }, children: [],
    }] } as never }] as DesignOp[]);
    const parent = store.create('Parents', { Id: 1, Label: 'original parent' }).recordId;
    const child = store.create('Children', { ParentId: 1, Label: 'original child' }).recordId;
    server = createMcpServer(host, { account: 'Admin', database: 'Shop' });
    client = new Client({ name: 'atomic-test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const result = await client.callTool({ name: 'update_record', arguments: {
      database: 'Shop', layout: 'Parents', recordId: parent, fieldData: { Label: '' },
      portalData: { Children: [{ recordId: String(child), 'Children::Label': 'changed child' }] },
    } });
    assert.equal(result.isError, true);
    assert.equal(store.get('Parents', parent).fieldData.Label, 'original parent');
    assert.equal(store.get('Children', child).fieldData.Label, 'original child');
  } finally {
    await client?.close();
    await server?.close();
    await host.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('AR-server-mcp-ai-07', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-agent-atomic-'));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.create('Shop');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Label' }] }]);
    const id = store.create('Items', { Label: 'before' }).recordId;
    cleanupHistory(store);
    store.sql.exec("CREATE TRIGGER reject_cleanup BEFORE INSERT ON _fm_cleanup BEGIN SELECT RAISE(ABORT, 'journal refused'); END");
    const plan = checkPlan(store, { layout: 'Items', steps: [{ kind: 'set', field: 'Label', value: 'after' }] }, undefined);
    await assert.rejects(runApprovedStep(store, plan, 0, undefined, undefined, { account: 'Admin' }), /journal refused/);
    assert.equal(store.get('Items', id).fieldData.Label, 'before');
    assert.deepEqual(cleanupHistory(store), []);
  } finally {
    await host.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('AR-server-mcp-ai-07 append', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-agent-append-'));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.create('Shop');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Label' }] }]);
    const id = store.create('Items', { Label: 'before' }).recordId;
    const plan = checkPlan(store, { layout: 'Items', steps: [
      { kind: 'set', field: 'Label', value: 'middle' },
      { kind: 'set', field: 'Label', value: 'after' },
    ] }, undefined);
    const first = await runApprovedStep(store, plan, 0, undefined, undefined, { account: 'Admin' });
    assert.ok(first.run);
    store.sql.exec("CREATE TRIGGER reject_cleanup_update BEFORE UPDATE ON _fm_cleanup BEGIN SELECT RAISE(ABORT, 'journal update refused'); END");
    await assert.rejects(runApprovedStep(store, plan, 1, first.state, first.run, { account: 'Admin' }), /journal update refused/);
    assert.equal(store.get('Items', id).fieldData.Label, 'middle');
    assert.equal(cleanupHistory(store).length, 1);
    assert.equal(cleanupHistory(store)[0].changes, 1);
  } finally {
    await host.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

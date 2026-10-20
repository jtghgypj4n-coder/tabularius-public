// Argument completion (the MCP completion request): a prompt or resource argument is completed from the files and layouts
// the signed-in identity can see, never from others.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createStore } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';
import { createMcpServer, type McpIdentity } from '../src/mcp.ts';

const OPEN = { view: true, edit: true, create: true, delete: true };

async function setup(t: TestContext, who: McpIdentity) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-mcp-complete-'));
  for (const name of ['Sales', 'Staff']) createStore(join(dir, `${name}.openhbam.sqlite`));
  const host = new Host(dir);
  const sales = host.get('Sales')!;
  sales.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'A' }] },
    { op: 'createLayout', name: 'Order list', occurrence: 'Orders' },
    { op: 'createLayout', name: 'Order secret', occurrence: 'Orders' },
    { op: 'createLayout', name: 'Customers', occurrence: 'Orders' },
  ]);
  sales.savePrivilegeSet({ name: 'Clerk', records: { ...OPEN }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp'], layoutAccess: { 'Order secret': { layout: 'none', records: 'none' } } });
  sales.setPassword('clerk', 'pw', 'Clerk');
  const staff = host.get('Staff')!;
  staff.applyDesign([
    { op: 'createTable', name: 'People', fields: [{ name: 'A' }] },
    { op: 'createLayout', name: 'Order staff', occurrence: 'People' },
  ]);
  const server = createMcpServer(host, who);
  const client = new Client({ name: 'completion-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await server.close();
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  const prompt = async (name: string, argument: string, value: string, database?: string) =>
    (await client.complete({ ref: { type: 'ref/prompt', name }, argument: { name: argument, value }, ...(database ? { context: { arguments: { database } } } : {}) })).completion.values;
  const resource = async (database: string) =>
    (await client.complete({ ref: { type: 'ref/resource', uri: 'tabularius://{database}/schema' }, argument: { name: 'database', value: database } })).completion.values;
  return { prompt, resource };
}

test('an administrator is offered every file and layout', async (t) => {
  const { prompt, resource } = await setup(t, { admin: true });
  assert.deepEqual(await prompt('explain_solution', 'database', ''), ['Sales', 'Staff']);
  assert.deepEqual(await prompt('explain_solution', 'database', 'st'), ['Staff']);
  assert.deepEqual(await resource('sa'), ['Sales']);
  assert.deepEqual(await prompt('draft_calculation', 'layout', 'order', 'Sales'), ['Orders', 'Order list', 'Order secret']);
  // Without a database chosen yet, layouts of every file.
  assert.deepEqual(await prompt('find_in_plain_english', 'layout', 'order'), ['Orders', 'Order list', 'Order secret', 'Order staff']);
});

test('an account is offered only what it can see', async (t) => {
  const { prompt, resource } = await setup(t, { account: 'clerk', password: 'pw' });
  // The Clerk has an account in Sales only.
  assert.deepEqual(await prompt('explain_solution', 'database', ''), ['Sales']);
  assert.deepEqual(await resource(''), ['Sales']);
  assert.deepEqual(await prompt('draft_calculation', 'layout', 'order', 'Sales'), ['Orders', 'Order list']);
  assert.deepEqual(await prompt('draft_calculation', 'layout', '', 'Staff'), []);
});

// Exercises the examples that generate the REST and MCP reference against a
// real local HTTP server. The fixture is deliberately tiny and reproducible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createHmac } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { serve, setAdminPassword } from '../src/index.ts';
import { createStore, Store, writer } from '../../store/src/index.ts';
import { REST_GROUPS, MCP_NOTES, mcpListing } from '../../../scripts/reference/render.ts';

const shape = (got: unknown, want: unknown, path = '$'): void => {
  if (want === null || typeof want !== 'object') {
    if (want === null) assert.equal(got, null, path);
    else assert.equal(typeof got, typeof want, path);
    return;
  }
  assert.ok(got !== null && typeof got === 'object', `${path}: expected object`);
  if (Array.isArray(want)) {
    assert.ok(Array.isArray(got), `${path}: expected array`);
    if (want.length && (got as unknown[]).length) shape((got as unknown[])[0], want[0], `${path}[0]`);
    return;
  }
  assert.ok(!Array.isArray(got), `${path}: expected object`);
  for (const [key, value] of Object.entries(want)) {
    assert.ok(Object.hasOwn(got, key), `${path}.${key}: missing key (actual ${JSON.stringify(got)})`);
    shape((got as Record<string, unknown>)[key], value, `${path}.${key}`);
  }
};

const parseResponse = (s: string): unknown | undefined => {
  try { return JSON.parse(s); } catch { return undefined; }
};

function totp(secret: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.toUpperCase().replace(/=+$/, '')) bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)?.map((byte) => parseInt(byte, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

async function fixture(withReplication = false) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-reference-examples-'));
  const db = join(dir, 'Invoices.openhbam.sqlite');
  const checkoutFixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
  const sourceFixture = existsSync(checkoutFixture) ? checkoutFixture
    : join(process.env.TABULARIUS_FIXTURE_CACHE ?? join(homedir(), '.cache', 'tabularius-fixtures'), 'Charts.fmp12');
  const uploadBytes = readFileSync(sourceFixture);
  // Reconvert previews write a converted scratch store beside their source;
  // keep that source under its own hosted name, separate from Invoices.
  copyFileSync(sourceFixture, join(dir, 'ReferenceSource.fmp12'));
  // FileMaker Admin API and conversion examples need a hosted .fmp12 source.
  // It is copied after the host opens the explicitly seeded SQLite store.
  createStore(db);
  const store = new Store(db, 'Invoices');
  store.setAiPolicy(false); // the fixture's Users.Password is for the examples' shapes, not the AI policy
  const fields = (names: string[]) => names.map((name) => ({ name, type: /^(Amount|Paid|Total|Number|Price|Quantity|Count|Year|Month|Day)$/.test(name) ? 'number' : /^(Date|Due|Created|Updated)$/.test(name) ? 'date' : /^(Photo|Scan|Attachment|Container|File)$/.test(name) ? 'container' : 'text' }));
  const tables: Record<string, string[]> = {
    Customers: ['Id', 'Name', 'Email', 'Company', 'City', 'Phone', 'Address', 'Status', 'Notes'],
    Invoices: ['Number', 'Customer', 'CustomerId', 'Amount', 'Paid', 'Status', 'Date', 'Due', 'Attachment', 'Scan', 'City', 'Description'],
    Line_Items: ['InvoiceId', 'Description', 'Amount', 'Quantity', 'Product', 'Price'],
    Items: ['Name', 'Description', 'Price', 'Category', 'Status', 'Date', 'Quantity', 'Total'],
    Assets: ['Name', 'Description', 'Photo', 'File', 'Status'],
    Orders: ['Number', 'Customer', 'CustomerId', 'Amount', 'Total', 'Status', 'Date', 'Due'],
    Contacts: ['Name', 'Email', 'Company', 'Phone', 'City', 'Status'],
    Products: ['Name', 'Description', 'Price', 'Category', 'Quantity'],
    Documents: ['Name', 'Description', 'File', 'Date'],
    Settings: ['Name', 'Value'],
    Users: ['Name', 'Password'],
    InvoiceTags: ['InvoiceId', 'Tag'],
    Clients: ['Number', 'Name', 'City', 'Address', 'Status'],
  };
  const changes: unknown[] = Object.entries(tables).map(([name, names]) => ({ op: 'createTable', name, fields: fields(names) }));
  changes.push(
    { op: 'createValueList', name: 'Statuses', values: ['Open', 'Paid', 'Overdue'] },
    { op: 'createValueList', name: 'Categories', values: ['Office', 'Services'] },
    { op: 'createComponent', id: 3, name: 'Page header', objects: [{ id: 3, kind: 'text', bounds: { top: 0, left: 0, bottom: 20, right: 120 }, text: 'Page header' }] },
    { op: 'createField', table: 'Invoices', name: 'Total', type: 'number', kind: 'calculation', calculation: 'Amount * 1.1' },
    { op: 'createField', table: 'Invoices', name: 'Total Due', type: 'number', kind: 'calculation', calculation: 'Total - Paid' },
    { op: 'createField', table: 'Orders', name: 'Customer Total', type: 'number', kind: 'calculation', calculation: 'Amount * 1.1' },
    { op: 'updateField', table: 'Invoices', field: 'Scan', options: { repetitions: 2 } },
    { op: 'createField', table: 'Settings', name: 'gCurrency', type: 'text', options: { global: true } },
    ...['Mark Paid', 'Mark invoice paid', 'Finish', 'Update Totals', 'Create invoice', 'On Open'].map((name) => ({ op: 'createScript', name, text: /^Mark/i.test(name) ? 'Set Field [ Invoices::Status ; "Paid" ]\nExit Script [ Text Result: "ok" ]' : 'Exit Script [ Text Result: "ok" ]' })),
    ...['Invoice List', 'Invoice Entry', 'Contact List', 'Dashboard', 'Payroll', ...Object.keys(tables).map((table) => `Reference ${table}`)].map((name) => ({ op: 'createLayout', name, occurrence: name === 'Contact List' ? 'Contacts' : name.startsWith('Reference ') ? name.slice('Reference '.length) : 'Invoices' })),
    { op: 'createOccurrence', name: 'LineItems', table: 'Line_Items' },
    { op: 'createRelationship', left: 'Invoices', right: 'Customers', predicates: [{ left: 'CustomerId', right: 'Id' }] },
    { op: 'createRelationship', left: 'Invoices', right: 'LineItems', predicates: [{ left: 'Number', right: 'InvoiceId' }] },
    { op: 'createTheme', name: 'House' },
    { op: 'createStyle', theme: 'House', name: 'Big', element: 70, rules: [{ part: 1, state: 1, css: { 'font-size': '18pt' } }] },
  );
  store.applyDesign(changes as never);
  if (!store.schema.layouts.some((layout) => layout.name === 'Invoices')) {
    store.applyDesign([{ op: 'createLayout', name: 'Invoices', occurrence: 'Invoices' }] as never);
  }
  store.applyDesign([
    { op: 'updateField', table: 'Invoices', field: 'Status', options: { validation: { valueList: 'Statuses' } } },
    { op: 'setFileOptions', openLayout: 'Invoice List', onFirstWindowOpen: 'On Open' },
  ] as never);
  const invoiceDesign = store.design('Invoices')!;
  const statusListId = store.schema.valueLists.find((v) => v.name === 'Statuses')?.id;
  if (statusListId !== undefined) {
    const statusObject = invoiceDesign.objects.find((o) => o.kind === 'field' && o.field?.field === 'Status');
    if (statusObject?.field) statusObject.field.valueListId = statusListId;
  }
  const lineItems = store.schema.tableOccurrences.find((o) => o.name === 'LineItems')!;
  const lineAmount = store.schema.tables.find((t) => t.name === 'Line_Items')!.fields.find((f) => f.name === 'Amount')!;
  const portal = { id: 880, name: 'LineItems', kind: 'portal', type: 9, bounds: { top: 220, left: 20, bottom: 360, right: 580 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, portal: { tableOccurrenceId: lineItems.id, tableOccurrence: 'LineItems', rows: 3, initialRow: 1, scrolling: true }, children: [{ id: 881, name: 'Line item amount', kind: 'field', type: 1, bounds: { top: 222, left: 22, bottom: 248, right: 160 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, field: { tableOccurrenceId: lineItems.id, tableOccurrence: 'LineItems', fieldId: lineAmount.id, field: 'Amount', display: 'edit', repetitions: 1 } }] };
  store.applyDesign([{ op: 'updateLayout', layout: 'Invoices', design: { ...invoiceDesign, themeId: store.designs().themes.find((t) => t.name === 'House')?.id, objects: [...invoiceDesign.objects, portal] } }] as never);
  const clientDesign = store.design('Invoices')!;
  const markPaid = store.schema.scripts.find((s) => s.name.toLowerCase() === 'mark invoice paid')!;
  const button = { id: 44, name: 'Mark Paid', kind: 'button', type: 6, text: 'Mark Paid', bounds: { top: 40, left: 20, bottom: 70, right: 180 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, action: { stepId: 1, step: 'Perform Script', scriptId: markPaid.id, script: markPaid.name } };
  store.applyDesign([{ op: 'updateLayout', layout: 'Invoices', design: { ...clientDesign, objects: [...clientDesign.objects, button] } }] as never);
  store.savePrivilegeSet({ ...store.privilegeSets().find((p) => p.name === '[Full Access]')!, extendedPrivileges: ['fmrest', 'fmmcp', 'fmodata', 'fmxdbc', 'fmxml', 'fmphp', 'fmapp', 'fmwebdirect'] });
  store.create('Customers', { Id: 'C1', Name: 'Acme Corp', Email: 'sales@acme.example', Company: 'Acme', City: 'Toronto', Phone: '(555) 201-3344', Status: 'Active', Notes: '' }, { account: 'Admin' });
  store.create('Customers', { Id: 'C2', Name: 'Acme Corp', Email: 'sales@acme.example', Company: 'Acme', City: 'Toronto', Phone: '555.201.3344', Status: 'actve', Notes: 'Preferred customer' }, { account: 'Admin' });
  for (let i = 0; i < 8; i++) store.create('Invoices', { Number: 1007 + i, Customer: i < 3 ? 'Initech' : i < 6 ? 'Acme Corp' : 'Globex', CustomerId: i < 3 ? 'C2' : i < 6 ? 'C1' : 'C2', Amount: [1200, 300, 450, 100, 200, 250, 180, 90][i], Paid: i === 0 ? 80 : 0, Status: i < 3 ? 'Open' : i === 6 ? 'Overdue' : 'Paid', Date: `2026-01-${String(i + 10).padStart(2, '0')}`, Due: '2026-12-31', City: 'Toronto', Description: 'Consulting' }, { account: 'Admin' });
  store.create('Line_Items', { InvoiceId: 1007, Description: 'Consulting', Amount: 300, Quantity: 2, Product: 'Widget', Price: 150 }, { account: 'Admin' });
  store.create('Line_Items', { InvoiceId: 1007, Description: 'Travel', Amount: 80, Quantity: 1, Product: 'Fare', Price: 80 }, { account: 'Admin' });
  store.create('Items', { Name: 'Widget', Description: 'A useful widget', Price: 20, Category: 'Office', Status: 'Open', Date: '2026-01-15', Quantity: 3, Total: 60 }, { account: 'Admin' });
  for (let i = 0; i < 8; i++) {
    const id = store.create('Assets', { Name: `Invoice scan ${i + 1}`, Description: 'Sample', Status: 'Ready' }, { account: 'Admin' }).recordId;
    store.setContainer('Assets', id, 'Photo', 1, { filename: `scan-${i + 1}.bin`, mime: 'application/octet-stream', data: new Uint8Array(2_762_500) }, { account: 'Admin' });
  }
  const imageId = store.addImage('reference.png', 'image/png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { account: 'Admin' });
  const imageLayout = store.design('Invoices')!;
  store.applyDesign([{ op: 'updateLayout', layout: 'Invoices', design: { ...imageLayout, objects: [...imageLayout.objects, { id: 989, kind: 'graphic', type: 3, bounds: { top: 10, left: 10, bottom: 42, right: 42 }, style: {}, imageId }] } }] as never);
  store.create('Orders', { Number: 1, Customer: 'Acme Corp', Amount: 300, Total: 300, Status: 'Open', Date: '2026-01-15' }, { account: 'Admin' });
  store.create('Contacts', { Name: 'Ada Lovelace', Email: 'ada@example.test', Company: 'Analytical Engines', Phone: '555-0100', City: 'Toronto', Status: 'Active' }, { account: 'Admin' });
  store.create('Clients', { Number: 7, Name: 'Ada Lovelace', City: 'Toronto', Address: '1 Analytical Way', Status: 'Active' }, { account: 'Admin' });
  store.create('Products', { Name: 'Widget', Description: 'A useful widget', Price: 20, Category: 'Office', Quantity: 3 }, { account: 'Admin' });
  store.create('Settings', { Name: 'Region', Value: 'North America' }, { account: 'Admin' });
  store.create('InvoiceTags', { InvoiceId: 1, Tag: 'priority' }, { account: 'Admin' });
  const historyRecordId = writer.run({ account: 'Ann', surface: 'web' }, () => {
    const made = store.create('Invoices', { Number: 1008, Customer: 'History sample', Amount: 50, Status: 'Open' }, { account: 'Ann' });
    store.update('Invoices', made.recordId, { Number: 1009 }, undefined, { account: 'Ann' });
    return made.recordId;
  });
  store.setContainer('Invoices', 1, 'Scan', 1, { filename: 'scan.txt', mime: 'text/plain', data: new TextEncoder().encode('invoice 1007') }, { account: 'Admin' });
  store.setContainer('Invoices', 7, 'Scan', 1, { filename: 'scan-seven.txt', mime: 'text/plain', data: new TextEncoder().encode('invoice 1013') }, { account: 'Admin' });
  const invoiceRows = store.find('Reference Invoices').records.filter((r) => r.fieldData.Number !== null && r.fieldData.Number !== undefined).map((r) => Number(r.recordId));
  const containerInvoiceId = [7, 1].find((id) => store.containerId('Invoices', id, 'Scan') !== undefined) ?? invoiceRows.at(-1) ?? 1;
  const containerId = store.containerId('Invoices', containerInvoiceId, 'Scan') ?? 0;
  const tableRecordIds: Record<string, number[]> = {};
  for (const table of store.schema.tables) {
    const physical = table.name.replaceAll('"', '""');
    tableRecordIds[table.name.toLowerCase()] = (store.sql.prepare(`SELECT _fm_record_id AS recordId FROM "${physical}" ORDER BY _fm_record_id DESC`).all() as { recordId: number }[]).map((r) => Number(r.recordId));
  }
  for (const occurrence of store.schema.tableOccurrences) {
    const table = store.schema.tables.find((t) => t.id === occurrence.baseTableId);
    if (table && tableRecordIds[table.name.toLowerCase()]) tableRecordIds[occurrence.name.toLowerCase()] = tableRecordIds[table.name.toLowerCase()]!;
  }
  const scriptIds = Object.fromEntries(store.schema.scripts.map((s) => [s.name.toLowerCase(), s.id]));
  const layoutIds = Object.fromEntries(store.schema.layouts.map((l) => [l.name.toLowerCase(), l.id]));
  store.setPassword('Admin', 'pw', '[Full Access]');
  setAdminPassword(dir, 'admin-secret');
  store.close();
  const stagingPath = join(dir, 'Invoices Staging.openhbam.sqlite');
  createStore(stagingPath);
  const staging = new Store(stagingPath, 'Invoices Staging');
  staging.applyDesign([{ op: 'createTable', name: 'Invoices', fields: [{ name: 'Amount', type: 'number' }, { name: 'Status' }] }, { op: 'createField', table: 'Invoices', name: 'Notes', type: 'text' }] as never);
  staging.close();
  const hosted = await serve({ dir, port: 0, watch: false, mcpToken: 'reference-mcp-admin', listFilesPublicly: true, ...(withReplication ? { replicationToken: 'reference-replication-token' } : {}), testOutbound: {}, compaction: false, webhooks: true, inboundHooks: true, appConnections: true, log: () => {} });
  const adminBasic = `Basic ${Buffer.from('Admin:pw').toString('base64')}`;
  const login = await fetch(`${hosted.url}/fmi/data/vLatest/databases/Invoices/sessions`, { method: 'POST', headers: { authorization: adminBasic, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(login.status, 200, await login.clone().text());
  const token = (await login.json() as { response: { token: string } }).response.token;
  const security = await fetch(`${hosted.url}/tabularius/security/v1/databases/Invoices`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ changes: [
    { op: 'savePrivilegeSet', set: { name: 'Sales', records: { view: true, edit: true, create: true, delete: true }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest', 'fmmcp', 'fmodata', 'fmxdbc'] } },
    { op: 'savePrivilegeSet', set: { name: 'Clerk', records: { view: true, edit: true, create: true, delete: false }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest'] } },
    { op: 'savePrivilegeSet', set: { name: 'Editors', records: { view: true, edit: true, create: true, delete: false }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest'] } },
    { op: 'savePrivilegeSet', set: { name: 'Read Only', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] } },
    { op: 'savePrivilegeSet', set: { name: 'Readers', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest', 'fmodata'] } },
    { op: 'savePrivilegeSet', set: { name: 'Viewers', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmapp'] } },
    { op: 'setAccount', name: 'Clerk', password: 'clerk-pass', privilegeSet: 'Viewers' },
    { op: 'setAccount', name: 'Reference', password: 'Reference-pw-123456', privilegeSet: '[Full Access]' },
    { op: 'setAccount', name: 'seller', password: 'seller-pass', privilegeSet: 'Sales' },
    { op: 'setAccount', name: 'Ann', password: 'ann-pass', privilegeSet: 'Sales' },
    { op: 'setExternalAccount', name: 'sales-team', privilegeSet: 'Sales' },
    { op: 'setAccount', name: 'Hooks', password: 'hooks-pass', privilegeSet: '[Full Access]' },
    { op: 'setAccount', name: 'Reader', password: 'reader-pass', privilegeSet: 'Readers' },
  ] }) });
  assert.equal(security.status, 200, await security.clone().text());
  const referenceLogin = await fetch(`${hosted.url}/fmi/data/vLatest/databases/Invoices/sessions`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from('Reference:Reference-pw-123456').toString('base64')}`, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(referenceLogin.status, 200, await referenceLogin.clone().text());
  const referenceToken = (await referenceLogin.json() as { response: { token: string } }).response.token;
  const prefs = await fetch(`${hosted.url}/tabularius/app/v1/databases/Invoices/prefs/sorts`, { method: 'PUT', headers: { authorization: `Bearer ${referenceToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ value: [{ name: 'By customer', layout: 'Invoices', sort: [{ fieldName: 'Customer', sortOrder: 'ascend' }] }] }) });
  assert.equal(prefs.status, 200, await prefs.clone().text());
  const webLogin = await fetch(`${hosted.url}/fmi/data/vLatest/databases/Invoices/sessions`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from('Reference:Reference-pw-123456').toString('base64')}`, 'content-type': 'application/json', 'x-tabularius-client': 'web' }, body: '{}' });
  assert.equal(webLogin.status, 200, await webLogin.clone().text());
  const digestBoard = await fetch(`${hosted.url}/tabularius/dashboards/v1/databases/Invoices`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Z Reference digest', widgets: [{ title: 'Invoice revenue', kind: 'number', layout: 'Invoices', measure: { field: 'Amount', fn: 'sum' } }] }) });
  assert.equal(digestBoard.status, 201, await digestBoard.clone().text());
  const automation = await fetch(`${hosted.url}/tabularius/automations/v1/databases/Invoices`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ automation: { name: 'Reference automation', layout: 'Invoices', on: 'update', fields: ['Status'], condition: 'Status = "Paid"', script: 'Mark invoice paid' } }) });
  assert.equal(automation.status, 201, await automation.clone().text());
  const board = (await digestBoard.json() as { dashboard: { id: string } }).dashboard;
  const digest = await fetch(`${hosted.url}/tabularius/digests/v1/databases/Invoices`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ dashboard: board.id, name: 'Reference weekly', days: [1], at: '23:59', prompt: 'weekly invoice summary' }) });
  assert.equal(digest.status, 201, await digest.clone().text());
  const digestId = (await digest.json() as { digest: { id: string } }).digest.id;
  const digestRun = await fetch(`${hosted.url}/tabularius/digests/v1/databases/Invoices/${digestId}/run`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  assert.equal(digestRun.status, 200, await digestRun.clone().text());
  const basic = `Basic ${Buffer.from('Reference:Reference-pw-123456').toString('base64')}`;
  const adminLogin = await fetch(`${hosted.url}/fmi/admin/api/v2/user/auth`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from('admin:admin-secret').toString('base64')}`, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(adminLogin.status, 200, await adminLogin.clone().text());
  const adminToken = (await adminLogin.json() as { response: { token: string } }).response.token;
  let adminCookie = '';
  const refreshAdminCookie = async () => {
    const consoleLogin = await fetch(`${hosted.url}/tabularius/admin/v1/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify({ password: 'admin-secret' }) });
    assert.equal(consoleLogin.status, 200, await consoleLogin.clone().text());
    adminCookie = consoleLogin.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  };
  await refreshAdminCookie();
  const inboundSetup = await fetch(`${hosted.url}/tabularius/admin/v1/inbound-hooks`, { method: 'POST', headers: { cookie: adminCookie, 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Reference public hook', database: 'Invoices', script: 'Mark invoice paid', account: 'Hooks', layout: 'Invoices' }) });
  assert.equal(inboundSetup.status, 201, await inboundSetup.clone().text());
  const inboundSeed = await inboundSetup.json() as { id: string; secret: string };
  const legacyCsv = 'account,privilegeSet,active\nLegacy,Readers,true';
  const legacyPreview = await fetch(`${hosted.url}/tabularius/security/v1/databases/Invoices/accounts/import/preview`, { method: 'POST', headers: { authorization: `Bearer ${referenceToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ csv: legacyCsv }) });
  assert.equal(legacyPreview.status, 200, await legacyPreview.clone().text());
  const legacyToken = (await legacyPreview.json() as { previewToken: string }).previewToken;
  const legacyApply = await fetch(`${hosted.url}/tabularius/security/v1/databases/Invoices/accounts/import/apply`, { method: 'POST', headers: { authorization: `Bearer ${referenceToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ csv: legacyCsv, previewToken: legacyToken, idempotencyKey: 'reference-legacy-account' }) });
  assert.equal(legacyApply.status, 200, await legacyApply.clone().text());
  const scimSetup = await fetch(`${hosted.url}/tabularius/admin/v1/scim/token`, { method: 'POST', headers: { cookie: adminCookie, 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ database: 'Invoices', defaultPrivilegeSet: 'Readers' }) });
  assert.equal(scimSetup.status, 200, await scimSetup.clone().text());
  const approvalTokenResponse = await fetch(`${hosted.url}/tabularius/admin/v1/mcp/tokens`, { method: 'POST', headers: { cookie: adminCookie, 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ database: 'Invoices', agent: { name: 'Reference Approval Agent', privilegeSet: 'Sales', needsApproval: true }, label: 'Reference approval flow', days: 30 }) });
  assert.equal(approvalTokenResponse.status, 201, await approvalTokenResponse.clone().text());
  const approvalToken = (await approvalTokenResponse.json() as { token: string }).token;
  const approvalClient = new Client({ name: 'reference-approval-seed', version: '1' });
  await approvalClient.connect(new StreamableHTTPClientTransport(new URL(`${hosted.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${approvalToken}` } } }));
  const createPending = async (number: number) => {
    const result = await approvalClient.callTool({ name: 'create_record', arguments: { database: 'Invoices', layout: 'Invoices', fieldData: { Number: number, Customer: 'Approval sample', Amount: 25 } } }) as { content?: { type: string; text?: string }[] };
    const text = (result.content ?? []).find((item) => item.type === 'text')?.text ?? '{}';
    return Number((JSON.parse(text) as { pendingId?: number }).pendingId);
  };
  const pendingApproveId = await createPending(99101);
  const pendingRejectId = await createPending(99102);
  await approvalClient.close();
  const newSession = async (account = 'Reference', password = 'Reference-pw-123456') => {
    const request = () => fetch(`${hosted.url}/fmi/data/vLatest/databases/Invoices/sessions`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${account}:${password}`).toString('base64')}`, 'content-type': 'application/json' }, body: '{}' });
    let r = await request();
    if (r.status !== 200 && account === 'Admin') {
      hosted.host.get('Invoices')?.setPassword('Admin', 'pw', '[Full Access]');
      r = await request();
    }
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json() as { response: { token: string } }).response.token;
  };
  const newAdminToken = async () => {
    const r = await fetch(`${hosted.url}/fmi/admin/api/v2/user/auth`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from('admin:admin-secret').toString('base64')}`, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json() as { response: { token: string } }).response.token;
  };
  const closeAdminToken = async (t: string) => {
    await fetch(`${hosted.url}/fmi/admin/api/v2/user/auth/${t}`, { method: 'DELETE', headers: { authorization: `Bearer ${t}` } });
  };
  const newScimToken = async () => {
    const r = await fetch(`${hosted.url}/tabularius/admin/v1/scim/token`, { method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/json', 'x-tabularius-admin': '1' }, body: JSON.stringify({ database: 'Invoices', defaultPrivilegeSet: 'Readers' }) });
    const b = await r.json() as { token?: string; scimToken?: string };
    if (r.status !== 200) throw new Error(JSON.stringify(b));
    return b.token ?? b.scimToken ?? '';
  };
  const resetAccounts = () => {
    hosted.host.get('Invoices')?.setPassword('Admin', 'pw', '[Full Access]');
    hosted.host.get('Invoices')?.setPassword('Reference', 'Reference-pw-123456', '[Full Access]');
  };
  const keepServerRunning = async () => {
    const t = await newAdminToken();
    await fetch(`${hosted.url}/fmi/admin/api/v2/server/status`, { method: 'PATCH', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'RUNNING' }) });
    await fetch(`${hosted.url}/fmi/admin/api/v2/server/config/blocknewusers`, { method: 'PATCH', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify({ blockNewUsers: false }) });
    await closeAdminToken(t);
    resetAccounts();
  };
  return { ...hosted, dir, token, basic, adminToken, imageId, historyRecordId, inboundHookId: inboundSeed.id, inboundSecret: inboundSeed.secret, uploadBytes, invoiceIds: invoiceRows, containerInvoiceId, containerId, tableRecordIds, scriptIds, layoutIds, digestId, pendingApproveId, pendingRejectId, replicationToken: 'reference-replication-token', get adminCookie() { return adminCookie; }, refreshAdminCookie, newSession, newAdminToken, newScimToken, closeAdminToken, keepServerRunning, resetAccounts, async close() {
    await new Promise<void>((resolve) => hosted.server.close(() => resolve()));
    hosted.host.close();
    rmSync(dir, { recursive: true, force: true });
  } };
}

test('REST reference examples match live status and response shape', async () => {
  const base = await fixture();
  let replicationFixture: Awaited<ReturnType<typeof fixture>> | undefined;
  const failures: string[] = [];
  let passed = 0;
  let skipped = 0;
  let backupSet = '';
  const runtimeIds: Record<string, string> = { inboundHook: base.inboundHookId, inboundSecret: base.inboundSecret };
  let debugToken = '';
  let importPreviewToken = '';
  let totpSecret = '';
  try {
    for (const group of REST_GROUPS) for (const route of group.routes) {
      const f = route.path.startsWith('/tabularius/replication/') ? (replicationFixture ??= await fixture(true)) : base;
      const ex = route.example;
      const label = `${route.method} ${route.path}`;
      if (ex.skipReason) { skipped++; continue; }
      if (ex.request.startsWith('GET /tabularius/scim/v2/') || ex.request.startsWith('POST /tabularius/scim/v2/') || ex.request.startsWith('PATCH /tabularius/scim/v2/') || ex.request.startsWith('PUT /tabularius/scim/v2/') || ex.request.startsWith('DELETE /tabularius/scim/v2/')) await f.keepServerRunning();
      f.resetAccounts();
      if (route.path.startsWith('/tabularius/admin/')) await f.refreshAdminCookie();
      const want = parseResponse(ex.response);
      // Non-JSON examples describe downloads, HTML and protocol-specific text
      // rather than literal payloads. Their live status is still exercised below.
      const lines = ex.request.split(/\r?\n/);
      const [method, target] = lines[0].split(' ');
      if (!target) { failures.push(`${label}: request has no target`); continue; }
      const headers = new Headers();
      const adminToken = target.startsWith('/fmi/admin/api/') ? await f.newAdminToken() : '';
      // An earlier example may change the account's password or privileges, which ends its open sessions: sign in afresh.
      if (target.startsWith('/tabularius/debug/')) debugToken = await f.newSession();
      let i = 1;
      for (; i < lines.length && lines[i]; i++) {
        const p = lines[i].indexOf(':');
        if (p > 0) {
          const name = lines[i].slice(0, p);
          headers.set(name, name.toLowerCase() === 'cookie' ? f.adminCookie : lines[i].slice(p + 1).trim().replaceAll('…', 'x'));
        }
      }
      let body = lines.slice(i + 1).join('\n');
      if (target.endsWith('/history')) body = body.replace(/("recordId"\s*:\s*)7/, `$1${f.historyRecordId}`);
      let uploadBody: FormData | undefined;
      let rawBody: Buffer | undefined;
      if (headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data') && body.includes('name="upload"')) {
        const filename = /filename="([^"]+)"/.exec(body)?.[1] ?? 'reference.txt';
        const mime = /Content-Type:\s*([^\r\n]+)/i.exec(body)?.[1].trim() ?? 'application/octet-stream';
        uploadBody = new FormData();
        uploadBody.set('upload', new Blob(['Reference example fixture file'], { type: mime }), filename);
        headers.delete('content-type');
      }
      if (target.includes('/layouts/') && target.split('?', 1)[0]?.endsWith('/import')) {
        uploadBody = new FormData();
        uploadBody.set('upload', new Blob(['Number,Customer,Amount\n1015,Acme Corp,45\n'], { type: 'text/csv' }), 'invoices.csv');
        headers.delete('content-type');
      }
      let authFailed = false;
      for (const [k, v] of [...headers.entries()]) {
        if (k.toLowerCase() === 'x-fm-data-access-token') {
          headers.set(k, await f.newSession());
          continue;
        }
        if (k.toLowerCase() === 'authorization') {
          if (/^Basic /i.test(v)) headers.set(k, target.startsWith('/fmi/admin/api/')
            || target.startsWith('/tabularius/admin/')
            ? `Basic ${Buffer.from('admin:admin-secret').toString('base64')}` : f.basic);
          else if (/^Bearer /i.test(v)) {
            try { headers.set(k, `Bearer ${target.startsWith('/fmi/admin/api/') ? adminToken : target.startsWith('/tabularius/replication/') ? f.replicationToken : target.startsWith('/tabularius/admin/v1/scim') || target.startsWith('/tabularius/scim/v2/') ? await f.newScimToken() : target.startsWith('/tabularius/debug/') ? debugToken : await f.newSession()}`); }
            catch (e) { failures.push(`${label}: fixture sign-in failed: ${(e as Error).message}`); authFailed = true; }
          }
        }
      }
      if (authFailed) continue;
      // A script sends no browser headers, so the cross-origin guard also wants this header on a GET that carries the cookie or Basic credentials.
      if (target.startsWith('/tabularius/admin/')) headers.set('x-tabularius-admin', '1');
      body = body.replaceAll('3f9c2a7e1b0d4c8e9a6f5b2d7c1e0a4b8d3f6e2c9a1b5d7e', f.token)
        .replaceAll('3f1d0c6e8a…', `Bearer ${f.token}`).replaceAll('2f1c…', f.token)
        .replaceAll('<session-token>', f.token)
        .replaceAll('<current-password>', 'Reference-pw-123456').replaceAll('<new-password>', 'second-pass')
        .replaceAll('7c1f0e4b9a2d4e8f8b3a6c5d2e1f0a9b', 'reference-replication-token')
        .replaceAll('p4Xo2c9yQm1bT8sV0nKe3jLwR6uZaHfD5gC7iEqY1xM', adminToken)
        .replaceAll('admin secret', 'admin-secret');
      let requestTarget = target
        .replaceAll('{version}', 'vLatest')
        .replaceAll('<session-token>', f.token)
        .replaceAll('{database}', 'Invoices')
        .replaceAll('{layout}', 'Invoices')
        .replaceAll('{recordId}', '1')
        .replaceAll('{entitySet}', 'Invoices')
        .replaceAll('{id}', '1')
        .replaceAll('{field}', target.includes('/containers/') ? 'Scan' : 'Status')
        .replaceAll('{repetition}', '1')
        .replaceAll('{account}', 'Admin')
        .replaceAll('{provider}', 'example')
        .replaceAll('{name}', 'Reference')
        .replaceAll('{type}', 'script')
        .replaceAll('{sets}', 'Invoices,Customers')
        .replaceAll('{discovery}', 'ServiceProviderConfig')
        .replaceAll('{command}', 'next');
      const resourceId = requestTarget.startsWith('/tabularius/automations/v1/') ? runtimeIds.automation
        : requestTarget.startsWith('/tabularius/dashboards/v1/') ? runtimeIds.dashboard
          : requestTarget.startsWith('/tabularius/digests/v1/') ? runtimeIds.digest
            : requestTarget.includes('/cleanup/v1/') ? runtimeIds.cleanup
              : requestTarget.includes('/agent/v1/') ? runtimeIds.agent
                : requestTarget.includes('/debug/v1/') ? runtimeIds.debug
                  : method === 'DELETE' && requestTarget.includes('/script-tests/') ? runtimeIds.scriptTest : undefined;
      if (resourceId) {
        if (requestTarget.includes('/automations/')) requestTarget = requestTarget.replace(/(\/databases\/[^/]+\/)[0-9a-f]{12}(?=\/|$)/, `$1${resourceId}`);
        else if (requestTarget.includes('/dashboards/')) requestTarget = requestTarget.replace(/(\/databases\/[^/]+\/)[0-9a-f]{12}(?=\/|$)/, `$1${resourceId}`);
        else if (requestTarget.includes('/digests/')) requestTarget = requestTarget.replace(/(\/databases\/[^/]+\/)[0-9a-f]{12}(?=\/|$)/, `$1${resourceId}`);
        else if (requestTarget.includes('/cleanup/')) requestTarget = requestTarget.replace(/\/history\/[0-9a-f]{12}(?=\/|$)/, `/history/${resourceId}`);
        else if (requestTarget.includes('/agent/')) requestTarget = requestTarget.replace(/\/runs\/[0-9a-f]{12}(?=\/|$)/, `/runs/${resourceId}`);
        else if (requestTarget.includes('/debug/')) requestTarget = requestTarget.replace(/\/runs\/[0-9a-f]+(?=\/|$)/, `/runs/${resourceId}`);
        else if (requestTarget.includes('/script-tests/')) requestTarget = requestTarget.replace(/\/script-tests\/[\w-]+(?=\/|$)/, `/script-tests/${resourceId}`);
      }
      // Carry identifiers returned by create/list examples into later calls.
      if (method === 'DELETE' && runtimeIds.calendarFeed) requestTarget = requestTarget.replace(/(\/calendar\/v1\/databases\/[^/]+\/feeds\/)[0-9a-f]+(?=\/|$)/, `$1${runtimeIds.calendarFeed}`);
      if (requestTarget.startsWith('/tabularius/admin/v1/')) {
        const id = requestTarget.includes('/schedules/') ? runtimeIds.schedule
          : requestTarget.includes('/webhooks/') ? runtimeIds.webhook
              : requestTarget.includes('/inbound-hooks/') ? runtimeIds.adminInboundHook
              : requestTarget.includes('/connections/') ? runtimeIds.connection
                : requestTarget.includes('/server-scripts/') ? runtimeIds.serverScript
                  : requestTarget.includes('/clients/') ? runtimeIds.client : undefined;
        if (id) requestTarget = requestTarget
          .replace(/(\/schedules\/)[0-9a-f]+(?=\/|$)/, `$1${id}`)
          .replace(/(\/webhooks\/)[0-9a-f]+(?=\/|$)/, `$1${id}`)
          .replace(/(\/inbound-hooks\/)[0-9a-f]+(?=\/|$)/, `$1${id}`)
          .replace(/(\/connections\/)[0-9a-f]+(?=\/|$)/, `$1${id}`)
          .replace(/(\/server-scripts\/)[\w-]+(?=\/|$)/, `$1${id}`)
          .replace(/(\/clients\/)[0-9a-f]+(?=\/|$)/, `$1${id}`);
      }
      if (requestTarget.startsWith('/tabularius/hooks/v1/') && runtimeIds.inboundHook) {
        requestTarget = requestTarget.replace(/(\/tabularius\/hooks\/v1\/)[^/?]+/, `$1${runtimeIds.inboundHook}`);
        const timestamp = String(Math.floor(Date.now() / 1000));
        headers.set('x-tabularius-timestamp', timestamp);
        headers.set('x-tabularius-signature', `sha256=${createHmac('sha256', runtimeIds.inboundSecret ?? '').update(`${timestamp}.${body}`).digest('hex')}`);
      }
      if (requestTarget.includes('/security/v1/') && requestTarget.includes('/pending/')) {
        const pendingId = method === 'POST' && requestTarget.endsWith('/approve') ? f.pendingApproveId : f.pendingRejectId;
        requestTarget = requestTarget.replace(/(\/pending\/)[^/]+(?=\/)/, `$1${pendingId}`);
      }
      if (requestTarget.startsWith('/tabularius/admin/v1/mcp/tokens/') && runtimeIds.mcpToken) requestTarget = requestTarget.replace(/(\/mcp\/tokens\/)[^/?]+/, `$1${runtimeIds.mcpToken}`);
      if (requestTarget.startsWith('/tabularius/design/v1/') && runtimeIds.library) requestTarget = requestTarget.replace(/(\/library\/)[0-9a-f]{12}(?=\/|$)/, `$1${runtimeIds.library}`);
      if (requestTarget.startsWith('/tabularius/scim/v2/') && runtimeIds.scimUser) requestTarget = requestTarget.replaceAll('2f0c6a38-6a0e-4c1b-9d55-3a6c1d2b7e10', runtimeIds.scimUser);
      if (body && runtimeIds.scimUser) body = body.replaceAll('2f0c6a38-6a0e-4c1b-9d55-3a6c1d2b7e10', runtimeIds.scimUser);
      requestTarget = requestTarget
        .replace(/(\/databases\/)[^/?]+/g, '$1Invoices')
        .replace(/(\/fmi\/odata\/v4\/)[^/?]+/g, '$1Invoices');
      // Examples use several illustrative hosted-file names; the fixture uses one
      // file with all of those schemas, so route those path parameters to it too.
      requestTarget = requestTarget.replace(/^(\/tabularius\/admin\/v1\/(?:ai-access|pii)\/)[^/?]+/, '$1Invoices');
      requestTarget = requestTarget.replace(/^\/fmi\/webd\/[^/?]+/, '/fmi/webd/Invoices');
      if (requestTarget.startsWith('/tabularius/admin/v1/files/')) requestTarget = requestTarget.replace('/files/Reference/', '/files/Invoices/');
      if (requestTarget.startsWith('/tabularius/admin/v1/digests/') && f.digestId) requestTarget = requestTarget.replace(/(\/digests\/Invoices\/)[0-9a-f]{12}(?=\/|$)/, `$1${f.digestId}`);
      if (requestTarget.startsWith('/tabularius/digests/v1/databases/Invoices/')) {
        const id = method === 'DELETE' ? runtimeIds.createdDigest : f.digestId;
        if (id) requestTarget = requestTarget.replace(/(\/databases\/Invoices\/)[0-9a-f]{12}(?=\/|$)/, `$1${id}`);
      }
      if (requestTarget.startsWith('/tabularius/admin/v1/uploads/') && runtimeIds.upload) requestTarget = requestTarget.replace(/(\/uploads\/)[\w-]+(?=\/|\?|$)/, `$1${runtimeIds.upload}`);
      if (requestTarget.startsWith('/tabularius/images/')) requestTarget = `/tabularius/images/Invoices/${f.imageId}?sig=${f.host.sign('Invoices', f.imageId, 'image')}`;
      if (requestTarget.startsWith('/tabularius/containers/')) {
        const containerLink = new URL(requestTarget, f.url);
        containerLink.pathname = containerLink.pathname.replace(/\/containers\/[^/]+\/\d+/, `/containers/Invoices/${f.containerId}`);
        containerLink.search = f.host.signed('Invoices', f.containerId);
        requestTarget = `${containerLink.pathname}${containerLink.search}`;
      }
      body = body.replace(/("database"\s*:\s*)"[^"]+"/g, '$1"Invoices"');
      if (target.endsWith('/accounts/import/apply') && importPreviewToken) body = body.replace(/("previewToken"\s*:\s*)"[^"]+"/, `$1"${importPreviewToken}"`);
      if (target.includes('/layouts/') && target.endsWith('/undo-import') && runtimeIds.import) body = body.replace(/("id"\s*:\s*)"[^"]+"/, `$1"${runtimeIds.import}"`);
      if (target === '/tabularius/admin/v1/stale-calcs/undo' && runtimeIds.staleRefresh) body = body.replace(/("id"\s*:\s*)"[^"]+"/, `$1"${runtimeIds.staleRefresh}"`);
      if (target.includes('/totp/') && target.endsWith('/confirm') && totpSecret) {
        const requestBody = parseResponse(body) as { code?: string } | undefined;
        if (requestBody && Object.hasOwn(requestBody, 'code')) body = JSON.stringify({ ...requestBody, code: totp(totpSecret) });
      }
      body = body.replaceAll('/Volumes/Backup/tabularius', join(f.dir, 'Backups'));
      if (requestTarget.includes('/backups/2026-10-13_084500/')) requestTarget = requestTarget.replace('/backups/2026-10-13_084500/', `/backups/${backupSet || 'missing'}/`);
      if (requestTarget === '/tabularius/admin/v1/restore') body = body.replace(/("at"\s*:\s*)"[^"]+"/, `$1"${new Date().toISOString()}"`);
      if (target === '/tabularius/admin/v1/uploads' && method === 'POST') {
        const upload = parseResponse(body) as { size?: number } | undefined;
        if (upload) { upload.size = f.uploadBytes.byteLength; body = JSON.stringify(upload); }
      }
      if (method === 'PUT' && requestTarget.startsWith('/tabularius/admin/v1/uploads/')) {
        rawBody = f.uploadBytes;
        headers.set('content-length', String(rawBody.byteLength));
      }
      if (requestTarget.includes('{')) { failures.push(`${label}: request has an unresolved path parameter (${requestTarget})`); continue; }
      if (target.startsWith('/fmi/admin/api/') && target.includes('/user/auth/')) requestTarget = target.replace(/\/user\/auth\/[^/?]+/, `/user/auth/${adminToken}`);
      if (target.startsWith('/fmi/odata/')) {
        for (const [k, v] of [...headers.entries()]) if (k.toLowerCase() === 'authorization' && /^Bearer /i.test(v)) headers.set(k, f.basic);
      }
      const url = new URL(requestTarget, f.url);
      if (url.searchParams.has('database')) url.searchParams.set('database', 'Invoices');
      if (url.pathname.endsWith('/replication/v1/files/Invoices/changes')) {
        if (runtimeIds.replicationRun) url.searchParams.set('run', runtimeIds.replicationRun);
        if (runtimeIds.replicationSeq) url.searchParams.set('after', runtimeIds.replicationSeq);
        // The copy example below creates a real record after taking its
        // snapshot. Wait for the replication shipper to capture it so this
        // stream example has an encoded change to return, not an empty feed.
        let latest = 0;
        for (let attempt = 0; attempt < 30; attempt++) {
          const listed = await fetch(new URL('/tabularius/replication/v1/files', f.url), {
            headers: { authorization: `Bearer ${f.replicationToken}` },
          });
          const state = await listed.json() as { files?: { name?: string; run?: string; seq?: number }[] };
          const file = state.files?.find((item) => item.name === 'Invoices');
          if (file) {
            latest = Number(file.seq ?? 0);
            if (file.run) url.searchParams.set('run', file.run);
            if (latest > 0) break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (latest > 0) url.searchParams.set('after', String(latest - 1));
      }
      if (method === 'DELETE' && url.pathname.startsWith('/tabularius/admin/v1/uploads/')) {
        for (let attempt = 0; attempt < 100; attempt++) {
          const progress = await fetch(url, { method: 'GET', headers: { cookie: f.adminCookie, 'x-tabularius-admin': '1' }, signal: AbortSignal.timeout(5000) });
          const state = await progress.json() as { phase?: string };
          if (progress.status !== 200 || !['waiting', 'converting'].includes(state.phase ?? '')) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      if (url.pathname.startsWith('/tabularius/design/v1/')) {
        url.pathname = url.pathname.replace(/\/scripts\/1(?=\/|$)/, `/scripts/${f.scriptIds.finish ?? 1}`);
        const invoicesLayoutId = f.layoutIds.invoices;
        if (invoicesLayoutId !== undefined) url.pathname = url.pathname.replace(/\/layouts\/1(?=\/|$)/, `/layouts/${invoicesLayoutId}`);
      }
      if (url.pathname.startsWith('/fmi/odata/v4/')) {
        const set = /^\/fmi\/odata\/v4\/[^/]+\/([^/$]+)/.exec(url.pathname)?.[1];
        if (set && set !== '$crossjoin') {
          const table = decodeURIComponent(set).split('(', 1)[0];
          const targetStore = f.host.get('Invoices')!;
          if (targetStore.schema.tables.some((t) => t.name.toLowerCase() === table.toLowerCase())) {
            const info = targetStore.schema.tables.find((t) => t.name.toLowerCase() === table.toLowerCase());
            const rows = info ? targetStore.sql.prepare(`SELECT _fm_record_id AS recordId FROM "${info.name.replaceAll('"', '""')}" ORDER BY _fm_record_id`).all() as { recordId: number }[] : [];
            const id = Number(rows.at(-1)?.recordId);
            if (Number.isFinite(id)) url.pathname = url.pathname.replace(/\(\d+\)/, `(${id})`);
          }
        }
      }
      if (/^\/tabularius\/debug\/v1\/databases\/[^/]+\/runs\/[^/]+(?:\/(?:continue|next|breakpoints|options|evaluate))?$/.test(url.pathname) && debugToken) {
        // Each debugger example is an independent command against a paused run, owned by the session it was started in.
        // A previous Continue example may already have finished its run.
        const started = await fetch(new URL('/tabularius/debug/v1/databases/Invoices/runs', f.url), {
          method: 'POST',
          headers: { authorization: `Bearer ${debugToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ script: 'Finish', layout: 'Items', pauseAtStart: true }),
        });
        const run = await started.json() as { id?: string };
        if (started.status === 201 && run.id) {
          runtimeIds.debug = run.id;
          url.pathname = url.pathname.replace(/\/runs\/[^/]+(?=\/|$)/, `/runs/${run.id}`);
        }
      }
      if (url.pathname.endsWith('/layouts/Invoices/revert')) {
        try {
          const change = JSON.parse(body) as { recordId?: number; seq?: number };
          if (Object.hasOwn(change, 'recordId')) change.recordId = Number(f.invoiceIds.at(-1) ?? 1);
          const row = f.host.get('Invoices')!.auditLog({ table: 'Invoices', recordId: Number(change.recordId ?? f.invoiceIds.at(-1) ?? 1) })[0];
          if (row && Object.hasOwn(change, 'seq')) { change.seq = row.seq; body = JSON.stringify(change); }
        } catch { /* preserve a malformed example for the endpoint to reject */ }
      }
      if ((url.pathname.startsWith('/fmi/data/') || url.pathname.startsWith('/tabularius/app/') || url.pathname.startsWith('/tabularius/live/') || url.pathname.startsWith('/tabularius/containers/')) && url.pathname.includes('/records/')) {
        let liveRows: { recordId: number }[];
        try { liveRows = f.host.get('Invoices')!.sql.prepare('SELECT _fm_record_id AS recordId FROM "Invoices" ORDER BY _fm_record_id').all() as { recordId: number }[]; }
        catch (error) { throw new Error(`${label}: fixture lost the Invoices table before this request: ${(error as Error).message}`); }
        const recordId = String(url.pathname.includes('/containers/') ? f.containerInvoiceId : method === 'DELETE' ? liveRows[0]?.recordId ?? 1 : liveRows.at(-1)?.recordId ?? 1);
        url.pathname = url.pathname.replace(/\/records\/\d+/, `/records/${recordId}`);
      }
      if (method === 'PATCH' && url.pathname.startsWith('/fmi/data/') && url.pathname.includes('/records/')) {
        try {
          const parsed = JSON.parse(body) as { modId?: unknown };
          const recordId = Number(/\/records\/(\d+)/.exec(url.pathname)?.[1]);
          const row = f.host.get('Invoices')!.sql.prepare('SELECT _fm_mod_id AS modId FROM "Invoices" WHERE _fm_record_id = ?').get(recordId) as { modId: number } | undefined;
          if (row && Object.hasOwn(parsed, 'modId')) { parsed.modId = String(row.modId); body = JSON.stringify(parsed); }
        } catch { /* leave non-JSON requests as documented */ }
      }
      if (url.pathname.startsWith('/fmi/odata/') && ['PATCH', 'PUT', 'DELETE'].includes(method)) headers.set('if-match', '*');
      let response: Response;
      try { response = await fetch(url, { method, headers, redirect: 'manual', signal: AbortSignal.timeout(5000), ...(uploadBody ? { body: uploadBody } : rawBody ? { body: rawBody as unknown as BodyInit } : body ? { body } : {}) }); }
      catch (e) {
        // fetch only says "fetch failed"; the cause (a reset, a refused connection, a timeout) is what tells a server fault from a test one.
        const cause = (e as { cause?: { code?: string; message?: string } }).cause;
        failures.push(`${label}: request failed (${(e as Error).message}${cause ? `: ${cause.code ?? cause.message}` : ''})`);
        continue;
      }
      const contentType = response.headers.get('content-type') ?? '';
      let text: string;
      if (/text\/event-stream|application\/x-ndjson/i.test(contentType)) {
        const reader = response.body?.getReader();
        const chunk = reader ? await reader.read() : { done: true, value: undefined };
        void reader?.cancel().catch(() => {});
        text = chunk.value ? new TextDecoder().decode(chunk.value) : '';
      } else text = await response.text();
      if (response.ok && requestTarget.endsWith('/replication/v1/files/Invoices/copy')) {
        const replicationStore = f.host.get('Invoices');
        if (replicationStore) writer.run({ account: 'Admin', surface: 'replication' }, () => replicationStore.create('Invoices', { Number: 99100, Customer: 'Post-copy change', Amount: 1 }, { account: 'Admin' }));
      }
      if (target === '/tabularius/admin/v1/backup' && response.ok) {
        const backup = parseResponse(text) as { dir?: string } | undefined;
        if (backup?.dir) backupSet = basename(backup.dir);
      }
      if (response.ok) {
        const saved = parseResponse(text) as Record<string, unknown> | undefined;
        const nestedId = (key: string) => saved?.[key] && typeof saved[key] === 'object' ? (saved[key] as Record<string, unknown>).id : undefined;
        if (target.startsWith('/tabularius/automations/v1/databases/') && method === 'POST' && !/[0-9a-f]{12}$/.test(target)) { const id = nestedId('automation'); if (id) runtimeIds.automation = String(id); }
        if (/^\/tabularius\/calendar\/v1\/databases\/[^/]+\/feeds$/.test(target) && method === 'POST' && typeof saved?.id === 'string') runtimeIds.calendarFeed = saved.id;
        if (target.startsWith('/tabularius/dashboards/v1/databases/') && method === 'POST' && !/[0-9a-f]{12}$/.test(target)) { const id = nestedId('dashboard'); if (id) runtimeIds.dashboard = String(id); }
        if (target.startsWith('/tabularius/digests/v1/databases/') && method === 'POST' && !/[0-9a-f]{12}$/.test(target)) { const id = nestedId('digest'); if (id) { runtimeIds.digest = String(id); runtimeIds.createdDigest = String(id); } }
      if (target.startsWith('/tabularius/cleanup/v1/databases/') && target.endsWith('/apply') && saved?.id) runtimeIds.cleanup = String(saved.id);
        if (target.startsWith('/tabularius/agent/v1/databases/') && target.endsWith('/step') && saved?.run) runtimeIds.agent = String(saved.run);
        if (target.startsWith('/tabularius/debug/v1/databases/') && target.endsWith('/runs') && method === 'POST' && saved?.id) runtimeIds.debug = String(saved.id);
        if (target.endsWith('/script-tests') && method === 'POST' && saved?.id) runtimeIds.scriptTest = String(saved.id);
        if (target.endsWith('/script-tests') && method === 'POST' && nestedId('test')) runtimeIds.scriptTest = String(nestedId('test'));
        if (target.endsWith('/accounts/import/preview') && saved?.previewToken) importPreviewToken = String(saved.previewToken);
        if (target.includes('/layouts/') && target.split('?', 1)[0]?.endsWith('/import') && method === 'POST' && saved?.id) runtimeIds.import = String(saved.id);
        if (target.includes('/totp/') && !target.endsWith('/confirm') && method === 'POST' && typeof saved?.secret === 'string') totpSecret = saved.secret;
        if (target === '/tabularius/admin/v1/uploads' && method === 'POST' && saved?.id) runtimeIds.upload = String(saved.id);
        if (target === '/tabularius/admin/v1/stale-calcs/refresh' && method === 'POST' && saved?.id) runtimeIds.staleRefresh = String(saved.id);
        if (target === '/tabularius/admin/v1/schedules' && method === 'POST' && saved?.id) runtimeIds.schedule = String(saved.id);
        if (target === '/tabularius/admin/v1/webhooks' && method === 'POST' && saved?.id) runtimeIds.webhook = String(saved.id);
        if (target === '/tabularius/admin/v1/inbound-hooks' && method === 'POST' && saved?.id) { runtimeIds.adminInboundHook = String(saved.id); }
        if (target === '/tabularius/admin/v1/connections' && method === 'POST' && saved?.id) runtimeIds.connection = String(saved.id);
        if (target === '/tabularius/admin/v1/connections' && method === 'POST' && saved?.id) {
          // The approval example follows the accessKey example, but needs
          // both required S3 secrets. Seed secretKey through the same console
          // API used by the documented secret-setting route.
          const seeded = await fetch(new URL(`/tabularius/admin/v1/connections/${saved.id}/secrets/secretKey`, f.url), {
            method: 'PUT',
            headers: { cookie: f.adminCookie, 'x-tabularius-admin': '1', 'content-type': 'application/json' },
            body: JSON.stringify({ value: 'reference-secret-key-placeholder' }),
          });
          assert.equal(seeded.status, 200, `connection secret seed: ${await seeded.text()}`);
        }
        if (target === '/tabularius/replication/v1/files' && Array.isArray(saved?.files)) {
          const file = saved.files.find((item) => item && typeof item === 'object' && (item as { name?: unknown }).name === 'Invoices');
          if (file && typeof file === 'object') {
            runtimeIds.replicationRun = String((file as { run?: unknown }).run ?? '');
            runtimeIds.replicationSeq = String(Math.max(0, Number((file as { seq?: unknown }).seq ?? 0) - 1));
          }
        }
        if (target === '/tabularius/admin/v1/mcp/tokens' && method === 'POST' && saved?.id) runtimeIds.mcpToken = String(saved.id);
        if (target === '/tabularius/design/v1/databases/Invoices/library' && method === 'POST' && saved?.entry && typeof saved.entry === 'object' && 'id' in saved.entry) runtimeIds.library = String((saved.entry as { id: unknown }).id);
        if (target.endsWith('/Users') && target.startsWith('/tabularius/scim/v2/') && method === 'POST' && saved?.id) runtimeIds.scimUser = String(saved.id);
        if (target.split('?', 1)[0] === '/tabularius/admin/v1/sessions' && method === 'GET' && Array.isArray(saved?.sessions)) {
          const session = saved.sessions[0];
          if (session && typeof session === 'object' && 'id' in session) runtimeIds.client = String((session as { id: unknown }).id);
        }
        if (target === '/tabularius/admin/v1/server-scripts' && method === 'GET' && Array.isArray(saved?.queued)) {
          const script = saved.queued[0];
          if (script && typeof script === 'object' && 'id' in script) runtimeIds.serverScript = String((script as { id: unknown }).id);
        }
      }
      if (adminToken) await f.closeAdminToken(adminToken);
      if (target === '/fmi/admin/api/v2/user/auth' && method === 'POST') {
        const issued = parseResponse(text) as { response?: { token?: string } } | undefined;
        if (issued?.response?.token) await f.closeAdminToken(issued.response.token);
      }
      if (/^\/fmi\/admin\/api\/v2\/server\/(status|config\/blocknewusers)$/.test(new URL(requestTarget, f.url).pathname)) await f.keepServerRunning();
      try {
        assert.equal(response.status, ex.status, `${label}: status; got ${text.slice(0, 300)}`);
        if (want !== undefined) {
          const parsed = parseResponse(text);
          // Several prose-only examples intentionally describe a binary or redirect
          // response instead of containing a literal body to compare.
          if (parsed !== undefined) shape(parsed, want);
        } else if (!text && method !== 'HEAD' && response.status !== 204 && response.status !== 304 && (response.status < 300 || response.status >= 400)) {
          assert.ok(text.length > 0, `${label}: expected a non-empty text response`);
        }
        passed++;
      } catch (e) { failures.push(`${label}: ${(e as Error).message}`); }
    }
    assert.deepEqual(failures, [], `${passed} passed, ${failures.length} failed, ${skipped} skipped:\n${failures.join('\n')}`);
    console.log(`REST examples: ${passed} passed, ${failures.length} failed, ${skipped} skipped`);
  } finally { await base.close(); await replicationFixture?.close(); }
});

  test('MCP reference examples match live tool result shape', async () => {
  const f = await fixture();
  const client = new Client({ name: 'reference-examples', version: '1' });
  const failures: string[] = [];
  let passed = 0;
  let skipped = 0;
  try {
    const dash = await fetch(`${f.url}/tabularius/dashboards/v1/databases/Invoices`, { method: 'POST', headers: { authorization: `Bearer ${f.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Sales', description: 'Invoice totals', widgets: [{ title: 'Revenue by customer', kind: 'chart', chart: 'bar', layout: 'Invoices', groupBy: ['Customer'], measure: { field: 'Amount', fn: 'sum' } }] }) });
    assert.equal(dash.status, 201, await dash.clone().text());
    await client.connect(new StreamableHTTPClientTransport(new URL(`${f.url}/mcp`), { requestInit: { headers: { authorization: 'Bearer reference-mcp-admin' } } }));
    const listing = await mcpListing();
    const runtimeIds: Record<string, string> = {};
    for (const tool of listing.tools) {
      const note = MCP_NOTES[tool.name];
      if (!note) continue;
      if (note.example.skipReason) { skipped++; continue; }
      const expected = parseResponse(note.example.response);
      const args = { ...note.example.arguments };
      if ('database' in args && args.database === 'Shop') args.database = 'Invoices';
      const usableRecord = f.host.get('Invoices')!.find('Invoices').records[0];
      const usableRecordId = Number(usableRecord?.recordId);
      if (usableRecordId && ['explain_value', 'check_record', 'explain_related'].includes(tool.name)) args.recordId = usableRecordId;
      if (tool.name === 'undo_import' && runtimeIds.import) args.id = runtimeIds.import;
      if (tool.name === 'undo_data_fix' && runtimeIds.dataFix) args.id = runtimeIds.dataFix;
      if (tool.name === 'undo_stale_refresh' && runtimeIds.staleRefresh) args.id = runtimeIds.staleRefresh;
      if (tool.name === 'revert_change') {
        const sequence = f.host.get('Invoices')!.auditLog({ table: 'Invoices', recordId: Number(args.recordId) })[0]?.seq;
        if (sequence) args.seq = sequence;
      }
      let resultText: string | undefined;
      try {
        const result = await client.callTool({ name: tool.name, arguments: args });
        const contents = (result as { isError?: boolean; content: { type: string; text?: string }[] }).content;
        assert.notEqual(result.isError, true, `${tool.name}: ${contents.map((c) => c.type === 'text' ? c.text : c.type).join(' ')}`);
        const text = contents.find((c) => c.type === 'text');
        assert.ok(text && text.type === 'text', `${tool.name}: missing text content`);
        assert.equal(typeof text.text, 'string', `${tool.name}: expected textual result`);
        resultText = text.text!;
        const actual = parseResponse(resultText);
        if (tool.name === 'import_records' && actual && typeof actual === 'object' && 'id' in actual) runtimeIds.import = String((actual as { id: unknown }).id);
        if (tool.name === 'fix_data_problems' && actual && typeof actual === 'object' && 'id' in actual) runtimeIds.dataFix = String((actual as { id: unknown }).id);
        if (tool.name === 'refresh_stale_calcs' && actual && typeof actual === 'object' && 'id' in actual) runtimeIds.staleRefresh = String((actual as { id: unknown }).id);
        if (expected !== undefined) shape(actual, expected);
        passed++;
      } catch (e) { failures.push(`${tool.name}: ${(e as Error).message}${resultText ? `; result ${resultText.slice(0, 900)}` : ''}`); }
    }
    assert.deepEqual(failures, [], `${passed} passed, ${failures.length} failed, ${skipped} skipped:\n${failures.join('\n')}`);
    console.log(`MCP examples: ${passed} passed, ${failures.length} failed, ${skipped} skipped`);
  } finally { await client.close().catch(() => {}); await f.close(); }
});

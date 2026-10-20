// Shared inputs and independent expectations. Never ask Privileges to compute the oracle.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, LOCKOUT, type PrivilegeDefinition, type Store } from '../../store/src/index.ts';
import { serve, setAdminPassword } from '../src/index.ts';

export const KEYS = ['fmrest', 'fmodata', 'fmmcp', 'fmxdbc', 'fmapp', 'fmwebdirect', 'fmxml', 'fmurlscript'];
export const ACCOUNT = 'Caller';
export const basic = 'Basic ' + Buffer.from(`${ACCOUNT}:matrix-password`).toString('base64');
const all = { view: true, edit: true, create: true, delete: true };
const base: PrivilegeDefinition = {
  name: 'Matrix', records: all, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'modifiable', extendedPrivileges: KEYS,
};

export interface Expected {
  view: boolean; edit: boolean; create: boolean; delete: boolean;
  field: 'write' | 'read' | 'none'; layout: 'write' | 'view' | 'none' | 'noRecords';
  script: boolean; scriptSource: boolean; export: boolean; print: boolean; limited: boolean;
  rest: boolean; web: boolean; odata: boolean; mcp: boolean; sql: boolean;
  account: 'active' | 'expired' | 'locked' | 'inactive';
}
const allowed: Expected = {
  view: true, edit: true, create: true, delete: true, field: 'write', layout: 'write', script: true, scriptSource: true,
  export: true, print: true, limited: false, rest: true, web: true, odata: true, mcp: true, sql: true, account: 'active',
};
export interface Shape { name: string; definition: PrivilegeDefinition; expected: Expected }
function shape(name: string, definition: Partial<PrivilegeDefinition>, expected: Partial<Expected> = {}): Shape {
  return { name, definition: { ...base, ...definition }, expected: { ...allowed, ...expected } };
}
// Explicit policy rows: an edit-only set can view/edit, but cannot create/delete.
// A separate blind-edit row exercises view=false with edit=true, which fails closed.
export const SHAPES: Shape[] = [
  shape('all', {}),
  shape('no-access', { records: { view: false, edit: false, create: false, delete: false } }, { view: false, edit: false, create: false, delete: false, field: 'none' }),
  shape('read-only', { records: { ...all, edit: false, create: false, delete: false } }, { edit: false, create: false, delete: false }),
  shape('edit-only', { records: { ...all, create: false, delete: false } }, { create: false, delete: false }),
  shape('blind-edit', { records: { ...all, view: false, create: false, delete: false } }, { view: false, edit: false, create: false, delete: false, field: 'none' }),
  shape('create-only', { records: { ...all, edit: false, delete: false } }, { edit: false, delete: false }),
  shape('delete-only', { records: { ...all, edit: false, create: false } }, { edit: false, create: false }),
  shape('field-read', { records: { ...all, fields: { Name: 'viewOnly', Blob: 'viewOnly' } } }, { field: 'read' }),
  shape('field-write', { records: { ...all, fields: { Name: 'modifiable', Blob: 'modifiable' } } }),
  shape('field-none', { records: { ...all, fields: { Name: 'none', Blob: 'none' } } }, { field: 'none' }),
  shape('record-calculation', { records: { view: 'Owner = Get ( AccountName )', edit: 'Owner = Get ( AccountName )', create: true, delete: 'Owner = Get ( AccountName )' } }, { limited: true }),
  shape('table-calculation', { records: { view: false, edit: false, create: false, delete: false }, tables: { Items: { view: 'Owner = Get ( AccountName )', edit: 'Owner = Get ( AccountName )', create: true, delete: 'Owner = Get ( AccountName )' } } }, { limited: true }),
  shape('layout-view-only', { layouts: 'viewOnly' }),
  shape('fill-in-off', { layoutAccess: { Items: { layout: 'viewOnly', records: 'viewOnly' } } }, { layout: 'view' }),
  shape('layout-records-none', { layoutAccess: { Items: { layout: 'viewOnly', records: 'none' } } }, { layout: 'noRecords' }),
  shape('layout-none', { layouts: 'none' }, { layout: 'none' }),
  shape('script-execute-only', { scripts: 'viewOnly' }, { scriptSource: false }),
  shape('script-none', { scripts: 'none' }, { script: false, scriptSource: false }),
  shape('export-off', { exporting: false }, { export: false }),
  shape('print-off', { printing: false }, { print: false }),
  ...(['fmrest', 'fmodata', 'fmmcp', 'fmxdbc'] as const).map((key) => shape(`without-${key}`, { extendedPrivileges: KEYS.filter((k) => k !== key) }, { [{ fmrest: 'rest', fmodata: 'odata', fmmcp: 'mcp', fmxdbc: 'sql' }[key]]: false })),
  shape('fmapp-only-web', { extendedPrivileges: KEYS.filter((k) => k !== 'fmwebdirect') }),
  shape('fmwebdirect-only-web', { extendedPrivileges: KEYS.filter((k) => k !== 'fmapp') }),
  shape('without-web', { extendedPrivileges: KEYS.filter((k) => !['fmapp', 'fmwebdirect'].includes(k)) }, { web: false }),
  shape('without-fmxml', { extendedPrivileges: KEYS.filter((k) => k !== 'fmxml') }),
  shape('other-keys-only', { extendedPrivileges: ['fmxml', 'fmurlscript', 'custom'] }, { rest: false, web: false, odata: false, mcp: false, sql: false }),
  shape('no-keys', { extendedPrivileges: [] }, { rest: false, web: false, odata: false, mcp: false, sql: false }),
  shape('expired', {}, { account: 'expired' }),
  shape('locked', {}, { account: 'locked' }),
  shape('inactive', {}, { account: 'inactive' }),
];

export const SCRIPTS = {
  Read: 'Exit Script [ Text Result: Items::Name ]',
  Edit: 'Set Field [ Items::Name ; "changed" ]\nCommit Records/Requests [ With dialog: Off ]',
  Create: 'New Record/Request',
  Delete: 'Delete Record/Request [ With dialog: Off ]',
  Print: 'Set Error Capture [ On ]\nPrint [ With dialog: Off ]',
};

export type Matrix = Awaited<ReturnType<typeof openMatrix>>;
export async function openMatrix(row: Shape, sql = false) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-privilege-matrix-'));
  createStore(join(dir, 'Matrix.openhbam.sqlite'));
  setAdminPassword(dir, 'server-admin-password');
  let sqlPort = 0;
  const served = await serve({ dir, port: 0, hostname: '127.0.0.1', watch: false, ...(sql ? { sqlPort: 0 } : {}), log: (line) => {
    const match = /PostgreSQL clients: port (\d+)/.exec(line);
    if (match) sqlPort = Number(match[1]);
  } });
  const close = async () => {
    await new Promise<void>((resolve) => served.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const store = served.host.get('Matrix')!;
    // The matrix measures what each privilege shape allows; the per-file AI policy (on for new files) is a separate gate.
    store.setAiPolicy(false);
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Owner' }, { name: 'Blob', type: 'container' }] },
      ...Object.entries(SCRIPTS).map(([name, text]) => ({ op: 'createScript' as const, name, text })),
    ]);
    const design = store.design('Items')!;
    store.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { objects: design.objects.map((object) => object.kind === 'text' ? { ...object, text: '<<Items::Name>>' } : object) } }]);
    const own = store.create('Items', { Name: 'visible', Owner: ACCOUNT }).recordId;
    const other = store.create('Items', { Name: 'secret-other-row', Owner: 'SomeoneElse' }).recordId;
    store.setContainer('Items', own, 'Blob', 1, { filename: 'seed.txt', mime: 'text/plain', data: Buffer.from('seed-container') });
    store.savePrivilegeSet(row.definition);
    store.setPassword(ACCOUNT, 'matrix-password', 'Matrix');
    const apiToken = store.createApiToken(ACCOUNT);
    if (row.expected.account === 'expired') {
      store.setPasswordPolicy({ maxAgeDays: 1 });
      store.sql.prepare('UPDATE _fm_accounts SET password_changed = ? WHERE name = ?').run('2000-01-01T00:00:00.000Z', ACCOUNT);
    } else if (row.expected.account === 'inactive') store.setAccountActive(ACCOUNT, false);
    else if (row.expected.account === 'locked') {
      for (let i = 0; i < LOCKOUT.attempts; i++) await store.verifyAsync(ACCOUNT, 'wrong', '127.0.0.1');
      assert.ok(store.lockedOut(ACCOUNT, '127.0.0.1'));
    }
    return { ...served, dir, store, own, other, row, apiToken, get sqlPort() { return sqlPort; }, close };
  } catch (error) { await close(); throw error; }
}

export async function request(m: Matrix, path: string, method = 'GET', body?: unknown, authorization = basic, headers: Record<string, string> = {}) {
  const response = await fetch(m.url + path, {
    method, headers: { authorization, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = undefined; }
  return { status: response.status, body: data, text, headers: response.headers };
}
export const REST = '/fmi/data/vLatest/databases/Matrix';
export const WEB = '/tabularius/app/v1/databases/Matrix';
export const ODATA = '/fmi/odata/v4/Matrix';
export const SQL = '/tabularius/sql/v1/databases/Matrix';
export const XML = '/fmi/xml/fmresultset.xml?-db=Matrix&-lay=Items';
export function xmlCode(reply: Awaited<ReturnType<typeof request>>): number {
  const match = /<error code="(\d+)"/.exec(reply.text);
  assert.ok(match, reply.text);
  return Number(match[1]);
}
export function code(reply: Awaited<ReturnType<typeof request>>): number {
  return Number(reply.body?.messages?.[0]?.code ?? reply.body?.error?.code ?? 0);
}
export function check(reply: Awaited<ReturnType<typeof request>>, expected: number, label: string) {
  assert.equal(code(reply), expected, `${label}: HTTP ${reply.status} ${reply.text.slice(0, 600)}`);
  assert.equal(reply.status < 400, expected === 0, `${label}: HTTP status agrees with code`);
}
export async function session(m: Matrix, web = false): Promise<string | undefined> {
  const reply = await request(m, REST + '/sessions', 'POST', {}, basic, web ? { 'x-tabularius-client': 'web' } : {});
  const e = m.row.expected;
  check(reply, e.account === 'locked' || e.account === 'inactive' ? 212 : !(web ? e.web : e.rest) ? 9 : 0, 'sign in');
  if (!reply.body.response.token) return undefined;
  if (e.account === 'expired') assert.equal(reply.body.response.passwordChangeRequired, true);
  return `Bearer ${reply.body.response.token}`;
}

export type Operation = 'read' | 'other' | 'find' | 'create' | 'emptyCreate' | 'edit' | 'delete' | 'upload' | 'duplicate' | 'metadata' | 'script' | 'export' | 'print';
export function expected(e: Expected, op: Operation, layout = true): number {
  if (layout && e.layout === 'none') return 105;
  if (op === 'metadata') return 0;
  if (op === 'script') return e.script ? 0 : 9;
  if (op === 'print') return e.print ? 0 : 9;
  if (op === 'export' && !e.export) return 9;
  if (layout && e.layout === 'noRecords') return 200;
  if (op === 'read' || op === 'other' || op === 'export') return e.view && !(op === 'other' && e.limited) ? 0 : 200;
  if (op === 'find') return e.field === 'none' ? 102 : e.view ? 0 : 200;
  if (['create', 'edit', 'upload'].includes(op) && e.field === 'none') return 201;
  if (layout && e.layout === 'view') return 200;
  if (['create', 'edit', 'upload'].includes(op) && e.field === 'read') return 201;
  if (op === 'create' || op === 'emptyCreate' || op === 'duplicate') return e.create ? 0 : 200;
  return e.view && (op === 'delete' ? e.delete : e.edit) ? 0 : 200;
}
export function snapshot(store: Store) {
  return store.query('SELECT * FROM Items ORDER BY _fm_record_id');
}
export function restore(store: Store, rows: ReturnType<typeof snapshot>) {
  store.sql.exec('DELETE FROM Items');
  for (const record of rows) {
    const fields = Object.keys(record);
    store.sql.prepare(`INSERT INTO Items (${fields.map((f) => JSON.stringify(f)).join(',')}) VALUES (${fields.map(() => '?').join(',')})`).run(...Object.values(record));
  }
}
export function assertMutation(m: Matrix, before: ReturnType<typeof snapshot>, op: Operation | 'raw', id = m.own) {
  const after = snapshot(m.store);
  if (['create', 'emptyCreate', 'duplicate'].includes(op)) assert.equal(after.length, before.length + 1, 'allowed create persists a record');
  if (op === 'delete') {
    assert.equal(after.length, before.length - 1, 'allowed delete removes a record');
    assert.ok(!after.some((r) => Number(r._fm_record_id) === id));
  }
  if (op === 'edit') assert.equal(after.find((r) => Number(r._fm_record_id) === id)?.Name, 'changed', 'allowed edit persists');
  if (op === 'upload') assert.notEqual(after.find((r) => Number(r._fm_record_id) === id)?.Blob, before.find((r) => Number(r._fm_record_id) === id)?.Blob, 'allowed upload changes the container');
}
export function assertVisible(records: { fieldData: Record<string, unknown>; recordId: string | number }[], m: Matrix) {
  assert.equal(records.length, m.row.expected.limited ? 1 : 2);
  if (m.row.expected.limited) assert.deepEqual(records.map((r) => Number(r.recordId)), [m.own]);
  for (const record of records) {
    assert.equal(Object.hasOwn(record.fieldData, 'Name'), m.row.expected.field !== 'none');
    assert.equal(Object.hasOwn(record.fieldData, 'Blob'), m.row.expected.field !== 'none');
  }
}
